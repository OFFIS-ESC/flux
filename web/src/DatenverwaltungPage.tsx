// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";

interface DayInfo {
  date: string;
  vsSlots: number;
  vsExpected: number;
  vsPercent: number;
  hasOther: boolean;
}
interface DayPart { table: string; label: string; count: number; percent: number | null; }

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Farbe je nach Datenfülle eines Tages.
function dayStyle(info: DayInfo | undefined): React.CSSProperties {
  if (!info || (info.vsSlots === 0 && !info.hasOther)) {
    return { background: "#f0f0f0", color: "#bbb" }; // keine Daten -> ausgegraut
  }
  const pct = info.vsPercent;
  if (pct >= 99.5) return { background: "#2e7d32", color: "#fff" };        // voll -> kräftig grün
  if (pct > 0) return { background: "#a5d6a7", color: "#1b5e20" };          // teilweise -> hellgrün
  // keine VS-Slots, aber andere Daten (z. B. nur Spotpreise/Tagesbilanz)
  return { background: "#dcedc8", color: "#558b2f" };                       // schwach hervorgehoben
}

export function DatenverwaltungPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [days, setDays] = useState<Map<string, DayInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [selDay, setSelDay] = useState<string | null>(null);
  const [dayInfo, setDayInfo] = useState<{ date: string; expected: number; parts: DayPart[] } | null>(null);
  const [dayErr, setDayErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ von: string; bis: string; label: string } | null>(null);
  // Zeitraum-Löschung
  const [rangeVon, setRangeVon] = useState("");
  const [rangeBis, setRangeBis] = useState("");

  // Direkte SQL-Ausführung
  const [sql, setSql] = useState("");
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlErr, setSqlErr] = useState<string | null>(null);
  const [sqlBusy, setSqlBusy] = useState(false);
  const [sqlConfirm, setSqlConfirm] = useState(false);
  const [schema, setSchema] = useState<Array<{ table: string; columns: Array<{ name: string; type: string }> }>>([]);
  const [showSchema, setShowSchema] = useState(false);

  useEffect(() => {
    fetch("/api/data/sql/schema").then((r) => r.json()).then((d) => {
      if (d.ok) setSchema(d.schema);
    }).catch(() => {});
  }, []);

  const isWriteSql = /^\s*(insert|update|delete|drop|alter|create|replace)\b/i.test(sql);

  async function runSqlNow() {
    setSqlConfirm(false);
    setSqlBusy(true);
    setSqlErr(null);
    setSqlResult(null);
    try {
      const res = await fetch("/api/data/sql", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) { setSqlErr(d.error ?? "Fehler"); return; }
      setSqlResult(d);
      // Nach schreibendem Eingriff die Kalenderansicht auffrischen.
      if (d.kind === "changes") loadYear(year);
    } catch (e: any) {
      setSqlErr(e?.message ?? "Fehler");
    } finally {
      setSqlBusy(false);
    }
  }

  function submitSql() {
    if (!sql.trim()) return;
    if (isWriteSql) setSqlConfirm(true);
    else runSqlNow();
  }

  const loadYear = useCallback((y: number) => {
    setLoading(true);
    fetch(`/api/data/calendar?year=${y}`)
      .then((r) => r.json())
      .then((d) => {
        const m = new Map<string, DayInfo>();
        for (const day of (d.days ?? [])) m.set(day.date, day);
        setDays(m);
      })
      .catch(() => setDays(new Map()))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadYear(year); }, [year, loadYear]);

  function openDay(date: string) {
    setSelDay(date);
    setDayInfo(null);
    setDayErr(null);
    fetch(`/api/data/day?date=${date}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.ok === false) {
          setDayErr(d?.error ?? `Fehler beim Laden (HTTP ${r.status})`);
          return;
        }
        setDayInfo(d);
      })
      .catch(() => setDayErr("Verbindungsfehler beim Laden der Tagesdaten."));
  }

  async function doDelete(von: string, bis: string) {
    setConfirm(null);
    setMsg(null);
    try {
      const res = await fetch("/api/data/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ von, bis }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) { setMsg({ ok: false, text: d.error ?? "Löschen fehlgeschlagen." }); return; }
      const total = Object.values(d.deleted ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
      setMsg({ ok: true, text: `${total} Datensätze gelöscht (${von}${bis !== von ? " bis " + bis : ""}).` });
      setSelDay(null); setDayInfo(null);
      loadYear(year);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Löschen fehlgeschlagen." });
    }
  }

  // Kalender-Raster: je Monat eine Spalte mit bis zu 31 Tageszellen.
  const daysInMonth = (m: number) => new Date(year, m + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="page">
      <h2>Daten verwalten</h2>
      <p className="hint">
        Jahresübersicht der gespeicherten Messdaten. Kräftig grün = vollständiger
        Tag, hellgrün = teilweise Daten, blassgrün = nur Tages-/Preisdaten, grau =
        keine Daten. Auf einen Tag klicken zeigt Details und erlaubt das Löschen.
        Slot-Anteile berücksichtigen die Zeitumstellung (92 bzw. 100 statt 96).
      </p>

      <section className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button className="btn-primary" onClick={() => setYear((y) => y - 1)}>◀ {year - 1}</button>
          <strong style={{ fontSize: 18, minWidth: 60, textAlign: "center" }}>{year}</strong>
          <button className="btn-primary" onClick={() => setYear((y) => y + 1)}>{year + 1} ▶</button>
          {loading && <span className="hint">lädt…</span>}
        </div>

        <div>
          <div style={{ display: "flex", gap: 6, width: "100%" }}>
            {MONTHS.map((mName, m) => (
              <div key={m} style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                <div className="hint" style={{ textAlign: "center", fontWeight: 600, marginBottom: 2 }}>{mName}</div>
                {Array.from({ length: daysInMonth(m) }, (_, i) => {
                  const date = `${year}-${pad(m + 1)}-${pad(i + 1)}`;
                  const info = days.get(date);
                  const st = dayStyle(info);
                  const title = info
                    ? `${date}: ${info.vsSlots}/${info.vsExpected} Slots (${info.vsPercent}%)${info.hasOther ? " + weitere Daten" : ""}`
                    : `${date}: keine Daten`;
                  return (
                    <div key={i} title={title} onClick={() => openDay(date)}
                      style={{
                        width: "100%", height: 13, fontSize: 8, lineHeight: "13px",
                        textAlign: "center", cursor: "pointer", borderRadius: 2,
                        userSelect: "none", boxSizing: "border-box", ...st,
                      }}>
                      {i + 1}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap", fontSize: 12, color: "#555" }}>
          <Legend color="#2e7d32" label="vollständig" />
          <Legend color="#a5d6a7" label="teilweise" />
          <Legend color="#dcedc8" label="nur Tages-/Preisdaten" />
          <Legend color="#f0f0f0" label="keine Daten" />
        </div>
      </section>

      {msg && (
        <p style={{ color: msg.ok ? "#2d6a00" : "#b3261e" }}>{msg.text}</p>
      )}

      {/* Zeitraum löschen */}
      <section className="card">
        <h3>Zeitraum löschen</h3>
        <p className="hint">Alle Messdaten in einem Datumsbereich entfernen. Börsenstrompreise bleiben erhalten.</p>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <label className="hint">Startdatum
            <input type="date" value={rangeVon} onChange={(e) => setRangeVon(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: "4px 6px" }} />
          </label>
          <label className="hint">Enddatum
            <input type="date" value={rangeBis} onChange={(e) => setRangeBis(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: "4px 6px" }} />
          </label>
          <button className="ie-danger"
            disabled={!rangeVon || !rangeBis}
            onClick={() => {
              if (!rangeVon || !rangeBis) return;
              if (rangeVon > rangeBis) { setMsg({ ok: false, text: "Startdatum liegt nach Enddatum." }); return; }
              setConfirm({ von: rangeVon, bis: rangeBis, label: `${rangeVon} bis ${rangeBis}` });
            }}>
            Zeitraum löschen
          </button>
        </div>
      </section>

      {/* Direkte SQL-Ausführung */}
      <section className="card">
        <h3>SQL ausführen</h3>
        <p className="hint">
          Direkte Datenbankabfragen und -eingriffe. <strong>SELECT</strong> (auch
          PRAGMA/EXPLAIN/WITH) liefert eine Ergebnistabelle; schreibende Befehle
          (<strong>UPDATE/DELETE/INSERT</strong> …) ändern die Datenbank und werden
          erst nach Rückfrage ausgeführt. Nur EIN Befehl pro Ausführung (kein
          Semikolon in der Mitte). Eingriffe wirken sofort und sind nicht
          umkehrbar – vorher am besten den Zeitraum exportieren.
        </p>

        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT ts, verbrauch FROM viertelstunden WHERE ts >= '2026-08-12T00:00' ORDER BY ts"
          spellCheck={false}
          style={{
            width: "100%", minHeight: 110, fontFamily: "monospace", fontSize: 13,
            padding: 10, boxSizing: "border-box", border: "1px solid #ccc", borderRadius: 6,
          }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button className={isWriteSql ? "ie-danger" : "btn-primary"} disabled={sqlBusy || !sql.trim()} onClick={submitSql}>
            {sqlBusy ? "läuft…" : isWriteSql ? "Eingriff ausführen" : "Abfrage ausführen"}
          </button>
          <button className="ie-cancel" onClick={() => setShowSchema((s) => !s)}>
            {showSchema ? "Schema ausblenden" : "Datenschema & Beispiele"}
          </button>
        </div>

        {sqlErr && <p style={{ color: "#b3261e", marginTop: 10 }}>{sqlErr}</p>}

        {sqlResult?.kind === "changes" && (
          <p style={{ color: "#2d6a00", marginTop: 10 }}>
            {sqlResult.changes} Zeile(n) betroffen.
          </p>
        )}

        {sqlResult?.kind === "rows" && (
          <div style={{ marginTop: 10 }}>
            <p className="hint">
              {sqlResult.rowCount} Zeile(n){sqlResult.truncated ? ` (Anzeige auf ${sqlResult.rows.length} begrenzt)` : ""}.
            </p>
            {sqlResult.rows.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    <tr>{sqlResult.columns.map((c: string) => <th key={c}>{c}</th>)}</tr>
                    {sqlResult.rows.map((row: any, i: number) => (
                      <tr key={i}>
                        {sqlResult.columns.map((c: string) => (
                          <td key={c}>{row[c] === null ? "—" : String(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {showSchema && (
          <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 12 }}>
            <h4 style={{ margin: "0 0 6px" }}>Datenschema</h4>
            <p className="hint" style={{ marginTop: 0 }}>
              Zeitspalten: Viertelstunden-Tabellen nutzen <code>ts</code> im Format
              <code> YYYY-MM-DDTHH:MM</code> (Ende-Zeitstempel der Viertelstunde);
              <code> history</code>, <code>spotpreise</code> und <code>drosselungen</code> nutzen
              <code> date</code> (<code>YYYY-MM-DD</code>).
            </p>
            <div className="table-scroll">
            <table className="data-table schema-table">
              <tbody>
                <tr><th>Tabelle</th><th>Spalten</th></tr>
                {schema.map((t) => (
                  <tr key={t.table}>
                    <td style={{ whiteSpace: "nowrap", fontFamily: "monospace", verticalAlign: "top" }}>{t.table}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "normal", wordBreak: "break-word" }}>
                      {t.columns.map((c) => c.name).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <h4 style={{ margin: "14px 0 6px" }}>Beispiele</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { t: "Verbrauch eines Zeitraums abrufen", q: "SELECT ts, verbrauch FROM viertelstunden WHERE ts >= '2026-08-12T00:00' AND ts <= '2026-08-12T06:45' ORDER BY ts" },
                { t: "Tagessumme Verbrauch (kWh)", q: "SELECT substr(ts,1,10) AS tag, ROUND(SUM(verbrauch),3) AS kwh FROM viertelstunden GROUP BY tag ORDER BY tag DESC LIMIT 14" },
                { t: "Einen Wert korrigieren", q: "UPDATE viertelstunden SET verbrauch = 0.123 WHERE ts = '2026-08-12T00:15'" },
                { t: "Zeitraum aus einer Tabelle löschen", q: "DELETE FROM viertelstunden WHERE ts >= '2026-08-12T00:15' AND ts <= '2026-08-12T06:45'" },
                { t: "Alle Tabellen zählen", q: "SELECT COUNT(*) FROM viertelstunden" },
              ].map((ex) => (
                <div key={ex.t}>
                  <div className="hint" style={{ marginBottom: 2 }}>{ex.t}</div>
                  <code
                    onClick={() => setSql(ex.q)}
                    title="Klicken zum Übernehmen"
                    style={{
                      display: "block", background: "#f6f6f6", padding: "6px 8px",
                      borderRadius: 4, cursor: "pointer", fontSize: 12, wordBreak: "break-all",
                    }}>
                    {ex.q}
                  </code>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SQL-Eingriff-Bestätigung */}
      {sqlConfirm && (
        <div className="ie-confirm-overlay">
          <div className="ie-confirm">
            <div className="ie-confirm-title">⚠ Datenbank verändern?</div>
            <p>Dieser Befehl verändert die Datenbank und kann nicht rückgängig gemacht werden:</p>
            <code style={{ display: "block", background: "#f6f6f6", padding: "8px 10px", borderRadius: 4, fontSize: 12, wordBreak: "break-all", margin: "8px 0" }}>
              {sql}
            </code>
            <div className="ie-confirm-actions">
              <button className="ie-cancel" onClick={() => setSqlConfirm(false)}>Abbrechen</button>
              <button className="ie-danger" onClick={runSqlNow}>Ja, ausführen</button>
            </div>
          </div>
        </div>
      )}

      {/* Tag-Detail-Overlay */}
      {selDay && (
        <div className="ie-confirm-overlay" onClick={() => { setSelDay(null); setDayInfo(null); setDayErr(null); }}>
          <div className="ie-confirm" onClick={(e) => e.stopPropagation()} style={{ minWidth: 320 }}>
            <div className="ie-confirm-title">Daten am {selDay}</div>
            {dayErr ? (
              <>
                <p className="ie-danger" style={{ marginTop: 0 }}>{dayErr}</p>
                <div className="ie-confirm-actions">
                  <button className="ie-cancel" onClick={() => { setSelDay(null); setDayInfo(null); setDayErr(null); }}>Schließen</button>
                </div>
              </>
            ) : !dayInfo ? (
              <p className="hint">lädt…</p>
            ) : (
              <>
                <p className="hint" style={{ marginTop: 0 }}>
                  Soll-Slots an diesem Tag: <strong>{dayInfo.expected}</strong>
                  {dayInfo.expected !== 96 && <> (Zeitumstellung berücksichtigt)</>}
                </p>
                {dayInfo.parts.every((p) => p.count === 0) ? (
                  <p>Keine Daten an diesem Tag.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <tbody>
                        <tr><th>Datenart</th><th>Datensätze</th><th>Slot-Anteil</th></tr>
                        {dayInfo.parts.filter((p) => p.count > 0).map((p) => (
                          <tr key={p.table}>
                            <td>{p.label}</td>
                            <td>{p.count}</td>
                            <td>{p.percent != null ? `${p.percent}%` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="ie-confirm-actions">
                  <button className="ie-cancel" onClick={() => { setSelDay(null); setDayInfo(null); setDayErr(null); }}>Schließen</button>
                  {!dayInfo.parts.every((p) => p.count === 0) && (
                    <button className="ie-danger"
                      onClick={() => setConfirm({ von: selDay, bis: selDay, label: selDay })}>
                      Diesen Tag löschen
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Lösch-Bestätigung */}
      {confirm && (
        <div className="ie-confirm-overlay">
          <div className="ie-confirm">
            <div className="ie-confirm-title">⚠ Daten löschen?</div>
            <p>
              Alle Messdaten für <strong>{confirm.label}</strong> werden
              unwiderruflich gelöscht (Viertelstundenwerte, Temperaturen,
              Tagesbilanzen usw.). Das kann nicht rückgängig gemacht werden.
            </p>
            <p className="hint" style={{ fontSize: 13 }}>
              Börsenstrompreise bleiben erhalten (externe Marktdaten).
            </p>
            <p className="hint" style={{ fontSize: 13 }}>
              Tipp: Über <strong>Import / Export → Messdaten</strong> vorher eine
              Sicherung des Zeitraums erstellen.
            </p>
            <div className="ie-confirm-actions">
              <button className="ie-cancel" onClick={() => setConfirm(null)}>Abbrechen</button>
              <button className="ie-danger" onClick={() => doDelete(confirm.von, confirm.bis)}>Ja, löschen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 14, height: 10, background: color, borderRadius: 2, display: "inline-block", border: "1px solid #ccc" }} />
      {label}
    </span>
  );
}
