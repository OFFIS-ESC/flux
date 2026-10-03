// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { ChartDownloadButton } from "./ChartDownloadButton";
import { useEffect, useMemo, useState } from "react";
import { SortableGrid, SortToggle } from "./SortableGrid";
import { nf } from "./chartUtils";
import type { FullState } from "./types";

// Eine Tageszeile aus /api/sharing/analysis
interface AnalysisDay {
  date: string; // YYYY-MM-DD
  geteiltKwh: number;
  sharingErloes: number; // € tatsächlich (Sharing-Vergütung, nur geteilt)
  klassischErloes: number; // € hypothetisch (klassisch, nur geteilter Anteil)
  vorteil: number; // € Mehrerlös
  ueberschussKwh: number; // gesamter PV-Überschuss (kWh)
  erloesOhneSharing: number; // € gesamter Überschuss klassisch eingespeist
  erloesMitSharing: number; // € gesamter Überschuss mit Sharing
}

type Gran = "tag" | "monat" | "jahr";

// Ein aggregierter Datenpunkt (je Tag/Monat/Jahr)
interface Bucket {
  key: string; // Anzeige-Label (z.B. "15.01." / "Jan 2026" / "2026")
  sortKey: string; // für Sortierung
  geteilt: number;
  ueberschuss: number; // gesamter Überschuss (kWh)
  ohneSharing: number; // € gesamter Überschuss klassisch
  mitSharing: number; // € gesamter Überschuss mit Sharing
  vorteil: number;
}

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function eur(v: number): string {
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function aggregate(rows: AnalysisDay[], gran: Gran): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const [y, m, d] = r.date.split("-");
    let sortKey: string, key: string;
    if (gran === "tag") {
      sortKey = r.date;
      key = `${d}.${m}.`;
    } else if (gran === "monat") {
      sortKey = `${y}-${m}`;
      key = `${MONTHS[Number(m) - 1]} ${y}`;
    } else {
      sortKey = y;
      key = y;
    }
    let b = map.get(sortKey);
    if (!b) {
      b = { key, sortKey, geteilt: 0, ueberschuss: 0, ohneSharing: 0, mitSharing: 0, vorteil: 0 };
      map.set(sortKey, b);
    }
    b.geteilt += r.geteiltKwh;
    b.ueberschuss += r.ueberschussKwh;
    b.ohneSharing += r.erloesOhneSharing;
    b.mitSharing += r.erloesMitSharing;
    b.vorteil += r.vorteil;
  }
  return [...map.values()].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
}

// Gruppiertes Balkendiagramm: je Bucket zwei Balken (Sharing vs. klassisch)
// nebeneinander, plus Mehrerlös-Markierung. Zeigt die Gegenüberstellung.
function ComparisonChart({
  buckets,
  colorSharing,
  colorKlassisch,
}: {
  buckets: Bucket[];
  colorSharing: string;
  colorKlassisch: string;
}) {
  const W = 820, H = 300, padL = 54, padR = 14, padT = 16, padB = 54;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(0.0001, ...buckets.map((b) => Math.max(b.mitSharing, b.ohneSharing)));
  const yOf = (v: number) => padT + (1 - v / maxVal) * plotH;
  const n = Math.max(1, buckets.length);
  const groupW = plotW / n;
  const barW = Math.min(28, (groupW - 8) / 2);

  const yTicks = [0, maxVal / 2, maxVal];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eee" />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">
            {nf(t, 2)}
          </text>
        </g>
      ))}
      <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
        transform={`rotate(-90 14 ${padT + plotH / 2})`}>
        €
      </text>

      {buckets.map((b, i) => {
        const cx = padL + i * groupW + groupW / 2;
        const x1 = cx - barW - 1;
        const x2 = cx + 1;
        return (
          <g key={b.sortKey}>
            <rect x={x1} y={yOf(b.ohneSharing)} width={barW} height={Math.max(0, padT + plotH - yOf(b.ohneSharing))} fill={colorKlassisch}>
              <title>{b.key} – klassisch: {b.ohneSharing.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</title>
            </rect>
            <rect x={x2} y={yOf(b.mitSharing)} width={barW} height={Math.max(0, padT + plotH - yOf(b.mitSharing))} fill={colorSharing}>
              <title>{b.key} – mit Sharing: {b.mitSharing.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € (Mehrerlös {b.vorteil.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €)</title>
            </rect>
            <text x={cx} y={padT + plotH + 16} className="tv-axis" textAnchor="middle" transform={buckets.length > 12 ? `rotate(35 ${cx} ${padT + plotH + 16})` : undefined}>
              {b.key}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function SharingAnalysisBlock({ state }: { state: FullState }) {
  const [rows, setRows] = useState<AnalysisDay[] | null>(null);
  const [sortMode, setSortMode] = useState(false);
  const [gran, setGran] = useState<Gran>("monat");

  useEffect(() => {
    fetch("/api/sharing/analysis")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: AnalysisDay[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  const buckets = useMemo(() => aggregate(rows ?? [], gran), [rows, gran]);

  // Kennzahlen: Mehrerlös heute / laufender Monat / laufendes Jahr
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const ymStr = todayStr.slice(0, 7);
  const yStr = todayStr.slice(0, 4);
  const sumBy = (pred: (r: AnalysisDay) => boolean, key: keyof AnalysisDay) =>
    (rows ?? []).filter(pred).reduce((s, r) => s + (r[key] as number), 0);

  const vorteilTag = sumBy((r) => r.date === todayStr, "vorteil");
  const vorteilMonat = sumBy((r) => r.date.slice(0, 7) === ymStr, "vorteil");
  const vorteilJahr = sumBy((r) => r.date.slice(0, 4) === yStr, "vorteil");

  const totalOhne = (rows ?? []).reduce((s, r) => s + r.erloesOhneSharing, 0);
  const totalMit = (rows ?? []).reduce((s, r) => s + r.erloesMitSharing, 0);
  const totalVorteil = totalMit - totalOhne;
  // Prozent bezieht sich jetzt auf den GESAMTEN Überschusserlös ohne Sharing –
  // dadurch realistischer (kleiner) als beim reinen geteilten Anteil.
  const vorteilProzent = totalOhne > 0 ? (totalVorteil / totalOhne) * 100 : 0;

  const colorSharing = state.settings.vizColorEinspeisungPv || "#f2c200";
  const colorKlassisch = state.settings.vizColorNetzbezug || "#595959";

  if (rows === null) {
    return (
      <section className="card">
        <div className="chart-title">Wirtschaftlichkeit: Energy Sharing vs. klassische Einspeisung</div>
        <p className="hint">Lade Analyse…</p>
      </section>
    );
  }

  const hasData = (rows ?? []).some((r) => r.geteiltKwh > 0);

  return (
    <section className="card">
      <div className="chart-kopf"><div className="chart-title">Wirtschaftlichkeit: Energy Sharing vs. klassische Einspeisung</div><ChartDownloadButton dateiname="sharing-wirtschaftlichkeit" /></div>
      <p className="hint">
        Betrachtet wird der <strong>gesamte PV-Überschuss</strong>: einmal so, als
        würde alles klassisch mit Einspeisevergütung vergütet, und einmal mit
        Energy Sharing (der an §42c-Abnehmer gelieferte Anteil zum vereinbarten
        Sharing-Satz, der Rest weiterhin zur Einspeisevergütung). Die Differenz ist
        der finanzielle Mehrerlös. Der prozentuale Vorteil bezieht sich damit auf
        den kompletten Überschuss – nicht nur auf den geteilten Ausschnitt – und
        fällt entsprechend realistischer aus.
      </p>

      {!hasData ? (
        <p className="hint">Noch keine Sharing-Daten für eine Auswertung vorhanden.</p>
      ) : (
        <>
          {/* Kennzahlen-Kacheln: Mehrerlös auf einen Blick */}
          <div className="tile-sort-bar">
            <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} />
          </div>
          {sortMode && <p className="tile-sort-hint">Kacheln ziehen, um die Reihenfolge zu ändern. Die Anordnung wird gespeichert.</p>}
          <SortableGrid bereich="sharing" className="sa-cards" sortMode={sortMode} items={[
            { id: "vorteilTag", node: (
              <div className="sa-card">
                <div className="sa-card-label">Mehrerlös heute</div>
                <div className="sa-card-value">{eur(vorteilTag)}</div>
              </div>
            ) },
            { id: "vorteilMonat", node: (
              <div className="sa-card">
                <div className="sa-card-label">Mehrerlös diesen Monat</div>
                <div className="sa-card-value">{eur(vorteilMonat)}</div>
              </div>
            ) },
            { id: "vorteilJahr", node: (
              <div className="sa-card">
                <div className="sa-card-label">Mehrerlös dieses Jahr</div>
                <div className="sa-card-value">{eur(vorteilJahr)}</div>
              </div>
            ) },
            { id: "gesamtVorteil", node: (
              <div className="sa-card sa-card-accent">
                <div className="sa-card-label">Gesamt-Mehrerlös</div>
                <div className="sa-card-value">{eur(totalVorteil)}</div>
                <div className="sa-card-sub">
                  +{vorteilProzent.toLocaleString("de-DE", { maximumFractionDigits: 1 })}% ggü. Einspeisung
                </div>
              </div>
            ) },
            { id: "gesamtKlassisch", node: (
              <div className="sa-card">
                <div className="sa-card-label">Gesamterlös klassisch</div>
                <div className="sa-card-value">{eur(totalOhne)}</div>
                <div className="sa-card-sub">gesamter Überschuss zur Einspeisevergütung</div>
              </div>
            ) },
            { id: "gesamtMitSharing", node: (
              <div className="sa-card">
                <div className="sa-card-label">Gesamterlös mit Sharing</div>
                <div className="sa-card-value">{eur(totalMit)}</div>
                <div className="sa-card-sub">Überschuss inkl. Energy Sharing</div>
              </div>
            ) },
          ]} />

          {/* Granularität */}
          <div className="sa-gran">
            {(["tag", "monat", "jahr"] as Gran[]).map((g) => (
              <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
                {g === "tag" ? "Täglich" : g === "monat" ? "Monatlich" : "Jährlich"}
              </button>
            ))}
          </div>

          {/* Gegenüberstellung */}
          <div className="sa-legend">
            <span><span className="sa-swatch" style={{ background: colorSharing }} /> Überschuss mit Energy Sharing</span>
            <span><span className="sa-swatch" style={{ background: colorKlassisch }} /> Überschuss klassisch eingespeist</span>
          </div>
          <ComparisonChart buckets={buckets} colorSharing={colorSharing} colorKlassisch={colorKlassisch} />

          {/* Tabelle mit Details */}
          <div className="table-scroll">
          <table className="sa-table">
            <tbody>
              <tr>
                <th>{gran === "tag" ? "Tag" : gran === "monat" ? "Monat" : "Jahr"}</th>
                <th>Überschuss</th>
                <th>ohne Sharing</th>
                <th>mit Sharing</th>
                <th>Mehrerlös</th>
              </tr>
              {buckets.map((b) => (
                <tr key={b.sortKey}>
                  <td style={{ textAlign: "left" }}>{b.key}</td>
                  <td>{b.ueberschuss.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kWh</td>
                  <td>{eur(b.ohneSharing)}</td>
                  <td>{eur(b.mitSharing)}</td>
                  <td className={b.vorteil >= 0 ? "sa-pos" : "sa-neg"}>{eur(b.vorteil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}
