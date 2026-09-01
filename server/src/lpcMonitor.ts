// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// §14a-Überwachung (LPC – Limitation of Power Consumption).
//
// Rein beobachtend: FLUX vergleicht die Summe der Momentanleistungen der
// steuerbaren Verbrauchseinrichtungen (SteuVE) gegen den per EEBUS empfangenen
// Bezugs-Sollwert (Watt). Der Sollwert kommt vom Netzbetreiber und enthält
// bereits alle Berechnungen (inkl. Gleichzeitigkeitsfaktor) – FLUX vergleicht
// also nur die gemessene Summe gegen diesen einen Wattwert. Es findet KEIN
// realer Eingriff statt; die Überwachung zeigt an, warnt und protokolliert.

import type { LpcMonitorConfig, SteuVe } from "./types.js";
import { log } from "./logger.js";

const DEFAULTS: LpcMonitorConfig = {
  enabled: false,
  steuve: [],
  warnschwelleProzent: 90,
};

let config: LpcMonitorConfig = { ...DEFAULTS };

// --- §14a-Mindestleistungsberechnung (EMS-Steuerung) ---
//
// Bei Steuerung über ein Energiemanagementsystem (EMS) übermittelt der
// Netzbetreiber im Steuerungsfall EINE gesamthafte Leistungsobergrenze für die
// Summe aller SteuVE. Diese Mindestleistung lässt sich vorab abschätzen nach der
// Formel der BNetzA-Festlegung BK6-22-300 (vgl. auch die von Verbraucherzentralen
// veröffentlichte Fassung):
//
//   Mindestleistung = 4,2 kW + (n − 1) × GZF × 4,2 kW
//
// mit n = Anzahl der SteuVE und GZF = Gleichzeitigkeitsfaktor. Der GZF ist von der
// BNetzA vorgegeben und hängt von der Anzahl der SteuVE ab (Staffelung unten).
// FLUX berechnet daraus einen ERWARTUNGSWERT, um ihn mit dem tatsächlich per EEBUS
// empfangenen Limit abzugleichen. Maßgeblich für die Steuerung bleibt allein der
// vom Netzbetreiber gesendete Wert; die Berechnung dient nur der Plausibilisierung.
const P_MIN_EINZEL_W = 4200; // garantierte Mindestbezugsleistung je SteuVE (4,2 kW)

// Gleichzeitigkeitsfaktor nach Anzahl der SteuVE (n). Werte gemäß BNetzA-Staffelung.
// Index = Anzahl; ab 9 gilt 0,45. Für n<=1 ist kein GZF nötig (nur 4,2 kW).
const GZF_TABELLE: Record<number, number> = {
  2: 0.8, 3: 0.75, 4: 0.7, 5: 0.65, 6: 0.6, 7: 0.55, 8: 0.5,
};
function gzfFuer(n: number): number {
  if (n <= 1) return 0;
  if (n >= 9) return 0.45;
  return GZF_TABELLE[n] ?? 0.45;
}

// Berechnet die erwartete §14a-Mindestleistung (W) für n SteuVE.
export function berechneteMindestleistungW(n: number): { w: number; gzf: number; formel: string } {
  if (n <= 0) return { w: 0, gzf: 0, formel: "keine SteuVE erfasst" };
  if (n === 1) return { w: P_MIN_EINZEL_W, gzf: 0, formel: "1 SteuVE → 4,2 kW (kein Gleichzeitigkeitsfaktor)" };
  const gzf = gzfFuer(n);
  const w = P_MIN_EINZEL_W + (n - 1) * gzf * P_MIN_EINZEL_W;
  const formel = `4,2 kW + (${n} − 1) × ${gzf.toString().replace(".", ",")} × 4,2 kW = ${(w / 1000).toFixed(2).replace(".", ",")} kW`;
  return { w: Math.round(w), gzf, formel };
}

// Ist-Leistungs-Provider (powerOf), von außen gesetzt (Zirkularität vermeiden).
let istLeistungProvider: ((sourceId: string) => number) | null = null;
export function setLpcIstLeistungProvider(fn: (sourceId: string) => number): void {
  istLeistungProvider = fn;
}
function istLeistung(sourceId: string): number {
  if (!sourceId || !istLeistungProvider) return 0;
  try { return istLeistungProvider(sourceId); } catch { return 0; }
}

export interface LpcMonitorLogEntry {
  ts: string;
  summeW: number;
  limitW: number;
  text: string;
}
const LOG_MAX = 200;
let logbuch: LpcMonitorLogEntry[] = [];
// Zustand der letzten Prüfung, um nur bei Statuswechsel zu protokollieren.
let letzterStatus: "ok" | "warnung" | "ueberschreitung" | null = null;

function addLog(summeW: number, limitW: number, text: string): void {
  logbuch.unshift({ ts: new Date().toISOString(), summeW, limitW, text });
  if (logbuch.length > LOG_MAX) logbuch = logbuch.slice(0, LOG_MAX);
  log.info("lpcmonitor", text);
}

export function getLpcMonitorConfig(): LpcMonitorConfig { return JSON.parse(JSON.stringify(config)); }
export function getLpcMonitorLog(limit = 100): LpcMonitorLogEntry[] { return logbuch.slice(0, Math.max(1, Math.min(limit, LOG_MAX))); }
export function setLpcMonitorConfig(patch: Partial<LpcMonitorConfig>): LpcMonitorConfig {
  config = { ...config, ...patch };
  if (!Array.isArray(config.steuve)) config.steuve = [];
  return getLpcMonitorConfig();
}
export function serializeLpcMonitorConfig(): string { return JSON.stringify(config); }
export function loadLpcMonitorConfig(raw: string | null): void {
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") { config = { ...DEFAULTS, ...p }; if (!Array.isArray(config.steuve)) config.steuve = []; }
  } catch { /* ignore */ }
}

// Momentaner Überwachungsstatus (für die Anzeige). Bekommt das aktuelle
// LPC-Limit übergeben (aktiv + Wattwert).
export interface LpcMonitorStatus {
  enabled: boolean;
  limitAktiv: boolean;
  limitW: number;
  summeW: number;
  auslastungProzent: number; // Summe / Limit * 100 (0 wenn kein Limit)
  status: "kein-limit" | "ok" | "warnung" | "ueberschreitung";
  einzel: Array<{ id: string; name: string; leistungW: number }>;
  anzahlSteuVe: number;            // Anzahl erfasster SteuVE
  berechnetesLimitW: number;       // erwartete §14a-Mindestleistung (W)
  berechnetGzf: number;            // verwendeter Gleichzeitigkeitsfaktor (0 = keiner)
  berechnetFormel: string;         // Klartext-Formel für die Anzeige
  abweichungBerechnetW: number | null; // empfangenes − berechnetes Limit (null wenn kein Limit)
}

export function getLpcMonitorStatus(limitAktiv: boolean, limitW: number): LpcMonitorStatus {
  const einzel = config.steuve.map((s) => ({ id: s.id, name: s.name, leistungW: Math.max(0, istLeistung(s.sourceId)) }));
  const summeW = einzel.reduce((a, e) => a + e.leistungW, 0);
  let status: LpcMonitorStatus["status"] = "kein-limit";
  let auslastung = 0;
  if (limitAktiv && limitW > 0) {
    auslastung = (summeW / limitW) * 100;
    if (summeW > limitW) status = "ueberschreitung";
    else if (auslastung >= config.warnschwelleProzent) status = "warnung";
    else status = "ok";
  }
  // Erwartete §14a-Mindestleistung aus Anzahl SteuVE + GZF (zum Abgleich mit dem
  // tatsächlich empfangenen Limit).
  const berechnet = berechneteMindestleistungW(config.steuve.length);
  // Abweichung zwischen berechnetem und empfangenem Limit (nur wenn Limit aktiv).
  const abweichungW = (limitAktiv && limitW > 0) ? Math.round(limitW - berechnet.w) : null;
  return {
    enabled: config.enabled, limitAktiv, limitW, summeW,
    auslastungProzent: Math.round(auslastung), status, einzel,
    anzahlSteuVe: config.steuve.length,
    berechnetesLimitW: berechnet.w,
    berechnetGzf: berechnet.gzf,
    berechnetFormel: berechnet.formel,
    abweichungBerechnetW: abweichungW,
  };
}

// Periodische Prüfung: protokolliert Statuswechsel (ok/Warnung/Überschreitung).
// Wird mit dem aktuellen LPC-Limit aufgerufen.
export function tickLpcMonitor(limitAktiv: boolean, limitW: number): void {
  if (!config.enabled) { letzterStatus = null; return; }
  const st = getLpcMonitorStatus(limitAktiv, limitW);
  if (!st.limitAktiv) { letzterStatus = null; return; }

  const neu = st.status === "kein-limit" ? "ok" : st.status;
  if (neu !== letzterStatus) {
    if (st.status === "ueberschreitung") {
      addLog(st.summeW, st.limitW, `Überschreitung: SteuVE-Bezug ${Math.round(st.summeW)} W über Limit ${st.limitW} W`);
    } else if (st.status === "warnung") {
      addLog(st.summeW, st.limitW, `Warnung: SteuVE-Bezug ${Math.round(st.summeW)} W nahe Limit ${st.limitW} W (${st.auslastungProzent} %)`);
    } else {
      addLog(st.summeW, st.limitW, `Bezug wieder im Rahmen: ${Math.round(st.summeW)} W von ${st.limitW} W`);
    }
    letzterStatus = neu as typeof letzterStatus;
  }
}
