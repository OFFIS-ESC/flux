// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { ChartDownloadButton } from "./ChartDownloadButton";
import { useEffect, useState } from "react";
import { nf } from "./chartUtils";
import { DateNav } from "./DateNav";
import type { SpotpreisTag, Settings } from "./types";
import { netzentgeltAt } from "./tarif";
import { ChartHoverLayer } from "./ChartHoverLayer";

// lokales Datum als YYYY-MM-DD
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SpotChart({
  disabled,
  settings,
}: {
  disabled: boolean;
  settings: Settings;
}) {
  const [date, setDate] = useState(isoToday());
  const [data, setData] = useState<SpotpreisTag | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  // Spätestes verfügbares Börsenpreis-Datum (Obergrenze der Navigation). Bis zu
  // diesem Tag darf der Folgetag-Pfeil gehen – so ist der morgige Tag erreichbar,
  // sobald dessen Day-Ahead-Preise abgerufen wurden. Mindestens heute.
  const [latest, setLatest] = useState(isoToday());
  // Anzeigemodus: reiner Börsenpreis (netto) oder Endkunden-Gesamtpreis (brutto)
  const [mode, setMode] = useState<"netto" | "brutto">("netto");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/spotpreise/latest")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.latest) return;
        // Obergrenze = max(heute, spätestes verfügbares Datum).
        setLatest((prev) => (d.latest > prev ? d.latest : prev));
      })
      .catch(() => { /* Default heute bleibt */ });
    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/spotpreise?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Erzwungener Neu-Download des gewählten Tages (z.B. bei fehlerhaften Daten).
  async function reload() {
    if (disabled || reloading) return;
    setReloading(true);
    try {
      const r = await fetch(
        `/api/spotpreise/reload?date=${date}`,
        { method: "POST" }
      );
      setData(await r.json());
    } catch {
      /* ignore */
    } finally {
      setReloading(false);
    }
  }

  // Preisbestandteile außer Netzentgelt (netto, ct/kWh). Das Netzentgelt
  // kommt je Viertelstunde dazu – bei aktivem §14a zeit-/quartalsabhängig.
  // "Beschaffung" ist der Anbieter-Aufschlag und gilt nur beim dyn. Tarif.
  const bestandteileOhneNetz =
    settings.beschaffung +
    settings.stromsteuer +
    settings.konzessionsabgabe +
    settings.aufschlagNetznutzung +
    settings.offshoreUmlage +
    settings.kwkgUmlage;

  // gewählter Tag als Date-Basis (lokale Zeit)
  const baseDate = new Date(`${date}T00:00:00`);

  const rawPrices = data?.prices ?? [];

  // Zeitauflösung aus der Anzahl Werte ableiten: stündliche Tage (23/24/25 Werte
  // an DST-Tagen) haben 60 min je Slot, viertelstündliche (92/96/100) 15 min.
  // So sitzt das Netzentgelt (§14a, uhrzeitabhängig) auch bei historischen
  // Stundenpreisen und an Zeitumstellungstagen an der richtigen Tageszeit.
  const slotMinutes = rawPrices.length <= 26 ? 60 : 15;

  // Day-Ahead-Preis (netto, ct/kWh) des i-ten Slots -> Anzeigewert.
  // Brutto: (Börsenpreis + feste Bestandteile + Netzentgelt zur Uhrzeit) * (1+USt).
  // Bei aktivem §14a variiert das Netzentgelt über den Tag (Hoch/Niedrig).
  const toDisplay = (spot: number, i: number) => {
    if (mode !== "brutto") return spot;
    const slot = new Date(baseDate.getTime() + i * slotMinutes * 60 * 1000);
    const netz = netzentgeltAt(settings, slot);
    return (spot + bestandteileOhneNetz + netz) * (1 + settings.umsatzsteuer / 100);
  };

  const prices = rawPrices.map(toDisplay);
  const hasData = prices.length > 0;

  // Chart-Geometrie
  const W = 760;
  const H = 298;
  const padL = 48;
  const padR = 12;
  const padT = 14;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Fixtarif-Referenzlinie: bei aktivem Fixtarif und Brutto-Ansicht.
  const fixLineCt = mode === "brutto" && settings.tarifMode !== "dyn"
    ? settings.strompreis * 100
    : null;

  const max = hasData ? Math.max(...prices, 0, fixLineCt ?? -Infinity) : 1;
  const min = hasData ? Math.min(...prices, 0) : 0;
  const range = max - min || 1;
  // y-Position von Wert 0 und Skalierung
  const yOf = (v: number) => padT + ((max - v) / range) * plotH;
  const zeroY = yOf(0);
  const barW = plotW / (prices.length || 1);

  // y-Achsen-Ticks (round zahlen)
  const tickStep = max - min > 40 ? 20 : 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / tickStep) * tickStep; t <= max; t += tickStep) {
    ticks.push(t);
  }

  // x-Achsen-Beschriftung: alle 6 Stunden (= alle 24 Viertelstunden)
  const hourLabels = [0, 6, 12, 18, 24];

  return (
    <div className={`spot-chart ${disabled ? "ek-disabled" : ""}`}>
      <div className="spot-head">
        <div className="spot-controls">
          <div className="ek-switch spot-switch">
            <button
              className={mode === "netto" ? "active" : ""}
              disabled={disabled}
              onClick={() => setMode("netto")}
            >
              Day-Ahead (netto)
            </button>
            <button
              className={mode === "brutto" ? "active" : ""}
              disabled={disabled}
              onClick={() => setMode("brutto")}
            >
              Gesamtpreis (brutto)
            </button>
          </div>
          <div className="spot-datenav">
            <DateNav value={date} onChange={setDate} max={latest} disabled={disabled} label="" />
            <button
              className="spot-reload"
              title="Preise für diesen Tag neu herunterladen"
              disabled={disabled || reloading}
              onClick={reload}
            >
              <span className={reloading ? "spin" : ""}>↻</span>
            </button>
          </div>
        </div>
      </div>
      <div className="spot-legend">
        {mode === "brutto" ? (
          <>
            Endkunden-Gesamtpreis in ct/kWh im 15-Minuten-Raster (Börsenpreis +
            alle Preisbestandteile + {settings.umsatzsteuer}% USt.) ·{" "}
          </>
        ) : (
          <>
            Day-Ahead-Preise in ct/kWh im 15-Minuten-Raster ·{" "}
          </>
        )}
        <span style={{ color: settings.vizColorSpotNegativ, fontWeight: 600 }}>negativ</span> ·{" "}
        <span style={{ color: settings.vizColorSpotPositiv, fontWeight: 600 }}>positiv</span>
      </div>

      {loading && <p className="ek-hint">lädt…</p>}
      {!loading && !hasData && (
        <div className="ek-hint">
          <p>
            Für {date} liegen noch keine Preise vor. Day-Ahead-Preise für den
            Folgetag erscheinen meist nachmittags gegen 15 Uhr.
          </p>
          {data?.sourceUrl && (
            <p>
              Die Daten für diesen Tag lassen sich direkt hier abrufen:{" "}
              <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">
                {data.sourceUrl}
              </a>
            </p>
          )}
        </div>
      )}

      {hasData && (
        <div className="chart-wrap">
        <div className="chart-kopf-mini"><ChartDownloadButton dateiname="boersenstrompreis" /></div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="spot-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Nulllinie + y-Ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke={t === 0 ? "#bbb" : "#eee"}
              />
              <text x={padL - 6} y={yOf(t) + 4} className="spot-axis" textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {/* Balken */}
          {prices.map((v, i) => {
            const x = padL + i * barW;
            const neg = v < 0;
            const top = neg ? zeroY : yOf(v);
            const h = Math.abs(yOf(v) - zeroY);
            return (
              <rect
                key={i}
                x={x + 0.5}
                y={top}
                width={Math.max(barW - 1, 0.5)}
                height={Math.max(h, 0.5)}
                fill={neg ? settings.vizColorSpotNegativ : settings.vizColorSpotPositiv}
              />
            );
          })}

          {/* Fixtarif-Referenzlinie (nur brutto + aktiver Fixtarif) */}
          {fixLineCt != null && (
            <g>
              <line x1={padL} x2={W - padR} y1={yOf(fixLineCt)} y2={yOf(fixLineCt)}
                stroke="#e8590c" strokeWidth={2} strokeDasharray="6 3" />
              <text x={W - padR - 4} y={yOf(fixLineCt) - 4} className="spot-axis"
                textAnchor="end" fill="#e8590c" style={{ fontWeight: 600 }}>
                Fixtarif {nf(fixLineCt, 1)} ct
              </text>
            </g>
          )}

          {/* x-Achsen-Stunden */}
          {hourLabels.map((h) => {
            const x = padL + (h / 24) * plotW;
            return (
              <text
                key={h}
                x={x}
                y={padT + plotH + 16}
                className="spot-axis"
                textAnchor="middle"
              >
                {String(h).padStart(2, "0")}
              </text>
            );
          })}
          {/* Achsentitel */}
          <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">
            Uhrzeit
          </text>
          <text
            x={14}
            y={padT + plotH / 2}
            className="tv-axis-title"
            textAnchor="middle"
            transform={`rotate(-90 14 ${padT + plotH / 2})`}
          >
            ct/kWh
          </text>
        </svg>
        <ChartHoverLayer
          svgW={W}
          plotL={padL}
          plotW={plotW}
          rowsForSlot={(i) => [
            {
              label: mode === "brutto" ? "Gesamtpreis" : "Day-Ahead",
              value: `${nf(prices[i], 2)} ct/kWh`,
              color: prices[i] < 0 ? settings.vizColorSpotNegativ : settings.vizColorSpotPositiv,
            },
          ]}
        />
        </div>
      )}
    </div>
  );
}
