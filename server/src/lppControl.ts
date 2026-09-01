// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Umsetzung der §9-Einspeisedrosselung (EEBUS-LPP) als Live-Regelung über
// mehrere Wechselrichter (Growatt-Stick mit OpenInverterGateway und/oder
// Hoymiles-Mikrowechselrichter über OpenDTU).
//
// PRINZIP: §9 begrenzt die Einspeiseleistung am Netzverknüpfungspunkt, nicht die
// Wechselrichter selbst. Eigenverbrauch bleibt erlaubt. FLUX regelt daher live:
//   - Ist kein Limit aktiv, laufen alle WR unbegrenzt (100%).
//   - Ist ein Limit aktiv, wird nur gedrosselt, wenn die tatsächliche
//     Netzeinspeisung die Grenze (minus Reserve) übersteigt.
//   - Gedrosselt wird entlang einer Prioritätsreihenfolge: der erste WR zuerst;
//     reicht dessen Drosselung nicht (0% erreicht), kommt der nächste dran.
//   - Sinkt die Einspeisung wieder (mehr Eigenverbrauch/weniger Sonne), werden
//     die WR in umgekehrter Reihenfolge wieder hochgeregelt.
//
// SICHERHEIT: Standardmäßig Dry-Run (scharf=false). Dann werden die berechneten
// Sollwerte nur protokolliert, nicht gesendet. Erst nach Scharfschalten werden
// echte Schreibbefehle an die Wechselrichter geschickt.

import type { LppControlConfig, LppInverter } from "./types.js";
import * as db from "./db.js";
import type { SourceConfig } from "./sources.js";
import { publishExtHemsMqtt } from "./mqttClient.js";
import { log } from "./logger.js";

// Provider für die gemessene Ist-Leistung je Quelle (powerOf). Wird von außen
// gesetzt (index.ts/poller), um eine Modul-Zirkularität zu vermeiden.
let istLeistungProvider: ((sourceId: string) => number) | null = null;
export function setIstLeistungProvider(fn: (sourceId: string) => number): void {
  istLeistungProvider = fn;
}
function istLeistung(sourceId: string | undefined): number {
  if (!sourceId || !istLeistungProvider) return 0;
  try { return Math.max(0, istLeistungProvider(sourceId)); } catch { return 0; }
}

// Erkennt aus den Quellen die steuerbaren Wechselrichter (nur PV-Erzeugung, die
// auf Growatt oder Hoymiles matcht). Liefert Vorschläge; vorhandene Konfiguration
// (Nennleistung, Zugang) wird beibehalten, wenn dieselbe sourceId schon geführt
// wird. Die OpenDTU-Gesamtquelle wird ignoriert (kein ?inv=, keine Einzelleistung).
export function erkenneInverterAusQuellen(sources: SourceConfig[]): LppInverter[] {
  const vorhanden = new Map(config.inverter.filter((i) => i.sourceId).map((i) => [i.sourceId!, i]));
  const ergebnis: LppInverter[] = [];
  for (const s of sources) {
    if (s.role !== "pv") continue;
    const felder = (s.fields ?? []).map((f) => f.jsonPath).join(" ");
    const istGrowatt = /OutputPower|ActivePowerRate/i.test(felder);
    // Hoymiles-Einzel-WR: OpenDTU-Quelle mit ?inv=<serial> und Power-Pfad je WR.
    const invMatch = /[?&]inv=([0-9]+)/i.exec(s.url ?? "");
    const istHoymiles = !!invMatch && /inverters\.\d+\.AC\.\d+\.Power/i.test(felder);
    if (!istGrowatt && !istHoymiles) continue;

    const alt = vorhanden.get(s.id);
    if (alt) { ergebnis.push({ ...alt, name: alt.name || s.label, autoErkannt: true }); continue; }

    if (istGrowatt) {
      // Stick-URL aus der Quellen-URL ableiten (Basis ohne Pfad).
      let httpUrl = "";
      try { const u = new URL(s.url); httpUrl = `${u.protocol}//${u.host}`; } catch { /* ignore */ }
      ergebnis.push({
        id: `lppwr_${s.id}`, name: s.label, typ: "growatt", nennleistungW: 0,
        sourceId: s.id, autoErkannt: true,
        kanal: "http", httpUrl, methode: "prozent", regProzent: 3, regMeterEnable: 122, regRate: 123,
      });
    } else {
      const serial = invMatch![1];
      let opendtuHttpUrl = "";
      try { const u = new URL(s.url); opendtuHttpUrl = `${u.protocol}//${u.host}`; } catch { /* ignore */ }
      ergebnis.push({
        id: `lppwr_${s.id}`, name: s.label, typ: "opendtu", nennleistungW: 0,
        sourceId: s.id, autoErkannt: true,
        opendtuKanal: "http", opendtuHttpUrl, opendtuSerial: serial,
      });
    }
  }
  return ergebnis;
}

const DEFAULTS: LppControlConfig = {
  enabled: false,
  scharf: false,
  inverter: [],
  persistent: false,
  reserveW: 100,
  regelIntervalSek: 10,
};

let config: LppControlConfig = { ...DEFAULTS };

// Aktueller LPP-Zustand (aus EEBUS): aktiv + Grenzwert in W.
let limitAktiv = false;
let limitW = 0;

// Aktuelle Soll-Prozente je WR-ID (0..100). Start: alle 100 (unbegrenzt).
let sollProzent = new Map<string, number>();
// Zuletzt tatsächlich gesendete Prozente (um unnötige Wiederholungen zu sparen).
let letztGesendet = new Map<string, number>();

export interface LppControlLogEntry {
  ts: string;
  scharf: boolean;
  text: string;
  fehler?: string;
}
const LOG_MAX = 200;
let logbuch: LppControlLogEntry[] = [];
// Beim Modulstart persistierte Einträge laden (überstehen jetzt Neustarts).
try {
  const geladen = db.loadEebusLog("lpp", LOG_MAX) as LppControlLogEntry[];
  if (Array.isArray(geladen) && geladen.length) logbuch = geladen;
} catch { /* DB evtl. noch nicht bereit – RAM-Puffer bleibt leer */ }

function addLog(e: Omit<LppControlLogEntry, "ts">): void {
  const entry: LppControlLogEntry = { ts: new Date().toISOString(), ...e };
  logbuch.unshift(entry);
  if (logbuch.length > LOG_MAX) logbuch = logbuch.slice(0, LOG_MAX);
  db.persistEebusLog("lpp", entry.ts, entry, LOG_MAX);
  log.info("lppcontrol", `${e.scharf ? "SCHARF" : "DRY"} ${e.text}${e.fehler ? " FEHLER: " + e.fehler : ""}`);
}

export function getLppControlConfig(): LppControlConfig { return JSON.parse(JSON.stringify(config)); }
export function getLppControlLog(limit = 100): LppControlLogEntry[] { return logbuch.slice(0, Math.max(1, Math.min(limit, LOG_MAX))); }
export function getLppRegelStatus(): { limitAktiv: boolean; limitW: number; sollProzent: Record<string, number> } {
  return { limitAktiv, limitW, sollProzent: Object.fromEntries(sollProzent) };
}

export function setLppControlConfig(patch: Partial<LppControlConfig>): LppControlConfig {
  config = { ...config, ...patch };
  if (patch.inverter) {
    // Soll-Prozente für neue WR initialisieren, alte entfernen.
    const ids = new Set(config.inverter.map((i) => i.id));
    for (const id of ids) if (!sollProzent.has(id)) sollProzent.set(id, 100);
    for (const id of [...sollProzent.keys()]) if (!ids.has(id)) { sollProzent.delete(id); letztGesendet.delete(id); }
  }
  return getLppControlConfig();
}
export function serializeLppControlConfig(): string { return JSON.stringify(config); }
export function loadLppControlConfig(raw: string | null): void {
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") {
      config = { ...DEFAULTS, ...p };
      if (!Array.isArray(config.inverter)) config.inverter = [];
      for (const inv of config.inverter) sollProzent.set(inv.id, 100);
    }
  } catch { /* ignore */ }
}

// Vom EEBUS-Empfang aufgerufen, wenn sich das LPP-Limit ändert.
// Idempotent: Ein Limit kann auf zwei Wegen aufgehoben werden – durch den
// automatischen Ablauf (tickEebus) UND durch ein explizites Aufhebe-Kommando der
// Steuerbox. Treffen beide kurz nacheinander ein, darf das nicht doppelt
// protokolliert/verarbeitet werden. Daher wird nur bei einem tatsächlichen
// Zustandswechsel (aktiv/Wert) geloggt und gehandelt.
export function setLppLimit(aktiv: boolean, wert: number): void {
  const neuWert = Math.max(0, wert);
  const unveraendert = aktiv === limitAktiv && (!aktiv || neuWert === limitW);
  if (unveraendert) return; // kein echter Wechsel -> kein doppelter Log-/Regeleintrag
  limitAktiv = aktiv;
  limitW = neuWert;
  addLog({ scharf: config.scharf, text: aktiv ? `LPP-Limit aktiv: ${limitW} W Einspeisegrenze` : "LPP-Limit aufgehoben" });
  // Bei Aufhebung sofort alle WR auf 100% zurück.
  if (!aktiv) for (const inv of config.inverter) sollProzent.set(inv.id, 100);
}

// --- Versand an einen einzelnen Wechselrichter ---

async function sendGrowattHttp(inv: LppInverter, register: number, wert: number): Promise<void> {
  const base = (inv.httpUrl ?? "").replace(/\/$/, "");
  if (!base) throw new Error("Growatt httpUrl fehlt");
  const body = new URLSearchParams({ operation: "W", registerType: "H", register: String(register), value: String(wert) });
  const r = await fetch(`${base}/postCommunicationModbus`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
function sendGrowattMqtt(inv: LppInverter, register: number, wert: number): void {
  if (!inv.mqttUrl || !inv.mqttTopic) throw new Error("Growatt MQTT-URL/Topic fehlen");
  const payload = JSON.stringify({ register, value: wert, type: "holding" });
  publishExtHemsMqtt({ mqttUrl: inv.mqttUrl, mqttAuthType: inv.mqttAuthType, mqttUsername: inv.mqttUsername, mqttPassword: inv.mqttPassword, mqttCaCert: inv.mqttCaCert }, inv.mqttTopic, payload, false);
}

// Setzt ein Growatt-WR-Prozentlimit (0..100).
async function setGrowatt(inv: LppInverter, prozent: number): Promise<void> {
  const methode = inv.methode ?? "prozent";
  const writes: Array<{ register: number; wert: number }> = [];
  if (methode === "prozent") {
    writes.push({ register: inv.regProzent ?? 3, wert: prozent });
  } else {
    if (prozent >= 100) writes.push({ register: inv.regMeterEnable ?? 122, wert: 0 });
    else { writes.push({ register: inv.regMeterEnable ?? 122, wert: 1 }); writes.push({ register: inv.regRate ?? 123, wert: Math.round(prozent * 10) }); }
  }
  for (const w of writes) {
    if ((inv.kanal ?? "http") === "http") await sendGrowattHttp(inv, w.register, w.wert);
    else sendGrowattMqtt(inv, w.register, w.wert);
  }
}

// Setzt ein OpenDTU-WR-Limit. OpenDTU nimmt absolute (W) oder relative (%)
// Limits. Wir nutzen relativ (%), da wir den WR anteilig an seiner Nennleistung
// drosseln. persistent/nonpersistent gemäß Konfiguration.
async function setOpenDtu(inv: LppInverter, prozent: number): Promise<void> {
  const cmd = config.persistent ? "limit_persistent_relative" : "limit_nonpersistent_relative";
  const kanal = inv.opendtuKanal ?? "http";
  if (kanal === "mqtt") {
    if (!inv.opendtuMqttUrl || !inv.opendtuMqttBasetopic || !inv.opendtuSerial) throw new Error("OpenDTU MQTT-Angaben fehlen");
    const topic = `${inv.opendtuMqttBasetopic.replace(/\/$/, "")}/${inv.opendtuSerial}/cmd/${cmd}`;
    publishExtHemsMqtt({ mqttUrl: inv.opendtuMqttUrl, mqttAuthType: inv.opendtuMqttAuthType, mqttUsername: inv.opendtuMqttUsername, mqttPassword: inv.opendtuMqttPassword }, topic, String(prozent), false);
    return;
  }
  // HTTP: OpenDTU /api/limit/config  (data=... form-encoded)
  const base = (inv.opendtuHttpUrl ?? "").replace(/\/$/, "");
  if (!base || !inv.opendtuSerial) throw new Error("OpenDTU HTTP-URL/Serial fehlen");
  const limit_type = config.persistent ? 257 : 1; // relative persistent/nonpersistent
  const data = JSON.stringify({ serial: inv.opendtuSerial, limit_type, limit_value: prozent });
  const body = new URLSearchParams({ data });
  const r = await fetch(`${base}/api/limit/config`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

async function setInverter(inv: LppInverter, prozent: number): Promise<void> {
  if (inv.typ === "growatt") await setGrowatt(inv, prozent);
  else await setOpenDtu(inv, prozent);
}

// --- Live-Regelung ---
//
// Wird periodisch aufgerufen. gridPowerW = aktuelle Netzleistung (>0 Bezug,
// <0 Einspeisung). Aus der Einspeisung (max(0,-grid)) und dem Limit wird die
// nötige Drosselung entlang der Reihenfolge bestimmt.

export async function regelLpp(gridPowerW: number): Promise<void> {
  if (!config.enabled || config.inverter.length === 0) return;

  if (!limitAktiv) {
    // Kein Limit: sicherstellen, dass alle WR auf 100% stehen.
    await sendeGeaenderte("kein Limit – alle WR unbegrenzt");
    return;
  }

  const einspeisung = Math.max(0, -gridPowerW);
  const grenze = Math.max(0, limitW - config.reserveW);
  const ueber = einspeisung - grenze;
  const reihenfolge = config.inverter;

  if (ueber > 5) {
    // Zu viel Einspeisung -> entlang der Reihenfolge drosseln. Basis ist die
    // real gemessene Ist-Leistung je WR: Der neue Soll-Wattwert = aktuelle
    // Ist-Leistung minus nötiger Reduktion; daraus wird über die Nennleistung
    // das Prozent-Limit gebildet. (Beispiel: 5 kW Ist, 10 kW Nenn, 3 kW
    // Reduktion -> Soll 2 kW = 20 %.)
    let restReduktion = ueber;
    for (const inv of reihenfolge) {
      if (restReduktion <= 0) break;
      const ist = istLeistung(inv.sourceId);
      const aktProzent = sollProzent.get(inv.id) ?? 100;
      // Nur WR anfassen, die aktuell etwas liefern und nicht schon bei 0 stehen.
      if (ist <= 0 || aktProzent <= 0) continue;
      const reduziere = Math.min(ist, restReduktion);
      const neueLeistung = Math.max(0, ist - reduziere);
      const nenn = inv.nennleistungW > 0 ? inv.nennleistungW : ist; // Fallback
      const neuProzent = Math.max(0, Math.min(100, Math.round((neueLeistung / nenn) * 100)));
      sollProzent.set(inv.id, neuProzent);
      restReduktion -= reduziere;
    }
    await sendeGeaenderte(`Einspeisung ${Math.round(einspeisung)} W > Grenze ${grenze} W -> drossle (${Math.round(ueber)} W zu viel)`);
  } else if (ueber < -50) {
    // Deutlich unter der Grenze -> in umgekehrter Reihenfolge hochregeln. Wir
    // erhöhen schrittweise das Prozentlimit der bereits gedrosselten WR.
    let spielraum = -ueber;
    for (let i = reihenfolge.length - 1; i >= 0; i--) {
      if (spielraum <= 0) break;
      const inv = reihenfolge[i];
      const aktProzent = sollProzent.get(inv.id) ?? 100;
      if (aktProzent >= 100) continue; // schon voll -> nächster
      const nenn = inv.nennleistungW > 0 ? inv.nennleistungW : Math.max(1, istLeistung(inv.sourceId));
      // Erhöhung in Watt in einen Prozentschritt umsetzen (auf Nennleistung bezogen).
      const erhoeheW = Math.min(spielraum, nenn * (100 - aktProzent) / 100);
      const neuProzent = Math.max(0, Math.min(100, aktProzent + Math.round((erhoeheW / nenn) * 100)));
      sollProzent.set(inv.id, neuProzent);
      spielraum -= erhoeheW;
    }
    await sendeGeaenderte(`Einspeisung ${Math.round(einspeisung)} W < Grenze ${grenze} W -> regle hoch`);
  }
  // Im Totband (kleine Abweichung) nichts tun.
}

// Sendet nur die WR, deren Soll sich geändert hat (respektiert Dry-Run).
async function sendeGeaenderte(grund: string): Promise<void> {
  const aenderungen: string[] = [];
  for (const inv of config.inverter) {
    const soll = sollProzent.get(inv.id) ?? 100;
    if (letztGesendet.get(inv.id) === soll) continue;
    aenderungen.push(`${inv.name}=${soll}%`);
    if (config.scharf) {
      try { await setInverter(inv, soll); letztGesendet.set(inv.id, soll); }
      catch (e: any) { addLog({ scharf: true, text: `${inv.name} auf ${soll}% (${grund})`, fehler: e?.message ?? String(e) }); continue; }
    } else {
      letztGesendet.set(inv.id, soll);
    }
  }
  if (aenderungen.length > 0) {
    addLog({ scharf: config.scharf, text: `${config.scharf ? "" : "[Dry-Run] "}${grund}: ${aenderungen.join(", ")}` });
  }
}

// Testfunktion: einen WR gezielt auf einen Prozentwert setzen.
export async function testInverterWrite(invId: string, prozent: number): Promise<{ ok: boolean; text: string; fehler?: string }> {
  const inv = config.inverter.find((i) => i.id === invId);
  if (!inv) return { ok: false, text: "WR nicht gefunden" };
  const p = Math.max(0, Math.min(100, prozent));
  const text = `Test ${inv.name} -> ${p}%`;
  if (!config.scharf) { addLog({ scharf: false, text: `[Dry-Run] ${text}` }); return { ok: true, text: `[Dry-Run] ${text}` }; }
  try { await setInverter(inv, p); addLog({ scharf: true, text }); return { ok: true, text }; }
  catch (e: any) { const fehler = e?.message ?? String(e); addLog({ scharf: true, text, fehler }); return { ok: false, text, fehler }; }
}
