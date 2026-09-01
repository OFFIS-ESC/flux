// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Schalten von Shelly-Relais-Ausgängen (für Automatisierungsregeln).
//
// Gen2/Gen3 (Plus, Pro, Plug S/Plug M, Pro 2PM): RPC-Endpoint
//   http://<ip>/rpc/Switch.Set?id=<kanal>&on=<true|false>
// Gen1 (ältere): http://<ip>/relay/<kanal>?turn=<on|off>
// Wir versuchen zuerst den RPC-Weg (verbreitet bei den hier genutzten Geräten)
// und fallen bei Bedarf auf Gen1 zurück.

import * as db from "./db.js";
import type { SourceConfig } from "./sources.js";
import { httpGetText, httpGetJson } from "./httpClient.js";

// Extrahiert die Basis-URL (scheme://host[:port]) aus einer beliebigen URL.
function baseFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    // evtl. nur "192.168.x.x" ohne Schema
    const m = url.match(/^([\w.-]+(?::\d+)?)/);
    return m ? `http://${m[1]}` : null;
  }
}

function switchBase(src: SourceConfig): string | null {
  if (src.switchUrl && src.switchUrl.trim()) return baseFromUrl(src.switchUrl.trim());
  return baseFromUrl(src.url);
}

// Ermittelt den zu schaltenden Kanal (0-basiert) einer Quelle. Der Kanal steckt
// bereits im JSON-Pfad der ausgelesenen Felder: "switch:1.apower" -> Kanal 1,
// "relay/0" -> Kanal 0, "em:0…" -> Kanal 0. Steht kein Kanal im Pfad (Tasmota,
// Gen1-Shelly mit /meter), wird der Standardausgang 0 verwendet. Ein explizit
// gesetztes switchChannel-Feld hat Vorrang (manueller Override, i. d. R. unnötig).
export function resolveSwitchChannel(src: SourceConfig): number {
  if (typeof src.switchChannel === "number" && src.switchChannel >= 0) return src.switchChannel;
  for (const f of src.fields ?? []) {
    const m = f.jsonPath?.match(/(?:switch|relay|em|emeter)[:/](\d+)/i);
    if (m) return Number(m[1]);
  }
  return 0;
}

async function httpGet(url: string, timeoutMs = 4000): Promise<boolean> {
  // httpGetText schließt die Verbindung nach der Antwort (kein Keep-Alive) –
  // schont schwache Geräte (Shelly Gen1).
  try {
    await httpGetText(url, { timeoutMs, noCache: true });
    return true;
  } catch {
    return false;
  }
}

// Schaltet einen Kanal einer Quelle ein/aus. Liefert true bei Erfolg.
// Erkennt ein Tasmota-Gerät an seiner Abfrage-URL. Tasmota nutzt den
// Kommando-Endpoint /cm?cmnd=... (z. B. "status 10") statt der Shelly-Pfade.
function isTasmota(src: SourceConfig): boolean {
  const u = (src.switchUrl || src.url || "").toLowerCase();
  return u.includes("/cm?cmnd=") || u.includes("/cm?user=");
}

// Baut den Tasmota-Relaisnamen: Kanal 0 -> "Power" (bzw. "Power1"), Kanal n -> "Power<n+1>".
function tasmotaPower(channel: number): string {
  return channel > 0 ? `Power${channel + 1}` : "Power";
}

export async function switchSource(src: SourceConfig, channel: number, on: boolean): Promise<boolean> {
  const base = switchBase(src);
  if (!base) {
    db.addLog(db.LOG_LEVELS.warn, "switch", `${src.id}: keine Schalt-Adresse`);
    return false;
  }
  // Tasmota-Geräte: HTTP-Kommando /cm?cmnd=Power[n] On|Off
  if (isTasmota(src)) {
    const cmd = `${tasmotaPower(channel)} ${on ? "On" : "Off"}`;
    const tUrl = `${base}/cm?cmnd=${encodeURIComponent(cmd)}`;
    if (await httpGet(tUrl)) {
      db.addLog(db.LOG_LEVELS.info, "switch", `${src.id} Kanal ${channel} -> ${on ? "AN" : "AUS"} (Tasmota)`);
      return true;
    }
    db.addLog(db.LOG_LEVELS.warn, "switch", `${src.id} Kanal ${channel}: Tasmota-Schalten fehlgeschlagen`);
    return false;
  }
  // Gen2/3 RPC zuerst
  const rpcUrl = `${base}/rpc/Switch.Set?id=${channel}&on=${on ? "true" : "false"}`;
  if (await httpGet(rpcUrl)) {
    db.addLog(db.LOG_LEVELS.info, "switch", `${src.id} Kanal ${channel} -> ${on ? "AN" : "AUS"} (RPC)`);
    return true;
  }
  // Gen1-Fallback
  const g1 = `${base}/relay/${channel}?turn=${on ? "on" : "off"}`;
  if (await httpGet(g1)) {
    db.addLog(db.LOG_LEVELS.info, "switch", `${src.id} Kanal ${channel} -> ${on ? "AN" : "AUS"} (Gen1)`);
    return true;
  }
  db.addLog(db.LOG_LEVELS.warn, "switch", `${src.id} Kanal ${channel}: Schalten fehlgeschlagen`);
  return false;
}

// Extrahiert den Ein/Aus-Zustand eines Kanals aus einem beliebigen Shelly/
// Tasmota-Statusdokument. Deckt die gängigen Formate ab, damit der Zustand aus
// dem ohnehin gepollten Dokument abgeleitet werden kann (ohne Extra-Request).
function extractSwitchState(doc: any, channel: number): boolean | null {
  if (!doc || typeof doc !== "object") return null;
  // Gen2/3: { "switch:0": { output: true, ... } }
  const sw = doc[`switch:${channel}`];
  if (sw && typeof sw.output === "boolean") return sw.output;
  // Gen1 Gesamtstatus: { relays: [ { ison: true }, ... ] }
  if (Array.isArray(doc.relays) && doc.relays[channel] && typeof doc.relays[channel].ison === "boolean") {
    return doc.relays[channel].ison;
  }
  // Gen1 einzelner Relay-Endpunkt: { ison: true }
  if (typeof doc.ison === "boolean") return doc.ison;
  // Gen2 einzelner Switch-Endpunkt: { output: true }
  if (typeof doc.output === "boolean") return doc.output;
  // Tasmota: { POWER: "ON" } oder { POWER1: "OFF" }
  const tKey = channel > 0 ? `POWER${channel + 1}` : "POWER";
  const tVal = doc[tKey] ?? doc.POWER;
  if (typeof tVal === "string") return tVal.toUpperCase() === "ON";
  return null;
}

// Liest den aktuellen Ein/Aus-Zustand eines Kanals aus (für "umschalten" und die
// Zustandsanzeige). Leitet den Zustand bevorzugt aus dem Dokument ab, das der
// Poller ohnehin holt (exakte Poll-URL -> Cache-Hit, KEIN Extra-Request). Nur
// wenn das nichts liefert, werden spezifische Endpunkte als Fallback probiert.
export async function getSwitchState(src: SourceConfig, channel: number): Promise<boolean | null> {
  const base = switchBase(src);
  if (!base) return null;
  // WICHTIG für schwache/abstürzende Geräte (Shelly Pro 2PM, 2.5, Plug M,
  // 1PM Mini Gen3): KEINEN separaten Status-Request feuern. Mehrere parallele
  // Zugriffe (Poll + Kachel + Regel-Aktionsstatus) auf dasselbe Gerät waren die
  // Ursache dafür, dass sie ihre Netzwerkverbindung verloren.
  const readCached = async (url: string): Promise<any | null> => {
    try {
      // maxAgeMs großzügig, damit der zuletzt vom Poller geholte Gerätestatus
      // wiederverwendet wird. timeoutMs bewusst kurz: Liegt nichts im Cache und
      // ist das Gerät nicht erreichbar, soll der Fallback schnell aufgeben statt
      // mehrere lange (4 s) Requests pro Auswertung anzustauen.
      return await httpGetJson(url, { timeoutMs: 1500, maxAgeMs: 8000 });
    } catch {
      return null;
    }
  };

  // 1) Bevorzugt die EXAKTE Poll-URL der Quelle abfragen. Wird das Gerät als
  //    Quelle gepollt, liegt genau diese Antwort im Cache -> kein neuer Request.
  //    Der Zustand wird aus dem gepollten Dokument extrahiert.
  const hasPollUrl = !!(src.url && src.url.trim());
  if (hasPollUrl) {
    const polled = await readCached(src.url!.trim());
    const st = extractSwitchState(polled, channel);
    if (st != null) return st;
    // Wird die Quelle regulär gepollt, aber die Poll-URL liefert keinen (aktuellen)
    // Zustand, ist das Gerät praktisch offline. Dann NICHT noch mehrere weitere
    // Endpunkte durchprobieren (die alle in Timeouts laufen und sich aufstauen) –
    // außer bei Tasmota, dessen Schaltzustand über ein anderes Kommando kommt.
    if (polled == null && !isTasmota(src)) return null;
  }

  // 2) Tasmota: Schaltzustand über das Power-Kommando (cachebar).
  if (isTasmota(src)) {
    const powerKey = tasmotaPower(channel);
    const t = await readCached(`${base}/cm?cmnd=${encodeURIComponent(powerKey)}`);
    if (t) {
      const val = t[powerKey] ?? t.POWER ?? t[powerKey.toUpperCase()];
      if (typeof val === "string") return val.toUpperCase() === "ON";
    }
    return null;
  }

  // 3) Gen2/3-Gesamtstatus (identisch zur Poll-URL vieler Shellys -> Cache-Hit).
  const full = await readCached(`${base}/rpc/Shelly.GetStatus`);
  const fullSt = extractSwitchState(full, channel);
  if (fullSt != null) return fullSt;

  // 4) Gen1-Gesamtstatus.
  const g1status = await readCached(`${base}/status`);
  const g1st = extractSwitchState(g1status, channel);
  if (g1st != null) return g1st;

  // 5) Fallback: spezifische Endpunkte (nur wenn die Sammelstatus nichts gaben).
  const g2 = await readCached(`${base}/rpc/Switch.GetStatus?id=${channel}`);
  if (g2 && typeof g2.output === "boolean") return g2.output;
  const g1 = await readCached(`${base}/relay/${channel}`);
  if (g1 && typeof g1.ison === "boolean") return g1.ison;
  return null;
}
