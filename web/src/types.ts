// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Gemeinsame Typen – werden von Backend und (kopiert) Frontend genutzt.

// Ein Verbraucher-Eintrag für die Tabelle unter dem Diagramm.
export interface ConsumerEntry {
  id: string;
  label: string;
  deviceType: string; // car/heater/heatpump/climate/generic
  role?: string; // echte Quellen-Rolle für das korrekte Default-Icon
  icon?: string; // optionales benutzerdefiniertes Icon (Emoji); überschreibt deviceType-Icon
  room?: string; // Raum (für Gruppierung), leer = "Ohne Raum"
  power: number; // W (echte Leistung, inkl. Korrekturen)
  bidirectional?: boolean; // AC-Speicher: power kann +/− sein (Laden/Einspeisen)
  energyDay: number; // kWh heute verbraucht (zeitintegriert, inkl. laufender VS)
  energyDayFeedin?: number; // bei bidirektionalen Speichern: kWh heute eingespeist/entladen
  url: string; // Link (Statusseite/Gerät)
  // weitere benannte Links der Quelle (z.B. Weboberfläche); rein zur Anzeige
  extraLinks?: Array<{ url: string; label: string }>;
  // optionaler Kontextwert (z.B. Auto-SoC, WP-Status)
  context?: { label: string; value: number | boolean | string; unit: string };
  disabled?: boolean; // zugehörige Quelle deaktiviert
}

// Aggregierte Live-Werte, berechnet aus allen konfigurierten Quellen je
// Rolle. Ersetzt die früheren hartcodierten Einzelquellen-Felder.
export interface LiveData {
  // Netz (grid): negative Leistung = Einspeisung, positive = Bezug
  gridPower: number; // W (Summe grid-Quellen)
  gridInTotal: number; // kWh Bezug gesamt
  gridOutTotal: number; // kWh Einspeisung gesamt

  // PV-Erzeugung (pv): Summe aller PV-Quellen
  pvPower: number; // W (gesamt, AC + DC)
  pvDcPower: number; // W (nur DC-Lader, z.B. EPEver -> Batterie)
  // Batterie-Einspeisung (batteryOut)
  batteryOutPower: number; // W
  // Batterie-Netzladung (batteryIn): AC-Speicher, der aus dem Netz lädt
  batteryInPower: number; // W

  // §42c Energy Sharing: aktuelle Summe der Abnehmer-Leistung (W), die gerade
  // über das Netz an externe §42c-Abnehmer geliefert wird (nur positiver Bezug).
  // sharing42cPowerNow = davon der durch eigene Einspeisung gedeckte Anteil.
  // sharing42cPowerNowOther = der vom Reststromlieferanten gedeckte Rest.
  sharing42cPowerNow: number; // W
  sharing42cPowerNowOther: number; // W
  // §42c-Tagesenergie (kWh): über den Tag integrierter Eigenanteil, den ich
  // über meine Einspeisung zum Energiebedarf der Abnehmer beigetragen habe.
  sharing42cEnergyDay: number; // kWh
  // §42c-Momentanleistung des Eigenanteils, aufgeteilt nach Quelle:
  // pvTo42cPower = aus PV-Direkteinspeisung, batteryTo42cPower = aus Batterie.
  pvTo42cPower: number; // W
  batteryTo42cPower: number; // W

  // Infowerte fürs Diagramm
  batterySoC: number; // höchster SoC einer pv/battery-Quelle (Anzeige)
  // Alle Speicher mit ihrem SoC für die Übersicht, in Konfigurationsreihenfolge
  // und durchnummeriert (AC1, AC2, DC1, …). soc = null, wenn nicht verfügbar.
  batterySocs?: Array<{ label: string; soc: number | null; power: number | null }>;
  batteryVoltage: number;
  tankUpTemp: number;
  tankDownTemp: number;

  // Verbraucher-Aufschlüsselung (für die Tabelle unter dem Diagramm).
  consumers: ConsumerEntry[];
}

// Pro Tag berechnete Werte (rollenbasiert).
export interface DayData {
  gridDayBezug: number; // kWh Netzbezug heute
  gridDayEingespeist: number; // kWh Einspeisung heute
  pvDay: number; // kWh PV-Erzeugung heute (alle pv-Quellen, AC + DC)
  pvDcDay: number; // kWh PV->Batterie (nur DC-Lader)
  batteryOutDay: number; // kWh Batterie-Einspeisung heute
  batteryInDay: number; // kWh Batterie-Netzladung heute
  energyDayConsumed: number; // selbst verbrauchter Anteil
  hausverbrauchDayMonoton: number; // kumulierter Tagesverbrauch, monoton geklemmt (Anzeige)
  pvConsumedDayMonoton: number; // im Haus direkt verbrauchte PV-Energie, monoton geklemmt (Anzeige)
  energyAutarkie: number; // %
  costsAdded: number; // € (Bezugskosten − Einspeisevergütung, on-the-fly)
  tagesBezugskosten: number; // € Bezugskosten heute (VS-genau, brutto)
  tagesEinspeiseverguetung: number; // € Einspeisevergütung heute (EEG-abhängig)
  tagesSharingVerguetung: number; // € §42c-Vergütung heute (an Abnehmer geliefert)
  // §42c: heute zum Abnehmerbedarf beigetragene Energie (kWh), aufgeteilt nach
  // Quelle des Eigenanteils: pvTo42cEnergy = aus PV-Direkteinspeisung,
  // batteryTo42cEnergy = aus Batterie-Einspeisung. (Berechnung folgt.)
  pvTo42cEnergy: number; // kWh
  batteryTo42cEnergy: number; // kWh
}

// Ein Tageshistorie-Eintrag (entspricht history[i][0..5] + Datum)
export interface HistoryEntry {
  date: string;
  verbrauch: number;
  // "PV+Speicher" (Summe, für Abwärtskompatibilität) sowie aufgeschlüsselt:
  pvSpeicher: number; // selbst verbrauchte Energie aus PV + Speicher (Summe)
  pvDirekt: number; // davon unmittelbar aus der PV-Anlage (kWh)
  speicher: number; // davon aus dem Batteriespeicher (kWh)
  netzbezug: number;
  // Gesamte das Haus verlassende Einspeisung (inkl. der an §42c-Abnehmer
  // gelieferten Energie – diese fließt über denselben Netzanschluss).
  eingespeist: number;
  // Davon an §42c-Abnehmer geliefert, aufgeschlüsselt nach Herkunft:
  eingespeist42cPv: number; // aus eigener PV (kWh)
  eingespeist42cSpeicher: number; // aus eigenem Speicher (kWh)
  autarkie: number;
}

// Ein Drosselungs-Eintrag
export interface DrosselungEntry {
  date: string;
  value: number;
  source: string; // Quellen-ID des Wechselrichters
}

// Day-Ahead-Spotpreise eines Liefertags (Viertelstundenwerte in ct/kWh).
export interface SpotpreisTag {
  date: string; // YYYY-MM-DD
  prices: number[]; // ct/kWh, i.d.R. 96 Werte (4 je Stunde)
  fetched: string; // ISO-Zeitstempel des Abrufs
  sourceUrl?: string; // öffentliche Abruf-URL für diesen Tag (Energy-Charts)
}

// Abnehmer (externer Haushalt) für Energy Sharing nach §42c.
// Abstraktion über eine grid42c-Quelle: bekommt einen Namen, eine
// §42c-Vergütung (€/kWh) und im Modus "statisch" eine feste Quote (%).
export interface Abnehmer {
  id: string;
  name: string;
  verguetung: number; // €/kWh
  sourceId: string; // zugeordnete grid42c-Quelle (echt oder H25-Mock)
  quote: number; // % (nur statischer Schlüssel); Summe über alle ≤ 100
}

// Senke: emulierter Shelly Pro 3EM, der einem Batteriespeicher als Regelziel
// dient. Liefert per JSON (/rpc/EM.GetStatus) eine momentane Wirkleistung
// (total_act_power, positiv = Bezug), die der Speicher auf 0 W ausregelt.
// Berechnung: max(0, min(maxLeistung, eigener Netzbezug + Σ Abnehmer-Bezug)),
// wobei der eigene Netzbezug aus der Basis-Quelle stammt (negativ = eigene
// Einspeisung, die den Bedarf reduziert).
export interface Sink {
  id: string;
  name: string;
  baseSourceId: string; // Basis-Quelle (Rolle grid) = eigener Hauszähler
  maxPowerW: number; // max. lieferbare Leistung (W); 0 = unbegrenzt
  enabled: boolean;
}

// Laufzeit-Status einer Senke für die Statusseite.
export interface SinkStatus {
  id: string;
  name: string;
  baseSourceId: string;
  baseSourceLabel: string;
  enabled: boolean;
  // Aktuell ausgegebene Leistung (W), wie über die JSON-Schnittstelle geliefert.
  outputPowerW: number;
  // Zerlegung für die Anzeige:
  eigenBezugW: number; // Basis-Quelle: positiv = Bezug, negativ = Einspeisung
  abnehmerBezugW: number; // Summe aktueller Abnehmer-Bezüge
  lastUpdate: string | null; // ISO-Zeitpunkt der letzten Aktualisierung
}

// Energiemengen einer abgeschlossenen Viertelstunde (jeweils in kWh).
export interface ViertelstundeEntry {
  ts: string; // Ende der Viertelstunde, lokal: YYYY-MM-DDTHH:MM
  eingespeist: number;
  bezogen: number;
  verbrauch: number;
  // Aufteilung der Einspeisung nach Herkunft (optional; Alt-Datensätze = 0):
  eingespeistPv?: number; // kWh aus PV-Überschuss
  eingespeistBatt?: number; // kWh aus Speicher-Einspeisung
  // Aufteilung des Hausverbrauchs nach Herkunft (Netz-Anteil = bezogen):
  verbrauchPv?: number; // kWh unmittelbar aus PV
  verbrauchSpeicher?: number; // kWh aus dem Speicher
  // An §42c-Abnehmer gelieferte Einspeisung dieser VS nach Herkunft:
  eingespeist42cPv?: number; // kWh aus PV
  eingespeist42cBatt?: number; // kWh aus Speicher
}

// Ein §14a-Zeitfenster: Uhrzeitbereich, in dem ein bestimmter Lasttarif gilt.
// "kind" = welcher Tarif; gültig in den angekreuzten Quartalen (1..4).
// Über Mitternacht erlaubt (z.B. 23:00–05:00): startMin > endMin.
export interface LoadWindow {
  kind: "hoch" | "niedrig"; // Standard gilt immer sonst
  startMin: number; // Minuten seit Mitternacht (0..1439)
  endMin: number; // Minuten seit Mitternacht (0..1439)
  quarters: number[]; // [1,2,3,4] = ganzjährig
}

// Persistente Einstellungen
export interface Settings {
  // --- Fixtarif (Gesamtpreis inkl. allem), €/kWh. Bleibt der maßgebliche
  // Wert für die Anzeige bei tarifMode "fix" und für Altberechnungen. ---
  strompreis: number;

  // --- Tarifmodell ---
  tarifMode: "fix" | "dyn";
  anbieterName: string;
  grundgebuehrMonat: number;
  messstelleEuroJahr: number;
  sofortbonus: number;
  neukundenbonus: number;
  // dyn: Beschaffung/Vertrieb (Börse/Arbeitspreis), ct/kWh netto
  beschaffung: number;
  // dyn: zusätzliche Preisbestandteile, alle ct/kWh netto
  stromsteuer: number;
  konzessionsabgabe: number;
  aufschlagNetznutzung: number; // Aufschlag besondere Netznutzung, ct/kWh netto
  offshoreUmlage: number;
  kwkgUmlage: number;
  umsatzsteuer: number; // Prozent, z.B. 19

  // --- Einspeisung, €/kWh ---
  einspeiseverguetung: number;
  // EEG-Regelung: "vor2502" = alte Regelung, "ab2502" = ab 25.02.2025
  // (keine EEG-Vergütung bei negativen Börsenpreisen für neue PV > 2 kWp)
  eegRegelung: "vor2502" | "ab2502";

  // --- §14a Modul 1 (pauschale Netzentgelt-Reduktion) ---
  paragraf14aModul1Aktiv: boolean;
  modul1PauschaleNetto: number; // €/Jahr, netto

  // --- §14a Modul 3 ---
  paragraf14aAktiv: boolean;
  netzentgeltStandard: number; // ct/kWh
  netzentgeltHoch: number; // ct/kWh
  netzentgeltNiedrig: number; // ct/kWh
  lastWindows: LoadWindow[];

  // --- Energy Sharing §42c ---
  // Verteilung der eigenen Netzeinspeisung auf die externen Haushalte:
  //  "dynamisch" = anteilig am tatsächlichen 15-Min-Verbrauch (Default)
  //  "statisch"  = feste Quoten je Haushalt (SourceConfig.sharingQuote)
  sharingMode: "dynamisch" | "statisch";

  // --- Visualisierung: einheitliche Chart-Farben je Energieart ---
  // --- Kosten (Tagespreisverlauf) ---
  vizColorSpotPositiv: string; // positiver Preis (dunkelgrün)
  vizColorSpotNegativ: string; // negativer Preis (rot)
  // --- Energie ---
  vizColorVerbrauchGesamt: string; // Verbrauch gesamt (blau)
  vizColorVerbrauchPv: string; // Verbrauch aus PV (gelb)
  vizColorVerbrauchSpeicher: string; // Verbrauch aus Speicher (dunkelgrün)
  vizColorNetzbezug: string; // Netzbezug (dunkelgrau)
  vizColorEinspeisungGesamt: string; // Einspeisung gesamt (schwarz)
  vizColorEinspeisungPv: string; // Einspeisung aus PV (hellgrau)
  vizColorEinspeisungSpeicher: string; // Einspeisung aus Speicher (dunkelorange)
  fontSizes?: Record<string, { desktop: number; mobile: number }>;

  // --- Reset-Zeitpunkt (Anzeige) ---
  hourLastReset: number;
  minuteLastReset: number;
  wasserFrischEuroM3: number;
  wasserAbwasserEuroM3: number;
  wasserGrundpreisMonat: number;
}

// Ein einzelner gelesener Wert einer Quelle (für die Statusseite)
export interface SourceValue {
  label: string; // z.B. "Leistung"
  value: number | boolean | string; // aktueller Wert
  unit: string; // z.B. "W", "kWh", "%"
}

// Status einer externen Datenquelle (für die Statusseite)
export interface SourceStatus {
  key: string; // Quellen-ID
  label: string; // Anzeigename
  url: string; // abgefragte URL
  role: string; // Rolle (grid/pv/batteryOut/batteryIn/consumer/helper/info)
  deviceType?: string; // bei consumer: car/heater/heatpump/climate/generic
  icon?: string; // optionales benutzerdefiniertes Icon (Emoji)
  lastSuccess: number | null; // Unix-ms des letzten erfolgreichen Lesens
  lastError: string | null; // letzte Fehlermeldung (falls vorhanden)
  ausgeschaltet?: boolean; // über verlinkten Schalter aus (kein Fehler)
  intervalSec: number; // konfiguriertes Poll-Intervall (für Schwellwert)
  switchable?: boolean; // schaltbarer Ausgang?
  switchState?: boolean | null; // aktueller Schaltzustand (an/aus), null = unbekannt
  switchVia?: string; // sourceId, über die geschaltet wird (verlinkte Quelle)
  enabled: boolean; // false = Quelle wird aktuell nicht abgefragt (ausgegraut)
  values: SourceValue[]; // aktuelle Werte der gelesenen Variablen
}

// Kompletter State, der per SSE an den Browser geht
export interface FullState {
  live: LiveData;
  day: DayData;
  history: HistoryEntry[];
  drosselungen: DrosselungEntry[];
  settings: Settings;
  sources: SourceStatus[];
  sinks: SinkStatus[];
  time: string; // HH:MM:SS
  date: string; // YYYY-MM-DD
  initDone: boolean;
  // Aktuell gültiger Strompreis (€/kWh), inkl. zeitabhängiger §14a-Korrektur.
  effektiverStrompreis: number;
}
