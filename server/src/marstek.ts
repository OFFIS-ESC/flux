// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Client für die lokale Marstek-API (Venus C/D/E u.a.).
//
// Die Speicher sprechen im LAN ein UDP-JSON-RPC-Protokoll (Default-Port 30000).
// Kommandos sind JSON-Objekte { id, method, params }, die Antwort kommt als ein
// UDP-Paket zurück. Die wichtigsten Methoden:
//   Marstek.GetDevice { ble_mac:"0" } -> Geräteinfo (Modell, Version, IP, MACs)
//   ES.GetStatus      { id:0 }        -> Energiesystem: SoC, Leistung, Grid, PV,
//                                        Energiezähler (Bezug/Einspeisung/PV/Last)
//   Bat.GetStatus     { id:0 }        -> Batterie: SoC, Temperatur, Kapazität,
//                                        Spannung, Strom
//   EM.GetStatus      { id:0 }        -> Energy Meter (falls CT vorhanden)
//
// Vor der ersten Nutzung muss die lokale API in der Marstek-App aktiviert und
// das Gerät einmalig per Broadcast "aufgeweckt" werden. Dieser Client sendet
// gezielte Unicast-Requests an die konfigurierte URL/IP.
//
// Referenzen (Stand Anfang 2026, Angaben ohne Gewähr, Firmware-abhängig):
//   https://static-eu.marstekcloud.com/ems/resource/agreement/MarstekDeviceOpenApi.pdf
//   https://github.com/jaapp/ha-marstek-local-api/

import dgram from "node:dgram";

export interface MarstekReading {
  // Rohantworten je Methode (soweit erhalten)
  device?: Record<string, any>;
  es?: Record<string, any>;
  bat?: Record<string, any>;
  em?: Record<string, any>;
}

// Extrahiert Host und Port aus einer konfigurierten URL bzw. IP-Angabe.
// Akzeptiert "udp://192.168.1.5:30000", "192.168.1.5:30000" oder "192.168.1.5".
export function parseMarstekTarget(url: string, defaultPort = 30000): { host: string; port: number } | null {
  if (!url) return null;
  let s = url.trim();
  s = s.replace(/^udp:\/\//i, "").replace(/^http:\/\//i, "").replace(/^https:\/\//i, "");
  s = s.replace(/\/.*$/, ""); // evtl. Pfad abschneiden
  const m = s.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  const host = m[1];
  const port = m[2] ? Number(m[2]) : defaultPort;
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

// Sendet einen einzelnen UDP-JSON-RPC-Request und wartet auf die Antwort.
// Timeout in ms; bei Timeout/Fehler wird null zurückgegeben.
//
// WICHTIG: Die Marstek-Firmware (getestet VenusC ver 153) antwortet nur, wenn
// der Request von einem festen lokalen Quellport gesendet wird, der dem
// Zielport entspricht (Default 30000) – sie schickt die Antwort an genau diesen
// Port zurück. Ein zufälliger Quellport (Standard bei einem ungebundenen
// Socket) führt dazu, dass nie eine Antwort ankommt. Daher wird der Socket vor
// dem Senden explizit an localPort gebunden (mit reuseAddr, da die Requests
// seriell nacheinander denselben Port verwenden).
function udpRequest(
  host: string,
  port: number,
  payload: object,
  timeoutMs: number,
  localPort: number
): Promise<Record<string, any> | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = (val: Record<string, any> | null) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch { /* ignore */ }
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on("message", (msg) => {
      clearTimeout(timer);
      try {
        const obj = JSON.parse(msg.toString());
        finish(obj);
      } catch {
        finish(null);
      }
    });
    sock.on("error", () => { clearTimeout(timer); finish(null); });
    const buf = Buffer.from(JSON.stringify(payload));
    const doSend = () => {
      sock.send(buf, port, host, (err) => {
        if (err) { clearTimeout(timer); finish(null); }
      });
    };
    // An den festen lokalen Port binden, dann senden. Schlägt das Binden fehl
    // (z. B. Port belegt), wird ohne feste Bindung gesendet (Fallback).
    try {
      sock.bind(localPort, () => {
        try { sock.setBroadcast(true); } catch { /* ignore */ }
        doSend();
      });
    } catch {
      doSend();
    }
  });
}

let reqId = 1;
function nextId(): number {
  reqId = (reqId % 1_000_000) + 1;
  return reqId;
}

// Fragt alle unterstützten Statusmethoden nacheinander ab. Einzelne
// fehlschlagende Methoden (Timeout/nicht unterstützt) werden übersprungen; das
// Ergebnis enthält nur die erfolgreich gelesenen Teile. Die Marstek-Firmware
// ist empfindlich gegen zu schnelle Abfragen, daher werden die Requests seriell
// mit kleiner Pause gesendet.
export async function readMarstek(
  host: string,
  port: number,
  timeoutMs = 3000
): Promise<MarstekReading> {
  const out: MarstekReading = {};
  // Von demselben lokalen Port senden wie der Zielport – die Firmware antwortet
  // sonst nicht (siehe udpRequest). Zwischen den Requests etwas Pause lassen,
  // damit der Socket den Port wieder freigibt, bevor der nächste ihn bindet.
  const lp = port;

  const dev = await udpRequest(host, port, { id: nextId(), method: "Marstek.GetDevice", params: { ble_mac: "0" } }, timeoutMs, lp);
  if (dev?.result) out.device = dev.result;
  await sleep(200);

  const es = await udpRequest(host, port, { id: nextId(), method: "ES.GetStatus", params: { id: 0 } }, timeoutMs, lp);
  if (es?.result) out.es = es.result;
  await sleep(200);

  const bat = await udpRequest(host, port, { id: nextId(), method: "Bat.GetStatus", params: { id: 0 } }, timeoutMs, lp);
  if (bat?.result) out.bat = bat.result;
  await sleep(200);

  const em = await udpRequest(host, port, { id: nextId(), method: "EM.GetStatus", params: { id: 0 } }, timeoutMs, lp);
  if (em?.result) out.em = em.result;

  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Vorzeichenkonvention der Leistung im HEMS:
//   +  = Ladung (Bezug aus dem Hausnetz, wie batteryIn / Netzladung)
//   -  = Entladung (Abgabe ans Haus, wie batteryOut)
// Marstek ES.GetStatus (Rev 2.0) liefert bat_power (>0 Ladung, <0 Entladung).
// ACHTUNG: bat_power ist auf einigen Firmwares fehlerhaft (meldet z. B. ~22000
// statt ~2300 W). Als zuverlässiger Fallback gilt -ongrid_power (bekannt aus der
// evcc-Integration). Rückgabe: Leistung in W (HEMS-Konvention, s.o.) oder null.
export function marstekBatteryPowerW(r: MarstekReading): number | null {
  const es = r.es ?? {};
  const bat = r.bat ?? {};
  const batP =
    numOrNull(es.bat_power) ??
    numOrNull(es.battery_power) ??
    numOrNull(bat.bat_power) ??
    numOrNull(bat.power);
  const ongrid = numOrNull(es.ongrid_power);
  // Wenn bat_power unplausibel groß ist (bekannter Firmware-Bug), auf
  // -ongrid_power ausweichen. Schwelle großzügig (Venus-Geräte < ~5 kW).
  if (batP != null && Math.abs(batP) <= 8000) return batP;
  if (ongrid != null) return -ongrid; // Netz-Bezug beim Laden -> positive Ladung
  if (batP != null) return batP; // letzter Ausweg
  // Alternativ getrennte Lade-/Entladefelder.
  const pin = numOrNull(es.pwr_in) ?? numOrNull(es.charge_power);
  const pout = numOrNull(es.pwr_out) ?? numOrNull(es.discharge_power);
  if (pin != null || pout != null) return (pin ?? 0) - (pout ?? 0);
  return null;
}

function numOrNull(v: any): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// Baut aus einer Marstek-Antwort die Anzeige-Datenreihen (Label -> Wert) für die
// Statusseite. Nur vorhandene Felder werden übernommen.
export function marstekDisplayFields(r: MarstekReading): Array<{ label: string; value: number | string | boolean }> {
  const rows: Array<{ label: string; value: number | string | boolean }> = [];
  const push = (label: string, v: any) => {
    if (v === undefined || v === null) return;
    rows.push({ label, value: v });
  };
  const es = r.es ?? {};
  const bat = r.bat ?? {};
  const dev = r.device ?? {};

  push("SoC", bat.soc ?? es.bat_soc ?? es.soc);
  push("Temperatur", bat.temp ?? bat.temperature);
  push("Rest-Kapazität", bat.rm_cap ?? bat.remaining_capacity ?? es.bat_cap);
  push("Rated-Kapazität", bat.rated_cap ?? bat.rated_capacity);
  push("Spannung", bat.vol ?? bat.voltage);
  push("Strom", bat.cur ?? bat.current);
  push("Batterie-Leistung", es.bat_power ?? es.battery_power ?? bat.power);
  push("Netz-Leistung", es.grid_power ?? es.ongrid_power);
  push("Off-Grid-Leistung", es.offgrid_power);
  push("PV-Leistung", es.pv_power ?? es.ppv);
  push("Betriebsmodus", es.mode ?? es.work_mode ?? es.operating_mode);
  push("Modell", dev.device ?? dev.model);
  push("Firmware", dev.ver ?? dev.version);
  push("IP", dev.ip);
  return rows;
}

// ---------------------------------------------------------------------------
// Strukturierte Aufbereitung für die Marstek-Detailseite
// ---------------------------------------------------------------------------

// Ein Anzeigewert mit Einheit und optionaler Gruppen-/Formatinfo.
export interface MarstekField {
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit?: string;
}

export interface MarstekStructured {
  online: boolean;
  device: { model: string | null; firmware: number | null; ip: string | null; bleMac: string | null };
  // Kernwerte für die Kacheln
  soc: number | null;
  batPowerW: number | null; // HEMS-Konvention: >0 Ladung, <0 Entladung
  ongridPowerW: number | null;
  offgridPowerW: number | null;
  pvPowerW: number | null;
  tempC: number | null;
  remainingCapWh: number | null;
  ratedCapWh: number | null;
  mode: string | null;
  chargeAllowed: boolean | null;
  dischargeAllowed: boolean | null;
  ctConnected: boolean | null;
  // Energiezähler (kWh) – Firmware liefert teils Wh (Faktor 1000); wir normieren
  // grob: Werte > 100000 als Wh interpretieren.
  totalPvKwh: number | null;
  totalGridInKwh: number | null;
  totalGridOutKwh: number | null;
  totalLoadKwh: number | null;
  // Vollständige Feldliste (Rohdaten) zur Anzeige einer Detailtabelle
  raw: MarstekField[];
}

function n(v: any): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// Energie normieren: Manche Firmware liefert Wh statt kWh. Heuristik: sehr große
// Werte (> 100000) als Wh interpretieren und /1000 rechnen.
function toKwh(v: number | null): number | null {
  if (v == null) return null;
  return v > 100000 ? v / 1000 : v;
}

export function marstekStructured(r: MarstekReading): MarstekStructured {
  const es = r.es ?? {};
  const bat = r.bat ?? {};
  const dev = r.device ?? {};
  const online = !!(r.es || r.bat || r.device);

  const raw: MarstekField[] = [];
  const add = (key: string, label: string, value: any, unit?: string) => {
    if (value === undefined || value === null) return;
    raw.push({ key, label, value, unit });
  };
  // Batterie
  add("soc", "SoC", n(bat.soc ?? es.bat_soc), "%");
  add("bat_temp", "Batterie-Temperatur", tempCorrected(bat.bat_temp ?? bat.temp), "°C");
  add("bat_capacity", "Aktuelle Kapazität", n(bat.bat_capacity ?? es.bat_cap), "Wh");
  add("rated_capacity", "Nennkapazität", n(bat.rated_capacity ?? bat.rated_cap), "Wh");
  add("charg_flag", "Laden erlaubt", typeof bat.charg_flag === "boolean" ? bat.charg_flag : undefined);
  add("dischrg_flag", "Entladen erlaubt", typeof bat.dischrg_flag === "boolean" ? bat.dischrg_flag : undefined);
  // Energiesystem
  add("bat_power", "Batterie-Leistung", n(es.bat_power), "W");
  add("ongrid_power", "Netz-Leistung", n(es.ongrid_power), "W");
  add("offgrid_power", "Off-Grid-Leistung", n(es.offgrid_power), "W");
  add("pv_power", "PV-Leistung", n(es.pv_power), "W");
  add("mode", "Betriebsmodus", es.mode);
  add("total_pv_energy", "PV-Energie gesamt", n(es.total_pv_energy), "Wh");
  add("total_grid_input_energy", "Netzbezug gesamt", gridEnergyWh(es.total_grid_input_energy), "Wh");
  add("total_grid_output_energy", "Netzeinspeisung gesamt", gridEnergyWh(es.total_grid_output_energy), "Wh");
  add("total_load_energy", "Last-Energie gesamt", n(es.total_load_energy), "Wh");
  // Gerät
  add("device", "Modell", dev.device);
  add("ver", "Firmware", n(dev.ver));
  add("ip", "IP-Adresse", dev.ip);

  return {
    online,
    device: { model: dev.device ?? null, firmware: n(dev.ver), ip: dev.ip ?? null, bleMac: dev.ble_mac ?? null },
    soc: n(bat.soc ?? es.bat_soc),
    batPowerW: marstekBatteryPowerW(r),
    ongridPowerW: n(es.ongrid_power),
    offgridPowerW: n(es.offgrid_power),
    pvPowerW: n(es.pv_power),
    tempC: tempCorrected(bat.bat_temp ?? bat.temp),
    remainingCapWh: n(bat.bat_capacity ?? es.bat_cap),
    ratedCapWh: n(bat.rated_capacity ?? bat.rated_cap),
    mode: es.mode ?? null,
    chargeAllowed: typeof bat.charg_flag === "boolean" ? bat.charg_flag : null,
    dischargeAllowed: typeof bat.dischrg_flag === "boolean" ? bat.dischrg_flag : null,
    ctConnected: null,
    totalPvKwh: toKwh(n(es.total_pv_energy)),
    totalGridInKwh: gridEnergyKwh(es.total_grid_input_energy),
    totalGridOutKwh: gridEnergyKwh(es.total_grid_output_energy),
    totalLoadKwh: toKwh(n(es.total_load_energy)),
    raw,
  };
}

// Batterietemperatur: die Firmware liefert sie in 0,1 °C (z. B. 310 = 31 °C).
// Plausible Rohwerte > 80 werden durch 10 geteilt; echte Temperaturen liegen
// darunter und bleiben unverändert.
function tempCorrected(v: any): number | null {
  const x = typeof v === "number" && isFinite(v) ? v : null;
  if (x == null) return null;
  return x > 80 ? x / 10 : x;
}

// Netzbezug/-einspeisung gesamt (für die Rohdaten-Tabelle, Einheit Wh): die
// Firmware meldet diese beiden Zähler um Faktor 10 zu klein (anders als PV-/
// Last-Energie). Daher ×10.
function gridEnergyWh(v: any): number | null {
  const x = typeof v === "number" && isFinite(v) ? v : null;
  if (x == null) return null;
  return x * 10;
}

// Wie gridEnergyWh, aber als kWh für die Kacheln: Rohwert ist in Wh und um
// Faktor 10 zu klein -> ×10, dann /1000.
function gridEnergyKwh(v: any): number | null {
  const wh = gridEnergyWh(v);
  return wh == null ? null : wh / 1000;
}

// Betriebsmodus abfragen (ES.GetMode).
export async function getMarstekMode(host: string, port: number, timeoutMs = 3000): Promise<Record<string, any> | null> {
  const res = await udpRequest(host, port, { id: nextId(), method: "ES.GetMode", params: { id: 0 } }, timeoutMs, port);
  return res?.result ?? null;
}

// Unterstützte Modi laut Marstek Open API (Rev 2.0).
export type MarstekMode = "Auto" | "AI" | "Manual" | "Passive";

// Betriebsmodus setzen (ES.SetMode). Für Passive wird ein Leistungssollwert
// (power, W; >0 = Entladen, <0 = Laden) und eine Dauer (cd, Sekunden) mitgegeben.
// Für Manual verlangt die API einen Schedule-Block; wir senden einen einfachen
// Ganztages-Slot mit dem gewünschten Leistungswert.
export async function setMarstekMode(
  host: string,
  port: number,
  mode: MarstekMode,
  opts: { power?: number; durationS?: number } = {},
  timeoutMs = 4000
): Promise<{ ok: boolean; response: Record<string, any> | null; error?: string }> {
  let config: Record<string, any>;
  switch (mode) {
    case "Auto":
      config = { mode: "Auto", auto_cfg: { enable: 1 } };
      break;
    case "AI":
      config = { mode: "AI", ai_cfg: { enable: 1 } };
      break;
    case "Passive":
      config = { mode: "Passive", passive_cfg: { power: Math.round(opts.power ?? 0), cd: Math.round(opts.durationS ?? 0) } };
      break;
    case "Manual":
      config = {
        mode: "Manual",
        manual_cfg: {
          time_num: 0,
          start_time: "00:00",
          end_time: "23:59",
          week_set: 127, // alle Wochentage
          power: Math.round(opts.power ?? 0),
          enable: 1,
        },
      };
      break;
    default:
      return { ok: false, response: null, error: "unbekannter Modus" };
  }
  const res = await udpRequest(host, port, { id: nextId(), method: "ES.SetMode", params: { id: 0, config } }, timeoutMs, port);
  if (!res) return { ok: false, response: null, error: "keine Antwort" };
  if (res.error) return { ok: false, response: res, error: res.error.message ?? "Fehler" };
  return { ok: true, response: res };
}
