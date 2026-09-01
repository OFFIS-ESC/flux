// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Automatisierungsregel-Engine.
//
// Wertet für jede scharfgeschaltete Regel die Ein- und Ausschaltbedingungen
// gegen eine Momentaufnahme der Live-Metriken aus. Beim Übergang inaktiv→aktiv
// wird die On-Aktion ausgeführt (Shelly schalten / Push), beim Übergang
// aktiv→inaktiv die Off-Aktion. Jede Auslösung wird protokolliert – inklusive
// einem Ergebnis-Text (aufgenommene Energie, Temperaturänderung), der beim
// Ausschalten aus den Werten zu Beginn/Ende gebildet wird.

import * as db from "./db.js";
import type {
  AutomationRule,
  RuleAction,
  RuleCondition,
  RuleConditionGroup,
  RuleMetric,
} from "./types.js";
import type { SourceConfig } from "./sources.js";
import { switchSource, getSwitchState, resolveSwitchChannel } from "./switch.js";
import { sendNtfy } from "./notify.js";
import { setMarstekModbusForce, setMarstekModbusWorkMode, isMarstekWorkMode } from "./marstekModbus.js";

// Momentaufnahme aller für Regeln nutzbaren Größen.
export interface RuleMetrics {
  ueberschuss: number;   // W
  pvPower: number;       // W
  gridPower: number;     // W (>0 Bezug)
  hausverbrauch: number; // W
  batterySoC: number;    // %
  tankUp: number;        // °C
  tankDown: number;      // °C
  spotpreis: number | null; // aktueller Börsenpreis ct/kWh (null wenn unbekannt)
  bezugspreisBrutto: number | null; // aktueller dyn. Bezugspreis brutto ct/kWh (null wenn nicht dyn./unbekannt)
  drosselVorteilCt: number | null; // Vorteil je kWh fürs Abschalten+Beziehen (ct/kWh); null wenn nicht dyn.
  wasserverbrauch: number; // Liter im laufenden Viertelstunden-Slot
  sourcePower: Record<string, number>; // je Quelle W (Betrag der Momentanleistung)
  offlineSources: Record<string, boolean>; // Quelle liefert aktuell keine Daten
  // Quelle ist in der Quellendefinition deaktiviert (Häkchen „aktiv" nicht
  // gesetzt). Unabhängig von Leistung/Erreichbarkeit.
  disabledSources: Record<string, boolean>;
  // Dauer (Minuten), seit der eine Quelle DURCHGEHEND wegen Nichterreichbarkeit
  // (Host/Netz nicht erreichbar) fehlschlägt. 0 = aktuell erreichbar. Für die
  // Regel "Quelle seit ≥ X nicht erreichbar".
  unreachableMinutes: Record<string, number>;
  // Tageswerte (für Tagesstatistik-Benachrichtigungen und Platzhalter):
  tagVerbrauchKwh: number;   // Hausverbrauch heute
  tagEinspeisungKwh: number; // Einspeisung heute
  tagKostenEuro: number;     // Tageskosten heute (Bezug − Vergütung)
  tarifMode: "fix" | "dyn";  // aktuell geltendes Stromtarif-Modell
}

// Laufzeit-Status je Regel (nicht persistiert).
interface RuleRuntime {
  active: boolean;
  // seit wann gilt eine forMinutes-Bedingung? key = condId
  condSince: Record<string, number>;
  // Momentaufnahme beim Einschalten (für Ergebnis-Text beim Ausschalten)
  onSnapshot?: { ts: number; tankUp: number; tankDown: number; sourceEnergyDay: number; targetId?: string };
  // Geschaltete Aktoren dieser Regel + ihr beim Einschalten erwarteter Zustand.
  // Wird während der Laufzeit überwacht: Weicht ein Aktor extern ab (z. B. manuell
  // über die Hersteller-App zurückgeschaltet), wird die Regel beendet.
  watchedSwitches?: Array<{ sourceId: string; channel: number; expectedOn: boolean; label: string; confirmed: boolean }>;
  // Für Regeln ohne Ausschaltbedingung: bereits ausgelöst? Wird zurückgesetzt,
  // sobald die Einschaltbedingung zwischenzeitlich nicht mehr erfüllt ist, damit
  // eine erneute Auslösung möglich ist (Flankenerkennung).
  firedOnce?: boolean;
  // Wurde diese Regel MANUELL (über die Kachel/den Start-Knopf) aktiviert? Nur
  // dann darf eine NICHT scharfe Regel als laufend gelten – die automatische
  // Zielzustands-/Bedingungserkennung darf eine nicht scharfe Regel niemals von
  // selbst auf laufend setzen.
  startedManually?: boolean;
}
const runtime: Record<string, RuleRuntime> = {};

// Beim ersten Lauf den persistierten Aktiv-Zustand (Einschalt-Zeitstempel) aus
// der DB wiederherstellen, damit ein zeitgesteuertes Auto-Off einen Neustart des
// Servers übersteht (sonst bliebe ein geschalteter Verbraucher hängen).
let activeStateRestored = false;
function restoreActiveState(): void {
  if (activeStateRestored) return;
  activeStateRestored = true;
  try {
    const stored = db.getRuleActiveState();
    // Regeln ohne Ausschaltbedingung dürfen nie als "laufend" gelten (Feuer-und-
    // vergiss). Falls so eine Regel früher fälschlich als aktiv gespeichert wurde,
    // wird sie hier NICHT wiederhergestellt und der Zustand bereinigt.
    const rulesById = new Map(db.loadRules().map((r) => [r.id, r]));
    let changed = false;
    for (const [ruleId, ts] of Object.entries(stored)) {
      const rule = rulesById.get(ruleId);
      if (rule && rule.offWhen.conditions.length === 0) { changed = true; continue; }
      // Nicht scharfe Regeln werden NICHT als laufend wiederhergestellt – die
      // Automatik darf sie nicht aktiv halten. Ein früher (im scharfen Zustand)
      // persistierter Aktiv-Zustand wird hier verworfen und bereinigt.
      if (rule && rule.enabled === false) { changed = true; continue; }
      if (!runtime[ruleId]) runtime[ruleId] = { active: false, condSince: {} };
      runtime[ruleId].active = true;
      // onSnapshot mit dem gespeicherten Einschalt-Zeitstempel rekonstruieren
      // (Temperatur-/Energie-Referenzen sind nach Neustart nicht mehr bekannt).
      runtime[ruleId].onSnapshot = { ts, tankUp: 0, tankDown: 0, sourceEnergyDay: 0 };
    }
    if (changed) persistActiveState();
  } catch {
    /* defensiv: bei Problemen einfach ohne Restore weiter */
  }
}

// Aktiv-Zustand aller Regeln in die DB spiegeln (nur die aktiven mit ts).
function persistActiveState(): void {
  const state: Record<string, number> = {};
  for (const [ruleId, rt] of Object.entries(runtime)) {
    if (rt.active && rt.onSnapshot) state[ruleId] = rt.onSnapshot.ts;
  }
  db.setRuleActiveState(state);
}

// Der Tageswechsel-Trigger stützt sich ausschließlich auf den persistenten
// Merker in der DB (kein fragiler In-Memory-Init). Er feuert, sobald der heutige
// Kalendertag vom zuletzt gespeicherten abweicht. Damit beim allerersten Start
// (leere DB) nicht sofort gefeuert wird, wird der Merker beim ersten Kontakt auf
// heute gesetzt, falls noch nichts gespeichert ist – aber das passiert nur bei
// wirklich leerem Merker, nicht bei jedem Prozessstart.
function todayStr(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
// true, wenn heute ein neuer Kalendertag ggü. dem gespeicherten Merker ist.
function dailyTriggerDue(now: Date): boolean {
  const today = todayStr(now);
  const stored = db.getLastDailyTrigger();
  if (!stored) {
    // Erststart mit leerem Merker: heute eintragen, nicht feuern.
    db.setLastDailyTrigger(today);
    return false;
  }
  return stored !== today;
}

// Zuletzt berechneter Bedingungs-Status je Regel (für die UI: grün/rot).
const condStatus: Record<string, Record<string, boolean>> = {};

// Zuletzt berechneter Aktions-Zustand je Regel: für prüfbare Aktionen (switch
// on/off, ctfade), ob der Zielzustand aktuell eingenommen ist. Schlüssel je
// Aktion: "on:<index>" bzw. "off:<index>" (Phase + Position in der Aktionsliste).
// null = Zustand gerade nicht lesbar (Gerät nicht erreichbar) -> UI zeigt „?".
const actionStatus: Record<string, Record<string, boolean | null>> = {};

export function getConditionStatus(): Record<string, Record<string, boolean>> {
  return condStatus;
}
export function getActionStatus(): Record<string, Record<string, boolean | null>> {
  return actionStatus;
}
// Ermittelt für eine einzelne Aktion, ob ihr prüfbarer Zielzustand erreicht ist.
// Gibt undefined zurück, wenn die Aktion keinen prüfbaren Zustand hat
// (notify/timer/acspeicher).
async function actionAtTarget(a: RuleAction, sources: SourceConfig[]): Promise<boolean | null | undefined> {
  if (a.type === "switch" && a.targetSourceId && (a.switchTo === "on" || a.switchTo === "off")) {
    const src = sources.find((s) => s.id === a.targetSourceId);
    if (!src) return null;
    const channel = resolveSwitchChannel(src);
    const state = await getSwitchState(src, channel);
    if (state == null) return null;
    return state === (a.switchTo === "on");
  }
  if (a.type === "ctfade") {
    return ctFadeStateProvider() === (a.ctFadeOn === true);
  }
  if (a.type === "ctnoac") {
    return ctNoAcChargeStateProvider() === (a.ctNoAcChargeOn === true);
  }
  return undefined; // kein prüfbarer Zustand
}
// Berechnet den Aktions-Zustand aller prüfbaren Aktionen einer Regel (onActions
// und offActions) und legt ihn im Cache ab.
async function computeActionStatus(rule: AutomationRule, sources: SourceConfig[]): Promise<void> {
  const st: Record<string, boolean | null> = {};
  const phases: Array<["on" | "off", RuleAction[]]> = [
    ["on", rule.onActions ?? []],
    ["off", rule.offActions ?? []],
  ];
  for (const [phase, list] of phases) {
    for (let i = 0; i < list.length; i++) {
      const res = await actionAtTarget(list[i], sources);
      if (res !== undefined) st[`${phase}:${i}`] = res;
    }
  }
  actionStatus[rule.id] = st;
}
export function getRuleActive(ruleId: string): boolean {
  return runtime[ruleId]?.active ?? false;
}
// Zeitpunkt (ms), seit dem die Regel aktiv ist – für die Kachel-Anzeige.
export function getRuleActiveSince(ruleId: string): number | null {
  const rt = runtime[ruleId];
  return rt?.active && rt.onSnapshot ? rt.onSnapshot.ts : null;
}

// Gemeinsame Einschalt-Logik (von Automatik und manuellem Start genutzt).
// `manual` markiert einen manuellen Start – nur dann darf eine NICHT scharfe
// Regel laufend bleiben (die Automatik aktiviert nicht scharfe Regeln nie).
async function activateRule(rule: AutomationRule, sources: SourceConfig[], m: RuleMetrics | undefined, now: Date, reason: string, manual = false): Promise<void> {
  if (!runtime[rule.id]) runtime[rule.id] = { active: false, condSince: {} };
  const rt = runtime[rule.id];
  rt.active = true;
  rt.startedManually = manual;
  const primaryTarget = (rule.onActions ?? []).find(
    (a) => (a.type === "switch" || a.type === "acspeicher") && a.targetSourceId
  )?.targetSourceId;
  rt.onSnapshot = {
    ts: now.getTime(),
    tankUp: m?.tankUp ?? 0,
    tankDown: m?.tankDown ?? 0,
    sourceEnergyDay: primaryTarget && m ? getSourceEnergyDayCb(primaryTarget) : 0,
    targetId: primaryTarget,
  };
  await runAction(rule, true, sources, m);
  db.addRuleLog(rule.id, rule.name, "on", reason);
  // Erwarteten Zustand der geschalteten Aktoren erfassen, um während der Laufzeit
  // auf externe Änderungen (z. B. manuelles Zurückschalten) reagieren zu können.
  rt.watchedSwitches = await captureWatchedSwitches(rule, sources);
  persistActiveState();
  if (rule.notifyOnActivate) {
    void sendNtfy(`Regel „${rule.name}" wurde aktiviert.`, {
      title: "HEMS-Automatisierung", priority: 3, tags: ["gear"],
    });
  }
}

// Ermittelt für alle switch-Aktionen einer Regel den erwarteten Zustand, den ein
// Aktor NACH dem Einschalten haben soll. Der Zustand wird direkt vom Gerät
// gelesen (Referenzzustand); ist er nicht lesbar, wird der Sollwert der Aktion
// verwendet. Nur eindeutig bestimmbare Zustände werden überwacht.
async function captureWatchedSwitches(
  rule: AutomationRule, sources: SourceConfig[],
): Promise<Array<{ sourceId: string; channel: number; expectedOn: boolean; label: string; confirmed: boolean }>> {
  const out: Array<{ sourceId: string; channel: number; expectedOn: boolean; label: string; confirmed: boolean }> = [];
  for (const action of rule.onActions ?? []) {
    if (action.type !== "switch" || !action.targetSourceId) continue;
    const src = sources.find((s) => s.id === action.targetSourceId);
    if (!src) continue;
    const channel = resolveSwitchChannel(src);
    // Erwarteter Zustand: bei explizitem on/off der Sollwert; bei toggle den
    // tatsächlich resultierenden Zustand vom Gerät lesen.
    let expectedOn: boolean;
    if (action.switchTo === "on") expectedOn = true;
    else if (action.switchTo === "off") expectedOn = false;
    else {
      const st = await getSwitchState(src, channel);
      if (st == null) continue; // nicht lesbar -> nicht überwachen
      expectedOn = st;
    }
    // confirmed=false: Der erwartete Zustand wurde noch nicht frisch bestätigt.
    // Die Override-Erkennung greift erst, nachdem der Schalter den erwarteten
    // Zustand mindestens einmal tatsächlich gemeldet hat (verhindert einen
    // Fehlalarm durch den noch veralteten Poll-Cache direkt nach dem Schalten).
    out.push({ sourceId: src.id, channel, expectedOn, label: src.label, confirmed: false });
  }
  return out;
}

// Prüft, ob eine Aktion einen dauerhaft prüfbaren Zielzustand hat (switch mit
// on/off, oder ctfade). notify/timer/acspeicher haben keinen solchen Zustand.
function isStatefulAction(a: RuleAction): boolean {
  if (a.type === "switch" && a.targetSourceId && (a.switchTo === "on" || a.switchTo === "off")) return true;
  if (a.type === "ctfade") return true;
  if (a.type === "ctnoac") return true;
  return false;
}

// Prüft, ob eine Aktion einen AKTIVEN Zielzustand herstellt (Aktor ein oder
// Ausfaden an). Nur solche Aktionen machen eine Regel „laufend-fähig" – eine
// Regel, deren Ziel ausschließlich Aus-Zustände sind (z. B. eine Rückschalt-
// Regel), soll NICHT dauerhaft als laufend gelten, nur weil alles aus ist.
function isActivatingAction(a: RuleAction): boolean {
  if (a.type === "switch" && a.targetSourceId && a.switchTo === "on") return true;
  if (a.type === "ctfade" && a.ctFadeOn === true) return true;
  if (a.type === "ctnoac" && a.ctNoAcChargeOn === true) return true;
  return false;
}

// Prüft, ob eine Regel „bedingungslos zustandsschaltend" ist: keine
// Einschaltbedingung, aber mindestens eine Aktion mit AKTIVEM Zielzustand (Aktor
// ein oder CT-Ausfaden an). Solche Regeln sollen als laufend gelten, sobald ihr
// GESAMTER Zielzustand erreicht ist – egal wie (auch extern) – damit sie über
// die Startseiten-Kachel gestoppt werden können. Reine Aus-/Rückschalt-Regeln
// fallen NICHT darunter (sie bleiben Feuer-und-vergiss).
function isConditionlessSwitchRule(rule: AutomationRule): boolean {
  if (rule.onWhen.conditions.length > 0) return false;
  return (rule.onActions ?? []).some(isActivatingAction);
}

// Prüft, ob ALLE zustandsbehafteten Einschalt-Aktionen einer Regel ihren
// Zielzustand erreicht haben. Erst dann gilt die Regel als „laufend".
//   - true  = jede prüfbare Aktion ist im Ziel (Regel ist vollständig laufend)
//   - false = mindestens eine Aktion ist eindeutig NICHT im Ziel
//   - null  = unklar, weil mindestens ein Zustand gerade nicht lesbar ist (ohne
//             eindeutiges „nicht im Ziel"); dann keine Aussage, damit ein kurzer
//             Geräteausfall die Regel weder fälschlich startet noch stoppt.
async function allActionsAtTarget(
  rule: AutomationRule, sources: SourceConfig[],
): Promise<boolean | null> {
  let sawUnreadable = false;
  let sawAny = false;
  for (const action of rule.onActions ?? []) {
    if (!isStatefulAction(action)) continue; // notify/timer/acspeicher überspringen
    sawAny = true;
    if (action.type === "switch") {
      const src = sources.find((s) => s.id === action.targetSourceId);
      if (!src) { sawUnreadable = true; continue; }
      const channel = resolveSwitchChannel(src);
      const state = await getSwitchState(src, channel);
      if (state == null) { sawUnreadable = true; continue; }
      const wantOn = action.switchTo === "on";
      if (state !== wantOn) return false; // eindeutig nicht im Ziel
    } else if (action.type === "ctfade") {
      // Ziel: Ausfade-Schalter entspricht ctFadeOn. Der Schalterzustand ist
      // lokal und immer lesbar (kein Geräte-Roundtrip).
      const wantFade = action.ctFadeOn === true;
      if (ctFadeStateProvider() !== wantFade) return false;
    } else if (action.type === "ctnoac") {
      // Ziel: "kein AC-Laden"-Schalter entspricht ctNoAcChargeOn.
      const wantNoAc = action.ctNoAcChargeOn === true;
      if (ctNoAcChargeStateProvider() !== wantNoAc) return false;
    }
  }
  if (!sawAny) return false;              // nichts Prüfbares -> nicht „laufend"
  return sawUnreadable ? null : true;     // alles Prüfbare im Ziel (oder unklar)
}
// Prüft, ob einer der überwachten Aktoren einer aktiven Regel extern vom
// erwarteten Zustand abweicht. Gibt nur bei einer EINDEUTIGEN Abweichung true
// zurück: Ist der Zustand gerade nicht lesbar (Gerät kurz nicht erreichbar,
// getSwitchState == null), wird NICHT beendet – ein vorübergehender Ausfall darf
// die Regel nicht abbrechen.
async function externalOverrideDetected(rt: RuleRuntime, sources: SourceConfig[]): Promise<boolean> {
  const watched = rt.watchedSwitches;
  if (!watched || watched.length === 0) return false;
  for (const w of watched) {
    const src = sources.find((s) => s.id === w.sourceId);
    if (!src) continue;
    const state = await getSwitchState(src, w.channel);
    if (state == null) continue;          // nicht lesbar -> keine Aussage
    if (state === w.expectedOn) {
      // Erwarteter Zustand frisch gesehen -> ab jetzt ist eine spätere
      // Abweichung ein echter externer Eingriff.
      w.confirmed = true;
      continue;
    }
    // Abweichung vom erwarteten Zustand:
    if (!w.confirmed) {
      // Noch nie bestätigt -> das ist mit hoher Wahrscheinlichkeit der veraltete
      // Poll-Cache direkt nach dem Schalten (das Gerät wurde noch nicht erneut
      // gepollt). KEIN Override, wir warten auf die erste Bestätigung.
      continue;
    }
    return true; // war schon bestätigt und weicht jetzt ab -> echter Eingriff
  }
  return false;
}
async function deactivateRule(rule: AutomationRule, sources: SourceConfig[], m: RuleMetrics | undefined, reason: string): Promise<void> {
  const rt = runtime[rule.id];
  if (!rt) return;
  rt.active = false;
  rt.startedManually = false;
  // Beim Beenden werden ausschließlich die explizit hinterlegten Ausschalt-
  // Aktionen ausgeführt – nichts Implizites. Hat eine Regel keine offActions,
  // bleibt der eingeschaltete Aktor an; um ihn beim Stoppen auszuschalten, muss
  // dafür bewusst eine Ausschalt-Aktion definiert sein.
  await runAction(rule, false, sources);
  db.addRuleLog(rule.id, rule.name, "off", reason);
  rt.onSnapshot = undefined;
  rt.watchedSwitches = undefined;
  persistActiveState();
}

// Callback für getSourceEnergyDay + Provider für manuelles Start/Stop. Werden
// bei jedem evaluateRules-Lauf mit den aktuellen Werten versorgt (siehe dort),
// um Zirkularität mit dem Poller zu vermeiden.
let getSourceEnergyDayCb: (id: string) => number = () => 0;
let manualSourcesProvider: () => SourceConfig[] = () => [];
let manualMetricsProvider: () => RuleMetrics | undefined = () => undefined;
// Setzt den CT-Ausfade-Modus (AC-Speicher sanft auf 0). Von index.ts mit der
// Poller-Funktion setCtFadeout verbunden.
let ctFadeoutProvider: (on: boolean) => boolean = () => false;
export function setCtFadeoutProvider(fn: (on: boolean) => boolean): void {
  ctFadeoutProvider = fn;
}
// Liest, ob der CT-Ausfade-Schalter aktuell an ist (für die Bedingung
// "ctFadeState"). Von index.ts mit dem Senken-Zustand verbunden.
let ctFadeStateProvider: () => boolean = () => false;
export function setCtFadeStateProvider(fn: () => boolean): void {
  ctFadeStateProvider = fn;
}
// Setzt bzw. liest den CT-Modus "kein AC-Laden". Von index.ts mit den
// Poller-Funktionen setCtNoAcCharge/getCtNoAcCharge verbunden.
let ctNoAcChargeProvider: (on: boolean) => boolean = () => false;
export function setCtNoAcChargeProvider(fn: (on: boolean) => boolean): void {
  ctNoAcChargeProvider = fn;
}
let ctNoAcChargeStateProvider: () => boolean = () => false;
export function setCtNoAcChargeStateProvider(fn: () => boolean): void {
  ctNoAcChargeStateProvider = fn;
}
export async function manualTrigger(ruleId: string, start: boolean): Promise<boolean> {
  const rules = db.loadRules();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return false;
  const sources = manualSourcesProvider();
  const m = manualMetricsProvider();
  const now = new Date();
  if (start) {
    // Regeln ohne Ausschaltbedingung (Feuer-und-vergiss) führen nur ihre
    // Einschalt-Aktionen aus und gehen NICHT in den laufenden Zustand – sonst
    // bliebe der Stop-Knopf hängen, obwohl es nichts zu stoppen gibt.
    const hasOffConditions = rule.offWhen.conditions.length > 0;
    if (isConditionlessSwitchRule(rule)) {
      // Bedingungslose Schalt-Regel: einschalten UND als laufend markieren, damit
      // sie über die Kachel wieder gestoppt werden kann (führt dann die
      // Ausschalt-Aktionen aus).
      await runAction(rule, true, sources, m);
      if (!runtime[rule.id]) runtime[rule.id] = { active: false, condSince: {} };
      const rt = runtime[rule.id];
      rt.active = true;
      rt.startedManually = true;
      rt.onSnapshot = { ts: Date.now(), tankUp: 0, tankDown: 0, sourceEnergyDay: 0 };
      rt.watchedSwitches = await captureWatchedSwitches(rule, sources);
      persistActiveState();
      db.addRuleLog(rule.id, rule.name, "on", "Manuell gestartet");
    } else if (!hasOffConditions) {
      await runAction(rule, true, sources, m);
      db.addRuleLog(rule.id, rule.name, "on", "Manuell ausgelöst (ohne Ausschaltbedingung – einmalig)");
    } else {
      await activateRule(rule, sources, m, now, "Manuell gestartet", true);
    }
  } else {
    await deactivateRule(rule, sources, m, "Manuell gestoppt");
  }
  return true;
}

// Wertet eine einzelne Bedingung aus (ohne forMinutes-Zeitlogik – die kommt
// eine Ebene höher).
function evalConditionInstant(c: RuleCondition, m: RuleMetrics, now: Date): boolean {
  switch (c.kind) {
    case "time": {
      const wd = now.getDay();
      if (c.weekdays && c.weekdays.length && !c.weekdays.includes(wd)) return false;
      const hm = now.getHours() * 60 + now.getMinutes();
      const parse = (s?: string) => {
        if (!s) return null;
        const [h, mi] = s.split(":").map(Number);
        return h * 60 + (mi || 0);
      };
      const from = parse(c.fromHM);
      const to = parse(c.toHM);
      if (from != null && hm < from) return false;
      if (to != null && hm > to) return false;
      return true;
    }
    case "sourceActive":
    case "sourceInactive": {
      // „aktiv"/„inaktiv" bezieht sich auf das Häkchen in der Quellendefinition
      // (enabled), NICHT auf die Momentanleistung. sourceActive ist erfüllt, wenn
      // die Quelle aktiviert ist; sourceInactive, wenn sie deaktiviert ist.
      if (!c.sourceId) return false;
      const disabled = m.disabledSources[c.sourceId] ?? false;
      return c.kind === "sourceActive" ? !disabled : disabled;
    }
    case "sourceOffline": {
      return c.sourceId ? (m.offlineSources[c.sourceId] ?? false) : false;
    }
    case "sourceUnreachable": {
      // Erfüllt, wenn die Quelle seit mindestens forMinutes (Standard 60) Minuten
      // durchgehend wegen Nichterreichbarkeit (Host/Netz) fehlschlägt.
      if (!c.sourceId) return false;
      const min = m.unreachableMinutes[c.sourceId] ?? 0;
      const schwelle = c.forMinutes ?? 60;
      return min >= schwelle;
    }
    case "dailyTrigger": {
      // true genau im ersten Auswertungszyklus eines neuen Kalendertages,
      // basierend allein auf dem persistenten Merker (siehe dailyTriggerDue).
      return dailyTriggerDue(now);
    }
    case "dailyAtTime": {
      // Feuert einmal täglich, sobald die eingestellte Uhrzeit erreicht/über-
      // schritten ist. Nutzt einen regel-/bedingungsspezifischen Tagesmerker,
      // damit pro Tag nur einmal ausgelöst wird. Ideal für „Bericht um 23:59
      // über den heutigen (abgeschlossenen) Tag". Der Merker wird NICHT hier,
      // sondern erst beim tatsächlichen Feuern gesetzt (siehe checkRules), damit
      // reine Status-Auswertungen ihn nicht verbrauchen.
      const at = c.atHM ?? "23:59";
      const [ah, am] = at.split(":").map(Number);
      const target = (ah || 0) * 60 + (am || 0);
      const hm = now.getHours() * 60 + now.getMinutes();
      const today = todayStr(now);
      if (db.getNamedMarker(`dailyAt:${c.id}`) === today) return false; // heute schon
      return hm >= target;
    }
    case "tarifMode": {
      // Erfüllt, wenn das aktuell geltende Tarifmodell dem gewählten entspricht.
      return c.tarifMode != null && m.tarifMode === c.tarifMode;
    }
    case "ctFadeState": {
      // Erfüllt, wenn der CT-Ausfade-Schalter dem erwarteten Zustand entspricht.
      // ctFadeExpected true = erfüllt wenn Ausfaden AN, false/fehlt = wenn AUS.
      const isOn = ctFadeStateProvider();
      const expected = c.ctFadeExpected === true;
      return isOn === expected;
    }
    case "ruleRunning": {
      // Erfüllt, wenn die referenzierte andere Regel gerade läuft (bzw. nicht
      // läuft). Selbstbezug wird ignoriert (immer nicht erfüllt), um triviale
      // Rückkopplungen zu vermeiden.
      if (!c.ruleId) return false;
      const laeuft = getRuleActive(c.ruleId);
      const expected = c.ruleRunningExpected !== false; // Standard: true
      return laeuft === expected;
    }
    case "metric":
    default: {
      const val = metricValue(c.metric, c.sourceId, m);
      if (val == null || c.op == null || c.value == null) return false;
      switch (c.op) {
        case ">": return val > c.value;
        case ">=": return val >= c.value;
        case "<": return val < c.value;
        case "<=": return val <= c.value;
        case "==": return val === c.value;
        case "!=": return val !== c.value;
      }
    }
  }
  return false;
}

function metricValue(metric: RuleMetric | undefined, sourceId: string | undefined, m: RuleMetrics): number | null {
  switch (metric) {
    case "ueberschuss": return m.ueberschuss;
    case "pvPower": return m.pvPower;
    case "gridPower": return m.gridPower;
    case "hausverbrauch": return m.hausverbrauch;
    case "batterySoC": return m.batterySoC;
    case "tankUp": return m.tankUp;
    case "tankDown": return m.tankDown;
    case "spotpreis": return m.spotpreis;
    case "bezugspreisBrutto": return m.bezugspreisBrutto;
    case "drosselVorteilCt": return m.drosselVorteilCt;
    case "wasserverbrauch": return m.wasserverbrauch;
    case "sourcePower": return sourceId ? (m.sourcePower[sourceId] ?? 0) : null;
    default: return null;
  }
}

// Wertet eine Bedingung inkl. forMinutes aus und aktualisiert den Zeitmerker.
function evalConditionTimed(rt: RuleRuntime, c: RuleCondition, m: RuleMetrics, now: Date): boolean {
  // Timer-Bedingung: erfüllt, wenn seit dem Einschalten der Regel mindestens
  // forMinutes vergangen sind. Ist die Regel (noch) nicht aktiv, gibt es keinen
  // laufenden Timer -> nicht erfüllt.
  if (c.kind === "timerElapsed") {
    if (!rt.onSnapshot) return false;
    const mins = c.forMinutes ?? 0;
    if (mins <= 0) return true;
    return now.getTime() - rt.onSnapshot.ts >= mins * 60_000;
  }
  // sourceUnreachable prüft die Dauer bereits selbst (über unreachableMinutes);
  // forMinutes ist dort die Schwelle, KEINE zusätzliche Entprellung. Daher direkt
  // das Instant-Ergebnis verwenden, ohne condSince-Zeitlogik.
  if (c.kind === "sourceUnreachable") {
    return evalConditionInstant(c, m, now);
  }
  const instant = evalConditionInstant(c, m, now);
  if (!c.forMinutes || c.forMinutes <= 0) return instant;
  const nowMs = now.getTime();
  if (!instant) {
    delete rt.condSince[c.id];
    return false;
  }
  if (rt.condSince[c.id] == null) rt.condSince[c.id] = nowMs;
  return nowMs - rt.condSince[c.id] >= c.forMinutes * 60_000;
}

function evalGroup(
  rt: RuleRuntime,
  group: RuleConditionGroup,
  m: RuleMetrics,
  now: Date,
  statusOut: Record<string, boolean>
): boolean {
  const results = group.conditions.map((c) => {
    const r = evalConditionTimed(rt, c, m, now);
    statusOut[c.id] = r;
    return r;
  });
  if (results.length === 0) return false;
  return group.logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

// Hauptaufruf: alle Regeln auswerten. sources dient zum Auflösen von
// Schaltzielen; getSourceEnergyDay liefert den Tagesverbrauch einer Quelle
// (für den Ergebnistext).
export async function evaluateRules(
  rules: AutomationRule[],
  m: RuleMetrics,
  sources: SourceConfig[],
  getSourceEnergyDay: (id: string) => number
): Promise<void> {
  // Provider für manuelles Start/Stop stets mit den aktuellen Werten versorgen.
  getSourceEnergyDayCb = getSourceEnergyDay;
  manualSourcesProvider = () => sources;
  manualMetricsProvider = () => m;
  restoreActiveState();
  const now = new Date();

  for (const rule of rules) {
    // Ablauf prüfen: abgelaufene Regeln automatisch deaktivieren.
    if (rule.enabled && rule.expiresAt) {
      if (new Date(rule.expiresAt).getTime() <= now.getTime()) {
        rule.enabled = false;
        db.addLog(db.LOG_LEVELS.info, "rules", `Regel „${rule.name}" abgelaufen und deaktiviert`);
        // Persistiere die Änderung
        persistDisabled(rule.id);
      }
    }

    if (!runtime[rule.id]) runtime[rule.id] = { active: false, condSince: {} };
    const rt = runtime[rule.id];
    const status: Record<string, boolean> = {};

    // Aktions-Zustände (grüner Punkt in der UI) für prüfbare Aktionen berechnen –
    // unabhängig davon, ob die Regel scharf ist oder welchen Auswertungszweig sie
    // nimmt.
    await computeActionStatus(rule, sources);

    if (!rule.enabled) {
      // Nicht scharf: Status trotzdem berechnen (zur Anzeige), aber nicht schalten.
      evalGroup(rt, rule.onWhen, m, now, status);
      evalGroup(rt, rule.offWhen, m, now, status);
      condStatus[rule.id] = status;
      // Eine NICHT scharfe Regel darf niemals durch die Automatik laufend sein –
      // auch nicht als bedingungslose Schalt-Regel, deren Zielzustand extern
      // erreicht ist. Ein bestehender laufend-Zustand wird hier beendet. AUSNAHME:
      // Wurde die Regel ausdrücklich MANUELL gestartet, bleibt sie laufend (nur
      // manuelles Aktivieren einer nicht scharfen Regel ist zulässig).
      if (rt.active && !rt.startedManually) {
        rt.active = false;
        rt.onSnapshot = undefined;
        rt.watchedSwitches = undefined;
        persistActiveState();
      }
      continue;
    }

    const onOk = evalGroup(rt, rule.onWhen, m, now, status);
    const offOk = evalGroup(rt, rule.offWhen, m, now, status);
    condStatus[rule.id] = status;

    // Flankenerkennung für Regeln ohne Ausschaltbedingung: Sobald die
    // Einschaltbedingung nicht mehr erfüllt ist, wird die Einmal-Sperre
    // zurückgesetzt, sodass beim nächsten Erfüllen erneut ausgelöst wird.
    if (!onOk && rt.firedOnce) rt.firedOnce = false;

    // Aufräumen: Eine Regel ohne Ausschaltbedingung darf nie im laufenden
    // Zustand hängen (Feuer-und-vergiss). Falls sie – etwa durch einen früheren
    // manuellen Start – noch als aktiv markiert ist, hier still beenden (ohne
    // Ausschalt-Aktionen, da es definitionsgemäß keine gibt). Ausgenommen:
    // bedingungslose Schalt-Regeln, die absichtlich laufend bleiben, solange ihr
    // Aktor eingeschaltet ist – sie werden im eigenen Block unten behandelt.
    if (rt.active && rule.offWhen.conditions.length === 0 && !isConditionlessSwitchRule(rule)) {
      rt.active = false;
      rt.onSnapshot = undefined;
      persistActiveState();
    }

    // Sonderfall Tages-Auslöser: enthält die Einschaltgruppe eine dailyTrigger-
    // (Tageswechsel) oder dailyAtTime-Bedingung (feste Uhrzeit), feuert die
    // Aktion einmal pro Tag (Feuer-und-vergiss, ohne Ein/Aus-Zustand). Der
    // jeweilige Tagesmerker wird in der Bedingungsauswertung selbst gesetzt.
    const hasDaily = rule.onWhen.conditions.some(
      (c) => c.kind === "dailyTrigger" || c.kind === "dailyAtTime"
    );
    if (hasDaily) {
      if (onOk) {
        if (rule.onWhen.conditions.some((c) => c.kind === "dailyTrigger")) {
          db.setLastDailyTrigger(todayStr(now));
        }
        // dailyAtTime-Bedingungen für heute als erledigt markieren.
        for (const c of rule.onWhen.conditions) {
          if (c.kind === "dailyAtTime") db.setNamedMarker(`dailyAt:${c.id}`, todayStr(now));
        }
        await runAction(rule, true, sources, m);
        db.addRuleLog(rule.id, rule.name, "on", "Tägliche Auslösung");
      }
      continue;
    }

    // Bedingungslose Zustands-Regel (keine Einschaltbedingung, hat Aktionen mit
    // prüfbarem Zielzustand): Sie gilt erst dann als LAUFEND, wenn ALLE ihre
    // zustandsbehafteten Aktionen ihren Zielzustand erreicht haben (alle Aktoren
    // im Soll UND ggf. CT-Ausfaden aktiv). Erreicht wird das unabhängig davon,
    // wie der Zustand zustande kam (auch extern). So wird sie auf der Startseite
    // als laufend markiert und kann über die Kachel gestoppt werden.
    if (isConditionlessSwitchRule(rule)) {
      const atTarget = await allActionsAtTarget(rule, sources);
      if (!rt.active && atTarget === true) {
        // Gesamter Zielzustand erreicht -> Regel als laufend führen.
        rt.active = true;
        rt.onSnapshot = { ts: Date.now(), tankUp: 0, tankDown: 0, sourceEnergyDay: 0 };
        rt.watchedSwitches = await captureWatchedSwitches(rule, sources);
        db.addRuleLog(rule.id, rule.name, "on",
          "Zielzustand vollständig erreicht – Regel gilt als laufend");
        persistActiveState();
        if (rule.notifyOnActivate) {
          void sendNtfy(`Regel „${rule.name}" gilt als laufend: der Zielzustand ist vollständig erreicht.`, {
            title: "HEMS-Automatisierung", priority: 3, tags: ["gear"],
          });
        }
      } else if (rt.active && atTarget === false) {
        // Mindestens eine Aktion ist nicht mehr im Ziel (z. B. Aktor extern
        // ausgeschaltet oder Ausfaden beendet) -> Regel gilt nicht mehr als
        // laufend. Still beenden, ohne die Ausschalt-Aktionen erneut auszuführen.
        rt.active = false;
        rt.onSnapshot = undefined;
        rt.watchedSwitches = undefined;
        db.addRuleLog(rule.id, rule.name, "off",
          "Zielzustand nicht mehr vollständig erfüllt – Regel nicht mehr laufend");
        persistActiveState();
      }
      condStatus[rule.id] = status;
      // Hat die Regel KEINE Ausschaltbedingung, ist sie mit dieser Behandlung
      // vollständig abgehandelt (laufend/gestoppt rein am Zielzustand). Hat sie
      // dagegen eine Ausschaltbedingung (z. B. einen Timer nach 3 h), soll diese
      // weiter greifen – dann NICHT abbrechen, sondern in die normale Ein/Aus-
      // Auswertung unten übergehen (der Start ist oben bereits erfasst, die
      // Ausschaltbedingung beendet die Regel regulär).
      if (rule.offWhen.conditions.length === 0) continue;
    }


    if (!rt.active && onOk) {
      // Einschalten (Automatik)
      const hasOffConditions = rule.offWhen.conditions.length > 0;
      if (!hasOffConditions) {
        // Regel ohne Ausschaltbedingung: Aktionen einmal ausführen und sofort
        // wieder beenden (Feuer-und-vergiss). Es werden NUR die Einschalt-Aktionen
        // ausgeführt, keine Ausschalt-Aktionen. Die Regel gilt danach nicht als
        // laufend, kann aber erneut auslösen, sobald die Einschaltbedingung nach
        // einem Nicht-Erfüllt-Zwischenzustand wieder zutrifft.
        if (!rt.firedOnce) {
          await runAction(rule, true, sources, m);
          db.addRuleLog(rule.id, rule.name, "on", "Einschaltbedingung erfüllt (ohne Ausschaltbedingung – einmalige Auslösung)");
          rt.firedOnce = true;
          if (rule.notifyOnActivate) {
            void sendNtfy(`Regel „${rule.name}" wurde ausgelöst.`, {
              title: "HEMS-Automatisierung", priority: 3, tags: ["gear"],
            });
          }
        }
      } else {
        await activateRule(rule, sources, m, now, "Einschaltbedingung erfüllt");
      }
    } else if (rt.active && await externalOverrideDetected(rt, sources)) {
      // Ein geschalteter Aktor wurde extern verändert (z. B. manuell über die
      // Hersteller-App zurückgeschaltet). Die Regel wird beendet – ohne die
      // Ausschalt-Aktionen erneut auszuführen, da der Aktor bereits im
      // abweichenden Zustand ist. Vermerk im Protokoll.
      rt.active = false;
      const result = buildResult(rt, m, getSourceEnergyDay);
      db.addRuleLog(rule.id, rule.name, "off",
        `${result} (extern beendet: geschalteter Ausgang wurde von außen zurückgeschaltet)`);
      rt.onSnapshot = undefined;
      rt.watchedSwitches = undefined;
      persistActiveState();
      if (rule.notifyOnActivate) {
        void sendNtfy(`Regel „${rule.name}" wurde beendet, weil ihr Ausgang extern zurückgeschaltet wurde.`, {
          title: "HEMS-Automatisierung", priority: 3, tags: ["gear"],
        });
      }
    } else if (rt.active && offOk) {
      // Ausschalten + Ergebnistext
      const result = buildResult(rt, m, getSourceEnergyDay);
      await deactivateRule(rule, sources, m, result);
    } else if (
      rt.active &&
      typeof rule.autoOffAfterMin === "number" &&
      rule.autoOffAfterMin > 0 &&
      rt.onSnapshot &&
      now.getTime() - rt.onSnapshot.ts >= rule.autoOffAfterMin * 60_000
    ) {
      // Zeitgesteuertes automatisches Ausschalten (unabhängig von offWhen).
      rt.active = false;
      const result = buildResult(rt, m, getSourceEnergyDay);
      await runAction(rule, false, sources);
      db.addRuleLog(rule.id, rule.name, "off", `${result} (Zeitablauf nach ${rule.autoOffAfterMin} min)`);
      rt.onSnapshot = undefined;
      persistActiveState();
    }
  }
}

function buildResult(rt: RuleRuntime, m: RuleMetrics, getSourceEnergyDay: (id: string) => number): string {
  if (!rt.onSnapshot) return "Ausschaltbedingung erfüllt";
  const dtMin = Math.round((Date.now() - rt.onSnapshot.ts) / 60_000);
  // Ohne geschaltetes Zielgerät (z. B. reine Push-Regeln) ergeben kWh-Aufnahme
  // und Speichertemperaturen keinen Sinn – dann nur die Aktivdauer melden.
  if (!rt.onSnapshot.targetId) {
    return `aktiv ${dtMin} min`;
  }
  const parts: string[] = [`aktiv ${dtMin} min`];
  const now = getSourceEnergyDay(rt.onSnapshot.targetId);
  const kwh = Math.max(0, now - rt.onSnapshot.sourceEnergyDay);
  parts.push(`${kwh.toFixed(2)} kWh aufgenommen`);
  // Speichertemperaturen nur, wenn überhaupt ein Warmwasserspeicher Werte liefert.
  const hatSpeicher = m.tankUp > 0 || m.tankDown > 0 || rt.onSnapshot.tankUp > 0 || rt.onSnapshot.tankDown > 0;
  if (hatSpeicher) {
    parts.push(
      `Speicher ${rt.onSnapshot.tankDown.toFixed(0)}/${rt.onSnapshot.tankUp.toFixed(0)} → ${m.tankDown.toFixed(0)}/${m.tankUp.toFixed(0)} °C (unten/oben)`
    );
  }
  return parts.join(", ");
}

async function runAction(rule: AutomationRule, on: boolean, sources: SourceConfig[], m?: RuleMetrics): Promise<void> {
  // Beim Einschalten die onActions ausführen, beim Ausschalten die offActions.
  // Es wird ausschließlich ausgeführt, was explizit hinterlegt ist – kein
  // implizites Zurückschalten von Ausgängen oder Umschalten des Speichers.
  const list: RuleAction[] = (on ? rule.onActions : rule.offActions) ?? [];
  for (const action of list) {
    await runSingleAction(rule, action, on, sources, m);
  }
}

async function runSingleAction(rule: AutomationRule, action: RuleAction, on: boolean, sources: SourceConfig[], m?: RuleMetrics): Promise<void> {
  if (!action) return;
  if (action.type === "notify") {
    const text = interpolateMessage(action.message ?? `Regel „${rule.name}" ausgelöst.`, m);
    await sendNtfy(text, {
      title: "HEMS-Automatisierung",
      priority: 4,
      tags: ["warning"],
    });
  } else if (action.type === "switch" && action.targetSourceId) {
    const src = sources.find((s) => s.id === action.targetSourceId);
    if (src) {
      // Kanal automatisch aus dem JSON-Pfad der Zielquelle ableiten.
      const channel = resolveSwitchChannel(src);
      let toOn: boolean;
      if (action.switchTo === "toggle") {
        // Umschalten: aktuellen Zustand ermitteln und umkehren. Ist der Zustand
        // nicht direkt lesbar, über die Momentanleistung schätzen (an, wenn > 5 W).
        const state = await getSwitchState(src, channel);
        const current = state != null
          ? state
          : Math.abs(m?.sourcePower?.[src.id] ?? 0) > 5;
        toOn = !current;
      } else {
        // Explizit über switchTo, sonst nach Regel-Phase.
        toOn = action.switchTo ? action.switchTo === "on" : on;
      }
      await switchSource(src, channel, toOn);
    }
  } else if (action.type === "timer") {
    // Der Timer startet implizit mit dem Einschalten der Regel (Zeitpunkt in
    // rt.onSnapshot). Die eigentliche Auswertung erfolgt über die Ausschalt-
    // bedingung "timerElapsed". Hier nur ein Protokolleintrag.
    if (on) {
      db.addLog(db.LOG_LEVELS.info, "rules", `Regel „${rule.name}": Timer über ${action.timerMinutes ?? 0} min gestartet`);
    }
  } else if (action.type === "ctfade") {
    // Ausfade-Modus der CT-Senke schalten: AC-Speicher sanft auf 0 fahren
    // (ctFadeOn true) bzw. in den Normalbetrieb zurück (false).
    const fadeOn = action.ctFadeOn === true;
    const ok = ctFadeoutProvider(fadeOn);
    db.addRuleLog(rule.id, rule.name, fadeOn ? "on" : "off",
      ok
        ? (fadeOn ? "CT-Ausfaden aktiviert (AC-Speicher fahren auf 0)" : "CT-Ausfaden beendet (Normalbetrieb)")
        : "CT-Ausfaden nicht möglich – keine aktive CT-Senke gefunden");
  } else if (action.type === "ctnoac") {
    // Modus "kein AC-Laden" der CT-Senke schalten: CT-Wert auf >= 0 begrenzen
    // (ctNoAcChargeOn true) bzw. Normalbetrieb (false).
    const noAcOn = action.ctNoAcChargeOn === true;
    const ok = ctNoAcChargeProvider(noAcOn);
    db.addRuleLog(rule.id, rule.name, noAcOn ? "on" : "off",
      ok
        ? (noAcOn ? "CT 'kein AC-Laden' aktiviert (CT-Wert auf >= 0 begrenzt)" : "CT 'kein AC-Laden' beendet (Normalbetrieb)")
        : "CT 'kein AC-Laden' nicht moeglich - keine aktive CT-Senke gefunden");
  } else if (action.type === "acspeicher" && action.targetSourceId) {
    const src = sources.find((s) => s.id === action.targetSourceId) as any;
    if (!src || src.role !== "acBattery" || src.connection !== "modbus") {
      db.addLog(db.LOG_LEVELS.warn, "rules", `AC-Speicher-Aktion: Quelle ${action.targetSourceId} ist kein Modbus-AC-Speicher`);
      return;
    }
    const host = (src.url || "").replace(/^\w+:\/\//, "").replace(/[/:].*$/, "").trim();
    const port = src.modbusPort ?? 502;
    const unit = src.modbusUnitId ?? 1;
    const timeout = src.timeoutMs ?? 4000;
    try {
      if (on) {
        // Einschalten: gewünschten Force-Modus (laden/entladen/stop) setzen.
        const mode: "charge" | "discharge" | "none" = action.acMode ?? "none";
        const opts: { powerW?: number; toSoc?: number } = {};
        if (mode !== "none") {
          if (typeof action.acPowerW === "number") opts.powerW = action.acPowerW;
          if (typeof action.acToSoc === "number") opts.toSoc = action.acToSoc;
        }
        await setMarstekModbusForce(host, port, unit, timeout, mode, opts);
        const lbl = mode === "charge" ? `Laden${opts.powerW != null ? ` ${opts.powerW} W` : ""}` : mode === "discharge" ? `Entladen${opts.powerW != null ? ` ${opts.powerW} W` : ""}` : "Stop";
        db.addLog(db.LOG_LEVELS.info, "rules", `Regel „${rule.name}": AC-Speicher ${src.label} → ${lbl}`);
      } else {
        // Ausschalten: Speicher in den gewählten Betriebsmodus versetzen
        // (Default Manuell), damit er nicht ungewollt in den Eigenverbrauch
        // zurückfällt.
        const after = isMarstekWorkMode(action.acAfterMode) ? action.acAfterMode : "manual";
        await setMarstekModbusWorkMode(host, port, unit, timeout, after);
        const lbl = after === "manual" ? "Manuell" : after === "selfconsumption" ? "Eigenverbrauch" : "Trade";
        db.addLog(db.LOG_LEVELS.info, "rules", `Regel „${rule.name}": AC-Speicher ${src.label} → Betriebsmodus ${lbl}`);
      }
    } catch (e: any) {
      db.addLog(db.LOG_LEVELS.error, "rules", `Regel „${rule.name}": AC-Speicher-Ansteuerung fehlgeschlagen: ${e?.message ?? e}`);
    }
  }
}

// Zentrale Liste der in Push-Nachrichten verwendbaren Platzhalter mit
// Beschreibung. Wird sowohl für die Ersetzung genutzt als auch – über einen
// API-Endpoint – im Frontend als Info-Liste angezeigt, damit beide immer
// konsistent bleiben.
export const PUSH_VARIABLES: Array<{ key: string; beschreibung: string }> = [
  { key: "datum", beschreibung: "aktuelles Datum" },
  { key: "verbrauch", beschreibung: "Hausverbrauch heute (kWh)" },
  { key: "einspeisung", beschreibung: "Netzeinspeisung heute (kWh)" },
  { key: "kosten", beschreibung: "Stromkosten heute, Bezug − Vergütung (€)" },
  { key: "netzbezug", beschreibung: "aktuelle Netzbezugsleistung (kW)" },
  { key: "pv", beschreibung: "aktuelle PV-Leistung (kW)" },
  { key: "soc", beschreibung: "aktueller Batterie-Ladestand (%)" },
  { key: "spotpreis", beschreibung: "aktueller Börsenstrompreis netto (ct/kWh)" },
  { key: "endpreis", beschreibung: "aktueller Endnutzerpreis brutto (ct/kWh)" },
];

// Ersetzt Platzhalter im Nachrichtentext durch aktuelle Werte (siehe
// PUSH_VARIABLES für die vollständige Liste).
function interpolateMessage(msg: string, m?: RuleMetrics): string {
  if (!msg.includes("{")) return msg;
  const d = new Date();
  const datum = d.toLocaleDateString("de-DE");
  const fmt = (n: number, dec = 2) => n.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const map: Record<string, string> = {
    datum,
    verbrauch: m ? `${fmt(m.tagVerbrauchKwh)} kWh` : "–",
    einspeisung: m ? `${fmt(m.tagEinspeisungKwh)} kWh` : "–",
    kosten: m ? `${fmt(m.tagKostenEuro)} €` : "–",
    pv: m ? `${fmt(m.pvPower / 1000)} kW` : "–",
    soc: m ? `${fmt(m.batterySoC, 0)} %` : "–",
    netzbezug: m ? `${fmt(Math.max(0, m.gridPower) / 1000)} kW` : "–",
    spotpreis: m && m.spotpreis != null ? `${fmt(m.spotpreis)} ct/kWh` : "–",
    endpreis: m && m.bezugspreisBrutto != null ? `${fmt(m.bezugspreisBrutto)} ct/kWh` : "–",
  };
  return msg.replace(/\{(\w+)\}/g, (_, k) => (k in map ? map[k] : `{${k}}`));
}

// Callback zum Persistieren einer automatisch deaktivierten Regel (wird vom
// Poller gesetzt, um Zirkularität mit db zu vermeiden).
let persistDisabled: (ruleId: string) => void = () => {};
export function setPersistDisabled(fn: (ruleId: string) => void): void {
  persistDisabled = fn;
}
