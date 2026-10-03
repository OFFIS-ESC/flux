// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { DateNav } from "./DateNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale, convertEnergie, einheitLabel, fmtTick, type EnergieEinheit, nf } from "./chartUtils";
import { effectiveIcon } from "./iconDefaults";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Serie {
  id: string;
  label: string;
  icon: string | null;
  deviceType?: string | null;
  values: number[]; // 96 Viertelstunden, kWh
  summe: number;
}

// Liefert das anzuzeigende Icon einer Serie (mit deviceType-Fallback), damit in
// der Legende einheitlich immer ein Icon erscheint – nicht nur bei Geräten mit
// benutzerdefiniertem Icon.
export function serieIcon(s: Serie): string {
  return effectiveIcon({ icon: s.icon ?? undefined, deviceType: s.deviceType ?? undefined, role: "consumer" });
}

// Farbpalette für die gestapelten Verbraucher (stabil je Position).
export const PALETTE = [
  "#76b900", "#e08a1e", "#3b7dd8", "#c0152f", "#8e44ad",
  "#16a085", "#d4ac0d", "#e91e63", "#607d8b", "#2ecc71",
  "#ff7043", "#5c6bc0", "#26a69a", "#ec407a", "#9ccc65",
];

// Gestapeltes Balkenchart aller Verbraucher eines Raums über den Tag.
export interface ChartOverlay {
  // 96 Werte in kWh je Viertelstunde (Prognose). Nur ab startSlot gezeichnet.
  values: number[];
  startSlot: number;   // ab dieser VS zeichnen (aktuelle VS)
  color: string;
  label?: string;
}

export function StackedRoomChart({
  series,
  hidden,
  einheit,
  overlay,
  yTitle,
}: {
  series: Serie[];
  hidden: Set<string>;
  einheit: EnergieEinheit;
  overlay?: ChartOverlay;
  yTitle?: string;
}) {
  const W = 760, H = 300, padL = 48, padR = 12, padT = 14, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const visible = series.filter((s) => !hidden.has(s.id));

  // Summe je Slot (nur sichtbare Reihen) -> Maximum für die Skala.
  const stackSum = new Array(96).fill(0);
  for (let i = 0; i < 96; i++) {
    let sum = 0;
    for (const s of visible) sum += s.values[i];
    stackSum[i] = sum;
  }
  // Prognose-Overlay in die Skala einbeziehen, damit die Linie nicht aus dem
  // Chart läuft, wenn sie höher liegt als die real gemessenen Balken.
  const overlayMax = overlay ? Math.max(0, ...overlay.values) : 0;
  const maxKwh = Math.max(0.0001, ...stackSum, overlayMax);
  const scale = niceScale(cv(maxKwh));
  const dispMax = scale.max;
  const barW = plotW / 96;
  const yOf = (vDisp: number) => padT + (1 - vDisp / dispMax) * plotH;
  const baseY = padT + plotH;
  const hourLabels = [0, 6, 12, 18, 24];
  const colorOf = (id: string) => PALETTE[series.findIndex((s) => s.id === id) % PALETTE.length];

  // Prognose-Linienpunkte (Mitte der jeweiligen VS ab startSlot).
  const overlayPts = overlay
    ? overlay.values
        .map((v, i) => ({ i, v }))
        .filter((p) => p.i >= overlay.startSlot)
        .map((p) => `${padL + p.i * barW + barW / 2},${yOf(cv(p.v))}`)
        .join(" ")
    : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
          <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{fmtTick(t, einheit)}</text>
        </g>
      ))}
      {Array.from({ length: 96 }, (_, i) => {
        let acc = 0;
        return (
          <g key={i}>
            {visible.map((s) => {
              const v = s.values[i];
              if (v <= 0) return null;
              const yTop = yOf(cv(acc + v));
              const yBot = yOf(cv(acc));
              acc += v;
              return (
                <rect
                  key={s.id}
                  x={padL + i * barW + 0.3}
                  y={yTop}
                  width={Math.max(barW - 0.6, 0.4)}
                  height={Math.max(yBot - yTop, 0.2)}
                  fill={colorOf(s.id)}
                />
              );
            })}
          </g>
        );
      })}
      {/* Prognose als dezente gestrichelte Linie ab der aktuellen Viertelstunde */}
      {overlay && overlayPts && (
        <polyline
          points={overlayPts}
          fill="none"
          stroke={overlay.color}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinejoin="round"
          opacity={0.75}
        />
      )}
      {hourLabels.map((h) => (
        <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">
          {String(h).padStart(2, "0")}
        </text>
      ))}
      <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">Uhrzeit</text>
      {yTitle && (
        <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>{yTitle}</text>
      )}
    </svg>
  );
}

// Aufklappbarer, gestapelter Raum-Tagesverlauf: alle Verbraucher des Raums
// übereinandergestapelt, mit Legende (Reihen ausblendbar), kWh/W-Umschalter und
// Mouseover-Tooltip je Viertelstunde.
export function RoomDayChart({ room, initialDate }: { room: string; initialDate?: string }) {
  const [date, setDate] = useState<string>(initialDate ?? isoToday());
  const [series, setSeries] = useState<Serie[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/room/day?room=${encodeURIComponent(room)}&date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSeries(d?.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [room, date]);

  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const colorOf = (id: string) =>
    PALETTE[(series ?? []).findIndex((s) => s.id === id) % PALETTE.length];

  const toggle = (id: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const visible = (series ?? []).filter((s) => !hidden.has(s.id));

  return (
    <div className="consumer-detail-inline">
      <div className="lp-controls">
        <DateNav value={date} onChange={setDate} />
      </div>
      <p className="hint" style={{ margin: "4px 0 6px" }}>
        Gestapelter Tagesverlauf aller Verbraucher dieses Raums (kWh je
        Viertelstunde). Einzelne Geräte über die Legende aus- und einblenden.
      </p>
      {loading && !series && <p className="hint">Lade Tagesverlauf…</p>}
      {series && series.length === 0 && (
        <p className="hint">Keine Verbraucher mit Tagesdaten in diesem Raum.</p>
      )}
      {series && series.length > 0 && (
        <div className="chart-wrap">
          <div className="chart-toolbar">
            <div className="chart-legend">
              {series.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chart-legend-item${hidden.has(s.id) ? " off" : ""}`}
                  onClick={() => toggle(s.id)}
                  title={hidden.has(s.id) ? "einblenden" : "ausblenden"}
                >
                  <span className="chart-legend-swatch" style={{ background: colorOf(s.id) }} />
                  {serieIcon(s)} {s.label}
                </button>
              ))}
            </div>
            <div className="chart-unit-switch">
              <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
              <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
            </div>
          </div>
          <StackedRoomChart series={series} hidden={hidden} einheit={einheit} />
          <ChartHoverLayer
            svgW={760}
            plotL={48}
            plotW={760 - 48 - 12}
            rowsForSlot={(i) => {
              const rows = visible
                .filter((s) => s.values[i] > 0)
                .map((s) => ({
                  label: `${serieIcon(s)} ${s.label}`,
                  value: `${nf(cv(s.values[i]), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`,
                  color: colorOf(s.id),
                }));
              const sum = visible.reduce((a, s) => a + s.values[i], 0);
              if (rows.length > 1) {
                rows.push({
                  label: "Summe",
                  value: `${nf(cv(sum), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`,
                  color: "#333",
                });
              }
              return rows;
            }}
          />
        </div>
      )}
    </div>
  );
}
