// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

type LevelName = "debug" | "info" | "warn" | "error";
interface LogEntry {
  id: number;
  ts: string;
  level: number;
  levelName: LevelName;
  source: string;
  msg: string;
}
interface LogResponse {
  logs: LogEntry[];
  counts: Record<LevelName, number>;
  minStoreLevel: number;
}

const LEVELS: { name: LevelName; value: number; label: string; color: string }[] = [
  { name: "debug", value: 10, label: "Debug", color: "#7a7a7a" },
  { name: "info", value: 20, label: "Info", color: "#2d6a00" },
  { name: "warn", value: 30, label: "Warnung", color: "#c77800" },
  { name: "error", value: 40, label: "Fehler", color: "#b00020" },
];

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

export function DebugPage() {
  const [data, setData] = useState<LogResponse | null>(null);
  // Anzeige-Filter (ab welchem Level wird in der Tabelle gezeigt)
  const [viewMin, setViewMin] = useState<number>(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Filter nach Quelle (z. B. poll, spot, growatt). "" = alle.
  const [srcFilter, setSrcFilter] = useState<string>("");

  function load() {
    fetch(`/api/logs?min=${viewMin}&limit=2000`)
      .then((r) => r.json())
      .then((d: LogResponse) => setData(d))
      .catch(() => {});
  }

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMin, autoRefresh]);

  async function setStoreLevel(level: number) {
    await fetch("/api/logs/level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    load();
  }

  async function clearAll() {
    if (!confirm("Wirklich alle Logmeldungen löschen?")) return;
    await fetch("/api/logs", { method: "DELETE" });
    load();
  }

  const counts = data?.counts ?? { debug: 0, info: 0, warn: 0, error: 0 };
  const storeLevel = data?.minStoreLevel ?? 20;
  const allLogs = data?.logs ?? [];
  // Vorkommende Quellen (alphabetisch) für das Filter-Dropdown.
  const sources = Array.from(new Set(allLogs.map((l) => l.source).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "de", { sensitivity: "base" })
  );
  const logs = srcFilter ? allLogs.filter((l) => l.source === srcFilter) : allLogs;
  const colorOf = (n: LevelName) => LEVELS.find((l) => l.name === n)?.color ?? "#555";

  return (
    <div className="page">
      <h2>Debugging</h2>
      <p className="hint">
        Server-Logmeldungen mit Zeitstempel. Statt auf die Konsole werden sie in
        der Datenbank gespeichert (Ringpuffer, max. 5000 Einträge). Über das
        Speicher-Level lässt sich steuern, welche Meldungen überhaupt
        festgehalten werden.
      </p>

      {/* Einstellungen */}
      <section className="card dbg-controls">
        <h3>Einstellungen</h3>
        <div className="dbg-row">
          <label>
            Speicher-Level (ab welchem Level gespeichert wird):{" "}
            <select
              value={storeLevel}
              onChange={(e) => setStoreLevel(Number(e.target.value))}
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label} und höher
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dbg-row">
          <label>
            Anzeige ab Level:{" "}
            <select value={viewMin} onChange={(e) => setViewMin(Number(e.target.value))}>
              <option value={0}>alle</option>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label} und höher
                </option>
              ))}
            </select>
          </label>
          <label className="dbg-auto">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />{" "}
            automatisch aktualisieren
          </label>
          <button onClick={load}>Aktualisieren</button>
          <button onClick={clearAll} className="src-del">
            Alle löschen
          </button>
        </div>
        <div className="dbg-badges">
          {LEVELS.map((l) => (
            <span key={l.name} className="dbg-badge" style={{ borderColor: l.color }}>
              <i style={{ background: l.color }} />
              {l.label}: <strong>{counts[l.name]}</strong>
            </span>
          ))}
        </div>
      </section>

      {/* Tabelle */}
      <section className="card">
        <div className="dbg-log-head">
          <h3>Protokoll</h3>
          <label className="dbg-src-filter">
            Quelle:{" "}
            <select value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)}>
              <option value="">alle ({allLogs.length})</option>
              {sources.map((s) => {
                const n = allLogs.filter((l) => l.source === s).length;
                return <option key={s} value={s}>{s} ({n})</option>;
              })}
            </select>
          </label>
        </div>
        {logs.length === 0 ? (
          <p className="hint">Keine Logmeldungen vorhanden.</p>
        ) : (
          <div className="table-scroll">
          <table className="dbg-table">
            <tbody>
              <tr>
                <th>Zeit</th>
                <th>Level</th>
                <th>Quelle</th>
                <th>Meldung</th>
              </tr>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="dbg-ts">{fmtTs(l.ts)}</td>
                  <td>
                    <span className="dbg-level" style={{ color: colorOf(l.levelName) }}>
                      {l.levelName}
                    </span>
                  </td>
                  <td className="dbg-src">{l.source}</td>
                  <td className="dbg-msg">{l.msg}</td>
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
