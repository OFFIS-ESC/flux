// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useState, useCallback } from "react";
import { nf } from "./chartUtils";
import { ChartDownloadButton } from "./ChartDownloadButton";
import { evalTempFormel } from "./tempFormel";

// Warmwasserspeicher-Temperaturverlauf mit einstellbarem Zeitraum
// (heute, 24 h, 2/4 Tage, 1 Woche), Vor-/Zurück-Navigation und
// ein-/ausblendbaren Serien (oben/unten). Auflösung = wie gespeichert
// (Abfrageintervall der Quelle).

type RangeKey = "today" | "24h" | "2d" | "4d" | "1w";

interface Point { t: string; v: number }
interface Serie { key: string; label: string; unit: string; points: Point[] }
interface AktivIntervall { von: string; bis: string }
interface Aktivitaet { wp: AktivIntervall[]; heizstab: AktivIntervall[]; solar: AktivIntervall[] }

// Erzeuger für die Aktivitäts-Overlays: Key, Anzeigename, Overlay-Farbe.
type ErzKey = "wp" | "heizstab" | "solar";
const ERZEUGER: Array<{ key: ErzKey; label: string; color: string }> = [
  { key: "wp", label: "Wärmepumpe", color: "#d9534f" },
  { key: "heizstab", label: "Heizstab", color: "#8e6fc0" },
  { key: "solar", label: "Solarthermie", color: "#f0ad4e" },
];

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Heute",
  "24h": "1 Tag",
  "2d": "2 Tage",
  "4d": "4 Tage",
  "1w": "1 Woche",
};
const RANGE_MS: Record<Exclude<RangeKey, "today">, number> = {
  "24h": 24 * 3600 * 1000,
  "2d": 2 * 24 * 3600 * 1000,
  "4d": 4 * 24 * 3600 * 1000,
  "1w": 7 * 24 * 3600 * 1000,
};

const COLORS: Record<string, string> = { tankUp: "#d9534f", tankDown: "#4a78c2" };

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Liefert [von, bis] als Date-Objekte für den gewählten Bereich + Offset (in
// Bereichs-Schritten vor/zurück).
function computeWindow(range: RangeKey, offset: number): { von: Date; bis: Date } {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + offset);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return { von: start, bis: end };
  }
  const span = RANGE_MS[range];
  const bis = new Date(now.getTime() + offset * span);
  const von = new Date(bis.getTime() - span);
  return { von, bis };
}

export function WarmwasserChart() {
  const [range, setRange] = useState<RangeKey>("today");
  const [offset, setOffset] = useState(0);
  const [series, setSeries] = useState<Serie[]>([]);
  const [aktivitaet, setAktivitaet] = useState<Aktivitaet | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({ tankUp: true, tankDown: true });
  // Sichtbarkeit der Erzeuger-Overlays (an/aus über die Legende).
  const [erzVisible, setErzVisible] = useState<Record<ErzKey, boolean>>({ wp: true, heizstab: true, solar: true });
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  // Formel für die gespeicherte thermische Energie (für die Tooltip-Anzeige).
  const [waermeFormel, setWaermeFormel] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/warmwasser/waermeformel")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.formel) setWaermeFormel(d.formel); })
      .catch(() => {});
  }, []);

  const { von, bis } = useMemo(() => computeWindow(range, offset), [range, offset]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = `von=${encodeURIComponent(fmtLocal(von))}&bis=${encodeURIComponent(fmtLocal(bis))}`;
    fetch(`/api/warmwasser/verlauf?${qs}`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series ?? []); setConfigured(d.configured !== false); setAktivitaet(d.aktivitaet ?? null); })
      .catch(() => { setSeries([]); setAktivitaet(null); })
      .finally(() => setLoading(false));
  }, [von, bis]);

  useEffect(() => { load(); }, [load]);

  const rangeLabelText = useMemo(() => {
    const optDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" };
    const optTime: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
    if (range === "today") return von.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
    const sameDay = von.toDateString() === new Date(bis.getTime() - 1).toDateString();
    if (sameDay) return `${von.toLocaleDateString("de-DE", optDate)} ${von.toLocaleTimeString("de-DE", optTime)}–${bis.toLocaleTimeString("de-DE", optTime)}`;
    return `${von.toLocaleDateString("de-DE", optDate)} ${von.toLocaleTimeString("de-DE", optTime)} – ${bis.toLocaleDateString("de-DE", optDate)} ${bis.toLocaleTimeString("de-DE", optTime)}`;
  }, [range, von, bis]);

  return (
    <section className="card">
      <div className="chart-kopf">
        <h3>Warmwasserspeicher – Temperaturverlauf</h3>
        {configured && <ChartDownloadButton dateiname="warmwasser-verlauf" />}
      </div>
      {!configured && (
        <p className="hint">
          Keine aktive Warmwasserspeicher-Quelle. Sobald eine Quelle mit der Rolle
          „Warmwasserspeicher" aktiv ist, werden die Temperaturen aufgezeichnet.
        </p>
      )}

      <div className="ww-controls">
        <div className="ww-range-btns">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button
              key={k}
              className={`ww-range-btn${range === k ? " active" : ""}`}
              onClick={() => { setRange(k); setOffset(0); }}
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="ww-nav">
          <button className="ww-nav-btn" onClick={() => setOffset((o) => o - 1)} title="Zurück">←</button>
          <span className="ww-nav-label">{rangeLabelText}</span>
          <button className="ww-nav-btn" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} title="Vor">→</button>
        </div>
      </div>

      <div className="ww-legend">
        {series.map((s) => (
          <button
            key={s.key}
            className={`ww-legend-item${visible[s.key] ? "" : " off"}`}
            onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
          >
            <span className="ww-legend-dot" style={{ background: COLORS[s.key] ?? "#888" }} />
            {s.label}
          </button>
        ))}
        {/* Trenner + Erzeuger-Overlays (farbige Aktivitätsbereiche) */}
        <span className="ww-legend-sep" />
        {ERZEUGER.map((e) => (
          <button
            key={e.key}
            className={`ww-legend-item${erzVisible[e.key] ? "" : " off"}`}
            onClick={() => setErzVisible((v) => ({ ...v, [e.key]: !v[e.key] }))}
            title="Farbige Markierung der Aktivzeiten dieses Erzeugers ein-/ausblenden"
          >
            <span className="ww-legend-dot" style={{ background: e.color, opacity: 0.5 }} />
            {e.label}
          </button>
        ))}
      </div>

      <WwSvg
        series={series.filter((s) => visible[s.key])}
        allSeries={series}
        aktivitaet={aktivitaet}
        erzVisible={erzVisible}
        waermeFormel={waermeFormel}
        loading={loading}
      />
    </section>
  );
}

function WwSvg({ series, allSeries, aktivitaet, erzVisible, waermeFormel, loading }: {
  series: Serie[];
  allSeries: Serie[];
  aktivitaet: Aktivitaet | null;
  erzVisible: Record<ErzKey, boolean>;
  waermeFormel: string | null;
  loading: boolean;
}) {
  const W = 820, H = 320, padL = 48, padR = 16, padT = 14, padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const all = series.flatMap((s) => s.points);
  const [hover, setHover] = useState<{ x: number; items: Array<{ label: string; v: number; color: string }>; t: string; energie: number | null } | null>(null);

  if (all.length === 0) {
    return (
      <div className="ww-chart-empty">
        {loading ? "Lade Verlauf…" : "Keine Daten im gewählten Zeitraum."}
      </div>
    );
  }

  const times = all.map((p) => new Date(p.t.replace(" ", "T")).getTime());
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const tSpan = Math.max(1, tMax - tMin);
  const vMinRaw = Math.min(...all.map((p) => p.v));
  const vMaxRaw = Math.max(...all.map((p) => p.v));
  const pad = Math.max(1, (vMaxRaw - vMinRaw) * 0.1);
  const vMin = Math.floor(vMinRaw - pad);
  const vMax = Math.ceil(vMaxRaw + pad);
  const vSpan = Math.max(1, vMax - vMin);

  const xOf = (t: string) => padL + ((new Date(t.replace(" ", "T")).getTime() - tMin) / tSpan) * plotW;
  const yOf = (v: number) => padT + (1 - (v - vMin) / vSpan) * plotH;

  // Y-Gridlinien
  const yTicks: number[] = [];
  const step = niceStep(vSpan / 5);
  for (let v = Math.ceil(vMin / step) * step; v <= vMax; v += step) yTicks.push(v);

  // X-Gridlinien auf RUNDEN Stundengrenzen (klares Raster).
  const xTicks: Array<{ x: number; label: string }> = [];
  const spanH = tSpan / 3600000;
  const schrittH = spanH <= 8 ? 1 : spanH <= 26 ? 2 : spanH <= 50 ? 6 : 24;
  const xForTime = (t: number) => padL + plotW * ((t - tMin) / (tMax - tMin));
  const startD = new Date(tMin);
  startD.setMinutes(0, 0, 0);
  if (startD.getTime() < tMin) startD.setHours(startD.getHours() + 1);
  while (startD.getHours() % schrittH !== 0) startD.setHours(startD.getHours() + 1);
  for (let t = startD.getTime(); t <= tMax; t += schrittH * 3600000) {
    const d = new Date(t);
    const label = schrittH < 24
      ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    xTicks.push({ x: xForTime(t), label });
  }

  const pathOf = (s: Serie) => {
    const pts = [...s.points].sort((a, b) => new Date(a.t.replace(" ", "T")).getTime() - new Date(b.t.replace(" ", "T")).getTime());
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < padL || px > W - padR) { setHover(null); return; }
    const tt = tMin + ((px - padL) / plotW) * tSpan;
    // nächsten Punkt je (sichtbarer) Serie finden – für die Anzeige der Kurven
    const items = series.map((s) => {
      let best: Point | null = null, bestD = Infinity;
      for (const p of s.points) {
        const d = Math.abs(new Date(p.t.replace(" ", "T")).getTime() - tt);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best ? { label: s.label, v: best.v, color: COLORS[s.key] ?? "#888" } : null;
    }).filter(Boolean) as Array<{ label: string; v: number; color: string }>;

    // Gespeicherte thermische Energie aus den nächstgelegenen Temperaturen
    // (immer aus allen Serien, damit die Energie auch dann stimmt, wenn eine
    // Temperaturkurve ausgeblendet ist). T_o = obere, T_u = untere Temperatur.
    const nearestOf = (key: string): number | null => {
      const s = allSeries.find((x) => x.key === key);
      if (!s) return null;
      let best: Point | null = null, bestD = Infinity;
      for (const p of s.points) {
        const d = Math.abs(new Date(p.t.replace(" ", "T")).getTime() - tt);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best ? best.v : null;
    };
    let energie: number | null = null;
    if (waermeFormel) {
      const T_o = nearestOf("tankUp");
      const T_u = nearestOf("tankDown");
      if (T_o != null && T_u != null) energie = evalTempFormel(waermeFormel, { T_u, T_o });
    }

    const d = new Date(tt);
    setHover({ x: px, items, energie, t: d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) });
  };

  return (
    <div className="ww-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ww-chart-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* Aktivitätsbereiche der Erzeuger (transparent, über volle Höhe) –
            im Hintergrund, damit Gitter und Kurven darüber liegen. */}
        {aktivitaet && ERZEUGER.filter((e) => erzVisible[e.key]).map((e) =>
          (aktivitaet[e.key] ?? []).map((iv, i) => {
            const t0 = new Date(iv.von.replace(" ", "T")).getTime();
            const t1 = new Date(iv.bis.replace(" ", "T")).getTime();
            // auf den sichtbaren Zeitbereich clippen
            const c0 = Math.max(t0, tMin), c1 = Math.min(t1, tMax);
            if (c1 <= c0) return null;
            const x0 = padL + ((c0 - tMin) / tSpan) * plotW;
            const x1 = padL + ((c1 - tMin) / tSpan) * plotW;
            return (
              <rect
                key={`${e.key}-${i}`}
                x={x0} y={padT} width={Math.max(0.5, x1 - x0)} height={plotH}
                fill={e.color} opacity={0.14}
              />
            );
          })
        )}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke="#eee" />
            <text x={padL - 6} y={yOf(v) + 4} textAnchor="end" fontSize="11" fill="#888">{v}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#888">{t.label}</text>
        ))}
        <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize="11" fill="#888" transform={`rotate(-90 12 ${padT + plotH / 2})`}>°C</text>
        {series.map((s) => (
          <path key={s.key} d={pathOf(s)} fill="none" stroke={COLORS[s.key] ?? "#888"} strokeWidth={1.8} />
        ))}
        {hover && <line x1={hover.x} y1={padT} x2={hover.x} y2={padT + plotH} stroke="#bbb" strokeDasharray="3 3" />}
      </svg>
      {hover && hover.items.length > 0 && (
        <div className="ww-tooltip" style={{ left: `${(hover.x / W) * 100}%` }}>
          <div className="ww-tooltip-time">{hover.t}</div>
          {hover.items.map((it, i) => (
            <div key={i} className="ww-tooltip-row">
              <span className="ww-legend-dot" style={{ background: it.color }} />
              {it.label}: <strong>{nf(it.v, 1)} °C</strong>
            </div>
          ))}
          {hover.energie != null && (
            <div className="ww-tooltip-row ww-tooltip-energie">
              Gespeicherte Energie: <strong>{nf(hover.energie, 1)} kWh</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}
