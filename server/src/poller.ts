// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { MIN_INTERVAL_SEC } from "./config.js";
import type {
  LiveData,
  DayData,
  FullState,
  Settings,
  SourceStatus,
  ConsumerEntry,
  Sink,
  SinkStatus,
  HistoryEntry,
  ViertelstundeEntry,
} from "./types.js";
import type { SourceConfig } from "./sources.js";
import { is42cRole } from "./sources.js";
import { readSource } from "./fetcher.js";
import { parseMarstekTarget } from "./marstek.js";
import { reconcileMqtt, reconcilePublishers, publisherKey } from "./mqttClient.js";
import { publishExtHems, type ExtHemsInputs } from "./extHems.js";
import { regelLpp, getLppControlConfig } from "./lppControl.js";
import * as pvanlagen from "./pvanlagen.js";
import { evalFormula, validateFormula } from "./formula.js";
import { setCustomProfiles, setGenProfiles } from "./emu.js";
import { computeTagesKosten, bezugspreisVS, einspeiseVerguetungVS } from "./costs.js";
import { log } from "./logger.js";
import { persistWpKpiForDay } from "./wpkpi.js";
import { evaluateRules, setPersistDisabled, type RuleMetrics } from "./rules.js";
import * as db from "./db.js";

// =====================================================================
// Datengetriebener Poller
//
// Quellen kommen aus der DB (loadSources). Jede Quelle hat eine Rolle
// (grid/pv/batteryOut/load/info) und Felder mit JSON-Pfaden. Die
// Aggregation summiert über alle Quellen je Rolle – beliebig viele.
// Tagesdifferenzen werden pro Quelle mit Lazy-Init geführt (Anker wird
// erst beim ersten Wert > 0 gesetzt).
// =====================================================================

// --- State ---
const live: LiveData = {
  gridPower: 0,
  gridInTotal: 0,
  gridOutTotal: 0,
  pvPower: 0,
  pvDcPower: 0,
  batteryOutPower: 0,
  batteryInPower: 0,
  sharing42cPowerNow: 0,
  sharing42cPowerNowOther: 0,
  sharing42cEnergyDay: 0,
  pvTo42cPower: 0,
  batteryTo42cPower: 0,
  batterySoC: 0,
  batterySocs: [],
  batteryVoltage: 0,
  tankUpTemp: 0,
  tankDownTemp: 0,
  restPvKwh: 0,
  consumers: [],
};

const day: DayData = {
  gridDayBezug: 0,
  gridDayEingespeist: 0,
  pvDay: 0,
  pvDcDay: 0,
  batteryOutDay: 0,
  batteryInDay: 0,
  energyDayConsumed: 0,
  hausverbrauchDayMonoton: 0,
  pvConsumedDayMonoton: 0,
  energyAutarkie: 0,
  costsAdded: 0,
  tagesBezugskosten: 0,
  tagesEinspeiseverguetung: 0,
  tagesSharingVerguetung: 0,
  pvTo42cEnergy: 0,
  batteryTo42cEnergy: 0,
};

let settings: Settings = db.loadSettings();
let sources: SourceConfig[] = db.loadSources();
let sinks: Sink[] = db.loadSinks();
// Laufzeit-Status je Senke (für JSON-Schnittstelle + Statusseite).
let sinkStatus: Record<string, SinkStatus> = {};
// Senken-IDs, deren CT-Regelung mangels frischer Netzmessung sicherheitshalber
// heruntergefahren wird (Speicher auf 0). getCtSinkInfo erzwingt dann Fadeout.
const ctSafeShutdown = new Set<string>();

// Pro Quelle der zuletzt gelesene Stand (für Aggregation + Anzeige).
interface LastRead {
  values: Partial<Record<string, number>>; // metric -> Wert
  display: Array<{ label: string; value: number | boolean | string; unit: string }>;
  modules?: Array<{ index: number; soc: number | null; cellMinV: number | null; cellMaxV: number | null; imbalanceV: number | null }>;
}
const lastRead: Record<string, LastRead> = {};

// Zuletzt gelesener Stand einer Quelle (values + display) für externe Nutzung
// (z. B. AC-Speicher-Statusseite bei REST/MQTT-Anbindung).
export function getLastRead(id: string): LastRead | null {
  return lastRead[id] ?? null;
}

// Status-Tracking pro Quelle
const sourceStatus: Record<
  string,
  {
    lastSuccess: number | null;
    lastError: string | null;
    // true, sobald der aktuelle (erwartbare) Offline-/Nichterreichbar-Zustand
    // EINMAL geloggt wurde. Verhindert, dass ein nachts abgeschalteter
    // Wechselrichter bei jedem Poll-Zyklus (alle paar Sekunden) erneut eine
    // Logzeile erzeugt. Wird bei erfolgreichem Lesen zurückgesetzt.
    offlineLogged?: boolean;
    // Zeitpunkt (ms), seit dem die Quelle DURCHGEHEND wegen Nichterreichbarkeit
    // (Host/Netz nicht erreichbar) fehlschlägt. null = aktuell erreichbar bzw.
    // Fehler anderer Art. Basis für die Regel "Quelle seit X nicht erreichbar".
    unreachableSince?: number | null;
  }
> = {};
function ensureStatus(id: string) {
  if (!sourceStatus[id]) sourceStatus[id] = { lastSuccess: null, lastError: null };
  return sourceStatus[id];
}
function recordSuccess(id: string) {
  const s = ensureStatus(id);
  const warOffline = s.offlineLogged;
  s.lastSuccess = Date.now();
  s.lastError = null;
  s.offlineLogged = false;
  s.unreachableSince = null;
  // Wiedererreichbar nach gemeldetem Ausfall: einmalige Entwarnung (debug).
  if (warOffline) {
    db.addLog(db.LOG_LEVELS.debug, "poll", `${id}: wieder erreichbar.`);
  }
}
function recordError(id: string, msg: string) {
  ensureStatus(id).lastError = msg;
}
// Markiert eine Quelle als (weiterhin) nicht erreichbar. Setzt den Startzeitpunkt
// der Nichterreichbarkeit beim ERSTEN solchen Fehler; folgende Fehler lassen ihn
// stehen, sodass die Dauer fortlaufend gemessen wird.
function markUnreachable(id: string) {
  const s = ensureStatus(id);
  if (s.unreachableSince == null) s.unreachableSince = Date.now();
}

// Letzter bekannter Wasserzählerstand (m³), im Speicher gehalten; beim ersten
// Wert wird nur initialisiert (kein Verbrauch gebucht).
let lastWasserStand: number | null = null;
// Zuletzt IN DIE DB GESCHRIEBENER Stand (m³). Dient dazu, den Zählerstand nur
// dann zu persistieren, wenn er sich tatsächlich geändert hat – sonst entstünde
// bei jedem Poll (z. B. alle paar Sekunden) ein neuer Datensatz, obwohl sich der
// Stand über lange Zeit nicht bewegt. Wird beim Start aus der DB vorbelegt,
// damit nach einem Neustart kein unnötiger Duplikat-Stand geschrieben wird.
let lastGespeicherterWasserStand: number | null = (() => {
  const r = db.getLetzterWasserStand();
  return r ? r.stand : null;
})();

// Verarbeitet einen neuen Zählerstand: Differenz zum letzten Stand als Liter in
// die aktuelle Viertelstunde buchen und den Stand protokollieren.
function verarbeiteWasserstand(standM3: number): void {
  // Zählerstand nur speichern, wenn er sich gegenüber dem zuletzt gespeicherten
  // Wert geändert hat. Der Wasserzähler bewegt sich nur bei tatsächlichem
  // Verbrauch; ein unveränderter Stand muss nicht bei jedem Poll erneut in die
  // Zeitreihe geschrieben werden (das würde die Tabelle unnötig aufblähen).
  if (lastGespeicherterWasserStand == null || standM3 !== lastGespeicherterWasserStand) {
    const nowIso = new Date().toISOString();
    db.saveWasserStand(nowIso, standM3);
    lastGespeicherterWasserStand = standM3;
  }
  if (lastWasserStand == null) {
    lastWasserStand = standM3;
    return;
  }
  const deltaM3 = standM3 - lastWasserStand;
  lastWasserStand = standM3;
  // Nur plausible positive Differenzen buchen (Zählerrücksprung/Fehler ignorieren).
  if (deltaM3 <= 0 || deltaM3 > 5) return; // >5 m³ in einem Intervall = unplausibel
  const liter = deltaM3 * 1000;
  const slotEnd = viertelstundenEnde(new Date());
  db.addWasserViertelstunde(slotEnd, liter);
  // Live-Wasserverbrauch des aktuellen Viertelstunden-Slots mitführen (für die
  // Automatisierungs-Metrik "wasserverbrauch", z.B. Leckageüberwachung im
  // Urlaub). Bei Slotwechsel auf den neuen Zuwachs zurücksetzen.
  if (slotEnd !== wasserSlotKey) {
    wasserSlotKey = slotEnd;
    wasserSlotLiter = 0;
  }
  wasserSlotLiter += liter;
}

// Liter im aktuell laufenden Viertelstunden-Slot (Live-Wasserverbrauch).
let wasserSlotLiter = 0;
let wasserSlotKey = "";
export function getWasserSlotLiter(): number {
  // Bei Slotwechsel ohne neuen Zählerstand ist der alte Slotwert nicht mehr
  // aktuell -> 0 zurückgeben, sobald der Slot gewechselt hat.
  const nowSlot = viertelstundenEnde(new Date());
  if (nowSlot !== wasserSlotKey) return 0;
  return wasserSlotLiter;
}

// Ende (obere Grenze) der aktuellen Viertelstunde als ISO-Local "YYYY-MM-DDTHH:MM".
function viertelstundenEnde(d: Date): string {
  const mins = d.getMinutes();
  const slot = Math.floor(mins / 15) * 15 + 15;
  const dd = new Date(d);
  dd.setMinutes(slot, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dd.getFullYear()}-${p(dd.getMonth() + 1)}-${p(dd.getDate())}T${p(dd.getHours())}:${p(dd.getMinutes())}`;
}

// Baut die Regel-Metriken aus dem aktuellen live-Zustand und wertet die
// Automatisierungsregeln aus.
async function evaluateAutomationRules(batterySoC: number): Promise<void> {
  const rules = db.loadRules();
  if (rules.length === 0) return;
  // Überschuss = Einspeisung ins Netz (negativer gridPower).
  const ueberschuss = live.gridPower < 0 ? -live.gridPower : 0;
  const sourcePower: Record<string, number> = {};
  // Basis: Anzeigeleistung aus der Verbraucherliste (deckt reine Consumer ab, die
  // keinen eigenen vorzeichenbehafteten Messwert haben).
  for (const c of live.consumers) sourcePower[c.id] = c.power;
  // WICHTIG: Für alle GEPOLLTEN Quellen mit echtem Messwert den ROHEN,
  // vorzeichentreuen powerOf-Wert verwenden – und zwar mit VORRANG vor dem
  // Anzeigewert aus live.consumers. Grund: batteryOut-Quellen (z. B. der Soyo)
  // werden für die Übersicht mit normalisiertem Vorzeichen als "Einspeisung"
  // (negativ) in die Verbraucherliste gelegt. Dieser Anzeigewert darf NICHT die
  // Regel-Metrik "sourcePower" verfälschen – sonst sähe ein rein positiv
  // messender Zähler (Shelly 2.5) dort fälschlich negative Leistung und eine
  // Bedingung wie "sourcePower <= -10" würde unzulässig feuern. Die Regel-Metrik
  // muss den tatsächlichen Messwert der Quelle abbilden.
  for (const src of sources) {
    if (!sourceEnabled(src)) continue;
    const hatMesswert = !!src.powerSourceId || (src.fields ?? []).some((f) => f.metric === "power");
    if (hatMesswert) sourcePower[src.id] = powerOf(src.id);
  }
  // Hausverbrauch (W) aus der Leistungsbilanz: PV-AC + Batterieabgabe + Netz
  // (Bezug positiv, Einspeisung negativ) − AC-Netzladung. Näherung für Regeln.
  const pvAc = live.pvPower - live.pvDcPower;
  const hausverbrauch = Math.max(
    0,
    pvAc + live.batteryOutPower + live.gridPower - live.batteryInPower
  );
  const energyDayOf = (id: string) => live.consumers.find((c) => c.id === id)?.energyDay ?? 0;
  // Offline-Quellen: seit > 3 Intervallen kein Erfolg bzw. lastError gesetzt.
  const offlineSources: Record<string, boolean> = {};
  const disabledSources: Record<string, boolean> = {};
  const unreachableMinutes: Record<string, number> = {};
  const nowMsForUnreach = Date.now();
  for (const src of sources) {
    const st = sourceStatus[src.id];
    offlineSources[src.id] = !!st && st.lastError != null;
    // Quelle deaktiviert = Häkchen „aktiv" in der Quellendefinition nicht gesetzt.
    disabledSources[src.id] = src.enabled === false;
    // Dauer der durchgehenden Nichterreichbarkeit (Host/Netz) in Minuten.
    unreachableMinutes[src.id] = st?.unreachableSince != null
      ? (nowMsForUnreach - st.unreachableSince) / 60_000
      : 0;
  }
  // Tageswerte für Tagesstatistik-Benachrichtigungen.
  const tagVerbrauchKwh = day.gridDayBezug + (day.energyDayConsumed ?? 0);
  const tagEinspeisungKwh = day.gridDayEingespeist;
  let tagKostenEuro = 0;
  try {
    const now2 = new Date();
    const heute = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-${String(now2.getDate()).padStart(2, "0")}`;
    const tk = computeTagesKosten(heute, db.loadSettings());
    tagKostenEuro = tk?.saldo ?? 0;
  } catch { /* Kosten optional */ }
  const m: RuleMetrics = {
    ueberschuss,
    pvPower: live.pvPower,
    gridPower: live.gridPower,
    hausverbrauch,
    batterySoC,
    tankUp: live.tankUpTemp,
    tankDown: live.tankDownTemp,
    spotpreis: currentSpotPrice(),
    bezugspreisBrutto: currentBezugspreisBruttoCt(),
    drosselVorteilCt: currentDrosselVorteilCt(),
    wasserverbrauch: getWasserSlotLiter(),
    sourcePower,
    offlineSources,
    disabledSources,
    unreachableMinutes,
    tagVerbrauchKwh,
    tagEinspeisungKwh,
    tagKostenEuro,
    tarifMode: db.effectiveSettings(now().date).tarifMode === "dyn" ? "dyn" : "fix",
  };
  try {
    await evaluateRules(rules, m, sources, energyDayOf);
    // Kein pauschales db.saveRules(rules) mehr! Das schrieb bei JEDEM Poll die zu
    // Beginn des Zyklus geladene Regelliste zurück und überschrieb dabei parallele
    // Änderungen aus dem Regeleditor (gelöschte/umbenannte Regeln „kamen zurück",
    // wenn ein Poll-Zyklus über den Speichervorgang lief). Die einzige nötige
    // Persistierung – das Deaktivieren automatisch abgelaufener Regeln – erfolgt
    // gezielt und merge-sicher über setPersistDisabled (lädt frisch, ändert nur
    // die betroffene Regel).
  } catch (e: any) {
    db.addLog(db.LOG_LEVELS.warn, "rules", `Regel-Auswertung: ${e?.message ?? e}`);
  }
}

// Börsenstrompreis (ct/kWh) der aktuellen Viertelstunde, falls vorhanden.
function currentSpotPrice(): number | null {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const tag = db.getSpotpreise(iso);
  if (!tag || !Array.isArray(tag.prices) || tag.prices.length === 0) return null;
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const n = tag.prices.length;
  const idx = Math.min(n - 1, Math.floor((minutesOfDay / (24 * 60)) * n));
  const v = tag.prices[idx];
  return typeof v === "number" && isFinite(v) ? v : null;
}

// Aktueller dynamischer Bezugspreis BRUTTO in ct/kWh (inkl. aller
// Preisbestandteile). Nur beim dynamischen Tarif definiert – beim Fixtarif
// liefert die Funktion null, damit eine darauf aufbauende Regel ausschließlich
// bei dyn. Tarif greift. Kann bei stark negativem Börsenpreis negativ werden.
function currentBezugspreisBruttoCt(): number | null {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const eff = db.effectiveSettings(dateStr);
  if (eff.tarifMode !== "dyn") return null;
  const spot = db.getSpotpreise(dateStr)?.prices ?? null;
  const idx = d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
  const spotCt = spot && idx < spot.length ? spot[idx] : null;
  // bezugspreisVS liefert €/kWh -> in ct/kWh umrechnen.
  return bezugspreisVS(eff, d, spotCt) * 100;
}

// Wirtschaftlicher Vorteil je kWh (ct/kWh), den Wechselrichter abzuschalten und
// stattdessen aus dem Netz zu beziehen. Das lohnt sich, wenn der (ggf. negative)
// Bruttobezugspreis die entgangene Einspeisevergütung überkompensiert:
//   Vorteil = −(Bezugspreis_brutto + Einspeisevergütung)
// Positiv => Abschalten+Beziehen lohnt. Die Einspeisevergütung folgt der
// EEG-Regelung (bei negativem Börsenpreis ab 25.02.2025 = 0). Nur bei dyn.
// Tarif definiert, sonst null (Regel greift dann nicht).
function currentDrosselVorteilCt(): number | null {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const eff = db.effectiveSettings(dateStr);
  if (eff.tarifMode !== "dyn") return null;
  const spot = db.getSpotpreise(dateStr)?.prices ?? null;
  const idx = d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
  const spotCt = spot && idx < spot.length ? spot[idx] : null;
  const bezugCt = bezugspreisVS(eff, d, spotCt) * 100;      // ct/kWh
  const vergCt = einspeiseVerguetungVS(eff, spotCt) * 100;  // ct/kWh (0 falls EEG aussetzt)
  return -(bezugCt + vergCt);
}

// Maximales Alter eines erfolgreichen Lesens, ab dem die Momentanleistung als
// veraltet gilt. DC-gepowerte Wechselrichter sind nach Sonnenuntergang nicht
// mehr erreichbar; ihr letzter Leistungswert (z.B. 12 W) würde sonst stehen
// bleiben. Zählerstände bleiben davon unberührt – nur die Momentanleistung
// wird nach Ablauf auf 0 gesetzt.
const STALE_POWER_MS = 3 * 60 * 1000;
function isStale(id: string): boolean {
  const ls = sourceStatus[id]?.lastSuccess;
  if (ls == null) return false; // noch nie gelesen -> kein alter Wert vorhanden
  return Date.now() - ls > STALE_POWER_MS;
}

// Strenge Frische-Pruefung fuer die REGELUNG (nicht die Anzeige): Ein Regler
// darf nicht auf einem veralteten Netz-Messwert weiterrechnen. Faellt der
// Netzzaehler nur kurz aus, liefert powerOf() weiter den zuletzt erfolgreich
// gelesenen (eingefrorenen) Wert – fuer die Anzeige unkritisch, fuer die
// CT-Regelung aber fatal: Ein eingefrorener Bezugswert laesst die Speicher
// konstant einspeisen, obwohl real laengst ins Netz zurueckgespeist wird. Diese
// Pruefung gilt eine Quelle nur dann als regeltauglich frisch, wenn der letzte
// erfolgreiche Messwert nicht aelter als das Doppelte ihres Poll-Intervalls
// (mind. 10 s, max. 30 s) ist.
function isFreshForControl(id: string): boolean {
  const ls = sourceStatus[id]?.lastSuccess;
  if (ls == null) return false; // noch nie erfolgreich gelesen -> nicht regeltauglich
  const cfg = sources.find((s) => s.id === id);
  const pollMs = Math.max(2, cfg?.intervalSec ?? 5) * 1000;
  const maxAgeMs = Math.min(30_000, Math.max(10_000, pollMs * 2));
  return Date.now() - ls <= maxAgeMs;
}
// Momentanleistung einer Quelle, aber 0 wenn das letzte erfolgreiche Lesen
// länger als STALE_POWER_MS zurückliegt (Quelle nicht mehr erreichbar).
export function powerOf(id: string): number {
  // Quelle mit verknüpfter Leistungsquelle (z. B. WP-Betriebsdaten hier,
  // Leistung von einem separaten Shelly): deren power-Wert übernehmen.
  const cfg = sources.find((s) => s.id === id);
  if (cfg?.powerSourceId) {
    const linked = cfg.powerSourceId;
    if (isStale(linked)) return 0;
    return lastRead[linked]?.values.power ?? 0;
  }
  if (isStale(id)) return 0;
  return lastRead[id]?.values.power ?? 0;
}

// Zählerstand (kWh) einer Quelle für eine Energie-Metrik. WICHTIG zur Semantik
// bei diesen AC-Speicher-Shellys: energyTotal (=aenergy) zaehlt die GESAMT-
// Wirkenergie BEIDER Richtungen (Laden + Entladen), energyReturnTotal
// (=ret_aenergy) nur die Rueckrichtung (Entladung). Die reine Ladung ergibt
// sich daher als energyTotal - energyReturnTotal (siehe acBattery-Zweig). Loest
// wie powerOf die powerSourceId-Verknuepfung auf: Bei AC-Speichern mit separatem
// Mess-Shelly (z. B. Venus A) sitzen die Zaehler auf der verknuepften Quelle,
// nicht auf der acBattery-Hauptquelle. Gibt undefined zurueck, wenn kein Wert
// vorliegt (damit die Anker-Logik einen fehlenden Zaehler von echter 0
// unterscheiden kann).
function energyMetricOf(id: string, metric: "energyTotal" | "energyReturnTotal"): number | undefined {
  const cfg = sources.find((s) => s.id === id);
  const readId = cfg?.powerSourceId ? cfg.powerSourceId : id;
  return lastRead[readId]?.values[metric];
}

// Einspeise-Zählerstand (kWh) einer batteryOut-Quelle für die Viertelstunden-
// und Tagesbilanz. Bidirektionale Quellen (mit energyReturnTotal-Feld) messen
// die Einspeisung als Rückrichtung ret_aenergy; rein einspeisende Quellen haben
// nur energyTotal, das dort komplett Einspeisung ist. So bleibt der bestehende
// (rein zählende) Fall unverändert und der neue bidirektionale Fall zählt nur
// die tatsächliche Einspeisung – der Standby-Eigenverbrauch fließt NICHT in die
// Speicher-Einspeisebilanz.
function batteryOutHasReturn(s: SourceConfig): boolean {
  return (s.fields ?? []).some((f) => f.metric === "energyReturnTotal");
}
function batteryOutMeter(s: SourceConfig): number | undefined {
  const vals = lastRead[s.id]?.values;
  if (!vals) return undefined;
  return batteryOutHasReturn(s) ? vals.energyReturnTotal : vals.energyTotal;
}

// Drosselungs-Tracking: letzter bekannter rate-Wert je Quelle (Wechselrichter).
// 101 = Startwert (ungültig), erzwingt das Loggen des ersten echten Werts.
const currentDrosselung: Record<string, number> = {};

// --- Zeit ---
function now(): { date: string; time: string; hours: number; minutes: number } {
  const d = new Date();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const time = d.toTimeString().slice(0, 8);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { date, time, hours, minutes };
}

// Lokaler ISO-Zeitstempel mit Sekundengenauigkeit (YYYY-MM-DDTHH:MM:SS), z.B.
// für die zeitpunktgenaue Persistenz der Wärmepumpen-Datenreihen.
function nowSecondsIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

// --- Quellen-Helfer ---
function sourceById(id: string): SourceConfig | undefined {
  return sources.find((s) => s.id === id);
}
// Ist eine Quelle aktuell aktiv? Nur noch das eigene enabled-Häkchen.
function sourceEnabled(src: SourceConfig): boolean {
  return src.enabled;
}

// Anker-Key für die Tagesdifferenz einer Quelle (energyTotal-Metrik).
const energyAnchorKey = (id: string) => `src_${id}_energy_reset`;
// Spezielle Anker für grid (zwei Zähler):
const gridInAnchorKey = (id: string) => `src_${id}_gridIn_reset`;
const gridOutAnchorKey = (id: string) => `src_${id}_gridOut_reset`;
// AC-Speicher: getrennte Anker für Ladung (aenergy=energyTotal) und Entladung
// (ret_aenergy=energyReturnTotal).
const acChargeAnchorKey = (id: string) => `src_${id}_acCharge_reset`;
const acDischargeAnchorKey = (id: string) => `src_${id}_acDischarge_reset`;

// §42c-Tagesenergie (kWh): zeitlich integrierter Eigenanteil. Persistiert in
// der resets-Tabelle, zurückgesetzt bei echtem Tageswechsel.
const SHARE42C_ENERGY_KEY = "sharing42c_energy_day";
// Getrennte §42c-Tagesenergie nach Herkunft (kWh), ebenfalls in resets.
const SHARE42C_PV_ENERGY_KEY = "sharing42c_pv_energy_day";
const SHARE42C_BATT_ENERGY_KEY = "sharing42c_batt_energy_day";
// Zeitstempel der letzten Aggregation für die Zeitintegration.
let lastShareTick = 0;
// Cache für den prognostizierten Rest-PV-Ertrag (nur ~1x/Minute aus der DB
// laden, nicht bei jedem schnellen Aggregations-Tick).
let restPvCacheTs = 0;
let restPvCacheVal = 0;

// --- Init-Bedingung ---
// Init ist fertig, sobald mindestens eine grid-Quelle ihre beiden Zähler
// (gridIn/gridOut) mit definierten Werten geliefert hat – ein Stand von 0 zählt
// dabei als gültig. (Daran hängen Bezug, Einspeisung, Autarkie, Kosten und das
// Schreiben der Viertelstundenwerte.)
function resetsReady(): boolean {
  // Init ist bereit, sobald eine Netzquelle gültige Zählerstände geliefert hat.
  // Ein Zählerstand von 0 ist ausdrücklich gültig (z.B. Bezugszähler an einem
  // reinen Einspeise-/Sonnentag ohne Netzbezug). Nur fehlende/negative Werte
  // (Anker -1) gelten als "noch nicht bereit" – sonst würde die Initialisierung
  // an einem Tag ohne Netzbezug nie abschließen und es würden keine
  // Viertelstundenwerte geschrieben.
  for (const src of sources) {
    if (src.role !== "grid" && src.role !== "gridEmu") continue;
    const inA = db.getReset(gridInAnchorKey(src.id), -1);
    const outA = db.getReset(gridOutAnchorKey(src.id), -1);
    if (inA >= 0 && outA >= 0) return true;
  }
  return false;
}

// --- Tagesdifferenzen pro Quelle (RESETFEST) ---
// Robuste, gegen Zaehler-Ruecksetzung immune Tagesakkumulation. Statt den
// Tageswert als (aktuellerStand - Startanker) zu bilden (bricht, sobald ein
// Shelly beim Neustart seinen Energiezaehler auf 0 setzt), fuehren wir pro
// Anker ZWEI persistierte Werte:
//   - <anchorKey>            = zuletzt gesehener Rohzaehlerstand ("last")
//   - <anchorKey>::accum     = heute akkumulierte Menge ("accum")
// Pro Aufruf:
//   * energy >= last: normaler Zuwachs -> accum += (energy - last)
//   * energy <  last: Zaehler-Reset erkannt -> die bisher akkumulierte Menge
//     BLEIBT erhalten; der neue (kleine) Stand ist selbst der Zuwachs seit dem
//     Reset -> accum += energy
// last wird stets auf energy nachgefuehrt. Rueckgabe ist immer accum (der
// vollstaendige Tageswert). Ein zwischenzeitliches Ruecksetzen fuehrt damit NIE
// zu einem Einbruch der erfassten Energiemenge.
const reanchoredSinceStart = new Set<string>();
const accumKey = (anchorKey: string) => `${anchorKey}::accum`;

// Uebersetzt einen internen Anker-Key (src_<id>_<typ>_reset) in eine lesbare
// Beschreibung fuer Log-Meldungen, z. B. "AC-Speicher Venus A - Entladezaehler
// (ret_aenergy)". Faellt bei unbekanntem Format auf den Rohschluessel zurueck.
function describeAnchor(anchorKey: string): string {
  const m = /^src_(.+)_(energy|gridIn|gridOut|acCharge|acDischarge)_reset$/.exec(anchorKey);
  if (!m) return anchorKey;
  const [, id, typ] = m;
  const label = sources.find((s) => s.id === id)?.label ?? id;
  const typText: Record<string, string> = {
    energy: "Energiezaehler (energyTotal)",
    gridIn: "Bezugszaehler (gridIn)",
    gridOut: "Einspeisezaehler (gridOut)",
    acCharge: "Ladezaehler (aenergy gesamt)",
    acDischarge: "Entladezaehler (ret_aenergy)",
  };
  return `${label} - ${typText[typ] ?? typ}`;
}

// Kleiner Toleranzwert: Zaehler koennen minimal "zittern" (Rundung/Rauschen).
// Nur ein Rueckgang groesser als diese Schwelle gilt als echter Reset; winzige
// Ausreisser nach unten werden als 0-Zuwachs behandelt (kein Scheinsprung).
const COUNTER_RESET_EPS = 0.0005; // 0,5 Wh

// Merker für die monotone Klemme des angezeigten Tagesverbrauchs (siehe
// aggregate). Hält das Datum, für das der aktuelle Klemmwert gilt.
let monotonDay = "";
// PV-Eigenverbrauch (kWh) als zeitintegrierte Momentanleistung: die PV-AC-
// Leistung, die NICHT ins Netz eingespeist wird (pvAc − Einspeisung, geklemmt).
// Das ist dieselbe Größe wie die korrekte Momentananzeige, über den Tag
// aufsummiert. Wird beim Tageswechsel zurückgesetzt. Deutlich robuster als die
// Tagesbilanz pvDay−eingespeist, die zeitversetzten Verbrauch überschätzt.
let pvEigenDayAccum = 0;
let pvEigenDay = "";
let lastPvEigenTick = 0;
let pvEigenStartSeeded = false; // beim Programmstart einmalig aus persistierten VS vorbelegen (NICHT je Tag)

// Tages-PV-Ertrag der "integrated"-Quellen (kWh), leistungsintegriert. Diese
// Anlagen (z.B. Growatt MOD/MIC) liefern keinen verlässlichen Tages-Energiezähler
// je Anlage; ihr Ertrag wird über die Momentanleistung integriert (identisch zur
// PV-Ertrag-Tagesverlauf-Aufzeichnung / Stromerzeugungsseite). Der zählerbasierte
// pvDay-Pfad (dayDiff über energyTotal) startet für diese Quellen nach einer
// Datenübernahme aus hems_old.db zu niedrig, wodurch pvDay auf der Übersicht viel
// kleiner war als der tatsächliche Ertrag. Dieser Akkumulator ist migrationsfest,
// weil er nicht an den (importierten) Zähler-Ankern hängt. Reset beim Tageswechsel;
// Seed beim Programmstart aus den persistierten pv_viertelstunden.
let pvIntegratedDayAccum = 0;
let pvIntegratedDcDayAccum = 0;
let pvIntegratedDay = "";
let pvIntegratedStartSeeded = false;
let lastPvIntegratedTick = 0;

function dayDiff(anchorKey: string, energy: number | undefined | null): number {
  const aKey = accumKey(anchorKey);
  // Fehlender/ungueltiger Zaehlerstand (Quelle offline oder Feld kurz nicht
  // gefuellt): NICHT als 0 behandeln! Eine 0 wuerde den Anker verfaelschen und
  // beim naechsten echten Wert den kompletten Lebensertrag als Tageswert buchen.
  // Stattdessen den bisherigen Tagesakkumulator unveraendert zurueckgeben und
  // den Anker in Ruhe lassen.
  if (energy == null || !Number.isFinite(energy)) {
    return reanchoredSinceStart.has(anchorKey) ? db.getReset(aKey, 0) : 0;
  }
  if (!reanchoredSinceStart.has(anchorKey)) {
    // Erster Wert dieser Quelle seit Programmstart.
    if (energy > 0) {
      reanchoredSinceStart.add(anchorKey);
      // accum mit der HEUTE bereits persistierten Tagessumme initialisieren, damit
      // die Oberflaeche nach einem Neustart sofort wieder die volle Tagesenergie
      // zeigt (nur der noch nicht weggeschriebene laufende Slot fehlt kurz). Ohne
      // persistierte Summe (0) beginnt der Tageswert bei 0.
      const persisted = startDaySums[anchorKey] ?? 0;
      db.setReset(aKey, persisted); // heutiger Akkumulator
      db.setReset(anchorKey, energy); // last = aktueller Rohstand
      return persisted;
    }
    return 0; // beim ersten Lauf nach Start ohne gueltigen Wert: 0
  }
  const last = db.getReset(anchorKey, -1);
  let accum = db.getReset(aKey, 0);
  if (last < 0) {
    // Anker fehlt (z. B. frisch aktivierte Quelle mitten am Tag): verankern,
    // noch kein Zuwachs.
    if (energy > 0) {
      db.setReset(anchorKey, energy);
      if (db.getReset(aKey, -1) < 0) db.setReset(aKey, 0);
    }
    return accum;
  }
  if (energy >= last - COUNTER_RESET_EPS) {
    // Normaler (monotoner) Zuwachs; winziges Zittern nach unten -> 0.
    const inc = Math.max(0, energy - last);
    accum += inc;
    db.setReset(anchorKey, energy); // last nachfuehren
    db.setReset(aKey, accum);
  } else if (energy > COUNTER_RESET_EPS && energy < last * 0.5) {
    // Echter Zaehler-Reset (deutlicher Ruecksprung auf einen kleinen, aber
    // POSITIVEN Stand, z. B. Shelly-Neustart -> Zaehler beginnt knapp ueber 0
    // und zaehlt von dort hoch): bisher Akkumuliertes BLEIBT erhalten, der neue
    // Stand ist der Zuwachs seit dem Reset. So gehen keine bereits erfassten
    // Energiemengen verloren.
    accum += energy;
    db.setReset(anchorKey, energy); // last auf neuen Stand nachfuehren
    db.setReset(aKey, accum);
    db.addLog(
      db.LOG_LEVELS.debug,
      "poller",
      `Zaehler-Ruecksetzung erkannt: ${describeAnchor(anchorKey)} von ${last.toFixed(3)} kWh auf ${energy.toFixed(3)} kWh zurueckgesetzt; ${accum.toFixed(3)} kWh Tagesmenge bleiben erhalten.`,
    );
  } else {
    // Uebrige Faelle -> Anker HALTEN, 0 Zuwachs:
    //  - energy nahe 0 (<= EPS): fast immer eine Fehlmessung/ein fehlender Wert
    //    (der als 0 durchgereicht wurde), KEIN echter Reset. Wuerde man hier den
    //    Anker auf 0 ziehen, buchte der naechste echte Zaehlerstand den kompletten
    //    Lebensertrag als Tageswert (genau dieser Bug trat beim EPEver morgens
    //    auf, wenn Generated_All beim ersten Kontakt kurz 0/undefined war).
    //  - kleiner, unplausibler Rueckgang (nicht nahe 0): Glitch, ebenfalls halten.
  }
  return accum;
}

// Nach Neustart: bereits HEUTE persistierte Tagessummen je Anker-Key (siehe
// dayDiff). Wird einmalig beim Poller-Start befüllt.
const startDaySums: Record<string, number> = {};
let startDaySumsLoaded = false;

function loadStartDaySums(force = false): void {
  if (startDaySumsLoaded && !force) return;
  startDaySumsLoaded = true;
  // Beim erzwungenen Neuladen (Tageswechsel) die alten Tageswerte verwerfen,
  // sonst würden über "=== undefined"-geschützte Felder (Netz) die Summen des
  // Vortages bestehen bleiben und der neue Tag nicht bei 0 starten.
  if (force) {
    for (const k of Object.keys(startDaySums)) delete startDaySums[k];
  }
  try {
    const heute = now().date;
    const { von, bis } = db.dayBounds(heute);
    const vs = db.getViertelstundenSummen(von, bis);
    const pvArr = db.getPvTagesSummen(von, bis); // Array<{source, tag, kwh}>
    const pvSums: Record<string, number> = {};
    for (const row of pvArr) pvSums[row.source] = (pvSums[row.source] ?? 0) + (row.kwh ?? 0);
    // Consumer-Tagessummen (enthaelt auch die bidirektionalen AC-Speicher: Bezug
    // unter "<id>", Einspeisung/Entladung unter "<id>::feedin"). Basis fuer die
    // AC-Speicher-Rekonstruktion nach einem Programm-Neustart.
    const consumerSums = db.getConsumerDaySums(von, bis);
    for (const src of sources) {
      if (!sourceEnabled(src)) continue;
      if (src.role === "grid" || src.role === "grid42c" || src.role === "grid42cEmu") {
        if (startDaySums[gridInAnchorKey(src.id)] === undefined) startDaySums[gridInAnchorKey(src.id)] = vs.bezogen ?? 0;
        if (startDaySums[gridOutAnchorKey(src.id)] === undefined) startDaySums[gridOutAnchorKey(src.id)] = vs.eingespeist ?? 0;
      } else if (src.role === "pv") {
        startDaySums[energyAnchorKey(src.id)] = pvSums[src.id] ?? 0;
      } else if (src.role === "acBattery") {
        // AC-Speicher: heute bereits erfasste Lade-/Entlademengen aus den
        // Consumer-Viertelstunden rekonstruieren, damit nach einem Neustart die
        // Tagesmenge nicht bei 0 beginnt.
        //   Entladung  = "<id>::feedin"   -> acDischarge-Anker
        //   Ladung(pos)= "<id>"            (Bezug/Netzladung)
        // Der acCharge-Anker verankert auf aenergy (=GESAMT beider Richtungen);
        // sein Akkumulator muss daher die Summe Laden+Entladen tragen, damit
        // batteryInDay = accum(charge) - accum(discharge) wieder die reine Ladung
        // ergibt. Werte sind leistungsintegrierte Naeherungen (nur zur Fuellung
        // der Startluecke; der laufende Betrieb zaehlt danach zaehlerbasiert).
        const entlade = consumerSums[`${src.id}::feedin`] ?? 0;
        const lade = consumerSums[src.id] ?? 0;
        startDaySums[acDischargeAnchorKey(src.id)] = entlade;
        startDaySums[acChargeAnchorKey(src.id)] = lade + entlade;
      } else if (src.role === "batteryIn" || src.role === "batteryOut") {
        // AC-/DC-Lader bzw. -Entlader mit eigenem Energiezähler (energyAnchorKey).
        // Ihre heute bereits erfasste Tagesmenge steht in den Consumer-Summen und
        // wird hier rekonstruiert, damit die geladene/entladene Energiemenge nach
        // einem Neustart / einer Datenübernahme nicht bei 0 beginnt.
        const tages = consumerSums[src.id] ?? consumerSums[`${src.id}::feedin`] ?? 0;
        if (tages > 0) startDaySums[energyAnchorKey(src.id)] = tages;
      }
      // batteryOut/batteryIn (DC): keine getrennte persistierte Tagessumme je
      // Quelle -> bleibt beim bisherigen Verhalten (Start bei 0).
    }
  } catch (e) {
    db.addLog(db.LOG_LEVELS.warn, "poller", `Tagessummen-Rekonstruktion fehlgeschlagen: ${String(e)}`);
  }
}

// --- Aggregation über alle Quellen ---
function aggregate(): void {
  let gridPower = 0, gridIn = 0, gridOut = 0;
  let pvPower = 0, pvDcPower = 0, batteryOutPower = 0, batteryInPower = 0;
  let gridDayBezug = 0, gridDayEing = 0, pvDay = 0, pvDcDay = 0, batteryOutDay = 0, batteryInDay = 0;
  let batterySoC = 0, batteryVoltage = 0, tankUp = 0, tankDown = 0;
  // Merker, damit jeder Netz-Kernwert nur von der ERSTEN aktiven grid-Quelle
  // gezählt wird, die ihn liefert (mehrere Netz-Quellen dürfen sich die Rolle
  // teilen: z. B. eine mit Zählerständen, eine mit schneller Leistung).
  let gridTotalsSet = false;   // Bezugs-/Einspeise-Zählerstände (gridIn/gridOut)
  let gridPowerSet = false;    // Momentanleistung (gridPower)
  let gridDaySet = false;      // Tages-Bezug/-Einspeisung (Differenzbildung)
  // Absolute Gesamt-Zählerstände (für die Viertelstunden-Differenzen):
  let pvTotal = 0, batteryOutTotal = 0, pvDcTotal = 0;

  // Hilfswerte (role "helper"): power je Quellen-ID, für Korrektur-Formeln.
  // Die frühere Rolle "info" ist in "helper" aufgegangen und wird hier
  // gleichbehandelt (falls noch alte info-Quellen existieren).
  const helperPower: Record<string, number> = {};
  for (const src of sources) {
    if (src.role !== "helper" && src.role !== "info") continue;
    if (!sourceEnabled(src)) continue;
    helperPower[src.id] = powerOf(src.id);
  }

  const consumers: ConsumerEntry[] = [];
  // Einzelne PV-Anlagen (id + aktuelle Leistung) für die getrennte Ertrags-
  // Aufzeichnung je Anlage.
  const pvErzeuger: Array<{ id: string; power: number }> = [];

  for (const src of sources) {
    // Untergeordnete Leistungsquelle (Gegenstück zu powerSourceId): liefert nur
    // ihren power-Wert an die Hauptquelle und wird selbst nicht als eigenes Gerät
    // in der Bilanz/Verbraucherliste geführt (sonst Doppelzählung der Leistung).
    if (src.subordinateOf) continue;
    const istVerbraucherOderSpeicher =
      src.role === "consumer" || src.role === "batteryIn" || src.role === "batteryOut" || src.role === "acBattery" || src.role === "dcBattery";
    // Deaktivierte Quellen normalerweise überspringen – ABER Verbraucher und
    // Speicher sollen dennoch in der Verbraucherliste auftauchen (mit 0 W und dem
    // heutigen Tagesverbrauch aus der DB), damit die Liste vollständig ist und
    // man sie auch für vergangene Tage findet.
    if (!sourceEnabled(src)) {
      if (istVerbraucherOderSpeicher) {
        consumers.push({
          id: src.id,
          label: src.label,
          deviceType: src.deviceType ?? "generic",
          role: src.role,
          icon: src.icon,
          room: src.room,
          power: 0,
          bidirectional: src.role === "batteryOut" ? true : undefined,
          energyDay: consumerDaySumsToday()[src.id] ?? 0,
          url: src.url,
          extraLinks: src.extraLinks,
          disabled: true,
        });
      }
      continue;
    }
    const read = lastRead[src.id];
    if (!read) {
      // Aktivierte Verbraucher auch dann in der Liste zeigen, wenn (noch) kein
      // erfolgreicher Abruf vorliegt – sonst fehlt das Gerät kommentarlos. Mit
      // 0 W dargestellt; der Verbindungsstatus ist über die Quellen-Statusseite
      // sichtbar. Andere Rollen (grid, pv, …) brauchen ohne Daten keinen Eintrag.
      if (src.role === "consumer" || src.role === "batteryIn" || src.role === "batteryOut") {
        consumers.push({
          id: src.id,
          label: src.label,
          deviceType: src.deviceType ?? "generic",
          role: src.role,
          icon: src.icon,
          room: src.room,
          power: 0,
          bidirectional: src.role === "batteryOut" ? true : undefined,
          energyDay: consumerDaySumsToday()[src.id] ?? 0,
          url: src.url,
          extraLinks: src.extraLinks,
        });
      }
      continue;
    }
    const v = read.values;

    const power = powerOf(src.id);
    switch (src.role) {
      case "grid":
      case "gridEmu": {
        // Momentanleistung nur von der ersten grid-Quelle übernehmen, die eine
        // liefert (eigenes power-Feld oder verknüpfte Leistungsquelle). So zählt
        // ein schneller Leistungsmesser, ohne dass ein zweiter Netzzähler die
        // Leistung ein zweites Mal beisteuert.
        const liefertPower = !!src.powerSourceId || (src.fields ?? []).some((f) => f.metric === "power");
        if (liefertPower && !gridPowerSet) {
          gridPower += power;
          gridPowerSet = true;
        }
        const inT = v.gridInTotal ?? 0;
        const outT = v.gridOutTotal ?? 0;
        // Anker-Initialisierung für die Init-Bereitschaft: Sobald die Netzquelle
        // definierte Zählerstände liefert, den Tagesanker setzen – auch wenn ein
        // Stand 0 ist (z.B. Bezugszähler an einem reinen Einspeisetag). Ohne das
        // bliebe resetsReady() an einem Tag ohne Netzbezug dauerhaft false und es
        // würden keine Viertelstundenwerte geschrieben. dayDiff verankert nur bei
        // Werten > 0; hier wird die "echte 0" (Wert vorhanden) ergänzend gesetzt.
        if (v.gridInTotal != null && db.getReset(gridInAnchorKey(src.id), -1) < 0) {
          db.setReset(gridInAnchorKey(src.id), inT);
          db.setReset(accumKey(gridInAnchorKey(src.id)), startDaySums[gridInAnchorKey(src.id)] ?? 0);
          reanchoredSinceStart.add(gridInAnchorKey(src.id));
        }
        if (v.gridOutTotal != null && db.getReset(gridOutAnchorKey(src.id), -1) < 0) {
          db.setReset(gridOutAnchorKey(src.id), outT);
          db.setReset(accumKey(gridOutAnchorKey(src.id)), startDaySums[gridOutAnchorKey(src.id)] ?? 0);
          reanchoredSinceStart.add(gridOutAnchorKey(src.id));
        }
        // Gesamtzählerstände (Bezug/Einspeisung) und die daraus gebildete
        // Tagesdifferenz stammen von der ERSTEN grid-Quelle, die Zählerstände
        // liefert. Eine zweite Netz-Quelle (z. B. reiner Leistungsmesser ohne
        // Zählerstände) trägt hier nichts bei.
        const liefertTotals = v.gridInTotal != null || v.gridOutTotal != null;
        if (liefertTotals && !gridTotalsSet) {
          gridIn += inT;
          gridOut += outT;
          gridTotalsSet = true;
        }
        if (liefertTotals && !gridDaySet) {
          gridDayBezug += dayDiff(gridInAnchorKey(src.id), v.gridInTotal);
          gridDayEing += dayDiff(gridOutAnchorKey(src.id), v.gridOutTotal);
          gridDaySet = true;
        }
        break;
      }
      case "pv": {
        pvPower += power;
        // Nur PV-Anlagen mit einem Leistungswert werden für die getrennte
        // Ertragsaufzeichnung berücksichtigt (Integration der Leistung über die
        // Zeit). Quellen, die ausschließlich einen Zählerstand liefern (kein
        // power-Feld und keine verknüpfte Leistungsquelle), bleiben außen vor.
        const hatLeistung = !!src.powerSourceId || (src.fields ?? []).some((f) => f.metric === "power");
        if (hatLeistung) pvErzeuger.push({ id: src.id, power });
        const e = v.energyTotal;
        pvTotal += e ?? 0;
        // dayDiff IMMER aufrufen, damit der Zähler-Anker weiterläuft (nahtloses
        // Umschalten auf "counter" möglich). Der Beitrag zu pvDay hängt aber vom
        // Quellentyp ab:
        //   - counter-Quellen: zählerbasiert (eDay geht in pvDay ein)
        //   - integrated-Quellen: der Zählerpfad ist unzuverlässig (v.a. nach
        //     Datenübernahme). Ihr Tagesertrag kommt aus dem Leistungsintegral
        //     (pvIntegratedDayAccum), das weiter unten aufsummiert wird.
        const eDay = dayDiff(energyAnchorKey(src.id), e);
        if (src.energySource !== "integrated") {
          pvDay += eDay;
          if (src.pvTarget === "dc") {
            pvDcPower += power;
            pvDcDay += eDay;
          }
        } else if (src.pvTarget === "dc") {
          pvDcPower += power;
        }
        if (src.pvTarget === "dc") pvDcTotal += e ?? 0;
        if ((v.soc ?? 0) > batterySoC) batterySoC = v.soc ?? 0;
        if ((v.voltage ?? 0) > batteryVoltage) batteryVoltage = v.voltage ?? 0;
        break;
      }
      case "batteryOut": {
        // Batterie-Einspeisung (Entladung). Zwei unterstützte Zählerarten:
        //
        // (1) REIN EINSPEISEND (bisheriges Verhalten, unverändert): ein Shelly
        //     mit immer positiver Leistung und nur einem Energiezähler
        //     (energyTotal). Die gesamte Energie ist Einspeisung.
        //
        // (2) BIDIREKTIONAL: neuerer Shelly mit vorzeichenbehafteter Leistung
        //     (power<0 = Einspeisung, power>0 = Standby-Eigenverbrauch) und ZWEI
        //     Zählern: energyTotal (aenergy = gesamt) + energyReturnTotal
        //     (ret_aenergy = nur Einspeisung). Nur die Rückrichtung zählt als
        //     Einspeisung; der Standby-Verbrauch ist Hausverbrauch und wird NICHT
        //     in batteryOutDay verrechnet (nur in der Verbraucher-Anzeige, s.u.).
        //
        // Erkennung: hat die Quelle ein energyReturnTotal-Feld -> Variante (2).
        const hasReturn = (src.fields ?? []).some((f) => f.metric === "energyReturnTotal");
        let battOutDayThis = 0;
        if (hasReturn) {
          // Variante (2): Live-Leistung nur der Einspeiseanteil (power<0).
          if (power < 0) batteryOutPower += -power;
          const ret = v.energyReturnTotal;
          if (ret != null) {
            battOutDayThis = dayDiff(acDischargeAnchorKey(src.id), ret);
            batteryOutDay += battOutDayThis;
            batteryOutTotal += ret;
          }
        } else {
          // Variante (1): unverändert – positive Leistung = Einspeisung.
          batteryOutPower += power;
          const e = v.energyTotal;
          batteryOutTotal += e ?? 0;
          battOutDayThis = dayDiff(energyAnchorKey(src.id), e);
          batteryOutDay += battOutDayThis;
        }
        // Verbraucher-Anzeige (Übersicht, aufklappbarer Tagesverlauf), OHNE
        // Änderung der obigen Bilanz. Als bidirektional markiert, damit Bezug und
        // Einspeisung in der VS-Integration getrennt erfasst werden. Die
        // Vorzeichenkonvention wird für die Anzeige rollengerecht normalisiert:
        //   - rein einspeisend: power>0 = Einspeisung -> in der Anzeige als
        //     Einspeisung (negatives Vorzeichen), damit accumulateConsumers es
        //     unter "<id>::feedin" führt.
        //   - bidirektional: power<0 = Einspeisung (schon korrekt), power>0 =
        //     Standby-Verbrauch (bleibt positiv).
        const displayPower = hasReturn ? power : -Math.abs(power);
        consumers.push({
          id: src.id,
          label: src.label,
          deviceType: src.deviceType ?? "generic",
          role: src.role,
          icon: src.icon,
          room: src.room,
          power: displayPower,
          bidirectional: true,
          energyDay: 0,
          energyDayFeedin: battOutDayThis, // Tages-Einspeisung/Entladung
          url: src.url,
          extraLinks: src.extraLinks,
        });
        break;
      }
      case "batteryIn": {
        // AC-Speicher, der aus dem Netz lädt. Separat ausgewiesen (Pfeil
        // Netz->Batterie). Keine Autarkie-Verrechnung: Energie steckt schon
        // im Netzbezug und kommt über batteryOut zurück (sonst Doppelzählung).
        batteryInPower += power;
        const e = v.energyTotal;
        const battInDayThis = dayDiff(energyAnchorKey(src.id), e);
        batteryInDay += battInDayThis;
        // Zusätzlich in der Verbraucher-Tabelle der Übersicht anzeigen (mit
        // Raumzuordnung). Rolle bleibt batteryIn – die Leistung wird NICHT als
        // Hausverbrauch gewertet, dient hier nur der Übersichtsdarstellung.
        consumers.push({
          id: src.id,
          label: src.label,
          deviceType: src.deviceType ?? "generic",
          role: src.role,
          icon: src.icon,
          room: src.room,
          power,
          energyDay: battInDayThis,
          url: src.url,
          extraLinks: src.extraLinks,
        });
        break;
      }
      case "acBattery": {
        // AC-Speicher mit eigener API (z.B. Marstek). power-Konvention aus dem
        // Fetcher: >0 = Ladung (aus dem Netz/Haus), <0 = Entladung (Abgabe ans
        // Haus). Entladung verhält sich bilanziell wie batteryOut, Ladung wie
        // batteryIn.
        //
        // LEISTUNG (Live-Ansicht) unverändert über power:
        if (power < 0) {
          batteryOutPower += -power; // Entladung: Abgabe ans Haus
        } else if (power > 0) {
          batteryInPower += power; // Ladung: wie Netzladung
        }
        // TAGESENERGIE über echte Zähler (nicht Leistungsintegration):
        //   aenergy      (energyTotal)       = GESAMT-Wirkenergie beider
        //                                       Richtungen (Laden + Entladen)!
        //   ret_aenergy  (energyReturnTotal) = nur Rueckrichtung = Entladung
        // Diese Shellys zaehlen aenergy als Summe beider Richtungen. Daraus folgt:
        //   Entladung (batteryOut) = ret_aenergy
        //   Ladung    (batteryIn)  = aenergy - ret_aenergy  (Vorwaertsanteil)
        // Beide Tagesdifferenzen getrennt verankern und erst danach subtrahieren,
        // damit unabhaengige Anker/Neustarts sauber behandelt werden. Der
        // Ladeanteil wird auf >= 0 geklemmt (Mess-/Timing-Jitter).
        // Zaehler sitzen ggf. auf der verknuepften Mess-Shelly (powerSourceId).
        const acTotal = energyMetricOf(src.id, "energyTotal");       // aenergy (gesamt)
        const acDischarge = energyMetricOf(src.id, "energyReturnTotal"); // ret_aenergy
        let dOut = 0;
        if (acDischarge != null) {
          dOut = dayDiff(acDischargeAnchorKey(src.id), acDischarge);
          batteryOutDay += dOut;
          batteryOutTotal += acDischarge;
        }
        let acLadungDay = 0;
        if (acTotal != null) {
          const dTotal = dayDiff(acChargeAnchorKey(src.id), acTotal);
          // Vorwaertsanteil (echte Ladung) = Gesamt - Rueckanteil, nie negativ.
          acLadungDay = Math.max(0, dTotal - dOut);
          batteryInDay += acLadungDay;
        }
        // In der Geräteliste der Übersicht anzeigen. Leistung MIT Vorzeichen:
        // >0 = Netzladung/Bezug, <0 = Einspeisung/Entladung. So wird auf der
        // Verbraucherseite korrekt zwischen Laden und Entladen unterschieden
        // (kein Absolutwert). Ein Flag markiert die Quelle als bidirektional,
        // damit die Viertelstunden-Integration Bezug und Einspeisung trennt.
        consumers.push({
          id: src.id,
          label: src.label,
          deviceType: src.deviceType ?? "generic",
          role: src.role,
          icon: src.icon,
          room: src.room,
          power,
          bidirectional: true,
          energyDay: acLadungDay,      // Ladung/Bezug heute
          energyDayFeedin: dOut,       // Entladung/Einspeisung heute
          url: src.url,
          extraLinks: src.extraLinks,
          context: v.soc != null ? { label: "SoC", value: Math.round(v.soc), unit: "%" } : undefined,
        });
        break;
      }
      case "consumer": {
        // Echte Leistung = eigene power + Summe der Korrektur-Terme.
        // (Virtueller Verbraucher, z.B. Klima = Shelly + Balkon-PV.)
        let real = power;
        for (const corr of src.powerCorrections ?? []) {
          const hp = helperPower[corr.sourceId] ?? powerOf(corr.sourceId);
          real += corr.sign === "-" ? -hp : hp;
        }
        // Kontextwert je Gerätetyp (Auto: SoC; sonst keiner vorerst).
        let context: ConsumerEntry["context"];
        if (src.deviceType === "car") {
          const connected = (v.connected ?? 0) > 0.5;
          context = { label: "verbunden", value: connected, unit: "" };
        }
        const heuteVs = consumerDaySumsToday();
        consumers.push({
          id: src.id,
          label: src.label,
          deviceType: src.deviceType ?? "generic",
          role: src.role,
          icon: src.icon,
          room: src.room,
          power: real,
          energyDay: (heuteVs[src.id] ?? 0) + (consumerVsAccum[src.id] ?? 0),
          url: src.url,
          extraLinks: src.extraLinks,
          context,
        });
        break;
      }
      case "waterTank": {
        // Warmwasserspeicher-Temperaturen: genau zwei °C-Felder (oben/unten).
        const temps = read.display.filter((x) => x.unit === "°C");
        if (temps[0] && tankUp === 0) tankUp = Number(temps[0].value) || 0;
        if (temps[1]) tankDown = Number(temps[1].value) || 0;
        break;
      }
      case "water": {
        // Wasserzähler: Zählerstand (m³) aus dem konfigurierten Feld lesen und
        // die Differenz zum letzten Stand als Liter in die laufende Viertelstunde
        // buchen. Feldwert kann "512.3020" (AI-on-the-Edge main.value) sein.
        // Wir nehmen den ersten numerisch interpretierbaren Anzeigewert.
        let standM3 = NaN;
        for (const x of read.display) {
          const v = Number(x.value);
          if (isFinite(v) && v > 0) { standM3 = v; break; }
        }
        if (isFinite(standM3) && standM3 > 0) {
          verarbeiteWasserstand(standM3);
        }
        break;
      }
      case "info":
      case "helper": {
        // Hilfswert/Info: keine Bilanz- oder Übersichtswirkung. Die Leistung
        // wurde oben bereits als helperPower erfasst (für Korrektur-Formeln und
        // die Anzeige auf der Statusseite). "info" und "helper" sind dieselbe
        // Rolle (info ist in helper aufgegangen).
        break;
      }
    }
  }

  live.gridPower = gridPower;
  live.gridInTotal = gridIn;
  live.gridOutTotal = gridOut;
  live.pvPower = pvPower;
  live.pvDcPower = pvDcPower;
  live.batteryOutPower = batteryOutPower;
  live.batteryInPower = batteryInPower;
  // §42c: Gesamtbezug aller Abnehmer (nur positiver Netzbezug; speist ein
  // Abnehmer mit eigener PV selbst ein, zählt das nicht als Versorgung).
  let sharing42cGesamt = 0;
  for (const src of sources) {
    if (!is42cRole(src.role)) continue;
    if (!sourceEnabled(src)) continue;
    const p = powerOf(src.id);
    if (p > 0) sharing42cGesamt += p;
  }
  // Aufteilung: Der Teil, den ich selbst liefere, ist durch meine aktuelle
  // Netzeinspeisung (PV-Direkteinspeisung + Batterieeinspeisung) begrenzt.
  // Der Rest wird vom Reststromlieferanten aus dem Netz gedeckt.
  const meineEinspeisung = gridPower < 0 ? -gridPower : 0;
  const sharing42cEigen = Math.min(sharing42cGesamt, meineEinspeisung);
  live.sharing42cPowerNow = sharing42cEigen;
  live.sharing42cPowerNowOther = sharing42cGesamt - sharing42cEigen;
  // Aufteilung des Eigenanteils nach Herkunft. Die Batterie speist nur ein,
  // wenn der PV-Überschuss den §42c-Bedarf nicht deckt – daher zählt die
  // Batterie-Einspeisung (batteryOutPower) zuerst zum Sharing, der Rest des
  // Eigenanteils stammt aus der PV-Direkteinspeisung. batteryOutPower wird auf
  // den Eigenanteil gedeckelt (falls die Batterie mehr einspeist als die
  // Abnehmer gerade beziehen, geht der Überschuss regulär ins Netz).
  const batteryTo42cPower = Math.min(sharing42cEigen, Math.max(0, batteryOutPower));
  const pvTo42cPower = sharing42cEigen - batteryTo42cPower;
  live.batteryTo42cPower = batteryTo42cPower;
  live.pvTo42cPower = pvTo42cPower;
  // §42c-Tagesenergie: zeitlich integrierter Eigenanteil (kWh), den ich heute
  // über meine Einspeisung zum Bedarf der Abnehmer beigetragen habe. Es gibt
  // keinen Zählerstand dafür, daher integrieren wir die Momentanleistung über
  // die reale Zeit zwischen zwei Aggregationen. Persistiert in der resets-
  // Tabelle (übersteht Neustart), zurückgesetzt bei echtem Tageswechsel.
  const nowMs = Date.now();
  if (lastShareTick > 0) {
    const dtH = (nowMs - lastShareTick) / 3_600_000; // ms -> h
    // Plausibilitätsgrenze gegen Ausreißer (z.B. nach langer Pause/Suspend).
    if (dtH > 0 && dtH < 0.5) {
      const addKwh = (sharing42cEigen / 1000) * dtH;
      if (addKwh > 0) {
        const prev = db.getReset(SHARE42C_ENERGY_KEY, 0);
        db.setReset(SHARE42C_ENERGY_KEY, prev + addKwh);
      }
      // Getrennte Aufaggregation nach Herkunft (PV / Batterie).
      const addPv = (pvTo42cPower / 1000) * dtH;
      if (addPv > 0) {
        const prev = db.getReset(SHARE42C_PV_ENERGY_KEY, 0);
        db.setReset(SHARE42C_PV_ENERGY_KEY, prev + addPv);
      }
      const addBatt = (batteryTo42cPower / 1000) * dtH;
      if (addBatt > 0) {
        const prev = db.getReset(SHARE42C_BATT_ENERGY_KEY, 0);
        db.setReset(SHARE42C_BATT_ENERGY_KEY, prev + addBatt);
      }
    }
  }
  lastShareTick = nowMs;
  live.sharing42cEnergyDay = db.getReset(SHARE42C_ENERGY_KEY, 0);
  day.pvTo42cEnergy = db.getReset(SHARE42C_PV_ENERGY_KEY, 0);
  day.batteryTo42cEnergy = db.getReset(SHARE42C_BATT_ENERGY_KEY, 0);
  live.batterySoC = batterySoC;
  live.batteryVoltage = batteryVoltage;
  // Prognostizierter Rest-PV-Ertrag des heutigen Tages (unskalierte Basis-
  // Prognose ab der aktuellen Viertelstunde). Nur ~1x/Minute aus der DB laden.
  {
    const tnow = Date.now();
    if (tnow - restPvCacheTs > 60_000) {
      restPvCacheTs = tnow;
      try {
        const today = new Date().toLocaleDateString("sv-SE");
        restPvCacheVal = Math.max(0, pvanlagen.loadStoredPrognose(today).remainingKwh);
      } catch { restPvCacheVal = 0; }
    }
    live.restPvKwh = restPvCacheVal;
  }
  // Speicher-SoC-Liste für die Übersicht: in DERSELBEN Reihenfolge wie die
  // Speicher-Seite – erst alle AC-Speicher (acBattery, ohne die als reine
  // Leistungsmessung verknüpften Shellys), dann alle DC-Speicher (dcBattery),
  // jeweils in Konfigurationsreihenfolge. Nummeriert AC1/AC2/… bzw. DC1/DC2/…
  // Je Speicher: SoC (null = n. v.) und vorzeichenbehaftete Leistung mit der
  // Konvention „>0 = Ladung, <0 = Entladung" (power = null, wenn nicht bestimmbar).
  const batterySocs: Array<{ label: string; soc: number | null; power: number | null }> = [];
  const socValue = (id: string | undefined): number | null => {
    if (!id) return null;
    const v = lastRead[id]?.values.soc;
    return v != null && Number.isFinite(v) ? v : null;
  };
  // Rohe (vorzeichenbehaftete) Leistung einer Quelle; null wenn kein Messwert.
  const rawPower = (id: string | undefined): number | null => {
    if (!id) return null;
    const v = powerOf(id);
    return Number.isFinite(v) ? v : null;
  };
  const linkedPowerIds = new Set(
    sources.map((s) => s.powerSourceId).filter((id): id is string => typeof id === "string" && !!id),
  );
  let acCount = 0;
  for (const s of sources) {
    if (s.role !== "acBattery" || !sourceEnabled(s) || linkedPowerIds.has(s.id)) continue;
    acCount++;
    const soc = socValue(s.id) ?? socValue(s.powerSourceId);
    // AC-Speicher: powerOf liefert >0 = Ladung, <0 = Entladung (Fetcher-Konvention).
    const power = rawPower(s.id) ?? rawPower(s.powerSourceId);
    batterySocs.push({ label: `AC${acCount}`, soc, power });
  }
  let dcCount = 0;
  for (const s of sources) {
    if (s.role !== "dcBattery" || !sourceEnabled(s)) continue;
    dcCount++;
    const soc = socValue(s.dcLinkedBatteryOut) ?? socValue(s.dcLinkedPv);
    // DC-Speicher: Netto-Leistung = Ladung (PV + AC-Lader) − Entladung
    // (batteryOut). Ergebnis in gleicher Konvention: >0 laden, <0 entladen.
    const pvW = rawPower(s.dcLinkedPv);
    const chW = rawPower(s.dcLinkedCharger);
    const outW = rawPower(s.dcLinkedBatteryOut); // batteryOut: positiv = Einspeisung/Entladung
    let power: number | null = null;
    if (pvW != null || chW != null || outW != null) {
      power = (pvW ?? 0) + (chW ?? 0) - (outW ?? 0);
    }
    batterySocs.push({ label: `DC${dcCount}`, soc, power });
  }
  live.batterySocs = batterySocs;
  live.tankUpTemp = tankUp;
  live.tankDownTemp = tankDown;
  live.consumers = consumers;
  // Verbraucher-Energie der laufenden Viertelstunde fortschreiben (Integration).
  accumulateConsumers(consumers);
  accumulatePv(pvErzeuger);
  // Tages-PV-Ertrag der integrated-Quellen per Leistungsintegration fortschreiben
  // (migrationsfest, unabhängig von Zähler-Ankern). Analog zu pvEigenDayAccum:
  // Reset beim Tageswechsel, Seed beim Programmstart aus den persistierten
  // pv_viertelstunden. So entspricht pvDay auf der Übersicht dem tatsächlichen
  // Ertrag (wie die Stromerzeugungsseite), auch direkt nach einer Datenübernahme.
  {
    const heutePvI = now().date;
    if (heutePvI !== pvIntegratedDay) {
      pvIntegratedDay = heutePvI;
      pvIntegratedDayAccum = 0;
      pvIntegratedDcDayAccum = 0;
      lastPvIntegratedTick = 0;
    }
    if (!pvIntegratedStartSeeded) {
      pvIntegratedStartSeeded = true;
      try {
        const { von, bis } = db.dayBounds(heutePvI);
        const pvArr = db.getPvTagesSummen(von, bis); // {source, kwh} – enthält integrated-Anlagen
        const perSrc: Record<string, number> = {};
        for (const r of pvArr) perSrc[r.source] = (perSrc[r.source] ?? 0) + (r.kwh ?? 0);
        for (const s of sources) {
          if (!sourceEnabled(s) || s.role !== "pv" || s.energySource !== "integrated") continue;
          const seed = Math.max(0, perSrc[s.id] ?? 0);
          pvIntegratedDayAccum += seed;
          if (s.pvTarget === "dc") pvIntegratedDcDayAccum += seed;
        }
      } catch { /* Seed best effort */ }
    }
    const nowMsPvI = Date.now();
    if (lastPvIntegratedTick > 0) {
      const dtH = (nowMsPvI - lastPvIntegratedTick) / 3_600_000;
      if (dtH > 0 && dtH < 0.5) {
        for (const s of sources) {
          if (!sourceEnabled(s) || s.role !== "pv" || s.energySource !== "integrated") continue;
          const p = pvErzeuger.find((x) => x.id === s.id)?.power ?? 0;
          if (p > 0) {
            const inc = (p / 1000) * dtH;
            pvIntegratedDayAccum += inc;
            if (s.pvTarget === "dc") pvIntegratedDcDayAccum += inc;
          }
        }
      }
    }
    lastPvIntegratedTick = nowMsPvI;
  }
  // PV-Eigenverbrauch als zeitintegrierte Momentanleistung fortschreiben: die
  // PV-AC-Leistung, die nicht ins Netz eingespeist wird. Beim Tageswechsel auf 0.
  {
    const heutePv = now().date;
    if (heutePv !== pvEigenDay) { pvEigenDay = heutePv; pvEigenDayAccum = 0; lastPvEigenTick = 0; }
    // Einmalig BEIM PROGRAMMSTART (nicht bei jedem Tageswechsel!) den heute bereits
    // aufgelaufenen PV-Eigenverbrauch aus den persistierten Viertelstundenwerten
    // (verbrauchPv) vorbelegen. Ohne diese Vorbelegung würde der Zähler nach einem
    // Neustart / einer Datenübernahme aus hems_old.db bei 0 beginnen, obwohl heute
    // schon Eigenverbrauch stattfand. WICHTIG: nur einmal pro Prozess – sonst würde
    // beim Tageswechsel um Mitternacht der (noch aus dem Vortag stammende) Slotwert
    // fälschlich als Startwert des neuen Tages übernommen und der Zähler würde nicht
    // sauber auf 0 zurückgesetzt.
    if (!pvEigenStartSeeded) {
      pvEigenStartSeeded = true;
      try {
        const { von, bis } = db.dayBounds(heutePv);
        const s = db.getViertelstundenSummen(von, bis);
        const seed = Math.max(0, s?.verbrauchPv ?? 0);
        if (seed > pvEigenDayAccum) pvEigenDayAccum = seed;
      } catch { /* Seed best effort */ }
    }
    const nowMs2 = Date.now();
    if (lastPvEigenTick > 0) {
      const dtH = (nowMs2 - lastPvEigenTick) / 3_600_000;
      if (dtH > 0 && dtH < 0.5) {
        // Momentan im Haus genutzte PV = PV-AC-Leistung, die weder ins Netz
        // eingespeist noch in die (AC-)Batterie geladen wird. Die AC-Batterie-
        // Ladung (batteryInPower) muss abgezogen werden, da diese PV in den
        // Speicher fließt und nicht direkt im Haus verbraucht wird – sie kommt
        // später über batteryOut zurück. Ohne diesen Abzug würde die aus PV-
        // Überschuss geladene Batterieenergie fälschlich als Hausnutzung zählen.
        //
        // §42c-Sharing: Die am Netzzähler gemessene Einspeisung enthält auch die
        // Batterieleistung, die für externe Abnehmer ins Netz gespeist wird
        // (batteryTo42cPower). Diese stammt nicht aus der PV und darf den
        // PV-Eigenverbrauch nicht mindern – sonst sinkt der PV-Direktverbrauch
        // scheinbar auf 0, sobald der Speicher fürs Sharing einspeist.
        const pvAcLeistung = Math.max(0, live.pvPower - live.pvDcPower);
        const battTo42c = Math.max(0, live.batteryTo42cPower);
        const einspeisung = Math.max(0, (live.gridPower < 0 ? -live.gridPower : 0) - battTo42c);
        const batterieLadung = Math.max(0, live.batteryInPower);
        const pvEigenLeistung = Math.max(0, pvAcLeistung - einspeisung - batterieLadung);
        pvEigenDayAccum += (pvEigenLeistung / 1000) * dtH;
      }
    }
    lastPvEigenTick = nowMs2;
  }

  // --- Automatisierungsregeln auswerten (inkl. aller Push-Auslöser) ---
  void evaluateAutomationRules(batterySoC);

  day.gridDayBezug = gridDayBezug;
  day.gridDayEingespeist = gridDayEing;
  // pvDay = zählerbasierter Anteil (counter-Quellen, oben über dayDiff summiert)
  // + leistungsintegrierter Anteil der integrated-Quellen (migrationsfest). Ohne
  // Letzteres war pvDay auf der Übersicht viel zu klein, weil die integrated-
  // Anlagen (z.B. Growatt MOD/MIC) über den unzuverlässigen Zähler-Ankerpfad
  // liefen. Jetzt konsistent zum PV-Ertrag der Stromerzeugungsseite.
  day.pvDay = pvDay + Math.max(0, pvIntegratedDayAccum);
  day.pvDcDay = pvDcDay + Math.max(0, pvIntegratedDcDayAccum);
  day.batteryOutDay = batteryOutDay;
  day.batteryInDay = batteryInDay;

  // Im Haus verbrauchter Anteil = im Haus genutzte PV (direkt) + im Haus genutzte
  // Batterie-Entladung.
  //
  // Der PV-Direktanteil wird bewusst aus der zeitintegrierten Momentanleistung
  // (pvEigenDayAccum) übernommen und NICHT aus der Zählerbilanz
  // (pvDay − pvDcDay − gridDayEing) rekonstruiert. Grund: pvEigenDayAccum misst
  // die tatsächlich zeitgleich im Haus genutzte PV und ist unabhängig von den
  // (kumulativen) PV-Zählerankern. Die Zählerbilanz dagegen bricht ein, wenn der
  // PV-Tagesanker nach einer Datenübernahme aus hems_old.db für den laufenden Tag
  // nicht sauber startet: pvDay beginnt dann zu niedrig, wodurch der berechnete
  // Eigenverbrauch (und damit auch der Gesamtverbrauch/die Autarkie) einbrach oder
  // sogar negativ wurde – während der Tagesverlauf-Chart korrekt blieb, weil er
  // ebenfalls auf der leistungsintegrierten Größe basiert.
  //
  // Der Speicheranteil = im Haus genutzte Batterie-Entladung = Gesamt-Entladung
  // (batteryOutDay) abzüglich des an §42c-Abnehmer gelieferten Batterie-Anteils.
  // Er stammt aus eigenen, migrationsfesten Ankern und bleibt unverändert.
  const pvEigenHeute = Math.max(0, pvEigenDayAccum);
  const batt42cHeute = Math.min(day.batteryTo42cEnergy, batteryOutDay);
  const speicherHeute = Math.max(0, batteryOutDay - batt42cHeute);
  day.energyDayConsumed = pvEigenHeute + speicherHeute;

  // Monotone Klemme für den ANGEZEIGTEN kumulierten Haus-Tagesverbrauch.
  // Grund: gridDayBezug und die PV-Erzeugung gehen mit unterschiedlicher
  // Zähler-Auflösung in die Bilanz ein (Einspeisung fein, PV grob), wodurch die
  // berechnete Verbrauchssumme kurz zurücklaufen kann (Sägezahn). Ein kumulierter
  // Tageswert darf aber nie zurücklaufen: Der Anzeigewert wird daher nur erhöht,
  // nie gesenkt, und beim Tageswechsel auf den aktuellen Rohwert zurückgesetzt.
  // Die Rohfelder bleiben für Autarkie/Kosten unberührt.
  const verbrauchRoh = day.gridDayBezug + day.energyDayConsumed;
  const heuteKlemme = now().date;
  if (heuteKlemme !== monotonDay) {
    // Neuer Tag: Hausverbrauch-Klemme lösen, Startwert ist der aktuelle Rohwert.
    monotonDay = heuteKlemme;
    day.hausverbrauchDayMonoton = Math.max(0, verbrauchRoh);
  } else {
    day.hausverbrauchDayMonoton = Math.max(day.hausverbrauchDayMonoton, verbrauchRoh);
  }

  // PV-Eigenverbrauch (im Haus genutzte PV) für die Übersicht: die über den Tag
  // zeitintegrierte Momentanleistung „PV-AC minus Netzeinspeisung". Das ist
  // dieselbe Größe wie die Momentananzeige und misst tatsächlich zeitgleich im
  // Haus genutzte PV – anders als die Tagesbilanz pvDay−eingespeist−pvDc, die
  // zeitversetzten Verbrauch/Erzeugung überschätzt.
  day.pvConsumedDayMonoton = Math.max(0, pvEigenDayAccum);
  day.energyAutarkie =
    (day.energyDayConsumed / (day.energyDayConsumed + gridDayBezug || 1)) * 100;
  // Tageskosten und Einspeisevergütung viertelstundengenau aus den
  // gespeicherten VS-Werten und Spotpreisen berechnen (on-the-fly, nicht
  // persistiert). Bis zum aktuellen Zeitpunkt des Tages aufsummiert.
  const heute = now().date;
  const tk = computeTagesKosten(heute, settings);
  day.tagesBezugskosten = tk.bezugskosten;
  day.tagesEinspeiseverguetung = tk.einspeiseverguetung;
  day.tagesSharingVerguetung = tk.sharingVerguetung;
  day.costsAdded = tk.saldo;

  // Viertelstunden-Energiewerte fortschreiben (sobald die Zähler bereit sind).
  if (db.getInitDone()) {
    lastCurTotals = { gridIn, gridOut, pvTotal, batteryOutTotal, pvDcTotal };
    checkViertelstunde({
      gridIn,
      gridOut,
      pvTotal,
      batteryOutTotal,
      pvDcTotal,
    });
  }

  // Senken (emulierter Shelly Pro 3EM) mit den frischesten Werten neu berechnen.
  computeSinks();
}

// Baut die für Senken-Formeln verfügbaren Variablen. Namen sind bewusst stabil
// und sprechend, damit Nutzer sie in eigenen Formeln verwenden können:
//   <quellId>            -> aktuelle Leistung dieser Quelle in W (+ Bezug/Verbrauch)
//   haus                 -> Leistung der Basis-Quelle der jeweiligen Senke (wird
//                           pro Senke gesetzt, s.u.)
//   abnehmer42c          -> Summe des aktuellen Bezugs aller §42c-Abnehmer (W)
//   <sinkId>_leistung    -> aktuelle Ausgabeleistung (Sollwert) einer Senke (W)
//   <sinkId>_max         -> maximale Leistung dieser Senke (W; 0 = unbegrenzt)
// Quell- und Senken-IDs werden für die Variablennamen auf [A-Za-z0-9_] reduziert.
function sanitizeVar(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

function buildSinkVariables(abnehmer42c: number, prevStatus: Record<string, SinkStatus>): Record<string, number> {
  const vars: Record<string, number> = { abnehmer42c };
  for (const s of sources) {
    vars[sanitizeVar(s.id)] = sourceEnabled(s) ? powerOf(s.id) : 0;
  }
  for (const sink of sinks) {
    const key = sanitizeVar(sink.id);
    // Ausgabeleistung aus dem zuletzt berechneten Status (ein Zyklus Verzögerung –
    // für die Priorisierungs-Logik völlig ausreichend, da im Sekundentakt neu
    // berechnet wird und sich Leistungen langsam ändern).
    vars[`${key}_leistung`] = prevStatus[sink.id]?.outputPowerW ?? sinkStatus[sink.id]?.outputPowerW ?? 0;
    vars[`${key}_max`] = sink.maxPowerW || 0;
  }
  return vars;
}

// Liefert die Liste der für Formeln verfügbaren Variablennamen (für die UI-
// Dokumentation und die Validierung). Mit kurzer Beschreibung.
export function sinkFormulaVariables(): Array<{ name: string; desc: string }> {
  const out: Array<{ name: string; desc: string }> = [
    { name: "haus", desc: "Leistung der Basis-Quelle dieser Senke (W, + = Bezug)" },
    { name: "abnehmer42c", desc: "Summe des Bezugs aller §42c-Abnehmer (W)" },
  ];
  for (const s of sources) {
    out.push({ name: sanitizeVar(s.id), desc: `Leistung der Quelle „${s.label}" (W)` });
  }
  for (const sink of sinks) {
    const key = sanitizeVar(sink.id);
    out.push({ name: `${key}_leistung`, desc: `aktuelle Ausspeisung der Senke „${sink.name}" (W)` });
    out.push({ name: `${key}_max`, desc: `Maximalleistung der Senke „${sink.name}" (W)` });
  }
  return out;
}

// Validiert eine Formel gegen die verfügbaren Variablennamen und wertet sie mit
// den aktuellen Live-Werten aus (für die Vorschau in der Senken-Konfiguration).
// baseSourceId bestimmt den Wert von „haus". Rückgabe: Gültigkeit + Live-Wert +
// die aktuell eingesetzten Variablenwerte (nur die in der Formel verwendeten).
export function evalSinkFormula(
  formula: string,
  baseSourceId?: string
): { ok: boolean; value?: number; error?: string; usedVars?: Record<string, number> } {
  const names = sinkFormulaVariables().map((v) => v.name);
  const valid = validateFormula(formula, names);
  if (!valid.ok) return { ok: false, error: valid.error };

  // Live-Variablen aufbauen (wie in computeSinks).
  let abnehmer42c = 0;
  for (const s of sources) {
    if (!is42cRole(s.role)) continue;
    if (!sourceEnabled(s)) continue;
    const p = powerOf(s.id);
    if (p > 0) abnehmer42c += p;
  }
  const vars = buildSinkVariables(abnehmer42c, sinkStatus);
  vars.haus = baseSourceId ? powerOf(baseSourceId) : 0;

  const r = evalFormula(formula, vars);
  if (!r.ok) return { ok: false, error: r.error };
  // Nur die tatsächlich verwendeten Variablen zurückgeben (Übersicht).
  const used: Record<string, number> = {};
  for (const n of valid.usedVars) if (n in vars) used[n] = Math.round(vars[n] * 10) / 10;
  return { ok: true, value: Math.round(r.value * 10) / 10, usedVars: used };
}
// Zwei Modi:
//   1. Benutzerdefinierte Formel (sink.formula gesetzt und gültig): der Sollwert
//      ergibt sich aus der Formel mit den Variablen aus buildSinkVariables().
//   2. Einfache Berechnung: eigenBezug*baseFactor + Offsets + optional §42c.
// Ergebnis wird auf [0 .. maxPowerW] geklemmt.
function computeSinks(): void {
  const status: Record<string, SinkStatus> = {};
  const prevStatus = sinkStatus; // Status des Vorzyklus (für <sink>_leistung)
  // Aktueller zu deckender Bedarf aller aktiven §42c-Abnehmer. Je Abnehmer
  // zählt nur positiver Netzbezug: speist ein Abnehmer mit eigener PV selbst
  // ein (negative Leistung), ist sein Bedarf 0 – er darf den Sollwert für die
  // übrigen Abnehmer nicht verringern.
  let abnehmerBezug = 0;
  for (const s of sources) {
    if (!is42cRole(s.role)) continue;
    if (!sourceEnabled(s)) continue;
    const p = powerOf(s.id);
    if (p > 0) abnehmerBezug += p;
  }

  const baseVars = buildSinkVariables(abnehmerBezug, prevStatus);

  for (const sink of sinks) {
    const base = sourceById(sink.baseSourceId);
    // SICHERHEIT (CT-Regelung): Ein emulierter CT-Zähler steuert die Speicher
    // direkt. Fehlt eine FRISCHE Messung der Basis-Quelle (Netzzähler), darf NICHT
    // auf dem letzten (eingefrorenen) Wert weitergeregelt werden – das ließe die
    // Speicher blind konstant einspeisen, bis sie leer sind. Stattdessen wird die
    // Senke in einen sicheren Zustand gefahren: Ausgabe 0 und Fadeout erzwingen
    // (Speicher kontrolliert auf 0 W). Betrifft nur CT-emulierende Senken mit
    // gesetzter Basis-Quelle.
    const istCt = sink.emulatedMeter === "ct002" || sink.emulatedMeter === "ct003";
    const regelungBlind =
      istCt && sink.enabled && !!sink.baseSourceId && !isFreshForControl(sink.baseSourceId);
    if (regelungBlind) {
      const st = ensureStatus(sink.id + "@ctsafe");
      if (!st.offlineLogged) {
        db.addLog(
          db.LOG_LEVELS.warn,
          "ct",
          `CT-Regelung '${sink.name}': keine frische Messung von '${base?.label ?? sink.baseSourceId}' – Speicher werden sicherheitshalber auf 0 gefahren (kein Blindregeln auf altem Wert).`,
        );
        st.offlineLogged = true;
      }
      ctSafeShutdown.add(sink.id);
      status[sink.id] = {
        id: sink.id,
        name: sink.name,
        baseSourceId: sink.baseSourceId,
        baseSourceLabel: base?.label ?? sink.baseSourceId,
        enabled: sink.enabled,
        outputPowerW: 0,
        eigenBezugW: 0,
        abnehmerBezugW: 0,
        formulaError: null,
        lastUpdate: new Date().toISOString(),
      };
      continue;
    } else if (istCt) {
      // Wieder frische Messung -> Sicherheits-Fadeout aufheben und einmalige
      // Entwarnung, falls zuvor blind.
      if (ctSafeShutdown.has(sink.id)) {
        ctSafeShutdown.delete(sink.id);
        db.addLog(db.LOG_LEVELS.info, "ct", `CT-Regelung '${sink.name}': Messung wieder frisch, normale Regelung aktiv.`);
      }
      const st = sourceStatus[sink.id + "@ctsafe"];
      if (st) st.offlineLogged = false;
    }
    // Basis-Quelle (eigener Hauszähler) mit konfigurierbarem Faktor gewichten.
    // Beispiel: baseFactor 0.5 -> nur der halbe Hausverbrauch als Sollwert
    // (etwa um zwei Speicher gleichmäßig auf den Verbrauch aufzuteilen).
    const baseFactor = sink.baseFactor ?? 1;
    const eigenRaw = sink.baseSourceId ? powerOf(sink.baseSourceId) : 0;
    const eigenBezug = eigenRaw * baseFactor;

    // Frei konfigurierbare Offsets: je weitere Quelle ein gewichteter Beitrag.
    let offsetSum = 0;
    for (const off of sink.offsets ?? []) {
      let p = powerOf(off.sourceId);
      if (off.onlyPositive && p < 0) p = 0;
      offsetSum += p * (off.factor ?? 1);
    }

    // §42c-Bedarf optional aufaddieren (nur wenn für diese Senke aktiviert).
    let abn = sink.include42c ? abnehmerBezug : 0;
    // Getrenntes §42c-Limit: begrenzt NUR die zusätzliche Abgabe an externe
    // §42c-Abnehmer (den aufaddierten Abnehmerbedarf), nicht den eigenen
    // Hausverbrauch. Beispiel: Max. Leistung = 0 (unbegrenzt) und Max. Leistung
    // 42c = 800 -> der Eigenbezug wird voll gedeckt, darüber hinaus fließen aber
    // höchstens 800 W zusätzlich für die Abnehmer. Nur wirksam bei include42c.
    if (sink.include42c && (sink.maxPower42cW ?? 0) > 0 && abn > (sink.maxPower42cW as number)) {
      abn = sink.maxPower42cW as number;
    }

    let output: number;
    let formulaError: string | null = null;
    if (sink.formula && sink.formula.trim()) {
      // Formelmodus: „haus" = Basis-Quelle dieser Senke.
      const vars = { ...baseVars, haus: eigenRaw };
      const r = evalFormula(sink.formula, vars);
      if (r.ok) {
        output = r.value;
      } else {
        // Bei Formelfehler: Senke liefert 0 und der Fehler wird im Status vermerkt.
        output = 0;
        formulaError = r.error;
      }
    } else {
      output = eigenBezug + offsetSum + abn;
    }
    // Netz-Zielwert: Standard 0 (Nulleinspeisung). Ein negativer Zielwert (z. B.
    // -10) bewirkt bewusst leichte Einspeisung statt Bezug – der Speicher regelt
    // dann so, dass am Netz -10 W stehen. Realisiert durch Abziehen des Zielwerts
    // vom Sollwert: liegt der Zielwert unter 0, erhöht sich der an den Speicher
    // gemeldete Bedarf entsprechend.
    const zielNetz = sink.targetOffsetW ?? 0;
    output = output - zielNetz;
    // Sollwert wird vorzeichengetreu weitergegeben: der emulierte Zähler meldet
    // dem Speicher die reale Netzsituation (positiv = Bezug -> entladen, negativ
    // = Überschuss -> laden). Der Speicher entscheidet selbst, was er tut – so
    // wie an einem echten Zähler. Eine gesetzte Maximalleistung begrenzt beide
    // Richtungen symmetrisch (±maxPowerW).
    // Bei CT-Senken (Multi-Speicher-Balancer) wird die Grenze NICHT hier auf das
    // Netz-Regelsignal angewandt, sondern als Gesamtlimit an den Balancer
    // durchgereicht (getCtSinkInfo.maxTotalW), der damit die kombinierte
    // Speicherleistung begrenzt. Das Regelsignal ist die Netzabweichung, nicht
    // die Speicherleistung – es hier zu klemmen wäre semantisch falsch und würde
    // die Begrenzung doppeln.
    if (sink.maxPowerW > 0 && !istCt) {
      if (output > sink.maxPowerW) output = sink.maxPowerW;
      else if (output < -sink.maxPowerW) output = -sink.maxPowerW;
    }
    if (!sink.enabled) output = 0;
    status[sink.id] = {
      id: sink.id,
      name: sink.name,
      baseSourceId: sink.baseSourceId,
      baseSourceLabel: base?.label ?? sink.baseSourceId,
      enabled: sink.enabled,
      outputPowerW: Math.round(output * 10) / 10,
      eigenBezugW: Math.round(eigenBezug * 10) / 10,
      abnehmerBezugW: Math.round((offsetSum + abn) * 10) / 10,
      formulaError,
      lastUpdate: new Date().toISOString(),
    };
  }
  sinkStatus = status;

  // --- Datenbereitstellung an externe HEMS (sinkRole "extHems") ---
  // Nach der Senkenberechnung sind alle Live-Größen aktuell. Für jede aktive
  // extHems-Senke die aktuellen Werte bündeln und (nur bei Änderung) publizieren.
  const extHemsSinks = sinks.filter((s) => s.sinkRole === "extHems" && s.enabled !== false);
  if (extHemsSinks.length > 0) {
    const pvAc = live.pvPower - live.pvDcPower;
    const hausverbrauch = Math.max(0, pvAc + live.batteryOutPower + live.gridPower - live.batteryInPower);
    // Abgebbares Leistungslimit: Summe der maxPower42cW/maxPowerW der aktiven,
    // §42c-fähigen "meter"-Senken (0 = unbegrenzt). Grobe, aber sinnvolle Größe.
    let abgebbaresLimit = 0;
    for (const s of sinks) {
      if (s.sinkRole === "extHems" || s.enabled === false) continue;
      if (s.include42c) abgebbaresLimit += (s.maxPower42cW ?? 0) || (s.maxPowerW ?? 0);
    }
    const inp: ExtHemsInputs = {
      ueberschuss: live.gridPower < 0 ? -live.gridPower : 0,
      abgebbaresLimit,
      batterieSoc: live.batterySoC ?? 0,
      batterieLeistung: (live.batteryOutPower ?? 0) - (live.batteryInPower ?? 0),
      pvLeistung: live.pvPower ?? 0,
      hausverbrauch,
      netzleistung: live.gridPower ?? 0,
      sharingLeistung: live.sharing42cPowerNow ?? 0,
      restertragHeute: live.restPvKwh ?? 0,
    };
    const neededPubKeys = new Set<string>();
    for (const sink of extHemsSinks) {
      if (sink.mqttUrl) neededPubKeys.add(publisherKey(sink));
      publishExtHems(sink, inp, (msg) => log.warn("exthems", msg));
    }
    reconcilePublishers(neededPubKeys);
  } else {
    reconcilePublishers(new Set());
  }
}

// --- Viertelstunden-Energieerfassung (Variante 2: aus Zählerdifferenzen) ---
// Methodik je abgeschlossener Viertelstunde:
//   eingespeist = Δ gridOut
//   bezogen     = Δ gridIn
//   verbrauch   = Δ pvTotal − Δ pvDcTotal + Δ batteryOutTotal − eingespeist + bezogen
// Der DC-Ladeanteil (Δ pvDcTotal) wird abgezogen, da diese Energie in die
// Batterie geladen und nicht im Haus verbraucht wird (sie kommt erst über
// batteryOut zurück und wird dann gezählt).
// Alle Δ mit Rücksprung-Schutz: springt ein Zähler zurück (aktuell < Anker),
// wird die Differenz dieser Größe für diese Viertelstunde 0 (statt negativ).
// Anker + laufender Slot werden in der resets-Tabelle gehalten, damit ein
// Neustart die laufende Viertelstunde nicht verfälscht.
const VS_ANCHOR = {
  slot: "vs.slot", // verankerter Viertelstunden-Index (Minuten seit Epoche / 15)
  gridIn: "vs.gridIn",
  gridOut: "vs.gridOut",
  // PV, pvDc und Batterie werden PRO QUELLE verankert (vs.pv.<id> usw.), siehe
  // sumPerSourceVsDiff – kein globaler Summen-Anker mehr.
};

// Verbraucher-Energie durch Zeitintegration der Momentanleistung. Verbraucher
// liefern nur power (W), keinen Energiezähler – daher integrieren wir über die
// reale Zeit. consumerVsAccum sammelt die kWh der laufenden Viertelstunde je
// Gerät (beim VS-Wechsel weggeschrieben und geleert).
const consumerVsAccum: Record<string, number> = {};
let lastConsumerTick = 0;

// Liefert die bisher in der LAUFENDEN Viertelstunde aufgelaufene Energie (kWh)
// eines Verbrauchers – für die Anzeige des angefangenen Slots im Tagesverlauf,
// bevor er beim VS-Wechsel weggeschrieben wird. Der zugehörige Slot-Index (0..95)
// wird mitgeliefert, damit die UI den Wert an der richtigen Stelle zeigt.
export function getConsumerCurrentSlot(id: string): { slotIndex: number; kwh: number } {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const slotIndex = Math.floor(minutes / 15);
  return { slotIndex, kwh: consumerVsAccum[id] ?? 0 };
}

// Tagessummen der bereits weggeschriebenen Verbraucher-Viertelstunden (heute),
// kurz gecacht (ein aggregate-Lauf fragt sonst je Verbraucher neu ab).
let consumerDaySumsCache: { date: string; ms: number; sums: Record<string, number> } | null = null;
function consumerDaySumsToday(): Record<string, number> {
  const heute = now().date;
  const nowMs = Date.now();
  if (consumerDaySumsCache && consumerDaySumsCache.date === heute && nowMs - consumerDaySumsCache.ms < 2000) {
    return consumerDaySumsCache.sums;
  }
  const { von, bis } = db.dayBounds(heute);
  const sums = db.getConsumerDaySums(von, bis);
  consumerDaySumsCache = { date: heute, ms: nowMs, sums };
  return sums;
}

// Integriert die aktuellen Verbraucherleistungen in die VS-Akkumulatoren.
// Normale Verbraucher: nur positive Leistung (Verbrauch). Bidirektionale
// Speicher (AC-Batterie): Bezug (power>0) und Einspeisung (power<0) werden
// GETRENNT akkumuliert – der Einspeiseanteil unter der abgeleiteten ID
// "<id>::feedin", damit im Chart beide Richtungen ohne Saldierung darstellbar
// sind.
function accumulateConsumers(consumers: ConsumerEntry[]): void {
  const nowMs = Date.now();
  if (lastConsumerTick > 0) {
    const dtH = (nowMs - lastConsumerTick) / 3_600_000;
    if (dtH > 0 && dtH < 0.5) {
      for (const c of consumers) {
        if (c.bidirectional) {
          if (c.power > 0) {
            consumerVsAccum[c.id] = (consumerVsAccum[c.id] ?? 0) + (c.power / 1000) * dtH;
          } else if (c.power < 0) {
            const fid = `${c.id}::feedin`;
            consumerVsAccum[fid] = (consumerVsAccum[fid] ?? 0) + (-c.power / 1000) * dtH;
          }
        } else if (c.power > 0) {
          consumerVsAccum[c.id] = (consumerVsAccum[c.id] ?? 0) + (c.power / 1000) * dtH;
        }
      }
    }
  }
  lastConsumerTick = nowMs;
}

// PV-Ertrag je Anlage in der laufenden Viertelstunde (kWh), analog zu den
// Verbrauchern. Beim VS-Wechsel weggeschrieben und geleert.
const pvVsAccum: Record<string, number> = {};
let lastPvTick = 0;
function accumulatePv(erzeuger: Array<{ id: string; power: number }>): void {
  const nowMs = Date.now();
  if (lastPvTick > 0) {
    const dtH = (nowMs - lastPvTick) / 3_600_000;
    if (dtH > 0 && dtH < 0.5) {
      for (const p of erzeuger) {
        if (p.power > 0) pvVsAccum[p.id] = (pvVsAccum[p.id] ?? 0) + (p.power / 1000) * dtH;
      }
    }
  }
  lastPvTick = nowMs;
}

// Aufgelaufener PV-Ertrag der laufenden Viertelstunde je Anlage (für die Anzeige
// des angefangenen Slots im Tagesverlauf).
export function getPvCurrentSlot(id: string): { slotIndex: number; kwh: number } {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const slotIndex = Math.floor(minutes / 15);
  return { slotIndex, kwh: pvVsAccum[id] ?? 0 };
}

// laufender Viertelstunden-Index aus einem Date (lokal, 15-Minuten-Raster)
function slotIndex(d: Date): number {
  return Math.floor(d.getTime() / 1000 / 60 / 15);
}
// Ende-Zeitstempel eines Slots als lokaler ISO-String YYYY-MM-DDTHH:MM
function slotEndIso(slot: number): string {
  const end = new Date((slot + 1) * 15 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}T${p(end.getHours())}:${p(end.getMinutes())}`;
}
// Rücksprung-sichere Differenz
// Erststart-sichere Viertelstunden-Differenz pro Zähler.
// Analog zu dayDiff: Bevor ein Zähler-Anker seit Programmstart einmal frisch
// gesetzt wurde, liefert er 0 – so kann ein erst spät (z. B. nachts gar nicht)
// auslesbarer Wechselrichter beim ersten Wert niemals seinen kompletten
// historischen Zählerstand als Viertelstundenertrag verbuchen. Der Anker wird
// beim ersten verfügbaren Wert (>0) auf den aktuellen Stand gesetzt; ab dann
// wird der reguläre Zuwachs gezählt. Fehlt der Wert (Quelle nicht lesbar),
// bleibt der Anker ununberührt und die Differenz ist 0.
const vsReanchored = new Set<string>();
// Zählt je Anker, wie viele aufeinanderfolgende Viertelstunden der Messwert
// unter dem Anker lag (ohne echten Reset auf ~0). Ein einzelner Rückgang kann
// eine Fehlmessung sein; ein ANHALTENDER Rückgang (mehrere VS) ist dagegen ein
// legitimer dauerhafter Rücksprung des zugrunde liegenden Zählerstands (z.B.
// emulierte §42c-Quelle nach Skalierungsänderung) -> dann neu verankern, damit
// nicht über Monate 0-Werte geliefert werden.
const vsBackwardCount = new Map<string, number>();
const VS_BACKWARD_REANCHOR = 3; // nach so vielen VS in Folge unter Anker: neu verankern
function vsDiff(anchorKey: string, current: number | undefined): number {
  // Kein Messwert vorhanden (Quelle gerade nicht lesbar): nichts beitragen,
  // Anker unverändert lassen (wird nachgeholt, sobald wieder Werte kommen).
  if (current == null) return 0;
  if (!vsReanchored.has(anchorKey)) {
    if (current > 0) {
      vsReanchored.add(anchorKey);
      db.setReset(anchorKey, current); // auf aktuellen Stand verankern
    }
    return 0; // erster Wert seit Start: kein Altbestand zählen
  }
  const anchor = db.getReset(anchorKey, -1);
  if (anchor < 0) {
    db.setReset(anchorKey, current);
    return 0;
  }
  // Kleine Toleranz gegen Fließkomma-/Messrauschen: Ein Rückgang von wenigen
  // Wh (z.B. 30.5524 -> 30.5519 kWh) ist kein echter Zähler-Rücksprung, sondern
  // Rundungs-/Messrauschen – auf 3 Nachkommastellen sehen beide Werte identisch
  // aus. Ohne Toleranz würde ein solcher Mikro-Rückgang über mehrere
  // Viertelstunden fälschlich eine Neuverankerung auslösen. 1 Wh Toleranz.
  const NOISE_KWH = 0.001;
  if (current >= anchor - NOISE_KWH) {
    const diff = Math.max(0, current - anchor);
    if (current > anchor) db.setReset(anchorKey, current); // Anker nur vorwärts nachführen
    vsBackwardCount.delete(anchorKey); // normaler Verlauf -> Rückwärts-Zähler weg
    return diff;
  }
  // current < anchor: entweder (a) vorübergehende Fehlmeldung 0 (z.B. ein
  // Wechselrichter meldet nachts 0 statt seines Gesamtstands) ODER (b) ein
  // echter Zähler-Reset (Shelly-Neustart -> Zähler beginnt wieder bei 0).
  //  - Fall (a): typischerweise EXAKT 0. Anker halten, 0 beitragen; beim
  //    nächsten echten Wert springt die Quelle auf ihren Gesamtstand zurück und
  //    darf diesen NICHT als Viertelstundenwert einschleusen.
  //  - Fall (b): der neue Stand ist positiv und klein und zählt von dort hoch.
  //    Dann ist dieser neue Stand selbst der Zuwachs seit dem Reset -> zählen,
  //    damit die in dieser VS geflossene Energie nicht verlorengeht.
  // Ein Reset wird nur angenommen, wenn der neue Stand DEUTLICH unter dem Anker
  // liegt (echter Rücksprung auf ~0), nicht bei einem kleinen Rückgang – so kann
  // eine einzelne Fehlmessung knapp unter dem Anker den Anker nicht nach unten
  // ziehen und beim Folgewert keinen Scheinzuwachs erzeugen.
  const wirktWieReset = current > 0 && current < anchor * 0.5;
  if (wirktWieReset) {
    db.addLog(
      db.LOG_LEVELS.debug,
      "poller",
      `Zaehler-Ruecksetzung (Viertelstunde) erkannt: ${anchorKey} von ${anchor.toFixed(3)} kWh auf ${current.toFixed(3)} kWh zurueckgesetzt; Zuwachs seit Reset wird weitergezaehlt.`,
    );
    db.setReset(anchorKey, current); // ab dem Reset-Stand neu weiterzählen
    vsBackwardCount.delete(anchorKey);
    return current;
  }
  // Kleiner/mittlerer Rückgang (zwischen ~50% und 100% des Ankers): kann eine
  // einzelne Fehlmessung sein -> zunächst Anker halten, 0 beitragen. Hält der
  // Rückgang aber über mehrere Viertelstunden an, ist es ein dauerhafter
  // Rücksprung des Zählerstands (z.B. §42c-Emu nach Skalierungsänderung) -> dann
  // neu verankern, damit nicht über Monate 0-Werte geliefert werden.
  const cnt = (vsBackwardCount.get(anchorKey) ?? 0) + 1;
  vsBackwardCount.set(anchorKey, cnt);
  if (cnt >= VS_BACKWARD_REANCHOR) {
    db.addLog(
      db.LOG_LEVELS.info,
      "poller",
      `Anhaltender Zaehler-Ruecksprung: ${anchorKey} liegt seit ${cnt} Viertelstunden unter dem Anker (${anchor.toFixed(3)} kWh, aktuell ${current.toFixed(3)} kWh) – Anker wird auf den aktuellen Stand neu gesetzt.`,
    );
    db.setReset(anchorKey, current);
    vsBackwardCount.delete(anchorKey);
    return 0; // in dieser VS noch nichts beitragen; ab jetzt zählt es wieder ab 0
  }
  return 0; // Ausfall/Fehlmeldung/kleiner Rückgang: Anker halten, nichts beitragen
}

// Viertelstunden-Delta einer Energie-Rolle, PRO QUELLE verankert und summiert.
// Wichtig gegenüber einem globalen Summen-Anker: Kommt eine einzelne Quelle
// (z.B. ein morgens wieder erreichbarer Wechselrichter) neu hinzu, verankert sie
// sich beim ersten eigenen Wert selbst und trägt 0 bei – ihr historischer
// Gesamtzählerstand kann so nicht als Viertelstundenwert der Summe erscheinen.
// key(id) bildet den quellenspezifischen Anker-Key.
function sumPerSourceVsDiff(
  predicate: (s: SourceConfig) => boolean,
  key: (id: string) => string,
  // Optionaler Endstand je Quelle (Slot-Snapshot). Fehlt er, wird der aktuelle
  // lastRead-Wert genutzt.
  endValues?: Record<string, number | undefined>
): number {
  let sum = 0;
  for (const s of sources) {
    if (!sourceEnabled(s)) continue;
    if (!predicate(s)) continue;
    // Live-Fallback (kein Snapshot): batteryOut liest je nach Variante den
    // richtigen Einspeisezähler (bidirektional -> energyReturnTotal), alle
    // anderen Rollen energyTotal wie bisher.
    const live = s.role === "batteryOut" ? batteryOutMeter(s) : lastRead[s.id]?.values.energyTotal;
    const e = endValues ? endValues[s.id] : live;
    sum += vsDiff(key(s.id), e);
  }
  return sum;
}
const vsPvKey = (id: string) => `vs.pv.${id}`;
const vsPvDcKey = (id: string) => `vs.pvDc.${id}`;
const vsBattKey = (id: string) => `vs.battOut.${id}`;
// AC-Speicher-Entladung (ret_aenergy) je Quelle, separat verankert von vsBattKey
// (das energyTotal der batteryOut-Rolle liest).
const vsBattOutAcKey = (id: string) => `vs.battOutAc.${id}`;
// AC-Netzladung je Quelle (batteryIn: energyTotal; acBattery: aenergy-ret_aenergy).
// Diese Energie geht in die Batterie und wird über den Netzbezug bezahlt – sie
// darf NICHT als Hausverbrauch zählen und wird daher in der Verbrauchsbilanz
// abgezogen (siehe verbrauch-Formel).
const vsBattInKey = (id: string) => `vs.battIn.${id}`;

// Snapshot der zuletzt im laufenden Slot gesehenen Zählerstände. Beim
// Slot-Wechsel wird die abgeschlossene Viertelstunde aus DIESEM Stand (Ende des
// alten Slots) gebildet – nicht aus den bereits in den neuen Slot hineinreichenden
// aktuellen Werten. Das macht die Zuordnung robust gegen Timing-/Asynchronitäts-
// effekte (Quellen werden unabhängig gepollt): der Zuwachs zwischen Slot-Grenze
// und dem ersten Poll danach landet nicht mehr fälschlich in der alten VS.
let slotSnapshot: {
  slot: number;
  gridIn: number;
  gridOut: number;
  pv: Record<string, number | undefined>;
  pvDc: Record<string, number | undefined>;
  batt: Record<string, number | undefined>;
  acDischarge: Record<string, number | undefined>;
  battInCharge: Record<string, number | undefined>;
  s42cIn: Record<string, number | undefined>;
  s42cOut: Record<string, number | undefined>;
} | null = null;

// Aktuellen Zählerstand aller relevanten Größen als Snapshot des laufenden Slots
// festhalten (wird bei jedem aggregate-Lauf innerhalb desselben Slots erneuert).
function captureSlotSnapshot(slot: number, cur: {
  gridIn: number; gridOut: number;
}): void {
  const pv: Record<string, number | undefined> = {};
  const pvDc: Record<string, number | undefined> = {};
  const batt: Record<string, number | undefined> = {};
  const acDischarge: Record<string, number | undefined> = {};
  const battInCharge: Record<string, number | undefined> = {};
  const s42cIn: Record<string, number | undefined> = {};
  const s42cOut: Record<string, number | undefined> = {};
  for (const s of sources) {
    if (s.role === "pv") {
      pv[s.id] = lastRead[s.id]?.values.energyTotal;
      if (s.pvTarget === "dc") pvDc[s.id] = lastRead[s.id]?.values.energyTotal;
    }
    if (s.role === "batteryOut") batt[s.id] = batteryOutMeter(s);
    // AC-Speicher-Entladung über ret_aenergy (ggf. von der verknüpften Shelly).
    if (s.role === "acBattery") acDischarge[s.id] = energyMetricOf(s.id, "energyReturnTotal");
    // AC-Netzladung: reine batteryIn liefert die Ladeenergie direkt über
    // energyTotal; ein acBattery-Zähler zählt beide Richtungen in energyTotal
    // (aenergy), sodass der reine Ladeanteil = energyTotal - energyReturnTotal.
    if (s.role === "batteryIn") {
      battInCharge[s.id] = energyMetricOf(s.id, "energyTotal");
    } else if (s.role === "acBattery") {
      const tot = energyMetricOf(s.id, "energyTotal");
      const ret = energyMetricOf(s.id, "energyReturnTotal");
      battInCharge[s.id] = tot == null ? undefined : tot - (ret ?? 0);
    }
    if (is42cRole(s.role)) {
      s42cIn[s.id] = lastRead[s.id]?.values.gridInTotal;
      s42cOut[s.id] = lastRead[s.id]?.values.gridOutTotal;
    }
  }
  slotSnapshot = { slot, gridIn: cur.gridIn, gridOut: cur.gridOut, pv, pvDc, batt, acDischarge, battInCharge, s42cIn, s42cOut };
}

// Setzt einen VS-Zähler-Anker NUR, wenn er noch fehlt (nicht in der DB, -1) und
// ein gültiger Messwert (> 0) vorliegt. Markiert ihn zugleich als reanchored,
// damit die reguläre vsDiff-Fortschreibung beim nächsten VS-Wechsel korrekt die
// Differenz ab diesem Stand bildet. Verändert einen bereits vorhandenen Anker
// NICHT (kein Vorwärtsschub – sonst würde die laufende VS-Erfassung verfälscht).
function initVsAnchorIfMissing(anchorKey: string, current: number | undefined): void {
  if (current == null || current <= 0) return;
  if (vsReanchored.has(anchorKey)) return;
  if (db.getReset(anchorKey, -1) >= 0) { vsReanchored.add(anchorKey); return; }
  db.setReset(anchorKey, current);
  vsReanchored.add(anchorKey);
}

// Verwirft einen VS-Anker vollständig, sodass vsDiff beim nächsten Messwert
// frisch auf den dann aktuellen Stand verankert (Zuwachs zählt ab da wieder ab
// 0). Nötig, wenn der zugrunde liegende "Zählerstand" legitim nach unten springt
// – z.B. wenn bei einer emulierten §42c-Quelle der Jahresverbrauch (Skalierung)
// oder das Profil geändert wird: der kumulierte Emu-Stand sinkt dann, und ein
// stehen gebliebener alter Anker würde über Monate 0-Werte liefern (geklemmtes
// negatives Delta).
function clearVsAnchor(anchorKey: string): void {
  db.setReset(anchorKey, -1); // -1 = "kein Anker" (vsDiff verankert neu)
  vsReanchored.delete(anchorKey);
}

function checkViertelstunde(cur: {
  gridIn: number;
  gridOut: number;
  pvTotal: number;
  batteryOutTotal: number;
  pvDcTotal: number;
}): void {
  const nowSlot = slotIndex(new Date());
  const anchoredSlot = db.getReset(VS_ANCHOR.slot, -1);

  // Erststart oder noch kein Anker: jetzt verankern, nichts schreiben.
  // Der Slot-Anker (Zeitreferenz) wird sofort gesetzt – unabhängig davon, ob
  // schon alle Energiequellen lesbar sind. Die einzelnen Zähler-Anker werden
  // pro Zähler über vsDiff erststart-sicher gesetzt (siehe unten): ein nachts
  // nicht auslesbarer Wechselrichter blockiert damit nicht mehr die gesamte
  // Erfassung (insb. nicht die §42c-Sharing-Werte), kann aber später auch
  // keinen historischen Gesamtstand als Viertelstundenwert einschleusen.
  if (anchoredSlot < 0) {
    db.setReset(VS_ANCHOR.slot, nowSlot);
    // Vorhandene Zähler gleich verankern (fehlende werden später nachgezogen).
    vsDiff(VS_ANCHOR.gridIn, cur.gridIn);
    vsDiff(VS_ANCHOR.gridOut, cur.gridOut);
    // PV/Batterie pro Quelle verankern (je eigener Anker), damit ein einzeln
    // später hinzukommender Wechselrichter keinen Summensprung erzeugt.
    sumPerSourceVsDiff((s) => s.role === "pv", vsPvKey);
    sumPerSourceVsDiff((s) => s.role === "pv" && s.pvTarget === "dc", vsPvDcKey);
    sumPerSourceVsDiff((s) => s.role === "batteryOut", vsBattKey);
    // AC-Speicher-Entladung (ret_aenergy) ebenfalls je Quelle verankern.
    for (const s of sources) {
      if (sourceEnabled(s) && s.role === "acBattery") {
        vsDiff(vsBattOutAcKey(s.id), energyMetricOf(s.id, "energyReturnTotal"));
      }
    }
    // AC-Netzladung je Quelle verankern (batteryIn + acBattery-Ladeanteil).
    for (const s of sources) {
      if (!sourceEnabled(s)) continue;
      if (s.role === "batteryIn") {
        vsDiff(vsBattInKey(s.id), energyMetricOf(s.id, "energyTotal"));
      } else if (s.role === "acBattery") {
        const tot = energyMetricOf(s.id, "energyTotal");
        const ret = energyMetricOf(s.id, "energyReturnTotal");
        vsDiff(vsBattInKey(s.id), tot == null ? undefined : tot - (ret ?? 0));
      }
    }
    for (const s of sources) {
      if (!is42cRole(s.role)) continue;
      vsDiff(`vs.42c.${s.id}`, lastRead[s.id]?.values.gridInTotal);
      vsDiff(`vs.42cOut.${s.id}`, lastRead[s.id]?.values.gridOutTotal);
    }
    // PV-Leistungsintegral synchron zur Verankerung starten: alles, was vor dem
    // Setzen der Zähler-Anker (ab dem ersten aggregate-Tick) bereits in pvVsAccum
    // gelaufen ist, gehört noch NICHT zur ersten verankerten VS – sonst bekäme
    // diese einen PV-Vorlauf ohne Gegenstück in den Zählerdifferenzen und liefe
    // zu hoch. Daher hier zurücksetzen; die Integration beginnt exakt jetzt.
    for (const id of Object.keys(pvVsAccum)) delete pvVsAccum[id];
    lastPvTick = 0;
    captureSlotSnapshot(nowSlot, cur);
    return;
  }

  // Noch in derselben Viertelstunde: aktuellen Stand als Slot-Snapshot festhalten
  // (Endstand-Kandidat für den Moment kurz vor der nächsten Slot-Grenze).
  if (nowSlot === anchoredSlot) {
    // Nach einem Neustart INNERHALB einer Viertelstunde ist der Slot-Anker aus
    // der DB bereits gesetzt (>= 0), sodass der Erststart-Zweig oben übersprungen
    // wird. Die einzelnen Zähler-Anker (vs.gridIn/gridOut/pv/...) können dabei
    // aber noch fehlen (-1), weil sie erst beim nächsten VS-Wechsel gesetzt
    // würden – der laufende Slot bliebe bis dahin leer. Fehlende Anker hier auf
    // den aktuellen Stand initialisieren (Zuwachs ab jetzt). WICHTIG: nur wenn
    // der Anker fehlt, damit im Normalbetrieb der Anker NICHT vorwärtsgeschoben
    // wird (das würde die abgeschlossene VS beim nächsten Wechsel verfälschen).
    initVsAnchorIfMissing(VS_ANCHOR.gridIn, cur.gridIn);
    initVsAnchorIfMissing(VS_ANCHOR.gridOut, cur.gridOut);
    for (const s of sources) {
      if (sourceEnabled(s) && s.role === "pv") {
        initVsAnchorIfMissing(vsPvKey(s.id), lastRead[s.id]?.values.energyTotal);
        if (s.pvTarget === "dc") initVsAnchorIfMissing(vsPvDcKey(s.id), lastRead[s.id]?.values.energyTotal);
      }
      if (sourceEnabled(s) && s.role === "batteryOut") {
        initVsAnchorIfMissing(vsBattKey(s.id), lastRead[s.id]?.values.energyTotal);
      }
      if (sourceEnabled(s) && s.role === "acBattery") {
        initVsAnchorIfMissing(vsBattOutAcKey(s.id), energyMetricOf(s.id, "energyReturnTotal"));
      }
      // AC-Netzladung (batteryIn + acBattery-Ladeanteil): fehlte hier bisher,
      // wodurch der battIn-Anker nach einem Neustart INNERHALB einer VS auf -1
      // stehen blieb. Folge: Die in der laufenden VS geladene Energie wurde nicht
      // abgezogen, und beim ersten VS-Wechsel setzte vsDiff den Anker auf den
      // dann aktuellen (bereits erhöhten) Stand -> die Ladung der Vorgänger-VS
      // wanderte fälschlich in die neue VS (battInDelta zu hoch, Verbrauch auf 0
      // gedeckelt). Analog zu den übrigen Ankern hier nachziehen.
      if (sourceEnabled(s) && s.role === "batteryIn") {
        initVsAnchorIfMissing(vsBattInKey(s.id), energyMetricOf(s.id, "energyTotal"));
      }
      if (sourceEnabled(s) && s.role === "acBattery") {
        const tot = energyMetricOf(s.id, "energyTotal");
        const ret = energyMetricOf(s.id, "energyReturnTotal");
        initVsAnchorIfMissing(vsBattInKey(s.id), tot == null ? undefined : tot - (ret ?? 0));
      }
      if (is42cRole(s.role)) {
        initVsAnchorIfMissing(`vs.42c.${s.id}`, lastRead[s.id]?.values.gridInTotal);
        initVsAnchorIfMissing(`vs.42cOut.${s.id}`, lastRead[s.id]?.values.gridOutTotal);
      }
    }
    captureSlotSnapshot(nowSlot, cur);
    return;
  }

  // Viertelstundenwechsel. Für die abgeschlossene VS die Endstände des ALTEN
  // Slots verwenden (Snapshot vom letzten Poll vor der Grenze), sofern vorhanden
  // und passend. So reicht der Zuwachs zwischen Grenze und erstem Poll danach
  // nicht mehr in die abgeschlossene VS hinein (robuste Zuordnung). Fehlt ein
  // Snapshot (z. B. direkt nach Start), wird auf die aktuellen Werte
  // zurückgegriffen – wie bisher.
  const snap = slotSnapshot && slotSnapshot.slot === anchoredSlot ? slotSnapshot : null;
  const endGridIn = snap ? snap.gridIn : cur.gridIn;
  const endGridOut = snap ? snap.gridOut : cur.gridOut;

  // Differenzen der abgeschlossenen Viertelstunde bilden.
  // vsDiff liefert 0, solange ein Zähler seit Start noch nicht verankert wurde,
  // und verankert ihn beim ersten verfügbaren Wert – nie ein Altbestand.
  const bezogen = vsDiff(VS_ANCHOR.gridIn, endGridIn);
  const eingespeist = vsDiff(VS_ANCHOR.gridOut, endGridOut);
  // PV/pvDc/Batterie pro Quelle verankert summieren (siehe sumPerSourceVsDiff):
  // so trägt ein morgens neu erreichbarer Wechselrichter seinen Gesamtstand
  // nicht als Viertelstundenwert bei, sondern verankert sich zunächst mit 0.
  // PV pro Quelle: je nach energySource entweder zählerbasiert (vsDiff, Default)
  // oder aus dem Leistungsintegral der laufenden VS (integrated). vsDiff wird für
  // integrated-Quellen dennoch aufgerufen (mit Ergebnis verworfen), damit der
  // Zähler-Anker weiterläuft und ein späteres Umschalten auf "counter" nahtlos
  // funktioniert. Das Integral wird nach dem Auslesen zurückgesetzt.
  // PV pro Quelle: je nach energySource entweder zählerbasiert (vsDiff, Default)
  // oder aus dem Leistungsintegral der laufenden VS. Für den integrierten Anteil
  // wird derselbe Akkumulator (pvVsAccum) genutzt, der auch den PV-Ertrag-
  // Tagesverlauf speist – er läuft in identischer Zeitbasis und wird am Ende
  // dieser Funktion (VS-Wechsel) geleert, sodass hier die Werte der GERADE
  // abgeschlossenen VS anliegen. vsDiff wird für integrated-Quellen dennoch
  // aufgerufen (Ergebnis verworfen), damit der Zähler-Anker weiterläuft und ein
  // späteres Umschalten auf "counter" nahtlos funktioniert.
  const pvIntegratedDelta = (onlyDc: boolean): number => {
    let sum = 0;
    for (const s of sources) {
      if (!sourceEnabled(s) || s.role !== "pv" || s.energySource !== "integrated") continue;
      if (onlyDc && s.pvTarget !== "dc") continue;
      sum += pvVsAccum[s.id] ?? 0;
    }
    return sum;
  };
  // Zählerbasierter Anteil (nur Quellen im counter-Modus tragen bei; integrated-
  // Quellen liefern hier 0, weil ihr Beitrag aus dem Integral kommt).
  const pvCounter = sumPerSourceVsDiff(
    (s) => s.role === "pv" && s.energySource !== "integrated", vsPvKey, snap?.pv);
  const pvDcCounter = sumPerSourceVsDiff(
    (s) => s.role === "pv" && s.pvTarget === "dc" && s.energySource !== "integrated", vsPvDcKey, snap?.pvDc);
  // Anker der integrated-Quellen trotzdem fortführen (Ergebnis verworfen).
  sumPerSourceVsDiff((s) => s.role === "pv" && s.energySource === "integrated", vsPvKey, snap?.pv);
  sumPerSourceVsDiff((s) => s.role === "pv" && s.pvTarget === "dc" && s.energySource === "integrated", vsPvDcKey, snap?.pvDc);
  const pvDelta = pvCounter + pvIntegratedDelta(false);
  const pvDcDelta = pvDcCounter + pvIntegratedDelta(true);
  // Batterie-Entladung dieser VS = batteryOut-Rolle (energyTotal) PLUS AC-Speicher
  // (acBattery, ret_aenergy). Der AC-Anteil wird separat verankert (vsBattOutAcKey)
  // und aus dem Snapshot (snap.acDischarge) bzw. dem aktuellen ret_aenergy-Stand
  // gebildet – so fließt die AC-Speicher-Entladung genauso zählerbasiert in die
  // Bilanz wie der DC-Speicher (batteryOut).
  let battDelta = sumPerSourceVsDiff((s) => s.role === "batteryOut", vsBattKey, snap?.batt);
  for (const s of sources) {
    if (!sourceEnabled(s) || s.role !== "acBattery" || s.subordinateOf) continue;
    const end = snap?.acDischarge ? snap.acDischarge[s.id] : energyMetricOf(s.id, "energyReturnTotal");
    battDelta += vsDiff(vsBattOutAcKey(s.id), end);
  }
  // AC-Netzladung dieser VS: die in AC-Speicher geladene Energie (batteryIn +
  // Ladeanteil von acBattery). Sie erhöht den Netzbezug (bzw. mindert die
  // Einspeisung), geht aber in die Batterie und NICHT ins Haus – daher unten von
  // verbrauch abgezogen. Kommt sonst als Hausverbrauch doppelt zum Tragen.
  let battInDelta = 0;
  for (const s of sources) {
    if (!sourceEnabled(s)) continue;
    // Untergeordnete Mess-Shellys (subordinateOf) NICHT eigenständig zählen: die
    // übergeordnete acBattery greift ihren Zähler bereits über powerSourceId ab.
    // Sonst würde die Ladung des Speichers doppelt abgezogen (Verbrauch zu tief,
    // bis auf 0 gedeckelt).
    if (s.subordinateOf) continue;
    if (s.role === "batteryIn") {
      const end = snap?.battInCharge ? snap.battInCharge[s.id] : energyMetricOf(s.id, "energyTotal");
      battInDelta += vsDiff(vsBattInKey(s.id), end);
    } else if (s.role === "acBattery") {
      let end: number | undefined;
      if (snap?.battInCharge) {
        end = snap.battInCharge[s.id];
      } else {
        const tot = energyMetricOf(s.id, "energyTotal");
        const ret = energyMetricOf(s.id, "energyReturnTotal");
        end = tot == null ? undefined : tot - (ret ?? 0);
      }
      battInDelta += vsDiff(vsBattInKey(s.id), end);
    }
  }
  // DC-Ladeanteil (pvDcDelta) und AC-Netzladung (battInDelta) abziehen: beide
  // Energien gehen in die Batterie, nicht ins Haus (sie kommen erst über
  // batteryOut/Entladung zurück und werden dann als Verbrauch gezählt).
  const verbrauch = pvDelta - pvDcDelta + battDelta - battInDelta - eingespeist + bezogen;

  // Aufteilung der Netzeinspeisung dieser VS nach Herkunft. Die Batterie speist
  // nur bei Bedarf ein, daher zählt die Batterie-Einspeisung (battDelta) zuerst
  // zur Netzeinspeisung; der Rest stammt aus PV-Überschuss. Gedeckelt, falls
  // battDelta größer als die tatsächliche Einspeisung ist (Batterie deckt dann
  // teils Hausverbrauch statt Netzeinspeisung).
  const eingespeistBatt = Math.max(0, Math.min(eingespeist, battDelta));
  const eingespeistPv = Math.max(0, eingespeist - eingespeistBatt);

  // Aufteilung des Hausverbrauchs dieser VS nach Herkunft:
  //   Netz-Anteil  = bezogen − AC-Netzladung (der Netzbezug, der nach Abzug der
  //                  in die Batterie geladenen Energie tatsächlich ins Haus geht)
  //   Speicher     = im Haus verbrauchte Batterie-Entladung (Entladung minus
  //                  dem ins Netz eingespeisten Batterie-Anteil), auf den
  //                  Eigenverbrauch gedeckelt
  //   PV-direkt    = restlicher Eigenverbrauch
  const bezogenHaus = Math.max(0, bezogen - battInDelta);
  const vGesamt = verbrauch > 0 ? verbrauch : 0;
  const eigenVerbrauch = Math.max(0, vGesamt - bezogenHaus);
  const battImHaus = Math.max(0, battDelta - eingespeistBatt);
  const verbrauchSpeicher = Math.max(0, Math.min(eigenVerbrauch, battImHaus));
  const verbrauchPv = Math.max(0, eigenVerbrauch - verbrauchSpeicher);

  const tsEnd = slotEndIso(anchoredSlot);

  // Externe §42c-Zähler (Energy Sharing): je Quelle den Netto-Δ-Bezug dieser
  // Viertelstunde erfassen. Hat der Abnehmer eine eigene PV-Anlage und einen
  // Einspeisezähler (gridOutTotal), wird dessen Einspeisung gegengerechnet.
  // Der gespeicherte Bezug wird auf >= 0 geklemmt: speist der Abnehmer netto
  // ein, ist sein zu deckender Bedarf 0. Läuft unabhängig von der PV-Auslesung.
  let sharing42cGesamt = 0;
  for (const s of sources) {
    if (!is42cRole(s.role)) continue;
    const meterIn = snap ? snap.s42cIn[s.id] : lastRead[s.id]?.values.gridInTotal;
    if (meterIn == null) continue;
    let bezug = vsDiff(`vs.42c.${s.id}`, meterIn);

    // Optionale Einspeisung des Abnehmers gegenrechnen.
    const meterOut = snap ? snap.s42cOut[s.id] : lastRead[s.id]?.values.gridOutTotal;
    if (meterOut != null) {
      const eing = vsDiff(`vs.42cOut.${s.id}`, meterOut);
      bezug = Math.max(0, bezug - eing);
    }
    db.saveSharingViertelstunde(tsEnd, s.id, bezug);
    sharing42cGesamt += bezug;
  }

  // An §42c-Abnehmer gelieferte Einspeisung dieser VS, aufgeteilt nach Herkunft.
  // Gedeckt wird höchstens meine Einspeisung; die Aufteilung folgt dem PV/Batt-
  // Verhältnis meiner Einspeisung (Batterie speist nur bei Bedarf ein).
  const gedeckt42c = Math.max(0, Math.min(sharing42cGesamt, eingespeist));
  const pvFrac = eingespeist > 0 ? eingespeistPv / eingespeist : 1;
  const eingespeist42cPv = gedeckt42c * pvFrac;
  const eingespeist42cBatt = gedeckt42c - eingespeist42cPv;

  db.saveViertelstunde({
    ts: tsEnd,
    eingespeist,
    bezogen,
    verbrauch: vGesamt,
    eingespeistPv,
    eingespeistBatt,
    verbrauchPv,
    verbrauchSpeicher,
    eingespeist42cPv,
    eingespeist42cBatt,
  });

  // Verbraucher-Energie der abgeschlossenen Viertelstunde je Gerät wegschreiben
  // (zeitintegriert) und Akkumulator für die neue Viertelstunde leeren.
  for (const [id, kwh] of Object.entries(consumerVsAccum)) {
    if (kwh > 0) db.saveConsumerViertelstunde(tsEnd, id, kwh);
    delete consumerVsAccum[id];
  }
  // PV-Ertrag je Anlage der abgeschlossenen Viertelstunde wegschreiben.
  for (const [id, kwh] of Object.entries(pvVsAccum)) {
    if (kwh > 0) db.savePvViertelstunde(tsEnd, id, kwh);
    delete pvVsAccum[id];
  }

  // Anker auf die aktuelle Viertelstunde neu setzen. Die Zähler-Anker selbst
  // wurden bereits in vsDiff() auf den aktuellen Stand nachgeführt (nur für
  // tatsächlich gelesene Zähler – fehlende bleiben unverändert).
  db.setReset(VS_ANCHOR.slot, nowSlot);
  // Snapshot für den neuen (laufenden) Slot mit dem aktuellen Stand anlegen.
  captureSlotSnapshot(nowSlot, cur);
}

// Zuletzt im aggregate() gesehene Zähler-Gesamtstände (für die Berechnung des
// laufenden, noch nicht abgeschlossenen Viertelstunden-Slots ohne Schreiben).
let lastCurTotals: {
  gridIn: number; gridOut: number; pvTotal: number;
  batteryOutTotal: number; pvDcTotal: number;
} | null = null;

// Read-only-Variante von vsDiff: liest die Differenz zum Anker, OHNE den Anker
// zu verschieben oder Seiteneffekte auszulösen. Nur für die Anzeige des
// laufenden Slots – die echte Fortschreibung bleibt allein in vsDiff.
// Anders als vsDiff greift diese Variante direkt auf den persistierten Anker in
// der DB zu und ist NICHT von vsReanchored (In-Memory) abhängig: Nach einem
// Neustart ist dieses Set leer, während der Anker in der DB gültig bleibt –
// sonst würde der laufende Slot nach jedem Neustart fälschlich 0 liefern.
// currentViertelstunde() stellt vorab sicher, dass der aktuelle Slot dem
// verankerten Slot entspricht, sodass der Anker den korrekten VS-Start abbildet.
function vsDiffPeek(anchorKey: string, current: number | undefined): number {
  if (current == null) return 0;
  const anchor = db.getReset(anchorKey, -1);
  if (anchor < 0 || current < anchor) return 0;
  return current - anchor;
}
function sumPerSourceVsDiffPeek(
  predicate: (s: SourceConfig) => boolean,
  key: (id: string) => string
): number {
  let sum = 0;
  for (const s of sources) {
    if (!sourceEnabled(s)) continue;
    if (!predicate(s)) continue;
    sum += vsDiffPeek(key(s.id), lastRead[s.id]?.values.energyTotal);
  }
  return sum;
}

// Die laufende (noch nicht abgeschlossene) Viertelstunde als
// ViertelstundeEntry berechnen – mit denselben Bilanz- und Aufteilungsformeln
// wie checkViertelstunde, aber read-only (keine Anker-Änderung, kein Schreiben).
// So kann der angefangene Slot im Tagesverlauf-Chart sichtbar gemacht werden,
// analog zu PV-Ertrag und Verbrauchern. Gibt null zurück, solange die Erfassung
// nicht bereit ist oder noch kein Zählerstand vorliegt.
export function currentViertelstunde(): ViertelstundeEntry | null {
  return computeCurrentViertelstunde().entry;
}

// Wie currentViertelstunde, gibt aber zusätzlich die Zwischenwerte und den Grund
// für ein null-Ergebnis zurück (für Diagnose über /api/viertelstunden/debug).
export function computeCurrentViertelstunde(): {
  entry: ViertelstundeEntry | null;
  debug: Record<string, unknown>;
} {
  const dbg: Record<string, unknown> = {};
  dbg.initDone = db.getInitDone();
  dbg.hasLastCurTotals = !!lastCurTotals;
  if (!db.getInitDone() || !lastCurTotals) {
    dbg.reason = "initDone/lastCurTotals fehlt";
    return { entry: null, debug: dbg };
  }
  const nowSlot = slotIndex(new Date());
  const anchoredSlot = db.getReset(VS_ANCHOR.slot, -1);
  dbg.nowSlot = nowSlot;
  dbg.anchoredSlot = anchoredSlot;
  if (anchoredSlot < 0 || nowSlot !== anchoredSlot) {
    dbg.reason = anchoredSlot < 0 ? "kein Slot-Anker" : "Slot-Wechsel (nowSlot != anchoredSlot)";
    return { entry: null, debug: dbg };
  }
  const cur = lastCurTotals;

  const bezogen = vsDiffPeek(VS_ANCHOR.gridIn, cur.gridIn);
  const eingespeist = vsDiffPeek(VS_ANCHOR.gridOut, cur.gridOut);
  const pvCounterPeek = sumPerSourceVsDiffPeek((s) => s.role === "pv" && s.energySource !== "integrated", vsPvKey);
  const pvDcCounterPeek = sumPerSourceVsDiffPeek((s) => s.role === "pv" && s.pvTarget === "dc" && s.energySource !== "integrated", vsPvDcKey);
  // Laufendes Leistungsintegral der integrated-Quellen (noch nicht abgeschlossene
  // VS) aus demselben Akkumulator wie der PV-Ertrag-Tagesverlauf (pvVsAccum),
  // damit die Live-Vorschau konsistent zur späteren Buchung ist.
  let pvIntPeek = 0, pvDcIntPeek = 0;
  for (const s of sources) {
    if (!sourceEnabled(s) || s.role !== "pv" || s.energySource !== "integrated") continue;
    const v = pvVsAccum[s.id] ?? 0;
    pvIntPeek += v;
    if (s.pvTarget === "dc") pvDcIntPeek += v;
  }
  const pvDelta = pvCounterPeek + pvIntPeek;
  const pvDcDelta = pvDcCounterPeek + pvDcIntPeek;
  const battDelta0 = sumPerSourceVsDiffPeek((s) => s.role === "batteryOut", vsBattKey);
  let battDelta = battDelta0;
  // AC-Speicher-Entladung (ret_aenergy) hinzuziehen – Vorschau, ohne Anker zu
  // verschieben (konsistent zur abgeschlossenen VS in buildSlotEntry).
  for (const s of sources) {
    if (!sourceEnabled(s) || s.role !== "acBattery" || s.subordinateOf) continue;
    battDelta += vsDiffPeek(vsBattOutAcKey(s.id), energyMetricOf(s.id, "energyReturnTotal"));
  }
  // AC-Netzladung der laufenden VS als Vorschau (vsDiffPeek, ohne Anker zu
  // verschieben). MUSS hier – wie in der abgeschlossenen VS – vom Verbrauch
  // abgezogen werden, sonst wächst der PV-Verbrauchsanteil während der VS
  // fälschlich mit (die Ladeenergie geht in die Batterie, nicht ins Haus) und
  // bricht am VS-Ende ein, sobald die finale Bilanz den Abzug nachholt.
  let battInDelta = 0;
  const battInDetail: Record<string, { cur: number | null; anker: number; diff: number; role: string; sub?: boolean }> = {};
  for (const s of sources) {
    if (!sourceEnabled(s)) continue;
    // Untergeordnete Mess-Shelly: im Debug sichtbar lassen, aber NICHT zur Summe
    // addieren (die übergeordnete acBattery erfasst den Zähler via powerSourceId).
    const isSub = !!s.subordinateOf;
    if (s.role === "batteryIn") {
      const cur2 = energyMetricOf(s.id, "energyTotal");
      const diff = vsDiffPeek(vsBattInKey(s.id), cur2);
      if (!isSub) battInDelta += diff;
      battInDetail[s.id] = { cur: cur2 ?? null, anker: db.getReset(vsBattInKey(s.id), -1), diff, role: s.role, sub: isSub };
    } else if (s.role === "acBattery") {
      const tot = energyMetricOf(s.id, "energyTotal");
      const ret = energyMetricOf(s.id, "energyReturnTotal");
      const end = tot == null ? undefined : tot - (ret ?? 0);
      const diff = vsDiffPeek(vsBattInKey(s.id), end);
      if (!isSub) battInDelta += diff;
      battInDetail[s.id] = { cur: end ?? null, anker: db.getReset(vsBattInKey(s.id), -1), diff, role: s.role, sub: isSub };
    }
  }
  const verbrauch = pvDelta - pvDcDelta + battDelta - battInDelta - eingespeist + bezogen;
  dbg.battInDetail = battInDetail;
  // DC-Speicher-Diagnose: dcBattery-Quellen tragen selbst keinen Zähler bei,
  // sondern über ihre verlinkten Quellen – dcLinkedPv (fließt in pvDcDelta),
  // dcLinkedBatteryOut (Entladung, in battDelta) und dcLinkedCharger (AC-Ladung,
  // in battInDelta). Hier je DC-Speicher der Beitrag jeder Komponente mit rohem
  // Zählerstand, gesetztem Anker und Peek-Differenz. So lassen sich – analog zu
  // battInDetail – Verankerungs- oder Doppelzählungs-Inkonsistenzen erkennen.
  const dcDetail: Record<string, Record<string, { linked: string; cur: number | null; anker: number; diff: number }>> = {};
  for (const s of sources) {
    if (s.role !== "dcBattery" || !sourceEnabled(s)) continue;
    const comp: Record<string, { linked: string; cur: number | null; anker: number; diff: number }> = {};
    const add = (rolle: string, linkedId: string | undefined, key: (id: string) => string, cur: number | undefined) => {
      if (!linkedId) return;
      comp[rolle] = {
        linked: linkedId,
        cur: cur ?? null,
        anker: db.getReset(key(linkedId), -1),
        diff: vsDiffPeek(key(linkedId), cur),
      };
    };
    // PV (dc): Zähler energyTotal der verlinkten PV-Quelle, Anker vsPvDcKey.
    add("pv", s.dcLinkedPv, vsPvDcKey, s.dcLinkedPv ? lastRead[s.dcLinkedPv]?.values.energyTotal : undefined);
    // Entladung: batteryOut-Zähler (ggf. bidirektional), Anker vsBattKey.
    if (s.dcLinkedBatteryOut) {
      const outSrc = sources.find((x) => x.id === s.dcLinkedBatteryOut);
      add("batteryOut", s.dcLinkedBatteryOut, vsBattKey, outSrc ? batteryOutMeter(outSrc) : undefined);
    }
    // AC-Ladung: energyTotal des verlinkten Ladegeräts, Anker vsBattInKey.
    add("charger", s.dcLinkedCharger, vsBattInKey, s.dcLinkedCharger ? energyMetricOf(s.dcLinkedCharger, "energyTotal") : undefined);
    dcDetail[s.id] = comp;
  }
  dbg.dcDetail = dcDetail;
  dbg.curGridIn = cur.gridIn;
  dbg.ankerGridIn = db.getReset(VS_ANCHOR.gridIn, -1);
  dbg.curGridOut = cur.gridOut;
  dbg.ankerGridOut = db.getReset(VS_ANCHOR.gridOut, -1);
  dbg.bezogen = bezogen;
  dbg.eingespeist = eingespeist;
  dbg.pvDelta = pvDelta;
  dbg.battDelta = battDelta;
  dbg.battInDelta = battInDelta;
  // Einzelne PV-Integral-Stände (pvVsAccum) je integrated-Quelle – zeigt, ob die
  // Integration seit dem letzten VS-Wechsel korrekt bei 0 begonnen hat.
  dbg.pvVsAccum = Object.fromEntries(
    sources
      .filter((s) => s.role === "pv" && s.energySource === "integrated")
      .map((s) => [s.id, pvVsAccum[s.id] ?? 0]),
  );

  const eingespeistBatt = Math.max(0, Math.min(eingespeist, battDelta));
  const eingespeistPv = Math.max(0, eingespeist - eingespeistBatt);
  const vGesamt = verbrauch > 0 ? verbrauch : 0;
  // Netz-Anteil des Verbrauchs = Netzbezug minus AC-Ladung (konsistent zur
  // finalen VS-Bilanz), da die aus dem Netz geladene Energie nicht ins Haus geht.
  const bezogenHaus = Math.max(0, bezogen - battInDelta);
  const eigenVerbrauch = Math.max(0, vGesamt - bezogenHaus);
  const battImHaus = Math.max(0, battDelta - eingespeistBatt);
  const verbrauchSpeicher = Math.max(0, Math.min(eigenVerbrauch, battImHaus));
  const verbrauchPv = Math.max(0, eigenVerbrauch - verbrauchSpeicher);
  dbg.vGesamt = vGesamt;

  let sharing42cGesamt = 0;
  for (const s of sources) {
    if (!is42cRole(s.role)) continue;
    const meterIn = lastRead[s.id]?.values.gridInTotal;
    if (meterIn == null) continue;
    let bezug = vsDiffPeek(`vs.42c.${s.id}`, meterIn);
    const meterOut = lastRead[s.id]?.values.gridOutTotal;
    if (meterOut != null) bezug = Math.max(0, bezug - vsDiffPeek(`vs.42cOut.${s.id}`, meterOut));
    sharing42cGesamt += bezug;
  }
  const gedeckt42c = Math.max(0, Math.min(sharing42cGesamt, eingespeist));
  const pvFrac = eingespeist > 0 ? eingespeistPv / eingespeist : 1;
  const eingespeist42cPv = gedeckt42c * pvFrac;
  const eingespeist42cBatt = gedeckt42c - eingespeist42cPv;

  if (vGesamt === 0 && eingespeist === 0 && bezogen === 0) {
    dbg.reason = "alle Werte 0 (Anker == aktueller Stand, noch nichts aufgelaufen)";
    return { entry: null, debug: dbg };
  }

  dbg.reason = "OK";
  return {
    entry: {
      ts: slotEndIso(nowSlot),
      eingespeist, bezogen, verbrauch: vGesamt,
      eingespeistPv, eingespeistBatt, verbrauchPv, verbrauchSpeicher,
      eingespeist42cPv, eingespeist42cBatt,
    },
    debug: dbg,
  };
}

// --- newDay (Tagesabschluss + Anker neu setzen) ---
// Der laufende (noch nicht abgeschlossene) Tag als History-Eintrag, gebildet aus
// dem aktuellen day-State. Format identisch zu den in newDay() persistierten
// Einträgen, damit die Monatsstatistik den heutigen Tag mit den bisher
// aufgelaufenen Werten anzeigen kann. Gibt null zurück, solange die Erfassung
// nicht bereit ist (kein sinnvoller Tageswert vorhanden).
export function currentDayHistory(): HistoryEntry | null {
  if (!db.getInitDone()) return null;
  const { date } = now();
  const verbrauch = day.gridDayBezug + day.energyDayConsumed;
  // Zähler ist die Wahrheit: batteryOutDay (ret_aenergy, AC+DC) ist die
  // Gesamt-Ausspeisung. Der leistungsintegrierte 42c-Anteil liefert nur die
  // Aufteilung und wird auf die Zählersumme gedeckelt, damit speicher + 42c
  // exakt die Zähler-Ausspeisung ergeben (keine Über-/Doppelzählung).
  const batt42c = Math.min(day.batteryTo42cEnergy, day.batteryOutDay);
  const speicher = Math.max(0, day.batteryOutDay - batt42c);
  const pvDirekt = Math.max(0, day.energyDayConsumed - speicher);
  return {
    date,
    verbrauch,
    pvSpeicher: day.energyDayConsumed,
    pvDirekt,
    speicher,
    netzbezug: day.gridDayBezug,
    eingespeist: day.gridDayEingespeist,
    eingespeist42cPv: day.pvTo42cEnergy,
    eingespeist42cSpeicher: batt42c,
    autarkie: verbrauch > 0 ? 100 * (day.energyDayConsumed / verbrauch) : 0,
  };
}

export function newDay(resetAnchors = true): void {
  const { date, hours, minutes } = now();
  const initDone = db.getInitDone();
  const dayReset = db.getDayReset();

  // History des abgeschlossenen Tages schreiben. Voraussetzung: die
  // Initialisierung war abgeschlossen (initDone) und es gibt ein Tagesdatum
  // (dayReset). Ein erneutes resetsReady() wird hier BEWUSST nicht mehr geprüft:
  // Ist initDone einmal true, waren die Netzanker gültig; eine kurzzeitig nicht
  // erreichbare Netzquelle exakt im Moment des Tageswechsels darf nicht dazu
  // führen, dass der komplette Tageseintrag verworfen wird (sonst fehlt der Tag
  // in Monatsstatistik/Tagesbilanz, obwohl Viertelstundenwerte vorliegen).
  if (initDone && dayReset) {
    const existing = db.getHistoryByDate(dayReset);
    const verbrauch = day.gridDayBezug + day.energyDayConsumed;
    // Aufschlüsselung des Eigenverbrauchs "PV+Speicher":
    //   speicher = im Haus verbrauchte Batterie-Entladung (Gesamtentladung
    //              abzüglich des an §42c-Abnehmer gelieferten Batterie-Anteils),
    //   pvDirekt = restlicher Eigenverbrauch, also unmittelbar aus der PV.
    const batt42c = Math.min(day.batteryTo42cEnergy, day.batteryOutDay);
    const speicher = Math.max(0, day.batteryOutDay - batt42c);
    const pvDirekt = Math.max(0, day.energyDayConsumed - speicher);
    if (existing) {
      const nVerbrauch = existing.verbrauch + verbrauch;
      const nPv = existing.pvSpeicher + day.energyDayConsumed;
      const nNetz = existing.netzbezug + day.gridDayBezug;
      const nEin = existing.eingespeist + day.gridDayEingespeist;
      const nAut = nVerbrauch > 0 ? 100 * (nPv / nVerbrauch) : 0;
      db.upsertHistory({
        date: dayReset,
        verbrauch: nVerbrauch,
        pvSpeicher: nPv,
        pvDirekt: (existing.pvDirekt ?? 0) + pvDirekt,
        speicher: (existing.speicher ?? 0) + speicher,
        netzbezug: nNetz,
        eingespeist: nEin,
        eingespeist42cPv: (existing.eingespeist42cPv ?? 0) + day.pvTo42cEnergy,
        eingespeist42cSpeicher:
          (existing.eingespeist42cSpeicher ?? 0) + batt42c,
        autarkie: nAut,
      });
    } else {
      db.upsertHistory({
        date: dayReset,
        verbrauch,
        pvSpeicher: day.energyDayConsumed,
        pvDirekt,
        speicher,
        netzbezug: day.gridDayBezug,
        eingespeist: day.gridDayEingespeist,
        eingespeist42cPv: day.pvTo42cEnergy,
        eingespeist42cSpeicher: batt42c,
        autarkie: verbrauch > 0 ? 100 * (day.energyDayConsumed / verbrauch) : 0,
      });
    }
  }

  // Wärmepumpen-Kennzahlen des abgeschlossenen Tages berechnen und persistieren.
  // So ist die Zeitraum-Auswertung später schnell (nur Tagessätze aggregieren).
  // Fehler dürfen den Tageswechsel nicht blockieren.
  if (initDone && dayReset) {
    try {
      persistWpKpiForDay(dayReset);
    } catch (e: any) {
      log.warn("wpkpi", `Aggregation für ${dayReset} fehlgeschlagen: ${e?.message ?? e}`);
    }
  }

  // Anker für alle Quellen neu setzen – nur bei echtem Tageswechsel. Beim
  // Erststart (resetAnchors=false) übernimmt die Reanchor-Logik in dayDiff das
  // korrekte Verankern, damit ein gültiger Tagesanker erhalten bleibt und nicht
  // mit dem aktuellen Gesamtzählerstand überschrieben wird.
  if (resetAnchors) {
    // Anker beim Tageswechsel nur für Quellen setzen, die AKTUELL einen gültigen
    // Zählerstand liefern. Fehlt der Wert (Quelle nicht erreichbar – z.B. ein
    // nachts DC-abgeschalteter Wechselrichter), bleibt der bisherige Anker
    // erhalten und wird NICHT auf einen Platzhalter gesetzt. So kann eine erst
    // später wieder erreichbare Quelle beim ersten Wert keinen historischen
    // Gesamtzählerstand als Tages-/Viertelstundenwert einschleusen; die reguläre
    // Differenzbildung bleibt intakt.
    const isValid = (x: number | undefined): x is number =>
      typeof x === "number" && x > 0;
    // Setzt fuer den neuen Tag last=aktueller Rohstand und accum=0. Fehlt der
    // aktuelle Stand (Quelle offline), bleibt der alte Anker stehen; der naechste
    // gueltige Wert fuehrt regulaer nach. So beginnt jede Tagesmenge sauber bei 0,
    // resetfest ueber die neue dayDiff-Akkumulator-Logik.
    const resetDayAnchor = (anchorKey: string, cur: number | undefined) => {
      if (!isValid(cur)) return;
      db.setReset(anchorKey, cur);
      db.setReset(accumKey(anchorKey), 0);
    };
    for (const src of sources) {
      const read = lastRead[src.id];
      const v = read?.values ?? {};
      if (src.role === "grid" || src.role === "gridEmu") {
        resetDayAnchor(gridInAnchorKey(src.id), v.gridInTotal);
        resetDayAnchor(gridOutAnchorKey(src.id), v.gridOutTotal);
      } else if (
        src.role === "pv" ||
        src.role === "batteryIn"
      ) {
        resetDayAnchor(energyAnchorKey(src.id), v.energyTotal);
      } else if (src.role === "batteryOut") {
        // Rein einspeisend: energyAnchorKey/energyTotal (bisher). Bidirektional:
        // Einspeisezähler ret_aenergy über acDischargeAnchorKey (wie im aggregate).
        if (batteryOutHasReturn(src)) {
          resetDayAnchor(acDischargeAnchorKey(src.id), v.energyReturnTotal);
        } else {
          resetDayAnchor(energyAnchorKey(src.id), v.energyTotal);
        }
      } else if (src.role === "acBattery") {
        // AC-Speicher: Lade- (aenergy) und Entlade-Anker (ret_aenergy) getrennt,
        // Zähler ggf. von der verknüpften Mess-Shelly (energyMetricOf).
        resetDayAnchor(acChargeAnchorKey(src.id), energyMetricOf(src.id, "energyTotal"));
        resetDayAnchor(acDischargeAnchorKey(src.id), energyMetricOf(src.id, "energyReturnTotal"));
      }
    }
    // Viertelstunden-Anker synchron zum Tageswechsel nachführen – pro Quelle und
    // nur für aktuell gültige Werte, damit VS- und Tageswerte konsistent bleiben
    // und eine nachts ausgefallene Quelle morgens keinen Summensprung erzeugt.
    for (const src of sources) {
      const v = lastRead[src.id]?.values ?? {};
      if (src.role === "pv") {
        if (isValid(v.energyTotal)) {
          db.setReset(vsPvKey(src.id), v.energyTotal);
          vsReanchored.add(vsPvKey(src.id));
          if (src.pvTarget === "dc") {
            db.setReset(vsPvDcKey(src.id), v.energyTotal);
            vsReanchored.add(vsPvDcKey(src.id));
          }
        }
      } else if (src.role === "batteryOut") {
        // VS-Anker auf den variantenrichtigen Einspeisezähler zurücksetzen
        // (bidirektional: energyReturnTotal, sonst energyTotal).
        const m = batteryOutMeter(src);
        if (isValid(m)) {
          db.setReset(vsBattKey(src.id), m);
          vsReanchored.add(vsBattKey(src.id));
        }
      } else if (src.role === "acBattery") {
        const di = energyMetricOf(src.id, "energyReturnTotal");
        if (isValid(di)) {
          db.setReset(vsBattOutAcKey(src.id), di);
          vsReanchored.add(vsBattOutAcKey(src.id));
        }
      } else if (src.role === "grid" || src.role === "gridEmu") {
        if (isValid(v.gridInTotal)) { db.setReset(VS_ANCHOR.gridIn, v.gridInTotal); vsReanchored.add(VS_ANCHOR.gridIn); }
        if (isValid(v.gridOutTotal)) { db.setReset(VS_ANCHOR.gridOut, v.gridOutTotal); vsReanchored.add(VS_ANCHOR.gridOut); }
      }
    }
    // Nach echtem Tageswechsel dürfen die Quellen wieder frisch verankern.
    reanchoredSinceStart.clear();
    // Tages-Startsummen für den NEUEN Tag neu laden. Wichtig: Ohne dies behielte
    // startDaySums die Summen des Vortages, und da dayDiff nach dem Reanchor den
    // Akkumulator wieder aus startDaySums initialisiert, würde pvDay/gridDay…/
    // batteryDay… fälschlich mit dem gestrigen Tageswert starten statt bei 0.
    // Nach Mitternacht liefern die Viertelstunden-Summen des neuen Tages ~0.
    loadStartDaySums(true);
    // Sicherheitshalber ALLE bekannten Tages-Akkumulatoren explizit nullen –
    // auch die von Quellen, die im Moment des Tageswechsels offline sind (deren
    // Anker oben nicht neu gesetzt werden konnte). So kann kein Vortagswert über
    // einen nicht zurückgesetzten Akkumulator in den neuen Tag getragen werden.
    // Der Reanchor (reanchoredSinceStart geleert) sorgt dafür, dass eine später
    // wieder erreichbare Quelle sauber auf ihren aktuellen Stand verankert.
    for (const src of sources) {
      const keys = [
        gridInAnchorKey(src.id), gridOutAnchorKey(src.id),
        energyAnchorKey(src.id), acChargeAnchorKey(src.id), acDischargeAnchorKey(src.id),
      ];
      for (const k of keys) db.setReset(accumKey(k), 0);
    }
    // Prozessweite Tages-Akkumulatoren (leistungsintegriert) ebenfalls auf 0 –
    // sie werden andernfalls erst beim nächsten Tick über den Datumsvergleich
    // zurückgesetzt, was einen kurzen Übertrag zeigen könnte.
    pvIntegratedDayAccum = 0;
    pvIntegratedDcDayAccum = 0;
    pvIntegratedDay = now().date;
    pvEigenDayAccum = 0;
    pvEigenDay = now().date;
    // Monotone Anzeige-Klemmen des Haus-Tagesverbrauchs und PV-Eigenverbrauchs
    // ebenfalls hart zuruecksetzen. Diese Werte werden sonst NUR ueber ihren
    // eigenen, prozesslokalen Datumsvergleich (monotonDay) in aggregate()
    // zurueckgesetzt. Laeuft dieser eine Reset-Moment aus irgendeinem Grund an der
    // Klemme vorbei, friert der Anzeigewert auf dem Vortagesendwert ein und waechst
    // danach nur noch per Math.max -- genau dann zeigt die Uebersichtsseite den
    // gestrigen Wert weiter, obwohl alle Rohwerte laengst bei 0 sind. Der harte
    // Reset hier koppelt die Klemme fest an den zentralen Tageswechsel.
    day.hausverbrauchDayMonoton = 0;
    day.pvConsumedDayMonoton = 0;
    monotonDay = now().date;
    // §42c-Tagesenergie (integrierter Eigenanteil) für den neuen Tag nullen.
    db.setReset(SHARE42C_ENERGY_KEY, 0);
    db.setReset(SHARE42C_PV_ENERGY_KEY, 0);
    db.setReset(SHARE42C_BATT_ENERGY_KEY, 0);
  }

  db.setDayReset(date);
  settings.hourLastReset = hours;
  settings.minuteLastReset = minutes;
  db.saveSetting("hourLastReset", hours);
  db.saveSetting("minuteLastReset", minutes);
}

// --- Drosselung prüfen ---
// Für alle PV-Erzeuger, die ins Hausnetz einspeisen (role "pv" und NICHT
// pvTarget "dc") und eine rate-Metrik liefern. Jede Quelle wird unabhängig
// getrackt; eine Änderung des rate-Werts wird mit Quellen-ID protokolliert.
function checkDrosselung(): void {
  for (const src of sources) {
    if (src.role !== "pv" || src.pvTarget === "dc") continue;
    const rate = lastRead[src.id]?.values.rate;
    if (rate == null) continue;
    // Temperatur-Gate wie früher: nur loggen, wenn warm genug (falls vorhanden)
    const temp = lastRead[src.id]?.values.temperature ?? 99;
    const prev = currentDrosselung[src.id] ?? 101.0;
    if ((rate !== prev && temp >= 15.0) || prev > 100.0) {
      // Drosselung als Info-Meldung protokollieren (statt eigener Tabelle).
      // Erscheint auf der Debug-Seite. Der Startwert (prev > 100) wird ebenfalls
      // einmalig festgehalten.
      log.info(src.label || src.id, `Drosselung: ${rate} %`);
      currentDrosselung[src.id] = rate;
    }
  }
}

// --- Eine Quelle abfragen ---
async function pollSource(id: string): Promise<void> {
  const src = sourceById(id);
  if (!src || !sourceEnabled(src)) return;
  try {
    const result = await readSource(src);
    lastRead[id] = { values: result.values, display: result.display, modules: result.modules };
    recordSuccess(id);
    // Wärmepumpe: alle numerischen Datenreihen im Poll-Intervall persistieren,
    // damit sie später als Tagesverlauf visualisiert werden können. Bool wird
    // als 0/1 gespeichert, reine Text-Felder (z.B. Betriebsmodus) übersprungen.
    if (src.deviceType === "heatpump") {
      const series: Record<string, number> = {};
      for (const d of result.display) {
        if (typeof d.value === "number") series[d.label] = d.value;
        else if (typeof d.value === "boolean") series[d.label] = d.value ? 1 : 0;
        else if (typeof d.value === "string" && /betriebsmodus|operating.?mode/i.test(d.label)) {
          // Betriebsmodus (Text) zusätzlich numerisch kodiert ablegen, damit die
          // KPI-Auswertung Heiz- vs. Warmwasserbetrieb unterscheiden kann.
          // 1=Heizen, 2=Warmwasser(DHW), 3=Kühlen, 0=Aus/sonstiges.
          const t = d.value.toLowerCase();
          let code = 0;
          if (/dhw|warmwasser|wasser/.test(t)) code = 2;
          else if (/heat|heiz/.test(t)) code = 1;
          else if (/cool|kühl|kuehl/.test(t)) code = 3;
          series["_ModusCode"] = code;
        }
      }
      if (Object.keys(series).length > 0) {
        // Elektrische Leistungsaufnahme der WP (vom verlinkten Mess-Shelly bzw.
        // eigenem power-Wert) synchron mitspeichern. So kann die KPI-Auswertung
        // den Energiebedarf direkt aus dieser feinen Zeitreihe je Betriebsmodus
        // integrieren – ohne Umweg über die groben 15-Minuten-Bilanzen und ohne
        // die verzerrende anteilige Aufteilung nach Laufzeit.
        const pEl = powerOf(src.id);
        if (typeof pEl === "number" && !Number.isNaN(pEl)) series["_ElektrischW"] = pEl;
        db.saveWpData(nowSecondsIso(), series);
      }
    }
    // Warmwasserspeicher-Quelle: die zwei °C-Werte (oben/unten) im Poll-Intervall
    // persistieren, damit sie als Temperaturverlauf visualisiert werden können.
    if (src.role === "waterTank") {
      const temps = result.display.filter((x) => x.unit === "°C");
      const up = temps[0] != null ? Number(temps[0].value) : null;
      const down = temps[1] != null ? Number(temps[1].value) : null;
      if ((up != null && !Number.isNaN(up)) || (down != null && !Number.isNaN(down))) {
        db.saveWarmwasser(
          nowSecondsIso(),
          up != null && !Number.isNaN(up) ? up : null,
          down != null && !Number.isNaN(down) ? down : null,
        );
      }
    }
    checkDrosselung();
    recomputeDay();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // Erwartbares "Gerät nicht erreichbar"-Rauschen (Timeouts, HTTP 503, TCP-/
    // Netzwerkfehler eines offline gegangenen Geräts) nur als debug UND nur
    // EINMAL pro Offline-Phase loggen. So flutet ein nachts abgeschalteter
    // Wechselrichter das Log nicht bei jedem Poll-Zyklus. Alle anderen Fehler
    // (z. B. Parse-/Konfigurationsfehler) bleiben als warn und werden – da
    // potenziell wechselnd – weiterhin protokolliert.
    const istRauschen =
      /timeout/i.test(msg) ||
      /HTTP 503/i.test(msg) ||
      /\b(EHOSTDOWN|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETDOWN|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up)\b/i.test(msg);
    // Speziell "Host/Netz nicht erreichbar" (für die Nicht-erreichbar-Regel):
    // dauerhafte Erreichbarkeitsfehler, nicht bloß ein einzelner Timeout.
    const istUnreachable =
      /\b(EHOSTDOWN|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ENOTFOUND|EAI_AGAIN)\b/i.test(msg);
    if (istUnreachable) markUnreachable(id);
    if (istRauschen) {
      const st = ensureStatus(id);
      if (!st.offlineLogged) {
        db.addLog(db.LOG_LEVELS.debug, "poll", `${id}: nicht erreichbar (${msg}) – weitere Meldungen bis zur Wiedererreichbarkeit unterdrückt.`);
        st.offlineLogged = true;
      }
    } else {
      log.warn("poll", `${id}: ${msg}`);
    }
    recordError(id, msg);
  }
  broadcast();
}

// --- Init / Tageswechsel + Aggregation ---
function recomputeDay(): void {
  const { date } = now();
  if (!db.getInitDone()) {
    // Erststart: History des letzten Tages ggf. abschließen, aber die Anker
    // NICHT hier setzen – das übernimmt dayDiff beim ersten Wert je Quelle
    // (verankert immer auf den aktuellen Stand -> Zählung startet bei 0).
    newDay(false);
    if (resetsReady()) {
      db.setDayReset(date);
      db.setInitDone(true);
    }
  } else if (date !== db.getDayReset()) {
    // Echter Tageswechsel im laufenden Betrieb: Tag abschließen und Anker neu
    // setzen (reanchoredSinceStart wird dabei geleert -> sauberer Tagesstart).
    newDay(true);
  }
  aggregate();
}

// --- State-Snapshot ---
export function getState(): FullState {
  const { date, time } = now();
  const srcById = new Map(sources.map((s) => [s.id, s]));
  // Für DC-Speicher (dcBattery): Werte aus den verlinkten Quellen einsammeln,
  // jeweils mit der Herkunftsquelle beschriftet.
  const dcLinkedValues = (src: SourceConfig) => {
    const out: Array<{ label: string; value: number | boolean | string; unit: string }> = [];
    const linkIds = [src.dcLinkedPv, src.dcLinkedBatteryOut, src.dcLinkedCharger].filter(Boolean) as string[];
    for (const id of linkIds) {
      const linked = srcById.get(id);
      const disp = lastRead[id]?.display;
      if (!linked || !disp) continue;
      for (const d of disp) out.push({ label: `${linked.label}: ${d.label}`, value: d.value, unit: d.unit ?? "" });
    }
    return out;
  };
  // Untergeordnete Quellen (subordinateOf): ihre Werte werden in die übergeordnete
  // Quelle integriert, mit Herkunft beschriftet. So erscheint ein AC-Speicher mit
  // zwischengeschaltetem Shelly als EIN zusammengefasster Block (analog DC).
  const subordinatesOf = (parentId: string) => sources.filter((s) => s.subordinateOf === parentId);
  const subordinateValues = (parentId: string) => {
    const out: Array<{ label: string; value: number | boolean | string; unit: string }> = [];
    for (const sub of subordinatesOf(parentId)) {
      const disp = lastRead[sub.id]?.display;
      if (!disp) continue;
      for (const d of disp) out.push({ label: `${sub.label}: ${d.label}`, value: d.value, unit: d.unit ?? "" });
    }
    return out;
  };
  const srcStatus: SourceStatus[] = sources
    // Untergeordnete Quellen nicht separat listen – sie erscheinen integriert in
    // ihrer übergeordneten Quelle.
    .filter((src) => !src.subordinateOf)
    .map((src) => ({
    key: src.id,
    label: src.label,
    url: src.url,
    role: src.role,
    deviceType: src.deviceType,
    icon: src.icon,
    lastSuccess: src.role === "dcBattery"
      ? // DC-Speicher gilt als „frisch", wenn eine verlinkte Quelle frisch ist.
        [src.dcLinkedPv, src.dcLinkedBatteryOut, src.dcLinkedCharger]
          .filter(Boolean)
          .map((id) => sourceStatus[id as string]?.lastSuccess ?? null)
          .reduce<number | null>((acc, v) => (v == null ? acc : Math.max(acc ?? 0, v)), null)
      : sourceStatus[src.id]?.lastSuccess ?? null,
    lastError: sourceStatus[src.id]?.lastError ?? null,
    intervalSec: src.intervalSec,
    enabled: sourceEnabled(src),
    values: src.role === "dcBattery"
      ? dcLinkedValues(src)
      : [
          ...(lastRead[src.id]?.display ?? src.fields.map((f) => ({
            label: f.label, value: 0 as number | boolean | string, unit: f.unit,
          }))),
          // Werte etwaiger untergeordneter Quellen integrieren.
          ...subordinateValues(src.id),
        ],
  }));
  return {
    live: { ...live },
    day: { ...day },
    history: db.getHistory(),
    // Aktuelle Drosselungen aus dem Live-Tracking (nicht mehr aus einer eigenen
    // Tabelle – die Historie steht als Info-Meldung auf der Debug-Seite). Nur
    // aktive Drosselungen (< 100 %), damit der Indikator im Hauptdiagramm den
    // jüngsten Wert zeigt.
    drosselungen: Object.entries(currentDrosselung)
      .filter(([, v]) => v < 100)
      .map(([source, value]) => ({ date: "", value, source })),
    settings: { ...settings },
    sources: srcStatus,
    sinks: getSinkStatus(),
    time,
    date,
    initDone: db.getInitDone(),
    effektiverStrompreis: aktuellerBezugspreis(),
  };
}

// Aktuell gültiger Brutto-Bezugspreis (€/kWh) für die Anzeige. Beim dynamischen
// Tarif fließt der Börsenpreis der laufenden Viertelstunde ein (kann negativ
// sein → Gutschrift bei Bezug). Beim Fixtarif der feste Gesamtpreis.
function aktuellerBezugspreis(): number {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Zeitversionierte Sätze: die heute gültige Periode verwenden.
  const eff = db.effectiveSettings(dateStr);
  if (eff.tarifMode !== "dyn") return computeStrompreis(eff, d);
  const spot = db.getSpotpreise(dateStr)?.prices ?? null;
  const idx = d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
  const spotCt = spot && idx < spot.length ? spot[idx] : null;
  return bezugspreisVS(eff, d, spotCt);
}

export function getDiagnostics() {
  const anchors: Record<string, number> = {};
  for (const src of sources) {
    if (src.role === "grid" || src.role === "gridEmu") {
      anchors[gridInAnchorKey(src.id)] = db.getReset(gridInAnchorKey(src.id), -1);
      anchors[gridOutAnchorKey(src.id)] = db.getReset(gridOutAnchorKey(src.id), -1);
    } else if (
      src.role === "pv" ||
      src.role === "batteryOut" ||
      src.role === "batteryIn"
    ) {
      anchors[energyAnchorKey(src.id)] = db.getReset(energyAnchorKey(src.id), -1);
    }
  }
  return {
    initDone: db.getInitDone(),
    dayReset: db.getDayReset(),
    today: now().date,
    resetsReady: resetsReady(),
    anchors,
    day: { ...day },
    sourceCount: sources.length,
  };
}

// --- Aktionen ---
export function setCosts(value: number): void {
  settings.strompreis = value;
  db.saveSetting("strompreis", value);
}

// Speichert geänderte Energiekosten-Einstellungen und lädt sie neu, damit
// die Berechnungen (effektiver Strompreis, Einspeisung) sofort greifen.
export function saveEnergySettings(patch: Partial<Settings>): void {
  db.saveSettings(patch);
  settings = db.loadSettings();
  broadcast(); // geänderte Settings (z.B. Chart-Farben) sofort an Clients senden
}

// Welcher §14a-Lasttarif gilt zur gegebenen Zeit?
// Standard gilt immer, außer ein Hoch-/Niedriglastfenster trifft auf die
// aktuelle Uhrzeit UND das aktuelle Quartal zu.
function activeLastTarif(
  s: Settings,
  date: Date
): "standard" | "hoch" | "niedrig" {
  const minute = date.getHours() * 60 + date.getMinutes();
  const quarter = Math.floor(date.getMonth() / 3) + 1; // 1..4
  const inWindow = (w: { startMin: number; endMin: number }) =>
    w.startMin <= w.endMin
      ? minute >= w.startMin && minute < w.endMin
      : minute >= w.startMin || minute < w.endMin; // über Mitternacht
  for (const w of s.lastWindows) {
    if (!w.quarters.includes(quarter)) continue;
    if (inWindow(w)) return w.kind; // "hoch" | "niedrig"
  }
  return "standard";
}

// Effektiver Strompreis (€/kWh) zur gegebenen Zeit.
// Basis ist der eingegebene Strompreis (Fixtarif) bzw. die Summe aus
// Beschaffung + Steuern/Abgaben brutto (dyn. Tarif). In diesem Basispreis ist
// das Standardlast-Netzentgelt bereits enthalten. Ist §14a Modul 3 aktiv, wird
// die Differenz Hoch/Niedrig zum Standard auf-/abgeschlagen.
export function computeStrompreis(s: Settings, date = new Date()): number {
  let basis: number;
  if (s.tarifMode === "dyn") {
    // Netto-Bestandteile inkl. Standardlast-Netzentgelt (dieses ist beim
    // Fixtarif schon im Gesamtpreis enthalten; beim dyn. Tarif rechnen wir es
    // hier hinzu). Die §14a-Korrektur unten arbeitet mit der Differenz zum
    // Standard, daher ist die Basis konsistent das Standard-Netzentgelt.
    const nettoCt =
      s.beschaffung +
      s.stromsteuer +
      s.konzessionsabgabe +
      s.aufschlagNetznutzung +
      s.offshoreUmlage +
      s.kwkgUmlage +
      s.netzentgeltStandard;
    const bruttoCt = nettoCt * (1 + s.umsatzsteuer / 100);
    basis = bruttoCt / 100; // ct -> €
  } else {
    basis = s.strompreis; // Fixtarif: Gesamtpreis inkl. allem
  }
  if (!s.paragraf14aAktiv) return basis;

  // §14a: Differenz des aktuellen Netzentgelts zum Standard (brutto, €/kWh).
  // Die Differenz bei dyn. Tarif ebenfalls mit USt., beim Fixtarif ist die
  // USt. konzeptionell schon im Gesamtpreis – wir schlagen die Netto-Differenz
  // brutto auf, da Netzentgelte gesetzlich der USt. unterliegen.
  const tarif = activeLastTarif(s, date);
  let diffCt = 0;
  if (tarif === "hoch") diffCt = s.netzentgeltHoch - s.netzentgeltStandard;
  else if (tarif === "niedrig")
    diffCt = s.netzentgeltNiedrig - s.netzentgeltStandard;
  const diffBruttoEur = (diffCt * (1 + s.umsatzsteuer / 100)) / 100;
  return basis + diffBruttoEur;
}

export function resetDrosselungen(): void {
  db.clearDrosselungen();
  for (const k of Object.keys(currentDrosselung)) delete currentDrosselung[k];
}
export function resetDrosselungenForSource(sourceId: string): void {
  db.clearDrosselungenForSource(sourceId);
  delete currentDrosselung[sourceId];
}
export function resetHistory(): void {
  db.clearHistory();
}
export function deleteHistoryMonth(month: string): void {
  db.deleteHistoryMonth(month);
}

// Quellen-Konfiguration aktualisieren (ganze Liste).
export function setSources(next: SourceConfig[]): void {
  // Vor dem Überschreiben prüfen, ob sich bei einer emulierten §42c-Quelle die
  // Skalierung (jahresverbrauch) oder das Profil (emuProfile) geändert hat. Der
  // emulierte kumulierte Zählerstand skaliert direkt damit; sinkt er (z.B.
  // 3500 -> 2500 kWh/a), passt der bisherige VS-Anker nicht mehr und würde über
  // Monate 0-Werte liefern (negatives, auf 0 geklemmtes Delta). In dem Fall die
  // zugehörigen Anker verwerfen, damit beim nächsten Messwert frisch auf den
  // aktuellen (niedrigeren) Stand verankert wird und der Lastgang sofort wieder
  // korrekt weiterläuft.
  const prevById = new Map(sources.map((s) => [s.id, s]));
  for (const ns of next) {
    if (!is42cRole(ns.role) || ns.mock !== "emu") continue;
    const prev = prevById.get(ns.id);
    if (!prev) continue;
    const skalGeaendert = (prev.jahresverbrauch ?? 0) !== (ns.jahresverbrauch ?? 0);
    const profilGeaendert = (prev.emuProfile ?? "") !== (ns.emuProfile ?? "");
    if (skalGeaendert || profilGeaendert) {
      clearVsAnchor(`vs.42c.${ns.id}`);
      clearVsAnchor(`vs.42cOut.${ns.id}`);
      db.addLog(
        db.LOG_LEVELS.info,
        "sharing",
        `§42c-Quelle '${ns.label}': ${skalGeaendert ? `Jahresverbrauch ${prev.jahresverbrauch ?? 0}->${ns.jahresverbrauch ?? 0} kWh` : ""}${skalGeaendert && profilGeaendert ? ", " : ""}${profilGeaendert ? `Profil ${prev.emuProfile ?? "-"}->${ns.emuProfile ?? "-"}` : ""} geändert – Lastgang-Anker neu gesetzt.`,
      );
    }
  }
  sources = next.map((s) => ({
    ...s,
    intervalSec: Math.max(MIN_INTERVAL_SEC, Math.round(s.intervalSec) || 5),
    timeoutMs: Math.max(200, Math.round(s.timeoutMs) || 3000),
  }));
  db.saveSources(sources);
  startTimers();
}
export function getSources(): SourceConfig[] {
  return sources;
}

// --- Senken (emulierter Shelly Pro 3EM) ---
export function getSinks(): Sink[] {
  return sinks;
}
export function setSinks(list: Sink[]): void {
  db.saveSinks(list);
  sinks = db.loadSinks();
  computeSinks();
  broadcast();
}
// Schaltet den Ausfade-Modus (AC-Speicher sanft auf 0) der aktiven CT-Senke.
// Von Regel-Aktionen (type "ctfade") und der Senkenseite genutzt. Gibt true
// zurück, wenn eine CT-Senke gefunden und umgeschaltet wurde.
export function setCtFadeout(on: boolean): boolean {
  const list = db.loadSinks();
  const s = list.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
  if (!s) return false;
  s.ctFadeout = on;
  // Die CT-Modi schließen sich gegenseitig aus: Ausfaden hat Vorrang, beim
  // Einschalten wird "kein AC-Laden" deaktiviert.
  if (on) s.ctNoAcCharge = false;
  setSinks(list);
  return true;
}
// Liest, ob der CT-Ausfade-Schalter der aktiven CT-Senke an ist.
export function getCtFadeout(): boolean {
  return sinks.some((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003") && x.ctFadeout === true);
}
// Modus "kein AC-Laden": begrenzt den CT-Wert auf >= 0 (negative Werte, die den
// Speicher zum Laden bewegen würden, werden auf 0 gekappt). Schließt sich mit dem
// Ausfade-Modus gegenseitig aus.
export function setCtNoAcCharge(on: boolean): boolean {
  const list = db.loadSinks();
  const s = list.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
  if (!s) return false;
  s.ctNoAcCharge = on;
  if (on) s.ctFadeout = false; // Ausfaden und "kein AC-Laden" schließen sich aus
  setSinks(list);
  return true;
}
export function getCtNoAcCharge(): boolean {
  return sinks.some((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003") && x.ctNoAcCharge === true);
}
// Laufzeit-Status aller Senken (für die Statusseite).
export function getSinkStatus(): SinkStatus[] {
  return sinks.map(
    (s) =>
      sinkStatus[s.id] ?? {
        id: s.id,
        name: s.name,
        baseSourceId: s.baseSourceId,
        baseSourceLabel: sourceById(s.baseSourceId)?.label ?? s.baseSourceId,
        enabled: s.enabled,
        outputPowerW: 0,
        eigenBezugW: 0,
        abnehmerBezugW: 0,
        lastUpdate: null,
      }
  );
}
// Momentane Ausgabeleistung (W) einer Senke für die JSON-Schnittstelle.
export function getSinkOutputPower(id: string): number | null {
  const st = sinkStatus[id];
  if (st) return st.outputPowerW;
  // Senke existiert, aber noch nicht berechnet -> 0; unbekannte id -> null
  return sinks.some((s) => s.id === id) ? 0 : null;
}

// Leistung der (ersten) aktiven Senke, die per UDP-Discovery angeboten wird.
// Für den Shelly-Pro-3EM-Discovery-Responder. null = keine solche Senke aktiv.
export function getDiscoverySinkPower(): number | null {
  const s = sinks.find((x) => x.enabled && x.useDiscovery);
  if (!s) return null;
  return sinkStatus[s.id]?.outputPowerW ?? 0;
}

// Liefert Leistung + Shelly-Typ ALLER aktiven Discovery-Senken, die einen
// Shelly-Zähler emulieren (pro3em/proem50/emg3). Mehrere gleichzeitig sind
// zulässig – so lassen sich zwei Marstek-Speicher mit je eigenem emulierten
// Zähler versorgen. CT-Senken bleiben außen vor (eigener Mechanismus).
export function getDiscoverySinkInfo(): Array<{ power: number; meter: "pro3em" | "proem50" | "emg3" }> {
  const out: Array<{ power: number; meter: "pro3em" | "proem50" | "emg3" }> = [];
  for (const s of sinks) {
    if (!s.enabled || !s.useDiscovery) continue;
    const meter = s.emulatedMeter ?? "pro3em";
    if (meter !== "pro3em" && meter !== "proem50" && meter !== "emg3") continue; // CT -> nicht via Shelly
    out.push({ power: sinkStatus[s.id]?.outputPowerW ?? 0, meter });
  }
  return out;
}

// Liefert Leistung, CT-Modell und die registrierten MACs der aktiven
// Discovery-Senke – aber nur, wenn diese ein CT002/CT003 emuliert. Sonst null.
export function getCtSinkInfo(): { power: number; model: "ct002" | "ct003"; ctMac: string; batteryMac: string; weights: Array<{ ip: string; weight: number }>; deadbandW: number; maxStepW: number; fadeout: boolean; fadeStepW: number; noAcCharge: boolean; maxTotalW: number; balanceStepW: number; balanceToleranceW: number; alternierendeEntladung: boolean; socByIp: Record<string, number> } | null {
  // CT-Emulation hängt NICHT an useDiscovery (das gilt nur für die Shelly-
  // Broadcast-Erkennung). Ein CT wird über seine feste Identität angesprochen,
  // daher genügt: aktive Senke mit CT-Zählertyp.
  const s = sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
  if (!s) return null;
  // Sicherheits-Herunterfahren (keine frische Netzmessung): Fadeout erzwingen,
  // damit die Speicher aktiv und kontrolliert auf 0 W gefahren werden, statt auf
  // einem veralteten Sollwert konstant weiter einzuspeisen.
  const safeShutdown = ctSafeShutdown.has(s.id);
  // SoC je Speicher-IP für die alternierende Entladung: aus den AC-Speicher-
  // Quellen die IP (aus der Marstek-URL) mit dem zuletzt gelesenen SoC verbinden.
  // Die IP ist der Schlüssel, unter dem der Balancer die Speicher führt (Absender-
  // IP beim CT-Poll).
  const socByIp: Record<string, number> = {};
  for (const src of sources) {
    if (src.role !== "acBattery" || !sourceEnabled(src)) continue;
    const url = src.url ?? "";
    const tgt = url ? parseMarstekTarget(url) : null;
    const ip = tgt?.host;
    if (!ip) continue;
    // SoC von der Quelle selbst oder ihrer verknüpften Leistungs-/Batteriequelle.
    const socRaw = lastRead[src.id]?.values.soc
      ?? (src.powerSourceId ? lastRead[src.powerSourceId]?.values.soc : undefined);
    if (socRaw != null && Number.isFinite(socRaw)) socByIp[ip] = socRaw as number;
  }
  return {
    power: safeShutdown ? 0 : (sinkStatus[s.id]?.outputPowerW ?? 0),
    model: s.emulatedMeter as "ct002" | "ct003",
    ctMac: s.ctMac ?? "",
    batteryMac: s.batteryMac ?? "",
    weights: Array.isArray(s.ctWeights) ? s.ctWeights : [],
    deadbandW: Number.isFinite(s.ctDeadbandW) ? (s.ctDeadbandW as number) : 0,
    maxStepW: Number.isFinite(s.ctMaxStepW) ? (s.ctMaxStepW as number) : 0,
    fadeout: safeShutdown ? true : (s.ctFadeout === true),
    fadeStepW: Number.isFinite(s.ctFadeStepW) ? (s.ctFadeStepW as number) : 0,
    noAcCharge: s.ctNoAcCharge === true,
    // "Max. Leistung" der Senke als Gesamtlimit für den Speicherverbund (W).
    maxTotalW: Number.isFinite(s.maxPowerW) && s.maxPowerW > 0 ? (s.maxPowerW as number) : 0,
    // Entkoppelte Umverteilungs-Dämpfung (langsames Ins-Verhältnis-Bringen).
    balanceStepW: Number.isFinite(s.ctBalanceStepW) ? (s.ctBalanceStepW as number) : 0,
    balanceToleranceW: Number.isFinite(s.ctBalanceToleranceW) ? (s.ctBalanceToleranceW as number) : 0,
    alternierendeEntladung: s.ctAlternierendeEntladung === true,
    socByIp,
  };
}

// Energy-Sharing: Verteilungsmodus (Settings) und statische Quoten je
// externer Quelle in einem Schritt aktualisieren.
export function updateSharingConfig(
  mode: "dynamisch" | "statisch" | undefined,
  quoten: Record<string, number> | undefined
): void {
  if (mode) saveEnergySettings({ sharingMode: mode });
  if (quoten) {
    sources = sources.map((s) =>
      is42cRole(s.role) && quoten[s.id] != null
        ? { ...s, sharingQuote: quoten[s.id] }
        : s
    );
    db.saveSources(sources);
  }
}
export function getRooms(): string[] {
  return db.loadRooms();
}
export function setRooms(rooms: string[]): void {
  db.saveRooms(rooms);
}

// --- SSE ---
type Listener = (state: FullState) => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function broadcast(): void {
  const state = getState();
  for (const fn of listeners) fn(state);
}

// --- Timer pro Quelle ---
const timers = new Map<string, ReturnType<typeof setInterval>>();
function clearTimers(): void {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
}
export function startTimers(): void {
  clearTimers();
  // MQTT-Verbindungen für alle aktiven MQTT-Quellen herstellen/aufräumen.
  reconcileMqtt(sources, (msg) => log.warn("mqtt", msg));
  for (const src of sources) {
    if (!sourceEnabled(src)) continue;
    // Auch MQTT-Quellen bekommen einen Timer: pollSource liest bei ihnen die
    // zuletzt empfangene Payload aus dem Cache und übernimmt sie in die Bilanz.
    const sec = Math.max(MIN_INTERVAL_SEC, src.intervalSec);
    pollSource(src.id);
    timers.set(src.id, setInterval(() => pollSource(src.id), sec * 1000));
  }
}
export function startPoller(): void {
  setCustomProfiles(db.loadCustomProfiles());
  setGenProfiles(db.loadGenProfiles());
  // Regel-Engine: automatisch abgelaufene Regeln zurückschreiben.
  setPersistDisabled((ruleId) => {
    const rules = db.loadRules();
    const r = rules.find((x) => x.id === ruleId);
    if (r) { r.enabled = false; db.saveRules(rules); }
  });
  // Vor dem ersten Poll: heute bereits persistierte Tagessummen laden, damit die
  // Energiezähler nach einem Neustart die volle Tagesenergie zeigen statt bei 0
  // zu beginnen (siehe dayDiff / loadStartDaySums).
  loadStartDaySums();
  startTimers();

  // §9-Regelung (LPP): periodisch die Wechselrichter gegen die aktuelle
  // Netzeinspeisung nachführen. Eigenes Intervall gemäß Konfiguration.
  const lppTick = () => {
    try {
      const cfg = getLppControlConfig();
      if (cfg.enabled) void regelLpp(live.gridPower);
    } catch { /* ignore */ }
  };
  setInterval(lppTick, 5000);

  // Fehlende History-Tage aus Viertelstundenwerten nachtragen. Behebt Fälle, in
  // denen der Tagesabschluss übersprungen wurde (z. B. Start mitten am Tag), die
  // Viertelstundenwerte aber vollständig vorliegen. Nur abgeschlossene Tage in
  // der Vergangenheit – der heutige, laufende Tag wird ausgelassen.
  try {
    const heute = now().date;
    let nachgetragen = 0;
    for (const tag of db.getDaysWithVierteldataButNoHistory()) {
      if (tag >= heute) continue; // laufenden/künftigen Tag nicht abschließen
      if (db.rebuildHistoryFromViertelstunden(tag)) nachgetragen++;
    }
    if (nachgetragen > 0) {
      db.addLog(db.LOG_LEVELS.info, "history",
        `${nachgetragen} fehlende Tagesbilanz(en) aus Viertelstundenwerten nachgetragen.`);
    }
  } catch (e) {
    db.addLog(db.LOG_LEVELS.warn, "history", `History-Nachtrag fehlgeschlagen: ${String(e)}`);
  }
}

export { live, day };
