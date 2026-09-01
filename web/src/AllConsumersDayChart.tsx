// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { convertEnergie, einheitLabel, type EnergieEinheit, nf } from "./chartUtils";
import { StackedRoomChart, PALETTE, serieIcon, type Serie } from "./RoomDayChart";

// Gestapeltes Tagesdiagramm ALLER Verbraucher (raumübergreifend) für den in der
// Verbraucher-Tabelle gewählten Tag. Nutzt denselben Chart-Baustein wie das
// Raum-Diagramm, lädt die Daten aber vom raumübergreifenden Endpoint.
export function AllConsumersDayChart({ date }: { date: string }) {
  const [series, setSeries] = useState<Serie[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/consumers/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSeries((d?.series ?? []).filter((s: Serie) => s.summe > 0)))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [date]);

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
      <p className="hint" style={{ margin: "4px 0 6px" }}>
        Gestapelter Tagesverlauf aller Verbraucher (kWh je Viertelstunde).
        Einzelne Geräte über die Legende aus- und einblenden.
      </p>
      {loading && !series && <p className="hint">Lade Tagesverlauf…</p>}
      {series && series.length === 0 && (
        <p className="hint">Keine Verbraucher mit Tagesdaten an diesem Tag.</p>
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
          <StackedRoomChart series={series} hidden={hidden} einheit={einheit} yTitle={einheit === "w" ? "Ø-Leistung (W)" : "Verbrauch (kWh)"} />
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
