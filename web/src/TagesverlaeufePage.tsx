// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { DateNav } from "./DateNav";
import type { ViertelstundeEntry, FullState } from "./types";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale, convertEnergie, einheitLabel, fmtTick, type EnergieEinheit, nf } from "./chartUtils";
import { ChartDownloadButton } from "./ChartDownloadButton";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Gestapeltes Tages-Chart: je Viertelstunde mehrere Segmente nach oben und/oder
// nach unten. Jedes Segment hat Wert, Farbe und Label. Bietet eine Legende zum
// Aus-/Einblenden einzelner Datenreihen sowie eine Umschaltung kWh <-> mittlere
// Leistung (W). Alle Werte sind Energie (kWh je Viertelstunde); W wird nur zur
// Anzeige berechnet (kWh * 4000), nicht gespeichert.
type Seg = { value: number; color: string; label: string };
function StackedDayChart({
  up,
  down,
}: {
  up: Seg[][]; // je Slot (96) eine Liste Segmente nach oben
  down: Seg[][]; // je Slot (96) eine Liste Segmente nach unten
}) {
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Alle vorkommenden Datenreihen-Label (für die Legende), Reihenfolge stabil.
  const legende: { label: string; color: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 96; i++) {
    for (const s of [...(up[i] ?? []), ...(down[i] ?? [])]) {
      if (!seen.has(s.label)) { seen.add(s.label); legende.push({ label: s.label, color: s.color }); }
    }
  }
  const isHidden = (label: string) => hidden.has(label);
  const toggle = (label: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      n.has(label) ? n.delete(label) : n.add(label);
      return n;
    });

  const W = 760, H = 280, padL = 54, padR = 12, padT = 16, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Nur sichtbare Segmente zählen (in kWh gerechnet, Anzeige ggf. in W).
  const visSum = (segs: Seg[]) =>
    segs.reduce((a, s) => a + (isHidden(s.label) ? 0 : Math.max(0, s.value)), 0);
  let maxUpKwh = 0, maxDownKwh = 0;
  for (let i = 0; i < 96; i++) {
    maxUpKwh = Math.max(maxUpKwh, visSum(up[i] ?? []));
    maxDownKwh = Math.max(maxDownKwh, visSum(down[i] ?? []));
  }
  // In Anzeige-Einheit umrechnen und schöne Skala bilden.
  const maxUp = convertEnergie(maxUpKwh, einheit);
  const maxDown = convertEnergie(maxDownKwh, einheit);
  const scaleUp = niceScale(maxUp);
  const scaleDown = niceScale(maxDown);
  const upMax = maxUpKwh > 0 ? scaleUp.max : 0;
  const downMax = maxDownKwh > 0 ? scaleDown.max : 0;

  const range = (upMax + downMax) || 1;
  const zeroY = padT + (upMax / range) * plotH;
  const hUp = (vDisp: number) => (vDisp / (upMax || 1)) * (zeroY - padT);
  const hDown = (vDisp: number) => (vDisp / (downMax || 1)) * (padT + plotH - zeroY);
  const barW = plotW / 96;
  const cv = (kwh: number) => convertEnergie(kwh, einheit);

  // Gitterlinien: 0, alle Up-Ticks (positiv) und alle Down-Ticks (negativ).
  const gridTicks: number[] = upMax > 0 ? [...scaleUp.ticks] : [0];
  if (downMax > 0) for (const t of scaleDown.ticks) if (t > 0) gridTicks.push(-t);
  const hourLabels = [0, 6, 12, 18, 24];

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend">
          {legende.map((l) => (
            <button
              key={l.label}
              type="button"
              className={`chart-legend-item${isHidden(l.label) ? " off" : ""}`}
              onClick={() => toggle(l.label)}
              title={isHidden(l.label) ? "einblenden" : "ausblenden"}
            >
              <span className="chart-legend-dot" style={{ background: l.color }} />
              {l.label}
            </button>
          ))}
        </div>
        <EinheitSwitch einheit={einheit} onChange={setEinheit} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {gridTicks.map((t) => {
          const y = t >= 0 ? zeroY - hUp(t) : zeroY + hDown(-t);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={t === 0 ? "#bbb" : "#eee"} />
              <text x={padL - 6} y={y + 4} className="tv-axis" textAnchor="end">
                {fmtTick(Math.abs(t), einheit)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: 96 }, (_, i) => {
          const x = padL + i * barW + 0.5;
          const w = Math.max(barW - 1, 0.5);
          let yTop = zeroY;
          let yBot = zeroY;
          return (
            <g key={i}>
              {(up[i] ?? []).map((s, k) => {
                if (s.value <= 0 || isHidden(s.label)) return null;
                const h = hUp(cv(s.value));
                yTop -= h;
                return <rect key={"u" + k} x={x} y={yTop} width={w} height={Math.max(h, 0.3)} fill={s.color} />;
              })}
              {(down[i] ?? []).map((s, k) => {
                if (s.value <= 0 || isHidden(s.label)) return null;
                const h = hDown(cv(s.value));
                const y = yBot;
                yBot += h;
                return <rect key={"d" + k} x={x} y={y} width={w} height={Math.max(h, 0.3)} fill={s.color} />;
              })}
            </g>
          );
        })}
        {hourLabels.map((h) => (
          <text key={h} x={padL + (h / 24) * plotW} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">
            {String(h).padStart(2, "0")}
          </text>
        ))}
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
          {einheitLabel(einheit)}
        </text>
      </svg>
      <ChartHoverLayer
        svgW={W}
        plotL={padL}
        plotW={plotW}
        rowsForSlot={(i) => {
          const rows: { label: string; value: string; color?: string }[] = [];
          const u = einheitLabel(einheit);
          const dec = einheit === "w" ? 0 : 3;
          for (const s of up[i] ?? []) if (!isHidden(s.label)) rows.push({ label: s.label, value: `${nf(cv(s.value), dec)} ${u}`, color: s.color });
          for (const s of down[i] ?? []) if (!isHidden(s.label)) rows.push({ label: s.label, value: `${nf(cv(s.value), dec)} ${u}`, color: s.color });
          return rows;
        }}
      />
    </div>
  );
}

// Schlanke Umschaltung Energie (kWh) <-> mittlere Leistung (W).
function EinheitSwitch({ einheit, onChange }: { einheit: EnergieEinheit; onChange: (e: EnergieEinheit) => void }) {
  return (
    <div className="chart-unit-switch">
      <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => onChange("kwh")}>kWh</button>
      <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => onChange("w")}>W</button>
    </div>
  );
}

export function TagesverlaeufePage({ state }: { state: FullState }) {
  const [date, setDate] = useState(isoToday());
  const [rows, setRows] = useState<ViertelstundeEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/viertelstunden?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRows(d);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Werte auf 96 Slots mappen (Index = Viertelstunde des Tages).
  // ts = Ende der Viertelstunde "YYYY-MM-DDTHH:MM". Index = (h*60+m)/15,
  // wobei das Ende 00:15 -> Index 0, 00:30 -> Index 1 ... 00:00 -> Index 95.
  function slotIndexFromTs(ts: string): number {
    const t = ts.slice(11); // HH:MM
    const [h, m] = t.split(":").map(Number);
    const endMin = h * 60 + m;
    // Index der Viertelstunde, die hier endet: (endMin/15) - 1, 0 -> letzte (95)
    const idx = Math.round(endMin / 15) - 1;
    return idx < 0 ? 95 : idx;
  }

  const c = state.settings;
  // Oberes Diagramm: Netzbezug (oben, einfarbig) + Einspeisung (unten, gestapelt
  // in Rest / PV §42c / Speicher §42c).
  const netzUp: { value: number; color: string; label: string }[][] = Array.from({ length: 96 }, () => []);
  const netzDown: { value: number; color: string; label: string }[][] = Array.from({ length: 96 }, () => []);
  // Unteres Diagramm: Hausverbrauch (oben, gestapelt in PV / Speicher / Netz).
  const verbUp: { value: number; color: string; label: string }[][] = Array.from({ length: 96 }, () => []);
  const verbDown: { value: number; color: string; label: string }[][] = Array.from({ length: 96 }, () => []);

  for (const r of rows ?? []) {
    const idx = slotIndexFromTs(r.ts);
    if (idx < 0 || idx > 95) continue;
    // Netzbezug nach oben
    netzUp[idx] = [{ value: r.bezogen, color: c.vizColorNetzbezug, label: "Netzbezug" }];
    // Einspeisung nach unten, aufgeteilt: Rest / PV §42c / Speicher §42c
    const e42Pv = r.eingespeist42cPv ?? 0;
    const e42Batt = r.eingespeist42cBatt ?? 0;
    const eRest = Math.max(0, r.eingespeist - e42Pv - e42Batt);
    netzDown[idx] = [
      { value: eRest, color: c.vizColorEinspeisungGesamt, label: "Einspeisung" },
      { value: e42Pv, color: c.vizColorEinspeisungPv, label: "PV §42c" },
      { value: e42Batt, color: c.vizColorEinspeisungSpeicher, label: "Speicher §42c" },
    ];
    // Hausverbrauch nach oben, aufgeteilt: PV / Speicher / Netz
    const vPv = r.verbrauchPv ?? 0;
    const vSp = r.verbrauchSpeicher ?? 0;
    verbUp[idx] = [
      { value: vPv, color: c.vizColorVerbrauchPv, label: "Verbrauch aus PV" },
      { value: vSp, color: c.vizColorVerbrauchSpeicher, label: "Verbrauch aus Speicher" },
      { value: r.bezogen, color: c.vizColorNetzbezug, label: "Netzbezug" },
    ];
  }

  const hasData = (rows?.length ?? 0) > 0;

  // Tagessummen
  const sum = (f: (r: ViertelstundeEntry) => number) =>
    (rows ?? []).reduce((a, r) => a + f(r), 0);
  const sumBezug = sum((r) => r.bezogen);
  const sumVerb = sum((r) => r.verbrauch);
  // Bestandteile Hausverbrauch
  const sumVerbPv = sum((r) => r.verbrauchPv ?? 0);
  const sumVerbSp = sum((r) => r.verbrauchSpeicher ?? 0);
  const sumVerbNetz = sumBezug; // Netz-Anteil des Verbrauchs = Netzbezug
  // Bestandteile Einspeisung (nach §42c-Herkunft)
  const sumEing42cPv = sum((r) => r.eingespeist42cPv ?? 0);
  const sumEing42cBatt = sum((r) => r.eingespeist42cBatt ?? 0);
  const sumEingRest = sum((r) => Math.max(0, r.eingespeist - (r.eingespeist42cPv ?? 0) - (r.eingespeist42cBatt ?? 0)));

  return (
    <div className="tv-page">
      <div className="card">
        <div className="block-head">
          <div className="chart-kopf"><h3>Tagesverläufe</h3><ChartDownloadButton dateiname="tagesverlaeufe" /></div>
          <DateNav value={date} onChange={setDate} label="Tag" />
        </div>
        <p className="hint">
          15-Minuten-Energiewerte des gewählten Tages (kWh je Viertelstunde).
        </p>

        {rows === null && <p>lädt…</p>}
        {rows !== null && !hasData && (
          <p className="hint">Für {date} liegen noch keine Viertelstundenwerte vor.</p>
        )}

        {hasData && (
          <div className="block-stack">
            <div className="block-sub">
              <div className="chart-title">
                Hausverbrauch
                <span className="chart-sum">
                  {nf(sumVerb, 2)} kWh (PV {nf(sumVerbPv, 2)} · Speicher{" "}
                  {nf(sumVerbSp, 2)} · Netz {nf(sumVerbNetz, 2)} kWh)
                </span>
              </div>
              <p className="hint">
                Der gesamte Stromverbrauch des Hauses je Viertelstunde, aufgeteilt
                nach Herkunft: direkt aus der PV, aus dem Batteriespeicher und aus
                dem Netzbezug. Die Werte stammen aus den gespeicherten
                15-Minuten-Energiewerten; die Aufteilung ergibt sich aus den
                Zählerdifferenzen von PV-Erzeugung, Speicherentladung und Netzbezug
                des jeweiligen Zeitfensters.
              </p>
              <StackedDayChart up={verbUp} down={verbDown} />
            </div>

            <div className="block-sub">
              <div className="chart-title">
                Netzbezug &amp; Einspeisung
                <span className="chart-sum">
                  Bezug {nf(sumBezug, 2)} kWh · Einspeisung ins Netz{" "}
                  {nf(sumEingRest, 2)} kWh
                  {" "}· §42c PV {nf(sumEing42cPv, 2)} · §42c Speicher{" "}
                  {nf(sumEing42cBatt, 2)} kWh
                </span>
              </div>
              <p className="hint">
                Gegenüberstellung von Netzbezug (nach oben) und Einspeisung (nach
                unten) je Viertelstunde. Die Einspeisung ist zusätzlich aufgeteilt
                in die klassische Netzeinspeisung sowie die im Rahmen von §42c an
                Abnehmer gelieferten Anteile aus PV und Speicher. Grundlage sind die
                Zählerstände des Netzanschlusses und die berechnete §42c-Aufteilung
                des jeweiligen Zeitfensters.
              </p>
              <StackedDayChart up={netzUp} down={netzDown} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
