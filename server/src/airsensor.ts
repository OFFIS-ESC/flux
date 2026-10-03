// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Luftmess-Sensor (Feinstaub PM2.5/PM10, Temperatur, Luftdruck).
//
// Liefert über lokale HTTP-API:
//   /api/data   – Messwerte { timestamp, pm25, pm10, temperature, pressure }
//   /api/status – Systemstatus { status, uptime, bmp085, sds011, sds_warmup, ... }

import http from "node:http";

export interface AirState {
  ok: boolean;
  error?: string;
  pm25?: number;         // µg/m³
  pm10?: number;         // µg/m³
  temperature?: number;  // °C
  pressure?: number;     // hPa
  messTs?: number;       // Unix-Zeitstempel der Messung
  // Systemstatus
  systemOk?: boolean;
  uptimeSek?: number;
  bmp085?: boolean;      // Drucksensor vorhanden/ok
  sds011?: boolean;      // Feinstaubsensor vorhanden/ok
  sdsWarmup?: boolean;   // Feinstaubsensor in Aufwärmphase
  lastSdsAge?: number;   // Sekunden seit letzter Feinstaub-Messung
}

export interface AirConfig { host: string; }

function airGet(host: string, pfad: string, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: 80, path: pfad, method: "GET", timeout: timeoutMs }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve(t));
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.end();
  });
}

function num(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function pollAir(cfg: AirConfig): Promise<AirState> {
  if (!cfg.host) return { ok: false, error: "Host fehlt" };
  try {
    const [dataRaw, statusRaw] = await Promise.all([
      airGet(cfg.host, "/api/data").catch(() => ""),
      airGet(cfg.host, "/api/status").catch(() => ""),
    ]);
    if (!dataRaw && !statusRaw) return { ok: false, error: "Sensor nicht erreichbar" };
    if (dataRaw.trim().startsWith("<") || statusRaw.trim().startsWith("<")) {
      return { ok: false, error: "HTML statt JSON (Adresse prüfen)" };
    }
    const st: AirState = { ok: true };
    try {
      if (dataRaw) {
        const d = JSON.parse(dataRaw);
        st.pm25 = num(d.pm25);
        st.pm10 = num(d.pm10);
        st.temperature = num(d.temperature);
        st.pressure = num(d.pressure);
        st.messTs = num(d.timestamp);
      }
    } catch { /* data unlesbar */ }
    try {
      if (statusRaw) {
        const s = JSON.parse(statusRaw);
        st.systemOk = s.status === "ok";
        st.uptimeSek = num(s.uptime);
        st.bmp085 = s.bmp085 === true;
        st.sds011 = s.sds011 === true;
        st.sdsWarmup = s.sds_warmup === true;
        st.lastSdsAge = num(s.last_sds_age);
      }
    } catch { /* status optional */ }
    return st;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Abruf fehlgeschlagen" };
  }
}

// --- Zustands-Speicher je Luftsensor-Quelle ---
const states = new Map<string, AirState>();
export function setAirState(sourceId: string, st: AirState): void { states.set(sourceId, st); }
export function getAirState(sourceId: string): AirState | undefined { return states.get(sourceId); }
export function getAllAirStates(): Array<AirState & { sourceId: string }> {
  const out: Array<AirState & { sourceId: string }> = [];
  for (const [sid, st] of states) out.push({ ...st, sourceId: sid });
  return out;
}
