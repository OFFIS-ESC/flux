// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useRef, useState } from "react";
import { nf } from "./chartUtils";
import { ExtHemsConfig } from "./ExtHemsConfig";

interface SinkOffset {
  sourceId: string;
  factor: number;
  onlyPositive: boolean;
}
interface Sink {
  id: string;
  name: string;
  sinkRole?: "meter" | "extHems";
  baseSourceId: string;
  baseFactor: number;
  offsets: SinkOffset[];
  include42c: boolean;
  maxPowerW: number;
  maxPower42cW?: number;
  enabled: boolean;
  useDiscovery: boolean;
  emulatedMeter?: "pro3em" | "proem50" | "emg3" | "ct002" | "ct003";
  ctMac?: string;
  batteryMac?: string;
  targetOffsetW?: number;
  ctWeights?: Array<{ ip: string; weight: number }>;
  ctDeadbandW?: number;
  ctMaxStepW?: number;
  ctBalanceStepW?: number;
  ctBalanceToleranceW?: number;
  ctFadeout?: boolean;
  ctNoAcCharge?: boolean;
  ctAlternierendeEntladung?: boolean;
  ctFadeStepW?: number;
  formula?: string;
  // extHems-Felder (Datenbereitstellung an externes HEMS)
  mqttUrl?: string;
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientCert?: string;
  mqttClientKey?: string;
  mqttCaCert?: string;
  mqttRejectUnauthorized?: boolean;
  extHemsTopics?: ExtHemsPublishTopic[];
  extHemsFormeln?: ExtHemsFormelGroesse[];
  extHemsChangeThreshold?: number;
}
interface ExtHemsPublishTopic {
  topic: string;
  groessen: string[];
  retain?: boolean;
}
interface ExtHemsFormelGroesse {
  id: string;
  name: string;
  einheit: string;
  formel: string;
}
interface FormulaVar {
  name: string;
  desc: string;
}
interface CtBalancerConsumer {
  ip: string;
  phase: string;
  reportedPower: number;
  targetShare: number;
  reading: number;
  weight: number;
  ageMs: number;
  capChargeW: number | null;
  capDischargeW: number | null;
  aktiv: boolean;
}
interface CtBalancerSnapshot {
  active: boolean;
  fadeout: boolean;
  gridReading: number;
  gesamtIst: number;
  gesamtZiel: number;
  aktiverIp: string | null;
  consumers: CtBalancerConsumer[];
}
interface NetzQuelle {
  id: string;
  label: string;
  enabled: boolean;
}
interface AlleQuelle {
  id: string;
  label: string;
  role: string;
  enabled: boolean;
}
interface SinkStatus {
  id: string;
  name: string;
  baseSourceId: string;
  baseSourceLabel: string;
  enabled: boolean;
  outputPowerW: number;
  eigenBezugW: number;
  abnehmerBezugW: number;
  lastUpdate: string | null;
}


export function SenkenPage() {
  const [sinks, setSinks] = useState<Sink[]>([]);
  // Ein-/ausklappbare Senken-Boxen. Default: alle eingeklappt (ID nicht im Set).
  const [expandedSinks, setExpandedSinks] = useState<Set<string>>(new Set());
  function toggleSink(id: string) {
    setExpandedSinks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const [netzQuellen, setNetzQuellen] = useState<NetzQuelle[]>([]);
  const [alleQuellen, setAlleQuellen] = useState<AlleQuelle[]>([]);
  const [status, setStatus] = useState<SinkStatus[]>([]);
  const [ctBalancer, setCtBalancer] = useState<CtBalancerSnapshot | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  // dirtyRef spiegelt dirty, damit das periodische load() den aktuellen Wert
  // synchron lesen kann, ohne setState-Verschachtelung.
  function markDirty(v: boolean) { dirtyRef.current = v; setDirty(v); }
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formulaVars, setFormulaVars] = useState<FormulaVar[]>([]);
  // Live-Prüfergebnis je Senke: { ok, value, error, usedVars }
  const [formulaCheck, setFormulaCheck] = useState<Record<string, any>>({});

  // Marstek-Cloud-Registrierung: Zugangsdaten NUR lokal im Component-State,
  // je Senke. Werden nie in die Senke/DB geschrieben und nach Erfolg geleert.
  const [regMailbox, setRegMailbox] = useState<Record<string, string>>({});
  const [regPassword, setRegPassword] = useState<Record<string, string>>({});
  const [regBusy, setRegBusy] = useState<Record<string, boolean>>({});
  const [regResult, setRegResult] = useState<Record<string, { ok: boolean; message: string } | null>>({});

  async function registerCt(sink: Sink) {
    const mailbox = (regMailbox[sink.id] ?? "").trim();
    const password = regPassword[sink.id] ?? "";
    const deviceType = sink.emulatedMeter === "ct003" ? "ct003" : "ct002";
    if (!mailbox || !password) {
      setRegResult((p) => ({ ...p, [sink.id]: { ok: false, message: "Bitte Mailbox und Passwort eintragen." } }));
      return;
    }
    setRegBusy((p) => ({ ...p, [sink.id]: true }));
    setRegResult((p) => ({ ...p, [sink.id]: null }));
    try {
      const r = await fetch("/api/sinks/register-ct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailbox, password, deviceType, sinkId: sink.id }),
      });
      const d = await r.json();
      setRegResult((p) => ({ ...p, [sink.id]: { ok: !!d.ok, message: d.message || d.error || (d.ok ? "Erfolgreich." : "Fehlgeschlagen.") } }));
      if (d.ok) {
        // Zugangsdaten sofort verwerfen und die übernommene CT-MAC laden.
        setRegMailbox((p) => ({ ...p, [sink.id]: "" }));
        setRegPassword((p) => ({ ...p, [sink.id]: "" }));
        load(); // holt die Senke mit neu übernommener ctMac
      }
    } catch (e: any) {
      setRegResult((p) => ({ ...p, [sink.id]: { ok: false, message: e?.message ?? "Netzwerkfehler" } }));
    } finally {
      setRegBusy((p) => ({ ...p, [sink.id]: false }));
    }
  }

  function load() {
    fetch("/api/sinks")
      .then((r) => r.json())
      .then((d) => {
        // Live-Werte (Status) immer aktualisieren; die Senken-Konfiguration
        // aber NICHT überschreiben, solange ungespeicherte Änderungen bestehen.
        setStatus(d.status ?? []);
        setNetzQuellen(d.netzQuellen ?? []);
        setAlleQuellen(d.alleQuellen ?? []);
        setFormulaVars(d.formulaVariables ?? []);
        setCtBalancer(d.ctBalancer ?? null);
        if (!dirtyRef.current) setSinks(d.sinks ?? []);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 2000); // Live-Werte mitlaufen lassen
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lokale Änderung (noch nicht gespeichert).
  function update(id: string, patch: Partial<Sink>) {
    setSinks((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    markDirty(true);
  }
  // Lokale Änderung der gesamten Liste (Hinzufügen/Entfernen/Offsets).
  function edit(list: Sink[]) {
    setSinks(list);
    markDirty(true);
  }

  // Gewicht eines Speichers (per IP) in der aktiven CT-Senke setzen. Die
  // Gewichte hängen an der Senke (ctWeights), werden aber im Balancer-Block
  // neben den live erkannten Speicher-IPs eingestellt.
  function setCtWeight(ip: string, weight: number) {
    setSinks((list) => list.map((x) => {
      if (!x.enabled || (x.emulatedMeter !== "ct002" && x.emulatedMeter !== "ct003")) return x;
      const others = (x.ctWeights ?? []).filter((w) => w.ip !== ip);
      return { ...x, ctWeights: [...others, { ip, weight }] };
    }));
    markDirty(true);
  }

  // Aktuelles Gewicht einer IP aus der aktiven CT-Senke (Standard 1).
  function ctWeightOf(ip: string): number {
    const s = sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
    const w = s?.ctWeights?.find((w) => w.ip === ip);
    return w && w.weight > 0 ? w.weight : 1;
  }

  // Dämpfungswert (Totband/Pacing/Umverteilung) der aktiven CT-Senke setzen bzw. lesen.
  function setCtDamping(field: "ctDeadbandW" | "ctMaxStepW" | "ctBalanceStepW" | "ctBalanceToleranceW", value: number) {
    setSinks((list) => list.map((x) => {
      if (!x.enabled || (x.emulatedMeter !== "ct002" && x.emulatedMeter !== "ct003")) return x;
      return { ...x, [field]: value };
    }));
    markDirty(true);
  }
  function ctDampingOf(field: "ctDeadbandW" | "ctMaxStepW" | "ctBalanceStepW" | "ctBalanceToleranceW"): number {
    const s = sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
    const v = s?.[field];
    return Number.isFinite(v) ? (v as number) : 0;
  }

  // Ausfade-Schalter: wirkt sofort (eigener Endpoint), ohne die Senke komplett
  // zu speichern. Danach den Zustand neu laden.
  const [fadeBusy, setFadeBusy] = useState(false);
  async function toggleFadeout(on: boolean) {
    setFadeBusy(true);
    try {
      await fetch("/api/sinks/ctfade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      });
      load();
    } catch { /* ignore */ }
    setFadeBusy(false);
  }
  function ctFadeoutActive(): boolean {
    const s = sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
    return s?.ctFadeout === true;
  }

  // Modus "kein AC-Laden": wirkt sofort (eigener Endpoint), schließt sich mit dem
  // Ausfaden gegenseitig aus (serverseitig erzwungen).
  async function toggleNoAcCharge(on: boolean) {
    setFadeBusy(true);
    try {
      await fetch("/api/sinks/ctnoac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      });
      load();
    } catch { /* ignore */ }
    setFadeBusy(false);
  }
  function ctNoAcChargeActive(): boolean {
    const s = sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
    return s?.ctNoAcCharge === true;
  }

  // Alternierende Entladung: persistentes Config-Feld (kein Sofort-Endpoint),
  // wird über den normalen Speichern-Button übernommen.
  function setAlternierendeEntladung(on: boolean) {
    setSinks((list) => list.map((x) => {
      if (!x.enabled || (x.emulatedMeter !== "ct002" && x.emulatedMeter !== "ct003")) return x;
      return { ...x, ctAlternierendeEntladung: on };
    }));
    markDirty(true);
  }
  function ctAlternierendActive(): boolean {
    const s = sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"));
    return s?.ctAlternierendeEntladung === true;
  }

  // Formel einer Senke serverseitig prüfen + Live-Wert holen.
  async function checkFormula(sink: Sink) {
    if (!sink.formula || !sink.formula.trim()) {
      setFormulaCheck((c) => ({ ...c, [sink.id]: null }));
      return;
    }
    try {
      const res = await fetch("/api/sinks/formula/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formula: sink.formula, baseSourceId: sink.baseSourceId }),
      });
      const j = await res.json();
      setFormulaCheck((c) => ({ ...c, [sink.id]: j }));
    } catch {
      setFormulaCheck((c) => ({ ...c, [sink.id]: { ok: false, error: "Prüfung fehlgeschlagen" } }));
    }
  }

  // Live-Werte der Formeln periodisch aktualisieren (nur für Senken mit Formel).
  useEffect(() => {
    const t = setInterval(() => {
      for (const s of sinks) if (s.formula && s.formula.trim()) checkFormula(s);
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinks]);

  async function saveAll() {
    setSaveError(null);
    try {
      const res = await fetch("/api/sinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinks }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) {
        setSaveError(j?.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      if (j.sinks) setSinks(j.sinks);
      markDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setSaveError(e?.message ?? "Speichern fehlgeschlagen.");
    }
  }

  function addSink() {
    edit([
      ...sinks,
      {
        id: `sink_${Date.now()}`,
        name: "Neue Senke",
        // Standard-Basisquelle: bevorzugt die aktive Netz-Quelle, sonst die erste.
        baseSourceId: (netzQuellen.find((q) => q.enabled) ?? netzQuellen[0])?.id ?? "",
        baseFactor: 1,
        offsets: [],
        include42c: true,
        maxPowerW: 0,
        maxPower42cW: 0,
        enabled: false,
        useDiscovery: true,
        formula: "",
      },
    ]);
  }
  function removeSink(id: string) {
    edit(sinks.filter((s) => s.id !== id));
  }

  // Offset-Editing (lokaler Zustand, Speichern per Knopf)
  function addOffset(sinkId: string) {
    const first = alleQuellen[0]?.id ?? "";
    edit(
      sinks.map((s) =>
        s.id === sinkId
          ? { ...s, offsets: [...(s.offsets ?? []), { sourceId: first, factor: 1, onlyPositive: true }] }
          : s
      )
    );
  }
  function updateOffset(sinkId: string, idx: number, patch: Partial<SinkOffset>) {
    setSinks((list) =>
      list.map((s) =>
        s.id === sinkId
          ? { ...s, offsets: s.offsets.map((o, i) => (i === idx ? { ...o, ...patch } : o)) }
          : s
      )
    );
    markDirty(true);
  }
  function removeOffset(sinkId: string, idx: number) {
    edit(
      sinks.map((s) =>
        s.id === sinkId ? { ...s, offsets: s.offsets.filter((_, i) => i !== idx) } : s
      )
    );
  }

  const st = (id: string) => status.find((x) => x.id === id);

  return (
    <div className="page">
      <h2>Senken</h2>
      <p className="hint">
        Eine Senke ist ein emulierter Shelly-Stromzähler (Pro 3EM, Pro EM-50
        oder EM Gen3), den ein Batteriespeicher als Regelziel verwenden kann. Der
        Speicher regelt die gelieferte Leistung auf 0&nbsp;W aus und entlädt
        dadurch gezielt so viel, wie die Senke als Sollwert vorgibt. Der Sollwert
        setzt sich flexibel zusammen: die Basis-Quelle (eigener Hauszähler) mit
        einem Faktor, optional der Bedarf aller §42c-Abnehmer und beliebige
        weitere gewichtete Offset-Quellen.
      </p>
      <p className="hint">
        Beispiele: Für §42c-Sharing genügt Basis-Faktor&nbsp;1 und aktivierter
        §42c-Bedarf. Für zwei lokale Speicher, die sich den Hausverbrauch teilen
        sollen, wählt man je Senke Basis-Faktor&nbsp;0,5 und lässt §42c aus.
      </p>

      <div className="src-editor">
        {sinks.length === 0 && (
          <p className="hint">Noch keine Senke konfiguriert.</p>
        )}
        {sinks.map((s) => {
          const live = st(s.id);
          const expanded = expandedSinks.has(s.id);
          return (
            <div key={s.id} className={`src-box ${s.enabled ? "" : "src-off"} ${expanded ? "" : "src-box-collapsed"}`}>
              <div className="src-row1">
                <button
                  type="button"
                  className="src-collapse-toggle"
                  onClick={() => toggleSink(s.id)}
                  title={expanded ? "Einklappen" : "Ausklappen"}
                  aria-expanded={expanded}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <input
                  className="src-label"
                  value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                  placeholder="Bezeichnung"
                />
                <label className="src-enabled">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => edit(
                      sinks.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x))
                    )}
                  />{" "}
                  aktiv
                </label>
                <button className="src-del" onClick={() => removeSink(s.id)}>
                  löschen
                </button>
              </div>

              {/* Rolle der Senke: legt fest, welche Information FLUX bereitstellt. */}
              <div className="src-grid">
                <label>Rolle</label>
                <select
                  value={s.sinkRole ?? "meter"}
                  onChange={(e) => update(s.id, { sinkRole: e.target.value as "meter" | "extHems" })}
                >
                  <option value="meter">Zähleremulation</option>
                  <option value="extHems">Datenbereitstellung für externes HEMS</option>
                </select>
              </div>

              {(s.sinkRole ?? "meter") === "extHems" && (
                <ExtHemsConfig sink={s} onChange={(patch) => update(s.id, patch)} />
              )}

              {(s.sinkRole ?? "meter") === "meter" && (<>
              <div className="src-grid">
                <label>Basis-Quelle (eigener Hauszähler)</label>
                <select
                  value={s.baseSourceId}
                  onChange={(e) => edit(
                    sinks.map((x) => (x.id === s.id ? { ...x, baseSourceId: e.target.value } : x))
                  )}
                >
                  {netzQuellen.length === 0 && <option value="">– keine Netz-Quelle –</option>}
                  {netzQuellen.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label}
                      {q.enabled ? "" : " (inaktiv)"}
                    </option>
                  ))}
                </select>

                <label>Basis-Faktor (z.&nbsp;B. 0,5 = halber Hausverbrauch)</label>
                <input
                  type="number"
                  step={0.1}
                  value={s.baseFactor}
                  onChange={(e) => update(s.id, { baseFactor: Number(e.target.value) })}
                />

                <label>§42c-Abnehmerbedarf einbeziehen</label>
                <label className="sink-inline-check">
                  <input
                    type="checkbox"
                    checked={s.include42c}
                    onChange={(e) => edit(
                      sinks.map((x) => (x.id === s.id ? { ...x, include42c: e.target.checked } : x))
                    )}
                  />{" "}
                  Bedarf aller aktiven §42c-Abnehmer aufaddieren
                </label>

                <label>Max. Leistung (W, 0 = unbegrenzt)</label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={s.maxPowerW}
                  onChange={(e) => update(s.id, { maxPowerW: Number(e.target.value) })}
                />

                <label className={s.include42c ? "" : "sink-label-disabled"}>
                  Max. Leistung §42c (W, 0 = unbegrenzt)
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  disabled={!s.include42c}
                  title={s.include42c
                    ? "Begrenzt nur die Abgabe an externe §42c-Abnehmer über den Eigenverbrauch hinaus. Der Hausverbrauch bleibt unbegrenzt."
                    : "Nur verfügbar, wenn 'Bedarf aller aktiven §42c-Abnehmer aufaddieren' aktiviert ist."}
                  value={s.maxPower42cW ?? 0}
                  onChange={(e) => update(s.id, { maxPower42cW: Number(e.target.value) })}
                />
              </div>

              {/* Selten genutzte Feineinstellungen zusammen ausklappbar, damit
                  die Senkenseite übersichtlich bleibt. */}
              <details className="sink-advanced">
                <summary>Erweiterte Einstellungen (Offsets &amp; Formel)</summary>

              {/* Offset-Editor: zusätzliche gewichtete Quellen */}
              <div className="sink-offsets">
                <div className="sink-offsets-head">
                  Zusätzliche Offsets
                  <button className="sink-offset-add" onClick={() => addOffset(s.id)}>+ Offset</button>
                </div>
                {(s.offsets ?? []).length === 0 && (
                  <div className="sink-offset-empty">keine – nur Basis-Quelle{ s.include42c ? " und §42c" : "" }</div>
                )}
                {(s.offsets ?? []).map((o, idx) => (
                  <div key={idx} className="sink-offset-row">
                    <select
                      value={o.sourceId}
                      onChange={(e) => updateOffset(s.id, idx, { sourceId: e.target.value })}
                    >
                      {alleQuellen.map((q) => (
                        <option key={q.id} value={q.id}>{q.label}{q.enabled ? "" : " (inaktiv)"}</option>
                      ))}
                    </select>
                    <span className="sink-offset-x">×</span>
                    <input
                      type="number"
                      step={0.1}
                      className="sink-offset-factor"
                      value={o.factor}
                      onChange={(e) => updateOffset(s.id, idx, { factor: Number(e.target.value) })}
                    />
                    <label className="sink-offset-pos" title="nur positiven Leistungsanteil (Bezug) berücksichtigen">
                      <input
                        type="checkbox"
                        checked={o.onlyPositive}
                        onChange={(e) => { updateOffset(s.id, idx, { onlyPositive: e.target.checked }); }}
                      />{" "}
                      nur Bezug
                    </label>
                    <button className="sink-offset-del" onClick={() => removeOffset(s.id, idx)}>✕</button>
                  </div>
                ))}
              </div>

              {/* Erweiterte Formel (optional, überschreibt die obige Berechnung) */}
              <div className="sink-formula">
                <div className="sink-formula-head">
                  Erweiterte Formel (optional)
                </div>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  Ist hier eine Formel eingetragen, wird der Sollwert (W) daraus
                  berechnet – die obige Basis-/Offset-/§42c-Berechnung wird dann
                  ignoriert. Erlaubt sind <code>+ − * / %</code>, Klammern und die
                  Funktionen <code>min, max, abs, clamp(x,lo,hi), round</code>.
                  Beispiel für Speicher-Priorisierung (zweiter Speicher springt
                  erst an, wenn der erste seine Maximalleistung ausspeist):
                  <br />
                  <code>max(0, hichi + speicher1_leistung - speicher1_max)</code>
                </p>
                <textarea
                  className="sink-formula-input"
                  rows={2}
                  value={s.formula ?? ""}
                  placeholder="z. B. max(0, haus * 0.5)"
                  onChange={(e) => update(s.id, { formula: e.target.value })}
                  onBlur={() => checkFormula(s)}
                />
                {(() => {
                  const chk = formulaCheck[s.id];
                  if (!s.formula || !s.formula.trim()) return null;
                  if (!chk) return <div className="sink-formula-status">Prüfe…</div>;
                  if (!chk.ok) return <div className="sink-formula-status err">⚠ {chk.error}</div>;
                  return (
                    <div className="sink-formula-status ok">
                      ✓ gültig · Live-Wert: <strong>{Math.round(chk.value)} W</strong>
                      {chk.usedVars && Object.keys(chk.usedVars).length > 0 && (
                        <span className="sink-formula-vars">
                          {" "}({Object.entries(chk.usedVars).map(([k, v]) => `${k}=${v}`).join(", ")})
                        </span>
                      )}
                    </div>
                  );
                })()}
                <details className="sink-formula-doc">
                  <summary>Verfügbare Variablen</summary>
                  <ul>
                    {formulaVars.map((v) => (
                      <li key={v.name}><code>{v.name}</code> – {v.desc}</li>
                    ))}
                  </ul>
                </details>
              </div>
              </details>

              <div className="sink-discovery">
                <div className="sink-meter-type">
                  <label>
                    Emulierter Zählertyp:{" "}
                    <select
                      value={s.emulatedMeter ?? "pro3em"}
                      onChange={(e) => edit(
                        sinks.map((x) => (x.id === s.id ? { ...x, emulatedMeter: e.target.value as Sink["emulatedMeter"] } : x))
                      )}
                    >
                      <option value="pro3em">Shelly Pro 3EM (dreiphasig)</option>
                      <option value="proem50">Shelly Pro EM-50 (einphasig)</option>
                      <option value="emg3">Shelly EM Gen3 (einphasig)</option>
                      <option value="ct002">Marstek CT002 (dreiphasig)</option>
                      <option value="ct003">Marstek CT003 / P1 (einphasig)</option>
                    </select>
                  </label>
                </div>

                {(s.emulatedMeter === "pro3em" || s.emulatedMeter === "proem50" || s.emulatedMeter === "emg3" || !s.emulatedMeter) && (
                  <>
                    <label className="sink-inline-check" style={{ marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={s.useDiscovery}
                        onChange={(e) => edit(
                          sinks.map((x) => (x.id === s.id ? { ...x, useDiscovery: e.target.checked } : x))
                        )}
                      />{" "}
                      automatische Erkennung per UDP-Discovery (Marstek findet den
                      emulierten Shelly im LAN selbst)
                    </label>
                    <p className="hint" style={{ margin: "4px 0 0" }}>
                      Marstek-Speicher suchen den Shelly-Zähler per UDP-Broadcast
                      (Port 1010/2220) und nicht über eine feste Adresse. Ist diese
                      Option aktiv, antwortet die Anlage auf solche Suchanfragen mit
                      dieser Senke – im Speicher einfach den oben gewählten
                      Zählertyp auswählen und suchen lassen.
                    </p>
                    <p className="hint" style={{ margin: "4px 0 0" }}>
                      Es dürfen <strong>mehrere</strong> Discovery-Senken
                      gleichzeitig aktiv sein, solange sie <strong>unterschiedliche
                      Zählertypen</strong> emulieren. Der Speicher erkennt „seinen"
                      Zähler eindeutig an der Geräte-Kennung (src-Präfix
                      <code>shellypro3em-</code>, <code>shellyproem50-</code> bzw.
                      <code>shellyemg3-</code>) und übernimmt nur den in seiner App
                      gewählten Typ. So lässt sich z.&nbsp;B. die Last zweier
                      Marstek-Speicher aufteilen: eine Senke als „Pro EM-50", eine
                      als „EM Gen3", jede mit eigener Gewichtung, gespeist aus
                      demselben physischen Zähler. Zwei Senken desselben Typs
                      funktionieren nicht – der Speicher könnte sie nicht
                      auseinanderhalten.
                    </p>
                    <p className="hint" style={{ margin: "4px 0 0" }}>
                      Betreibst du zusätzlich einen <em>physischen</em> Shelly am
                      selben Speicher, wähle hier einen <strong>anderen</strong> Typ
                      als beim physischen Zähler und in der Marstek-App genau diesen
                      Typ. So antwortet nur der emulierte Zähler auf die Suchanfrage
                      und beide lassen sich sauber trennen.
                    </p>
                  </>
                )}

                {(s.emulatedMeter === "ct002" || s.emulatedMeter === "ct003") && (
                  <>
                    <details className="sink-ct-register" style={{ marginTop: 8 }}>
                      <summary className="sink-ct-register-title">
                        CT in Marstek-Cloud registrieren (einmalig)
                      </summary>
                      <p className="hint" style={{ margin: "6px 0 6px" }}>
                        Damit die Marstek-App den emulierten{" "}
                        {s.emulatedMeter === "ct003" ? "CT003" : "CT002"} zur
                        Auswahl anbietet, muss er einmalig im Marstek-Account
                        angelegt werden. Trage dazu <strong>nur für diesen
                        Vorgang</strong> deine Marstek-Zugangsdaten ein und starte
                        die Registrierung. Die Zugangsdaten werden{" "}
                        <strong>nicht gespeichert</strong> und nach dem Vorgang
                        sofort verworfen. Die CT-MAC wird automatisch erzeugt und
                        bei Erfolg unten übernommen – du musst sie nicht eingeben.
                      </p>
                      <div className="sink-ct-register-fields">
                        <label>
                          Marstek-Mailbox (E-Mail)
                          <input
                            type="email"
                            autoComplete="off"
                            value={regMailbox[s.id] ?? ""}
                            placeholder="mail@example.com"
                            onChange={(e) => setRegMailbox((p) => ({ ...p, [s.id]: e.target.value }))}
                          />
                        </label>
                        <label>
                          Marstek-Passwort
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={regPassword[s.id] ?? ""}
                            placeholder="••••••••"
                            onChange={(e) => setRegPassword((p) => ({ ...p, [s.id]: e.target.value }))}
                          />
                        </label>
                      </div>
                      <button
                        className="sink-ct-register-btn"
                        disabled={!!regBusy[s.id]}
                        onClick={() => registerCt(s)}
                      >
                        {regBusy[s.id] ? "Registrierung läuft…" : `${s.emulatedMeter === "ct003" ? "CT003" : "CT002"} registrieren`}
                      </button>
                      {regResult[s.id] && (
                        <p className={regResult[s.id]!.ok ? "sink-ct-register-ok" : "sink-ct-register-err"}>
                          {regResult[s.id]!.ok ? "✓ " : "⚠ "}{regResult[s.id]!.message}
                        </p>
                      )}
                    </details>

                    <div className="ct-blue-block sink-ct-macs">
                      <label>
                        CT-MAC
                        <input
                          value={s.ctMac ?? ""}
                          placeholder="z. B. 02b25022e63d"
                          onChange={(e) => edit(
                            sinks.map((x) => (x.id === s.id ? { ...x, ctMac: e.target.value } : x))
                          )}
                        />
                      </label>
                      <p className="hint" style={{ margin: "6px 0 0" }}>
                        Die <strong>CT-MAC</strong> wird bei der Registrierung
                        automatisch eingetragen. Ist das CT bereits in der Cloud
                        angelegt (z.&nbsp;B. aus einer früheren Registrierung), lässt
                        sie sich hier auch <strong>manuell eintragen</strong> – dann
                        ist keine erneute Registrierung nötig. In der App die CT-Liste
                        aktualisieren und den CT als Zähler auswählen. Der emulierte CT
                        antwortet lokal auf UDP-Port 12345.
                      </p>
                      <p className="hint" style={{ margin: "6px 0 0" }}>
                        Der emulierte Zähler meldet dem Speicher die reale
                        Netzsituation vorzeichengetreu: bei <strong>Netzbezug</strong>{" "}
                        entlädt der Speicher, bei <strong>Überschuss</strong> lädt er.
                        Der Speicher entscheidet selbst – wie an einem echten Zähler.
                        Eine gesetzte Maximalleistung begrenzt beide Richtungen.
                      </p>
                    </div>

                    <div className="ct-blue-block ct-bal-target">
                      <label>
                        Netz-Zielwert (W)
                        <input
                          type="number"
                          value={s.targetOffsetW ?? 0}
                          onChange={(e) => edit(
                            sinks.map((x) => (x.id === s.id ? { ...x, targetOffsetW: Number(e.target.value) } : x))
                          )}
                        />
                      </label>
                      <p className="hint" style={{ margin: "6px 0 0" }}>
                        Auf welchen Netzwert geregelt wird. <strong>0</strong> =
                        Nulleinspeisung (Bilanz auf 0). <strong>Negativ</strong> (z.&nbsp;B.
                        −10) = bewusst leichte Einspeisung statt Bezug – der Speicher
                        regelt dann so, dass am Netz −10&nbsp;W stehen. Positiv =
                        leichter Restbezug.
                      </p>
                    </div>

                    <div className="ct-fade" style={{ marginTop: 12, padding: "10px 12px", background: "#f5f8fc", border: "1px solid #e0e8f0", borderRadius: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#33475b", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={ctFadeoutActive()}
                          disabled={fadeBusy}
                          onChange={(e) => toggleFadeout(e.target.checked)}
                        />
                        AC-Speicher ausfaden (auf 0 fahren)
                        {ctFadeoutActive() && <span style={{ color: "#b3261e", fontWeight: 700 }}>● aktiv</span>}
                      </label>
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        <label style={{ fontSize: 11, color: "#667" }}>
                          Schrittweite / Poll (W)
                          <input
                            type="number"
                            min={0}
                            step={25}
                            value={Number.isFinite(sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"))?.ctFadeStepW) ? (sinks.find((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003"))?.ctFadeStepW ?? 0) : 0}
                            onChange={(e) => edit(
                              sinks.map((x) => ((x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003") ? { ...x, ctFadeStepW: Number(e.target.value) } : x))
                            )}
                            style={{ width: 80, marginLeft: 6, padding: "3px 6px", border: "1px solid #ccc", borderRadius: 5, fontSize: 12 }}
                          />
                        </label>
                      </div>
                      <p className="hint" style={{ margin: "6px 0 0" }}>
                        Fährt die AC-Speicher schrittweise auf 0&nbsp;W Batterieleistung
                        und hält sie dort (unabhängig von der Netzbilanz), ohne sie hart
                        per Shelly zu schalten. Gedacht zum „Herunterfahren" der
                        AC-Speicher, bevor die DC-Speicher übernehmen – so arbeiten sie
                        nicht gegeneinander. Ausschalten kehrt sofort in den
                        Normalbetrieb zurück. Der Schalter wirkt unmittelbar (kein
                        Speichern nötig); die Schrittweite bestimmt, wie schnell das
                        Ausfaden geht (0 = Standard 150&nbsp;W). Schrittweite-Änderung
                        nach dem Speichern aktiv.
                      </p>
                    </div>

                    <div className="ct-noac" style={{ marginTop: 10, padding: "10px 12px", background: "#f5f8fc", border: "1px solid #e0e8f0", borderRadius: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#33475b", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={ctNoAcChargeActive()}
                          disabled={fadeBusy}
                          onChange={(e) => toggleNoAcCharge(e.target.checked)}
                        />
                        AC-Speicher kein AC-Laden
                        {ctNoAcChargeActive() && <span style={{ color: "#b3261e", fontWeight: 700 }}>● aktiv</span>}
                      </label>
                      <p className="hint" style={{ margin: "6px 0 0" }}>
                        Begrenzt den an die AC-Speicher gelieferten CT-Wert auf
                        <strong> ≥ 0</strong>: positive Werte (Entladung/Bezugsausgleich)
                        werden normal durchgereicht, negative Werte (die den Speicher
                        zum Laden bewegen würden) auf 0 gekappt. So laden sich die
                        AC-Speicher nicht über den CT auf – z.&nbsp;B. wenn ein
                        DC-Speicher einspeist. Schließt sich mit dem Ausfaden gegenseitig
                        aus; wirkt unmittelbar (kein Speichern nötig).
                      </p>
                    </div>

                    <div className="ct-alternierend" style={{ marginTop: 10, padding: "10px 12px", background: "#f5f8fc", border: "1px solid #e0e8f0", borderRadius: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#33475b", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={ctAlternierendActive()}
                          onChange={(e) => setAlternierendeEntladung(e.target.checked)}
                        />
                        Alternierende Entladung
                        {ctAlternierendActive() && <span style={{ color: "#1a7f37", fontWeight: 700 }}>● aktiv</span>}
                      </label>
                      <p className="hint" style={{ margin: "6px 0 0" }}>
                        Beim <strong>Entladen</strong> wird bevorzugt nur <strong>ein</strong>
                        {" "}Speicher genutzt – der mit dem höchsten Ladestand –, bis dieser
                        die nächste Stufe (100&nbsp;→&nbsp;75&nbsp;→&nbsp;50&nbsp;→&nbsp;25&nbsp;→&nbsp;12&nbsp;%)
                        erreicht; dann übernimmt der nächste. Reicht seine Leistung nicht,
                        ziehen die übrigen Speicher mit. Das reduziert die höheren
                        Teillast-Verluste der AC-Speicher. Beim <strong>Laden</strong>
                        {" "}bleibt die Verteilung parallel. Der aktive Speicher wird unten
                        im Balancer angezeigt. Änderung nach dem Speichern aktiv.
                      </p>
                    </div>
                  </>
                )}
              </div>

              {live && (
                <div className="sink-live">
                  <span className="sink-live-out">
                    aktuell geliefert: <strong>{nf(live.outputPowerW, 0)} W</strong>
                  </span>
                  <span className="sink-live-detail">
                    Basis (gewichtet) {nf(live.eigenBezugW, 0)} W · Offsets/§42c{" "}
                    {nf(live.abnehmerBezugW, 0)} W
                  </span>
                </div>
              )}
              {/* Multi-Speicher-Balancer (live) gehört zu dieser CT-Senke und
                  wird daher innerhalb ihres Blocks angezeigt (nur bei der aktiven
                  ct002/003-Senke). */}
              {s.enabled && (s.emulatedMeter === "ct002" || s.emulatedMeter === "ct003") && renderBalancer()}
              </>)}
            </div>
          );
        })}
      </div>

      <div className="src-actions">
        <button onClick={addSink}>+ Senke hinzufügen</button>
        <button onClick={saveAll} className="src-save">
          Alles speichern
        </button>
        {dirty && !saved && <span className="src-dirty">● ungespeicherte Änderungen</span>}
        {saved && <span className="src-testok">✓ gespeichert</span>}
      </div>
      {saveError && <p className="src-save-error">⚠ {saveError}</p>}
    </div>
  );

  // Live-Block des Multi-Speicher-Balancers. Wird innerhalb der CT-Senke
  // gerendert (gehört logisch zur Senke, v.a. wegen der Einstellungen). Nur
  // sichtbar, wenn der Balancer aktiv ist (mehrere Speicher an einem emulierten
  // CT). `renderBalancer` liefert null, wenn nicht anzuzeigen.
  function renderBalancer() {
    if (!(ctBalancer && ctBalancer.active && sinks.some((x) => x.enabled && (x.emulatedMeter === "ct002" || x.emulatedMeter === "ct003")))) {
      return null;
    }
    return (
        <div className="card ct-balancer">
          <h3>Multi-Speicher-Balancer (live)</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Aktiv, weil mehrere Speicher dasselbe emulierte CT abfragen. Der
            Balancer verteilt die auszuregelnde Netzleistung auf die Speicher,
            damit sie <strong>gemeinsam</strong> die Bilanz ausregeln, statt
            gegeneinander zu arbeiten. Aktualisiert sich alle 2&nbsp;Sekunden.
            Die Spalten <strong>Ladegrenze</strong>/<strong>Entladegrenze</strong>
            zeigen die adaptiv gelernten Leistungsgrenzen je Speicher (Betrag in W);
            „–" bedeutet, dass noch keine Grenze erkannt wurde. Ist bei der Senke
            eine <strong>Max. Leistung</strong> gesetzt, wird das <em>Gesamtziel</em>
            (kombinierte Speicherleistung aller Speicher) symmetrisch auf diesen
            Wert begrenzt – Laden wie Entladen. Eine gesetzte
            <strong> Max. Leistung §42c</strong> begrenzt zusätzlich nur den Anteil,
            der über den eigenen Hausverbrauch hinaus an externe §42c-Abnehmer
            abgegeben wird; der Hausverbrauch selbst bleibt davon unberührt.
          </p>

          {ctBalancer.fadeout && (
            <p className="hint" style={{ margin: "0 0 8px", color: "#b3261e", fontWeight: 600 }}>
              ● Ausfaden aktiv – die AC-Speicher werden schrittweise auf 0&nbsp;W
              gefahren und dort gehalten (Normalregelung ausgesetzt).
            </p>
          )}

          <div className="ct-bal-summary">
            <div className="ct-bal-kpi">
              <span className="ct-bal-kpi-label">Aktive Speicher</span>
              <span className="ct-bal-kpi-val">{ctBalancer.consumers.length}</span>
            </div>
            <div className="ct-bal-kpi">
              <span className="ct-bal-kpi-label">Netzabweichung</span>
              <span className="ct-bal-kpi-val">{ctBalancer.gridReading} W</span>
            </div>
            <div className="ct-bal-kpi">
              <span className="ct-bal-kpi-label">Speicher gesamt (ist)</span>
              <span className="ct-bal-kpi-val">{ctBalancer.gesamtIst} W</span>
            </div>
            <div className="ct-bal-kpi">
              <span className="ct-bal-kpi-label">Gesamtziel</span>
              <span className="ct-bal-kpi-val">{ctBalancer.gesamtZiel} W</span>
            </div>
            {ctBalancer.aktiverIp && (
              <div className="ct-bal-kpi">
                <span className="ct-bal-kpi-label">Aktiver Speicher (alt. Entladung)</span>
                <span className="ct-bal-kpi-val" style={{ color: "#1a7f37" }}>{ctBalancer.aktiverIp}</span>
              </div>
            )}
          </div>

          <div className="table-scroll">
            <table className="ct-bal-table">
              <thead>
                <tr>
                  <th>Speicher (IP)</th>
                  <th>Phase</th>
                  <th>meldet</th>
                  <th>Zielanteil</th>
                  <th>Ladegrenze</th>
                  <th>Entladegrenze</th>
                  <th>Delta gesendet</th>
                  <th>Gewicht</th>
                  <th>letzter Poll</th>
                </tr>
              </thead>
              <tbody>
                {ctBalancer.consumers.map((c) => (
                  <tr key={c.ip + c.phase} className={c.aktiv ? "ct-bal-aktiv" : ""}>
                    <td>{c.ip}{c.aktiv && <span title="aktiver Speicher (alternierende Entladung)" style={{ marginLeft: 6, color: "#1a7f37", fontWeight: 700 }}>● aktiv</span>}</td>
                    <td>{c.phase}</td>
                    <td>{c.reportedPower} W</td>
                    <td><strong>{c.targetShare} W</strong></td>
                    <td className="ct-bal-cap">{c.capChargeW != null ? `${Math.round(c.capChargeW)} W` : "–"}</td>
                    <td className="ct-bal-cap">{c.capDischargeW != null ? `${Math.round(c.capDischargeW)} W` : "–"}</td>
                    <td className={c.reading > 0 ? "ct-bal-pos" : c.reading < 0 ? "ct-bal-neg" : ""}>
                      {c.reading > 0 ? "+" : ""}{c.reading} W
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={ctWeightOf(c.ip)}
                        onChange={(e) => setCtWeight(c.ip, Number(e.target.value))}
                        style={{ width: 60, padding: "2px 5px", border: "1px solid #ccc", borderRadius: 4, fontSize: 12 }}
                      />
                    </td>
                    <td>{nf(c.ageMs / 1000, 1)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Das <strong>Gewicht</strong> je Speicher lässt sich hier direkt
            einstellen (danach speichern). Sinnvoll nach Speicherkapazität: ein
            4-kWh-Speicher bekommt z.&nbsp;B. Gewicht 2, ein 2-kWh-Speicher Gewicht
            1 – dann trägt der größere doppelt so viel zur Ausregelung bei.
            Änderungen gelten nach dem Speichern.
          </p>

          <div className="ct-bal-explain">
            <h4>Wie der Balancer arbeitet</h4>
            <p className="hint">
              Jeder Speicher fragt das emulierte CT selbstständig ab und meldet
              dabei seine <em>aktuelle</em> Ausgangsleistung („meldet"). Das CT
              antwortet nicht mit einem absoluten Wert, sondern mit einem{" "}
              <strong>Delta</strong> (Spalte „Delta gesendet"), das der Speicher zu
              seiner Leistung addiert: <code>neu = meldet + Delta</code>. So landet
              jeder Speicher auf seinem <strong>Zielanteil</strong>.
            </p>
            <p className="hint">Die Aufteilung entsteht in drei Schritten:</p>
            <ol className="hilfe-list">
              <li>
                <strong>Gesamtziel bilden:</strong> Summe der aktuell gemeldeten
                Speicherleistungen ({ctBalancer.gesamtIst} W) plus die
                Netzabweichung ({ctBalancer.gridReading} W) ={" "}
                {ctBalancer.gesamtZiel} W. So viel müssen die Speicher zusammen
                liefern bzw. aufnehmen, damit die Netzbilanz auf 0 geht.
              </li>
              <li>
                <strong>Gewichtet aufteilen:</strong> Das Gesamtziel wird nach den
                Gewichten auf die Speicher verteilt (bei gleichem Gewicht zu
                gleichen Teilen) – das ist der „Zielanteil" jeder Zeile.
              </li>
              <li>
                <strong>Delta senden:</strong> Jeder Speicher bekommt die Differenz
                zwischen seinem Zielanteil und dem, was er gerade tut. Dadurch
                ziehen alle in dieselbe Richtung, ohne sich hochzuschaukeln.
              </li>
            </ol>
            <p className="hint">
              <strong>Konvergenz beobachten:</strong> Wenn es gut läuft, nähern sich
              die „Delta"-Werte über wenige Sekunden der 0 an und die
              „meldet"-Werte den Zielanteilen – dann ist die Bilanz eingeregelt.
              Bleiben die Deltas groß oder wechseln ständig das Vorzeichen, pendelt
              das System (dann wäre eine Dämpfung sinnvoll). Vorzeichen:{" "}
              <strong>+</strong> = mehr entladen / weniger laden,{" "}
              <strong>−</strong> = mehr laden / weniger entladen.
            </p>
            <p className="hint">
              Speicher werden über ihre IP-Adresse unterschieden. Ein Speicher, der
              länger nicht abfragt, fällt automatisch aus der Aufteilung (adaptiver
              Ablauf nach etwa zwei ausgelassenen Abfragezyklen).
            </p>

            <h4 style={{ marginTop: 12 }}>Dämpfung gegen Schwingen</h4>
            <div className="ct-bal-weights">
              <label>
                Max. Schritt / Poll (W)
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={ctDampingOf("ctMaxStepW")}
                  onChange={(e) => setCtDamping("ctMaxStepW", Number(e.target.value))}
                />
              </label>
              <label>
                Totband um 0 (W)
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={ctDampingOf("ctDeadbandW")}
                  onChange={(e) => setCtDamping("ctDeadbandW", Number(e.target.value))}
                />
              </label>
            </div>
            <p className="hint">
              <strong>Max. Schritt / Poll</strong> begrenzt, um wie viel Watt ein
              Speicher je Abfrage höchstens nachgeführt wird (Pacing). Kleinere
              Werte dämpfen stärker, brauchen aber mehr Zyklen bis zum Ziel.
              Sinnvoll etwa 30–100&nbsp;W. <strong>Totband</strong>: liegt die
              Netzabweichung betragsmäßig darunter, wird nicht nachgeregelt – hält
              die Speicher am Nullpunkt ruhig. Sinnvoll etwa 15–25&nbsp;W. Beide 0 =
              aus. Änderungen gelten nach dem Speichern.
            </p>

            <h4 style={{ marginTop: 12 }}>Umverteilung zwischen Speichern</h4>
            <div className="ct-bal-weights">
              <label>
                Umverteilungs-Schritt (W)
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={ctDampingOf("ctBalanceStepW")}
                  onChange={(e) => setCtDamping("ctBalanceStepW", Number(e.target.value))}
                />
              </label>
              <label>
                Balance-Toleranz (W)
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={ctDampingOf("ctBalanceToleranceW")}
                  onChange={(e) => setCtDamping("ctBalanceToleranceW", Number(e.target.value))}
                />
              </label>
            </div>
            <p className="hint">
              Betrifft nur mehrere gemeinsam regelnde Speicher. Ist das Netz bereits
              grob ausgeregelt, besteht ein verbleibendes Delta nur noch darin, die
              Speicher ins richtige <strong>Verhältnis</strong> zu bringen. Dieses
              Angleichen kann sanfter erfolgen als die Netzreaktion:
              <strong> Umverteilungs-Schritt</strong> ist der maximale Watt-Schritt
              pro Abfrage nur für das Angleichen (klein wählen, z.B. 10&nbsp;W – dann
              pendeln die Speicher nicht gegeneinander).
              <strong> Balance-Toleranz</strong>: solange ein Speicher innerhalb
              dieses Bandes vom fairen Anteil liegt, wird gar nicht umverteilt
              (Ruhe). Sinnvoll etwa 50–100&nbsp;W. Beide 0 = aus (dann gilt nur
              „Max. Schritt / Poll" wie bisher). Die Netzausregelung bei echten
              Laständerungen bleibt unverändert schnell.
            </p>
          </div>
        </div>
    );
  }
}
