// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Vallox-Lüftungsanlage über valloxesp (kotope) – MQTT-basiert.
//
// Topics (Basis konfigurierbar, Default "vallox"):
//   <basis>/state  – dynamische Werte als JSON (on/off, Stufe, Modus, ...)
//   <basis>/temp   – Temperaturen als JSON (outside/inside/incoming/exhaust)
//   <basis>/set    – Steuerkommandos als JSON
//
// Da das exakte JSON-Feldformat je valloxesp-Version leicht variieren kann, ist
// das Parsing bewusst tolerant (mehrere plausible Feldnamen werden akzeptiert).
// Steuerung: es wird ein JSON-Kommando auf <basis>/set publiziert.

import { getLastPayload, publishLocal } from "./mqttbroker.js";
import { subscribeExternal, getExternalPayload, publishExternal } from "./mqttExtClient.js";

export interface ValloxState {
  ok: boolean;
  error?: string;
  on?: boolean;
  speed?: number;
  mode?: string;
  heating?: boolean;
  fault?: boolean;
  serviceNeeded?: boolean;
  tempOutside?: number;
  tempInside?: number;
  tempIncoming?: number;
  tempExhaust?: number;
  heatTarget?: number;
}

export const VALLOX_SPEED_MIN = 1;
export const VALLOX_SPEED_MAX = 8;

export interface ValloxMqttCfg {
  extern?: boolean;
  host?: string;
  port?: number;
  topic: string;   // Basis-Topic, Default "vallox"
}

function holePayload(cfg: ValloxMqttCfg, subtopic: string): string | undefined {
  const topic = `${cfg.topic}/${subtopic}`;
  if (cfg.extern && cfg.host) return getExternalPayload(cfg.host, cfg.port ?? 1883, topic);
  return getLastPayload(topic);
}
function publish(cfg: ValloxMqttCfg, subtopic: string, payload: string): boolean {
  const topic = `${cfg.topic}/${subtopic}`;
  if (cfg.extern && cfg.host) return publishExternal(cfg.host, cfg.port ?? 1883, topic, payload);
  return publishLocal(topic, payload);
}
export function ensureSubscribed(cfg: ValloxMqttCfg): void {
  if (cfg.extern && cfg.host) {
    subscribeExternal(cfg.host, cfg.port ?? 1883, `${cfg.topic}/state`);
    subscribeExternal(cfg.host, cfg.port ?? 1883, `${cfg.topic}/temp`);
  }
}

// Tolerante Feld-Helfer: probiert mehrere mögliche Feldnamen.
function feld(obj: any, ...namen: string[]): any {
  for (const n of namen) if (obj[n] != null) return obj[n];
  return undefined;
}
function alsBool(v: any): boolean | undefined {
  if (v == null) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (s === "1" || s === "true" || s === "on") return true;
  if (s === "0" || s === "false" || s === "off") return false;
  return undefined;
}
function alsNum(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function readValloxState(cfg: ValloxMqttCfg): ValloxState {
  ensureSubscribed(cfg);
  const stateRaw = holePayload(cfg, "state");
  const tempRaw = holePayload(cfg, "temp");
  if (stateRaw == null && tempRaw == null) return { ok: false, error: "Noch keine MQTT-Daten empfangen" };
  const st: ValloxState = { ok: true };
  try {
    if (stateRaw) {
      const s = JSON.parse(stateRaw);
      st.on = alsBool(feld(s, "on", "power", "state"));
      st.speed = alsNum(feld(s, "speed", "fanspeed", "fan_speed", "fan"));
      const m = feld(s, "mode");
      if (m != null) st.mode = String(m);
      st.heating = alsBool(feld(s, "heating", "heat"));
      st.fault = alsBool(feld(s, "fault", "error"));
      st.serviceNeeded = alsBool(feld(s, "service_needed", "serviceNeeded", "service"));
      st.heatTarget = alsNum(feld(s, "heat_target", "heatTarget", "target"));
      // Temperaturen können auch im state stecken.
      st.tempOutside = alsNum(feld(s, "temp_outside", "tempOutside", "t_outside", "outside"));
      st.tempInside = alsNum(feld(s, "temp_inside", "tempInside", "t_inside", "inside"));
      st.tempIncoming = alsNum(feld(s, "temp_incoming", "tempIncoming", "t_incoming", "incoming"));
      st.tempExhaust = alsNum(feld(s, "temp_exhaust", "tempExhaust", "t_exhaust", "exhaust"));
    }
  } catch { /* state unlesbar */ }
  try {
    if (tempRaw) {
      // temp-Topic: JSON mit temp_outside/temp_inside/temp_incoming/temp_exhaust
      // (bestätigt aus echten Daten). Zusätzlich tolerant für Varianten.
      const t = tempRaw.trim();
      if (t.startsWith("{")) {
        const o = JSON.parse(t);
        st.tempOutside = st.tempOutside ?? alsNum(feld(o, "temp_outside", "outside", "t_outside"));
        st.tempInside = st.tempInside ?? alsNum(feld(o, "temp_inside", "inside", "t_inside"));
        st.tempIncoming = st.tempIncoming ?? alsNum(feld(o, "temp_incoming", "incoming", "t_incoming"));
        st.tempExhaust = st.tempExhaust ?? alsNum(feld(o, "temp_exhaust", "exhaust", "t_exhaust"));
      }
    }
  } catch { /* temp unlesbar */ }
  return st;
}

// --- Steuerung: JSON-Kommando auf <basis>/set publizieren ---
// valloxesp (kotope) erwartet JSON. Bestätigte Felder aus der Firmware:
//   {"speed": 1..8}         – Lüfterstufe
//   {"mode": "FAN"|"HEAT"}  – Modus (schaltet das Gerät zugleich ein)
//   {"on": true/false}      – falls von der Firmware unterstützt
// Ein-/Ausschalten: Die valloxesp-Firmware unterstützt das Ausschalten per MQTT
// nur eingeschränkt. Wir senden {"on": ...}; greift das nicht, kann über den
// Modus ein-/ausgeschaltet werden.
export function valloxSetPower(cfg: ValloxMqttCfg, on: boolean): { ok: boolean; error?: string } {
  const ok = publish(cfg, "set", JSON.stringify({ on }));
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function valloxSetSpeed(cfg: ValloxMqttCfg, speed: number): { ok: boolean; error?: string } {
  const s = Math.max(VALLOX_SPEED_MIN, Math.min(VALLOX_SPEED_MAX, Math.round(speed)));
  const ok = publish(cfg, "set", JSON.stringify({ speed: s }));
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function valloxSetMode(cfg: ValloxMqttCfg, mode: string): { ok: boolean; error?: string } {
  const ok = publish(cfg, "set", JSON.stringify({ mode }));
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}

// --- Zustands-Speicher je Vallox-Quelle ---
const states = new Map<string, ValloxState>();
export function setValloxState(sourceId: string, st: ValloxState): void { states.set(sourceId, st); }
export function getValloxState(sourceId: string): ValloxState | undefined { return states.get(sourceId); }
export function getAllValloxStates(): Array<ValloxState & { sourceId: string }> {
  const out: Array<ValloxState & { sourceId: string }> = [];
  for (const [sid, st] of states) out.push({ ...st, sourceId: sid });
  return out;
}
