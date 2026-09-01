// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useState } from "react";

// Eine Zeile im Tooltip: Beschriftung + formatierter Wert.
export type TooltipRow = { label: string; value: string; color?: string };

// Liefert die Werte-Zeilen für die Spalte mit Index i.
export type RowsForSlot = (i: number) => TooltipRow[];

// Uhrzeit-Bereich einer Viertelstunde, z.B. "08:00–08:15".
export function slotTimeRange(i: number): string {
  const startMin = i * 15;
  const endMin = startMin + 15;
  const fmt = (min: number) => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  return `${fmt(startMin)}–${fmt(endMin)}`;
}

// Legt über ein Bar-Chart eine transparente Hover-Schicht mit `count` Spalten.
// Beim Überfahren einer Spalte erscheint ein HTML-Tooltip mit einer Kopfzeile
// (labelForSlot) und allen Werten dieser Spalte (rowsForSlot). Der Layer wird
// als Geschwister des SVG in einen `position: relative`-Container gesetzt.
//
// plotL/plotW: linke Kante und Breite des Plotbereichs in SVG-Koordinaten;
// svgW: viewBox-Breite des Charts (zur Umrechnung in Prozent).
export function ChartHoverLayer({
  svgW,
  plotL,
  plotW,
  rowsForSlot,
  count = 96,
  labelForSlot = slotTimeRange,
  tooltipTop = 46,
}: {
  svgW: number;
  plotL: number;
  plotW: number;
  rowsForSlot: RowsForSlot;
  count?: number;
  labelForSlot?: (i: number) => string;
  tooltipTop?: number;
}) {
  const [active, setActive] = useState<number | null>(null);

  const leftPct = (plotL / svgW) * 100;
  const widthPct = (plotW / svgW) * 100;
  const colPct = widthPct / count;

  const rows = active != null ? rowsForSlot(active) : [];

  return (
    <div className="chart-hover-layer">
      {/* unsichtbare Hover-Spalten */}
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="chart-hover-col"
          style={{
            left: `${leftPct + i * colPct}%`,
            width: `${colPct}%`,
          }}
          onMouseEnter={() => setActive(i)}
          onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
        />
      ))}

      {active != null && (
        <div
          className="chart-tooltip"
          style={{
            // Tooltip an der Spaltenmitte ausrichten; per transform zentriert.
            left: `${leftPct + (active + 0.5) * colPct}%`,
            top: `${tooltipTop}px`,
          }}
        >
          <div className="chart-tooltip-time">{labelForSlot(active)}</div>
          {rows.length === 0 ? (
            <div className="chart-tooltip-row">keine Daten</div>
          ) : (
            rows.map((r, idx) => (
              <div className="chart-tooltip-row" key={idx}>
                {r.color && (
                  <span
                    className="chart-tooltip-dot"
                    style={{ background: r.color }}
                  />
                )}
                <span className="chart-tooltip-label">{r.label}</span>
                <span className="chart-tooltip-value">{r.value}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
