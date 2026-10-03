// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Mitsubishi-Klimaanlage über mitsubishi2MQTT (MQTT-basiert).
//
// Der Zustand kommt über MQTT-Topics <basis>/settings und <basis>/state; die
// Steuerung erfolgt durch Publizieren auf <basis>/power/set, /mode/set,
// /temp/set, /fan/set, /vane/set, /wideVane/set.
//
// Standardmäßig wird der eingebaute lokale Broker (Port 1883) genutzt; optional
// ein externer Broker (mqttExtern + mqttHost/mqttPort).

import { getLastPayload, publishLocal } from "./mqttbroker.js";
import { subscribeExternal, getExternalPayload, publishExternal } from "./mqttExtClient.js";

export interface AcState {
  ok: boolean;
  error?: string;
  power?: boolean;
  mode?: string;
  temp?: number;
  roomTemp?: number;
  fan?: string;
  vane?: string;
  wideVane?: string;
  action?: string;          // z.B. "cooling", "heating", "off", "idle"
  compressorFrequency?: number;
}

export const AC_TEMP_MIN = 16;
export const AC_TEMP_MAX = 31;
export const AC_MODES = ["AUTO", "HEAT", "COOL", "DRY", "FAN_ONLY"];
export const AC_FAN = ["AUTO", "QUIET", "1", "2", "3", "4"];
export const AC_VANE = ["AUTO", "SWING", "1", "2", "3", "4", "5"];

// MQTT-Konfiguration einer Klima-Quelle.
export interface AcMqttCfg {
  extern?: boolean;
  host?: string;
  port?: number;
  topic: string;   // Basis-Topic
}

// Payload eines Topics holen (lokal oder extern).
function holePayload(cfg: AcMqttCfg, subtopic: string): string | undefined {
  const topic = `${cfg.topic}/${subtopic}`;
  if (cfg.extern && cfg.host) return getExternalPayload(cfg.host, cfg.port ?? 1883, topic);
  return getLastPayload(topic);
}
// Publizieren (lokal oder extern).
function publish(cfg: AcMqttCfg, subtopic: string, payload: string): boolean {
  const topic = `${cfg.topic}/${subtopic}`;
  if (cfg.extern && cfg.host) return publishExternal(cfg.host, cfg.port ?? 1883, topic, payload);
  return publishLocal(topic, payload);
}

// Bei externem Broker die nötigen Topics abonnieren (idempotent). Für den lokalen
// Broker ist kein Abo nötig – er empfängt alles ohnehin.
export function ensureSubscribed(cfg: AcMqttCfg): void {
  if (cfg.extern && cfg.host) {
    subscribeExternal(cfg.host, cfg.port ?? 1883, `${cfg.topic}/settings`);
    subscribeExternal(cfg.host, cfg.port ?? 1883, `${cfg.topic}/state`);
  }
}

// Zustand aus den zuletzt empfangenen MQTT-Nachrichten zusammensetzen.
// settings: { power, mode, temperature, fan, vane, wideVane }
// state:    { roomTemperature, operating, ... }
export function readAcState(cfg: AcMqttCfg): AcState {
  ensureSubscribed(cfg);
  // Alle Zustandsfelder können in EINEM Topic kommen (bei mitsubishi2MQTT je
  // nach Version in state und/oder settings). Beide lesen und zusammenführen.
  const settingsRaw = holePayload(cfg, "settings");
  const stateRaw = holePayload(cfg, "state");
  if (settingsRaw == null && stateRaw == null) {
    return { ok: false, error: "Noch keine MQTT-Daten empfangen" };
  }
  const st: AcState = { ok: true };
  // Payloads parsen. state enthält die aktuellen Laufdaten und hat Vorrang;
  // settings dient nur als Ergänzung für Felder, die in state fehlen.
  let sState: any = {};
  let sSettings: any = {};
  try { if (stateRaw) sState = JSON.parse(stateRaw); } catch { /* ignore */ }
  try { if (settingsRaw) sSettings = JSON.parse(settingsRaw); } catch { /* ignore */ }
  // Zusammenführen: settings zuerst, dann state drüber (state gewinnt).
  const daten: any = { ...sSettings, ...sState };

  if (daten.mode != null) st.mode = String(daten.mode);
  if (daten.temperature != null) st.temp = Number(daten.temperature);
  if (daten.roomTemperature != null) st.roomTemp = Number(daten.roomTemperature);
  if (daten.fan != null) st.fan = String(daten.fan);
  if (daten.vane != null) st.vane = String(daten.vane);
  if (daten.wideVane != null) st.wideVane = String(daten.wideVane);
  if (daten.action != null) st.action = String(daten.action);
  if (daten.compressorFrequency != null) st.compressorFrequency = Number(daten.compressorFrequency);

  // power-Status: explizites power-Feld hat Vorrang, sonst aus mode ableiten
  // ("off" = aus, jeder andere Modus = an). Wichtig: den mode aus dem AKTUELLSTEN
  // vorhandenen Payload verwenden (state vor settings).
  const modeFuerPower = sState.mode != null ? String(sState.mode)
    : (sSettings.mode != null ? String(sSettings.mode) : st.mode);
  if (daten.power != null) {
    st.power = String(daten.power).toUpperCase() === "ON";
  } else if (modeFuerPower != null) {
    st.power = modeFuerPower.toLowerCase() !== "off";
  }
  return st;
}

// --- Steuerung (Publizieren) ---
export function acSetPower(cfg: AcMqttCfg, on: boolean, modusBeimEinschalten?: string): { ok: boolean; error?: string } {
  // Ein-/Ausschalten läuft bei mitsubishi2MQTT über den Modus (der Zustand wird
  // über "mode" abgebildet: mode=off bedeutet aus). Zum Ausschalten daher
  // mode/set off senden; zusätzlich power/set OFF als Absicherung. Zum
  // Einschalten einen aktiven Modus setzen (power/set ON ist unzuverlässig).
  if (!on) {
    const okMode = publish(cfg, "mode/set", "off");
    publish(cfg, "power/set", "OFF");
    return { ok: okMode, error: okMode ? undefined : "Publizieren fehlgeschlagen" };
  }
  const modus = modusBeimEinschalten && AC_MODES.includes(modusBeimEinschalten) ? modusBeimEinschalten : "COOL";
  const ok = publish(cfg, "mode/set", modus);
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function acSetMode(cfg: AcMqttCfg, mode: string): { ok: boolean; error?: string } {
  if (mode !== "OFF" && mode !== "ON" && !AC_MODES.includes(mode)) return { ok: false, error: "Ungültiger Modus" };
  const ok = publish(cfg, "mode/set", mode);
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function acSetTemp(cfg: AcMqttCfg, temp: number): { ok: boolean; error?: string } {
  const t = Math.max(AC_TEMP_MIN, Math.min(AC_TEMP_MAX, temp));
  const ok = publish(cfg, "temp/set", String(t));
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function acSetFan(cfg: AcMqttCfg, fan: string): { ok: boolean; error?: string } {
  if (!AC_FAN.includes(fan)) return { ok: false, error: "Ungültige Lüfterstufe" };
  const ok = publish(cfg, "fan/set", fan);
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function acSetVane(cfg: AcMqttCfg, vane: string): { ok: boolean; error?: string } {
  if (!AC_VANE.includes(vane)) return { ok: false, error: "Ungültige Lamellenstellung" };
  const ok = publish(cfg, "vane/set", vane);
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}
export function acSetWideVane(cfg: AcMqttCfg, wideVane: string): { ok: boolean; error?: string } {
  const ok = publish(cfg, "wideVane/set", wideVane);
  return { ok, error: ok ? undefined : "Publizieren fehlgeschlagen" };
}

// --- Zustands-Speicher je Klima-Quelle ---
const states = new Map<string, AcState>();
export function setAcState(sourceId: string, st: AcState): void { states.set(sourceId, st); }
export function getAcState(sourceId: string): AcState | undefined { return states.get(sourceId); }
export function getAllAcStates(): Array<AcState & { sourceId: string }> {
  const out: Array<AcState & { sourceId: string }> = [];
  for (const [sid, st] of states) out.push({ ...st, sourceId: sid });
  return out;
}
