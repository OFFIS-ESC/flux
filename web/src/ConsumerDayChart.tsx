// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { DateNav } from "./DateNav";
import { MonthNav } from "./MonthNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale, convertEnergie, einheitLabel, fmtTick, type EnergieEinheit, nf } from "./chartUtils";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

interface DayData {
  id: string;
  date: string;
  label: string;
  icon: string | null;
  room: string | null;
  values: number[];
  summe: number;
  bidirectional?: boolean;
  feedinValues?: number[];
  feedinSumme?: number;
}

interface RangeData {
  id: string;
  gran: "monat" | "jahr";
  date: string;
  label: string;
  bidirectional?: boolean;
  buckets: Array<{ bucket: string; label: string; kwh: number; feedin?: number }>;
  summe: number;
  feedinSumme?: number;
}

// Verbrauchs-Bar-Chart (96 Viertelstunden). Werte sind kWh je Viertelstunde;
// per Switch auf mittlere Leistung (W) umschaltbar. Bei bidirektionalen
// Speichern wird zusätzlich die Einspeise-Serie (feedin) nach unten gezeichnet,
// der Bezug bleibt oben – getrennt, ohne Saldierung.
function VerbrauchChart({
  values,
  color,
  feedin,
  feedinColor = "#e08a1e",
}: {
  values: number[];
  color: string;
  feedin?: number[];
  feedinColor?: string;
}) {
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const bidir = !!feedin;
  // Geometrie an die Monats-/Jahres-Balkencharts (RangeBars) angeglichen, damit
  // alle drei Ansichten gleich breit/hoch wirken (gleiches Seitenverhältnis).
  const W = 760, H = bidir ? 280 : 240, padL = 60, padR = 12, padT = 14, padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const maxUp = Math.max(0.0001, ...values);
  const maxDown = feedin ? Math.max(0.0001, ...feedin) : 0;
  const barW = plotW / 96;
  const hourLabels = [0, 6, 12, 18, 24];

  if (bidir) {
    // Symmetrische Achse: 0 in der Mitte, Bezug oben, Einspeisung unten.
    const scale = niceScale(cv(Math.max(maxUp, maxDown)));
    const dispMax = scale.max;
    const midY = padT + plotH / 2;
    const halfH = plotH / 2;
    const yUp = (vDisp: number) => midY - (vDisp / dispMax) * halfH;
    const yDown = (vDisp: number) => midY + (vDisp / dispMax) * halfH;
    return (
      <div className="chart-wrap">
        <div className="chart-toolbar">
          <div className="chart-legend">
            <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: color }} />Netzladung</span>
            <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: feedinColor }} />Einspeisung</span>
          </div>
          <div className="chart-unit-switch">
            <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
            <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
          {[dispMax, dispMax / 2, 0].map((t) => (
            <g key={`u${t}`}>
              <line x1={padL} x2={W - padR} y1={yUp(t)} y2={yUp(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
              <text x={padL - 6} y={yUp(t) + 4} className="tv-axis" textAnchor="end">{fmtTick(t, einheit)}</text>
            </g>
          ))}
          {[dispMax / 2, dispMax].map((t) => (
            <g key={`d${t}`}>
              <line x1={padL} x2={W - padR} y1={yDown(t)} y2={yDown(t)} stroke="#eee" />
              <text x={padL - 6} y={yDown(t) + 4} className="tv-axis" textAnchor="end">{fmtTick(t, einheit)}</text>
            </g>
          ))}
          {values.map((v, i) => {
            if (v <= 0) return null;
            const y = yUp(cv(v));
            return <rect key={`u${i}`} x={padL + i * barW + 0.5} y={y} width={Math.max(barW - 1, 0.5)} height={Math.max(midY - y, 0.3)} fill={color} />;
          })}
          {feedin!.map((v, i) => {
            if (v <= 0) return null;
            const y = yDown(cv(v));
            return <rect key={`d${i}`} x={padL + i * barW + 0.5} y={midY} width={Math.max(barW - 1, 0.5)} height={Math.max(y - midY, 0.3)} fill={feedinColor} />;
          })}
          {hourLabels.map((h) => (
            <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{String(h).padStart(2, "0")}</text>
          ))}
          <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">Uhrzeit</text>
          <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
            transform={`rotate(-90 14 ${padT + plotH / 2})`}>{einheit === "w" ? "Ø-Leistung (W)" : "Energie (kWh)"}</text>
          <text x={padL + 2} y={padT + 10} className="tv-dir" fill={color}>▲ Netzladung</text>
          <text x={padL + 2} y={padT + plotH - 2} className="tv-dir" fill={feedinColor}>▼ Einspeisung</text>
        </svg>
        <ChartHoverLayer
          svgW={W}
          plotL={padL}
          plotW={plotW}
          rowsForSlot={(i) => {
            const rows: Array<{ label: string; value: string; color: string }> = [];
            if (values[i] > 0) rows.push({ label: "Netzladung", value: `${nf(cv(values[i]), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`, color });
            if (feedin![i] > 0) rows.push({ label: "Einspeisung", value: `${nf(cv(feedin![i]), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`, color: feedinColor });
            if (rows.length === 0) rows.push({ label: "—", value: "0", color: "#999" });
            return rows;
          }}
        />
      </div>
    );
  }

  const scale = niceScale(cv(maxUp));
  const dispMax = scale.max;
  const yOf = (vDisp: number) => padT + (1 - vDisp / dispMax) * plotH;
  const baseY = padT + plotH;
  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend">
          <span className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: color }} />
            Verbrauch
          </span>
        </div>
        <div className="chart-unit-switch">
          <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
          <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
            <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">
              {fmtTick(t, einheit)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          if (v <= 0) return null;
          const y = yOf(cv(v));
          return (
            <rect
              key={i}
              x={padL + i * barW + 0.5}
              y={y}
              width={Math.max(barW - 1, 0.5)}
              height={Math.max(baseY - y, 0.3)}
              fill={color}
            />
          );
        })}
        {hourLabels.map((h) => (
          <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">
            {String(h).padStart(2, "0")}
          </text>
        ))}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">
          Uhrzeit
        </text>
        <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>{einheit === "w" ? "Ø-Leistung (W)" : "Verbrauch (kWh)"}</text>
      </svg>
      <ChartHoverLayer
        svgW={W}
        plotL={padL}
        plotW={plotW}
        rowsForSlot={(i) => [
          { label: "Verbrauch", value: `${nf(cv(values[i]), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`, color },
        ]}
      />
    </div>
  );
}

// Ausklappbarer Tagesverlauf eines Verbrauchers – wird direkt unter der
// Verbraucherzeile eingebettet (keine eigene Seite mehr). Lädt die Tagesdaten
// selbst und bietet die Datumsnavigation.
export function ConsumerDayChart({
  consumerId,
  color,
  extraLinks,
  initialDate,
}: {
  consumerId: string;
  color: string;
  extraLinks?: Array<{ url: string; label: string }>;
  initialDate?: string;
}) {
  const [date, setDate] = useState<string>(initialDate ?? isoToday());
  const feedinColor = "#e08a1e"; // Einspeise-/Entladefarbe (wie im Tageschart)
  const [day, setDay] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);

  // Granularität der Ansicht: Tagesverlauf (wie bisher) oder aggregierter
  // Gesamtverbrauch über Monat bzw. Jahr.
  const [gran, setGran] = useState<"tag" | "monat" | "jahr">("tag");
  const [ym, setYm] = useState<string>((initialDate ?? isoToday()).slice(0, 7)); // Monat YYYY-MM
  const [jahr, setJahr] = useState<number>(Number((initialDate ?? isoToday()).slice(0, 4)));
  const [range, setRange] = useState<RangeData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  useEffect(() => {
    if (!consumerId || gran !== "tag") return;
    setLoading(true);
    fetch(`/api/consumer/${encodeURIComponent(consumerId)}/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDay(d))
      .catch(() => setDay(null))
      .finally(() => setLoading(false));
  }, [consumerId, date, gran]);

  useEffect(() => {
    if (!consumerId || gran === "tag") return;
    const refDate = gran === "monat" ? `${ym}-01` : `${jahr}-01-01`;
    setRangeLoading(true);
    fetch(`/api/consumer/${encodeURIComponent(consumerId)}/range?gran=${gran}&date=${refDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRange(d))
      .catch(() => setRange(null))
      .finally(() => setRangeLoading(false));
  }, [consumerId, gran, ym, jahr]);

  return (
    <div className="consumer-detail-inline">
      {extraLinks && extraLinks.filter((l) => l.url).length > 0 && (
        <div className="consumer-links">
          {extraLinks
            .filter((l) => l.url)
            .map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer" className="consumer-link">
                🔗 {l.label || l.url}
              </a>
            ))}
        </div>
      )}
      <div className="cdc-gran-switch">
        <button className={gran === "tag" ? "active" : ""} onClick={() => setGran("tag")}>Tag</button>
        <button className={gran === "monat" ? "active" : ""} onClick={() => setGran("monat")}>Monat</button>
        <button className={gran === "jahr" ? "active" : ""} onClick={() => setGran("jahr")}>Jahr</button>
      </div>

      {gran === "tag" && (
        <>
          <div className="lp-controls">
            <DateNav value={date} onChange={setDate} />
          </div>
          <p className="hint" style={{ margin: "4px 0 6px" }}>
            Verbrauch dieses Geräts über den Tag in 15-Minuten-Schritten (kWh je
            Viertelstunde), gebildet aus der gemessenen Momentanleistung.
          </p>
          {loading && !day && <p className="hint">Lade Tagesverlauf…</p>}
          {day && (
            <>
              <p className="cdc-summe">Tagesverbrauch: <strong>{nf(day.summe, 2)} kWh</strong>
                {day.bidirectional && day.feedinSumme != null && (
                  <> · Einspeisung: <strong>{nf(day.feedinSumme, 2)} kWh</strong></>
                )}
              </p>
              <VerbrauchChart
                values={day.values}
                color={color}
                feedin={day.bidirectional ? (day.feedinValues ?? new Array(96).fill(0)) : undefined}
              />
            </>
          )}
          {day && day.summe <= 0 && (
            <p className="hint">Für diesen Tag liegen keine Verbrauchsdaten vor.</p>
          )}
        </>
      )}

      {gran === "monat" && (
        <>
          <div className="lp-controls">
            <MonthNav value={ym} onChange={setYm} />
          </div>
          <p className="hint" style={{ margin: "4px 0 6px" }}>
            Gesamtverbrauch dieses Geräts je Tag des Monats (kWh).
          </p>
          {rangeLoading && !range && <p className="hint">Lade Monatsübersicht…</p>}
          {range && (
            <>
              <p className="cdc-summe">Monatsverbrauch: <strong>{nf(range.summe, 2)} kWh</strong>
                {range.bidirectional && range.feedinSumme != null && (
                  <> · Einspeisung: <strong>{nf(range.feedinSumme, 2)} kWh</strong></>
                )}
              </p>
              <RangeBars
                buckets={range.buckets}
                color={color}
                unit="kWh"
                xTitle="Tag des Monats"
                feedinColor={range.bidirectional ? feedinColor : undefined}
                onBarClick={(bucket) => { setDate(bucket); setGran("tag"); }}
              />
              {range.summe <= 0 && <p className="hint">Für diesen Monat liegen keine Verbrauchsdaten vor.</p>}
            </>
          )}
        </>
      )}

      {gran === "jahr" && (
        <>
          <div className="lp-controls cdc-yearnav">
            <button onClick={() => setJahr((j) => j - 1)}>◀</button>
            <span className="cdc-year">{jahr}</span>
            <button onClick={() => setJahr((j) => j + 1)} disabled={jahr >= new Date().getFullYear()}>▶</button>
          </div>
          <p className="hint" style={{ margin: "4px 0 6px" }}>
            Gesamtverbrauch dieses Geräts je Monat des Jahres (kWh).
          </p>
          {rangeLoading && !range && <p className="hint">Lade Jahresübersicht…</p>}
          {range && (
            <>
              <p className="cdc-summe">Jahresverbrauch: <strong>{nf(range.summe, 2)} kWh</strong>
                {range.bidirectional && range.feedinSumme != null && (
                  <> · Einspeisung: <strong>{nf(range.feedinSumme, 2)} kWh</strong></>
                )}
              </p>
              <RangeBars
                buckets={range.buckets}
                color={color}
                unit="kWh"
                xTitle="Monat"
                feedinColor={range.bidirectional ? feedinColor : undefined}
                onBarClick={(bucket) => { setYm(bucket); setGran("monat"); }}
              />
              {range.summe <= 0 && <p className="hint">Für dieses Jahr liegen keine Verbrauchsdaten vor.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

// Einfaches Balkendiagramm für die Monats-/Jahresansicht (kWh je Tag bzw. Monat).
function RangeBars({ buckets, color, unit, xTitle, onBarClick, feedinColor }: {
  buckets: Array<{ bucket: string; label: string; kwh: number; feedin?: number }>;
  color: string; unit: string; xTitle: string;
  onBarClick?: (bucket: string) => void;
  feedinColor?: string; // gesetzt = bidirektional (Bezug oben, Einspeisung unten)
}) {
  const bidir = !!feedinColor;
  const W = 760, H = bidir ? 280 : 240, padL = 60, padR = 12, padT = 14, padB = 48;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxUp = Math.max(0.0001, ...buckets.map((b) => b.kwh));
  const maxDown = bidir ? Math.max(0.0001, ...buckets.map((b) => b.feedin ?? 0)) : 0;
  const nice = (m: number) => { const pw = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / pw) * pw || 1; };
  const dispUp = nice(maxUp);
  const dispDown = bidir ? nice(maxDown) : 0;
  // Nulllinie: bei bidir mittig gewichtet nach Verhältnis, sonst unten.
  const upFrac = bidir ? dispUp / (dispUp + dispDown) : 1;
  const zeroY = padT + plotH * upFrac;
  const yUp = (v: number) => zeroY - (v / dispUp) * (plotH * upFrac);
  const yDown = (v: number) => zeroY + (v / (dispDown || 1)) * (plotH * (1 - upFrac));
  const n = buckets.length || 1;
  const slotW = plotW / n;
  const barW = Math.min(slotW * 0.7, 26);
  const [hover, setHover] = useState<number | null>(null);
  const clickable = !!onBarClick;
  return (
    <div className="cdc-bars-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="cdc-bars" preserveAspectRatio="xMidYMid meet">
        {/* Y-Gitter oben (Bezug) */}
        {[0, 0.5, 1].map((f, i) => {
          const v = dispUp * f;
          return (
            <g key={`u${i}`}>
              <line x1={padL} y1={yUp(v)} x2={W - padR} y2={yUp(v)} stroke="#eee" />
              <text x={padL - 6} y={yUp(v) + 4} textAnchor="end" className="tv-axis">{nf(v, v >= 10 ? 0 : 1)}</text>
            </g>
          );
        })}
        {/* Nulllinie */}
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#ccc" />
        {/* Y-Gitter unten (Einspeisung) */}
        {bidir && [0.5, 1].map((f, i) => {
          const v = dispDown * f;
          return (
            <g key={`d${i}`}>
              <line x1={padL} y1={yDown(v)} x2={W - padR} y2={yDown(v)} stroke="#f2f2f2" />
              <text x={padL - 6} y={yDown(v) + 4} textAnchor="end" className="tv-axis">{nf(v, v >= 10 ? 0 : 1)}</text>
            </g>
          );
        })}
        {buckets.map((b, i) => {
          const xC = padL + slotW * i + slotW / 2;
          const x = padL + slotW * i + (slotW - barW) / 2;
          const hUp = b.kwh > 0 ? Math.max(1, zeroY - yUp(b.kwh)) : 0;
          const hDown = bidir && (b.feedin ?? 0) > 0 ? Math.max(1, yDown(b.feedin ?? 0) - zeroY) : 0;
          const showLabel = buckets.length <= 12 || i % Math.ceil(buckets.length / 15) === 0;
          return (
            <g
              key={b.bucket}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={clickable ? () => onBarClick!(b.bucket) : undefined}
              style={clickable ? { cursor: "pointer" } : undefined}
            >
              {clickable && <rect x={padL + slotW * i} y={padT} width={slotW} height={plotH} fill="transparent" />}
              {hUp > 0 && <rect x={x} y={yUp(b.kwh)} width={barW} height={hUp} fill={color} rx={2} opacity={hover === i ? 1 : 0.85} />}
              {hDown > 0 && <rect x={x} y={zeroY} width={barW} height={hDown} fill={feedinColor} rx={2} opacity={hover === i ? 1 : 0.85} />}
              {showLabel && <text x={xC} y={H - padB + 14} textAnchor="middle" className="tv-axis">{b.label}</text>}
              {hover === i && (
                <text x={xC} y={yUp(b.kwh) - 4} textAnchor="middle" className="tv-axis" fill="#333">
                  {nf(b.kwh, 2)}{bidir ? ` / ${nf(b.feedin ?? 0, 2)}` : ""} {unit}
                </text>
              )}
            </g>
          );
        })}
        {/* Achsentitel */}
        <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" className="tv-axis-title">{xTitle}</text>
        <text x={16} y={padT + plotH / 2} textAnchor="middle" className="tv-axis-title"
          transform={`rotate(-90 16 ${padT + plotH / 2})`}>{bidir ? `Bezug / Einsp. (${unit})` : `Verbrauch (${unit})`}</text>
        {bidir && (
          <>
            <text x={padL + 2} y={padT + 10} className="tv-dir" fill={color}>▲ Bezug/Laden</text>
            <text x={padL + 2} y={H - padB - 2} className="tv-dir" fill={feedinColor}>▼ Einspeisung</text>
          </>
        )}
      </svg>
      {clickable && <p className="hint cdc-drill-hint">Auf einen Balken klicken, um in die Detailansicht zu wechseln.</p>}
    </div>
  );
}
