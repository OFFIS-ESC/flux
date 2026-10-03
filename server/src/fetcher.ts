// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type { SourceConfig, Metric } from "./sources.js";
import { emuPowerNow, emuMeterReading, emuMeterReadingOut, gridEmuPowerNow, gridEmuMeterIn, gridEmuMeterOut } from "./emu.js";
import { parseMarstekTarget, readMarstek, marstekBatteryPowerW, marstekDisplayFields } from "./marstek.js";
import { pollHueBridge, setHueSnapshot } from "./hue.js";
import { pollCcuHub, setHubSnapshot, pollHub } from "./ccu.js";
import { pollSecuritySpy, setSsSnapshot, starteEventStream } from "./securityspy.js";
import { readAcState, setAcState } from "./mitsubishiac.js";
import { readValloxState, setValloxState } from "./vallox.js";
import { pollPrusa, setPrusaState } from "./prusa.js";
import { pollAir, setAirState } from "./airsensor.js";
import { readEvccState, setEvccState } from "./evcc.js";
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

  if (src.role === "hueBridge") {
    // Philips Hue: ein Poll liefert alle Untergeräte. Snapshot wird zusätzlich im
    // Hue-Modul abgelegt (für Detektoren/Regeln); hier bauen wir die Anzeige.
    const snap = await pollHueBridge(src.hueBridgeHost ?? "", src.hueAppKey ?? "");
    setHueSnapshot(src.id, snap);
    if (!snap.ok) throw new Error(snap.error ?? "Hue-Abruf fehlgeschlagen");
    const display: SourceReadResult["display"] = [];
    display.push({ label: "Geräte", value: snap.geraeteAnzahl, unit: "" });
    const lichter = snap.subDevices.filter((s) => s.kind === "light");
    const anzahlAn = lichter.filter((s) => s.on).length;
    display.push({ label: "Leuchten an", value: `${anzahlAn} / ${lichter.length}`, unit: "" });
    // Jedes Untergerät als eigene Anzeigezeile (Name + Zustand).
    for (const s of snap.subDevices) {
      let wert: string | number | boolean = "";
      if (s.kind === "light") wert = (s.on ? "an" : "aus") + (s.brightness != null ? ` (${s.brightness}%)` : "");
      else if (s.kind === "motion") wert = s.motion == null ? "–" : (s.motion ? "Bewegung" : "keine Bewegung");
      else if (s.kind === "temperature") wert = s.temperature != null ? `${s.temperature.toFixed(1)} °C` : "–";
      else if (s.kind === "light_level") wert = s.lightLevel != null ? String(s.lightLevel) : "–";
      else if (s.kind === "device_power") wert = s.batteryLevel != null ? `${s.batteryLevel} %` : "–";
      const praefix = s.room ? `${s.room}: ` : "";
      display.push({ label: `${praefix}${s.name} [${s.kind}]`, value: wert, unit: "" });
    }
    return { values: {}, display };
  }



  if (src.role === "vallox") {
    // Vallox-Lüftungsanlage: Zustand aus MQTT-Nachrichten (state/temp) lesen.
    const cfg = { extern: src.geraeteMqttExtern, host: src.geraeteMqttHost, port: src.geraeteMqttPort, topic: src.geraeteMqttTopic ?? "vallox" };
    const st = readValloxState(cfg);
    setValloxState(src.id, st);
    if (!st.ok) throw new Error(st.error ?? "Vallox: keine MQTT-Daten");
    const display: SourceReadResult["display"] = [];
    display.push({ label: "Zustand", value: st.on ? "an" : "aus", unit: "" });
    if (st.speed != null) display.push({ label: "Stufe", value: st.speed, unit: "" });
    if (st.mode) display.push({ label: "Modus", value: st.mode, unit: "" });
    if (st.tempInside != null) display.push({ label: "Innen", value: st.tempInside, unit: "°C" });
    if (st.tempOutside != null) display.push({ label: "Außen", value: st.tempOutside, unit: "°C" });
    if (st.tempIncoming != null) display.push({ label: "Zuluft", value: st.tempIncoming, unit: "°C" });
    if (st.tempExhaust != null) display.push({ label: "Abluft", value: st.tempExhaust, unit: "°C" });
    if (st.heating) display.push({ label: "Heizung", value: "aktiv", unit: "" });
    if (st.fault) display.push({ label: "Störung", value: "ja", unit: "" });
    if (st.serviceNeeded) display.push({ label: "Wartung", value: "fällig", unit: "" });
    return { values: {}, display };
  }

  if (src.role === "evcc") {
    // Elektroauto-Ladung über evcc.
    const st = await readEvccState({ host: src.evccHost ?? "", loadpoint: src.evccLoadpoint });
    setEvccState(src.id, st);
    if (!st.ok) throw new Error(st.error ?? "evcc-Abruf fehlgeschlagen");
    const display: SourceReadResult["display"] = [];
    const modusLabel: Record<string, string> = { off: "Aus", pv: "PV", minpv: "Min+PV", now: "Schnell", smart: "PV" };
    display.push({ label: "Modus", value: modusLabel[st.mode ?? ""] ?? (st.mode ?? "?"), unit: "" });
    display.push({ label: "Fahrzeug", value: st.connected ? (st.charging ? "lädt" : "verbunden") : "getrennt", unit: "" });
    if (st.vehicleSoc != null) display.push({ label: "Ladestand", value: st.vehicleSoc, unit: "%" });
    if (st.limitSoc != null) display.push({ label: "Ladelimit", value: st.limitSoc, unit: "%" });
    if (st.chargePower != null && st.chargePower > 0) display.push({ label: "Ladeleistung", value: Math.round(st.chargePower), unit: "W" });
    // Leistung (für Verbraucherseite/Bilanz) unter values bereitstellen.
    return { values: { power: st.chargePower ?? 0 }, display };
  }

  if (src.role === "airSensor") {
    // Luftmess-Sensor: Feinstaub, Temperatur, Luftdruck.
    const st = await pollAir({ host: src.airHost ?? "" });
    setAirState(src.id, st);
    if (!st.ok) throw new Error(st.error ?? "Luftsensor-Abruf fehlgeschlagen");
    const display: SourceReadResult["display"] = [];
    if (st.pm25 != null) display.push({ label: "PM2.5", value: st.pm25, unit: "µg/m³" });
    if (st.pm10 != null) display.push({ label: "PM10", value: st.pm10, unit: "µg/m³" });
    if (st.temperature != null) display.push({ label: "Temperatur", value: st.temperature, unit: "°C" });
    if (st.pressure != null) display.push({ label: "Luftdruck", value: st.pressure, unit: "hPa" });
    if (st.sdsWarmup) display.push({ label: "Feinstaubsensor", value: "Aufwärmphase", unit: "" });
    if (st.systemOk === false) display.push({ label: "System", value: "Fehler", unit: "" });
    return { values: {}, display };
  }

  if (src.role === "prusa") {
    // Prusa 3D-Drucker: PrusaLink-Zustand abrufen und als Anzeige aufbereiten.
    const st = await pollPrusa({ host: src.prusaHost ?? "", auth: src.prusaAuth ?? "digest", apiKey: src.prusaApiKey, user: src.prusaUser, pass: src.prusaPass });
    setPrusaState(src.id, st);
    if (!st.ok) throw new Error(st.error ?? "Prusa-Abruf fehlgeschlagen");
    const display: SourceReadResult["display"] = [];
    if (st.state) display.push({ label: "Status", value: st.state, unit: "" });
    if (st.jobAktiv && st.jobDatei) display.push({ label: "Druck", value: st.jobDatei, unit: "" });
    if (st.jobFortschritt != null) display.push({ label: "Fortschritt", value: st.jobFortschritt, unit: "%" });
    if (st.jobRestzeitSek != null) display.push({ label: "Restzeit", value: Math.round(st.jobRestzeitSek / 60), unit: "min" });
    if (st.tempNozzle != null) display.push({ label: "Düse", value: st.tempNozzle.toFixed(0), unit: "°C" });
    if (st.tempBed != null) display.push({ label: "Bett", value: st.tempBed.toFixed(0), unit: "°C" });
    if (st.axisX != null) display.push({ label: "Achse X", value: st.axisX, unit: "mm" });
    if (st.axisY != null) display.push({ label: "Achse Y", value: st.axisY, unit: "mm" });
    if (st.axisZ != null) display.push({ label: "Achse Z", value: st.axisZ, unit: "mm" });
    if (st.flow != null) display.push({ label: "Flow", value: st.flow, unit: "%" });
    if (st.speed != null) display.push({ label: "Speed", value: st.speed, unit: "%" });
    if (st.fanHotend != null) display.push({ label: "Lüfter Hotend", value: st.fanHotend, unit: "" });
    if (st.fanPrint != null) display.push({ label: "Lüfter Druck", value: st.fanPrint, unit: "" });
    return { values: {}, display };
  }

  if (src.role === "mitsubishiAc") {
    // Mitsubishi-Klimaanlage: Zustand aus MQTT-Nachrichten (settings/state) lesen.
    const cfg = { extern: src.geraeteMqttExtern, host: src.geraeteMqttHost, port: src.geraeteMqttPort, topic: src.geraeteMqttTopic ?? "mitsubishi2mqtt" };
    const st = readAcState(cfg);
    setAcState(src.id, st);
    if (!st.ok) throw new Error(st.error ?? "Klima: keine MQTT-Daten");
    const display: SourceReadResult["display"] = [];
    display.push({ label: "Zustand", value: st.power ? "an" : "aus", unit: "" });
    if (st.mode) display.push({ label: "Modus", value: st.mode, unit: "" });
    if (st.action) display.push({ label: "Aktivität", value: st.action, unit: "" });
    if (st.temp != null) display.push({ label: "Ziel", value: st.temp, unit: "°C" });
    if (st.roomTemp != null) display.push({ label: "Raum", value: st.roomTemp, unit: "°C" });
    if (st.fan) display.push({ label: "Lüfter", value: st.fan, unit: "" });
    if (st.vane) display.push({ label: "Lamelle", value: st.vane, unit: "" });
    if (st.wideVane) display.push({ label: "Lamelle seitl.", value: st.wideVane, unit: "" });
    if (st.compressorFrequency != null) display.push({ label: "Kompressor", value: st.compressorFrequency, unit: "Hz" });
    return { values: {}, display };
  }

  if (src.role === "securitySpy") {
    // SecuritySpy: Kameraliste einlesen. Snapshot ablegen; Anzeige knapp halten.
    const snap = await pollSecuritySpy({ host: src.ssHost ?? "", port: src.ssPort, user: src.ssUser, pass: src.ssPass });
    setSsSnapshot(src.id, snap);
    if (!snap.ok) throw new Error(snap.error ?? "SecuritySpy-Abruf fehlgeschlagen");
    // Event-Stream für Bewegung/Klassifikation offen halten (idempotent).
    starteEventStream(src.id, { host: src.ssHost ?? "", port: src.ssPort, user: src.ssUser, pass: src.ssPass });
    const display: SourceReadResult["display"] = [];
    display.push({ label: "Kameras", value: snap.cameras.length, unit: "" });
    const verbunden = snap.cameras.filter((c) => c.connected).length;
    display.push({ label: "Verbunden", value: `${verbunden} / ${snap.cameras.length}`, unit: "" });
    for (const c of snap.cameras) {
      const bew = c.secondsSinceMotion == null ? "–" : c.secondsSinceMotion < 60 ? "gerade eben" : `vor ${Math.round(c.secondsSinceMotion / 60)} min`;
      display.push({ label: c.name, value: `${c.connected ? "OK" : "getrennt"}, letzte Bewegung ${bew}`, unit: "" });
    }
    return { values: {}, display };
  }

  if (src.role === "ccuHub") {
    // Smart-Home-Hub (CCU3 oder später HCU): ein Poll liefert alle Geräte/Kanäle.
    // Die Weiche wählt anhand hubTyp das Backend; Default CCU3.
    const snap = await pollHub({ hubTyp: src.hubTyp, host: src.ccuHost ?? "", port: src.ccuPort, hcuAuthToken: src.hcuAuthToken, hcuSgtin: src.hcuSgtin });
    setHubSnapshot(src.id, snap);
    if (!snap.ok) throw new Error(snap.error ?? "Hub-Abruf fehlgeschlagen");
    const display: SourceReadResult["display"] = [];
    display.push({ label: "Geräte", value: snap.geraeteAnzahl, unit: "" });
    for (const s of snap.subDevices) {
      let wert: string | number | boolean = "";
      if (typeof s.wert === "boolean") {
        // Sinnvolle Klartexte je Art
        if (s.kind === "switch") wert = s.wert ? "an" : "aus";
        else if (s.kind === "contact") wert = s.wert ? "offen" : "geschlossen";
        else if (s.kind === "motion") wert = s.wert ? "Bewegung" : "keine Bewegung";
        else wert = s.wert ? "ja" : "nein";
      } else if (typeof s.wert === "number") {
        wert = `${s.wert}${s.einheit ? " " + s.einheit : ""}`;
      } else if (s.wert != null) {
        wert = String(s.wert);
      } else {
        wert = "–";
      }
      const praefix = s.room ? `${s.room}: ` : "";
      display.push({ label: `${praefix}${s.name} [${s.datapoint}]`, value: wert, unit: "" });
    }
    return { values: {}, display };
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
    // Klare Meldung statt kryptischem "Invalid URL", wenn die Quelle keine (gültige)
    // Abfrage-URL hat. So ist erkennbar, WELCHE Quelle falsch konfiguriert ist.
    if (!src.url || !/^https?:\/\//i.test(src.url.trim())) {
      throw new Error(`Keine gültige Abfrage-URL (Rolle ${src.role}). URL muss mit http:// oder https:// beginnen.`);
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
    // display zeigt den typgerechten Wert. Existiert das Feld im Dokument gar
    // nicht (raw == null), wird es NICHT angezeigt – so verschwindet z. B. die
    // "0 W"-Zeile bei einem Shelly 1 ohne Leistungsmessung (der den Pfad nicht
    // liefert), während ein echt gemessener Wert 0 weiterhin erscheint.
    if (raw == null) continue;
    let disp: number | boolean | string;
    if (f.valueType === "bool") disp = toNum(raw) > 0.5;
    else if (f.valueType === "string") disp = raw == null ? "" : String(raw);
    else disp = num;
    display.push({ label: f.label, value: disp, unit: f.unit });
  }

  return { values, display };
}
