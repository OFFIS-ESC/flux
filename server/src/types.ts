// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Gemeinsame Typen – werden von Backend und (kopiert) Frontend genutzt.

// Ein Verbraucher-Eintrag für die Tabelle unter dem Diagramm.
export interface ConsumerEntry {
  id: string;
  label: string;
  deviceType: string; // car/heater/heatpump/climate/generic
  icon?: string; // optionales benutzerdefiniertes Icon (Emoji); überschreibt deviceType-Icon
  role?: string; // echte Quellen-Rolle (consumer/acBattery/batteryIn/batteryOut) für das korrekte Default-Icon
  room?: string; // Raum (für Gruppierung), leer = "Ohne Raum"
  power: number; // W (echte Leistung, inkl. Korrekturen)
  // true = bidirektionaler Speicher (AC-Batterie): power kann +/− sein, Bezug
  // und Einspeisung werden getrennt erfasst statt als Betrag summiert.
  bidirectional?: boolean;
  energyDay: number; // kWh heute verbraucht (zeitintegriert, inkl. laufender VS)
  // Bei bidirektionalen Speichern: kWh heute eingespeist/entladen (energyDay =
  // Bezug/Ladung, energyDayFeedin = Einspeisung/Entladung).
  energyDayFeedin?: number;
  url: string; // Link (Statusseite/Gerät)
  extraLinks?: Array<{ url: string; label: string }>; // weitere benannte Links
  // optionaler Kontextwert (z.B. Auto-SoC, WP-Status)
  context?: { label: string; value: number | boolean | string; unit: string };
  // true = zugehörige Quelle ist deaktiviert (wird dennoch in der Liste geführt)
  disabled?: boolean;
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
  // Alle Speicher mit SoC für die Übersicht (AC1, AC2, DC1, …); soc null = n. v.
  batterySocs?: Array<{ label: string; soc: number | null; power: number | null }>;
  batteryVoltage: number;
  tankUpTemp: number;
  tankDownTemp: number;
  // Prognostizierter Rest-PV-Ertrag des heutigen Tages (kWh, unskalierte
  // Basisprognose ab der aktuellen Viertelstunde). Für die Datenbereitstellung
  // an externe HEMS und optional andere Verbraucher.
  restPvKwh: number;

  // Verbraucher-Aufschlüsselung (für die Tabelle unter dem Diagramm).
  consumers: ConsumerEntry[];
}

// --- Automatisierungsregeln ---

// Eine einzelne Bedingung. Vergleicht eine Live-Metrik mit einem Wert, oder
// prüft ein Zeitfenster. Für Leistungs-/Temperatur-Metriken kann eine
// Mindestdauer verlangt werden ("… für länger als X Minuten").
export type RuleMetric =
  | "ueberschuss"       // PV-Überschuss (Einspeisung) in W (max(−gridPower,0))
  | "pvPower"           // PV-Erzeugung W
  | "gridPower"         // Netz W (>0 Bezug, <0 Einspeisung)
  | "hausverbrauch"     // Hausverbrauch W
  | "batterySoC"        // Batterie-SoC %
  | "tankUp"            // Warmwasser oben °C
  | "tankDown"          // Warmwasser unten °C
  | "spotpreis"         // aktueller Börsenstrompreis ct/kWh
  | "bezugspreisBrutto" // aktueller dyn. Bezugspreis brutto (ct/kWh, inkl. aller Bestandteile)
  | "drosselVorteilCt"  // Vorteil je kWh, den WR abzuschalten + zu beziehen (ct/kWh, >0 = lohnt)
  | "wasserverbrauch"   // Wasserverbrauch im laufenden Viertelstunden-Slot (Liter)
  | "sourcePower";      // Leistung einer bestimmten Quelle W (sourceId nötig)

export type RuleOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface RuleCondition {
  id: string;
  kind: "metric" | "time" | "sourceActive" | "sourceInactive" | "sourceOffline" | "sourceUnreachable" | "dailyTrigger" | "dailyAtTime" | "tarifMode" | "timerElapsed" | "ctFadeState" | "ruleRunning";
  // kind "metric":
  metric?: RuleMetric;
  sourceId?: string;      // für metric=sourcePower bzw. sourceActive/Inactive
  op?: RuleOp;
  value?: number;
  forMinutes?: number;    // Bedingung muss so lange ununterbrochen gelten
  // kind "time":
  weekdays?: number[];    // 0=So..6=Sa
  fromHM?: string;        // "13:00"
  toHM?: string;          // "16:30"
  atHM?: string;          // "23:59" – feste Uhrzeit für dailyAtTime
  // kind sourceActive/Inactive: Quelle gilt als aktiv, wenn |power| >= aktivThresholdW
  aktivThresholdW?: number;
  // kind "tarifMode": erfüllt, wenn das aktuell geltende Stromtarif-Modell
  // dem gewählten entspricht ("fix" oder "dyn").
  tarifMode?: "fix" | "dyn";
  // kind "ctFadeState": erfüllt, wenn der CT-Ausfade-Schalter dem erwarteten
  // Zustand entspricht. ctFadeExpected true = erfüllt wenn Ausfaden AN,
  // false = erfüllt wenn Ausfaden AUS.
  ctFadeExpected?: boolean;
  // kind "ruleRunning": erfüllt, wenn die referenzierte andere Regel (ruleId)
  // aktuell läuft (ruleRunningExpected true) bzw. nicht läuft (false).
  ruleId?: string;
  ruleRunningExpected?: boolean;
}

// Verknüpfung mehrerer Bedingungen.
export interface RuleConditionGroup {
  logic: "and" | "or";
  conditions: RuleCondition[];
}

export type RuleActionType = "switch" | "notify" | "acspeicher" | "timer" | "ctfade" | "ctnoac";

export interface RuleAction {
  type: RuleActionType;
  // type "switch":
  targetSourceId?: string; // schaltbare Quelle
  channel?: number;        // Shelly-Kanal (0,1,…)
  // Schaltrichtung: "on" schaltet ein, "off" schaltet aus. Ohne Angabe richtet
  // sich die Richtung nach der Regel-Phase (Einschalt-Aktion → ein,
  // Ausschalt-Aktion → aus), wie im ursprünglichen Verhalten.
  switchTo?: "on" | "off" | "toggle";
  // type "notify":
  message?: string;        // Text der Push-Nachricht
  // type "timer": startet beim Einschalten einen Lauf-Timer. In den Ausschalt-
  // bedingungen kann per "timerElapsed" geprüft werden, ob die Zeit abgelaufen
  // ist. Die Dauer steht in timerMinutes.
  timerMinutes?: number;
  // type "ctfade": schaltet den Ausfade-Modus der CT-Senke (AC-Speicher sanft auf
  // 0 fahren). ctFadeOn = true schaltet das Ausfaden ein, false zurück in den
  // Normalbetrieb.
  ctFadeOn?: boolean;
  // type "ctnoac": schaltet den Modus "kein AC-Laden" der CT-Senke. Begrenzt den
  // gelieferten CT-Wert auf >= 0 (negative Werte, die den Speicher zum Laden
  // bewegen würden, werden auf 0 gekappt). ctNoAcChargeOn = true schaltet ein.
  ctNoAcChargeOn?: boolean;
  // type "acspeicher": steuert einen per Modbus TCP angebundenen AC-Speicher.
  //   targetSourceId = die acBattery-Modbus-Quelle.
  acMode?: "charge" | "discharge" | "none"; // laden / entladen / Automatik
  acPowerW?: number;       // Soll-Leistung in W (bei charge/discharge)
  acToSoc?: number;        // optionaler Ziel-Ladezustand (%) beim Laden
  // Betriebsmodus, in den der Speicher nach dem Ende der Regel (Ausschalten)
  // versetzt wird. Ohne Angabe: "manual" (kein automatischer Eigenverbrauch).
  acAfterMode?: "manual" | "selfconsumption" | "trade";
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;        // scharfgeschaltet?
  groupId?: string;        // Zugehörigkeit zu einer Regelgruppe (optional)
  // Einschaltbedingungen und Ausschaltbedingungen (jeweils Gruppe mit and/or).
  onWhen: RuleConditionGroup;
  offWhen: RuleConditionGroup;
  // Aktionen beim Ein- und Ausschalten. Es können mehrere Aktionen hinterlegt
  // sein, die alle nacheinander ausgeführt werden (z. B. zwei Ausgänge schalten
  // und zusätzlich eine Push-Nachricht senden).
  onActions: RuleAction[];
  offActions: RuleAction[];
  // Optionale Ausschalt-Automatik nach Zeit: Ist ein Wert (in Minuten) gesetzt,
  // schaltet die Regel automatisch wieder aus, sobald seit dem Einschalten so
  // viele Minuten vergangen sind – unabhängig von den Ausschaltbedingungen.
  // Damit lassen sich Regeln wie „einschalten, nach 3 h automatisch aus" bauen.
  autoOffAfterMin?: number;
  notifyOnActivate: boolean; // zusätzlich Push beim Aktivieren
  showOnOverview?: boolean;  // als Kachel auf der Übersichtsseite anzeigen
  expiresAt?: string | null; // ISO-Zeitpunkt, ab dem die Regel automatisch deaktiviert wird
  // Laufzeit-Status (nicht persistiert bzw. abgeleitet):
  active?: boolean;        // Regel hat aktuell "eingeschaltet"
}

// Eine benannte Gruppe zur Strukturierung der Automatisierungsregeln. Die
// Reihenfolge im gespeicherten Array bestimmt die Anzeigereihenfolge.
export interface RuleGroup {
  id: string;
  name: string;
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
  // Kumulierter Tages-Hausverbrauch (= gridDayBezug + energyDayConsumed), aber
  // monoton geklemmt: kann innerhalb eines Tages nie sinken. Nur für die
  // Anzeige gedacht; die Rohfelder oben bleiben für Autarkie/Kosten unverändert.
  hausverbrauchDayMonoton: number; // kWh
  // Kumulierte, direkt im Haus verbrauchte PV-Energie (= pvDay − pvDcDay −
  // gridDayEingespeist), ebenfalls monoton geklemmt (gleicher Sägezahn-Grund:
  // feine Einspeisung vs. grob gerundete PV-Erzeugung). Nur für die Anzeige.
  pvConsumedDayMonoton: number; // kWh
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
// Ein zusätzlicher Offset-Term in der Leistungsberechnung einer Senke: die
// (mit einem Faktor gewichtete) Leistung einer weiteren Quelle. Positiver Beitrag
// erhöht den Sollwert der Senke (z. B. Bedarf eines Abnehmers), negativer senkt ihn.
export interface SinkOffset {
  sourceId: string; // Quelle, deren Leistung einbezogen wird
  factor: number; // Gewichtung (z. B. 1 = voll, 0.5 = halb, -1 = abziehen)
  onlyPositive: boolean; // true = nur positiver Leistungsanteil (Bezug) zählt
}

export interface Sink {
  id: string;
  name: string;
  // Rolle der Senke = welche Art von Information FLUX nach außen bereitstellt.
  //  "meter"    = Zähleremulation (emulierter Stromzähler für Speicher etc.) –
  //               nutzt die bisherige Zähler-/Balancer-Konfiguration.
  //  "extHems"  = Datenbereitstellung für ein externes HEMS: FLUX publiziert
  //               ausgewählte Live-Größen per MQTT an einen Broker, damit ein
  //               anderes Energiemanagementsystem (z. B. das eines §42c-Abnehmers)
  //               darauf reagieren kann. Konfiguration in den extHems*-Feldern.
  // Fehlt das Feld (Altbestand), gilt "meter".
  sinkRole?: "meter" | "extHems";
  baseSourceId: string; // Basis-Quelle (Rolle grid) = eigener Hauszähler
  baseFactor: number; // Gewichtung der Basis-Quelle (z. B. 0.5 = halber Hausverbrauch)
  offsets: SinkOffset[]; // zusätzlich zu berücksichtigende, gewichtete Quellen
  include42c: boolean; // true = Bedarf aller aktiven §42c-Abnehmer aufaddieren
  maxPowerW: number; // max. lieferbare Leistung (W); 0 = unbegrenzt
  // Getrenntes Limit (W) NUR für die Abgabe über den eigenen Hausverbrauch hinaus
  // an externe §42c-Abnehmer. 0 = unbegrenzt. Der eigene Hausverbrauch wird davon
  // NICHT begrenzt. Nur wirksam, wenn include42c aktiv ist.
  maxPower42cW?: number;
  enabled: boolean;
  // true = diese Senke per UDP-Discovery anbieten (Marstek findet den emulierten
  // Shelly automatisch im LAN, ohne dass eine URL eingetragen wird).
  useDiscovery?: boolean;
  // Welcher Zähler emuliert wird. Shelly-Typen werden vom Speicher lokal per
  // Broadcast gefunden (EM.GetStatus = Pro 3EM dreiphasig, EM1.GetStatus =
  // Pro EM-50 einphasig). Die CT-Typen (ct002/ct003) sprechen Marsteks natives
  // CT-Protokoll (UDP 12345) und benötigen eine in der Marstek-App/-Cloud
  // registrierte Geräte-Identität (ctMac + batteryMac). Default "pro3em".
  emulatedMeter?: "pro3em" | "proem50" | "emg3" | "ct002" | "ct003";
  // Nur für CT-Emulation: die bei der einmaligen Registrierung vergebene
  // CT-MAC und die MAC des Zielspeichers (beide 12-stellig hex, aus der
  // Marstek-App-Geräteverwaltung).
  ctMac?: string;
  batteryMac?: string;
  // Netz-Zielwert (W), auf den geregelt werden soll. 0 = Nulleinspeisung
  // (Netzbilanz auf 0). Negativ = bewusst leichte Einspeisung (z. B. -10 =
  // lieber 10 W einspeisen als beziehen). Positiv = leichter Restbezug. Wird vom
  // Sollwert abgezogen, sodass der Speicher so regelt, dass am Netz dieser Wert
  // stehen bleibt.
  targetOffsetW?: number;
  // Nur für CT-Multi-Speicher-Balancer: Gewicht je Speicher-IP für die
  // Lastaufteilung (z. B. nach Speicherkapazität). Fehlt eine IP, gilt Gewicht 1.
  ctWeights?: Array<{ ip: string; weight: number }>;
  // Dämpfung gegen Oszillation im CT-Balancer (beide 0 = aus).
  //  - ctDeadbandW: Totband um die Null (W). Liegt die Netzabweichung betragsmäßig
  //    darunter, wird nicht nachgeregelt (Delta 0), damit die Speicher nicht um
  //    den Nullpunkt „jagen". Sinnvoll ~15–25 W.
  //  - ctMaxStepW: maximaler Betrag des pro Poll gesendeten Deltas (W). Begrenzt,
  //    wie stark ein Speicher je Abfrage nachgeführt wird (Pacing/Slew-Rate),
  //    damit die beschleunigende Firmware-Rampe nicht überschießt. Sinnvoll
  //    ~30–100 W.
  ctDeadbandW?: number;
  ctMaxStepW?: number;
  // Entkoppelte Dämpfung der Umverteilung zwischen mehreren Speichern (beide 0 =
  // aus). Wirkt nur, wenn das Gesamtziel bereits grob erreicht ist (Netz nahe
  // ausgeregelt) und mehrere Speicher aktiv sind.
  //  - ctBalanceStepW: max. Betrag des pro Poll gesendeten Umverteilungs-Deltas
  //    (W). Klein wählen (z.B. 10), damit das Ins-Verhältnis-Bringen langsam und
  //    ruckelfrei erfolgt – deutlich sanfter als ctMaxStepW.
  //  - ctBalanceToleranceW: Toleranzband (W) um den fairen Anteil. Solange ein
  //    Speicher innerhalb dieses Bandes vom Zielverhältnis liegt, wird gar nicht
  //    umverteilt (Ruhe im eingeschwungenen Zustand). Sinnvoll ~50–100 W.
  ctBalanceStepW?: number;
  ctBalanceToleranceW?: number;
  // Alternierende Entladung (nur Entladerichtung): Ist der Schalter aktiv, wird
  // beim Entladen bevorzugt EIN Speicher genutzt (der mit dem höchsten SoC), bis
  // dieser die nächste SoC-Stufe (100/75/50/25/12 %) unterschreitet; dann
  // übernimmt der nächste. Reicht die Leistung des aktiven Speichers nicht, ziehen
  // die übrigen unterstützend mit. Ziel: geringere Teillast-Verluste der Speicher.
  // Beim Laden bleibt die Verteilung unverändert parallel/gewichtsproportional.
  ctAlternierendeEntladung?: boolean;
  // Fadeout-Schalter: Ist er aktiv, fährt der CT-Balancer die AC-Speicher aktiv
  // und schrittweise auf 0 W Batterieleistung und hält sie dort – unabhängig von
  // der Netzbilanz. Dient dazu, die AC-Speicher „herunterzufahren" (ohne harten
  // Shelly-Schalter), damit anschließend die DC-Speicher übernehmen können, ohne
  // dass beide gegeneinander arbeiten. ctFadeStepW = Schrittweite pro Poll (W).
  ctFadeout?: boolean;
  ctNoAcCharge?: boolean;
  ctFadeStepW?: number;
  // Optionale benutzerdefinierte Formel für den Sollwert (W). Ist sie gesetzt und
  // gültig, ersetzt sie die einfache baseFactor/offsets/§42c-Berechnung. Erlaubt
  // beliebige Ausdrücke mit benannten Variablen (siehe sinkFormulaVariables()).
  formula?: string;

  // --- Felder für sinkRole "extHems" (Datenbereitstellung per MQTT) ---
  // Broker-Zugang. Die MQTT-Auth-Felder sind identisch zu denen der MQTT-Quellen
  // (SourceConfig), damit dieselbe buildOptions-Logik wiederverwendet wird.
  mqttUrl?: string;
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientCert?: string;
  mqttClientKey?: string;
  mqttCaCert?: string;
  mqttRejectUnauthorized?: boolean;
  // Liste der Publish-Topics dieser Senke. Jedes Topic bekommt eine geordnete
  // Liste von Größen-IDs (per Drag&Drop sortierbar) zugewiesen. Publiziert wird
  // immer als JSON-Objekt (auch bei nur einer Größe), Schlüssel = Größen-ID.
  extHemsTopics?: ExtHemsPublishTopic[];
  // Eigene Formel-Größen (zusätzlich zur kuratierten Liste), die in Topics
  // zugeordnet werden können. Jede hat eine eindeutige ID, einen Anzeigenamen,
  // eine Einheit und eine Formel über die verfügbaren HEMS-Variablen.
  extHemsFormeln?: ExtHemsFormelGroesse[];
  // Publiziert nur bei Wertänderung. Diese Schwelle (in der jeweiligen Einheit)
  // legt fest, ab welcher Änderung neu gesendet wird (Rauschunterdrückung).
  // 0 = jede noch so kleine Änderung sendet. Default 1.
  extHemsChangeThreshold?: number;
}

// Ein Publish-Topic einer extHems-Senke mit den ihm zugeordneten Größen.
export interface ExtHemsPublishTopic {
  topic: string;                 // MQTT-Topic, z. B. "flux/hems/verfuegbar"
  groessen: string[];            // geordnete Größen-IDs (kuratiert oder Formel)
  retain?: boolean;              // MQTT retain-Flag (Default true, sinnvoll für Statuswerte)
}

// Eine benutzerdefinierte Formel-Größe für die extHems-Bereitstellung.
export interface ExtHemsFormelGroesse {
  id: string;                    // eindeutige ID (für die Zuordnung in Topics)
  name: string;                  // Anzeigename
  einheit: string;               // Einheit, z. B. "W", "kWh", "%"
  formel: string;                // Ausdruck über HEMS-Variablen (siehe extHemsVariables)
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
  eigenBezugW: number; // Basis-Quelle (bereits mit baseFactor gewichtet)
  abnehmerBezugW: number; // Summe §42c-Abnehmer (falls include42c) + Offsets
  formulaError?: string | null; // Fehlermeldung, falls die Formel ungültig ist
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

// --- Zeitversionierte Kostenperioden ---
// Jeder versionierte Block ist eine Liste von Perioden. Eine Periode gilt ab
// ihrem gueltigAb-Datum (YYYY-MM-DD) bis zum gueltigAb der nächsten Periode; die
// letzte gilt offen in die Zukunft. Dadurch sind Lücken/Überlappungen per
// Konstruktion ausgeschlossen. Die zu einem Datum passende Periode ist die mit
// dem größten gueltigAb <= Datum.

// Stromtarif: alle Preisbestandteile + Tarifmodell.
// (Einspeisevergütung und EEG-Regelung sind NICHT versioniert – sie gelten
//  dauerhaft und bleiben als globale Settings.)
export interface StromtarifWerte {
  strompreis: number;
  tarifMode: "fix" | "dyn";
  anbieterName: string; // Name des Stromanbieters (pro Periode)
  grundgebuehrMonat: number; // monatliche Grundgebühr des Stromtarifs (€/Monat, brutto)
  messstelleEuroJahr: number; // jährliche Mehrkosten Messstellenbetrieb (mME/iMSys), €/Jahr
  sofortbonus: number; // Einmalbetrag nach Lieferbeginn (€), anteilig über 1. Jahr
  neukundenbonus: number; // Bonus nach 1. Belieferungsjahr (€), anteilig über 1. Jahr
  beschaffung: number;
  stromsteuer: number;
  konzessionsabgabe: number;
  aufschlagNetznutzung: number;
  offshoreUmlage: number;
  kwkgUmlage: number;
  umsatzsteuer: number;
}
// §14a Modul 1: pauschale Reduktion.
export interface Modul1Werte {
  paragraf14aModul1Aktiv: boolean;
  modul1PauschaleNetto: number;
}
// §14a Modul 3: dynamische Netzentgelte inkl. Hoch-/Niedriglast-Zeitfenster.
export interface Modul3Werte {
  paragraf14aAktiv: boolean;
  netzentgeltStandard: number;
  netzentgeltHoch: number;
  netzentgeltNiedrig: number;
  lastWindows: LoadWindow[];
}
// Wasserkosten.
export interface WasserWerte {
  wasserFrischEuroM3: number;
  wasserAbwasserEuroM3: number;
  wasserGrundpreisMonat: number;
}

export interface Periode<T> {
  gueltigAb: string; // YYYY-MM-DD
  werte: T;
}

export type StromtarifPeriode = Periode<StromtarifWerte>;
export type Modul1Periode = Periode<Modul1Werte>;
export type Modul3Periode = Periode<Modul3Werte>;
export type WasserPeriode = Periode<WasserWerte>;

// Persistente Einstellungen
// Konfigurierbare Schriftgrößen je Text-Typ, getrennt für Desktop und Mobil.
// Die Schlüssel entsprechen den CSS-Raster-Variablen (--fs-<key>).
export interface FontSizeEntry {
  desktop: number; // px
  mobile: number;  // px
}
export interface FontSizeConfig {
  [key: string]: FontSizeEntry;
}

export interface Settings {
  // --- Fixtarif (Gesamtpreis inkl. allem), €/kWh. Bleibt der maßgebliche
  // Wert für die Anzeige bei tarifMode "fix" und für Altberechnungen. ---
  strompreis: number;

  // --- Tarifmodell ---
  tarifMode: "fix" | "dyn";
  // Name des Stromanbieters (zeitversioniert, pro Periode).
  anbieterName: string;
  // Monatliche Grundgebühr des Stromtarifs (€/Monat, brutto).
  grundgebuehrMonat: number;
  // Jährliche Mehrkosten für den Messstellenbetrieb (moderne Messeinrichtung /
  // intelligentes Messsystem), die separat vom Messstellenbetreiber berechnet
  // werden. €/Jahr, brutto.
  messstelleEuroJahr: number;
  // Boni des Stromtarifs. Beide werden anteilig über das erste Belieferungsjahr
  // (ab gueltigAb der Periode) als Gutschrift auf die Tageskosten verteilt.
  sofortbonus: number;      // Einmalbetrag nach Lieferbeginn (€)
  neukundenbonus: number;   // Bonus, der nach dem 1. Jahr verrechnet wird (€)
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

  // --- Konfigurierbare Schriftgrößen (Visualisierungsseite) ---
  // Pro Text-Typ getrennt für Desktop und Mobil (in px). Fehlt das Feld oder ein
  // einzelner Wert, gelten die CSS-Standardwerte des Rasters.
  fontSizes?: FontSizeConfig;

  // Abrufintervall der PV-Ertragsprognose (forecast.solar) in Minuten.
  prognoseIntervalMin: number;

  // --- Reset-Zeitpunkt (Anzeige) ---
  hourLastReset: number;
  minuteLastReset: number;

  // --- Wasserkosten ---
  wasserFrischEuroM3: number;  // Frischwasser €/m³
  wasserAbwasserEuroM3: number; // Abwasser (Schmutzwasser) €/m³
  wasserGrundpreisMonat: number; // Grundpreis €/Monat
}

// Einstellungen für Push-Benachrichtigungen via ntfy (https://ntfy.sh).
// Es wird per HTTP-POST an <server>/<topic> gesendet; kein Account nötig.
// WAS eine Benachrichtigung auslöst, wird ausschließlich über die
// Automatisierungsregeln (Aktion „Push-Nachricht") definiert – hier steht nur
// noch der Transport (Server/Topic).
export interface NotifySettings {
  enabled: boolean; // Push-Versand grundsätzlich aktiv?
  server: string; // Basis-URL des ntfy-Servers (Default https://ntfy.sh)
  topic: string; // Topic-Name (frei wählbar, z. B. "flux-mein-haus")
  minIntervalMin: number; // minimaler Abstand gleicher Meldungen (Anti-Spam)
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
  role: string; // Rolle (grid/pv/batteryOut/batteryIn/consumer/helper)
  deviceType?: string; // bei consumer: car/heater/heatpump/climate/generic
  icon?: string; // optionales benutzerdefiniertes Icon (Emoji)
  lastSuccess: number | null; // Unix-ms des letzten erfolgreichen Lesens
  lastError: string | null; // letzte Fehlermeldung (falls vorhanden)
  intervalSec: number; // konfiguriertes Poll-Intervall (für Schwellwert)
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

// Konfiguration der §9-Umsetzung (LPP, Einspeisedrosselung).
//
// §9 begrenzt die Einspeiseleistung am Netzverknüpfungspunkt (nicht die
// Wechselrichter direkt). Eigenverbrauch bleibt möglich. FLUX regelt daher
// live: nur wenn die tatsächliche Netzeinspeisung die Grenze übersteigt, werden
// Wechselrichter entlang einer Prioritätsreihenfolge gedrosselt; sinkt die
// Einspeisung wieder, werden sie in umgekehrter Reihenfolge hochgeregelt.
//
// Ein Wechselrichter-Ziel: ein steuerbarer WR (Growatt-Stick oder OpenDTU).
export interface LppInverter {
  id: string;             // eindeutige ID
  name: string;           // Anzeigename
  typ: "growatt" | "opendtu";
  nennleistungW: number;  // installierte WR-Leistung (W)
  // Quelle, aus der die Ist-Leistung dieses WR gelesen wird (powerOf(sourceId)).
  // Wird bei der Auto-Erkennung gesetzt; die Regelung nutzt die reale Messung.
  sourceId?: string;
  // true = aus den Quellen automatisch erkannt (nur Vorschlag, überschreibbar).
  autoErkannt?: boolean;
  // Growatt (OpenInverterGateway):
  kanal?: "http" | "mqtt";
  httpUrl?: string;       // z.B. http://192.168.178.106
  mqttUrl?: string;
  mqttTopic?: string;     // Command-Topic
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttCaCert?: string;
  regProzent?: number;    // Default 3
  regMeterEnable?: number; // Default 122
  regRate?: number;       // Default 123
  methode?: "prozent" | "absolut";
  // OpenDTU:
  opendtuHttpUrl?: string; // z.B. http://192.168.178.39
  opendtuSerial?: string;  // Wechselrichter-Seriennummer
  opendtuKanal?: "http" | "mqtt";
  opendtuMqttUrl?: string;
  opendtuMqttBasetopic?: string; // z.B. solar (Topic wird <base>/<serial>/cmd/...)
  opendtuMqttAuthType?: "none" | "userpass" | "clientcert";
  opendtuMqttUsername?: string;
  opendtuMqttPassword?: string;
}

export interface LppControlConfig {
  enabled: boolean;       // §9-Umsetzung grundsätzlich aktiv?
  scharf: boolean;        // false = Dry-Run (nur berechnen+loggen, nicht senden)
  // Wechselrichter in Drossel-Reihenfolge (Index 0 wird zuerst gedrosselt).
  inverter: LppInverter[];
  // Nonpersistent (schont WR-Speicher) oder persistent (bleibt nach Neustart).
  persistent: boolean;
  // Regelparameter:
  reserveW: number;       // Sicherheitsabstand zur Grenze (W), Default 100
  regelIntervalSek: number; // wie oft geregelt wird, Default 10
}

// §14a-Überwachung (LPC): steuerbare Verbrauchseinrichtung (SteuVE).
// Reine Beobachtung – FLUX vergleicht die Summe der Momentanleistungen gegen den
// per EEBUS empfangenen Bezugs-Sollwert (Watt). Kein realer Eingriff.
export interface SteuVe {
  id: string;         // eindeutige ID
  name: string;       // Anzeigename
  sourceId: string;   // Quelle, aus der die Momentanleistung gelesen wird (powerOf)
}
export interface LpcMonitorConfig {
  enabled: boolean;   // Überwachung aktiv?
  steuve: SteuVe[];   // beim Netzbetreiber angemeldete steuerbare Einrichtungen
  warnschwelleProzent: number; // ab wie viel % des Limits gewarnt wird (Default 90)
}
