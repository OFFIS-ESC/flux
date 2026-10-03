// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";
import { DateNav } from "./DateNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { niceScale, convertEnergie, einheitLabel, fmtTick, type EnergieEinheit, nf } from "./chartUtils";
import { ChartDownloadButton } from "./ChartDownloadButton";

// Farben je Anlage (stabil über Index).
export const PV_ANLAGE_COLORS = ["#f4b400", "#4285f4", "#0f9d58", "#db4437", "#ab47bc", "#00acc1", "#ff7043", "#5c6bc0"];

interface StoredAnlage { anlageId: string; anlageName: string; slots: number[]; kwhTotal: number }
interface StoredTag {
  vorhanden: boolean; updatedAt: string | null;
  gesamtSlots: number[]; kwhTotal: number; remainingKwh: number;
  anlagen: StoredAnlage[];
}

function isoToday(): string { return new Date().toLocaleDateString("sv-SE"); }
function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv-SE");
}
function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}
function nowSlotIndex(): number {
  const n = new Date();
  return Math.floor((n.getHours() * 60 + n.getMinutes()) / 15);
}
function restAusSlots(slots: number[], vonSlot: number): number {
  let s = 0;
  for (let i = Math.max(0, vonSlot); i < 96; i++) s += slots[i] ?? 0;
  return s;
}

async function fetchTag(date: string): Promise<StoredTag | null> {
  try {
    const r = await fetch(`/api/pvanlagen/prognose?date=${date}`);
    const j = await r.json();
    if (!j?.ok || !j.vorhanden) return null;
    return j as StoredTag;
  } catch { return null; }
}

// Vereinigter Prognose-Block: KPIs (heute/Rest/morgen), Ertragszeilen je Anlage
// und ein gestapeltes 2-Tage-Chart mit Datumsnavigation, kWh/W-Umschalter,
// Achsenbeschriftung und Mouseover. onRefresh loest einen sofortigen Abruf aus.
export function PvPrognoseChart({
  onRefresh, busy, err,
}: {
  onRefresh?: () => void;
  busy?: boolean;
  err?: string;
}) {
  const [einheit, setEinheit] = useState<EnergieEinheit>("kwh");
  // Abrufintervall der Ertragsprognose (Minuten). Aus /api/state geladen,
  // gespeichert über /api/energySettings.
  const [intervalMin, setIntervalMin] = useState<number | null>(null);
  const [intervalSaved, setIntervalSaved] = useState(false);
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((j) => {
        const v = Number(j?.settings?.prognoseIntervalMin);
        setIntervalMin(Number.isFinite(v) && v > 0 ? v : 90);
      })
      .catch(() => setIntervalMin(90));
  }, []);
  const saveInterval = async (value: number) => {
    const safe = Math.max(15, Math.min(1440, Math.round(value)));
    setIntervalMin(safe);
    try {
      await fetch("/api/energySettings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prognoseIntervalMin: safe }),
      });
      setIntervalSaved(true);
      setTimeout(() => setIntervalSaved(false), 2000);
    } catch { /* ignore */ }
  };
  // "an reale Produktion anpassen": persistierte Einstellung + aktueller Faktor.
  const [skalAktiv, setSkalAktiv] = useState(true);
  const [skal, setSkal] = useState<{ prozent: number; vorhanden: boolean } | null>(null);
  const [heute, setHeute] = useState<StoredTag | null>(null);
  const [morgen, setMorgen] = useState<StoredTag | null>(null);
  const [chartDate, setChartDate] = useState(isoToday());
  const [tag1, setTag1] = useState<StoredTag | null>(null);
  const [tag2, setTag2] = useState<StoredTag | null>(null);
  // Prognose-Verlauf (Slider) fuer den ERSTEN dargestellten Tag: Liste der
  // Zeitpunkte, zu denen es eine (veraenderte) Prognose gab, und der aktuell
  // gewaehlte Index. null/leer = kein Verlauf -> Slider ausgeblendet.
  const [verlaufZeit, setVerlaufZeit] = useState<string[]>([]);
  const [verlaufIdx, setVerlaufIdx] = useState<number | null>(null);
  const [verlaufSlotMax, setVerlaufSlotMax] = useState(0);
  const [tag1Override, setTag1Override] = useState<StoredTag | null>(null);

  const heuteIso = isoToday();
  const morgenIso = shiftIso(heuteIso, 1);
  const chartDate2 = shiftIso(chartDate, 1);

  const loadKpis = useCallback(() => {
    Promise.all([fetchTag(heuteIso), fetchTag(morgenIso)]).then(([h, m]) => { setHeute(h); setMorgen(m); });
  }, [heuteIso, morgenIso]);

  useEffect(() => { loadKpis(); }, [loadKpis]);

  // Skalierungs-Einstellung + aktuellen Faktor laden.
  useEffect(() => {
    fetch("/api/pvanlagen/prognose/skalierung")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) { setSkalAktiv(!!j.aktiv); setSkal({ prozent: j.prozent, vorhanden: j.vorhanden }); } })
      .catch(() => { /* ignore */ });
  }, []);

  const toggleSkal = (aktiv: boolean) => {
    setSkalAktiv(aktiv);
    fetch("/api/pvanlagen/prognose/skalierung/einstellung", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktiv }),
    }).catch(() => { /* ignore */ });
  };

  useEffect(() => {
    let ab = false;
    Promise.all([fetchTag(chartDate), fetchTag(chartDate2)]).then(([t1, t2]) => {
      if (ab) return;
      setTag1(t1); setTag2(t2);
    });
    return () => { ab = true; };
  }, [chartDate]);

  // Verlauf (Slider) fuer den ersten Tag laden. Slider steht anfangs ganz rechts
  // (letzter Stand = aktuelle Anzeige). Ein Override wird zurueckgesetzt.
  useEffect(() => {
    let ab = false;
    setTag1Override(null);
    setVerlaufIdx(null);
    setVerlaufSlotMax(0);
    fetch(`/api/pvanlagen/prognose/verlauf?date=${chartDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (ab || !j?.ok) { setVerlaufZeit([]); return; }
        const z: string[] = j.zeitpunkte ?? [];
        setVerlaufZeit(z);
        setVerlaufSlotMax(Number.isFinite(j.slotMax) ? j.slotMax : 0);
        if (z.length > 0) setVerlaufIdx(z.length - 1); // ganz rechts = neuester Stand
      })
      .catch(() => { if (!ab) setVerlaufZeit([]); });
    return () => { ab = true; };
  }, [chartDate]);

  // Bei Slider-Auswahl den zugehoerigen Prognosestand laden und tag1 ersetzen.
  // Steht der Slider auf dem letzten Zeitpunkt, wird der Live-tag1 verwendet
  // (kein Override), damit die Standardanzeige exakt erhalten bleibt.
  const pickVerlauf = (idx: number) => {
    setVerlaufIdx(idx);
    if (verlaufZeit.length === 0) return;
    if (idx >= verlaufZeit.length - 1) { setTag1Override(null); return; }
    const zeitpunkt = verlaufZeit[idx];
    fetch(`/api/pvanlagen/prognose/verlauf?date=${chartDate}&stand=${encodeURIComponent(zeitpunkt)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.ok) return;
        setTag1Override({
          vorhanden: true, updatedAt: zeitpunkt,
          gesamtSlots: j.gesamtSlots ?? [], kwhTotal: j.kwhTotal ?? 0, remainingKwh: 0,
          anlagen: j.anlagen ?? [],
        });
      })
      .catch(() => { /* ignore */ });
  };

  const handleRefresh = () => {
    onRefresh?.();
    setTimeout(() => { loadKpis(); fetchTag(chartDate).then(setTag1); fetchTag(chartDate2).then(setTag2); }, 1200);
  };

  const anlageMetaKpi: Array<{ id: string; name: string }> = [];
  const seenK = new Set<string>();
  for (const t of [heute, morgen]) {
    for (const a of t?.anlagen ?? []) {
      if (!seenK.has(a.anlageId)) { seenK.add(a.anlageId); anlageMetaKpi.push({ id: a.anlageId, name: a.anlageName }); }
    }
  }
  const colorOfKpi = (id: string) => PV_ANLAGE_COLORS[anlageMetaKpi.findIndex((m) => m.id === id) % PV_ANLAGE_COLORS.length];
  const ns = nowSlotIndex();

  const kwhHeute = heute?.kwhTotal ?? 0;
  const restHeute = heute?.remainingKwh ?? 0;
  const kwhMorgen = morgen?.kwhTotal ?? 0;
  const updatedAt = heute?.updatedAt ?? morgen?.updatedAt ?? null;
  const hatKpi = heute?.vorhanden || morgen?.vorhanden;

  const anlageMetaChart: Array<{ id: string; name: string }> = [];
  const seenC = new Set<string>();
  for (const t of [tag1, tag2]) {
    for (const a of t?.anlagen ?? []) {
      if (!seenC.has(a.anlageId)) { seenC.add(a.anlageId); anlageMetaChart.push({ id: a.anlageId, name: a.anlageName }); }
    }
  }
  const colorOfChart = (id: string) => PV_ANLAGE_COLORS[anlageMetaChart.findIndex((m) => m.id === id) % PV_ANLAGE_COLORS.length];
  const hatChartDaten = (tag1?.vorhanden || tag2?.vorhanden);

  return (
    <section className="card pv-forecast">
      <div className="pv-forecast-head">
        <div className="chart-kopf"><h3>Ertragsprognose</h3><ChartDownloadButton dateiname="ertragsprognose" /></div>
        {onRefresh && (
          <button onClick={handleRefresh} disabled={busy}>{busy ? "Rufe ab …" : "Jetzt abrufen"}</button>
        )}
      </div>
      {err && <p className="pv-err">Fehler: {err}</p>}

      {/* Prognoselieferant. Aktuell wird nur forecast.solar unterstützt; das
          Dropdown ist bereits für weitere Anbieter vorbereitet. */}
      <div className="pv-fc-anbieter">
        <label>
          Prognoselieferant:{" "}
          <select value="forecast.solar" onChange={() => { /* aktuell nur ein Anbieter */ }}>
            <option value="forecast.solar">forecast.solar</option>
          </select>
        </label>
        <span className="hint">Weitere Anbieter folgen.</span>
      </div>

      {/* Abrufintervall der Prognose – direkt unter der Lieferantenauswahl. */}
      {intervalMin !== null && (
        <div className="pv-fc-interval">
          <label>
            Abruf alle:{" "}
            <input
              type="number"
              className="ek-input"
              min={15}
              max={1440}
              step={5}
              value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
              onBlur={(e) => void saveInterval(Number(e.target.value))}
            />{" "}
            Minuten
          </label>
          <span className="hint">
            Wie oft die Prognose bei forecast.solar abgerufen wird (min. 15,
            Standard 90). Ein größeres Intervall schont das kostenlose Kontingent.
          </span>
          {intervalSaved && <span className="viz-saved">gespeichert ✓</span>}
        </div>
      )}

      {hatKpi && (
        <div className="pv-fc-kpis">
          <div className="pv-kpi"><span className="pv-kpi-val">{nf(kwhHeute, 1)} kWh</span><span className="pv-kpi-lbl">Prognose heute</span></div>
          <div className="pv-kpi"><span className="pv-kpi-val">{nf(restHeute, 1)} kWh</span><span className="pv-kpi-lbl">verbleibend heute</span></div>
          <div className="pv-kpi"><span className="pv-kpi-val">{nf(kwhMorgen, 1)} kWh</span><span className="pv-kpi-lbl">Prognose morgen</span></div>
        </div>
      )}

      {hatKpi && anlageMetaKpi.length > 0 && (
        <div className="pv-fc-anlagen">
          {anlageMetaKpi.map((m) => {
            const ah = heute?.anlagen.find((x) => x.anlageId === m.id);
            const am = morgen?.anlagen.find((x) => x.anlageId === m.id);
            const h = ah?.kwhTotal ?? 0;
            const rest = ah ? restAusSlots(ah.slots, ns) : 0;
            const mo = am?.kwhTotal ?? 0;
            return (
              <div key={m.id} className="pv-fc-anlage-row">
                <span className="pv-legend-dot" style={{ background: colorOfKpi(m.id) }} />
                <span className="pv-fc-anlage-name">{m.name}</span>
                <span className="pv-fc-anlage-vals">
                  heute <strong>{nf(h, 1)}</strong> &bull; Rest <strong>{nf(rest, 1)}</strong> &bull; morgen <strong>{nf(mo, 1)}</strong> kWh
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="hint">
        {hatKpi
          ? <>Zuletzt abgerufen: {updatedAt ? new Date(updatedAt).toLocaleString("de-DE") : "—"}. Die Prognose wird stündlich automatisch aktualisiert.</>
          : <>Noch keine Prognose gespeichert. Sie wird stündlich automatisch abgerufen, sobald Anlagen mit Standort hinterlegt sind{onRefresh ? " – oder sofort über „Jetzt abrufen“" : ""}.</>}
      </p>

      {/* Einstellung: Prognose an reale Produktion anpassen (persistiert) */}
      <div className="pv-skal-box">
        <label className="pv-skal-toggle">
          <input type="checkbox" checked={skalAktiv} onChange={(e) => toggleSkal(e.target.checked)} />
          <span>Prognose an reale Produktion anpassen</span>
          {skal?.vorhanden && (
            <span className={"pv-anpassen-badge" + (skal.prozent >= 0 ? " pos" : " neg")}>{skal.prozent >= 0 ? "+" : ""}{skal.prozent}%</span>
          )}
        </label>
        <p className="hint pv-skal-erklaerung">
          Die Wettervorhersage von forecast.solar trifft nicht immer exakt zu. Ist diese
          Option aktiv, wird die Prognose fortlaufend an die tatsächlich gemessene
          Erzeugung angepasst: Aus dem Verhältnis von realem zu prognostiziertem Ertrag
          über den bisherigen Tagesverlauf und den Vortag – nur über Viertelstunden mit
          erfasster Erzeugung – wird ein Faktor gebildet und auf den restlichen Tag
          angewandt. So lässt sich der noch zu erwartende Ertrag realistischer abschätzen.
          Der Faktor ist auf −70 % bis +300 % begrenzt. Die Anpassung wirkt auf die
          Rest-Prognose (auch auf der Übersichtsseite) und auf die gestrichelte Linie im
          PV-Ertrag-Tagesverlauf.
        </p>
        <p className="hint pv-skal-erklaerung">
          Die oben angezeigten Werte (KPIs und Ertragszeilen je Anlage) sind die
          <strong> unskalierten Rohdaten</strong>, die forecast.solar liefert – unabhängig
          davon, ob diese Option aktiv ist.
        </p>
      </div>

      <div className="block-head" style={{ marginTop: 8 }}>
        <div className="pv-fc-controls">
          <DateNav value={chartDate} onChange={setChartDate} label="Tag" max={isoToday()} />
        </div>
      </div>
      {!hatChartDaten && (
        <p className="hint">
          Für {ddmm(chartDate)} und {ddmm(chartDate2)} liegt keine gespeicherte Prognose vor.
          Die Prognose wird stündlich abgerufen (heute und morgen); für zurückliegende
          Tage nur, sofern sie damals gespeichert wurde.
        </p>
      )}
      {hatChartDaten && (
        <TwoDayChart
          date1={chartDate} date2={chartDate2}
          tag1={tag1Override ?? tag1} tag2={tag2}
          einheit={einheit} setEinheit={setEinheit}
          anlageMeta={anlageMetaChart} colorOf={colorOfChart}
          yMaxKwh={verlaufSlotMax > 0 ? verlaufSlotMax : undefined}
        />
      )}
      {hatChartDaten && verlaufZeit.length > 1 && verlaufIdx != null && (
        <PrognoseVerlaufSlider
          date={chartDate}
          zeitpunkte={verlaufZeit}
          idx={verlaufIdx}
          onPick={pickVerlauf}
        />
      )}
    </section>
  );
}

// Slider ueber die halbe Chart-Breite, der die 24 Stunden des ERSTEN
// dargestellten Tages abbildet (0-24 h). Die Marker zeigen, zu welchen
// Uhrzeiten es an diesem Tag eine neue (veraenderte) Prognose gab. Durch
// Verschieben waehlt man den anzuzeigenden Prognosestand.
function PrognoseVerlaufSlider({
  date, zeitpunkte, idx, onPick,
}: {
  date: string; zeitpunkte: string[]; idx: number; onPick: (idx: number) => void;
}) {
  // Minute (0..1440) eines ISO-Zeitpunkts bezogen auf den dargestellten Tag.
  const minuteVon = (iso: string): number => {
    const d = new Date(iso);
    const base = new Date(date + "T00:00:00");
    const m = (d.getTime() - base.getTime()) / 60_000;
    return Math.max(0, Math.min(1440, m));
  };
  const stundeVon = (iso: string): number => minuteVon(iso) / 60;
  const gewaehlt = zeitpunkte[idx];
  const fmtUhr = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  // Slider läuft über die Uhrzeit-Achse (Minuten); Einrasten auf nächsten Zeitpunkt.
  const minuten = zeitpunkte.map(minuteVon);
  const nearestIdx = (minute: number): number => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < minuten.length; i++) {
      const d = Math.abs(minuten[i] - minute);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const sliderMinute = idx >= 0 && idx < minuten.length ? minuten[idx] : 0;
  return (
    <div className="pv-verlauf">
      <div className="pv-verlauf-head">
        <span className="hint">Prognose-Verlauf (erster Tag):</span>
        <strong>{gewaehlt ? fmtUhr(gewaehlt) : "–"} Uhr</strong>
        {idx >= zeitpunkte.length - 1 && <span className="pv-verlauf-tag">neuester Stand</span>}
      </div>
      <div className="pv-verlauf-track">
        {/* Marker fuer jeden Prognose-Zeitpunkt an seiner Uhrzeit-Position */}
        {zeitpunkte.map((z, i) => (
          <span
            key={z}
            className={`pv-verlauf-mark${i === idx ? " sel" : ""}`}
            style={{ left: `${(stundeVon(z) / 24) * 100}%` }}
            title={`${fmtUhr(z)} Uhr`}
            onClick={() => onPick(i)}
          />
        ))}
        {/* Range über die Uhrzeit (Minuten). Einrasten auf nächsten Zeitpunkt. */}
        <input
          type="range"
          className="pv-verlauf-range"
          min={0}
          max={1440}
          step={1}
          value={sliderMinute}
          onChange={(e) => onPick(nearestIdx(Number(e.target.value)))}
        />
      </div>
      <div className="pv-verlauf-scale">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>24 h</span>
      </div>
    </div>
  );
}

function TwoDayChart({
  date1, date2, tag1, tag2, einheit, setEinheit, anlageMeta, colorOf, yMaxKwh,
}: {
  date1: string; date2: string;
  tag1: StoredTag | null; tag2: StoredTag | null;
  einheit: EnergieEinheit;
  setEinheit: (e: EnergieEinheit) => void;
  anlageMeta: Array<{ id: string; name: string }>;
  colorOf: (id: string) => string;
  yMaxKwh?: number;
}) {
  const W = 760, H = 300, padL = 52, padR = 12, padT = 14, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const cv = (kwh: number) => convertEnergie(kwh, einheit);
  const N = 192;
  const barW = plotW / N;

  const anlageSlot = (id: string, globalSlot: number): number => {
    const tag = globalSlot < 96 ? tag1 : tag2;
    const s = globalSlot % 96;
    const a = tag?.anlagen.find((x) => x.anlageId === id);
    return a?.slots[s] ?? 0;
  };
  const stackSum = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (const m of anlageMeta) sum += anlageSlot(m.id, i);
    stackSum[i] = sum;
  }
  const stackMax = Math.max(...stackSum);
  const maxKwh = Math.max(0.0001, yMaxKwh != null && yMaxKwh > 0 ? Math.max(yMaxKwh, stackMax) : stackMax);
  const scale = niceScale(cv(maxKwh));
  const dispMax = scale.max;
  const yOf = (vDisp: number) => padT + (1 - vDisp / dispMax) * plotH;

  const kwh1 = tag1?.kwhTotal ?? 0;
  const kwh2 = tag2?.kwhTotal ?? 0;

  const labelForSlot = (i: number): string => {
    const s = i % 96;
    const h = Math.floor(s / 4), m = (s % 4) * 15;
    const tag = i < 96 ? ddmm(date1) : ddmm(date2);
    const hh = String(h).padStart(2, "0"), mm = String(m).padStart(2, "0");
    const end = m === 45 ? `${String(h + 1).padStart(2, "0")}:00` : `${hh}:${String(m + 15).padStart(2, "0")}`;
    return `${tag} ${hh}:${mm}–${end}`;
  };

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <div className="chart-legend pv-fc-legend">
          {anlageMeta.map((m) => (
            <span key={m.id} className="pv-legend-item">
              <span className="pv-legend-dot" style={{ background: colorOf(m.id) }} />{m.name}
            </span>
          ))}
        </div>
        <div className="chart-unit-switch">
          <button type="button" className={einheit === "kwh" ? "active" : ""} onClick={() => setEinheit("kwh")}>kWh</button>
          <button type="button" className={einheit === "w" ? "active" : ""} onClick={() => setEinheit("w")}>W</button>
        </div>
      </div>
      <div className="chart-plot">
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
            <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">{fmtTick(t, einheit)}</text>
          </g>
        ))}
        <text x={14} y={padT + plotH / 2} className="tv-axis-title" textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>
          {einheit === "w" ? "Ø-Leistung (W)" : "Ertrag (kWh)"}
        </text>
        {Array.from({ length: N }, (_, i) => {
          let acc = 0;
          return (
            <g key={i}>
              {anlageMeta.map((m) => {
                const v = anlageSlot(m.id, i);
                if (v <= 0) return null;
                const yTop = yOf(cv(acc + v));
                const yBot = yOf(cv(acc));
                acc += v;
                return (
                  <rect key={m.id} x={padL + i * barW + 0.15} y={yTop}
                    width={Math.max(barW - 0.3, 0.3)} height={Math.max(yBot - yTop, 0.2)}
                    fill={colorOf(m.id)} />
                );
              })}
            </g>
          );
        })}
        <line x1={padL + plotW / 2} y1={padT} x2={padL + plotW / 2} y2={padT + plotH} stroke="#999" strokeDasharray="3 3" />
        {[0, 1].map((tg) => (
          [0, 6, 12, 18].map((h) => (
            <text key={`${tg}-${h}`} x={padL + (tg * 96 + (h / 24) * 96) * barW} y={padT + plotH + 14}
              className="tv-axis" textAnchor="middle">{String(h).padStart(2, "0")}</text>
          ))
        ))}
        <text x={padL + plotW * 0.25} y={H - 6} className="tv-axis-title" textAnchor="middle">
          {ddmm(date1)} {tag1?.vorhanden ? `· ${nf(kwh1, 1)} kWh` : "· keine Prognose"}
        </text>
        <text x={padL + plotW * 0.75} y={H - 6} className="tv-axis-title" textAnchor="middle">
          {ddmm(date2)} {tag2?.vorhanden ? `· ${nf(kwh2, 1)} kWh` : "· keine Prognose"}
        </text>
      </svg>
      <ChartHoverLayer
        svgW={W}
        plotL={padL}
        plotW={plotW}
        count={N}
        tooltipTop={8}
        labelForSlot={labelForSlot}
        rowsForSlot={(i) => {
          const rows = anlageMeta
            .map((m) => ({ m, v: anlageSlot(m.id, i) }))
            .filter((x) => x.v > 0)
            .map((x) => ({
              label: x.m.name,
              value: `${nf(cv(x.v), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`,
              color: colorOf(x.m.id),
            }));
          const sum = anlageMeta.reduce((a, m) => a + anlageSlot(m.id, i), 0);
          if (rows.length > 1) rows.push({ label: "Summe", value: `${nf(cv(sum), einheit === "w" ? 0 : 3)} ${einheitLabel(einheit)}`, color: "#333" });
          return rows;
        }}
      />
      </div>
    </div>
  );
}
