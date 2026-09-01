// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type React from "react";
import { useEffect, useState, useCallback, useRef } from "react";
import { PushVariablesInfoIcon } from "./PushVariablesInfo";

// --- Typen (spiegeln das Backend) ---
type RuleMetric =
  | "ueberschuss" | "pvPower" | "gridPower" | "hausverbrauch"
  | "batterySoC" | "tankUp" | "tankDown" | "spotpreis" | "bezugspreisBrutto" | "drosselVorteilCt" | "wasserverbrauch" | "sourcePower";
type RuleOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

interface RuleCondition {
  id: string;
  kind: "metric" | "time" | "sourceActive" | "sourceInactive" | "sourceOffline" | "sourceUnreachable" | "dailyTrigger" | "dailyAtTime" | "tarifMode" | "timerElapsed" | "ctFadeState" | "ruleRunning";
  metric?: RuleMetric;
  sourceId?: string;
  op?: RuleOp;
  value?: number;
  forMinutes?: number;
  weekdays?: number[];
  fromHM?: string;
  atHM?: string;
  toHM?: string;
  aktivThresholdW?: number;
  tarifMode?: "fix" | "dyn";
  ctFadeExpected?: boolean;
  ruleId?: string;
  ruleRunningExpected?: boolean;
}
interface RuleConditionGroup { logic: "and" | "or"; conditions: RuleCondition[]; }
interface RuleAction { type: "switch" | "notify" | "acspeicher" | "timer" | "ctfade" | "ctnoac"; targetSourceId?: string; channel?: number; switchTo?: "on" | "off" | "toggle"; message?: string; timerMinutes?: number; acMode?: "charge" | "discharge" | "none"; acPowerW?: number; acToSoc?: number; acAfterMode?: "manual" | "selfconsumption" | "trade"; ctFadeOn?: boolean; ctNoAcChargeOn?: boolean; }
interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  groupId?: string;
  onWhen: RuleConditionGroup;
  offWhen: RuleConditionGroup;
  onActions: RuleAction[];
  offActions: RuleAction[];
  autoOffAfterMin?: number;
  notifyOnActivate: boolean;
  showOnOverview?: boolean;
  expiresAt?: string | null;
  active?: boolean;
  conditionStatus?: Record<string, boolean>;
  actionStatus?: Record<string, boolean | null>;
}
interface RuleGroup { id: string; name: string; }
interface Switchable { id: string; label: string; channels: number; }
interface RuleLogEntry { ts: string; ruleId: string; ruleName: string; event: string; result: string; }

const METRIC_LABELS: Record<RuleMetric, string> = {
  ueberschuss: "PV-Überschuss (W)",
  pvPower: "PV-Erzeugung (W)",
  gridPower: "Netz (W, >0 Bezug)",
  hausverbrauch: "Hausverbrauch (W)",
  batterySoC: "Batterie-SoC (%)",
  tankUp: "Speicher oben (°C)",
  tankDown: "Speicher unten (°C)",
  spotpreis: "Börsenstrompreis (ct/kWh)",
  bezugspreisBrutto: "Bezugspreis brutto, dyn. (ct/kWh)",
  drosselVorteilCt: "Vorteil PV-Drosselung (ct/kWh, >0 lohnt)",
  wasserverbrauch: "Wasserverbrauch (L, laufende Viertelstunde)",
  sourcePower: "Leistung einer Quelle (W)",
};
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const uid = () => Math.random().toString(36).slice(2, 10);

function emptyRule(): AutomationRule {
  return {
    id: uid(),
    name: "Neue Regel",
    enabled: false,
    onWhen: { logic: "and", conditions: [] },
    offWhen: { logic: "or", conditions: [] },
    onActions: [{ type: "switch" }],
    offActions: [],
    notifyOnActivate: false,
    expiresAt: null,
  };
}

// --- Bedingungs-Editor ---
function ConditionRow({
  c, sources, consumers, ruleList, status, onChange, onDelete,
}: {
  c: RuleCondition;
  sources: Switchable[];
  consumers: Array<{ id: string; label: string }>;
  ruleList?: Array<{ id: string; name: string }>;
  status?: boolean;
  onChange: (c: RuleCondition) => void;
  onDelete: () => void;
}) {
  const dot = status === undefined ? "gray" : status ? "green" : "red";
  return (
    <div className="rule-cond">
      <span className={`rule-dot rule-dot-${dot}`} title={status === undefined ? "unbekannt" : status ? "erfüllt" : "nicht erfüllt"} />
      <select value={c.kind} onChange={(e) => onChange({ ...c, kind: e.target.value as RuleCondition["kind"] })}>
        <option value="metric">Messwert</option>
        <option value="time">Zeitfenster</option>
        <option value="sourceActive">Quelle aktiviert (Häkchen gesetzt)</option>
        <option value="sourceInactive">Quelle deaktiviert (Häkchen nicht gesetzt)</option>
        <option value="sourceOffline">Quelle offline</option>
        <option value="sourceUnreachable">Quelle nicht erreichbar (Dauer)</option>
        <option value="dailyTrigger">Täglich (Tageswechsel)</option>
        <option value="dailyAtTime">Täglich zu Uhrzeit</option>
        <option value="tarifMode">Tarifmodell</option>
        <option value="timerElapsed">Timer abgelaufen</option>
        <option value="ctFadeState">AC-Ausfaden Zustand</option>
        <option value="ruleRunning">Andere Regel läuft</option>
      </select>

      {c.kind === "metric" && (
        <>
          <select value={c.metric ?? "ueberschuss"} onChange={(e) => onChange({ ...c, metric: e.target.value as RuleMetric })}>
            {Object.entries(METRIC_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {c.metric === "sourcePower" && (
            <select value={c.sourceId ?? ""} onChange={(e) => onChange({ ...c, sourceId: e.target.value })}>
              <option value="">– Quelle –</option>
              {consumers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          <select value={c.op ?? ">"} onChange={(e) => onChange({ ...c, op: e.target.value as RuleOp })}>
            {[">", ">=", "<", "<=", "==", "!="].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input type="number" className="rule-num" value={c.value ?? 0} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} />
          <label className="rule-for">für ≥
            <input type="number" className="rule-num-sm" value={c.forMinutes ?? 0} onChange={(e) => onChange({ ...c, forMinutes: Number(e.target.value) })} /> min
          </label>
        </>
      )}

      {c.kind === "time" && (
        <>
          <div className="rule-wd">
            {WD.map((d, i) => (
              <button key={i} type="button"
                className={(c.weekdays ?? []).includes(i) ? "wd on" : "wd"}
                onClick={() => {
                  const set = new Set(c.weekdays ?? []);
                  set.has(i) ? set.delete(i) : set.add(i);
                  onChange({ ...c, weekdays: [...set].sort() });
                }}>{d}</button>
            ))}
          </div>
          <input type="time" value={c.fromHM ?? "00:00"} onChange={(e) => onChange({ ...c, fromHM: e.target.value })} />
          <span>–</span>
          <input type="time" value={c.toHM ?? "23:59"} onChange={(e) => onChange({ ...c, toHM: e.target.value })} />
        </>
      )}

      {c.kind === "dailyAtTime" && (
        <label className="rule-for">täglich um
          <input type="time" value={c.atHM ?? "23:59"} onChange={(e) => onChange({ ...c, atHM: e.target.value })} style={{ marginLeft: 6 }} />
          <span className="hint" style={{ marginLeft: 6 }}>Uhr (löst einmal pro Tag aus)</span>
        </label>
      )}

      {(c.kind === "sourceActive" || c.kind === "sourceInactive") && (
        <>
          <select value={c.sourceId ?? ""} onChange={(e) => onChange({ ...c, sourceId: e.target.value })}>
            <option value="">– Quelle –</option>
            {consumers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <span className="rule-hint-inline">
            {c.kind === "sourceActive"
              ? "erfüllt, wenn die Quelle aktiviert ist (Häkchen gesetzt)"
              : "erfüllt, wenn die Quelle deaktiviert ist (Häkchen nicht gesetzt)"}
          </span>
        </>
      )}

      {c.kind === "sourceOffline" && (
        <select value={c.sourceId ?? ""} onChange={(e) => onChange({ ...c, sourceId: e.target.value })}>
          <option value="">– Quelle –</option>
          {consumers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}

      {c.kind === "sourceUnreachable" && (
        <>
          <select value={c.sourceId ?? ""} onChange={(e) => onChange({ ...c, sourceId: e.target.value })}>
            <option value="">– Quelle –</option>
            {consumers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <label className="rule-for">nicht erreichbar seit ≥
            <input type="number" className="rule-num-sm" value={c.forMinutes ?? 60} onChange={(e) => onChange({ ...c, forMinutes: Number(e.target.value) })} /> min
          </label>
        </>
      )}

      {c.kind === "dailyTrigger" && (
        <span className="rule-for">löst einmal täglich beim Tageswechsel aus</span>
      )}

      {c.kind === "tarifMode" && (
        <>
          <span className="rule-for">Stromtarif ist</span>
          <select value={c.tarifMode ?? "dyn"} onChange={(e) => onChange({ ...c, tarifMode: e.target.value as "fix" | "dyn" })}>
            <option value="dyn">dynamisch (Börsenpreis)</option>
            <option value="fix">Festpreis</option>
          </select>
        </>
      )}

      {c.kind === "timerElapsed" && (
        <label className="rule-for">seit dem Einschalten sind
          <input type="number" className="rule-num-sm" min={0} step={1}
            value={c.forMinutes ?? 0} onChange={(e) => onChange({ ...c, forMinutes: Number(e.target.value) })} /> min vergangen
        </label>
      )}

      {c.kind === "ctFadeState" && (
        <>
          <span className="rule-for">AC-Ausfaden ist</span>
          <select value={c.ctFadeExpected === true ? "on" : "off"}
            onChange={(e) => onChange({ ...c, ctFadeExpected: e.target.value === "on" })}>
            <option value="on">aktiv (Speicher fahren auf 0)</option>
            <option value="off">inaktiv (Normalbetrieb)</option>
          </select>
        </>
      )}

      {c.kind === "ruleRunning" && (
        <>
          <span className="rule-for">Regel</span>
          <select value={c.ruleId ?? ""} onChange={(e) => onChange({ ...c, ruleId: e.target.value })}>
            <option value="">– Regel –</option>
            {(ruleList ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={c.ruleRunningExpected === false ? "no" : "yes"}
            onChange={(e) => onChange({ ...c, ruleRunningExpected: e.target.value === "yes" })}>
            <option value="yes">läuft</option>
            <option value="no">läuft nicht</option>
          </select>
        </>
      )}

      <button className="rule-del-cond" onClick={onDelete} title="Bedingung löschen">✕</button>
    </div>
  );
}

function ConditionGroupEditor({
  title, group, sources, consumers, ruleList, status, onChange,
}: {
  title: string;
  group: RuleConditionGroup;
  sources: Switchable[];
  consumers: Array<{ id: string; label: string }>;
  ruleList?: Array<{ id: string; name: string }>;
  status?: Record<string, boolean>;
  onChange: (g: RuleConditionGroup) => void;
}) {
  const addCond = () => onChange({ ...group, conditions: [...group.conditions, { id: uid(), kind: "metric", metric: "ueberschuss", op: ">", value: 0 }] });
  return (
    <div className="rule-group">
      <div className="rule-group-head">
        <strong>{title}</strong>
        <div className="rule-logic">
          <button type="button" className={group.logic === "and" ? "on" : ""} onClick={() => onChange({ ...group, logic: "and" })}>UND</button>
          <button type="button" className={group.logic === "or" ? "on" : ""} onClick={() => onChange({ ...group, logic: "or" })}>ODER</button>
        </div>
      </div>
      {group.conditions.map((c) => (
        <ConditionRow key={c.id} c={c} sources={sources} consumers={consumers} ruleList={ruleList} status={status?.[c.id]}
          onChange={(nc) => onChange({ ...group, conditions: group.conditions.map((x) => x.id === c.id ? nc : x) })}
          onDelete={() => onChange({ ...group, conditions: group.conditions.filter((x) => x.id !== c.id) })} />
      ))}
      <button className="rule-add-cond" onClick={addCond}>+ Bedingung</button>
    </div>
  );
}

function ActionEditor({ action, sources, acSpeicher, onChange, allowEmpty, onClear, phase, status }: {
  action: RuleAction | undefined;
  sources: Switchable[];
  acSpeicher: Array<{ id: string; label: string }>;
  onChange: (a: RuleAction) => void;
  allowEmpty?: boolean;
  onClear?: () => void;
  phase?: "on" | "off";
  status?: boolean | null;
}) {
  const a = action ?? { type: "switch" as const };
  const tgt = sources.find((s) => s.id === a.targetSourceId);
  // Zustandspunkt nur für prüfbare Aktionen (switch on/off, ctfade). status:
  // true = Zielzustand erreicht (grün), false = nicht erreicht (rot),
  // null = gerade nicht lesbar (grau/?). undefined = kein prüfbarer Zustand.
  const checkable = (a.type === "switch" && (a.switchTo === "on" || a.switchTo === "off")) || a.type === "ctfade" || a.type === "ctnoac";
  const dot = !checkable ? null : status === undefined || status === null ? "gray" : status ? "green" : "red";
  return (
    <div className="rule-action">
      {dot && (
        <span className={`rule-dot rule-dot-${dot}`}
          title={status === true ? "Zielzustand erreicht" : status === false ? "Zielzustand nicht erreicht" : "Zustand unbekannt"} />
      )}
      <select value={a.type} onChange={(e) => {
        const nt = e.target.value as RuleAction["type"];
        // Bei Wechsel auf ctfade ein sauberes Objekt setzen (explizites ctFadeOn,
        // kein switchTo/targetSourceId, die für ctfade bedeutungslos sind und die
        // Interpretation stören). phase "off" -> sinnvoller Default "einschalten".
        if (nt === "ctfade") { onChange({ type: "ctfade", ctFadeOn: phase === "off" }); return; }
        if (nt === "ctnoac") { onChange({ type: "ctnoac", ctNoAcChargeOn: phase !== "off" }); return; }
        // Von ctfade/ctnoac weg: die spezifischen Felder entfernen.
        const { ctFadeOn, ctNoAcChargeOn, ...rest } = a;
        onChange({ ...rest, type: nt });
      }}>
        <option value="switch">Ausgang schalten</option>
        <option value="notify">Push-Nachricht</option>
        <option value="acspeicher">AC-Speicher steuern (Modbus)</option>
        <option value="timer">Timer starten</option>
        <option value="ctfade">AC-Speicher ausfaden (CT auf 0)</option>
        <option value="ctnoac">AC-Speicher kein AC-Laden (CT ≥ 0)</option>
      </select>
      {a.type === "switch" && (
        <>
          <select value={a.targetSourceId ?? ""} onChange={(e) => onChange({ ...a, targetSourceId: e.target.value })}>
            <option value="">– schaltbare Quelle –</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {tgt && tgt.channels > 1 && (
            <select value={a.channel ?? 0} onChange={(e) => onChange({ ...a, channel: Number(e.target.value) })}>
              {Array.from({ length: tgt.channels }, (_, i) => <option key={i} value={i}>Kanal {i + 1}</option>)}
            </select>
          )}
          <select value={a.switchTo ?? (phase === "off" ? "off" : "on")}
            onChange={(e) => onChange({ ...a, switchTo: e.target.value as "on" | "off" | "toggle" })}
            title="Schaltrichtung dieser Aktion. Umschalten prüft den aktuellen Zustand und kehrt ihn um.">
            <option value="on">einschalten</option>
            <option value="off">ausschalten</option>
            <option value="toggle">umschalten</option>
          </select>
        </>
      )}
      {a.type === "notify" && (
        <>
          <input className="rule-msg" placeholder="Nachrichtentext – Platzhalter wie {pv}, {soc}, {spotpreis}" value={a.message ?? ""} onChange={(e) => onChange({ ...a, message: e.target.value })} />
          <PushVariablesInfoIcon />
        </>
      )}
      {a.type === "timer" && (
        <label className="rule-for">Dauer
          <input type="number" className="rule-num-sm" min={1} step={1}
            value={a.timerMinutes ?? 30} onChange={(e) => onChange({ ...a, timerMinutes: Math.max(1, Number(e.target.value)) })} /> min
          <span className="hint"> — in den Ausschaltbedingungen mit „Timer abgelaufen" abfragbar</span>
        </label>
      )}
      {a.type === "ctfade" && (
        <>
          <select value={a.ctFadeOn === true ? "on" : "off"}
            onChange={(e) => onChange({ type: "ctfade", ctFadeOn: e.target.value === "on" })}
            title="Ein: AC-Speicher sanft auf 0 fahren. Aus: zurück in den Normalbetrieb.">
            <option value="on">Ausfaden einschalten</option>
            <option value="off">Ausfaden beenden (Normalbetrieb)</option>
          </select>
          <span className="hint"> — fährt die per CT gesteuerten AC-Speicher schrittweise auf 0 W (bzw. zurück)</span>
        </>
      )}
      {a.type === "ctnoac" && (
        <>
          <select value={a.ctNoAcChargeOn === true ? "on" : "off"}
            onChange={(e) => onChange({ type: "ctnoac", ctNoAcChargeOn: e.target.value === "on" })}
            title="Ein: gelieferten CT-Wert auf >= 0 begrenzen (kein Laden über CT). Aus: Normalbetrieb.">
            <option value="on">Kein AC-Laden einschalten</option>
            <option value="off">Kein AC-Laden beenden (Normalbetrieb)</option>
          </select>
          <span className="hint"> — begrenzt den CT-Wert auf ≥ 0, damit die AC-Speicher nicht über den CT geladen werden</span>
        </>
      )}
      {a.type === "acspeicher" && (
        <div className="rule-ac-action">
          <select value={a.targetSourceId ?? ""} onChange={(e) => onChange({ ...a, targetSourceId: e.target.value })}>
            <option value="">– AC-Speicher (Modbus) –</option>
            {acSpeicher.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={a.acMode ?? "charge"} onChange={(e) => onChange({ ...a, acMode: e.target.value as RuleAction["acMode"] })}>
            <option value="charge">Laden</option>
            <option value="discharge">Entladen</option>
            <option value="none">Nur stoppen</option>
          </select>
          {(a.acMode ?? "charge") !== "none" && (
            <label className="rule-ac-pow">Leistung
              <input type="number" min={0} step={100} value={a.acPowerW ?? 200}
                onChange={(e) => onChange({ ...a, acPowerW: Number(e.target.value) })} /> W
            </label>
          )}
          {(a.acMode ?? "charge") === "charge" && (
            <label className="rule-ac-pow">bis SoC
              <input type="number" min={0} max={100} step={5} value={a.acToSoc ?? 100}
                onChange={(e) => onChange({ ...a, acToSoc: Number(e.target.value) })} /> %
            </label>
          )}
          {!allowEmpty && (
            <label className="rule-ac-pow" style={{ flexBasis: "100%" }}>
              Danach umschalten auf
              <select value={a.acAfterMode ?? "manual"} onChange={(e) => onChange({ ...a, acAfterMode: e.target.value as RuleAction["acAfterMode"] })}>
                <option value="manual">Manuell (keine Automatik)</option>
                <option value="selfconsumption">Eigenverbrauch (Smart Meter)</option>
                <option value="trade">Trade / dynamisch</option>
              </select>
            </label>
          )}
          {acSpeicher.length === 0 && (
            <span className="hint">Keine Modbus-AC-Speicher konfiguriert.</span>
          )}
        </div>
      )}
      {allowEmpty && onClear && <button className="rule-del-cond" onClick={onClear} title="Aktion entfernen">✕</button>}
    </div>
  );
}

// Verwaltet eine Liste von Aktionen (mehrere möglich): jede über einen
// ActionEditor, mit „+ Aktion"-Knopf und Entfernen je Zeile. Alle Aktionen der
// Liste werden bei der jeweiligen Phase (Ein-/Ausschalten) ausgeführt.
function ActionListEditor({ title, phase, actions, sources, acSpeicher, onChange, actionStatus }: {
  title: string;
  phase: "on" | "off";
  actions: RuleAction[];
  sources: Switchable[];
  acSpeicher: Array<{ id: string; label: string }>;
  onChange: (list: RuleAction[]) => void;
  actionStatus?: Record<string, boolean | null>;
}) {
  const list = actions ?? [];
  const setAt = (i: number, a: RuleAction) => onChange(list.map((x, j) => j === i ? a : x));
  const removeAt = (i: number) => onChange(list.filter((_, j) => j !== i));
  const addAction = () => onChange([...list, { type: "switch", switchTo: phase === "off" ? "off" : "on" }]);
  return (
    <div className="rule-group">
      <div className="rule-group-head">
        <strong>{title}</strong>
      </div>
      {list.map((a, i) => (
        <ActionEditor key={i} phase={phase}
          action={a} sources={sources} acSpeicher={acSpeicher}
          status={actionStatus?.[`${phase}:${i}`]}
          onChange={(na) => setAt(i, na)}
          allowEmpty onClear={() => removeAt(i)} />
      ))}
      <button className="rule-add-cond" onClick={addAction}>+ Aktion</button>
    </div>
  );
}

function RuleCard({ rule, sources, acSpeicher, consumers, ruleList, onChange, onDelete, onManualTrigger,
  onDragStart, onDragOver, onDrop, onDragEnd, dragging, dragOver }: {
  rule: AutomationRule;
  sources: Switchable[];
  acSpeicher: Array<{ id: string; label: string }>;
  consumers: Array<{ id: string; label: string }>;
  ruleList?: Array<{ id: string; name: string }>;
  onChange: (r: AutomationRule) => void;
  onDelete: () => void;
  onManualTrigger: (start: boolean) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  dragging: boolean;
  dragOver: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rule-card${rule.enabled ? " armed" : ""}${rule.active ? " running" : ""}${dragging ? " rule-dragging" : ""}${dragOver ? " rule-dragover" : ""}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="rule-card-head">
        <span
          className="rule-drag-handle"
          title="Ziehen, um die Reihenfolge zu ändern"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >⠿</span>
        <span className={`rule-active-badge${rule.active ? " on" : ""}`} title={rule.active ? "aktuell aktiv" : "inaktiv"} />
        <input className="rule-name" value={rule.name} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
        <button
          className={`rule-runbtn${rule.active ? " stop" : ""}`}
          onClick={() => onManualTrigger(!rule.active)}
          title={rule.active
            ? "Regel jetzt manuell stoppen (führt die Ausschalt-Aktionen aus)"
            : "Regel jetzt manuell starten – unabhängig von den Einschaltbedingungen"}
        >{rule.active ? "⏹" : "▶"}</button>
        <label className="rule-arm">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => onChange({ ...rule, enabled: e.target.checked })} />
          scharf
        </label>
        <label className="rule-arm" title="Diese Regel als Kachel auf der Übersichtsseite anzeigen (nur während sie läuft)">
          <input type="checkbox" checked={rule.showOnOverview === true} onChange={(e) => onChange({ ...rule, showOnOverview: e.target.checked })} />
          Übersicht
        </label>
        <button className="rule-expand" onClick={() => setOpen((o) => !o)}>{open ? "▲" : "▼"}</button>
        <button className="rule-del" onClick={onDelete} title="Regel löschen">🗑</button>
      </div>
      {open && (
        <div className="rule-body">
          <ConditionGroupEditor title="Einschalten wenn" group={rule.onWhen} sources={sources} consumers={consumers} ruleList={ruleList} status={rule.conditionStatus}
            onChange={(g) => onChange({ ...rule, onWhen: g })} />
          <ActionListEditor title="Aktionen beim Einschalten" phase="on"
            actions={rule.onActions} sources={sources} acSpeicher={acSpeicher}
            actionStatus={rule.actionStatus}
            onChange={(list) => onChange({ ...rule, onActions: list })} />
          <ConditionGroupEditor title="Ausschalten wenn" group={rule.offWhen} sources={sources} consumers={consumers} ruleList={ruleList} status={rule.conditionStatus}
            onChange={(g) => onChange({ ...rule, offWhen: g })} />
          <ActionListEditor title="Aktionen beim Ausschalten" phase="off"
            actions={rule.offActions} sources={sources} acSpeicher={acSpeicher}
            actionStatus={rule.actionStatus}
            onChange={(list) => onChange({ ...rule, offActions: list })} />
          <p className="hint rule-offhint">
            Es werden nur die hier hinterlegten Aktionen ausgeführt. Um einen
            Ausgang beim Ausschalten wieder abzuschalten, hier bewusst eine
            „Ausgang schalten"-Aktion mit „ausschalten" hinzufügen. Für eine feste
            Laufzeit eine „Timer starten"-Aktion beim Einschalten ergänzen und in
            den Ausschaltbedingungen „Timer abgelaufen" prüfen.
          </p>
          <div className="rule-opts">
            <label>Ablauf:
              <input type="datetime-local" value={rule.expiresAt ? rule.expiresAt.slice(0, 16) : ""}
                onChange={(e) => onChange({ ...rule, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </label>
            {rule.expiresAt && (
              <button type="button" className="rule-expire-clear"
                onClick={() => onChange({ ...rule, expiresAt: null })}
                title="Ablaufdatum entfernen">Ablauf entfernen</button>
            )}
          </div>
          <p className="hint rule-expire-hint">
            Ablauf: Optionaler Zeitpunkt, ab dem die Regel sich selbst
            <strong> scharf-aus</strong> schaltet (Häkchen „scharf" wird entfernt).
            Danach prüft sie nicht mehr und löst nicht mehr aus, bis du sie wieder
            scharf schaltest. Nützlich für befristete Regeln, z. B. „nur bis
            Monatsende aktiv". Leer lassen = unbefristet.
          </p>
        </div>
      )}
    </div>
  );
}

export function AutomatisierungPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  const [sources, setSources] = useState<Switchable[]>([]);
  const [acSpeicher, setAcSpeicher] = useState<Array<{ id: string; label: string }>>([]);
  const [consumers, setConsumers] = useState<Array<{ id: string; label: string }>>([]);
  const [log, setLog] = useState<RuleLogEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  // dirty steuert nur die „ungespeicherte Änderungen"-Anzeige. Die eigentliche
  // Absicherung gegen Überschreiben liegt darin, dass der periodische Poll
  // (loadRuleStatus) NUR Laufzeit-Felder mergt und die Regel-Struktur nie anfasst.
  const dirtyRef = useRef(false);
  function markDirty(v: boolean) { dirtyRef.current = v; setDirty(v); }

  // Vollständiges Laden der Regel-Struktur vom Server (Name, Aktionen,
  // Bedingungen). Nur beim ersten Laden und direkt nach dem Speichern – NICHT im
  // periodischen Poll, damit laufende Bearbeitungen nie überschrieben werden.
  const loadRulesFull = useCallback(() => {
    fetch("/api/rules").then((r) => r.json()).then((d: AutomationRule[]) => {
      setRules(d);
    }).catch(() => {});
  }, []);

  // Periodische Aktualisierung: NUR die Laufzeit-Felder (active,
  // conditionStatus) in die vorhandenen lokalen Regeln mergen. Die Struktur
  // (Name, Aktionen, Bedingungen, Gruppen) bleibt unangetastet – so kann der
  // Poll weder ungespeicherte noch frisch gespeicherte Änderungen zurückdrehen.
  const loadRuleStatus = useCallback(() => {
    fetch("/api/rules").then((r) => r.json()).then((d: AutomationRule[]) => {
      setRules((prev) => prev.map((p) => {
        const srv = d.find((x) => x.id === p.id);
        return srv ? { ...p, active: srv.active, conditionStatus: srv.conditionStatus, actionStatus: srv.actionStatus } : p;
      }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/switchable").then((r) => r.json()).then(setSources).catch(() => {});
    fetch("/api/acspeicher/modbus-list").then((r) => r.json()).then(setAcSpeicher).catch(() => {});
    // Alle Quellen (für Quellen-Bedingungen: aktiv/inaktiv/offline, Leistung).
    fetch("/api/sources").then((r) => r.json()).then((arr: any[]) => {
      setConsumers(arr.map((s) => ({ id: s.id, label: s.label })));
    }).catch(() => {});
    fetch("/api/rule-groups").then((r) => r.json()).then((g: RuleGroup[]) => {
      setGroups(Array.isArray(g) ? g : []);
    }).catch(() => {});
    loadRulesFull();
    fetch("/api/rules/log?limit=50").then((r) => r.json()).then(setLog).catch(() => {});
  }, []);

  // Live-Status regelmäßig aktualisieren (Ampeln + aktiv-Badge + Log).
  useEffect(() => {
    const t = setInterval(() => {
      loadRuleStatus();
      fetch("/api/rules/log?limit=50").then((r) => r.json()).then(setLog).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [loadRuleStatus]);

  function update(r: AutomationRule) {
    setRules((prev) => prev.map((x) => x.id === r.id ? r : x));
    markDirty(true);
  }
  function add(groupId?: string) {
    setRules((prev) => [...prev, { ...emptyRule(), groupId }]);
    markDirty(true);
  }
  function del(id: string) { setRules((prev) => prev.filter((x) => x.id !== id)); markDirty(true); }

  // Regel manuell starten/stoppen (unabhängig von Bedingungen). Danach nur den
  // Laufzeit-Status neu laden (nicht die Struktur – schützt Bearbeitungen).
  function manualTrigger(id: string, start: boolean) {
    fetch(`/api/rules/${id}/trigger`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start }),
    }).then(() => loadRuleStatus()).catch(() => {});
  }

  // --- Gruppen-Verwaltung ---
  function addGroup() {
    setGroups((prev) => [...prev, { id: uid(), name: "Neue Gruppe" }]);
    markDirty(true);
  }
  function renameGroup(id: string, name: string) {
    setGroups((prev) => prev.map((g) => g.id === id ? { ...g, name } : g));
    markDirty(true);
  }
  function deleteGroup(id: string) {
    // Regeln der Gruppe werden nicht gelöscht, sondern in "ohne Gruppe" gestellt.
    setRules((prev) => prev.map((r) => r.groupId === id ? { ...r, groupId: undefined } : r));
    setGroups((prev) => prev.filter((g) => g.id !== id));
    markDirty(true);
  }

  // --- Drag & Drop: umsortieren innerhalb + zwischen Gruppen ---
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | "none" | null>(null);

  // Regel VOR eine Zielregel einsortieren und deren Gruppe übernehmen.
  function dropOnRule(targetId: string) {
    if (dragId == null || dragId === targetId) { resetDrag(); return; }
    setRules((prev) => {
      const from = prev.findIndex((r) => r.id === dragId);
      const to = prev.findIndex((r) => r.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const targetGroupId = prev[to].groupId;
      const insertAt = next.findIndex((r) => r.id === targetId);
      next.splice(insertAt, 0, { ...moved, groupId: targetGroupId });
      return next;
    });
    markDirty(true);
    resetDrag();
  }
  // Regel ans Ende einer Gruppe (oder "ohne Gruppe") hängen.
  function dropOnGroup(groupId: string | undefined) {
    if (dragId == null) { resetDrag(); return; }
    setRules((prev) => {
      const from = prev.findIndex((r) => r.id === dragId);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.push({ ...moved, groupId });
      return next;
    });
    markDirty(true);
    resetDrag();
  }
  function resetDrag() { setDragId(null); setOverId(null); setOverGroup(null); }

  async function save() {
    // conditionStatus/active vor dem Speichern entfernen (reine Laufzeitfelder)
    const clean = rules.map(({ conditionStatus, active, ...r }) => r);
    await Promise.all([
      fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: clean }) }),
      fetch("/api/rule-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groups }) }),
    ]);
    setSaved(true); markDirty(false);
    setTimeout(() => setSaved(false), 2500);
    loadRulesFull();
  }

  return (
    <div className="page">
      <h2>Automatisierungsregeln</h2>
      <p className="hint">
        Regeln schalten Ausgänge oder senden Nachrichten, wenn ihre
        Einschaltbedingungen erfüllt sind, und beenden das wieder bei den
        Ausschaltbedingungen. Der farbige Punkt vor jeder Bedingung zeigt live, ob
        sie gerade erfüllt (grün) oder nicht erfüllt (rot) ist. Nur
        <strong> scharfgeschaltete</strong> Regeln schalten tatsächlich.
      </p>

      {(() => {
        const renderRule = (r: AutomationRule) => (
          <RuleCard key={r.id} rule={r} sources={sources} acSpeicher={acSpeicher} consumers={consumers}
            ruleList={rules.filter((x) => x.id !== r.id).map((x) => ({ id: x.id, name: x.name }))}
            onChange={update} onDelete={() => del(r.id)}
            onManualTrigger={(start) => manualTrigger(r.id, start)}
            onDragStart={() => setDragId(r.id)}
            onDragOver={(e) => { e.preventDefault(); if (overId !== r.id) setOverId(r.id); }}
            onDrop={() => dropOnRule(r.id)}
            onDragEnd={resetDrag}
            dragging={dragId === r.id}
            dragOver={overId === r.id && dragId !== r.id} />
        );
        // Reihenfolge der Anzeige: definierte Gruppen (in Gruppen-Reihenfolge),
        // danach eine Sektion für Regeln ohne Gruppe (falls vorhanden).
        const groupSections = groups.map((g) => ({ g, rules: rules.filter((r) => r.groupId === g.id) }));
        const ungrouped = rules.filter((r) => !r.groupId || !groups.some((g) => g.id === r.groupId));

        const groupBox = (
          key: string,
          title: React.ReactNode,
          groupId: string | undefined,
          list: AutomationRule[]
        ) => (
          <div
            key={key}
            className={`rule-group-box${overGroup === (groupId ?? "none") ? " rule-group-dragover" : ""}`}
            onDragOver={(e) => { e.preventDefault(); if (overGroup !== (groupId ?? "none")) setOverGroup(groupId ?? "none"); }}
            onDrop={() => dropOnGroup(groupId)}
          >
            {title}
            <div className="rule-list">
              {list.map(renderRule)}
              {list.length === 0 && <p className="hint rule-group-empty">Regeln hierher ziehen …</p>}
            </div>
            <button className="rule-group-add" onClick={() => add(groupId)}>+ Regel in dieser Gruppe</button>
          </div>
        );

        return (
          <div className="rule-groups">
            {groupSections.map(({ g, rules: list }) =>
              groupBox(
                g.id,
                <div className="rule-group-title">
                  <input className="rule-group-name" value={g.name}
                    onChange={(e) => renameGroup(g.id, e.target.value)} />
                  <span className="rule-group-count">{list.length}</span>
                  <button className="rule-group-del" title="Gruppe löschen (Regeln bleiben erhalten)"
                    onClick={() => { if (confirm(`Gruppe „${g.name}" löschen? Die Regeln bleiben erhalten und werden „ohne Gruppe" zugeordnet.`)) deleteGroup(g.id); }}>🗑</button>
                </div>,
                g.id,
                list
              )
            )}
            {(ungrouped.length > 0 || groups.length === 0) &&
              groupBox(
                "__none__",
                <div className="rule-group-title">
                  <span className="rule-group-name-static">Ohne Gruppe</span>
                  <span className="rule-group-count">{ungrouped.length}</span>
                </div>,
                undefined,
                ungrouped
              )}
          </div>
        );
      })()}

      <div className="rule-actions">
        <button onClick={() => add()}>+ Regel hinzufügen</button>
        <button onClick={addGroup}>+ Gruppe</button>
        <button onClick={save} className="ie-primary">Speichern</button>
        {saved && <span className="src-testok">✓ gespeichert</span>}
        {dirty && !saved && <span className="rule-dirty">ungespeicherte Änderungen</span>}
      </div>

      <section className="card">
        <h3>Protokoll</h3>
        <p className="hint">Wann welche Regel ausgelöst wurde und mit welchem Ergebnis.</p>
        {log.length === 0 && <p className="hint">Noch keine Einträge.</p>}
        {log.length > 0 && (
          <div className="table-scroll">
          <table className="rule-log">
            <thead><tr><th>Zeit</th><th>Regel</th><th>Ereignis</th><th>Ergebnis</th></tr></thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.ts).toLocaleString("de-DE")}</td>
                  <td>{e.ruleName}</td>
                  <td>{e.event === "on" ? "Ein" : "Aus"}</td>
                  <td>{e.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
