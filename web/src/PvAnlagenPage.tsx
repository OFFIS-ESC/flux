// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";
import { nf } from "./chartUtils";
import { PvPrognoseChart } from "./PvPrognoseChart";
import { StandortBlock } from "./StandortBlock";

// --- Typen (Spiegel des Backend-Modells in pvanlagen.ts) ---
interface PvString {
  id: string;
  nr: number;
  moduleCount: number;
  moduleWp: number;
  azimuth: number; // -180..180, 0 = Süd
  tilt: number;    // 0..90 gegenüber horizontal
}
interface PvAnlage {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  sourceIds: string[];
  strings: PvString[];
}

const uid = () => Math.random().toString(36).slice(2, 10);

function stringKwp(s: PvString): number {
  return (s.moduleCount * s.moduleWp) / 1000;
}

// Azimut-Himmelsrichtung als Klartext-Hilfe.
function azimuthHint(az: number): string {
  const dirs: Array<[number, string]> = [
    [-180, "Nord"], [-135, "Nordost"], [-90, "Ost"], [-45, "Südost"],
    [0, "Süd"], [45, "Südwest"], [90, "West"], [135, "Nordwest"], [180, "Nord"],
  ];
  let best = dirs[0];
  for (const d of dirs) if (Math.abs(az - d[0]) < Math.abs(az - best[0])) best = d;
  return best[1];
}

export function PvAnlagenPage() {
  const [anlagen, setAnlagen] = useState<PvAnlage[] | null>(null);
  const [pvSources, setPvSources] = useState<Array<{ id: string; label: string }>>([]);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState("");

  const [fcBusy, setFcBusy] = useState(false);
  const [fcErr, setFcErr] = useState("");

  useEffect(() => {
    fetch("/api/pvanlagen").then((r) => r.json()).then(setAnlagen).catch(() => setAnlagen([]));
    fetch("/api/sources").then((r) => r.json()).then((arr: any[]) => {
      setPvSources(arr.filter((s) => s.role === "pv").map((s) => ({ id: s.id, label: s.label ?? s.id })));
    }).catch(() => { /* ignore */ });
  }, []);

  const persist = useCallback((next: PvAnlage[]) => {
    setAnlagen(next);
    fetch("/api/pvanlagen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anlagen: next }),
    }).then(() => {
      setSaveMsg("Gespeichert");
      setTimeout(() => setSaveMsg(""), 1500);
    }).catch(() => setSaveMsg("Speichern fehlgeschlagen"));
  }, []);

  if (!anlagen) return <div className="page"><p>Lade …</p></div>;

  const update = (id: string, patch: Partial<PvAnlage>) =>
    persist(anlagen.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const addAnlage = () =>
    persist([...anlagen, { id: uid(), name: `Anlage ${anlagen.length + 1}`, sourceIds: [], strings: [] }]);

  const removeAnlage = (id: string) =>
    persist(anlagen.filter((a) => a.id !== id));

  const addString = (aId: string) => {
    const a = anlagen.find((x) => x.id === aId)!;
    const nr = (a.strings.reduce((m, s) => Math.max(m, s.nr), 0)) + 1;
    update(aId, { strings: [...a.strings, { id: uid(), nr, moduleCount: 1, moduleWp: 400, azimuth: 0, tilt: 30 }] });
  };
  const removeString = (aId: string, sId: string) => {
    const a = anlagen.find((x) => x.id === aId)!;
    update(aId, { strings: a.strings.filter((s) => s.id !== sId) });
  };
  const updateString = (aId: string, sId: string, patch: Partial<PvString>) => {
    const a = anlagen.find((x) => x.id === aId)!;
    update(aId, { strings: a.strings.map((s) => (s.id === sId ? { ...s, ...patch } : s)) });
  };

  // Quelle einer Anlage zuordnen (Drag&Drop). Eine Quelle gehört zu genau einer
  // Anlage – beim Zuordnen aus allen anderen entfernen.
  const assignSource = (aId: string, sourceId: string) => {
    persist(anlagen.map((a) => ({
      ...a,
      sourceIds: a.id === aId
        ? Array.from(new Set([...a.sourceIds, sourceId]))
        : a.sourceIds.filter((s) => s !== sourceId),
    })));
  };
  const unassignSource = (aId: string, sourceId: string) => {
    const a = anlagen.find((x) => x.id === aId)!;
    update(aId, { sourceIds: a.sourceIds.filter((s) => s !== sourceId) });
  };

  const assignedIds = new Set(anlagen.flatMap((a) => a.sourceIds));
  const unassigned = pvSources.filter((s) => !assignedIds.has(s.id));
  const anlageKwp = (a: PvAnlage) => a.strings.reduce((sum, s) => sum + stringKwp(s), 0);

  const runForecast = () => {
    setFcBusy(true); setFcErr("");
    fetch("/api/pvanlagen/forecast").then((r) => r.json()).then((j) => {
      if (!j.ok) setFcErr(j.error ?? "Prognose fehlgeschlagen");
    }).catch((e) => setFcErr(String(e))).finally(() => setFcBusy(false));
  };

  return (
    <div className="page pvanlagen-page">
      <h2>PV-Anlagendaten und Prognosen</h2>
      <p className="hint">
        Technische Stammdaten der PV-Anlagen. Je Anlage lassen sich beliebig viele
        Strings anlegen und Quellen mit der Rolle „PV-Erzeugung" zuordnen. Aus den
        Strings (Leistung, Ausrichtung, Neigung) und dem gemeinsamen Standort wird
        eine Ertragsprognose für heute und morgen über forecast.solar abgerufen.
      </p>

      {/* Gemeinsamer Standort aller Anlagen (mit Karte) */}
      <StandortBlock />

      {/* Nicht zugeordnete PV-Quellen: Ablage zum Ziehen */}
      <div className="card pv-pool">
        <h3>Nicht zugeordnete PV-Quellen</h3>
        {unassigned.length === 0
          ? <p className="hint">Alle PV-Quellen sind einer Anlage zugeordnet.</p>
          : (
            <div className="pv-chips">
              {unassigned.map((s) => (
                <span
                  key={s.id}
                  className="pv-chip"
                  draggable
                  onDragStart={() => setDragSource(s.id)}
                  onDragEnd={() => setDragSource(null)}
                >⠿ {s.label}</span>
              ))}
            </div>
          )}
      </div>

      {anlagen.map((a) => (
        <div
          key={a.id}
          className={"card pv-anlage" + (dragSource ? " pv-droptarget" : "")}
          onDragOver={(e) => { if (dragSource) e.preventDefault(); }}
          onDrop={() => { if (dragSource) { assignSource(a.id, dragSource); setDragSource(null); } }}
        >
          <div className="pv-anlage-head">
            <input
              className="pv-name"
              value={a.name}
              onChange={(e) => update(a.id, { name: e.target.value })}
            />
            <span className="pv-kwp">{nf(anlageKwp(a), 2)} kWp</span>
            <button className="pv-del" onClick={() => removeAnlage(a.id)}>Anlage löschen</button>
          </div>

          {/* Zugeordnete Quellen */}
          <div className="pv-assigned">
            <span className="pv-assigned-label">Zugeordnete Quellen:</span>
            {a.sourceIds.length === 0
              ? <span className="hint"> Quelle hierher ziehen</span>
              : a.sourceIds.map((sid) => {
                  const label = pvSources.find((p) => p.id === sid)?.label ?? sid;
                  return (
                    <span key={sid} className="pv-chip pv-chip-assigned">
                      {label}
                      <button className="pv-chip-x" onClick={() => unassignSource(a.id, sid)} title="Zuordnung entfernen">×</button>
                    </span>
                  );
                })}
          </div>

          {/* Strings */}
          <div className="pv-strings">
            <div className="pv-strings-head">
              <span>Strings</span>
              <button onClick={() => addString(a.id)}>+ String</button>
            </div>
            {a.strings.length === 0 && <p className="hint">Noch keine Strings angelegt.</p>}
            {a.strings.map((s) => (
              <div key={s.id} className="pv-string">
                <span className="pv-string-nr">#{s.nr}</span>
                <label>Module
                  <input type="number" min="1" value={s.moduleCount}
                    onChange={(e) => updateString(a.id, s.id, { moduleCount: Math.max(0, Number(e.target.value)) })} />
                </label>
                <label>Modulleistung (Wp)
                  <input type="number" min="0" value={s.moduleWp}
                    onChange={(e) => updateString(a.id, s.id, { moduleWp: Math.max(0, Number(e.target.value)) })} />
                </label>
                <span className="pv-string-kwp">= {nf(stringKwp(s), 2)} kWp</span>
                <label>Ausrichtung (°)
                  <input type="number" min="-180" max="180" value={s.azimuth}
                    onChange={(e) => updateString(a.id, s.id, { azimuth: Number(e.target.value) })} />
                </label>
                <span className="pv-az-hint">{azimuthHint(s.azimuth)}</span>
                <label>Neigung (°)
                  <input type="number" min="0" max="90" value={s.tilt}
                    onChange={(e) => updateString(a.id, s.id, { tilt: Math.min(90, Math.max(0, Number(e.target.value))) })} />
                </label>
                <button className="pv-string-del" onClick={() => removeString(a.id, s.id)}>löschen</button>
              </div>
            ))}
            <p className="hint pv-az-legend">
              Ausrichtung: -90 = Ost, 0 = Süd, 90 = West, ±180 = Nord.
              Neigung: 0 = flach/horizontal, 90 = senkrecht.
            </p>
          </div>
        </div>
      ))}

      <div className="pv-actions">
        <button onClick={addAnlage}>+ Anlage hinzufügen</button>
        {saveMsg && <span className="pv-savemsg">{saveMsg}</span>}
      </div>

      {/* Prognose */}
      {/* Vereinigter Prognose-Block: KPIs, Anlagenzeilen, 2-Tage-Chart */}
      <PvPrognoseChart onRefresh={runForecast} busy={fcBusy} err={fcErr} />
    </div>
  );
}
