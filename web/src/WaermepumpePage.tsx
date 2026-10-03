// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useState } from "react";
import { nf } from "./chartUtils";
import type { MouseEvent as ReactMouseEvent } from "react";
import { DateNav } from "./DateNav";
import { SourceLinks } from "./SourceLinks";
import { WpKpiBlock } from "./WpKpiBlock";
import { ChartDownloadButton } from "./ChartDownloadButton";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

interface Series {
  label: string;
  unit: string;
  points: Array<{ t: string; v: number }>;
}
interface DayData {
  date: string;
  label: string;
  series: Series[];
}

// Feste, gut unterscheidbare Farbpalette (zyklisch).
const PALETTE = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
  "#0d9488", "#c026d3",
];

// Achsenseite je Datenreihe.
type Axis = "left" | "right";

// Zeit "HH:MM:SS" -> Minuten seit Mitternacht (für x-Position).
function tToMin(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 60 + m + (s || 0) / 60;
}

// Minuten seit Mitternacht -> "HH:MM" (für die Zoom-Eingabefelder).
function minToHhmm(m: number): string {
  const mm = Math.max(0, Math.min(1439, Math.round(m)));
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}
// "HH:MM" -> Minuten (oder null bei ungültiger Eingabe).
function hhmmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function LineChart({
  series,
  visible,
  axisOf,
  colorOf,
  vonMin,
  bisMin,
}: {
  series: Series[];
  visible: Record<string, boolean>;
  axisOf: Record<string, Axis>;
  colorOf: Record<string, string>;
  vonMin: number; // sichtbarer Zeitbereich Beginn (Minuten seit Mitternacht)
  bisMin: number; // sichtbarer Zeitbereich Ende
}) {
  const W = 820, H = 340, padL = 56, padR = 56, padT = 16, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const shown = series.filter((s) => visible[s.label] && s.points.length > 0);

  const span = Math.max(1, bisMin - vonMin);
  const inView = (t: string) => {
    const m = tToMin(t);
    return m >= vonMin && m <= bisMin;
  };

  // Wertebereiche je Achse – nur über die im Zoom sichtbaren Punkte, damit die
  // y-Skalierung sich an den gezeigten Ausschnitt anpasst.
  const range = (axis: Axis) => {
    let min = Infinity, max = -Infinity;
    for (const s of shown) {
      if ((axisOf[s.label] ?? "left") !== axis) continue;
      for (const p of s.points) {
        if (!inView(p.t)) continue;
        if (p.v < min) min = p.v;
        if (p.v > max) max = p.v;
      }
    }
    if (!isFinite(min)) return null;
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    // Negative Werte kommen bei der Wärmepumpe nicht vor: die Achse geht daher
    // höchstens bis 0 hinunter, auch wenn der Puffer rechnerisch darunter läge.
    return { min: Math.max(0, min - pad), max: max + pad };
  };
  const leftR = range("left");
  const rightR = range("right");

  // Einheit einer Achse: nur wenn ALLE sichtbaren Reihen dieser Achse dieselbe
  // Einheit haben, wird sie als Achsentitel gezeigt. Bei gemischten Einheiten
  // (oder leerer Einheit) bleibt der Titel leer.
  const axisUnit = (axis: Axis): string => {
    const units = new Set<string>();
    for (const s of shown) {
      if ((axisOf[s.label] ?? "left") !== axis) continue;
      units.add(s.unit ?? "");
    }
    if (units.size === 1) return [...units][0];
    return "";
  };
  const leftUnit = axisUnit("left");
  const rightUnit = axisUnit("right");

  const xOf = (t: string) => padL + ((tToMin(t) - vonMin) / span) * plotW;
  const yOf = (v: number, axis: Axis) => {
    const r = axis === "left" ? leftR : rightR;
    if (!r) return padT + plotH / 2;
    return padT + (1 - (v - r.min) / (r.max - r.min)) * plotH;
  };

  // x-Achsen-Stützstellen: 5 gleichmäßige Zeitpunkte über den Zoom-Bereich.
  const xTicks = Array.from({ length: 5 }, (_, i) => vonMin + (span * i) / 4);
  const yTicks = (r: { min: number; max: number } | null) =>
    r ? [r.min, (r.min + r.max) / 2, r.max] : [];
  const fmt = (v: number) =>
    Math.abs(v) >= 100 ? nf(v, 0) : Math.abs(v) >= 1 ? nf(v, 1) : nf(v, 2);

  // --- Tooltip-Zustand ---
  const [hover, setHover] = useState<{ xPix: number; t: string } | null>(null);

  // Gemeinsames Zeitraster für den Tooltip: sortierte, eindeutige Zeitpunkte
  // aller sichtbaren Reihen im Zoom-Bereich.
  const times = useMemo(() => {
    const set = new Set<string>();
    for (const s of shown) for (const p of s.points) if (inView(p.t)) set.add(p.t);
    return [...set].sort();
  }, [shown, vonMin, bisMin]);

  // schnelle Wertsuche je Reihe: label -> (t -> v)
  const valueAt = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const s of shown) {
      m[s.label] = {};
      for (const p of s.points) m[s.label][p.t] = p.v;
    }
    return m;
  }, [shown]);

  function onMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (times.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Pixel -> SVG-Koordinate (viewBox-Skalierung berücksichtigen)
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (svgX - padL) / plotW;
    const targetMin = vonMin + frac * span;
    // nächstgelegenen Zeitpunkt finden
    let best = times[0], bestD = Infinity;
    for (const t of times) {
      const d = Math.abs(tToMin(t) - targetMin);
      if (d < bestD) { bestD = d; best = t; }
    }
    setHover({ xPix: xOf(best), t: best });
  }

  const hoverRows = hover
    ? shown
        .filter((s) => valueAt[s.label]?.[hover.t] !== undefined)
        .map((s) => ({ label: s.label, unit: s.unit, color: colorOf[s.label], v: valueAt[s.label][hover.t] }))
    : [];

  // Tooltip-Position als Prozent der Chartbreite (für HTML-Overlay).
  const tipLeftPct = hover ? (hover.xPix / W) * 100 : 0;
  const tipOnRight = tipLeftPct > 60;

  return (
    <div className="wp-chart-wrap" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg wp-chart" preserveAspectRatio="xMidYMid meet">
        {/* Gitter + linke y-Achse */}
        {yTicks(leftR).map((t, i) => (
          <g key={"l" + i}>
            <line x1={padL} x2={W - padR} y1={yOf(t, "left")} y2={yOf(t, "left")} stroke="#eee" />
            <text x={padL - 6} y={yOf(t, "left") + 4} className="tv-axis" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {/* rechte y-Achse */}
        {yTicks(rightR).map((t, i) => (
          <text key={"r" + i} x={W - padR + 6} y={yOf(t, "right") + 4} className="tv-axis" textAnchor="start">
            {fmt(t)}
          </text>
        ))}

        {/* x-Achse */}
        {xTicks.map((m, i) => (
          <text key={i} x={padL + ((m - vonMin) / span) * plotW} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">
            {minToHhmm(m)}
          </text>
        ))}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">
          Uhrzeit
        </text>
        {leftR && leftUnit && (
          <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
            transform={`rotate(-90 14 ${padT + plotH / 2})`}>
            {leftUnit}
          </text>
        )}
        {rightR && rightUnit && (
          <text x={W - 12} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
            transform={`rotate(90 ${W - 12} ${padT + plotH / 2})`}>
            {rightUnit}
          </text>
        )}

        {/* Linien (nur Punkte im Zoom-Bereich) */}
        {shown.map((s) => {
          const axis = axisOf[s.label] ?? "left";
          const pts = s.points.filter((p) => inView(p.t));
          const d = pts
            .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(1)} ${yOf(p.v, axis).toFixed(1)}`)
            .join(" ");
          return <path key={s.label} d={d} fill="none" stroke={colorOf[s.label]} strokeWidth={1.6} />;
        })}

        {/* Hover-Markierung: vertikale Linie + Punkte */}
        {hover && (
          <>
            <line x1={hover.xPix} x2={hover.xPix} y1={padT} y2={padT + plotH} stroke="#999" strokeDasharray="3 3" />
            {hoverRows.map((r) => (
              <circle key={r.label} cx={hover.xPix} cy={yOf(r.v, axisOf[r.label] ?? "left")} r={3} fill={r.color} />
            ))}
          </>
        )}
      </svg>

      {hover && hoverRows.length > 0 && (
        <div
          className="wp-tooltip"
          style={
            tipOnRight
              ? { right: `${100 - tipLeftPct}%`, marginRight: 10 }
              : { left: `${tipLeftPct}%`, marginLeft: 10 }
          }
        >
          <div className="wp-tooltip-time">{hover.t.slice(0, 5)} Uhr</div>
          {hoverRows.map((r) => (
            <div key={r.label} className="wp-tooltip-row">
              <span className="wp-swatch" style={{ background: r.color }} />
              <span className="wp-tooltip-label">{r.label}</span>
              <span className="wp-tooltip-val">
                {fmt(r.v)} {r.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WaermepumpePage() {
  const [date, setDate] = useState<string>(isoToday());
  const [day, setDay] = useState<DayData | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [axisOf, setAxisOf] = useState<Record<string, Axis>>({});
  // Sichtbarer Zeitbereich (Minuten seit Mitternacht) – Standard: ganzer Tag.
  const [vonMin, setVonMin] = useState(0);
  const [bisMin, setBisMin] = useState(1440);
  // Gespeicherte Auswahl (visible/axisOf) einmalig laden, bevor Defaults greifen.
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/waermepumpe/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { visible?: Record<string, boolean>; axisOf?: Record<string, Axis> } | null) => {
        if (p) {
          if (p.visible) setVisible(p.visible);
          if (p.axisOf) setAxisOf(p.axisOf);
        }
      })
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return; // erst nach dem Laden der gespeicherten Auswahl
    fetch(`/api/waermepumpe/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DayData | null) => {
        setDay(d);
        if (d) {
          // Defaults NUR für Reihen, die noch keine gespeicherte Auswahl haben.
          setVisible((prev) => {
            const next = { ...prev };
            for (const s of d.series) if (next[s.label] === undefined) next[s.label] = false;
            return next;
          });
          setAxisOf((prev) => {
            const next = { ...prev };
            // Neutrale Vorbelegung nach Einheit: die erste auftretende Einheit
            // landet links, die zweite rechts, weitere wieder links. Keine feste
            // Annahme über Temperatur/Leistung – der Nutzer stellt es je Reihe um.
            const unitAxis: Record<string, Axis> = {};
            let nextAxis: Axis = "left";
            for (const s of d.series) {
              const u = s.unit ?? "";
              if (unitAxis[u] === undefined) {
                unitAxis[u] = nextAxis;
                nextAxis = nextAxis === "left" ? "right" : "left";
              }
              if (next[s.label] === undefined) next[s.label] = unitAxis[u];
            }
            return next;
          });
        }
      })
      .catch(() => setDay(null));
  }, [date, prefsLoaded]);

  // Auswahl (sichtbare Reihen + Achsenzuordnung) speichern, sobald sie sich
  // ändert – aber erst nachdem die gespeicherte Auswahl geladen wurde, damit
  // der initiale Ladevorgang nicht sofort einen leeren Zustand zurückschreibt.
  useEffect(() => {
    if (!prefsLoaded) return;
    const id = setTimeout(() => {
      fetch("/api/waermepumpe/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible, axisOf }),
      }).catch(() => {});
    }, 400); // kleine Entprellung
    return () => clearTimeout(id);
  }, [visible, axisOf, prefsLoaded]);

  const colorOf = useMemo(() => {
    const map: Record<string, string> = {};
    (day?.series ?? []).forEach((s, i) => (map[s.label] = PALETTE[i % PALETTE.length]));
    return map;
  }, [day]);

  const series = day?.series ?? [];
  const anyVisible = series.some((s) => visible[s.label]);

  return (
    <div className="page">
      <div className="page-head">
        <h2>Wärmepumpe</h2>
      </div>
      <SourceLinks roles="heatpump" title="Weboberfläche der Wärmepumpe" />

      {/* Kennzahlen-Auswertung über wählbaren Zeitraum */}
      <WpKpiBlock />

      {series.length === 0 ? (
        <p className="hint">
          Noch keine Wärmepumpen-Daten vorhanden. Sobald die Wärmepumpen-Quelle
          aktiviert ist, werden ihre Datenreihen im eingestellten Intervall
          aufgezeichnet.
        </p>
      ) : (
        <div className="card">
          <div className="chart-kopf"><h3>Messwert-Verlauf</h3><ChartDownloadButton dateiname="waermepumpe-verlauf" /></div>
          <div className="wp-daynav">
            <DateNav value={date} onChange={setDate} />
          </div>
          <p className="hint">
            Zeitlicher Verlauf der Wärmepumpen-Messwerte des gewählten Tages
            (z.&nbsp;B. Heizleistung, Vor- und Rücklauftemperatur,
            Kompressorfrequenz, Wasserspeichertemperatur). Die Daten werden im
            Abfrageintervall der Wärmepumpen-Quelle über HeishaMon erfasst –
            deutlich feiner als die 15-Minuten-Bilanzen der übrigen Seiten. Über
            den Zeitausschnitt lässt sich in einzelne Stunden hineinzoomen, um die
            Feinstruktur (etwa Abtauzyklen) sichtbar zu machen; welche Reihen
            angezeigt werden und auf welcher Achse, stellst du unten ein.
          </p>
          <div className="wp-zoom">
            <span className="wp-zoom-label">Zeitausschnitt:</span>
            <input
              type="time"
              value={minToHhmm(vonMin)}
              onChange={(e) => {
                const m = hhmmToMin(e.target.value);
                if (m != null) setVonMin(Math.min(m, bisMin - 5));
              }}
            />
            <span>–</span>
            <input
              type="time"
              value={minToHhmm(bisMin === 1440 ? 1439 : bisMin)}
              onChange={(e) => {
                const m = hhmmToMin(e.target.value);
                if (m != null) setBisMin(Math.max(m, vonMin + 5));
              }}
            />
            <div className="wp-zoom-presets">
              <button onClick={() => { setVonMin(0); setBisMin(1440); }}>ganzer Tag</button>
              <button onClick={() => { setVonMin(0); setBisMin(6 * 60); }}>00–06</button>
              <button onClick={() => { setVonMin(6 * 60); setBisMin(12 * 60); }}>06–12</button>
              <button onClick={() => { setVonMin(12 * 60); setBisMin(18 * 60); }}>12–18</button>
              <button onClick={() => { setVonMin(18 * 60); setBisMin(24 * 60); }}>18–24</button>
            </div>
          </div>
          {anyVisible ? (
            <LineChart
              series={series}
              visible={visible}
              axisOf={axisOf}
              colorOf={colorOf}
              vonMin={vonMin}
              bisMin={bisMin}
            />
          ) : (
            <p className="hint">
              Keine Datenreihe ausgewählt. Wähle unten mindestens eine Reihe zum
              Anzeigen aus.
            </p>
          )}

          <h4 className="wp-subhead">Datenreihen</h4>
          <p className="hint">
            Klicke auf eine Zeile, um die Reihe im Diagramm ein- oder
            auszublenden. Ausgeblendete Reihen sind ausgegraut. Mit der
            Achsenwahl (<strong>L</strong> = linke, <strong>R</strong> = rechte
            y-Achse) ordnest du eine sichtbare Reihe einer der beiden y-Achsen
            zu – sinnvoll, um Größen mit sehr unterschiedlichen Wertebereichen
            (etwa Leistung in W und Temperatur in °C) gemeinsam lesbar
            darzustellen. Die Auswahl bleibt gespeichert.
          </p>
          <div className="table-scroll">
          <table className="data-table wp-series-table">
            <tbody>
              <tr>
                <th>Datenreihe</th>
                <th>Einheit</th>
                <th>Achse</th>
              </tr>
              {series.map((s) => {
                const isVisible = !!visible[s.label];
                const axis = axisOf[s.label] ?? "left";
                const hasData = s.points.length > 0;
                return (
                  <tr
                    key={s.label}
                    className={`${hasData ? "" : "wp-nodata"} wp-series-row${isVisible ? "" : " wp-row-off"}`}
                    style={{ cursor: hasData ? "pointer" : "default" }}
                    onClick={() => { if (hasData) setVisible((p) => ({ ...p, [s.label]: !p[s.label] })); }}
                    title={hasData ? (isVisible ? "Klicken zum Ausblenden" : "Klicken zum Einblenden") : undefined}
                  >
                    <td style={{ textAlign: "left" }}>
                      <span className="wp-swatch" style={{ background: colorOf[s.label] }} />
                      {s.label}
                      {!hasData && <span className="wp-nodata-hint"> (heute keine Daten)</span>}
                    </td>
                    <td>{s.unit || "–"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="wp-axis-switch">
                        <button
                          className={axis === "left" ? "active" : ""}
                          onClick={() => setAxisOf((p) => ({ ...p, [s.label]: "left" }))}
                          title="linke Achse"
                        >
                          L
                        </button>
                        <button
                          className={axis === "right" ? "active" : ""}
                          onClick={() => setAxisOf((p) => ({ ...p, [s.label]: "right" }))}
                          title="rechte Achse"
                        >
                          R
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
