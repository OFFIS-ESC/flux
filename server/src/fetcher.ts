// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type { SourceConfig, Metric } from "./sources.js";
import { emuPowerNow, emuMeterReading, emuMeterReadingOut, gridEmuPowerNow, gridEmuMeterIn, gridEmuMeterOut } from "./emu.js";
import { parseMarstekTarget, readMarstek, marstekBatteryPowerW, marstekDisplayFields } from "./marstek.js";
import { getMqttPayload, isMqttConnected } from "./mqttClient.js";
import { readMarstekModbus, isMarstekModbusModel } from "./marstekModbus.js";
import { httpGetJson } from "./httpClient.js";

const numOr = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);

// Liest einen Wert per Punkt-Pfad aus einem Objekt.
// Unterstützt:
//  - Array-Indizes:        "inverters.0.AC.0.Power.v"
//  - Schlüssel mit Sonderzeichen: "switch:0.apower"
//  - Array-Selektor nach Feldwert: "heatpump[Name=Compressor_Freq].Value"
//    (findet im Array das erste Element, dessen Feld den Wert hat)
function getByPath(obj: any, path: string): unknown {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    // Array-Selektor "schlüssel[feld=wert]"?
    const m = part.match(/^([^[]+)\[([^=]+)=([^\]]+)\]$/);
    if (m) {
      const [, key, field, want] = m;
      const arr = cur[key];
      if (!Array.isArray(arr)) return undefined;
      cur = arr.find((el) => el != null && String(el[field]) === want);
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Ergebnis einer Quellenabfrage: pro Metrik der gelesene Wert.
// (Eine Quelle kann eine Metrik nur einmal sinnvoll führen; bei mehreren
//  Feldern gleicher Metrik gewinnt das letzte – in der Praxis eindeutig.)
export interface SourceReadResult {
  values: Partial<Record<Metric, number>>;
  // rohe Werte je Feld-Label (für die Statusseite-Anzeige)
  display: Array<{ label: string; value: number | boolean | string; unit: string }>;
  // Status der einzelnen Batteriemodule (nur Marstek-Modbus-Speicher)
  modules?: Array<{ index: number; soc: number | null; cellMinV: number | null; cellMaxV: number | null; imbalanceV: number | null }>;
}

// Fragt eine Quelle ab und extrahiert ihre Felder. Wirft bei HTTP/Timeout.
export async function readSource(src: SourceConfig): Promise<SourceReadResult> {
  let doc: any;

  if (src.role === "dcBattery") {
    // DC-Speicher hat keine eigene Datenquelle: die Werte ergeben sich aus den
    // verlinkten Quellen (PV/Batterie) und werden erst in der Anzeige/API
    // zusammengeführt. Hier daher kein HTTP-Abruf – leeres Ergebnis.
    return { values: {}, display: [] };
  }

  if (src.mock === "emu") {
    // Gemockte Quelle: BDEW-Lastprofil-Emulation statt HTTP-Abruf.
    const jv = src.jahresverbrauch ?? 3500;
    const prof = src.emuProfile ?? "H25";
    doc = {
      power: emuPowerNow(prof, jv), // momentane Netto-Leistung (W, +Bezug/−Einspeisung)
      meter: emuMeterReading(prof, jv), // kumulierter Bezug seit Jahresbeginn (kWh)
      meterOut: emuMeterReadingOut(prof, jv), // kumulierte Einspeisung (kWh, 0 ohne neg. Werte)
    };
  } else if (src.mock === "gridEmu") {
    // Eigenhaushalt-Emulation: virtueller Netzzähler = Lastprofil (skaliert auf
    // Jahresverbrauch) minus Erzeugungsprofil (skaliert auf kWp).
    const jv = src.jahresverbrauch ?? 3500;
    const last = src.emuProfile ?? "H25";
    const gen = src.erzeugungsProfile;
    const kwp = src.kwp ?? 0;
    doc = {
      power: gridEmuPowerNow(last, jv, gen, kwp), // +Bezug / −Einspeisung (W)
      meter: gridEmuMeterIn(last, jv, gen, kwp), // kumulierter Netto-Bezug (kWh)
      meterOut: gridEmuMeterOut(last, jv, gen, kwp), // kumulierte Netto-Einspeisung (kWh)
    };
  } else if (
    (src.connection === "udp") ||
    // Abwärtskompatibel: ältere Marstek-UDP-Quellen ohne gesetztes connection-Feld.
    (src.connection == null && src.role === "acBattery" && (src.acModel ?? "marstek-venus") === "marstek-venus")
  ) {
    // AC-Speicher mit lokaler Marstek-API (UDP JSON-RPC).
    const target = parseMarstekTarget(src.url, src.acUdpPort ?? 30000);
    if (!target) throw new Error("ungültige Marstek-Adresse (IP[:Port] erwartet)");
    const reading = await readMarstek(target.host, target.port, src.timeoutMs);
    if (!reading.es && !reading.bat && !reading.device) {
      throw new Error("keine Antwort vom Marstek-Speicher (UDP)");
    }
    const values: Partial<Record<Metric, number>> = {};
    const display: Array<{ label: string; value: number | boolean | string; unit: string }> = [];
    // Leistung in HEMS-Konvention: >0 Ladung, <0 Entladung.
    const p = marstekBatteryPowerW(reading);
    if (p != null) values.power = p;
    const bat = reading.bat ?? {};
    const es = reading.es ?? {};
    const soc = numOr(bat.soc ?? es.bat_soc ?? es.soc);
    if (soc != null) values.soc = soc;
    const temp = numOr(bat.temp ?? bat.temperature);
    if (temp != null) values.temperature = temp;
    const volt = numOr(bat.vol ?? bat.voltage);
    if (volt != null) values.voltage = volt;
    // Alle verfügbaren Felder für die Statusseite aufbereiten.
    for (const row of marstekDisplayFields(reading)) {
      display.push({ label: row.label, value: row.value, unit: "" });
    }
    return { values, display };
  } else if (src.connection === "modbus") {
    // AC-Speicher per Modbus TCP (aktuell Marstek Venus-Familie).
    const model = src.modbusModel ?? "venus-v3";
    if (!isMarstekModbusModel(model)) {
      throw new Error(`unbekanntes Modbus-Speichermodell: ${model}`);
    }
    // Host aus url extrahieren (nackte IP/Host, ggf. mit http:// oder :Port).
    const host = (src.url || "").replace(/^\w+:\/\//, "").replace(/[/:].*$/, "").trim();
    if (!host) throw new Error("keine Geräteadresse (IP/Host) angegeben");
    const reading = await readMarstekModbus(
      host,
      src.modbusPort ?? 502,
      src.modbusUnitId ?? 1,
      model,
      src.timeoutMs,
    );
    const values: Partial<Record<Metric, number>> = {};
    // Nur die bekannten Bilanz-Metriken übernehmen; Rest nur zur Anzeige.
    for (const [k, v] of Object.entries(reading.values)) {
      if (k === "power" || k === "soc" || k === "voltage" || k === "temperature" || k === "current") {
        values[k as Metric] = v;
      }
    }
    const display = reading.display.map((d) => ({ label: d.label, value: d.value, unit: d.unit }));
    return { values, display, modules: reading.modules };
  } else if ((src.connection ?? "rest") === "mqtt") {
    // MQTT-Quelle: die zuletzt empfangene Payload aus dem Cache lesen. Der
    // MQTT-Client abonniert das Topic separat (siehe mqttClient.ts); hier wird
    // nur die gecachte JSON-Payload ausgewertet.
    const payload = getMqttPayload(src);
    if (!payload) {
      throw new Error(
        isMqttConnected(src)
          ? "noch keine MQTT-Nachricht empfangen"
          : "keine MQTT-Verbindung",
      );
    }
    try {
      const parsed = JSON.parse(payload.raw);
      // Nur ein Objekt/Array taugt für jsonPath-Zugriffe. Ein reiner Skalar
      // (Zahl/Bool/String – auch valides JSON wie "777") wird unter "value"
      // abgelegt, damit einfache Topics per jsonPath "value" nutzbar sind.
      doc = parsed !== null && typeof parsed === "object" ? parsed : { value: parsed };
    } catch {
      // Nicht-JSON-Payload (roher Text/Zahl): ebenfalls unter "value".
      const n = Number(payload.raw);
      doc = { value: Number.isFinite(n) ? n : payload.raw };
    }
  } else {
    // Alle übrigen Quellen inkl. generischer AC-Speicher (acModel "generic"):
    // normale HTTP-Abfrage; die Leistung kommt aus den konfigurierten Feldern.
    // httpGetJson schließt die Verbindung nach der Antwort (kein Keep-Alive),
    // was schwache Geräte (Shelly Gen1) schont.
    const headers: Record<string, string> = {};
    // REST-Authentifizierung: Bearer-Token, falls konfiguriert.
    if (src.authType === "bearer" && src.bearerToken) {
      headers["Authorization"] = `Bearer ${src.bearerToken}`;
    }
    doc = await httpGetJson(src.url, {
      timeoutMs: src.timeoutMs,
      headers: Object.keys(headers).length ? headers : undefined,
    });
  }

  return extractFields(src, doc);
}

// Extrahiert aus einem bereits geladenen JSON-Dokument die konfigurierten Felder.
// Von readSource (REST/MQTT-Cache) und vom MQTT-Verbindungstest genutzt.
export function extractFields(src: SourceConfig, doc: any): SourceReadResult {
  const values: Partial<Record<Metric, number>> = {};
  const display: Array<{ label: string; value: number | boolean | string; unit: string }> = [];

  for (const f of src.fields) {
    const raw = getByPath(doc, f.jsonPath);
    // values bleibt immer numerisch (für Aggregation: bool->0/1).
    const num = toNum(raw) * (f.scale ?? 1);
    values[f.metric] = num;
    // display zeigt den typgerechten Wert.
    let disp: number | boolean | string;
    if (f.valueType === "bool") disp = toNum(raw) > 0.5;
    else if (f.valueType === "string") disp = raw == null ? "" : String(raw);
    else disp = num;
    display.push({ label: f.label, value: disp, unit: f.unit });
  }

  return { values, display };
}
