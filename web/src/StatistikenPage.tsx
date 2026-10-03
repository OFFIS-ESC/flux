// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import type { HistoryEntry, FullState } from "./types";
import { MonthNav } from "./MonthNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale, convertEnergie, einheitLabel, fmtTick, type EnergieEinheit, nf } from "./chartUtils";
import { ChartDownloadButton } from "./ChartDownloadButton";

const f2 = (n: number | null | undefined) =>
  nf(Number.isFinite(n as number) ? (n as number) : 0, 2);

const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONATE[Number(m) - 1] ?? m} ${y}`;
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// Monats-Bar-Chart: je Tag ein Balken. Verbrauch als Basis (hell), davor
// Netzbezug von 0 nach oben (dunkel, überlagert den Verbrauch), Einspeisung
// nach unten (dritte Farbe). X-Achse umfasst alle Tage des Monats.
function MonthBarChart({
  ym,
  byDay,
  colors,
}: {
  ym: string;
  byDay: Record<number, HistoryRow>;
  colors: {
    verbrauchPv: string;
    verbrauchSpeicher: string;
    netzbezug: string;
    einspeisungGesamt: string;
    einspeisungPv: string;
    einspeisungSpeicher: string;
  };
}) {
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const nDays = daysInMonth(ym);
  const W = 820, H = 318, padL = 54, padR = 12, padT = 16, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Zerlegung je Tag. Verbrauch (oben) = PV-direkt + Speicher + Netzbezug.
  // Einspeisung (unten) = Rest-Einspeisung + PV §42c + Speicher §42c.
  function parts(e: HistoryRow) {
    const vPv = e.pvDirekt ?? 0;
    const vSp = e.speicher ?? 0;
    const vNetz = e.netzbezug;
    const e42Pv = e.eingespeist42cPv ?? 0;
    const e42Sp = e.eingespeist42cSpeicher ?? 0;
    const eRest = Math.max(0, e.eingespeist - e42Pv - e42Sp);
    return { vPv, vSp, vNetz, eRest, e42Pv, e42Sp };
  }

  // Datenreihen-Definition (Key -> Label/Farbe/Richtung).
  const reihen = [
    { key: "vPv", label: "Verbrauch aus PV", color: colors.verbrauchPv, dir: "up" as const },
    { key: "vSp", label: "Verbrauch aus Speicher", color: colors.verbrauchSpeicher, dir: "up" as const },
    { key: "vNetz", label: "Netzbezug", color: colors.netzbezug, dir: "up" as const },
    { key: "eRest", label: "Einspeisung ins Netz", color: colors.einspeisungGesamt, dir: "down" as const },
    { key: "e42Pv", label: "PV §42c", color: colors.einspeisungPv, dir: "down" as const },
    { key: "e42Sp", label: "Speicher §42c", color: colors.einspeisungSpeicher, dir: "down" as const },
  ];
  const isHidden = (k: string) => hidden.has(k);
  const toggle = (k: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const pv = (p: ReturnType<typeof parts>, k: string) => (isHidden(k) ? 0 : (p as Record<string, number>)[k]);

  let maxUpKwh = 0, maxDownKwh = 0;
  for (let d = 1; d <= nDays; d++) {
    const e = byDay[d];
    if (!e) continue;
    const p = parts(e);
    maxUpKwh = Math.max(maxUpKwh, pv(p, "vPv") + pv(p, "vSp") + pv(p, "vNetz"));
    maxDownKwh = Math.max(maxDownKwh, pv(p, "eRest") + pv(p, "e42Pv") + pv(p, "e42Sp"));
  }
  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const scaleUp = niceScale(cv(maxUpKwh));
  const scaleDown = niceScale(cv(maxDownKwh));
  const upMax = scaleUp.max;
  const downMax = maxDownKwh > 0 ? scaleDown.max : 0;
  const range = (upMax + downMax) || 1;
  const zeroY = padT + (upMax / range) * plotH;
  const yUpH = (vDisp: number) => (vDisp / (upMax || 1)) * (zeroY - padT);
  const yDownH = (vDisp: number) => (vDisp / (downMax || 1)) * (padT + plotH - zeroY);
  const colW = plotW / nDays;
  const barW = Math.max(colW * 0.7, 1);
  const barOff = (colW - barW) / 2;

  const gridTicks: number[] = [...scaleUp.ticks];
  if (downMax > 0) for (const t of scaleDown.ticks) if (t > 0) gridTicks.push(-t);

  const dayLabels: number[] = [];
  for (let d = 1; d <= nDays; d += 5) dayLabels.push(d);
  if (dayLabels[dayLabels.length - 1] !== nDays) dayLabels.push(nDays);

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend">
          {reihen.map((r) => (
            <button key={r.key} type="button" className={`chart-legend-item${isHidden(r.key) ? " off" : ""}`} onClick={() => toggle(r.key)}>
              <span className="chart-legend-dot" style={{ background: r.color }} />
              {r.label}
            </button>
          ))}
        </div>
        <div className="chart-unit-switch">
          <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
          <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {gridTicks.map((t) => {
          const y = t >= 0 ? zeroY - yUpH(t) : zeroY + yDownH(-t);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={t === 0 ? "#bbb" : "#eee"} />
              <text x={padL - 6} y={y + 4} className="tv-axis" textAnchor="end">
                {fmtTick(Math.abs(t), einheit)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: nDays }, (_, k) => {
          const d = k + 1;
          const e = byDay[d];
          if (!e) return null;
          const p = parts(e);
          const x = padL + k * colW + barOff;
          let yTop = zeroY;
          const segsUp = [
            { v: pv(p, "vPv"), c: colors.verbrauchPv },
            { v: pv(p, "vSp"), c: colors.verbrauchSpeicher },
            { v: pv(p, "vNetz"), c: colors.netzbezug },
          ];
          let yBot = zeroY;
          const segsDown = [
            { v: pv(p, "eRest"), c: colors.einspeisungGesamt },
            { v: pv(p, "e42Pv"), c: colors.einspeisungPv },
            { v: pv(p, "e42Sp"), c: colors.einspeisungSpeicher },
          ];
          return (
            <g key={d}>
              {segsUp.map((s, i) => {
                if (s.v <= 0) return null;
                const h = yUpH(cv(s.v));
                yTop -= h;
                return <rect key={"u" + i} x={x} y={yTop} width={barW} height={Math.max(h, 0.5)} fill={s.c} />;
              })}
              {segsDown.map((s, i) => {
                if (s.v <= 0) return null;
                const h = yDownH(cv(s.v));
                const y = yBot;
                yBot += h;
                return <rect key={"d" + i} x={x} y={y} width={barW} height={Math.max(h, 0.5)} fill={s.c} />;
              })}
            </g>
          );
        })}

        {dayLabels.map((d) => {
          const x = padL + (d - 0.5) * colW;
          return (
            <text key={d} x={x} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">
              {d}
            </text>
          );
        })}

        <text x={padL + 2} y={padT - 2} className="tv-dir" fill={colors.netzbezug}>
          ▲ Verbrauch (PV / Speicher / Netz)
        </text>
        {downMax > 0 && (
          <text x={padL + 2} y={padT + plotH - 2} className="tv-dir" fill={colors.einspeisungGesamt}>
            ▼ Einspeisung (inkl. §42c)
          </text>
        )}
        {/* Achsentitel */}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">
          Tag
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
        count={nDays}
        labelForSlot={(i) => `${i + 1}. ${monthLabel(ym)}`}
        rowsForSlot={(i) => {
          const e = byDay[i + 1];
          if (!e) return [];
          const p = parts(e);
          const u = einheitLabel(einheit);
          const fv = (kwh: number) => (einheit === "w" ? Math.round(convertEnergie(kwh, einheit)).toLocaleString("de-DE") : f2(kwh));
          const rows: { label: string; value: string; color?: string }[] = [];
          if (!isHidden("vPv")) rows.push({ label: "Verbrauch aus PV", value: `${fv(p.vPv)} ${u}`, color: colors.verbrauchPv });
          if (!isHidden("vSp")) rows.push({ label: "Verbrauch aus Speicher", value: `${fv(p.vSp)} ${u}`, color: colors.verbrauchSpeicher });
          if (!isHidden("vNetz")) rows.push({ label: "Netzbezug", value: `${fv(p.vNetz)} ${u}`, color: colors.netzbezug });
          if (!isHidden("eRest")) rows.push({ label: "Einspeisung ins Netz", value: `${fv(p.eRest)} ${u}`, color: colors.einspeisungGesamt });
          if (!isHidden("e42Pv")) rows.push({ label: "PV §42c", value: `${fv(p.e42Pv)} ${u}`, color: colors.einspeisungPv });
          if (!isHidden("e42Sp")) rows.push({ label: "Speicher §42c", value: `${fv(p.e42Sp)} ${u}`, color: colors.einspeisungSpeicher });
          rows.push({ label: "Autarkie", value: `${f2(e.autarkie)} %` });
          rows.push({ label: "Kosten", value: `${f2(e.kosten)} €` });
          return rows;
        }}
      />
    </div>
  );
}

// API-Antwort von /api/history/all: HistoryEntry plus on-the-fly berechnete
// Kosten (saldo) und deren Bestandteile. Kosten werden nicht persistiert.
type KostenAufschluesselung = {
  arbeitskosten: number;
  einspeiseverguetung: number;
  sharingVerguetung: number;
  grundgebuehrAnteil: number;
  sofortbonusAnteil: number;
  neukundenbonusAnteil: number;
  messstelleAnteil: number;
  modul1Anteil: number;
};
type HistoryRow = HistoryEntry & {
  kosten: number;
  einsparung?: number;
  bezugskosten?: number;
  einspeiseverguetung?: number;
  sharingVerguetung?: number;
  kostenAufschluesselung?: KostenAufschluesselung;
};

// Tooltip-Text für die Kosten-Spalte aus den Bestandteilen.
function kostenTooltip(h: HistoryRow): string | undefined {
  const a = h.kostenAufschluesselung;
  const f = (v: number) => nf(v, 2).replace(".", ",");
  // Bevorzugt die detaillierte Aufschlüsselung; Fallback auf die alten Felder.
  if (a) {
    const teile: string[] = [`Bezugskosten (Arbeit): ${f(a.arbeitskosten)} €`];
    if (a.grundgebuehrAnteil !== 0) teile.push(`anteil. Grundgebühr: ${f(a.grundgebuehrAnteil)} €`);
    if (a.messstelleAnteil !== 0) teile.push(`anteil. Messstelle: ${f(a.messstelleAnteil)} €`);
    if (a.modul1Anteil !== 0) teile.push(`§14a Modul 1: ${f(a.modul1Anteil)} €`);
    if (a.sofortbonusAnteil !== 0) teile.push(`anteil. Sofortbonus: ${f(a.sofortbonusAnteil)} €`);
    if (a.neukundenbonusAnteil !== 0) teile.push(`anteil. Neukundenbonus: ${f(a.neukundenbonusAnteil)} €`);
    if ((a.einspeiseverguetung ?? 0) !== 0) teile.push(`Einspeisevergütung: −${f(a.einspeiseverguetung)} €`);
    if ((a.sharingVerguetung ?? 0) !== 0) teile.push(`§42c-Vergütung: −${f(a.sharingVerguetung)} €`);
    teile.push(`Saldo: ${f(h.kosten)} €`);
    return teile.join("\n");
  }
  if (h.bezugskosten == null) return undefined;
  const teile = [
    `Bezugskosten: ${f(h.bezugskosten)} €`,
    `Einspeisevergütung: −${f(h.einspeiseverguetung ?? 0)} €`,
  ];
  if ((h.sharingVerguetung ?? 0) !== 0)
    teile.push(`§42c-Vergütung: −${f(h.sharingVerguetung ?? 0)} €`);
  teile.push(`Saldo: ${f(h.kosten)} €`);
  return teile.join("\n");
}

export function StatistikenPage({ state }: { state: FullState }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [ym, setYm] = useState(currentYm());

  async function load() {
    try {
      const res = await fetch("/api/history/all");
      setRows(await res.json());
    } catch {
      setRows([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // verfügbare Monate (YYYY-MM) aus den Daten, plus aktueller Monat
  const monthsAvail = [...new Set((rows ?? []).map((r) => r.date.slice(0, 7)))];
  if (!monthsAvail.includes(currentYm())) monthsAvail.push(currentYm());
  monthsAvail.sort((a, b) => (a < b ? 1 : -1));

  // Tage des gewählten Monats
  const monthRows = (rows ?? []).filter((r) => r.date.slice(0, 7) === ym);
  const byDay: Record<number, HistoryRow> = {};
  for (const r of monthRows) byDay[Number(r.date.slice(8, 10))] = r;

  // Monatssumme inkl. Kostenbestandteile (für den Summen-Tooltip)
  const sum = monthRows.reduce(
    (s, d) => ({
      verbrauch: s.verbrauch + d.verbrauch,
      pvSpeicher: s.pvSpeicher + d.pvSpeicher,
      pvDirekt: s.pvDirekt + (d.pvDirekt ?? 0),
      speicher: s.speicher + (d.speicher ?? 0),
      netzbezug: s.netzbezug + d.netzbezug,
      eingespeist: s.eingespeist + d.eingespeist,
      eingespeist42cPv: s.eingespeist42cPv + (d.eingespeist42cPv ?? 0),
      eingespeist42cSpeicher: s.eingespeist42cSpeicher + (d.eingespeist42cSpeicher ?? 0),
      kosten: s.kosten + d.kosten,
      einsparung: s.einsparung + (d.einsparung ?? 0),
      bezugskosten: s.bezugskosten + (d.bezugskosten ?? 0),
      einspeiseverguetung: s.einspeiseverguetung + (d.einspeiseverguetung ?? 0),
      sharingVerguetung: s.sharingVerguetung + (d.sharingVerguetung ?? 0),
    }),
    {
      verbrauch: 0, pvSpeicher: 0, pvDirekt: 0, speicher: 0, netzbezug: 0,
      eingespeist: 0, eingespeist42cPv: 0, eingespeist42cSpeicher: 0, kosten: 0,
      einsparung: 0,
      bezugskosten: 0, einspeiseverguetung: 0, sharingVerguetung: 0,
    }
  );
  const autarkieSum = sum.verbrauch > 0 ? 100 * (sum.pvSpeicher / sum.verbrauch) : 0;

  // Aufschlüsselung der Monatssumme (Summe der Tages-Bestandteile) für den
  // Summen-Tooltip.
  const sumAufschluesselung: KostenAufschluesselung = monthRows.reduce(
    (acc, d) => {
      const a = d.kostenAufschluesselung;
      if (a) {
        acc.arbeitskosten += a.arbeitskosten;
        acc.einspeiseverguetung += a.einspeiseverguetung;
        acc.sharingVerguetung += a.sharingVerguetung;
        acc.grundgebuehrAnteil += a.grundgebuehrAnteil;
        acc.sofortbonusAnteil += a.sofortbonusAnteil;
        acc.neukundenbonusAnteil += a.neukundenbonusAnteil;
        acc.messstelleAnteil += a.messstelleAnteil;
        acc.modul1Anteil += a.modul1Anteil;
      }
      return acc;
    },
    { arbeitskosten: 0, einspeiseverguetung: 0, sharingVerguetung: 0, grundgebuehrAnteil: 0,
      sofortbonusAnteil: 0, neukundenbonusAnteil: 0, messstelleAnteil: 0, modul1Anteil: 0 }
  );
  const sumMitAufschluesselung = { ...sum, kostenAufschluesselung: sumAufschluesselung };
  const daysSorted = [...monthRows].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="statistiken-page">
      <div className="card">
        <div className="block-head">
          <h3>Monatsübersicht</h3>
          <MonthNav value={ym} onChange={setYm} />
        </div>

        {rows === null && <p>lädt…</p>}
        {rows && monthRows.length === 0 && (
          <p className="hint">Für {monthLabel(ym)} liegen keine Daten vor.</p>
        )}

        {monthRows.length > 0 && (
          <div className="block-stack">
            <div className="block-sub">
              <div className="chart-kopf"><h4>Tagesbilanz im Monatsverlauf</h4><ChartDownloadButton dateiname="statistik-monatsbilanz" /></div>
              <p className="hint">
                Für jeden Tag des Monats ein gestapelter Balken: nach oben der
                Hausverbrauch (aufgeteilt in PV-direkt, Speicher und Netzbezug),
                nach unten die Einspeisung. So sieht man auf einen Blick, an welchen
                Tagen viel selbst erzeugt bzw. eingespeist wurde. Die Werte stammen
                aus den abgeschlossenen Tagesbilanzen; der laufende Tag ist mit den
                bisher aufgelaufenen Werten enthalten.
              </p>
              <MonthBarChart
                ym={ym}
                byDay={byDay}
                colors={{
                  verbrauchPv: state.settings.vizColorVerbrauchPv,
                  verbrauchSpeicher: state.settings.vizColorVerbrauchSpeicher,
                  netzbezug: state.settings.vizColorNetzbezug,
                  einspeisungGesamt: state.settings.vizColorEinspeisungGesamt,
                  einspeisungPv: state.settings.vizColorEinspeisungPv,
                  einspeisungSpeicher: state.settings.vizColorEinspeisungSpeicher,
                }}
              />
            </div>

            <div className="block-sub">
              <h4>
                Tagesübersicht {monthLabel(ym)}
              </h4>
              <p className="hint">
                Tabellarische Aufstellung aller Tage des Monats mit Verbrauch,
                Eigenerzeugung, Netzbezug, Einspeisung, Autarkiegrad und den
                berechneten Kosten. Die Kosten werden viertelstundengenau aus
                Spotpreisen bzw. Fixtarif ermittelt; die unterste Zeile summiert den
                Monat. Die Spalte <strong>Einsparung</strong> zeigt die vermiedenen
                Bezugskosten durch Eigenverbrauch (PV und Speicher), abzüglich der
                entgangenen Einspeisevergütung – viertelstundengenau und unter
                Berücksichtigung der EEG-Regelung. Sie ist eine theoretische
                Vergleichsgröße und wird nie negativ: Bei negativen Börsenpreisen
                (dynamischer Tarif) entgeht durch Eigenverbrauch kein Geld, man hätte
                lediglich noch mehr sparen können. Der reale Vorteil solcher Preise
                zeigt sich in den Kosten, nicht hier.
              </p>
              <div className="table-scroll">
              <table className="data-table num-table">
            <thead>
              <tr>
                <th rowSpan={2}>Tag</th>
                <th colSpan={4} className="grp">Verbrauch [kWh]</th>
                <th colSpan={3} className="grp">Einspeisung [kWh]</th>
                <th rowSpan={2}>Autarkie</th>
                <th rowSpan={2}>Kosten</th>
                <th rowSpan={2}>Einsparung</th>
              </tr>
              <tr>
                <th>Gesamt</th>
                <th>PV</th>
                <th>Speicher</th>
                <th>Netz</th>
                <th>Gesamt</th>
                <th>PV §42c</th>
                <th>Speicher §42c</th>
              </tr>
            </thead>
            <tbody>
              {daysSorted.map((h) => (
                <tr key={h.date}>
                  <td>{Number(h.date.slice(8, 10))}</td>
                  <td>{f2(h.verbrauch)}</td>
                  <td>{f2(h.pvDirekt ?? 0)}</td>
                  <td>{f2(h.speicher ?? 0)}</td>
                  <td>{f2(h.netzbezug)}</td>
                  <td>{f2(h.eingespeist)}</td>
                  <td>{f2(h.eingespeist42cPv ?? 0)}</td>
                  <td>{f2(h.eingespeist42cSpeicher ?? 0)}</td>
                  <td>{f2(h.autarkie)} %</td>
                  <td title={kostenTooltip(h)} className="kosten-cell">
                    {f2(h.kosten)} &#8364;
                  </td>
                  <td className="einsparung-cell" style={{ color: "#2e7d32" }} title="Vermiedene Bezugskosten durch Eigenverbrauch (PV + Speicher), abzüglich entgangener Einspeisevergütung. Theoretische Vergleichsgröße; wird nie negativ – bei negativen Börsenpreisen entgeht kein Geld, es hätte nur noch mehr gespart werden können.">
                    {f2(h.einsparung ?? 0)} &#8364;
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="month-sum">
                <td style={{ textAlign: "left", fontWeight: "bold" }}>Σ</td>
                <td>{f2(sum.verbrauch)}</td>
                <td>{f2(sum.pvDirekt)}</td>
                <td>{f2(sum.speicher)}</td>
                <td>{f2(sum.netzbezug)}</td>
                <td>{f2(sum.eingespeist)}</td>
                <td>{f2(sum.eingespeist42cPv)}</td>
                <td>{f2(sum.eingespeist42cSpeicher)}</td>
                <td>{f2(autarkieSum)} %</td>
                <td title={kostenTooltip(sumMitAufschluesselung as HistoryRow)} className="kosten-cell">
                  {f2(sum.kosten)} &#8364;
                </td>
                <td className="einsparung-cell" style={{ color: "#2e7d32" }}>{f2(sum.einsparung)} &#8364;</td>
              </tr>
            </tfoot>
          </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
