// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Datengetriebenes Quellen-Modell.
//
// Eine Quelle ist ein konfigurierbares Objekt: URL, Intervall, Timeout und
// eine Liste von Feldern. Jedes Feld liest einen Wert per JSON-Pfad aus der
// Antwort und ordnet ihn einer "Messgröße" (metric) zu. Die Aggregation
// summiert dann über alle Quellen je Rolle/Metrik – egal wie viele.

// === Achse 1: Rolle (rein bilanziell) ===
// Bestimmt NUR, wie eine Quelle in die Energiebilanz einfließt.
export type SourceRole =
  | "grid" // Netz-Smartmeter (Bezug/Einspeisung)
  | "pv" // PV-Erzeugung (mit pvTarget ac/dc)
  | "batteryOut" // Batterie-Einspeisung ins Hausnetz (Entladung)
  | "batteryIn" // AC-Speicher, der aus dem Netz lädt (Netzladung)
  | "acBattery" // AC-Speicher mit eigener lokaler API (z.B. Marstek Venus C/D/E
  //             über UDP-JSON-RPC). Entladung zählt als Abgabe ans Haus
  //             (wie batteryOut), Ladung als Netzladung (wie batteryIn). Alle
  //             verfügbaren Telemetriedaten werden abgefragt und angezeigt.
  | "dcBattery" // DC-gekoppelter Speicher: hat selbst keine eigene Messung,
  //             sondern verweist auf zwei bestehende Quellen – eine PV-Quelle
  //             (dcLinkedPv, liefert die Lade-/DC-PV-Daten) und eine
  //             batteryOut-Quelle (dcLinkedBatteryOut, liefert die Entladung).
  //             Aus beiden verlinkten Quellen ergeben sich Lade-/Entladeleistung
  //             und weitere Kennwerte des Speichers. Zählt selbst NICHT doppelt
  //             in die Bilanz – die verlinkten Quellen tun das bereits.
  | "consumer" // Verbraucher (Auto, Heizstab, Klima, Wärmepumpe, …)
  | "helper" // Hilfsmessung: wird eingelesen, zählt NIRGENDS in der
  //             Bilanz/Tabelle, dient nur als Eingang für Korrektur-Formeln
  //             (z.B. Balkon-PV, die in den Klima-Verbrauch gegengerechnet wird).
  | "grid42c" // Netz (Bezug/Einspeisung) §42c: echter externer Zähler eines
  //             Abnehmer-Haushalts für Energy Sharing. Wird per URL/Feldern
  //             abgefragt. Zählt NICHT in die eigene Bilanz/Übersicht; wird nur
  //             für die Energy-Sharing-Analyse im 15-Min-Takt erfasst.
  | "grid42cEmu" // Netz (Bezug/Einspeisung) §42c Emulation: simulierter Abnehmer.
  //             Keine URL/Felder – die Werte kommen aus dem Lastprofil-
  //             Simulator (BDEW H25/G25/L25/P25/S25), skaliert auf den
  //             eingegebenen Jahresverbrauch. Verhält sich bilanziell wie grid42c.
  | "gridEmu" // Netz (Bezug/Einspeisung) Emulation: simuliert den EIGENEN
  //             Haushalt (virtueller Netzzähler). Werte = Lastprofil (skaliert
  //             auf jahresverbrauch) minus Erzeugungsprofil (skaliert auf kwp,
  //             Profile sind auf 1 kWp normiert). Verhält sich bilanziell wie grid.
  | "info" // reine Infoquelle (z.B. Temperatursensoren) – im Diagramm/Status,
  //             aber nicht in der Bilanz und nicht in der Verbraucher-Tabelle.
  | "waterTank" // Warmwasserspeicher-Temperaturen: genau zwei °C-Werte (oben/
  //             unten), die auf der Übersicht am Speicher angezeigt werden. Zählt
  //             nicht in die Bilanz. Nur wenn eine solche Quelle existiert, werden
  //             die Speichertemperaturen auf der Übersichtsseite eingeblendet.
  | "water"; // Wasserzähler des Hauses (misst keinen Strom). Zählerstand in m³,
//             z.B. via AI-on-the-Edge (/json -> main.value). Wird zu Wasser-
//             Viertelstunden und Tagesverbräuchen verarbeitet.

// === Achse 2: Gerätetyp (nur Darstellung) ===
// Steuert Name/Icon in der Verbraucher-Tabelle und die Gruppierung auf der
// Statusseite. Hat KEINE Bilanz-Wirkung.
export type DeviceType =
  | "car" // E-Auto (evcc): zeigt zusätzlich SoC/verbunden
  | "heater" // Heizstab Warmwasser
  | "heatpump" // Wärmepumpe (viele Zusatz-Datenpunkte)
  | "climate" // Klimaanlage
  | "generic"; // sonstiger Verbraucher

// Messgrößen, die ein Feld einer Quelle zugeordnet werden können.
export type Metric =
  | "power" // momentane Leistung (W) – Kernwert (Bilanz/Tabelle/Diagramm)
  | "energyTotal" // Energiezähler gesamt (kWh) -> Tagesdifferenz
  | "energyReturnTotal" // zurückgespeiste Energie (kWh, Shelly ret_aenergy) -> Entladung AC-Speicher
  | "gridInTotal" // Netzbezug-Zähler gesamt (kWh)
  | "gridOutTotal" // Netzeinspeisung-Zähler gesamt (kWh)
  | "soc" // Ladezustand (%)
  | "voltage" // Spannung (V)
  | "temperature" // Temperatur (°C)
  | "rate" // Drosselung/ActivePowerRate (%)
  | "connected" // bool (z.B. Auto verbunden)
  | "info"; // generischer Anzeigewert (nur Statusseite)

// Werttyp eines Feldes. Default "number". "bool"/"string" für Zustände
// wie "Warmwasserbetrieb" oder "Abtauung aktiv".
export type ValueType = "number" | "bool" | "string";

// Ein einzelnes Feld: liest jsonPath aus der Antwort, ordnet es metric zu.
export interface SourceField {
  metric: Metric;
  jsonPath: string; // Punkt-Pfad, z.B. "total.Power.v" oder "switch:0.apower"
  label: string; // Anzeigename auf der Statusseite
  unit: string; // "W", "kWh", "%", "V", "°C", ""
  scale?: number; // optionaler Umrechnungsfaktor (z.B. 1/1000/60), Default 1
  valueType?: ValueType; // Default "number"
}

// Korrektur-Term für virtuelle Verbraucher: addiert/subtrahiert die
// power-Metrik einer anderen Quelle.
export interface PowerCorrection {
  sourceId: string; // ID der Korrektur-Quelle (z.B. Balkon-PV)
  sign: "+" | "-"; // Vorzeichen
}

// Eine Quelle.
export interface SourceConfig {
  id: string; // eindeutige ID (stabil, für DB-Anker)
  label: string; // Anzeigename
  role: SourceRole; // Bilanz-Rolle
  deviceType?: DeviceType; // nur bei role "consumer": Darstellungstyp
  icon?: string; // optionales benutzerdefiniertes Icon (Emoji) für Tabelle/Status
  room?: string; // optionaler Raum (für Gruppierung der Verbraucher-Tabelle)
  url: string; // abzufragende URL (liefert JSON)
  enabled: boolean; // wird abgefragt?
  intervalSec: number; // Poll-Intervall
  timeoutMs: number; // HTTP-Timeout
  fields: SourceField[]; // welche Werte gelesen werden

  // --- Anbindungsart ---------------------------------------------------------
  // "rest"  = aktives Polling per HTTP(S) und JSON (Default, abwärtskompatibel).
  // "mqtt"  = passiver Empfang: der MQTT-Client abonniert mqttTopic und cached
  //           die letzte JSON-Payload; die Feld-Extraktion (jsonPath) arbeitet
  //           dann auf dieser Payload. Bei mqtt werden url/intervalSec/timeoutMs
  //           für die Abfrage nicht verwendet.
  // "udp"   = Marstek lokale API (UDP JSON-RPC), Speichermodell über acModel.
  // "modbus"= Modbus TCP (Port 502), Speichermodell über modbusModel.
  connection?: "rest" | "mqtt" | "udp" | "modbus";

  // --- Modbus TCP (nur bei connection "modbus") ------------------------------
  // Zieladresse wird aus url (Host/IP) und modbusPort (Default 502) gebildet.
  modbusPort?: number;   // TCP-Port, Default 502
  modbusUnitId?: number; // Modbus Unit-/Slave-ID, Default 1
  // Unterstützte Marstek-Modelle: "venus-e", "venus-a".
  modbusModel?: string;

  // --- REST-Authentifizierung ------------------------------------------------
  // "none" (Default) = keine Auth (lokales Netz). "bearer" = Authorization:
  // Bearer <token>. Weitere Verfahren lassen sich hier später ergänzen.
  authType?: "none" | "bearer";
  bearerToken?: string; // nur bei authType "bearer"

  // --- MQTT-Verbindung (nur bei connection "mqtt") ---------------------------
  mqttUrl?: string;   // Broker-URL, z. B. mqtt://192.168.178.10:1883 oder mqtts://...
  mqttTopic?: string; // zu abonnierendes Topic, z. B. "tele/shelly/SENSOR"
  // Authentifizierung am Broker:
  //  "none"      = anonym
  //  "userpass"  = Benutzername + Passwort
  //  "clientcert"= TLS-Client-Zertifikat (mqtts) mit Cert/Key (+ optional CA)
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientCert?: string; // PEM (bei clientcert)
  mqttClientKey?: string;  // PEM (bei clientcert)
  mqttCaCert?: string;     // PEM der CA (optional, bei selbstsignierten Brokern)
  mqttRejectUnauthorized?: boolean; // TLS-Zertifikat prüfen? Default true
  // Virtueller Verbraucher: echte Leistung = eigene power + Summe der
  // Korrektur-Terme. Beispiel Klima: Basis Shelly + Balkon-PV (geteilte
  // Leitung, Shelly misst nur die Differenz).
  powerCorrections?: PowerCorrection[];
  // Nur für Rolle "pv": Wohin speist der Erzeuger?
  //  "ac" = ins Hausnetz (Default), "dc" = in die Batterie (DC-Laderegler)
  pvTarget?: "ac" | "dc";
  // Wie fließt diese Quelle in die Viertelstunden-Energiebilanz ein?
  //  "counter" (Default): aus Zählerdifferenzen (energyTotal) – exakt, aber bei
  //     grob quantisierten Zählern (z.B. Growatt in 0,1-kWh-Schritten) entstehen
  //     einzelne Viertelstunden ohne Beitrag, weil der Zähler nicht springt.
  //  "integrated": aus der zeitintegrierten Momentanleistung (power). Glättet die
  //     groben Zählersprünge, hängt aber an der Poll-Auflösung. Sinnvoll v.a. für
  //     PV-Wechselrichter mit grober Energieauflösung, aber feiner Leistung.
  energySource?: "counter" | "integrated";
  // Gemockte Datenquelle statt HTTP-Abruf. "emu" spielt ein BDEW-Lastprofil
  // ein (Auswahl über emuProfile, skaliert auf jahresverbrauch). "gridEmu"
  // simuliert den eigenen Haushalt: Lastprofil minus Erzeugungsprofil. Für
  // Energy-Sharing-Tests/-Betrieb ohne echten externen Zähler bzw. ohne echte
  // eigene Anlage.
  mock?: "emu" | "gridEmu";
  // Gewähltes BDEW-Lastprofil der Emulation (H25/G25/L25/P25/S25), Default H25.
  emuProfile?: string;
  // Ziel-Jahresverbrauch (kWh/a) der gemockten Quelle.
  jahresverbrauch?: number;
  // Nur für Rolle "gridEmu": gewähltes Erzeugungsprofil (auf 1 kWp normiert)
  // und die PV-Anlagengröße (kWp), auf die das Erzeugungsprofil skaliert wird.
  erzeugungsProfile?: string;
  kwp?: number;
  // Statische Verteilungsquote (%) für Energy Sharing (nur Anzeige/Default;
  // wird im Energy-Sharing-Modul verwendet, wenn "statischer Schlüssel" gewählt).
  sharingQuote?: number;
  // Nur für Rolle "acBattery": um welches Speichermodell handelt es sich? Steuert
  // das Abfrageprotokoll. Aktuell: "marstek-venus" (Venus C/D/E, UDP-JSON-RPC).
  acModel?: string;
  // Nur für Rolle "acBattery": UDP-Port der lokalen API (Marstek-Default 30000).
  acUdpPort?: number;
  // Nur für generische MQTT-AC-Speicher mit Zendure-Steuerung: App-Key und
  // Seriennummer für das MQTT-Properties-Write-Topic. Ist beides gesetzt und
  // acModel = "zendure", bietet die AC-Speicher-Seite Steuerung per MQTT an.
  zendureAppKey?: string;
  zendureSerial?: string;
  // Max. Lade-/Entladeleistung (W) für die Zendure-Steuerung (Default 800).
  zendureMaxChargeW?: number;
  zendureMaxDischargeW?: number;
  // Beliebige weitere URLs je Quelle (z. B. Link zur Weboberfläche des Geräts),
  // jeweils mit einem Beschreibungstext, der als Link-Name dient. Rein zur
  // Anzeige – diese URLs werden nicht abgefragt.
  extraLinks?: ExtraLink[];

  // Schaltbarkeit für Automatisierungsregeln: Shelly Plug/Pro/2PM etc. haben
  // schaltbare Relais-Ausgänge, reine Messgeräte (Shelly PM/PM Mini) nicht.
  // switchable=true blendet die Quelle als Schaltziel in Regeln ein.
  switchable?: boolean;
  switchChannels?: number; // Anzahl schaltbarer Kanäle des Geräts (Default 1)
  // Welcher Kanal (0-basiert) tatsächlich für die Schaltung dieser Quelle
  // zuständig ist. Bei einem Mehrkanal-Shelly, an dem nur ein bestimmter Ausgang
  // die Quelle schaltet. Default 0 (erster Kanal).
  switchChannel?: number;
  // Optionale abweichende Basis-URL fürs Schalten (sonst wird aus url abgeleitet).
  switchUrl?: string;
  // Verknüpfung zweier Quellen zum SELBEN Gerät: Liefert eine andere Quelle die
  // Leistungsaufnahme dieses Geräts (z. B. Wärmepumpe: Betriebsdaten per
  // HeishaMon in DIESER Quelle, Leistung aber von einem separaten Shelly), trägt
  // man hier die ID der Leistungs-Quelle ein. Diese Quelle übernimmt dann deren
  // power-Wert; die Leistungs-Quelle selbst wird als "untergeordnet" behandelt
  // (siehe subordinateOf) und taucht nicht als eigenes Gerät in der Bilanz auf.
  powerSourceId?: string;
  // Kennzeichnet diese Quelle als reinen Leistungslieferanten einer anderen
  // Quelle (Gegenstück zu powerSourceId). Sie wird dann NICHT als eigenständiges
  // Gerät gewertet, sondern nur ihr power-Wert von der Hauptquelle übernommen.
  subordinateOf?: string;
  // Nur für Rolle "dcBattery": Verweise auf die Quellen, aus denen sich die
  // Speicherdaten ergeben. dcLinkedPv = ID einer PV-Quelle (Ladung/DC-PV,
  // optional – z. B. wenn der Laderegler nicht auslesbar ist),
  // dcLinkedBatteryOut = ID einer batteryOut-Quelle (Entladung ins Hausnetz).
  // dcLinkedCharger = optionale ID eines AC-Ladegeräts, das zu diesem Speicher
  // gehört. Die Schalter auf der Speicher-Seite ergeben sich implizit aus diesen
  // verlinkten Quellen, soweit sie schaltbar sind.
  dcLinkedPv?: string;
  dcLinkedBatteryOut?: string;
  dcLinkedCharger?: string;
}

// Zusätzlicher benannter Link einer Quelle (nur Anzeige, kein Abruf).
export interface ExtraLink {
  url: string;
  label: string;
}

// Prüft, ob eine Rolle eine §42c-Energy-Sharing-Rolle ist (echter Zähler oder
// Emulation). Beide werden im Energy Sharing gleich behandelt und auf der
// Statusseite gemeinsam unter "Netz §42c" gruppiert.
export function is42cRole(role: SourceRole): boolean {
  return role === "grid42c" || role === "grid42cEmu";
}

// --- Default-Konfiguration: bildet das bisherige Setup 1:1 ab ---
// IDs bewusst stabil gewählt (entsprechen den alten Anker-Keys, soweit
// möglich), damit bestehende DB-Anker weiter passen.
export const DEFAULT_SOURCES: SourceConfig[] = [
  {
    id: "hichi",
    label: "Hichi (Netz-Smartmeter)",
    role: "grid",
    url: "http://192.168.178.99/cm?cmnd=status+10",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "StatusSNS.SML.Power_curr", label: "Leistung", unit: "W" },
      { metric: "gridInTotal", jsonPath: "StatusSNS.SML.Total_in", label: "Bezug gesamt", unit: "kWh" },
      { metric: "gridOutTotal", jsonPath: "StatusSNS.SML.Total_out", label: "Einspeisung gesamt", unit: "kWh" },
    ],
  },
  {
    id: "growatt",
    label: "Growatt",
    role: "pv",
    url: "http://192.168.178.106/status",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "OutputPower", label: "Leistung", unit: "W" },
      { metric: "energyTotal", jsonPath: "TotalGenerateEnergy", label: "Ertrag gesamt", unit: "kWh" },
      { metric: "rate", jsonPath: "ActivePowerRate", label: "Drosselung", unit: "%" },
      { metric: "temperature", jsonPath: "InverterTemperature", label: "Temperatur", unit: "°C" },
    ],
  },
  {
    id: "growattMic",
    label: "Growatt MIC",
    role: "pv",
    url: "http://192.168.178.138/status",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "OutputPower", label: "Leistung", unit: "W" },
      { metric: "energyTotal", jsonPath: "TotalGenerateEnergy", label: "Ertrag gesamt", unit: "kWh" },
      { metric: "rate", jsonPath: "ActivePowerRate", label: "Drosselung", unit: "%" },
      { metric: "temperature", jsonPath: "InverterTemperature", label: "Temperatur", unit: "°C" },
    ],
  },
  {
    id: "openDtu",
    label: "OpenDTU (PV)",
    role: "pv",
    url: "http://192.168.178.39/api/livedata/status",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "energyTotal", jsonPath: "total.YieldTotal.v", label: "Ertrag gesamt", unit: "kWh" },
    ],
  },
  {
    id: "epever",
    label: "EPEver (Laderegler)",
    role: "pv",
    pvTarget: "dc",
    url: "http://192.168.178.51/AllJsonData",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "BatteryP", label: "Leistung", unit: "W" },
      { metric: "energyTotal", jsonPath: "Generated_All", label: "Ertrag gesamt", unit: "kWh" },
      { metric: "voltage", jsonPath: "BatteryV", label: "Spannung", unit: "V" },
      { metric: "soc", jsonPath: "BatterySOC", label: "Batterie-SoC", unit: "%" },
    ],
  },
  {
    id: "shellySoyo",
    label: "Shelly Soyo (Speicher)",
    role: "batteryOut",
    url: "http://192.168.178.50/meter/0/status",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "power", label: "Leistung", unit: "W" },
      // total ist in Wmin -> /1000/60 = kWh
      { metric: "energyTotal", jsonPath: "total", label: "Energie gesamt", unit: "kWh", scale: 1 / 1000 / 60 },
    ],
  },
  {
    id: "grundlast",
    label: "Tasmota Grundlast",
    role: "batteryOut",
    url: "http://192.168.178.30/cm?cmnd=status%2010",
    enabled: false,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "StatusSNS.ENERGY.Power", label: "Leistung", unit: "W" },
      { metric: "energyTotal", jsonPath: "StatusSNS.ENERGY.Total", label: "Energie gesamt", unit: "kWh" },
    ],
  },
  {
    id: "openDtuWz",
    label: "Balkon-PV Wohnzimmer (Hilfswert)",
    role: "helper",
    url: "http://192.168.178.39/api/livedata/status?inv=114183720053",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "inverters.0.AC.0.Power.v", label: "Leistung", unit: "W" },
    ],
  },
  {
    id: "shellyKlima",
    label: "Klimaanlage",
    role: "consumer",
    deviceType: "climate",
    room: "Gebäudeenergietechnik",
    url: "http://192.168.178.114/rpc/Shelly.GetStatus",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    // Klima und Balkon-PV teilen sich eine Stromleitung; der Shelly misst
    // nur die Differenz. Echter Verbrauch = Shelly + Balkon-PV-Einspeisung.
    powerCorrections: [{ sourceId: "openDtuWz", sign: "+" }],
    fields: [
      { metric: "power", jsonPath: "switch:0.apower", label: "Leistung (Shelly)", unit: "W" },
    ],
  },
  {
    id: "shellyUni",
    label: "Warmwasserspeicher (Shelly Uni)",
    role: "waterTank",
    url: "http://192.168.178.69/status",
    enabled: true,
    intervalSec: 144,
    timeoutMs: 3000,
    fields: [
      { metric: "temperature", jsonPath: "ext_temperature.1.tC", label: "Temperatur oben", unit: "°C" },
      { metric: "temperature", jsonPath: "ext_temperature.4.tC", label: "Temperatur unten", unit: "°C" },
    ],
  },
  {
    id: "evcc",
    label: "E-Auto",
    role: "consumer",
    deviceType: "car",
    room: "Carport",
    url: "http://192.168.178.85:7070/api/state?jq=.loadpoints",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      // jq=.loadpoints liefert das Array direkt -> Index 0 = erster Ladepunkt
      { metric: "connected", jsonPath: "0.connected", label: "verbunden", unit: "", valueType: "bool" },
      { metric: "power", jsonPath: "0.chargePower", label: "Ladeleistung", unit: "W" },
      { metric: "soc", jsonPath: "0.vehicleSoc", label: "Auto-SoC", unit: "%" },
    ],
  },
  {
    id: "heizstab",
    label: "Heizstab (Warmwasser)",
    role: "consumer",
    deviceType: "heater",
    room: "Gebäudeenergietechnik",
    // Direkt am Shelly Pro 2PM (statt über evcc): Heizstab hängt an Ausgang 1
    // (Kanal 0 / switch:0). Ausgang 2 (switch:1) versorgt den Marstek-AC-Speicher.
    url: "http://192.168.178.125/rpc/Shelly.GetStatus",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "switch:0.apower", label: "Leistung", unit: "W" },
    ],
  },
  {
    id: "battCharger",
    label: "Batterieladegerät (AC-Lader)",
    role: "batteryIn",
    room: "Gebäudeenergietechnik",
    url: "http://192.168.178.150/rpc/Shelly.GetStatus",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "switch:0.apower", label: "Ladeleistung", unit: "W" },
      // aenergy.total ist in Wh -> /1000 = kWh
      { metric: "energyTotal", jsonPath: "switch:0.aenergy.total", label: "Geladen gesamt", unit: "kWh", scale: 1 / 1000 },
    ],
  },
  {
    id: "waermepumpe",
    label: "Wärmepumpe",
    role: "consumer",
    deviceType: "heatpump",
    room: "Gebäudeenergietechnik",
    url: "http://192.168.178.64/json",
    enabled: false,
    intervalSec: 30,
    timeoutMs: 3000,
    // HeishaMon /json liefert die Werte als Array "heatpump" mit Objekten
    // {Topic, Name, Value}. Zugriff per Selektor [Name=...].Value (robust
    // gegen wechselnde Reihenfolge zwischen Firmware-Versionen).
    fields: [
      // Kernwert (Tabelle/Diagramm): aktuelle Heizleistung (TOP15)
      { metric: "power", jsonPath: "heatpump[Name=Heat_Power_Production].Value", label: "Heizleistung", unit: "W" },
      // Betriebsmodus (TOP4) als Text
      { metric: "info", jsonPath: "heatpump[Name=Operating_Mode_State].Value", label: "Betriebsmodus", unit: "", valueType: "string" },
      // Vorlauf (TOP6) / Rücklauf (TOP5)
      { metric: "temperature", jsonPath: "heatpump[Name=Main_Outlet_Temp].Value", label: "Vorlauftemperatur", unit: "°C" },
      { metric: "temperature", jsonPath: "heatpump[Name=Main_Inlet_Temp].Value", label: "Rücklauftemperatur", unit: "°C" },
      // Warmwasserspeicher-Temperatur (TOP10, DHW = Domestic Hot Water)
      { metric: "temperature", jsonPath: "heatpump[Name=DHW_Temp].Value", label: "Wasserspeichertemperatur", unit: "°C" },
      // Kompressorfrequenz (TOP8)
      { metric: "info", jsonPath: "heatpump[Name=Compressor_Freq].Value", label: "Kompressorfrequenz", unit: "Hz" },
      // Volumenstrom (TOP1)
      { metric: "info", jsonPath: "heatpump[Name=Pump_Flow].Value", label: "Volumenstrom", unit: "l/min" },
      // Abtauung/Enteisung (TOP26) als Ja/Nein
      { metric: "info", jsonPath: "heatpump[Name=Defrosting_State].Value", label: "Abtauung", unit: "", valueType: "bool" },
    ],
  },
  {
    id: "leuchtturm",
    label: "Leuchtturm Lampe",
    role: "consumer",
    deviceType: "generic",
    room: "Flur OG",
    // Alter Shelly Plug S (Gen1): Leistung unter meter/0 -> power
    url: "http://192.168.178.61/meter/0",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      { metric: "power", jsonPath: "power", label: "Leistung", unit: "W" },
    ],
  },
  // --- Weitere Verbraucher (Shelly, nur Momentanleistung) ---
  // Alle über /rpc/Shelly.GetStatus. PM-Mini-Geräte (kein Relais) liefern
  // die Leistung unter "pm1:0.apower", Plug-/Switch-Geräte unter
  // "switch:0.apower".
  ...shellyConsumers([
    { id: "camper", label: "Camper Landstrom", ip: "31", kind: "pm", room: "Carport" },
    { id: "drucker3d", label: "3D Drucker", ip: "126", kind: "switch", room: "Gästezimmer" },
    { id: "drucker", label: "Drucker", ip: "122", kind: "switch", room: "Büro" },
    { id: "waschmaschine", label: "Waschmaschine", ip: "137", kind: "pm", room: "Hauswirtschaftsraum" },
    { id: "trockner", label: "Trockner", ip: "139", kind: "pm", room: "Hauswirtschaftsraum" },
    { id: "lueftung", label: "Lüftungsanlage", ip: "146", kind: "pm", room: "Gebäudeenergietechnik" },
    { id: "gefrierschrank", label: "Gefrierschrank", ip: "147", kind: "switch", room: "Hauswirtschaftsraum" },
    { id: "kuehlschrankKlein", label: "Kleiner Kühlschrank", ip: "117", kind: "switch", room: "Hauswirtschaftsraum" },
    { id: "geschirrspueler", label: "Geschirrspüler", ip: "145", kind: "switch", room: "Küche" },
    { id: "kuehlschrank", label: "Kühlschrank", ip: "148", kind: "switch", room: "Küche" },
    { id: "solarthermie", label: "Solarthermie", ip: "164", kind: "pm", room: "Gebäudeenergietechnik", icon: "☀️" },
  ]),

  // --- Energy Sharing §42c: gemockte externe Nachbar-Zähler ---
  // Spielen das BDEW-H25-Lastprofil ein (skaliert auf jahresverbrauch).
  // Rolle grid42c -> zählt NICHT in die eigene Bilanz/Übersicht, wird aber im
  // 15-Min-Takt für die Energy-Sharing-Analyse erfasst. Standardmäßig aktiv,
  // damit das Feature direkt ausprobiert werden kann.
  {
    id: "nachbarA",
    label: "Nachbar A (§42c)",
    role: "grid42cEmu",
    url: "",
    enabled: true,
    intervalSec: 30,
    timeoutMs: 3000,
    mock: "emu",
    emuProfile: "H25",
    jahresverbrauch: 3500,
    sharingQuote: 50,
    fields: [
      { metric: "power", jsonPath: "power", label: "Bezug Ø/Viertelstunde", unit: "W" },
      { metric: "gridInTotal", jsonPath: "meter", label: "Bezug gesamt", unit: "kWh" },
      { metric: "gridOutTotal", jsonPath: "meterOut", label: "Einspeisung gesamt", unit: "kWh" },
    ],
  },
  {
    id: "nachbarB",
    label: "Nachbar B (§42c)",
    role: "grid42cEmu",
    url: "",
    enabled: true,
    intervalSec: 30,
    timeoutMs: 3000,
    mock: "emu",
    emuProfile: "G25",
    jahresverbrauch: 2500,
    sharingQuote: 50,
    fields: [
      { metric: "power", jsonPath: "power", label: "Bezug Ø/Viertelstunde", unit: "W" },
      { metric: "gridInTotal", jsonPath: "meter", label: "Bezug gesamt", unit: "kWh" },
      { metric: "gridOutTotal", jsonPath: "meterOut", label: "Einspeisung gesamt", unit: "kWh" },
    ],
  },
];

// Helper: erzeugt consumer-Quellen für einfache Shelly-Leistungsmesser.
// kind "pm"  -> PM Mini Gen3 (kein Relais): Leistung unter pm1:0.apower
// kind "switch" -> Plug/Switch-Geräte:      Leistung unter switch:0.apower
function shellyConsumers(
  defs: Array<{ id: string; label: string; ip: string; kind: "pm" | "switch"; room?: string; icon?: string; fieldLabel?: string }>
): SourceConfig[] {
  return defs.map((d) => ({
    id: d.id,
    label: d.label,
    role: "consumer" as const,
    deviceType: "generic" as const,
    room: d.room,
    icon: d.icon,
    url: `http://192.168.178.${d.ip}/rpc/Shelly.GetStatus`,
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [
      {
        metric: "power" as const,
        jsonPath: d.kind === "pm" ? "pm1:0.apower" : "switch:0.apower",
        label: d.fieldLabel ?? "Leistung",
        unit: "W",
      },
    ],
  }));
}
