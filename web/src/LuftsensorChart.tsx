// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useState, useCallback } from "react";
import { ChartDownloadButton } from "./ChartDownloadButton";

type RangeKey = "today" | "24h" | "2d" | "4d" | "1w";
const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Heute", "24h": "1 Tag", "2d": "2 Tage", "4d": "4 Tage", "1w": "1 Woche",
};
const RANGE_MS: Record<Exclude<RangeKey, "today">, number> = {
  "24h": 24 * 3600 * 1000, "2d": 2 * 24 * 3600 * 1000, "4d": 4 * 24 * 3600 * 1000, "1w": 7 * 24 * 3600 * 1000,
};

// Die vier Messreihen des Luftsensors: Label (muss dem persistierten Datenpunkt-
// Label entsprechen), Anzeigename, Farbe, Einheit, eigene Y-Achse.
const REIHEN = [
  { key: "PM2.5", label: "Feinstaub PM2.5", color: "#d9534f", unit: "µg/m³", achse: "links" },
  { key: "PM10", label: "Feinstaub PM10", color: "#e8923a", unit: "µg/m³", achse: "links" },
  { key: "Temperatur", label: "Außentemperatur", color: "#4a78c2", unit: "°C", achse: "rechts" },
  { key: "Luftdruck", label: "Luftdruck", color: "#5aa469", unit: "hPa", achse: "druck" },
] as const;

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function computeWindow(range: RangeKey, offset: number): { von: Date; bis: Date } {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + offset);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return { von: start, bis: end };
  }
  const span = RANGE_MS[range];
  const bis = new Date(now.getTime() + offset * span);
  const von = new Date(bis.getTime() - span);
  return { von, bis };
}

interface Punkt { ts: string; [k: string]: number | string; }

export function LuftsensorChart() {
  const [range, setRange] = useState<RangeKey>("today");
  const [offset, setOffset] = useState(0);
  const [punkte, setPunkte] = useState<Punkt[]>([]);
  const [label, setLabel] = useState<string>("");
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(REIHEN.map((r) => [r.key, true]))
  );
  const [hover, setHover] = useState<{ x: number; t: string; items: Array<{ label: string; v: number; color: string; unit: string }> } | null>(null);

  const { von, bis } = useMemo(() => computeWindow(range, offset), [range, offset]);

  useEffect(() => {
    setLoading(true);
    const qs = `von=${encodeURIComponent(fmtLocal(von))}&bis=${encodeURIComponent(fmtLocal(bis))}`;
    fetch(`/api/air/verlauf?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) { setConfigured(false); setPunkte([]); }
        else { setConfigured(true); setPunkte(j.punkte ?? []); setLabel(j.label ?? ""); }
      })
      .catch(() => setPunkte([]))
      .finally(() => setLoading(false));
  }, [von, bis]);

  const rangeText = useMemo(() => {
    const optDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
    const optTime: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
    if (range === "today") return von.toLocaleDateString("de-DE", { weekday: "short", ...optDate });
    const sameDay = von.toDateString() === new Date(bis.getTime() - 1).toDateString();
    if (sameDay) return `${von.toLocaleDateString("de-DE", optDate)} ${von.toLocaleTimeString("de-DE", optTime)}–${bis.toLocaleTimeString("de-DE", optTime)}`;
    return `${von.toLocaleDateString("de-DE", optDate)} – ${bis.toLocaleDateString("de-DE", optDate)}`;
  }, [range, von, bis]);

  // --- SVG-Geometrie ---
  const W = 900, H = 320, padL = 46, padR = 90, padT = 16, padB = 30;
  const vonMs = von.getTime(), bisMs = bis.getTime();
  const xOf = (ms: number) => padL + ((ms - vonMs) / (bisMs - vonMs)) * (W - padL - padR);

  // Wertebereiche je Achse.
  const bereiche = useMemo(() => {
    const calc = (keys: string[]) => {
      let min = Infinity, max = -Infinity;
      for (const p of punkte) for (const k of keys) {
        const v = p[k]; if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v; }
      }
      if (!Number.isFinite(min)) return null;
      if (min === max) { min -= 1; max += 1; }
      const pad = (max - min) * 0.08; return { min: min - pad, max: max + pad };
    };
    return {
      links: calc(REIHEN.filter((r) => r.achse === "links" && visible[r.key]).map((r) => r.key)),
      rechts: calc(REIHEN.filter((r) => r.achse === "rechts" && visible[r.key]).map((r) => r.key)),
      druck: calc(REIHEN.filter((r) => r.achse === "druck" && visible[r.key]).map((r) => r.key)),
    };
  }, [punkte, visible]);

  const yOf = (v: number, achse: "links" | "rechts" | "druck") => {
    const b = bereiche[achse]; if (!b) return H - padB;
    return padT + (1 - (v - b.min) / (b.max - b.min)) * (H - padT - padB);
  };

  const pfad = (key: string, achse: "links" | "rechts" | "druck") => {
    let d = ""; let auf = false;
    for (const p of punkte) {
      const v = p[key];
      if (typeof v !== "number") { auf = false; continue; }
      const x = xOf(new Date(p.ts).getTime()); const y = yOf(v, achse);
      d += `${auf ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; auf = true;
    }
    return d;
  };

  // X-Achsen-Beschriftung (Stunden bzw. Tage).
  const xTicks = useMemo(() => {
    const ticks: Array<{ x: number; label: string }> = [];
    const spanH = (bisMs - vonMs) / 3600000;
    const schritt = spanH <= 24 ? 3 : spanH <= 48 ? 6 : 24; // Stunden
    for (let t = vonMs; t <= bisMs; t += schritt * 3600000) {
      const d = new Date(t);
      ticks.push({ x: xOf(t), label: spanH <= 48 ? `${String(d.getHours()).padStart(2, "0")}:00` : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) });
    }
    return ticks;
  }, [vonMs, bisMs]);

  const onMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < padL || px > W - padR || punkte.length === 0) { setHover(null); return; }
    const ms = vonMs + ((px - padL) / (W - padL - padR)) * (bisMs - vonMs);
    // nächsten Punkt finden
    let best: Punkt | null = null, bestD = Infinity;
    for (const p of punkte) { const d = Math.abs(new Date(p.ts).getTime() - ms); if (d < bestD) { bestD = d; best = p; } }
    if (!best) { setHover(null); return; }
    const items = REIHEN.filter((r) => visible[r.key] && typeof best![r.key] === "number")
      .map((r) => ({ label: r.label, v: best![r.key] as number, color: r.color, unit: r.unit }));
    setHover({ x: xOf(new Date(best.ts).getTime()), t: new Date(best.ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), items });
  }, [punkte, vonMs, bisMs, visible]);

  if (!configured) {
    return (
      <div className="card">
        <h3>Luftmesswerte – Tagesverlauf</h3>
        <p className="hint">Kein Luftsensor konfiguriert oder noch keine aufgezeichneten Daten. Lege eine Luftsensor-Quelle an und aktiviere in deren Konfiguration die aufzuzeichnenden Datenpunkte.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chart-kopf">
        <h3>Luftmesswerte – Tagesverlauf{label ? ` (${label})` : ""}</h3>
        <ChartDownloadButton dateiname="luftmesswerte" />
      </div>
      <div className="ww-controls">
        <div className="ww-range-btns">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button key={k} className={`ww-range-btn${range === k ? " active" : ""}`} onClick={() => { setRange(k); setOffset(0); }}>{RANGE_LABELS[k]}</button>
          ))}
        </div>
        <div className="ww-nav">
          <button className="ww-nav-btn" onClick={() => setOffset((o) => o - 1)} title="Zurück">◀</button>
          <span className="ww-nav-label">{rangeText}</span>
          <button className="ww-nav-btn" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} title="Vor">▶</button>
        </div>
      </div>

      <div className="ww-legend">
        {REIHEN.map((r) => (
          <button key={r.key} className={`ww-legend-item${visible[r.key] ? "" : " off"}`}
            onClick={() => setVisible((v) => ({ ...v, [r.key]: !v[r.key] }))}>
            <span className="ww-legend-dot" style={{ background: r.color }} />
            {r.label}
          </button>
        ))}
      </div>

      {loading && <p className="hint">lädt …</p>}
      {!loading && punkte.length === 0 && <p className="hint">Keine Daten im gewählten Zeitraum.</p>}

      {punkte.length > 0 && (
        <div className="ww-chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="ww-chart-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} preserveAspectRatio="xMidYMid meet">
            {/* Achsengitter Y (linke Achse) */}
            {bereiche.links && [0, 0.25, 0.5, 0.75, 1].map((f) => {
              const v = bereiche.links!.min + f * (bereiche.links!.max - bereiche.links!.min);
              const y = yOf(v, "links");
              return <g key={f}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f5" /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#889">{v.toFixed(0)}</text></g>;
            })}
            {/* rechte Achse (Temperatur) */}
            {bereiche.rechts && [0, 0.5, 1].map((f) => {
              const v = bereiche.rechts!.min + f * (bereiche.rechts!.max - bereiche.rechts!.min);
              const y = yOf(v, "rechts");
              return <text key={f} x={W - padR + 6} y={y + 3} fontSize="10" fill="#4a78c2">{v.toFixed(0)}°</text>;
            })}
            {/* X-Ticks */}
            {xTicks.map((t, i) => <g key={i}><line x1={t.x} y1={padT} x2={t.x} y2={H - padB} stroke="#f6f8fa" /><text x={t.x} y={H - padB + 14} textAnchor="middle" fontSize="10" fill="#889">{t.label}</text></g>)}
            {/* Linien */}
            {REIHEN.filter((r) => visible[r.key]).map((r) => (
              <path key={r.key} d={pfad(r.key, r.achse as any)} fill="none" stroke={r.color} strokeWidth="1.6" />
            ))}
            {/* Hover */}
            {hover && <line x1={hover.x} y1={padT} x2={hover.x} y2={H - padB} stroke="#bbb" strokeDasharray="3 3" />}
          </svg>
          {hover && (
            <div className="ww-tooltip">
              <div className="ww-tooltip-t">{hover.t}</div>
              {hover.items.map((it, i) => (
                <div key={i} className="ww-tooltip-row"><span className="ww-legend-dot" style={{ background: it.color }} />{it.label}: <b>{it.v.toFixed(1)} {it.unit}</b></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
