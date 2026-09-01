// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// EEBUS-Anbindung (Empfang von Steuerbefehlen einer Steuerbox).
//
// FLUX nimmt in der EEBUS-Rolle "Controllable System" (CS) Steuerbefehle einer
// Steuerbox (Energy Guard) entgegen. Umgesetzt werden die beiden für §14a EnWG
// und §9 EEG relevanten Use Cases:
//   - LPC (Limitation of Power Consumption): Begrenzung des Netzbezugs (§14a)
//   - LPP (Limitation of Power Production): Begrenzung der Einspeisung (§9)
//
// WICHTIG (Ausbaustufe 1): Dieses Modul EMPFÄNGT, ZEIGT und PROTOKOLLIERT die
// Steuerbefehle. Es setzt sie noch NICHT real auf Geräte um (keine Drosselung).
// Der eigentliche EEBUS-Transport (SHIP/SPINE/TLS) ist bewusst hinter einer
// klaren internen Schnittstelle (applyIncomingLimit / setConnectionState)
// gekapselt, an die später ein echter Protokoll-Adapter (z. B. ein Go-Sidecar
// auf Basis von enbility/eebus-go) andockt. Für Tests ohne echte Steuerbox gibt
// es einen Simulator-Eingang.

import { log } from "./logger.js";
import * as db from "./db.js";

export type EebusUseCase = "lpc" | "lpp"; // Bezug (§14a) / Produktion (§9)

// Ein aktuell gültiges Limit eines Use Case.
export interface EebusLimit {
  aktiv: boolean;          // ist eine Begrenzung aktiv?
  wert: number;            // Grenzwert in Watt
  dauerSek: number | null; // verbleibende/gesetzte Dauer in s (null = unbefristet)
  gesetztAm: string | null; // ISO-Zeitpunkt des letzten Setzens
  gueltigBis: string | null; // ISO-Zeitpunkt, ab dem das Limit endet (falls Dauer)
}

// Failsafe-Parameter (gelten, wenn die Steuerbox/Kommunikation ausfällt).
export interface EebusFailsafe {
  wert: number;            // Failsafe-Leistungsgrenze in W
  dauerSek: number;        // Failsafe-Dauer in s
}

// Gesamtzustand der EEBUS-Anbindung.
export interface EebusState {
  enabled: boolean;
  // Verbindung zur Steuerbox
  verbunden: boolean;
  steuerboxSki: string | null;    // SKI der Steuerbox (Gegenstelle)
  eigenerSki: string | null;      // eigener SKI (Identität von FLUX)
  letzterKontakt: string | null;  // ISO-Zeitpunkt der letzten Nachricht
  // Heartbeat-Überwachung
  heartbeatOk: boolean;
  letzterHeartbeat: string | null;
  // Aktuelle Limits je Use Case
  lpc: EebusLimit;
  lpp: EebusLimit;
  // Failsafe-Werte je Use Case
  lpcFailsafe: EebusFailsafe;
  lppFailsafe: EebusFailsafe;
  // Ist gerade Failsafe aktiv (weil Kommunikation ausgefallen)?
  failsafeAktiv: boolean;
}

// Ein Log-Eintrag über ein empfangenes EEBUS-Ereignis.
export interface EebusLogEntry {
  ts: string;
  useCase: EebusUseCase | "system";
  art: "limit" | "failsafe" | "heartbeat" | "verbindung" | "info";
  text: string;
  wert?: number;
  dauerSek?: number | null;
}

const LEER_LIMIT: EebusLimit = { aktiv: false, wert: 0, dauerSek: null, gesetztAm: null, gueltigBis: null };

// Hook für die reale Umsetzung eines LPP-Limits (§9-Einspeisedrosselung).
// Wird von außen (index.ts) mit der Growatt-Ansteuerung verbunden, um eine
// Modul-Zirkularität zu vermeiden. Bekommt (aktiv, wattLimit).
let lppUmsetzung: ((aktiv: boolean, wert: number) => void) | null = null;
export function setLppUmsetzung(fn: (aktiv: boolean, wert: number) => void): void {
  lppUmsetzung = fn;
}
function meldeLpp(aktiv: boolean, wert: number): void {
  if (lppUmsetzung) { try { lppUmsetzung(aktiv, wert); } catch { /* ignore */ } }
}

// Hook für Benachrichtigungen bei Limit-Flanken (§9/§14a ein/aus). Wird von
// index.ts mit dem ntfy-Versand verbunden. Bekommt (useCase, aktiv, wert, dauerSek).
let limitFlankeCb: ((useCase: EebusUseCase, aktiv: boolean, wert: number, dauerSek: number | null) => void) | null = null;
export function setLimitFlankeHandler(fn: (useCase: EebusUseCase, aktiv: boolean, wert: number, dauerSek: number | null) => void): void {
  limitFlankeCb = fn;
}
function meldeLimitFlanke(useCase: EebusUseCase, aktiv: boolean, wert: number, dauerSek: number | null): void {
  if (limitFlankeCb) { try { limitFlankeCb(useCase, aktiv, wert, dauerSek); } catch { /* ignore */ } }
}

let state: EebusState = {
  enabled: false,
  verbunden: false,
  steuerboxSki: null,
  eigenerSki: null,
  letzterKontakt: null,
  heartbeatOk: false,
  letzterHeartbeat: null,
  lpc: { ...LEER_LIMIT },
  lpp: { ...LEER_LIMIT },
  lpcFailsafe: { wert: 0, dauerSek: 7200 },
  lppFailsafe: { wert: 0, dauerSek: 7200 },
  failsafeAktiv: false,
};

// Ringpuffer für das Ereignis-Log (neueste zuerst).
const LOG_MAX = 500;
let logbuch: EebusLogEntry[] = [];
// Beim Modulstart persistierte Einträge laden (überstehen jetzt Neustarts).
try {
  const geladen = db.loadEebusLog("eebus", LOG_MAX) as EebusLogEntry[];
  if (Array.isArray(geladen) && geladen.length) logbuch = geladen;
} catch { /* DB evtl. noch nicht bereit */ }

function addLog(e: Omit<EebusLogEntry, "ts">): void {
  const entry: EebusLogEntry = { ts: new Date().toISOString(), ...e };
  logbuch.unshift(entry);
  if (logbuch.length > LOG_MAX) logbuch = logbuch.slice(0, LOG_MAX);
  db.persistEebusLog("eebus", entry.ts, entry, LOG_MAX);
  log.info("eebus", `${entry.useCase}/${entry.art}: ${entry.text}`);
}

// --- Öffentliche Lese-API (für Endpunkte) ---
export function getEebusState(): EebusState { return { ...state, lpc: { ...state.lpc }, lpp: { ...state.lpp } }; }
export function getEebusLog(limit = 200): EebusLogEntry[] { return logbuch.slice(0, Math.max(1, Math.min(limit, LOG_MAX))); }
export function clearEebusLog(): void { logbuch = []; try { db.clearEebusLogPersisted("eebus"); } catch { /* ignore */ } }

// --- Konfiguration ---
export function setEebusConfig(cfg: Partial<Pick<EebusState, "enabled" | "steuerboxSki" | "eigenerSki" | "lpcFailsafe" | "lppFailsafe">>): EebusState {
  if (cfg.enabled != null) {
    if (cfg.enabled !== state.enabled) addLog({ useCase: "system", art: "info", text: cfg.enabled ? "EEBUS-Anbindung aktiviert" : "EEBUS-Anbindung deaktiviert" });
    state.enabled = cfg.enabled;
    if (!cfg.enabled) { state.verbunden = false; state.heartbeatOk = false; }
  }
  if (cfg.steuerboxSki !== undefined) state.steuerboxSki = cfg.steuerboxSki;
  if (cfg.eigenerSki !== undefined) state.eigenerSki = cfg.eigenerSki;
  if (cfg.lpcFailsafe) state.lpcFailsafe = { ...state.lpcFailsafe, ...cfg.lpcFailsafe };
  if (cfg.lppFailsafe) state.lppFailsafe = { ...state.lppFailsafe, ...cfg.lppFailsafe };
  return getEebusState();
}

// --- Interne Empfangsschnittstelle (Transport-Adapter ruft dies auf) ---

// Ein neues Leistungslimit wurde von der Steuerbox empfangen.
// wert = Grenzwert in W; dauerSek = null bei unbefristet; aktiv=false hebt auf.
export function applyIncomingLimit(useCase: EebusUseCase, aktiv: boolean, wert: number, dauerSek: number | null): void {
  const jetzt = new Date();
  const limit: EebusLimit = {
    aktiv,
    wert: Math.max(0, wert),
    dauerSek: dauerSek != null ? Math.max(0, dauerSek) : null,
    gesetztAm: jetzt.toISOString(),
    gueltigBis: dauerSek != null ? new Date(jetzt.getTime() + dauerSek * 1000).toISOString() : null,
  };
  if (useCase === "lpc") state.lpc = limit; else state.lpp = limit;
  state.letzterKontakt = jetzt.toISOString();
  if (useCase === "lpp") meldeLpp(limit.aktiv, limit.wert);
  meldeLimitFlanke(useCase, limit.aktiv, limit.wert, limit.dauerSek);
  const einheit = useCase === "lpc" ? "Bezug" : "Einspeisung";
  addLog({
    useCase, art: "limit",
    text: aktiv
      ? `${einheit}-Limit gesetzt: ${limit.wert} W${dauerSek != null ? ` für ${dauerSek} s` : " (unbefristet)"}`
      : `${einheit}-Limit aufgehoben`,
    wert: limit.wert, dauerSek: limit.dauerSek,
  });
}

// Failsafe-Werte wurden von der Steuerbox gesetzt.
export function applyIncomingFailsafe(useCase: EebusUseCase, wert: number, dauerSek: number): void {
  const fs: EebusFailsafe = { wert: Math.max(0, wert), dauerSek: Math.max(0, dauerSek) };
  if (useCase === "lpc") state.lpcFailsafe = fs; else state.lppFailsafe = fs;
  state.letzterKontakt = new Date().toISOString();
  addLog({ useCase, art: "failsafe", text: `Failsafe gesetzt: ${fs.wert} W / ${fs.dauerSek} s`, wert: fs.wert, dauerSek: fs.dauerSek });
}

// Heartbeat der Steuerbox empfangen.
export function applyIncomingHeartbeat(): void {
  const jetzt = new Date().toISOString();
  state.heartbeatOk = true;
  state.letzterHeartbeat = jetzt;
  state.letzterKontakt = jetzt;
  if (state.failsafeAktiv) { state.failsafeAktiv = false; addLog({ useCase: "system", art: "info", text: "Kommunikation wiederhergestellt – Failsafe verlassen" }); }
}

// Verbindungsstatus vom Transport-Adapter.
export function setConnectionState(verbunden: boolean, steuerboxSki?: string | null): void {
  if (verbunden !== state.verbunden) {
    addLog({ useCase: "system", art: "verbindung", text: verbunden ? "Mit Steuerbox verbunden" : "Verbindung zur Steuerbox getrennt" });
  }
  state.verbunden = verbunden;
  if (steuerboxSki !== undefined) state.steuerboxSki = steuerboxSki;
  if (!verbunden) state.heartbeatOk = false;
}

// Eigener SKI (von der Identität des Transport-Adapters/Sidecars gemeldet).
export function setEigenerSki(ski: string | null): void {
  if (ski && ski !== state.eigenerSki) {
    state.eigenerSki = ski;
    addLog({ useCase: "system", art: "info", text: `Eigener SKI gemeldet: ${ski}` });
  }
}

// Adresse des Sidecar-HTTP-Interface (für Konfig-Weitergabe/Statusabfrage).
let sidecarHttp = "http://127.0.0.1:4721";
export function getSidecarHttp(): string { return sidecarHttp; }
export function setSidecarHttp(url: string): void { if (url) sidecarHttp = url; }

// Wird periodisch aufgerufen: prüft ablaufende Limits und Heartbeat-Timeout.
export function tickEebus(): void {
  if (!state.enabled) return;
  const jetzt = Date.now();
  // Abgelaufene, befristete Limits deaktivieren.
  for (const uc of ["lpc", "lpp"] as EebusUseCase[]) {
    const l = uc === "lpc" ? state.lpc : state.lpp;
    if (l.aktiv && l.gueltigBis && new Date(l.gueltigBis).getTime() <= jetzt) {
      const einheit = uc === "lpc" ? "Bezug" : "Einspeisung";
      const neu: EebusLimit = { ...LEER_LIMIT };
      if (uc === "lpc") state.lpc = neu; else state.lpp = neu;
      if (uc === "lpp") meldeLpp(false, 0);
      meldeLimitFlanke(uc, false, 0, null);
      addLog({ useCase: uc, art: "limit", text: `${einheit}-Limit abgelaufen und aufgehoben` });
    }
  }
  // Heartbeat-Timeout: wenn verbunden, aber lange kein Heartbeat -> Failsafe.
  if (state.verbunden && state.letzterHeartbeat) {
    const alter = jetzt - new Date(state.letzterHeartbeat).getTime();
    if (alter > 5 * 60 * 1000 && !state.failsafeAktiv) {
      state.failsafeAktiv = true;
      state.heartbeatOk = false;
      addLog({ useCase: "system", art: "failsafe", text: "Heartbeat-Timeout – Failsafe aktiv" });
    }
  }
}

// --- Simulator (für Tests ohne echte Steuerbox) ---
// Erlaubt es, über die UI Steuerbefehle einzuspielen, um Anzeige und Logging zu
// prüfen. Nutzt exakt dieselbe interne Empfangsschnittstelle wie ein echter
// Transport-Adapter.
export function simulateEvent(kind: string, useCase: EebusUseCase, wert: number, dauerSek: number | null): void {
  switch (kind) {
    case "limit": applyIncomingLimit(useCase, true, wert, dauerSek); break;
    case "release": applyIncomingLimit(useCase, false, 0, null); break;
    case "failsafe": applyIncomingFailsafe(useCase, wert, dauerSek ?? 7200); break;
    case "heartbeat": applyIncomingHeartbeat(); break;
    case "connect": setConnectionState(true, state.steuerboxSki); break;
    case "disconnect": setConnectionState(false); break;
    default: break;
  }
}

// Persistenz: Zustand (Config-Teil) laden/speichern über Settings.
export function serializeEebusConfig(): string {
  return JSON.stringify({
    enabled: state.enabled,
    steuerboxSki: state.steuerboxSki,
    eigenerSki: state.eigenerSki,
    lpcFailsafe: state.lpcFailsafe,
    lppFailsafe: state.lppFailsafe,
  });
}
export function loadEebusConfig(raw: string | null): void {
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") {
      state.enabled = !!p.enabled;
      state.steuerboxSki = p.steuerboxSki ?? null;
      state.eigenerSki = p.eigenerSki ?? null;
      if (p.lpcFailsafe) state.lpcFailsafe = { wert: Number(p.lpcFailsafe.wert) || 0, dauerSek: Number(p.lpcFailsafe.dauerSek) || 7200 };
      if (p.lppFailsafe) state.lppFailsafe = { wert: Number(p.lppFailsafe.wert) || 0, dauerSek: Number(p.lppFailsafe.dauerSek) || 7200 };
    }
  } catch { /* ignore */ }
}
