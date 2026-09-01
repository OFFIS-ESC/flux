// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";
import { SortableGrid, SortToggle } from "./SortableGrid";
import { nf } from "./chartUtils";

// Ein Anzeige-/Wertefeld (aus Modbus/REST/MQTT) oder strukturierte UDP-Werte.
interface Field { label: string; value: number | string | boolean; unit?: string }

interface Speicher {
  sourceId: string;
  kuerzel?: string;
  label: string;
  connection: "udp" | "modbus" | "rest" | "mqtt";
  control?: "udp" | "modbus" | "zendure" | "none";
  online?: boolean;
  error?: string;
  generic?: boolean;
  switchable?: boolean;
  switchSourceId?: string;
  switchChannel?: number;
  switchState?: boolean | null;
  // UDP (strukturiert):
  soc?: number | null;
  batPowerW?: number | null;
  ongridPowerW?: number | null;
  pvPowerW?: number | null;
  tempC?: number | null;
  remainingCapWh?: number | null;
  ratedCapWh?: number | null;
  totalPvKwh?: number | null;
  totalGridInKwh?: number | null;
  totalGridOutKwh?: number | null;
  totalLoadKwh?: number | null;
  device?: { model: string | null; firmware: number | null; ip: string | null };
  raw?: Array<{ key: string; label: string; value: any; unit?: string }>;
  // Modbus / REST / MQTT:
  fields?: Field[];
  values?: Record<string, number>;
  mode?: string | null;
  forceMode?: number | null;
  chargeToSoc?: number | null;
  backup?: number | null;
  // Status der einzelnen Batteriemodule (Marstek Venus über Modbus)
  modules?: Array<{ index: number; soc: number | null; cellMinV: number | null; cellMaxV: number | null; imbalanceV: number | null }>;
}

const UDP_MODES = ["Auto", "AI", "Manual", "Passive"] as const;

// DC-Speicher: Werte ergeben sich aus verlinkten Quellen (PV + batteryOut).
interface DcSpeicher {
  id: string;
  kuerzel?: string;
  label: string;
  linkedPv: { id: string; label: string } | null;
  linkedBatteryOut: { id: string; label: string } | null;
  linkedCharger: { id: string; label: string } | null;
  online: boolean;
  ladeW: number | null;
  entladeW: number | null;
  soc: number | null;
  fields: Array<{ label: string; value: number | string | boolean; unit?: string; from?: string }>;
  switches: Array<{ id: string; label: string; channel: number; state: boolean | null }>;
  links: Array<{ url: string; label: string }>;
}

function fmt(v: number | null | undefined, digits = 0): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function AcSpeicherPage() {
  const [list, setList] = useState<Speicher[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Modbus-Steuerungs-Eingaben je Speicher.
  const [power, setPower] = useState<Record<string, number>>({});
  const [toSoc, setToSoc] = useState<Record<string, number>>({});
  // UDP-Passive-Eingaben.
  const [udpPower, setUdpPower] = useState(0);
  const [udpDuration, setUdpDuration] = useState(3600);
  // DC-Speicher (Rolle dcBattery): abgeleitete Werte aus verlinkten Quellen.
  const [dcList, setDcList] = useState<DcSpeicher[] | null>(null);
  const [dcSwitchBusy, setDcSwitchBusy] = useState<string | null>(null);
  // Weboberflächen-Links der AC-Speicher (für die gemeinsame Link-Box).
  const [acLinks, setAcLinks] = useState<Array<{ from: string; url: string; label: string }>>([]);

  // Drag&Drop-Sortierung der Speicher (getrennt je Kategorie). dragItem hält die
  // gerade gezogene ID samt Kategorie; beim Ablegen wird lokal umsortiert und die
  // neue Reihenfolge dauerhaft gespeichert (steuert auch die SoC-Anzeige auf der
  // Übersicht).
  const [dragItem, setDragItem] = useState<{ cat: "ac" | "dc"; id: string } | null>(null);
  const [sortMode, setSortMode] = useState(false);

  const persistOrder = useCallback((cat: "ac" | "dc", ids: string[]) => {
    fetch("/api/speicher/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cat === "ac" ? { acOrder: ids } : { dcOrder: ids }),
    }).catch(() => { /* Reihenfolge ist unkritisch; beim nächsten Laden konsistent */ });
  }, []);

  // Element mit ID draggedId vor targetId einsortieren (innerhalb einer Liste).
  const reorder = useCallback((cat: "ac" | "dc", draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    if (cat === "ac") {
      setList((prev) => {
        if (!prev) return prev;
        const arr = [...prev];
        const from = arr.findIndex((x) => x.sourceId === draggedId);
        const to = arr.findIndex((x) => x.sourceId === targetId);
        if (from < 0 || to < 0) return prev;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        // Kürzel (AC1, AC2, …) sofort an die neue Reihenfolge anpassen.
        arr.forEach((x, i) => { x.kuerzel = `AC${i + 1}`; });
        persistOrder("ac", arr.map((x) => x.sourceId));
        return arr;
      });
    } else {
      setDcList((prev) => {
        if (!prev) return prev;
        const arr = [...prev];
        const from = arr.findIndex((x) => x.id === draggedId);
        const to = arr.findIndex((x) => x.id === targetId);
        if (from < 0 || to < 0) return prev;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        arr.forEach((x, i) => { x.kuerzel = `DC${i + 1}`; });
        persistOrder("dc", arr.map((x) => x.id));
        return arr;
      });
    }
  }, [persistOrder]);

  const load = useCallback(() => {
    // Die drei Abrufe entkoppelt behandeln, damit die AC-Kacheln erscheinen,
    // sobald ihr Endpunkt geantwortet hat – unabhängig davon, ob DC-Status oder
    // Links noch unterwegs sind. Ein langsamer Einzelabruf blockiert nicht mehr
    // die gesamte Seite.
    fetch("/api/acspeicher/status").then((r) => r.json()).then((ac) => {
      setConfigured(ac.configured !== false);
      const speicher = ac.speicher ?? [];
      // Bereits bekannte Steuerungs-Infos (mode/forceMode/chargeToSoc/backup)
      // aus dem bisherigen Zustand übernehmen, damit die "aktuell: …"-Anzeige
      // beim periodischen Refresh nicht kurz verschwindet und wieder auftaucht
      // (die control-status-Abfrage ergänzt sie nur asynchron nach).
      setList((prev) => speicher.map((sp: typeof speicher[number]) => {
        const alt = (prev ?? []).find((x) => x.sourceId === sp.sourceId);
        if (!alt) return sp;
        return {
          ...sp,
          mode: sp.mode ?? alt.mode,
          forceMode: sp.forceMode ?? alt.forceMode,
          chargeToSoc: sp.chargeToSoc ?? alt.chargeToSoc,
          backup: sp.backup ?? alt.backup,
        };
      }));
      // Steuerungs-Infos (Betriebsmodus/Force/Backup) der Modbus-Speicher separat
      // und nicht-blockierend nachladen.
      for (const sp of speicher) {
        if (sp?.control !== "modbus" || !sp?.sourceId) continue;
        fetch(`/api/acspeicher/modbus/control-status?sourceId=${encodeURIComponent(sp.sourceId)}`)
          .then((r) => r.json())
          .then((cs) => {
            if (!cs?.ok) return;
            setList((prev) => (prev ?? []).map((x) => x.sourceId === sp.sourceId
              ? { ...x, mode: cs.mode, forceMode: cs.forceMode, chargeToSoc: cs.chargeToSoc, backup: cs.backup }
              : x));
          })
          .catch(() => {});
      }
    }).catch(() => { setList([]); });

    fetch("/api/dcspeicher/status").then((r) => r.json())
      .then((dc) => setDcList(dc.speicher ?? []))
      .catch(() => setDcList([]));

    fetch("/api/source-links?roles=acBattery").then((r) => r.json()).then((links) => {
      const al: Array<{ from: string; url: string; label: string }> = [];
      for (const s of (links.sources ?? [])) {
        for (const l of (s.links ?? [])) {
          if (l?.url && l?.label) al.push({ from: s.label, url: l.url, label: l.label });
        }
      }
      setAcLinks(al);
    }).catch(() => {});
  }, []);

  // Erstabruf + automatische Aktualisierung. Die Werte erscheinen von selbst,
  // sobald die Quellen im eingestellten Intervall neue Daten geliefert haben.
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Schaltbare Quelle eines DC-Speichers umschalten.
  async function dcSwitch(sourceId: string, channel: number, on: boolean) {
    setDcSwitchBusy(`${sourceId}:${channel}`);
    try {
      await fetch("/api/switch/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, channel, on }),
      });
      setTimeout(load, 600);
    } finally {
      setDcSwitchBusy(null);
    }
  }

  // --- UDP-Steuerung (Marstek lokale API) ---
  async function udpMode(sp: Speicher, mode: string, withPower = false) {
    setBusy(sp.sourceId); setMsg((m) => ({ ...m, [sp.sourceId]: "" }));
    try {
      const body: any = { mode };
      if (withPower) { body.power = udpPower; body.durationS = udpDuration; }
      const res = await fetch("/api/marstek/mode", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      setMsg((m) => ({ ...m, [sp.sourceId]: j.ok ? `Modus „${mode}" gesetzt.` : `Fehler: ${j.error ?? "unbekannt"}` }));
      setTimeout(load, 800);
    } catch (e: any) {
      setMsg((m) => ({ ...m, [sp.sourceId]: `Fehler: ${e?.message ?? e}` }));
    } finally { setBusy(null); }
  }

  // --- Modbus-Steuerung ---
  async function modbusForce(sp: Speicher, mode: "none" | "charge" | "discharge") {
    setBusy(sp.sourceId); setMsg((m) => ({ ...m, [sp.sourceId]: "" }));
    try {
      const body: any = { sourceId: sp.sourceId, mode };
      if (mode !== "none") {
        if (power[sp.sourceId] != null) body.powerW = power[sp.sourceId];
        if (toSoc[sp.sourceId] != null) body.toSoc = toSoc[sp.sourceId];
      }
      const res = await fetch("/api/acspeicher/modbus/force", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      const lbl = mode === "charge" ? "Laden" : mode === "discharge" ? "Entladen" : "Automatik";
      setMsg((m) => ({ ...m, [sp.sourceId]: j.ok ? `${lbl} gesetzt.` : `Fehler: ${j.error ?? "unbekannt"}` }));
      setTimeout(load, 1000);
    } catch (e: any) {
      setMsg((m) => ({ ...m, [sp.sourceId]: `Fehler: ${e?.message ?? e}` }));
    } finally { setBusy(null); }
  }

  async function modbusBackup(sp: Speicher, on: boolean) {
    setBusy(sp.sourceId); setMsg((m) => ({ ...m, [sp.sourceId]: "" }));
    try {
      const res = await fetch("/api/acspeicher/modbus/backup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: sp.sourceId, on }),
      });
      const j = await res.json();
      setMsg((m) => ({ ...m, [sp.sourceId]: j.ok ? `Backup ${on ? "aktiviert" : "deaktiviert"}.` : `Fehler: ${j.error ?? "unbekannt"}` }));
      setTimeout(load, 1000);
    } catch (e: any) {
      setMsg((m) => ({ ...m, [sp.sourceId]: `Fehler: ${e?.message ?? e}` }));
    } finally { setBusy(null); }
  }

  async function zendureMode(sp: Speicher, mode: "charge" | "discharge" | "idle") {
    setBusy(sp.sourceId); setMsg((m) => ({ ...m, [sp.sourceId]: "" }));
    try {
      const body: any = { sourceId: sp.sourceId, mode };
      if (mode !== "idle" && power[sp.sourceId] != null) body.powerW = power[sp.sourceId];
      const res = await fetch("/api/acspeicher/zendure/mode", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      const lbl = mode === "charge" ? "Laden" : mode === "discharge" ? "Entladen" : "Ruhe";
      setMsg((m) => ({ ...m, [sp.sourceId]: j.ok ? `${lbl} gesetzt.` : `Fehler: ${j.error ?? "unbekannt"}` }));
      setTimeout(load, 1000);
    } catch (e: any) {
      setMsg((m) => ({ ...m, [sp.sourceId]: `Fehler: ${e?.message ?? e}` }));
    } finally { setBusy(null); }
  }

  if (!list) {
    return <div className="page"><h2>Speicher</h2><p className="hint">Lade Speicherdaten…</p></div>;
  }
  const hasDc = (dcList?.length ?? 0) > 0;
  if ((!configured || list.length === 0) && !hasDc) {
    return (
      <div className="page">
        <h2>Speicher</h2>
        <p className="hint">
          Kein Speicher aktiv. Lege unter Einstellungen → Quellen eine Quelle mit
          der Rolle „AC-Batterie" (eigene Anbindung) oder „DC-Batterie"
          (verweist auf PV- und Batterie-Quelle) an.
        </p>
      </div>
    );
  }

  // Alle Weboberflächen-Links in einer gemeinsamen Box: AC-Speicher-Links plus
  // die von den DC-Speichern gemeldeten Links ihrer verknüpften Quellen.
  const allLinksRaw = [
    ...acLinks,
    ...(dcList ?? []).flatMap((sp) => sp.links.map((l) => ({ ...l, from: sp.label }))),
  ];
  // Doppelte URLs entfernen.
  const seenLink = new Set<string>();
  const allLinks = allLinksRaw.filter((l) => {
    if (seenLink.has(l.url)) return false; seenLink.add(l.url); return true;
  });

  return (
    <div className="page">
      <h2>Speicher</h2>
      {allLinks.length > 0 && (
        <div className="source-links-block">
          <div className="source-links-title">Weboberflächen der Speicher</div>
          <div className="source-links-list">
            {allLinks.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer"
                className="consumer-link" title={`${l.from}: ${l.url}`}>
                🔗 {l.from}: {l.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="chart-title" style={{ marginTop: 8, display: "flex", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>AC-Speicher</h3>
          <div className="tile-sort-bar" style={{ margin: 0 }}>
            <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} />
          </div>
        </div>
      )}
      {sortMode && <p className="tile-sort-hint">Kacheln innerhalb eines Speichers ziehen, um die Reihenfolge zu ändern. Die Anordnung wird je Speicher gespeichert.</p>}
      {list.map((sp) => (
        <section
          className={`card${dragItem?.cat === "ac" && dragItem.id === sp.sourceId ? " spk-dragging" : ""}`}
          key={sp.sourceId}
          style={{ marginBottom: 18 }}
          draggable={!sortMode}
          onDragStart={() => { if (!sortMode) setDragItem({ cat: "ac", id: sp.sourceId }); }}
          onDragOver={(e) => { if (!sortMode && dragItem?.cat === "ac") e.preventDefault(); }}
          onDrop={(e) => { if (!sortMode) { e.preventDefault(); if (dragItem?.cat === "ac") reorder("ac", dragItem.id, sp.sourceId); setDragItem(null); } }}
          onDragEnd={() => setDragItem(null)}
        >
          <div className="chart-title">
            <span>
              <span className="spk-grip" title="Zum Sortieren ziehen">⠿</span>
              {sp.kuerzel && <span className="spk-kuerzel">{sp.kuerzel}</span>}
              {sp.label}
            </span>
          </div>

          {sp.online === false && (
            <p className="hint" style={{ color: "#c0392b" }}>
              Nicht erreichbar{sp.error ? ` (${sp.error})` : ""}.
            </p>
          )}

          {/* UDP: strukturierte Kacheln */}
          {sp.connection === "udp" && sp.online !== false && (
            <SortableGrid bereich={`acspeicher-${sp.sourceId}`} className="mk-tiles" sortMode={sortMode} items={[
              { id: "soc", node: <Tile label="Ladezustand" value={`${fmt(sp.soc)} %`} accent /> },
              { id: "batPower", node: <Tile label="Batterie-Leistung" value={`${fmt(Math.abs(sp.batPowerW ?? 0))} W`}
                    sub={(sp.batPowerW ?? 0) > 5 ? "lädt" : (sp.batPowerW ?? 0) < -5 ? "entlädt" : "Ruhe"} /> },
              { id: "ongrid", node: <Tile label="Netz-Leistung" value={`${fmt(sp.ongridPowerW)} W`} /> },
              { id: "pv", node: <Tile label="PV-Leistung" value={`${fmt(sp.pvPowerW)} W`} /> },
              { id: "temp", node: <Tile label="Temperatur" value={`${fmt(sp.tempC, 1)} °C`} /> },
              { id: "mode", node: <Tile label="Betriebsmodus" value={sp.mode ?? "—"} /> },
            ]} />
          )}

          {/* Modbus / REST / MQTT: Werte-Kacheln aus fields */}
          {sp.connection !== "udp" && sp.online !== false && sp.fields && sp.fields.length > 0 && (
            <SortableGrid bereich={`acspeicher-${sp.sourceId}`} className="mk-tiles" sortMode={sortMode} items={sp.fields.map((f, i) => ({
              id: f.label || `feld-${i}`,
              node: <Tile label={f.label}
                    value={typeof f.value === "boolean" ? (f.value ? "ja" : "nein") : `${fmt(typeof f.value === "number" ? f.value : NaN, (f.unit === "kWh" || f.unit === "V" || f.unit === "A" || f.unit === "°C") ? (f.unit === "kWh" ? 2 : 1) : 0)}${typeof f.value === "number" ? "" : String(f.value)} ${f.unit ?? ""}`.trim()}
                    accent={f.label.includes("Ladezustand")} />,
            }))} />
          )}

          {/* Status der einzelnen Batteriemodule (Marstek Venus über Modbus) */}
          {sp.modules && sp.modules.length > 0 && (
            <div className="mk-modules">
              <div className="chart-title" style={{ fontSize: 14, marginTop: 10 }}>Batteriemodule</div>
              <div className="table-scroll">
                <table className="ct-bal-table mk-modules-table">
                  <thead>
                    <tr>
                      <th className="mk-mod-col">Modul</th>
                      <th>Ladestand</th>
                      <th>Zelle min</th>
                      <th>Zelle max</th>
                      <th>Δ (Ungl.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sp.modules.map((m) => (
                      <tr key={m.index}>
                        <td className="mk-mod-col">Modul {m.index}</td>
                        <td>{m.soc != null ? `${nf(m.soc, 1)} %` : "–"}</td>
                        <td>{m.cellMinV != null ? `${nf(m.cellMinV, 3)} V` : "–"}</td>
                        <td>{m.cellMaxV != null ? `${nf(m.cellMaxV, 3)} V` : "–"}</td>
                        <td className={m.imbalanceV != null && m.imbalanceV >= 0.05 ? "ct-bal-neg" : ""}>
                          {m.imbalanceV != null ? `${nf(m.imbalanceV * 1000, 0)} mV` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Steuerung UDP */}
          {sp.control === "udp" && (
            <div style={{ marginTop: 12 }}>
              <div className="chart-title" style={{ fontSize: 14 }}>Steuerung</div>
              <div className="mk-mode-btns">
                {UDP_MODES.map((m) => (
                  <button key={m} className={`mk-mode-btn${sp.mode === m ? " active" : ""}`}
                          disabled={busy === sp.sourceId}
                          onClick={() => udpMode(sp, m, m === "Passive" || m === "Manual")}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="mk-power-ctrl">
                <label>Leistung (W) – positiv = Entladen, negativ = Laden
                  <input type="number" step={100} value={udpPower} onChange={(e) => setUdpPower(Number(e.target.value))} />
                </label>
                <label>Dauer (s, für Passive)
                  <input type="number" step={300} min={0} value={udpDuration} onChange={(e) => setUdpDuration(Number(e.target.value))} />
                </label>
                <div className="mk-power-actions">
                  <button disabled={busy === sp.sourceId} onClick={() => { setUdpPower(-Math.abs(udpPower) || -1000); udpMode(sp, "Passive", true); }}>Laden starten</button>
                  <button disabled={busy === sp.sourceId} onClick={() => { setUdpPower(Math.abs(udpPower) || 1000); udpMode(sp, "Passive", true); }}>Entladen starten</button>
                </div>
              </div>
            </div>
          )}

          {/* Steuerung Modbus */}
          {sp.control === "modbus" && (
            <div style={{ marginTop: 12 }}>
              <div className="chart-title" style={{ fontSize: 14 }}>Steuerung (Modbus)</div>
              <p className="hint">
                Erzwingt Laden/Entladen mit optionaler Leistung und Ziel-Ladezustand,
                oder gibt die Regelung an die Automatik zurück. Der Speicher wird dazu
                in den RS485-Steuermodus versetzt.
              </p>
              <div className="mk-power-ctrl">
                <label>Leistung (W)
                  <input type="number" step={100} min={0}
                         value={power[sp.sourceId] ?? 800}
                         onChange={(e) => setPower((p) => ({ ...p, [sp.sourceId]: Number(e.target.value) }))} />
                </label>
                <label>Ziel-Ladezustand (%)
                  <input type="number" step={5} min={0} max={100}
                         value={toSoc[sp.sourceId] ?? 90}
                         onChange={(e) => setToSoc((p) => ({ ...p, [sp.sourceId]: Number(e.target.value) }))} />
                </label>
                <div className="mk-power-actions">
                  <button disabled={busy === sp.sourceId} onClick={() => modbusForce(sp, "charge")}>Laden</button>
                  <button disabled={busy === sp.sourceId} onClick={() => modbusForce(sp, "discharge")}>Entladen</button>
                  <button disabled={busy === sp.sourceId} onClick={() => modbusForce(sp, "none")}>Automatik</button>
                </div>
              </div>
              <div className="mk-mode-btns" style={{ marginTop: 8 }}>
                <button className="mk-mode-btn" disabled={busy === sp.sourceId} onClick={() => modbusBackup(sp, true)}>Backup an</button>
                <button className="mk-mode-btn" disabled={busy === sp.sourceId} onClick={() => modbusBackup(sp, false)}>Backup aus</button>
                {sp.forceMode != null && (
                  <span className="hint" style={{ marginLeft: 8 }}>
                    aktuell: {sp.forceMode === 1 ? "Laden" : sp.forceMode === 2 ? "Entladen" : "Automatik"}
                    {sp.chargeToSoc != null ? ` · Ziel ${sp.chargeToSoc}%` : ""}
                    {sp.backup != null ? ` · Backup ${sp.backup ? "an" : "aus"}` : ""}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Steuerung Zendure (MQTT) */}
          {sp.control === "zendure" && (
            <div style={{ marginTop: 12 }}>
              <div className="chart-title" style={{ fontSize: 14 }}>Steuerung (Zendure)</div>
              <p className="hint">
                Setzt Lade-/Entladeleistung per MQTT. „Ruhe" stoppt beide
                Richtungen. Die Werte werden an den Speicher gesendet; die
                Rückmeldung kommt über das Monitoring-Topic.
              </p>
              <div className="mk-power-ctrl">
                <label>Leistung (W)
                  <input type="number" step={100} min={0}
                    value={power[sp.sourceId] ?? 300}
                    onChange={(e) => setPower((p) => ({ ...p, [sp.sourceId]: Number(e.target.value) }))} />
                </label>
                <div className="mk-power-actions">
                  <button disabled={busy === sp.sourceId} onClick={() => zendureMode(sp, "charge")}>Laden</button>
                  <button disabled={busy === sp.sourceId} onClick={() => zendureMode(sp, "discharge")}>Entladen</button>
                  <button disabled={busy === sp.sourceId} onClick={() => zendureMode(sp, "idle")}>Ruhe</button>
                </div>
              </div>
            </div>
          )}

          {/* Schaltbarer AC-Speicher (z. B. über Shelly Pro 2PM): Ein/Aus des zuständigen Kanals */}
          {sp.switchable && (() => {
            const swId = sp.switchSourceId ?? sp.sourceId;
            const ch = sp.switchChannel ?? 0;
            const state = sp.switchState ?? null;
            const cls = state === true ? " dc-switch-on" : state === false ? " dc-switch-off" : " dc-switch-unknown";
            return (
              <div style={{ marginTop: 12 }}>
                <div className="chart-title" style={{ fontSize: 14 }}>Schalter</div>
                <div className="dc-switch-row">
                  <div className={`dc-switch${cls}`}>
                    <span className="dc-switch-label">
                      <span className="dc-switch-dot" title={state === true ? "eingeschaltet" : state === false ? "ausgeschaltet" : "Zustand unbekannt"} />
                      Ausgang
                      <span className="dc-switch-state-text">
                        {state === true ? "AN" : state === false ? "AUS" : "?"}
                      </span>
                    </span>
                    <span className="dc-switch-btns">
                      <button className={`dc-sw-on${state === true ? " active" : ""}`}
                        disabled={dcSwitchBusy === `${swId}:${ch}`}
                        onClick={() => dcSwitch(swId, ch, true)}>Ein</button>
                      <button className={`dc-sw-off${state === false ? " active" : ""}`}
                        disabled={dcSwitchBusy === `${swId}:${ch}`}
                        onClick={() => dcSwitch(swId, ch, false)}>Aus</button>
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* REST/MQTT ohne Steuerung UND nicht schaltbar: Monitoring-Hinweis */}
          {sp.control === "none" && !sp.switchable && (
            <p className="hint" style={{ marginTop: 8, fontSize: 12 }}>
              Über {sp.connection.toUpperCase()} angebunden – nur Monitoring. Eine
              Ansteuerung ist bei dieser Anbindung nicht vorgesehen.
            </p>
          )}

          {msg[sp.sourceId] && <p className="hint" style={{ marginTop: 6 }}>{msg[sp.sourceId]}</p>}

          {/* UDP-Rohdaten */}
          {sp.raw && sp.raw.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="hint" style={{ cursor: "pointer" }}>Alle ausgelesenen Werte</summary>
              <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="wp-series-table">
                <tbody>
                  <tr><th>Feld</th><th>Wert</th></tr>
                  {sp.raw.map((f) => (
                    <tr key={f.key}>
                      <td style={{ textAlign: "left" }}>{f.label}</td>
                      <td>{typeof f.value === "boolean" ? (f.value ? "ja" : "nein") : (typeof f.value === "number" ? `${fmt(f.value, Number.isInteger(f.value) ? 0 : 3)}${f.unit ? " " + f.unit : ""}` : `${f.value}${f.unit ? " " + f.unit : ""}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </details>
          )}

          {sp.device && (
            <p className="hint" style={{ marginTop: 8 }}>
              Gerät: {sp.device.model ?? "?"} · Firmware {sp.device.firmware ?? "?"} · IP {sp.device.ip ?? "?"}
            </p>
          )}
        </section>
      ))}

      {hasDc && (
        <>
          <h3 style={{ marginTop: list.length > 0 ? 28 : 0 }}>DC-Speicher</h3>
          {dcList!.map((sp) => (
            <section
              className={`card${dragItem?.cat === "dc" && dragItem.id === sp.id ? " spk-dragging" : ""}`}
              key={sp.id}
              style={{ marginBottom: 18 }}
              draggable
              onDragStart={() => setDragItem({ cat: "dc", id: sp.id })}
              onDragOver={(e) => { if (dragItem?.cat === "dc") e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragItem?.cat === "dc") reorder("dc", dragItem.id, sp.id); setDragItem(null); }}
              onDragEnd={() => setDragItem(null)}
            >
              <div className="chart-title">
                <span>
                  <span className="spk-grip" title="Zum Sortieren ziehen">⠿</span>
                  {sp.kuerzel && <span className="spk-kuerzel">{sp.kuerzel}</span>}
                  {sp.label}
                </span>
              </div>
              {!sp.online && (
                <p className="hint" style={{ color: "#c0392b" }}>
                  Keine Live-Daten von den verlinkten Quellen.
                </p>
              )}
              <div className="mk-tiles">
                <Tile label="Ladeleistung" value={sp.ladeW != null ? `${fmt(sp.ladeW)} W` : "—"}
                  sub={sp.linkedPv?.label} accent />
                <Tile label="Entladeleistung" value={sp.entladeW != null ? `${fmt(Math.abs(sp.entladeW))} W` : "—"}
                  sub={sp.linkedBatteryOut?.label} accent />
                {sp.soc != null && <Tile label="Ladezustand" value={`${fmt(sp.soc)} %`} />}
              </div>

              {sp.fields.length > 0 && (
                <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead><tr><th>Messwert</th><th>Wert</th><th>Quelle</th></tr></thead>
                  <tbody>
                    {sp.fields.map((f, i) => (
                      <tr key={i}>
                        <td>{f.label}</td>
                        <td>{typeof f.value === "boolean" ? (f.value ? "ja" : "nein") : (typeof f.value === "number" ? `${fmt(f.value, Number.isInteger(f.value) ? 0 : 3)}${f.unit ? " " + f.unit : ""}` : `${f.value}${f.unit ? " " + f.unit : ""}`)}</td>
                        <td style={{ color: "#888" }}>{f.from ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}

              {sp.switches.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="chart-title" style={{ fontSize: 14 }}>Schaltbare Quellen</div>
                  <div className="dc-switch-row">
                    {sp.switches.map((sw) => {
                      const state = sw.state ?? null; // true=an, false=aus, null=unbekannt
                      const cls = state === true ? " dc-switch-on" : state === false ? " dc-switch-off" : " dc-switch-unknown";
                      return (
                        <div key={sw.id} className={`dc-switch${cls}`}>
                          <span className="dc-switch-label">
                            <span className="dc-switch-dot" title={state === true ? "eingeschaltet" : state === false ? "ausgeschaltet" : "Zustand unbekannt"} />
                            {sw.label}
                            <span className="dc-switch-state-text">
                              {state === true ? "AN" : state === false ? "AUS" : "?"}
                            </span>
                          </span>
                          <span className="dc-switch-btns">
                            <button className={`dc-sw-on${state === true ? " active" : ""}`}
                              disabled={dcSwitchBusy === `${sw.id}:${sw.channel}`}
                              onClick={() => dcSwitch(sw.id, sw.channel, true)}>Ein</button>
                            <button className={`dc-sw-off${state === false ? " active" : ""}`}
                              disabled={dcSwitchBusy === `${sw.id}:${sw.channel}`}
                              onClick={() => dcSwitch(sw.id, sw.channel, false)}>Aus</button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          ))}
        </>
      )}

      <SpeicherVerluste />
    </div>
  );
}

// Wirkungsgrad-/Verlustauswertung je Speicher: ab wählbarem Stichtag werden
// Lade- und Entlademengen (viertelstunden-basiert) gegenübergestellt und der
// Anteil der zurückgewonnenen Energie (Wirkungsgrad) sowie der Verlust
// ausgewiesen – je Tag oder Monat.
type VerlusteReihe = {
  periode: string;
  ladung: number;
  entladung: number;
  wirkungsgradProzent: number | null;
  verlustProzent: number | null;
};
type VerlusteSpeicher = {
  id: string;
  label: string;
  typ: string;
  evaluable: boolean;
  hatDaten: boolean;
  hinweis: string | null;
  reihen: VerlusteReihe[];
};

function isoHeute(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function SpeicherVerluste() {
  // Standard-Stichtag: erster Tag des aktuellen Monats.
  const heute = isoHeute();
  const [von, setVon] = useState(`${heute.slice(0, 7)}-01`);
  const [bis, setBis] = useState(heute);
  const [gran, setGran] = useState<"tag" | "monat">("monat");
  const [data, setData] = useState<VerlusteSpeicher[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const laden = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetch(`/api/speicherverluste?von=${von}&bis=${bis}&granularitaet=${gran}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setErr(j.error); setData(null); }
        else setData(j.speicher ?? []);
      })
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [von, bis, gran]);

  useEffect(() => { laden(); }, [laden]);

  return (
    <>
      <h3 style={{ marginTop: 28 }}>Speicherverluste / Wirkungsgrad</h3>
      <section className="card" style={{ marginBottom: 18 }}>
        <p className="hint" style={{ marginTop: 0 }}>
          Vergleich der ins Haus/Netz zurückgegebenen Energie (Entladung) mit der
          eingespeicherten Energie (Ladung) ab dem gewählten Stichtag. Der
          Wirkungsgrad ist der Anteil der zurückgewonnenen Energie, der Verlust
          entsprechend 100 % minus Wirkungsgrad. Grundlage sind die
          viertelstündlich erfassten Energiemengen (leistungsbasierte Näherung).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="hint">Stichtag (ab)</span>
            <input type="date" value={von} max={bis} onChange={(e) => setVon(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="hint">bis</span>
            <input type="date" value={bis} min={von} max={heute} onChange={(e) => setBis(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="hint">Auflösung</span>
            <select value={gran} onChange={(e) => setGran(e.target.value as "tag" | "monat")}>
              <option value="monat">je Monat</option>
              <option value="tag">je Tag</option>
            </select>
          </label>
        </div>

        {err && <p className="hint" style={{ color: "#c0392b" }}>{err}</p>}
        {loading && <p className="hint">Lade Auswertung…</p>}

        {!loading && data && data.length === 0 && (
          <p className="hint">Keine Speicher konfiguriert.</p>
        )}

        {!loading && data && data.map((sp) => {
          // Gesamtsummen über den Zeitraum für die Kopfzeile.
          const sumL = sp.reihen.reduce((a, r) => a + r.ladung, 0);
          const sumE = sp.reihen.reduce((a, r) => a + r.entladung, 0);
          const gesamtWg = sumL > 0 ? (sumE / sumL) * 100 : null;
          return (
            <div key={sp.id} style={{ marginBottom: 20 }}>
              <div className="chart-title">
                {sp.label} <span className="hint">({sp.typ})</span>
              </div>
              {!sp.evaluable ? (
                <p className="hint" style={{ color: "#b8860b" }}>{sp.hinweis}</p>
              ) : !sp.hatDaten ? (
                <p className="hint">Für den gewählten Zeitraum liegen keine Lade-/Entladedaten vor.</p>
              ) : (
                <>
                  <div className="mk-tiles" style={{ marginBottom: 8 }}>
                    <Tile label="Eingespeichert (Summe)" value={`${nf(sumL, 1)} kWh`} />
                    <Tile label="Zurückgewonnen (Summe)" value={`${nf(sumE, 1)} kWh`} />
                    <Tile label="Wirkungsgrad gesamt"
                      value={gesamtWg == null ? "—" : `${nf(gesamtWg, 1)} %`} accent />
                    <Tile label="Verlust gesamt"
                      value={gesamtWg == null ? "—" : `${nf(100 - gesamtWg, 1)} %`} />
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{gran === "tag" ? "Tag" : "Monat"}</th>
                          <th>Ladung (kWh)</th>
                          <th>Entladung (kWh)</th>
                          <th>Wirkungsgrad</th>
                          <th>Verlust</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sp.reihen.filter((r) => r.ladung > 0 || r.entladung > 0).map((r) => (
                          <tr key={r.periode}>
                            <td>{r.periode}</td>
                            <td>{nf(r.ladung, 3)}</td>
                            <td>{nf(r.entladung, 3)}</td>
                            <td>{r.wirkungsgradProzent == null ? "—" : `${r.wirkungsgradProzent} %`}</td>
                            <td>{r.verlustProzent == null ? "—" : `${r.verlustProzent} %`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`mk-tile${accent ? " mk-tile-accent" : ""}`}>
      <div className="mk-tile-label">{label}</div>
      <div className="mk-tile-value">{value}</div>
      {sub && <div className="mk-tile-sub">{sub}</div>}
    </div>
  );
}
