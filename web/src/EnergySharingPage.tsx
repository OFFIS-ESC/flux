// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { SharingAnalysisBlock } from "./SharingAnalysisBlock";
import { Sharing42cConfig } from "./Sharing42cConfig";
import { DateNav } from "./DateNav";
import type { FullState, Abnehmer } from "./types";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale, convertEnergie, einheitLabel, fmtTick, type EnergieEinheit, nf } from "./chartUtils";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Slot = {
  ts: string;
  einspeisung: number;
  einspeisungPv: number;
  haushalte: Record<
    string,
    { bezug: number; geteilt: number; geteiltPv: number; geteiltBatt: number; dritt: number }
  >;
};
type Quelle = {
  id: string;
  label: string;
  enabled: boolean;
  role: "grid42c" | "grid42cEmu";
};
type SharingData = {
  date: string;
  mode: "dynamisch" | "statisch";
  abnehmer: Abnehmer[];
  quellen: Quelle[];
  slots: Slot[];
};

// Dreifarbiges Tages-Bar-Chart für einen Abnehmer: je Viertelstunde der Bezug,
// von unten: mein PV-Anteil (grün), mein Speicher-Anteil (eigene Farbe), oben
// der Reststromlieferant (grau).
function SharingBarChart({
  slots,
  id,
  colorPv,
  colorBatt,
  colorDritt,
}: {
  slots: Slot[];
  id: string;
  colorPv: string;
  colorBatt: string;
  colorDritt: string;
}) {
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const W = 760, H = 240, padL = 48, padR = 12, padT = 14, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const bars = Array.from({ length: 96 }, () => ({ pv: 0, batt: 0, dritt: 0 }));
  for (const s of slots) {
    const t = s.ts.slice(11);
    const [h, m] = t.split(":").map(Number);
    const endMin = h * 60 + m;
    let idx = Math.round(endMin / 15) - 1;
    if (idx < 0) idx = 95;
    const hv = s.haushalte[id];
    if (hv) {
      bars[idx].pv = hv.geteiltPv;
      bars[idx].batt = hv.geteiltBatt;
      bars[idx].dritt = hv.dritt;
    }
  }

  const legende = [
    { key: "pv", label: "aus PV (§42c)", color: colorPv },
    { key: "batt", label: "aus Speicher (§42c)", color: colorBatt },
    { key: "dritt", label: "Reststrom", color: colorDritt },
  ];
  const isHidden = (k: string) => hidden.has(k);
  const toggle = (k: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const val = (b: { pv: number; batt: number; dritt: number }, k: "pv" | "batt" | "dritt") =>
    isHidden(k) ? 0 : b[k];

  const maxKwh = Math.max(0.0001, ...bars.map((b) => val(b, "pv") + val(b, "batt") + val(b, "dritt")));
  const scale = niceScale(convertEnergie(maxKwh, einheit));
  const dispMax = scale.max;
  const barW = plotW / 96;
  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const yOf = (vDisp: number) => padT + (1 - vDisp / dispMax) * plotH;
  const baseY = padT + plotH;
  const hourLabels = [0, 6, 12, 18, 24];

  return (
    <div className="chart-wrap">
    <div className="chart-toolbar">
      <div className="chart-legend">
        {legende.map((l) => (
          <button key={l.key} type="button" className={`chart-legend-item${isHidden(l.key) ? " off" : ""}`} onClick={() => toggle(l.key)}>
            <span className="chart-legend-dot" style={{ background: l.color }} />
            {l.label}
          </button>
        ))}
      </div>
      <div className="chart-unit-switch">
        <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
        <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
      </div>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} className="es-svg" preserveAspectRatio="xMidYMid meet">
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
          <text x={padL - 6} y={yOf(t) + 4} className="es-axis" textAnchor="end">
            {fmtTick(t, einheit)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = padL + i * barW;
        const pv = cv(val(b, "pv")), batt = cv(val(b, "batt")), dritt = cv(val(b, "dritt"));
        const total = pv + batt + dritt;
        if (total <= 0) return null;
        // Stapel von unten: PV -> Speicher -> Dritt
        const yPvTop = yOf(pv);
        const yBattTop = yOf(pv + batt);
        const yDrittTop = yOf(total);
        const w = Math.max(barW - 1, 0.5);
        return (
          <g key={i}>
            {dritt > 0 && (
              <rect x={x + 0.5} y={yDrittTop} width={w} height={Math.max(yBattTop - yDrittTop, 0.3)} fill={colorDritt} />
            )}
            {batt > 0 && (
              <rect x={x + 0.5} y={yBattTop} width={w} height={Math.max(yPvTop - yBattTop, 0.3)} fill={colorBatt} />
            )}
            {pv > 0 && (
              <rect x={x + 0.5} y={yPvTop} width={w} height={Math.max(baseY - yPvTop, 0.3)} fill={colorPv} />
            )}
          </g>
        );
      })}
      {hourLabels.map((h) => (
        <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="es-axis" textAnchor="middle">
          {String(h).padStart(2, "0")}
        </text>
      ))}
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
        {einheitLabel(einheit)}
      </text>
    </svg>
    <ChartHoverLayer
      svgW={W}
      plotL={padL}
      plotW={plotW}
      rowsForSlot={(i) => {
        const u = einheitLabel(einheit);
        const dec = einheit === "w" ? 0 : 3;
        const rows: { label: string; value: string; color?: string }[] = [];
        if (!isHidden("pv")) rows.push({ label: "von mir · PV", value: `${nf(cv(bars[i].pv), dec)} ${u}`, color: colorPv });
        if (!isHidden("batt")) rows.push({ label: "von mir · Speicher", value: `${nf(cv(bars[i].batt), dec)} ${u}`, color: colorBatt });
        if (!isHidden("dritt")) rows.push({ label: "Reststromlieferant", value: `${nf(cv(bars[i].dritt), dec)} ${u}`, color: colorDritt });
        const totalKwh = val(bars[i], "pv") + val(bars[i], "batt") + val(bars[i], "dritt");
        rows.push({ label: "Bezug gesamt", value: `${nf(cv(totalKwh), dec)} ${u}` });
        return rows;
      }}
    />
    </div>
  );
}


// Gestapeltes Zweifarb-Bar-Chart: je Slot ein unterer (lower) und ein oberer
// (upper) Wert, übereinandergestapelt. Für die Überschuss-Zerlegung.
function StackedTwoBarChart({
  lower,
  upper,
  colorLower,
  colorUpper,
  labelLower,
  labelUpper,
}: {
  lower: number[];
  upper: number[];
  colorLower: string;
  colorUpper: string;
  labelLower: string;
  labelUpper: string;
}) {
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const W = 760, H = 240, padL = 48, padR = 12, padT = 14, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const hideL = hidden.has("lower"), hideU = hidden.has("upper");
  const totals = lower.map((v, i) => (hideL ? 0 : v) + (hideU ? 0 : (upper[i] ?? 0)));
  const maxKwh = Math.max(0.0001, ...totals);
  const scale = niceScale(convertEnergie(maxKwh, einheit));
  const dispMax = scale.max;
  const barW = plotW / 96;
  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const yOf = (vDisp: number) => padT + (1 - vDisp / dispMax) * plotH;
  const baseY = padT + plotH;
  const hourLabels = [0, 6, 12, 18, 24];
  const toggle = (k: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const legende = [
    { key: "lower", label: labelLower, color: colorLower },
    { key: "upper", label: labelUpper, color: colorUpper },
  ];
  return (
    <div className="chart-wrap">
    <div className="chart-toolbar">
      <div className="chart-legend">
        {legende.map((l) => (
          <button key={l.key} type="button" className={`chart-legend-item${hidden.has(l.key) ? " off" : ""}`} onClick={() => toggle(l.key)}>
            <span className="chart-legend-dot" style={{ background: l.color }} />
            {l.label}
          </button>
        ))}
      </div>
      <div className="chart-unit-switch">
        <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
        <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
      </div>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} className="es-svg" preserveAspectRatio="xMidYMid meet">
      {scale.ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
          <text x={padL - 6} y={yOf(t) + 4} className="es-axis" textAnchor="end">
            {fmtTick(t, einheit)}
          </text>
        </g>
      ))}
      {lower.map((loRaw, i) => {
        const lo = hideL ? 0 : cv(loRaw);
        const up = hideU ? 0 : cv(upper[i] ?? 0);
        const total = lo + up;
        if (total <= 0) return null;
        const x = padL + i * barW;
        const yLower = yOf(lo);
        const yTop = yOf(total);
        return (
          <g key={i}>
            {lo > 0 && (
              <rect x={x + 0.5} y={yLower} width={Math.max(barW - 1, 0.5)} height={Math.max(baseY - yLower, 0.3)} fill={colorLower} />
            )}
            {up > 0 && (
              <rect x={x + 0.5} y={yTop} width={Math.max(barW - 1, 0.5)} height={Math.max(yLower - yTop, 0.3)} fill={colorUpper} />
            )}
          </g>
        );
      })}
      {hourLabels.map((h) => (
        <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="es-axis" textAnchor="middle">
          {String(h).padStart(2, "0")}
        </text>
      ))}
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
        {einheitLabel(einheit)}
      </text>
    </svg>
    <ChartHoverLayer
      svgW={W}
      plotL={padL}
      plotW={plotW}
      rowsForSlot={(i) => {
        const u = einheitLabel(einheit);
        const dec = einheit === "w" ? 0 : 3;
        const rows: { label: string; value: string; color?: string }[] = [];
        if (!hideL) rows.push({ label: labelLower, value: `${nf(cv(lower[i]), dec)} ${u}`, color: colorLower });
        if (!hideU) rows.push({ label: labelUpper, value: `${nf(cv(upper[i] ?? 0), dec)} ${u}`, color: colorUpper });
        const tot = (hideL ? 0 : lower[i]) + (hideU ? 0 : (upper[i] ?? 0));
        rows.push({ label: "Überschuss gesamt", value: `${nf(cv(tot), dec)} ${u}` });
        return rows;
      }}
    />
    </div>
  );
}

export function EnergySharingPage({ state }: { state: FullState }) {
  const [date, setDate] = useState(isoToday());
  const [data, setData] = useState<SharingData | null>(null);
  const [abnehmer, setAbnehmer] = useState<Abnehmer[]>([]);

  function load() {
    fetch(`/api/sharing?date=${date}`)
      .then((r) => r.json())
      .then((d: SharingData) => {
        setData(d);
        setAbnehmer(d.abnehmer);
      })
      .catch(() => setData(null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const quellen = data?.quellen ?? [];

  function summe(
    id: string,
    key: "geteilt" | "geteiltPv" | "geteiltBatt" | "dritt"
  ): number {
    return (data?.slots ?? []).reduce((a, s) => a + (s.haushalte[id]?.[key] ?? 0), 0);
  }
  const aktiveAbnehmer = abnehmer.filter((a) =>
    quellen.some((q) => q.id === a.sourceId && q.enabled)
  );

  // Überschuss-Zerlegung je Viertelstunde (nur PV-erzeugter Überschuss):
  //   genutzt = von Abnehmern (§42c) genutzter Anteil meines PV-Überschusses
  //   rest    = verbleibender, nicht im Sharing genutzter PV-Überschuss
  const genutztValues = Array.from({ length: 96 }, () => 0);
  const restValues = Array.from({ length: 96 }, () => 0);
  for (const s of data?.slots ?? []) {
    const t = s.ts.slice(11);
    const [h, m] = t.split(":").map(Number);
    let idx = Math.round((h * 60 + m) / 15) - 1;
    if (idx < 0) idx = 95;
    // Nur der aus PV stammende, an Abnehmer gelieferte Anteil.
    const geteiltPvSumme = Object.values(s.haushalte).reduce(
      (a, x) => a + x.geteiltPv,
      0
    );
    // genutzt kann nie größer als der PV-Überschuss sein
    const genutzt = Math.min(s.einspeisungPv, geteiltPvSumme);
    genutztValues[idx] = Math.max(0, genutzt);
    restValues[idx] = Math.max(0, s.einspeisungPv - genutzt);
  }
  const restSumme = restValues.reduce((a, v) => a + v, 0);
  const genutztSumme = genutztValues.reduce((a, v) => a + v, 0);

  return (
    <div className="page es-page">
      <div className="page-head">
        <h2>Energy Sharing</h2>
      </div>
      <p className="hint">
        Versorgung von Abnehmern (§42c) mit dem eigenen Überschussstrom.
        Verteilt wird die eigene Netzeinspeisung je Viertelstunde. Abnehmer und
        Verteilungsschlüssel konfigurierst du weiter unten auf dieser Seite.
      </p>

      {/* Verbrauchsverlauf + §42c-Überschuss in einem Block */}
      <section className="card">
        <div className="block-head">
          <h3>Verbrauchsverlauf &amp; Energy-Sharing-Anteil</h3>
          <DateNav value={date} onChange={setDate} label="Tag" />
        </div>
        <div className="block-stack">
          <div className="block-sub">
            <p className="hint">
              Für jeden aktiven Abnehmer zeigt ein Balken je Viertelstunde, woraus
              sein Verbrauch gedeckt wurde: aus deinem geteilten PV-Strom, aus deinem
              Speicher oder – für den nicht gedeckten Rest – vom regulären
              Reststromlieferanten. Grundlage ist der je Viertelstunde von dir zur
              Verfügung gestellte Überschuss und der über den Verteilungsschlüssel
              zugeteilte Anteil je Abnehmer.
            </p>
            {aktiveAbnehmer.length === 0 && <p className="hint">Keine aktiven Abnehmer.</p>}
            {aktiveAbnehmer.map((a) => (
              <div key={a.id} className="es-chartblock">
                <div className="chart-title">
                  {a.name}
                  <span className="chart-sum">
                    PV {nf(summe(a.id, "geteiltPv"), 2)} kWh · Speicher{" "}
                    {nf(summe(a.id, "geteiltBatt"), 2)} kWh · Reststromlieferung{" "}
                    {nf(summe(a.id, "dritt"), 2)} kWh
                  </span>
                </div>
                <SharingBarChart
                  slots={data?.slots ?? []}
                  id={a.id}
                  colorPv={state.settings.vizColorEinspeisungPv}
                  colorBatt={state.settings.vizColorEinspeisungSpeicher}
                  colorDritt={state.settings.vizColorNetzbezug}
                />
              </div>
            ))}
          </div>

          <div className="block-sub">
            <div className="chart-title">
              Nach §42c genutzter sowie verbleibender PV-Überschuss
              <span className="chart-sum">
                genutzt {nf(genutztSumme, 2)} kWh · verbleibend {nf(restSumme, 2)} kWh
              </span>
            </div>
            <p className="hint">
              Eigener PV-Überschuss je Viertelstunde (ohne gezielte Speicher-
              Einspeisung), zerlegt in den von den Abnehmern (§42c) genutzten Anteil
              (unten) und den verbleibenden, nicht im Sharing genutzten PV-Überschuss
              (oben).
            </p>
            <StackedTwoBarChart
              lower={genutztValues}
              upper={restValues}
              colorLower={state.settings.vizColorEinspeisungPv}
              colorUpper={state.settings.vizColorEinspeisungGesamt}
              labelLower="durch Abnehmer genutzt"
              labelUpper="verbleibender Überschuss"
            />
          </div>
        </div>
      </section>

      {/* Wirtschaftlichkeitsanalyse: Energy Sharing vs. klassische Einspeisung */}
      {/* §42c-Konfiguration: Abnehmer + Verteilungsschlüssel (von der
          Stromtarif-Seite hierher verschoben; selbstladend über /api/sharing) */}
      <Sharing42cConfig />

      {/* Wirtschaftlichkeitsanalyse: Energy Sharing vs. klassische Einspeisung */}
      <SharingAnalysisBlock state={state} />
    </div>
  );
}
