// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { nf } from "./chartUtils";
import type { FullState } from "./types";
import { SpotChart } from "./SpotChart";

// Stunden-Anzeige mit genau 2 Nachkommastellen (Viertelstunden-Raster: Werte
// sind Vielfache von 0,25, z.B. 300,75 – nicht auf 300,8 runden).
const fmtStd = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Stat {
  jahr: number;
  tageMitDaten: number;
  negStundenGesamt: number;
  negViertelstundenGesamt: number;
  negStundenHeute: number;
  nullStundenGesamt: number;
  nullViertelstundenGesamt: number;
  tiefstpreis: number;
  tiefstpreisDatum: string | null;
  hoechstpreis: number;
  hoechstpreisDatum: string | null;
  durchschnittspreis: number;
  durchschnittspreisBrutto: number;
  avgTagesspread: number;
  maxTagesspread: number;
  maxTagesspreadDatum: string | null;
  anteilNegProzent: number;
  kumulativ: Array<{ date: string; negStundenTag: number; kumuliert: number }>;
  stundenVerteilung: number[];
  wochentagVerteilung: number[];
  spreadProTag: Array<{ date: string; spread: number }>;
  proMonat: Array<{ monat: string; negStunden: number }>;
  heatmap: Array<{ date: string; woche: number; wochentag: number; negVs: number }>;
  heatmapWochen?: number;
  verfuegbareJahre?: number[];
  jahresvergleich?: JahresKennzahlen[];
}

interface JahresKennzahlen {
  jahr: number;
  tageMitDaten: number;
  negStunden: number;
  nullStunden: number;
  tiefstpreis: number;
  hoechstpreis: number;
  durchschnittspreis: number;
  avgTagesspread: number;
  maxTagesspread: number;
  anteilNegProzent: number;
  anteilNullOderNegProzent: number;
}

function fmtDatum(d: string | null): string {
  if (!d) return "–";
  const [, m, day] = d.split("-");
  return `${day}.${m}.`;
}

// Kumulative Linie der negativen Stunden über das Jahr.
function KumulativChart({ data }: { data: Stat["kumulativ"] }) {
  const W = 820, H = 260, padL = 48, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (data.length === 0) return null;
  const maxK = Math.max(1, data[data.length - 1].kumuliert);
  const xOf = (i: number) => padL + (i / Math.max(1, data.length - 1)) * plotW;
  const yOf = (v: number) => padT + (1 - v / maxK) * plotH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(d.kumuliert).toFixed(1)}`).join(" ");
  const yTicks = [0, maxK / 2, maxK];
  // x-Beschriftung: Monatswechsel
  const monthTicks: Array<{ i: number; label: string }> = [];
  let lastMon = "";
  data.forEach((d, i) => { const m = d.date.slice(0, 7); if (m !== lastMon) { monthTicks.push({ i, label: d.date.slice(5, 7) + "/" + d.date.slice(2, 4) }); lastMon = m; } });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eee" />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{t.toFixed(0)}</text>
        </g>
      ))}
      {monthTicks.map((mt) => (
        <text key={mt.i} x={xOf(mt.i)} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{mt.label}</text>
      ))}
      <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`}>neg. Std (kum.)</text>
      <path d={path} fill="none" stroke="#c0152f" strokeWidth={2} />
      {/* sichtbare Stützpunkte + unsichtbare größere Trefferflächen für Mouseover */}
      {data.map((d, i) => (
        <g key={d.date}>
          <circle cx={xOf(i)} cy={yOf(d.kumuliert)} r={2} fill="#c0152f" />
          <circle cx={xOf(i)} cy={yOf(d.kumuliert)} r={7} fill="transparent" style={{ cursor: "pointer" }}>
            <title>{fmtDatum(d.date)} – kumuliert {fmtStd(d.kumuliert)} neg. Std (davon {fmtStd(d.negStundenTag)} an diesem Tag)</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

// Balken: Verteilung negativer Viertelstunden über die 24 Tagesstunden.
function StundenChart({ data }: { data: number[] }) {
  const W = 820, H = 240, padL = 48, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...data);
  const bw = plotW / 24;
  const yOf = (v: number) => padT + (1 - v / max) * plotH;
  const yTicks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eee" />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{Math.round(t)}</text>
        </g>
      ))}
      {data.map((v, h) => (
        <g key={h}>
          <rect x={padL + h * bw + 1} y={yOf(v)} width={bw - 2} height={Math.max(0, padT + plotH - yOf(v))} fill="#e08a1e" />
          {v > 0 && <text x={padL + h * bw + bw / 2} y={yOf(v) - 3} className="tv-axis" textAnchor="middle">{v}</text>}
          {h % 3 === 0 && <text x={padL + h * bw + bw / 2} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{String(h).padStart(2, "0")}</text>}
        </g>
      ))}
      <text x={padL + plotW / 2} y={H - 3} className="tv-axis-title" textAnchor="middle">Tagesstunde</text>
      <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`}>neg. Viertelstd.</text>
    </svg>
  );
}

// Monatsbalken negativer Stunden.
function MonatChart({ data }: { data: Stat["proMonat"] }) {
  const W = 820, H = 240, padL = 48, padR = 16, padT = 16, padB = 44;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.negStunden));
  const n = Math.max(1, data.length);
  const bw = Math.min(80, (plotW / n) - 10);
  const yOf = (v: number) => padT + (1 - v / max) * plotH;
  const yTicks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eee" />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{t.toFixed(0)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = padL + (i + 0.5) * (plotW / n);
        return (
          <g key={d.monat}>
            <rect x={cx - bw / 2} y={yOf(d.negStunden)} width={bw} height={Math.max(0, padT + plotH - yOf(d.negStunden))} fill="#c0152f" />
            <text x={cx} y={yOf(d.negStunden) - 4} className="tv-axis" textAnchor="middle">{d.negStunden.toFixed(0)}</text>
            <text x={cx} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{d.monat}</text>
          </g>
        );
      })}
      <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`}>neg. Std</text>
    </svg>
  );
}

// Kalender-Heatmap: Spalten = Wochen, Zeilen = Wochentage (Mo..So), eine Zelle je
// Tag, Farbe = Anzahl negativer Viertelstunden des Tages. Mouseover je Zelle.
function Heatmap({ data, wochen }: { data: Stat["heatmap"]; wochen?: number }) {
  const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const gap = 2, labelW = 26, headH = 14;
  const maxWoche = data.reduce((m, d) => Math.max(m, d.woche), 0);
  // Immer das ganze Jahr aufspannen: Spaltenzahl aus heatmapWochen (Server),
  // Fallback auf die tatsächlich vorkommenden Wochen. Datenlose/zukünftige Tage
  // erscheinen dadurch als Lücke.
  const cols = Math.max(maxWoche + 1, wochen ?? 0);
  // Feste Zielbreite (entspricht der Chart-Breite der übrigen Seite). Die
  // Zellen füllen die volle Breite: cellW wird so bemessen, dass alle Spalten
  // die Zielbreite ausschöpfen (auch bei einem Jahr, das nicht ganz gefüllt ist).
  // Die Höhe bleibt moderat begrenzt, damit Zellen nicht unnötig hoch werden.
  const targetW = 860;
  const cellW = Math.max(6, (targetW - labelW - 4) / Math.max(1, cols) - gap);
  const cellH = Math.max(6, Math.min(cellW, 22));
  const W = targetW;
  const H = headH + 7 * (cellH + gap) + 2;
  const maxNeg = Math.max(1, ...data.map((d) => d.negVs));
  const color = (n: number) => {
    if (n <= 0) return "#f3f3f3";
    const t = Math.min(1, n / maxNeg);
    const r = Math.round(245 - t * 70);
    const g = Math.round(215 - t * 195);
    const b = Math.round(120 - t * 110);
    return `rgb(${r},${g},${b})`;
  };
  // Monatsbeschriftung oben: erste Woche, in der ein neuer Monat beginnt
  const monLabels: Array<{ woche: number; label: string }> = [];
  let lastMon = "";
  [...data].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((d) => {
    const m = d.date.slice(5, 7);
    if (m !== lastMon && d.wochentag <= 3) { monLabels.push({ woche: d.woche, label: `${d.date.slice(8, 10)}.${m}.` }); lastMon = m; }
  });
  return (
    <div className="bs-heatmap-wrap">
      {/* Seitenverhältnis erhalten (meet) statt "none": das SVG skaliert
          proportional mit der Breite, die Höhe ergibt sich aus dem viewBox-
          Verhältnis (aspectRatio). So wird das ganze Jahr in Blockbreite gezeigt,
          ohne die Zellen vertikal zu verzerren. */}
      <svg viewBox={`0 0 ${W} ${H}`} className="bs-heatmap-cal"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}>
        {WT.map((w, i) => (
          <text key={w} x={labelW - 4} y={headH + i * (cellH + gap) + cellH - 3} className="bs-hm-axis" textAnchor="end">{w}</text>
        ))}
        {monLabels.map((ml) => (
          <text key={ml.woche + ml.label} x={labelW + ml.woche * (cellW + gap)} y={headH - 3} className="bs-hm-axis" textAnchor="start">{ml.label}</text>
        ))}
        {data.map((d) => (
          <rect
            key={d.date}
            x={labelW + d.woche * (cellW + gap)}
            y={headH + d.wochentag * (cellH + gap)}
            width={cellW}
            height={cellH}
            rx={2}
            fill={color(d.negVs)}
          >
            <title>{fmtDatum(d.date)} – {d.negVs} negative Viertelstunden</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

// Histogramm negativer Viertelstunden über die Wochentage Mo..So.
function WochentagChart({ data }: { data: number[] }) {
  const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const W = 820, H = 240, padL = 48, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...data);
  const n = 7;
  const bw = Math.min(70, (plotW / n) - 12);
  const yOf = (v: number) => padT + (1 - v / max) * plotH;
  const yTicks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eee" />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{Math.round(t)}</text>
        </g>
      ))}
      {data.map((v, i) => {
        const cx = padL + (i + 0.5) * (plotW / n);
        const weekend = i >= 5;
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={yOf(v)} width={bw} height={Math.max(0, padT + plotH - yOf(v))} fill={weekend ? "#c0152f" : "#e08a1e"} />
            <text x={cx} y={yOf(v) - 4} className="tv-axis" textAnchor="middle">{v}</text>
            <text x={cx} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{WT[i]}</text>
          </g>
        );
      })}
      <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`}>neg. Viertelstd.</text>
    </svg>
  );
}

// Balkendiagramm: täglicher Preisspread (Höchst- minus Tiefstpreis) je Tag.
function SpreadChart({ data }: { data: Stat["spreadProTag"] }) {
  const W = 820, H = 240, padL = 48, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.spread));
  const bw = plotW / data.length;
  const yOf = (v: number) => padT + (1 - v / max) * plotH;
  const yTicks = [0, max / 2, max];
  const monthTicks: Array<{ i: number; label: string }> = [];
  let lastMon = "";
  data.forEach((d, i) => { const m = d.date.slice(0, 7); if (m !== lastMon) { monthTicks.push({ i, label: d.date.slice(5, 7) + "/" + d.date.slice(2, 4) }); lastMon = m; } });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eee" />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{t.toFixed(0)}</text>
        </g>
      ))}
      {data.map((d, i) => (
        <rect key={d.date} x={padL + i * bw + 0.5} y={yOf(d.spread)} width={Math.max(1, bw - 1)} height={Math.max(0, padT + plotH - yOf(d.spread))} fill="#3b7dd8">
          <title>{fmtDatum(d.date)} – Spread {nf(d.spread, 1)} ct/kWh</title>
        </rect>
      ))}
      {monthTicks.map((mt) => (
        <text key={mt.i} x={padL + mt.i * bw} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{mt.label}</text>
      ))}
      <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`}>Spread ct/kWh</text>
    </svg>
  );
}

export function BoersenstrompreisPage({ state }: { state: FullState }) {
  const [stat, setStat] = useState<Stat | null>(null);
  const [err, setErr] = useState(false);
  const [jahr, setJahr] = useState<number | null>(null);

  useEffect(() => {
    const url = jahr ? `/api/boerse/statistik?jahr=${jahr}` : "/api/boerse/statistik";
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) { setErr(true); return; }
        setStat(d);
        // Beim ersten Laden das vom Server gewählte Standardjahr übernehmen.
        if (jahr == null && typeof d.jahr === "number") setJahr(d.jahr);
      })
      .catch(() => setErr(true));
  }, [jahr]);

  if (err) return <div className="page"><h2>Börsenstrompreis</h2><p className="hint">Statistik konnte nicht geladen werden.</p></div>;
  if (!stat) return <div className="page"><h2>Börsenstrompreis</h2><p className="hint">Lade Statistik…</p></div>;

  const jahre = stat.verfuegbareJahre ?? [stat.jahr];
  const vergleich = stat.jahresvergleich ?? [];

  return (
    <div className="page">
      <h2>Börsenstrompreis</h2>

      <div className="bs-year-select">
        <label>Auswertungsjahr:</label>
        <select value={jahr ?? stat.jahr} onChange={(e) => setJahr(Number(e.target.value))}>
          {jahre.slice().reverse().map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <p className="hint">
        Auswertung des dynamischen Börsenstrompreises (Day-Ahead, ct/kWh) für{" "}
        {stat.jahr}, mit besonderem Blick auf <strong>negative Strompreise</strong>.
        Alle Kennzahlen werden selbstständig aus den in der Anlage gespeicherten
        Spotpreisen berechnet. Eine „negative Stunde" entspricht vier
        Viertelstunden mit einem Preis unter 0&nbsp;ct/kWh (Preis&nbsp;&lt;&nbsp;0
        je Viertelstunde, Anzahl geteilt durch&nbsp;4). Die Vergleichstabelle
        ganz unten zeigt die Kernkennzahlen aller Jahre unabhängig von dieser
        Auswahl.
      </p>

      {/* Kennzahlen */}
      <div className="bs-cards">
        <div className="bs-card bs-card-accent">
          <div className="bs-label">Negative Stunden {stat.jahr}</div>
          <div className="bs-value">{fmtStd(stat.negStundenGesamt)}</div>
          <div className="bs-sub">{stat.negViertelstundenGesamt} Viertelstunden · {stat.anteilNegProzent}% aller</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Negative Stunden heute</div>
          <div className="bs-value">{fmtStd(stat.negStundenHeute)}</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Nullstunden {stat.jahr}</div>
          <div className="bs-value">{fmtStd(stat.nullStundenGesamt)}</div>
          <div className="bs-sub">Preis genau 0 ct/kWh</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Tiefstpreis</div>
          <div className="bs-value">{stat.tiefstpreis.toLocaleString("de-DE")}<span className="bs-unit"> ct/kWh</span></div>
          <div className="bs-sub">am {fmtDatum(stat.tiefstpreisDatum)}</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Höchstpreis</div>
          <div className="bs-value">{stat.hoechstpreis.toLocaleString("de-DE")}<span className="bs-unit"> ct/kWh</span></div>
          <div className="bs-sub">am {fmtDatum(stat.hoechstpreisDatum)}</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Ø Tagesspread</div>
          <div className="bs-value">{stat.avgTagesspread.toLocaleString("de-DE")}<span className="bs-unit"> ct/kWh</span></div>
          <div className="bs-sub">max {stat.maxTagesspread} am {fmtDatum(stat.maxTagesspreadDatum)}</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Ø Day-Ahead-Preis (netto)</div>
          <div className="bs-value">{stat.durchschnittspreis.toLocaleString("de-DE")}<span className="bs-unit"> ct/kWh</span></div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Ø Gesamtpreis (brutto)</div>
          <div className="bs-value">{stat.durchschnittspreisBrutto.toLocaleString("de-DE")}<span className="bs-unit"> ct/kWh</span></div>
          <div className="bs-sub">inkl. aller Bestandteile &amp; USt.</div>
        </div>
      </div>

      <section className="card">
        <div className="chart-title">Tagespreisverlauf</div>
        <p className="hint">
          Börsenstrompreis des gewählten Tages im Viertelstunden-Verlauf. Über die
          Umschaltung lässt sich der reine Börsenpreis (netto) oder der
          Brutto-Gesamtpreis inklusive aller Preisbestandteile und Umsatzsteuer
          anzeigen. Die Preise stammen aus den in der Anlage gespeicherten
          Day-Ahead-Spotpreisen.
        </p>
        <SpotChart disabled={false} settings={state.settings} />
      </section>

      <section className="card">
        <div className="chart-title">Kumulative negative Stunden im Jahresverlauf</div>
        <p className="hint">
          Aufsummierte Anzahl negativer Stunden über das Jahr. Die Steigung zeigt,
          in welchen Phasen besonders viele negative Preise auftraten.
        </p>
        <KumulativChart data={stat.kumulativ} />
      </section>

      <section className="card">
        <div className="chart-title">Wann treten negative Preise auf? (Tagesstunden)</div>
        <p className="hint">
          Verteilung aller negativen Viertelstunden über die 24 Tagesstunden. Der
          Schwerpunkt liegt typischerweise in den Solarstunden um die Mittagszeit,
          wenn die Einspeisung aus PV am höchsten ist.
        </p>
        <StundenChart data={stat.stundenVerteilung} />
      </section>

      <section className="card">
        <div className="chart-title">Negative Viertelstunden je Wochentag</div>
        <p className="hint">
          Verteilung der negativen Viertelstunden über die Wochentage. An
          Wochenenden (rot) ist der Verbrauch niedriger, sodass Überschüsse aus
          Wind und Sonne häufiger zu negativen Preisen führen.
        </p>
        <WochentagChart data={stat.wochentagVerteilung} />
      </section>

      <section className="card">
        <div className="chart-title">Negative Stunden je Monat</div>
        <p className="hint">
          Summe der negativen Stunden je Monat – zeigt die saisonale Entwicklung.
        </p>
        <MonatChart data={stat.proMonat} />
      </section>

      <section className="card">
        <div className="chart-title">Täglicher Preisspread</div>
        <p className="hint">
          Differenz zwischen Höchst- und Tiefstpreis jedes Tages (ct/kWh). Ein
          großer Spread bedeutet viel Preisbewegung über den Tag – interessant für
          flexible Verbraucher und Speicher, die günstig laden und teuer nutzen
          bzw. einspeisen können.
        </p>
        <SpreadChart data={stat.spreadProTag} />
      </section>

      <section className="card">
        <div className="chart-title">Heatmap: negative Viertelstunden je Tag</div>
        <p className="hint">
          Kalenderansicht: Spalten sind Wochen, Zeilen die Wochentage (Mo–So).
          Jede Zelle steht für einen Tag; je kräftiger das Rot, desto mehr
          Viertelstunden dieses Tages hatten einen negativen Preis. Mit der Maus
          über eine Zelle erscheinen Datum und Anzahl.
        </p>
        <Heatmap data={stat.heatmap} wochen={stat.heatmapWochen} />
      </section>

      {vergleich.length > 0 && (
        <section className="card">
          <div className="chart-title">Jahresvergleich der Kernkennzahlen</div>
          <p className="hint">
            Vergleich der wichtigsten Kennzahlen über die Kalenderjahre (ab 2020,
            soweit Daten vorliegen) – unabhängig vom oben gewählten
            Auswertungsjahr. So lässt sich die Entwicklung z.&nbsp;B. der negativen
            Stunden über die Jahre auf einen Blick ablesen.
          </p>
          <div className="bs-compare-wrap">
            <div className="table-scroll">
            <table className="data-table bs-compare-table">
              <thead>
                <tr>
                  <th>Jahr</th>
                  <th>Tage</th>
                  <th>neg. Std</th>
                  <th>Nullstd</th>
                  <th>Tiefst</th>
                  <th>Höchst</th>
                  <th>Ø Preis</th>
                  <th>Ø Spread</th>
                  <th>max Spread</th>
                  <th>Anteil neg.</th>
                  <th>Anteil ≤ 0</th>
                </tr>
              </thead>
              <tbody>
                {vergleich.map((j) => (
                  <tr
                    key={j.jahr}
                    className={`bs-compare-clickable${j.jahr === stat.jahr ? " bs-compare-active" : ""}`}
                    onClick={() => { setJahr(j.jahr); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    title={`Auswertung für ${j.jahr} anzeigen`}
                  >
                    <td><strong>{j.jahr}</strong></td>
                    <td>{j.tageMitDaten}</td>
                    <td>{fmtStd(j.negStunden)}</td>
                    <td>{fmtStd(j.nullStunden)}</td>
                    <td>{j.tiefstpreis.toLocaleString("de-DE")}</td>
                    <td>{j.hoechstpreis.toLocaleString("de-DE")}</td>
                    <td>{j.durchschnittspreis.toLocaleString("de-DE")}</td>
                    <td>{j.avgTagesspread.toLocaleString("de-DE")}</td>
                    <td>{j.maxTagesspread.toLocaleString("de-DE")}</td>
                    <td>{j.anteilNegProzent.toLocaleString("de-DE")}&nbsp;%</td>
                    <td>{(j.anteilNullOderNegProzent ?? 0).toLocaleString("de-DE")}&nbsp;%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Preise in ct/kWh. Ein noch unvollständiges laufendes Jahr enthält
            entsprechend weniger Tage.
          </p>
        </section>
      )}
    </div>
  );
}
