// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type { Settings } from "./types";
import { nf } from "./chartUtils";
import { tarifAt } from "./tarif";

export function NetzentgeltChart({ settings: s }: { settings: Settings }) {
  const quarters = [1, 2, 3, 4];

  // Wertebereich für die y-Skalierung (alle drei Tarife)
  const maxVal = Math.max(
    s.netzentgeltStandard,
    s.netzentgeltHoch,
    s.netzentgeltNiedrig,
    0.1
  );

  // Geometrie: 4 Quartalspaneele nebeneinander
  const W = 760;
  const H = 150;
  const padT = 12;
  const padB = 24;
  const padL = 30;
  const gap = 14;
  const plotH = H - padT - padB;
  const panelW = (W - padL - gap * 3) / 4;

  const yOf = (v: number) => padT + (1 - v / maxVal) * plotH;
  const baseY = padT + plotH;

  // Tagesprofil eines Quartals als Stufenfläche (1 Wert je 15 Minuten)
  function panelPath(quarter: number): { d: string; marks: number[] } {
    const STEPS = 96;
    const stepW = panelW / STEPS;
    let d = "";
    const marks: number[] = []; // Minuten, an denen sich der Tarif ändert
    let prevTarif: string | null = null;
    for (let i = 0; i < STEPS; i++) {
      const minute = i * 15;
      const t = tarifAt(minute, quarter, s.lastWindows);
      const v =
        t === "hoch"
          ? s.netzentgeltHoch
          : t === "niedrig"
          ? s.netzentgeltNiedrig
          : s.netzentgeltStandard;
      const x = i * stepW;
      const y = yOf(v);
      if (i === 0) d += `M ${x} ${baseY} L ${x} ${y}`;
      else d += ` L ${x} ${y}`;
      d += ` L ${x + stepW} ${y}`;
      if (t !== prevTarif) {
        marks.push(minute);
        prevTarif = t;
      }
    }
    d += ` L ${panelW} ${baseY} Z`;
    return { d, marks };
  }

  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  return (
    <div className="ne-chart">
      <div className="ne-title">Netzentgelt-Tagesverlauf je Quartal</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="ne-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* y-Achse Beschriftung */}
        <text x={padL - 6} y={yOf(maxVal) + 4} className="ne-axis" textAnchor="end">
          {nf(maxVal, 1)}
        </text>
        <text x={padL - 6} y={baseY + 4} className="ne-axis" textAnchor="end">
          0
        </text>
        <text
          x={8}
          y={padT + plotH / 2}
          className="ne-axis"
          textAnchor="middle"
          transform={`rotate(-90 8 ${padT + plotH / 2})`}
        >
          Preis (ct/kWh)
        </text>

        {quarters.map((q, qi) => {
          const ox = padL + qi * (panelW + gap);
          const { d, marks } = panelPath(q);
          return (
            <g key={q} transform={`translate(${ox} 0)`}>
              {/* Quartalstrenner */}
              {qi > 0 && (
                <line
                  x1={-gap / 2}
                  x2={-gap / 2}
                  y1={padT - 4}
                  y2={baseY}
                  stroke="#ccc"
                />
              )}
              {/* Grundlinie */}
              <line x1={0} x2={panelW} y1={baseY} y2={baseY} stroke="#bbb" />
              {/* Tagesprofil */}
              <path d={d} className="ne-area" />
              {/* Quartalsbeschriftung */}
              <text x={panelW / 2} y={padT - 2} className="ne-qlabel" textAnchor="middle">
                Q{q} {new Date().getFullYear()}
              </text>
              {/* x-Achse: 0 und 24, plus die Tarifwechsel-Zeitpunkte */}
              <text x={0} y={H - 8} className="ne-axis" textAnchor="start">
                0
              </text>
              <text x={panelW} y={H - 8} className="ne-axis" textAnchor="end">
                24
              </text>
              {marks
                .filter((m) => m > 0)
                .map((m) => {
                  const x = (m / (24 * 60)) * panelW;
                  return (
                    <g key={m}>
                      <line
                        x1={x}
                        x2={x}
                        y1={baseY}
                        y2={baseY + 3}
                        stroke="#999"
                      />
                      <text
                        x={x}
                        y={H - 8}
                        className="ne-tick"
                        textAnchor="middle"
                      >
                        {hhmm(m)}
                      </text>
                    </g>
                  );
                })}
            </g>
          );
        })}
      </svg>
      <div className="ne-legend">
        Standard {s.netzentgeltStandard} · Hoch {s.netzentgeltHoch} · Niedrig{" "}
        {s.netzentgeltNiedrig} ct/kWh
      </div>
    </div>
  );
}
