// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Elektroauto-Ladung über evcc (https://evcc.io) via REST-API.
// Liest den Live-Zustand (/api/state) und steuert Lademodus und Ladelimit.
// Die Ladehistorie (/api/sessions) wird in Schritt 2 ergänzt.

import http from "node:http";

export interface EvccConfig { host: string; loadpoint?: number; }

export interface EvccState {
  ok: boolean;
  error?: string;
  // Loadpoint-Status
  title?: string;            // Ladepunkt-Name
  mode?: string;             // "off" | "pv" | "minpv" | "now" (bzw. "smart")
  connected?: boolean;       // Fahrzeug verbunden?
  charging?: boolean;        // lädt gerade?
  chargePower?: number;      // aktuelle Ladeleistung (W)
  chargedEnergy?: number;    // in dieser Sitzung geladen (Wh)
  sessionEnergy?: number;    // Sitzungsenergie (Wh)
  vehicleSoc?: number;       // Fahrzeug-Ladestand (%)
  vehicleRange?: number;     // Reichweite (km)
  vehicleTitle?: string;     // Fahrzeugname
  limitSoc?: number;         // Ladelimit (%)
  phasesActive?: number;     // aktive Phasen
  phasesConfigured?: number; // konfigurierte Phasen (0=auto, 1, 3)
  minCurrent?: number;       // A
  maxCurrent?: number;       // A
  chargeDuration?: number;   // Ladedauer (s)
  chargeRemainingDuration?: number; // Restdauer (s)
}

function httpGetJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { reject(new Error("Ungültige evcc-Antwort")); } });
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
  });
}

function httpPost(url: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", timeout: timeoutMs }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { if ((res.statusCode ?? 500) < 400) resolve(); else reject(new Error(`HTTP ${res.statusCode}: ${b.slice(0, 120)}`)); });
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.end();
  });
}

function baseUrl(cfg: EvccConfig): string {
  let h = (cfg.host || "").trim().replace(/\/+$/, "");
  if (!h.includes("://")) h = `http://${h}`;
  return h;
}
function num(v: any): number | undefined { if (v == null) return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }

// Live-Zustand des konfigurierten Ladepunkts abrufen.
export async function readEvccState(cfg: EvccConfig): Promise<EvccState> {
  try {
    const j = await httpGetJson(`${baseUrl(cfg)}/api/state`);
    const lpIdx = (cfg.loadpoint ?? 1) - 1; // API-Array ist 0-basiert
    const lps = j?.loadpoints ?? j?.result?.loadpoints ?? [];
    const lp = Array.isArray(lps) ? lps[lpIdx] : undefined;
    if (!lp) return { ok: false, error: "Ladepunkt nicht gefunden" };
    // chargeDuration/chargeRemainingDuration sind in Nanosekunden.
    const nsToS = (v: any) => { const n = num(v); return n != null ? Math.round(n / 1e9) : undefined; };
    return {
      ok: true,
      title: lp.title,
      mode: lp.mode,
      connected: !!lp.connected,
      charging: !!lp.charging,
      chargePower: num(lp.chargePower),
      chargedEnergy: num(lp.chargedEnergy),
      sessionEnergy: num(lp.sessionEnergy),
      vehicleSoc: num(lp.vehicleSoc),
      vehicleRange: num(lp.vehicleRange),
      vehicleTitle: lp.vehicleTitle || lp.vehicleName,
      limitSoc: (() => {
        // effectiveLimitSoc ist das tatsächlich wirksame Limit (z. B. vom Fahrzeug).
        // limitSoc kann 0 sein ("kein Ladepunkt-Limit"), obwohl effektiv 85 gilt.
        // Daher: erst effektives Limit, dann Ladepunkt-Limit; 0/undefined ignorieren.
        const eff = num(lp.effectiveLimitSoc);
        const lim = num(lp.limitSoc);
        if (eff != null && eff > 0) return eff;
        if (lim != null && lim > 0) return lim;
        return undefined;
      })(),
      phasesActive: num(lp.phasesActive),
      phasesConfigured: num(lp.phasesConfigured),
      minCurrent: num(lp.minCurrent),
      maxCurrent: num(lp.maxCurrent),
      chargeDuration: nsToS(lp.chargeDuration),
      chargeRemainingDuration: nsToS(lp.chargeRemainingDuration),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "evcc-Abruf fehlgeschlagen" };
  }
}

// Lademodus setzen: "off" | "pv" | "minpv" | "now".
export async function evccSetMode(cfg: EvccConfig, mode: string): Promise<{ ok: boolean; error?: string }> {
  const lp = cfg.loadpoint ?? 1;
  const erlaubt = ["off", "pv", "minpv", "now"];
  if (!erlaubt.includes(mode)) return { ok: false, error: "Ungültiger Modus" };
  try { await httpPost(`${baseUrl(cfg)}/api/loadpoints/${lp}/mode/${mode}`); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message ?? "Modus setzen fehlgeschlagen" }; }
}

// Ladelimit (Ziel-SoC) in Prozent setzen.
export async function evccSetLimitSoc(cfg: EvccConfig, soc: number): Promise<{ ok: boolean; error?: string }> {
  const lp = cfg.loadpoint ?? 1;
  const s = Math.max(0, Math.min(100, Math.round(soc)));
  try { await httpPost(`${baseUrl(cfg)}/api/loadpoints/${lp}/limitsoc/${s}`); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message ?? "Limit setzen fehlgeschlagen" }; }
}

// Ladestrom-Untergrenze (A) setzen.
export async function evccSetMinCurrent(cfg: EvccConfig, ampere: number): Promise<{ ok: boolean; error?: string }> {
  const lp = cfg.loadpoint ?? 1;
  const a = Math.max(1, Math.min(64, Math.round(ampere)));
  try { await httpPost(`${baseUrl(cfg)}/api/loadpoints/${lp}/mincurrent/${a}`); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message ?? "Min-Strom setzen fehlgeschlagen" }; }
}
// Ladestrom-Obergrenze (A) setzen.
export async function evccSetMaxCurrent(cfg: EvccConfig, ampere: number): Promise<{ ok: boolean; error?: string }> {
  const lp = cfg.loadpoint ?? 1;
  const a = Math.max(1, Math.min(64, Math.round(ampere)));
  try { await httpPost(`${baseUrl(cfg)}/api/loadpoints/${lp}/maxcurrent/${a}`); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message ?? "Max-Strom setzen fehlgeschlagen" }; }
}
// Phasen setzen (0=automatisch, 1=einphasig, 3=dreiphasig).
export async function evccSetPhases(cfg: EvccConfig, phasen: number): Promise<{ ok: boolean; error?: string }> {
  const lp = cfg.loadpoint ?? 1;
  const p = phasen === 1 ? 1 : phasen === 3 ? 3 : 0;
  try { await httpPost(`${baseUrl(cfg)}/api/loadpoints/${lp}/phases/${p}`); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message ?? "Phasen setzen fehlgeschlagen" }; }
}

// Zustände aller evcc-Quellen zwischenspeichern (für die Seite/Kachel).
const states = new Map<string, EvccState>();
export function setEvccState(sourceId: string, st: EvccState): void { states.set(sourceId, st); }
export function getEvccState(sourceId: string): EvccState | undefined { return states.get(sourceId); }
export function getAllEvccStates(): Array<EvccState & { sourceId: string }> {
  return [...states.entries()].map(([sourceId, st]) => ({ ...st, sourceId }));
}

export interface EvccSession {
  created: string;          // Ladebeginn (ISO)
  finished: string;         // Ladeende (ISO)
  loadpoint: string;
  vehicle: string;
  chargedEnergy: number;    // kWh
  chargeDurationS?: number; // Sekunden
  solarPercentage?: number; // %
  price?: number;           // Kosten (Währung)
  avgPowerW?: number;       // berechnete Durchschnittsleistung
}

// Alle Ladevorgänge von evcc abrufen. evcc liefert chargeDuration in Nanosekunden.
export async function readEvccSessions(cfg: EvccConfig): Promise<{ ok: boolean; error?: string; sessions: EvccSession[] }> {
  try {
    const j = await httpGetJson(`${baseUrl(cfg)}/api/sessions`);
    const arr: any[] = Array.isArray(j) ? j : (j?.result ?? []);
    const sessions: EvccSession[] = arr.map((s) => {
      const durNs = num(s.chargeDuration);
      const durS = durNs != null ? Math.round(durNs / 1e9) : undefined;
      const kwh = num(s.chargedEnergy) ?? 0;
      const avgPowerW = durS && durS > 0 ? Math.round((kwh * 1000) / (durS / 3600)) : undefined;
      return {
        created: String(s.created ?? ""),
        finished: String(s.finished ?? ""),
        loadpoint: String(s.loadpoint ?? ""),
        vehicle: String(s.vehicle ?? ""),
        chargedEnergy: kwh,
        chargeDurationS: durS,
        solarPercentage: num(s.solarPercentage),
        price: num(s.price),
        avgPowerW,
      };
    }).filter((s) => s.chargedEnergy > 0);
    return { ok: true, sessions };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "evcc-Sessions-Abruf fehlgeschlagen", sessions: [] };
  }
}
