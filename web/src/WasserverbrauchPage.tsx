// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { DateNav } from "./DateNav";
import { MonthNav } from "./MonthNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale } from "./chartUtils";
import { ChartDownloadButton } from "./ChartDownloadButton";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtL(n: number, dec = 0): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function eur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function TagesverlaufChart({ values, color }: { values: number[]; color: string }) {
  const W = 760, H = 260, padL = 48, padR = 12, padT = 14, padB = 42;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(0.0001, ...values);
  const scale = niceScale(max);
  const dispMax = scale.max;
  const barW = plotW / 96;
  const yOf = (v: number) => padT + (1 - v / dispMax) * plotH;
  const baseY = padT + plotH;
  const hours = [0, 6, 12, 18, 24];
  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend">
          <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: color }} />Wasserverbrauch (L)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
            <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{fmtL(t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          if (v <= 0) return null;
          const y = yOf(v);
          return <rect key={i} x={padL + i * barW + 0.5} y={y} width={Math.max(barW - 1, 0.5)} height={Math.max(baseY - y, 0.3)} fill={color} />;
        })}
        {hours.map((h) => (
          <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{String(h).padStart(2, "0")}</text>
        ))}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">Uhrzeit</text>
        <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>Wasserverbrauch (L)</text>
      </svg>
      <ChartHoverLayer svgW={W} plotL={padL} plotW={plotW}
        rowsForSlot={(i) => [{ label: "Verbrauch", value: `${fmtL(values[i], 1)} L`, color }]} />
    </div>
  );
}

interface MonatRow { tag: string; liter: number; kosten: number; verbrauchskosten: number; grundpreis: number; }

function MonatChart({ rows, color, selectedDay, onPick }: {
  rows: MonatRow[]; color: string; selectedDay: string | null; onPick: (tag: string) => void;
}) {
  const W = 760, H = 280, padL = 48, padR = 12, padT = 14, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(0.0001, ...rows.map((r) => r.liter));
  const scale = niceScale(max);
  const dispMax = scale.max;
  // x-Achse deckt den kompletten Monat ab; Tage ohne Daten bleiben leer.
  const ymRef = rows[0]?.tag?.slice(0, 7);
  const nDays = ymRef
    ? new Date(Number(ymRef.slice(0, 4)), Number(ymRef.slice(5, 7)), 0).getDate()
    : (rows.length || 1);
  const slotW = plotW / nDays;
  const barW = Math.min(slotW * 0.7, 22);
  const yOf = (v: number) => padT + (1 - v / dispMax) * plotH;
  const baseY = padT + plotH;
  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend">
          <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: color }} />Tagesverbrauch (L)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
            <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{fmtL(t)}</text>
          </g>
        ))}
        {rows.map((r) => {
          const day = Number(r.tag.slice(8, 10));
          const cx = padL + (day - 0.5) * slotW;
          const y = yOf(r.liter);
          const isSel = r.tag === selectedDay;
          return (
            <g key={r.tag} style={{ cursor: "pointer" }} onClick={() => onPick(r.tag)}>
              <rect x={cx - barW / 2} y={y} width={barW} height={Math.max(baseY - y, 0.3)}
                fill={isSel ? "#c0152f" : color}>
                <title>{r.tag}: {fmtL(r.liter)} L - {eur(r.kosten)}</title>
              </rect>
              {(day === 1 || day % 5 === 0) && (
                <text x={cx} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{day}</text>
              )}
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">Tag des Monats</text>
        <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>Tagesverbrauch (L)</text>
      </svg>
    </div>
  );
}

export function WasserverbrauchPage() {
  const [date, setDate] = useState(isoToday());
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [tag, setTag] = useState<{ values: number[]; summe: number } | null>(null);
  const [monat, setMonat] = useState<{ rows: MonatRow[]; preisFrisch: number; preisAbwasser: number; grundpreisMonat: number } | null>(null);
  const [stand, setStand] = useState<{ ts: string | null; stand: number | null } | null>(null);

  // Tagesauswahl schaltet den Monat unten mit.
  function pickDate(d: string) {
    setDate(d);
    setMonth(d.slice(0, 7));
  }

  useEffect(() => {
    fetch("/api/wasser/stand").then((r) => r.json()).then(setStand).catch(() => setStand(null));
  }, []);
  useEffect(() => {
    fetch(`/api/wasser/tag?date=${date}`).then((r) => r.json()).then(setTag).catch(() => setTag(null));
  }, [date]);
  useEffect(() => {
    fetch(`/api/wasser/monat?month=${month}`).then((r) => r.json()).then(setMonat).catch(() => setMonat(null));
  }, [month]);

  const color = "#3b7dd8";
  const monatsSumme = monat ? monat.rows.reduce((a, r) => a + r.liter, 0) : 0;
  const monatsKosten = monat ? monat.rows.reduce((a, r) => a + r.kosten, 0) : 0;

  return (
    <div className="page">
      <h2>Wasserverbrauch</h2>
      <p className="hint">
        Der Wasserverbrauch wird aus den Zaehlerstaenden des Hauswasserzaehlers
        berechnet (Rolle &bdquo;Wasserzaehler&ldquo;, z.&nbsp;B. via AI-on-the-Edge). Die
        Werte sind in Litern; die Tageskosten ergeben sich aus den unter Kosten
        hinterlegten Wasserpreisen.
      </p>

      {stand && stand.stand != null && (
        <div className="mk-tiles">
          <div className="mk-tile mk-tile-accent">
            <div className="mk-tile-label">Aktueller Zaehlerstand</div>
            <div className="mk-tile-value">{stand.stand.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m&sup3;</div>
            {stand.ts && <div className="mk-tile-sub">Stand: {new Date(stand.ts).toLocaleString("de-DE")}</div>}
          </div>
        </div>
      )}

      <section className="card">
        <div className="block-head">
          <div className="chart-kopf"><h3>Wasserverbrauch im Tagesverlauf</h3><ChartDownloadButton dateiname="wasserverbrauch" /></div>
          <DateNav value={date} onChange={pickDate} label="" />
        </div>
        {tag && tag.summe > 0 ? (
          <>
            <p className="hint">Tagesverbrauch: <strong>{fmtL(tag.summe)} L</strong></p>
            <TagesverlaufChart values={tag.values} color={color} />
          </>
        ) : <p className="hint">Keine Wasserdaten fuer diesen Tag.</p>}
      </section>

      <section className="card">
        <div className="block-head">
          <div className="chart-kopf"><h3>Tagesbilanz im Monatsverlauf</h3><ChartDownloadButton dateiname="wasserverbrauch-monat" /></div>
          <MonthNav value={month} onChange={setMonth} />
        </div>
        {monat && monat.rows.length > 0 ? (
          <>
            <p className="hint">
              Monatsverbrauch: <strong>{fmtL(monatsSumme)} L</strong> ({fmtL(monatsSumme / 1000, 2)} m&sup3;) -
              Kosten inkl. Grundpreis: <strong>{eur(monatsKosten)}</strong>
            </p>
            <MonatChart rows={monat.rows} color={color} selectedDay={date.slice(0, 7) === month ? date : null} onPick={pickDate} />
            <div className="table-scroll">
            <table className="data-table wasser-tab">
              <thead>
                <tr><th>Tag</th><th>Verbrauch</th><th>Verbrauchskosten</th><th>Grundpreis (anteilig)</th><th>Tageskosten</th></tr>
              </thead>
              <tbody>
                {monat.rows.map((r) => (
                  <tr key={r.tag} className={r.tag === date ? "wasser-row-sel" : ""}
                    style={{ cursor: "pointer" }} onClick={() => pickDate(r.tag)}>
                    <td>{r.tag}</td>
                    <td>{fmtL(r.liter)} L</td>
                    <td>{eur(r.verbrauchskosten)}</td>
                    <td>{eur(r.grundpreis)}</td>
                    <td>{eur(r.kosten)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Summe</strong></td>
                  <td><strong>{fmtL(monatsSumme)} L</strong></td>
                  <td><strong>{eur(monat.rows.reduce((a, r) => a + r.verbrauchskosten, 0))}</strong></td>
                  <td><strong>{eur(monat.rows.reduce((a, r) => a + r.grundpreis, 0))}</strong></td>
                  <td><strong>{eur(monatsKosten)}</strong></td>
                </tr>
              </tfoot>
            </table>
            </div>
            <p className="hint" style={{ fontSize: 12 }}>
              Preise: Frischwasser {eur(monat.preisFrisch)}/m&sup3;, Abwasser {eur(monat.preisAbwasser)}/m&sup3;,
              Grundpreis {eur(monat.grundpreisMonat)}/Monat.
            </p>
          </>
        ) : <p className="hint">Keine Wasserdaten fuer diesen Monat.</p>}
      </section>
    </div>
  );
}
