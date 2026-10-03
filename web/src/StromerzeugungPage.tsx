// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useState } from "react";
import { DateNav } from "./DateNav";
import { MonthNav } from "./MonthNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { StackedRoomChart, PALETTE, type Serie, type ChartOverlay } from "./RoomDayChart";
import { convertEnergie, einheitLabel, nf, type EnergieEinheit } from "./chartUtils";
import { SourceLinks } from "./SourceLinks";
import { ChartDownloadButton } from "./ChartDownloadButton";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface PvDaySerie { id: string; label: string; values: number[]; summe: number }
interface PvMonthRow { tag: string; perSource: Record<string, number>; summe: number }
interface PvAnlage { id: string; label: string }

// ---- Tagesverlauf (gestapelt, Anlagen abwählbar) ----------------------------
function PvTagChart({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  const [series, setSeries] = useState<PvDaySerie[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  // Prognose (persistiert) für den angezeigten Tag: 96-Slot-Gesamtprofil.
  const [forecast, setForecast] = useState<{ slots: number[]; remaining: number; total: number } | null>(null);
  // "an reale Produktion anpassen": Einstellung + Faktor kommen jetzt vom Server
  // (auf der PV-Anlagenseite umschaltbar). Hier nur Anzeige, keine Checkbox.
  const [skalierung, setSkalierung] = useState<{ faktor: number; prozent: number; vorhanden: boolean; aktiv: boolean } | null>(null);

  const istHeute = date === isoToday();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pv/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSeries((d?.series ?? []).filter((s: PvDaySerie) => s.summe > 0)))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [date]);

  // Prognose (persistiert) für den angezeigten Tag laden – auch für vergangene
  // Tage, sofern gespeichert. Kein direkter forecast.solar-Abruf hier.
  useEffect(() => {
    let abbruch = false;
    fetch(`/api/pvanlagen/prognose?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (abbruch || !j?.ok || !j.vorhanden || !Array.isArray(j.gesamtSlots)) { setForecast(null); return; }
        setForecast({ slots: j.gesamtSlots, remaining: j.remainingKwh ?? 0, total: j.kwhTotal ?? 0 });
      })
      .catch(() => { if (!abbruch) setForecast(null); });
    return () => { abbruch = true; };
  }, [date]);

  // Skalierungsfaktor nur für heute laden (Anpassung an reale Produktion).
  useEffect(() => {
    if (!istHeute) { setSkalierung(null); return; }
    let abbruch = false;
    fetch("/api/pvanlagen/prognose/skalierung")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!abbruch && j?.ok) setSkalierung({ faktor: j.faktor, prozent: j.prozent, vorhanden: j.vorhanden, aktiv: !!j.aktiv }); })
      .catch(() => { if (!abbruch) setSkalierung(null); });
    return () => { abbruch = true; };
  }, [date, istHeute]);

  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const faktor = skalierung?.aktiv && skalierung?.vorhanden ? skalierung.faktor : 1;
  // Prognose-Slots ggf. skaliert; gesamte Linie über den Tag (ab Slot 0).
  const prognoseSlots = forecast ? forecast.slots.map((v) => v * faktor) : null;
  const overlay: ChartOverlay | undefined = prognoseSlots
    ? { values: prognoseSlots, startSlot: 0, color: "#e8a33d", label: "Prognose" }
    : undefined;

  // In das Serie-Format des StackedRoomChart überführen (Icon = Sonne).
  const chartSeries: Serie[] = (series ?? []).map((s) => ({
    id: s.id, label: s.label, icon: "☀️", deviceType: null, values: s.values, summe: s.summe,
  }));
  const colorOf = (id: string) => PALETTE[(series ?? []).findIndex((s) => s.id === id) % PALETTE.length];
  const toggle = (id: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const visible = (series ?? []).filter((s) => !hidden.has(s.id));
  const tagesSumme = visible.reduce((a, s) => a + s.summe, 0);

  return (
    <section className="card">
      <div className="block-head">
        <div className="chart-kopf"><h3>PV-Ertrag – Tagesverlauf</h3><ChartDownloadButton dateiname="pv-ertrag-tagesverlauf" /></div>
        <DateNav value={date} onChange={onDateChange} label="Tag" />
      </div>
      <p className="hint" style={{ margin: "4px 0 6px" }}>
        Gestapelter Tagesverlauf des PV-Ertrags je Anlage. Einzelne Anlagen über
        die Legende aus- und einblenden. Die gestrichelte Linie ist die
        Ertragsprognose.
      </p>
      {loading && !series && <p className="hint">Lade Tagesverlauf…</p>}
      {series && series.length === 0 && !forecast && <p className="hint">Kein PV-Ertrag an diesem Tag aufgezeichnet.</p>}
      {series && (series.length > 0 || forecast) && (
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
                  ☀️ {s.label}
                </button>
              ))}
            </div>
            <div className="chart-unit-switch">
              <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
              <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
            </div>
          </div>
          <div className="pv-tagsumme">
            Tagesertrag: <strong>{nf(tagesSumme, 2)} kWh</strong>
            {forecast && (
              <span className="pv-prognose-info">
                {istHeute
                  ? <>{" · "}Prognose Rest heute: <strong>{nf(forecast.remaining * faktor, 2)} kWh</strong>{" "}(Tag gesamt {nf(forecast.total * faktor, 1)} kWh)</>
                  : <>{" · "}Prognose Tag: <strong>{nf(forecast.total, 1)} kWh</strong></>}
              </span>
            )}
          </div>
          {/* Anzeige der Prognose-Skalierung (Einstellung auf der PV-Anlagenseite) */}
          {istHeute && forecast && skalierung?.aktiv && skalierung?.vorhanden && (
            <p className="hint pv-skal-hinweis">
              Auf Basis der vergangenen tatsächlichen Erzeugungswerte wird die Prognose um{" "}
              <span className={"pv-anpassen-badge" + (skalierung.prozent >= 0 ? " pos" : " neg")}>{skalierung.prozent >= 0 ? "+" : ""}{skalierung.prozent}%</span>{" "}
              skaliert.
            </p>
          )}
          <div className="chart-plot">
            <StackedRoomChart series={chartSeries} hidden={hidden} einheit={einheit} overlay={overlay} yTitle={einheit === "w" ? "Ø-Leistung (W)" : "Ertrag (kWh)"} />
            <ChartHoverLayer
              svgW={760}
              plotL={48}
              plotW={760 - 48 - 12}
              tooltipTop={8}
              rowsForSlot={(i) => {
                const rows = visible
                  .filter((s) => s.values[i] > 0)
                  .map((s) => ({
                    label: `☀️ ${s.label}`,
                    value: `${nf(cv(s.values[i]), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`,
                    color: colorOf(s.id),
                  }));
                const sum = visible.reduce((a, s) => a + s.values[i], 0);
                if (rows.length > 1) rows.push({ label: "Summe", value: `${nf(cv(sum), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`, color: "#333" });
                // Prognose (Gesamt über alle Anlagen) für diese Viertelstunde ergänzen.
                if (prognoseSlots && prognoseSlots[i] > 0) {
                  rows.push({ label: "Prognose", value: `${nf(cv(prognoseSlots[i]), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`, color: "#e8a33d" });
                }
                return rows;
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Monatsübersicht (gestapelte Tagesbilanz je Anlage) ---------------------
function niceScale(max: number): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = (n <= 1 ? 0.2 : n <= 2 ? 0.5 : n <= 5 ? 1 : 2) * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(4));
  return { max: top, ticks };
}

function PvMonatChart({ rows, anlagen, selectedDay, onPick }: {
  rows: PvMonthRow[]; anlagen: PvAnlage[]; selectedDay: string | null; onPick: (tag: string) => void;
}) {
  // Ausgeblendete Anlagen (über die Legende umschaltbar – wie beim Tagesverlauf).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const visibleAnlagen = anlagen.filter((a) => !hidden.has(a.id));

  const W = 760, H = 300, padL = 48, padR = 12, padT = 14, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  // Maximum nur über die SICHTBAREN Anlagen (Summe je Tag), damit sich die Skala
  // beim Ausblenden sinnvoll anpasst.
  const sumVisible = (r: PvMonthRow) =>
    visibleAnlagen.reduce((acc, a) => acc + (r.perSource[a.id] ?? 0), 0);
  const max = Math.max(0.0001, ...rows.map(sumVisible));
  const scale = niceScale(max);
  const dispMax = scale.max;
  // x-Achse deckt den KOMPLETTEN Monat ab (nicht nur Tage mit Daten). Jeder Tag
  // hat eine feste Position; Tage ohne Daten bleiben leer (kein Balken).
  const ymRef = rows[0]?.tag?.slice(0, 7);
  const nDays = ymRef
    ? new Date(Number(ymRef.slice(0, 4)), Number(ymRef.slice(5, 7)), 0).getDate()
    : (rows.length || 1);
  const slotW = plotW / nDays;
  const barW = Math.min(slotW * 0.7, 22);
  const yOf = (v: number) => padT + (1 - v / dispMax) * plotH;
  const baseY = padT + plotH;
  const colorOf = (id: string) => PALETTE[anlagen.findIndex((a) => a.id === id) % PALETTE.length];

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend">
          {anlagen.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`chart-legend-item${hidden.has(a.id) ? " off" : ""}`}
              onClick={() => toggle(a.id)}
              title={hidden.has(a.id) ? "einblenden" : "ausblenden"}
            >
              <span className="chart-legend-swatch" style={{ background: colorOf(a.id) }} />☀️ {a.label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
            <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {rows.map((r) => {
          const day = Number(r.tag.slice(8, 10));
          const cx = padL + (day - 0.5) * slotW;
          const isSel = selectedDay != null && r.tag === selectedDay;
          const dimmed = selectedDay != null && !isSel;
          // gestapelte Segmente je Anlage (nur sichtbare)
          let yCursor = baseY;
          const segs = visibleAnlagen.map((a) => {
            const val = r.perSource[a.id] ?? 0;
            if (val <= 0) return null;
            const h = (val / dispMax) * plotH;
            const y = yCursor - h;
            yCursor = y;
            return <rect key={a.id} x={cx - barW / 2} y={y} width={barW} height={Math.max(h, 0.3)}
              fill={colorOf(a.id)} opacity={dimmed ? 0.4 : 1} />;
          });
          return (
            <g key={r.tag} style={{ cursor: "pointer" }} onClick={() => onPick(r.tag)}>
              {segs}
              {(day === 1 || day % 5 === 0) && (
                <text x={cx} y={padT + plotH + 16} className="tv-axis" textAnchor="middle">{day}</text>
              )}
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">Tag des Monats</text>
        <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>PV-Ertrag (kWh)</text>
      </svg>
      <ChartHoverLayer
        svgW={W}
        plotL={padL}
        plotW={plotW}
        count={nDays}
        labelForSlot={(i) => {
          const r = rows.find((x) => Number(x.tag.slice(8, 10)) === i + 1);
          return r?.tag ?? "";
        }}
        rowsForSlot={(i) => {
          const r = rows.find((x) => Number(x.tag.slice(8, 10)) === i + 1);
          if (!r) return [];
          const list = visibleAnlagen
            .filter((a) => (r.perSource[a.id] ?? 0) > 0)
            .map((a) => ({
              label: `☀️ ${a.label}`,
              value: `${nf(r.perSource[a.id] ?? 0, 2)} kWh`,
              color: colorOf(a.id),
            }));
          if (list.length > 1) {
            const sumVis = visibleAnlagen.reduce((acc, a) => acc + (r.perSource[a.id] ?? 0), 0);
            list.push({ label: "Summe", value: `${nf(sumVis, 2)} kWh`, color: "#333" });
          }
          return list;
        }}
      />
    </div>
  );
}

function PvMonat({ month, onMonthChange, selectedDay, onPick }: {
  month: string; onMonthChange: (m: string) => void; selectedDay: string | null; onPick: (tag: string) => void;
}) {
  const [data, setData] = useState<{ anlagen: PvAnlage[]; rows: PvMonthRow[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pv/month?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ? { anlagen: d.anlagen ?? [], rows: d.rows ?? [] } : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [month]);

  // Nur Anlagen mit Ertrag im Monat in Legende/Stapel zeigen.
  const aktiveAnlagen = useMemo(() => {
    if (!data) return [];
    const mitErtrag = new Set<string>();
    for (const r of data.rows) for (const [id, v] of Object.entries(r.perSource)) if (v > 0) mitErtrag.add(id);
    return data.anlagen.filter((a) => mitErtrag.has(a.id));
  }, [data]);

  const monatsSumme = (data?.rows ?? []).reduce((a, r) => a + r.summe, 0);
  // Summe je Anlage über den Monat
  const summeJeAnlage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of data?.rows ?? []) for (const [id, v] of Object.entries(r.perSource)) m[id] = (m[id] ?? 0) + v;
    return m;
  }, [data]);

  return (
    <section className="card">
      <div className="block-head">
        <div className="chart-kopf"><h3>PV-Ertrag – Tagesbilanz im Monatsverlauf</h3><ChartDownloadButton dateiname="pv-ertrag-monat" /></div>
        <MonthNav value={month} onChange={onMonthChange} />
      </div>
      {loading && !data && <p className="hint">Lade Monatsübersicht…</p>}
      {data && data.rows.length === 0 && <p className="hint">Kein PV-Ertrag in diesem Monat aufgezeichnet.</p>}
      {data && data.rows.length > 0 && (
        <>
          <p className="hint">
            Monatsertrag: <strong>{nf(monatsSumme, 1)} kWh</strong>
            {aktiveAnlagen.length > 1 && (
              <> · je Anlage: {aktiveAnlagen.map((a) => `${a.label} ${nf(summeJeAnlage[a.id] ?? 0, 1)}`).join(" · ")} kWh</>
            )}
          </p>
          <PvMonatChart rows={data.rows} anlagen={aktiveAnlagen} selectedDay={selectedDay} onPick={onPick} />
          <div className="pv-table-wrap">
            <div className="table-scroll">
            <table className="data-table pv-monat-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Tag</th>
                  {aktiveAnlagen.map((a) => <th key={a.id}>{a.label}</th>)}
                  <th title="Summe">Σ</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.tag} className={r.tag === selectedDay ? "wasser-row-sel" : ""}
                    style={{ cursor: "pointer" }} onClick={() => onPick(r.tag)}>
                    <td>{Number((r.tag.split("-")[2] ?? r.tag))}</td>
                    {aktiveAnlagen.map((a) => <td key={a.id}>{nf(r.perSource[a.id] ?? 0, 2)}</td>)}
                    <td><strong>{nf(r.summe, 2)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong title="Summe">Σ</strong></td>
                  {aktiveAnlagen.map((a) => <td key={a.id}><strong>{nf(summeJeAnlage[a.id] ?? 0, 1)}</strong></td>)}
                  <td><strong>{nf(monatsSumme, 1)}</strong></td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
          <p className="hint" style={{ fontSize: 12 }}>Werte in kWh. Klick auf einen Tag zeigt ihn oben im Tagesverlauf.</p>
        </>
      )}
    </section>
  );
}

export function StromerzeugungPage() {
  const [date, setDate] = useState(isoToday());
  const [month, setMonth] = useState(isoToday().slice(0, 7));

  function pickDate(d: string) { setDate(d); setMonth(d.slice(0, 7)); }

  return (
    <div className="page">
      <h2>Stromerzeugung</h2>
      <p className="hint">
        Ertrag der einzelnen PV-Anlagen – als Tagesverlauf (Viertelstundenwerte)
        und als Tagesbilanz über den Monat, jeweils aufgesplittet nach Anlage.
      </p>
      <SourceLinks roles="pv" title="Weboberflächen der PV-Erzeuger" />
      <PvTagChart date={date} onDateChange={pickDate} />
      <PvMonat month={month} onMonthChange={setMonth} selectedDay={date.slice(0, 7) === month ? date : null} onPick={pickDate} />
    </div>
  );
}
