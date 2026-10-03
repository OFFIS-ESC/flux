// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useState } from "react";
import { nf } from "./chartUtils";
import { SortableGrid, SortToggle, type SortableItem } from "./SortableGrid";
import { ChartDownloadButton } from "./ChartDownloadButton";

// Kennzahlen-Auswertung der Wärmepumpe über einen wählbaren Zeitraum.
// Zeitraum-Modi: Winter-Saison (Okt–Apr), Tag, Woche, Monat, oder frei.

interface Kpi {
  von: string; bis: string; tage: number;
  kompressorH: number; heizH: number; wwH: number; kuehlH: number;
  energieKwh: number; energieStandbyKwh: number;
  energieHeizKwh: number; energieWwKwh: number; energieKuehlKwh: number;
  energieHeizAnteil: number; energieWwAnteil: number; energieKuehlAnteil: number;
  waermeKwh: number; waermeHeizKwh: number; waermeWwKwh: number; kaelteKwh: number;
  takte: number; abtauungen: number; pvKwh: number;
  heizAnteil: number; wwAnteil: number; pvAnteil: number;
  cop: number | null;
}

interface MonatTag {
  tag: string; label: string;
  energieHeizKwh: number; energieWwKwh: number; energieKuehlKwh: number;
  waermeKwh: number; waermeHeizKwh: number; waermeWwKwh: number; kaelteKwh: number;
  takte: number; abtauungen: number;
  kompressorH: number; energieKwh: number; pvKwh: number; pvAnteil: number;
}

type Modus = "winter" | "tag" | "woche" | "monat" | "frei";
// Welches Diagramm unten angezeigt wird.
type ChartKind = "energie" | "waerme" | "takte" | "abtauungen" | "laufzeit" | "pv";

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function heute(): string { return iso(new Date()); }

function winterBounds(startJahr: number): { von: string; bis: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const lastApr = new Date(startJahr + 1, 4, 0).getDate();
  return { von: `${startJahr}-10-01`, bis: `${startJahr + 1}-04-${p(lastApr)}` };
}
function winterListe(): number[] {
  const now = new Date();
  const base = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return [base, base - 1, base - 2, base - 3];
}

// Farben der Betriebsarten (konsistent über Kacheln und Diagramm).
const COL_HEIZ = "#d9534f";   // Heizen (rot)
const COL_WW = "#f0ad4e";     // Warmwasser (orange)
const COL_KUEHL = "#5bc0de";  // Kühlen (blau)

export function WpKpiBlock() {
  const [modus, setModus] = useState<Modus>("winter");
  const [winterStart, setWinterStart] = useState<number>(winterListe()[0]);
  const [tag, setTag] = useState<string>(heute());
  const [wocheStart, setWocheStart] = useState<string>(() => {
    const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d);
  });
  const [monat, setMonat] = useState<string>(heute().slice(0, 7));
  const [freiVon, setFreiVon] = useState<string>(heute());
  const [freiBis, setFreiBis] = useState<string>(heute());
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);

  // Diagramm-Auswahl (per Kachelklick). "energie" ist das Default-Diagramm.
  const [chart, setChart] = useState<ChartKind>("energie");
  const [sortMode, setSortMode] = useState(false);
  // Monat für die Diagramme (unabhängig vom KPI-Zeitraum wählbar).
  const [chartMonat, setChartMonat] = useState<string>(heute().slice(0, 7));
  const [monatData, setMonatData] = useState<MonatTag[] | null>(null);

  const { von, bis } = useMemo<{ von: string; bis: string }>(() => {
    if (modus === "winter") return winterBounds(winterStart);
    if (modus === "tag") return { von: tag, bis: tag };
    if (modus === "woche") {
      const d = new Date(`${wocheStart}T12:00:00`); d.setDate(d.getDate() + 6);
      return { von: wocheStart, bis: iso(d) };
    }
    if (modus === "monat") {
      const y = Number(monat.slice(0, 4)); const m = Number(monat.slice(5, 7));
      const last = new Date(y, m, 0).getDate();
      return { von: `${monat}-01`, bis: `${monat}-${String(last).padStart(2, "0")}` };
    }
    return { von: freiVon <= freiBis ? freiVon : freiBis, bis: freiBis >= freiVon ? freiBis : freiVon };
  }, [modus, winterStart, tag, wocheStart, monat, freiVon, freiBis]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/waermepumpe/kpi?von=${von}&bis=${bis}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKpi(d))
      .catch(() => setKpi(null))
      .finally(() => setLoading(false));
  }, [von, bis]);

  // Wenn der KPI-Zeitraum ein einzelner Monat ist, den Diagramm-Monat mitführen.
  useEffect(() => {
    if (modus === "monat") setChartMonat(monat);
    else if (modus === "tag") setChartMonat(tag.slice(0, 7));
  }, [modus, monat, tag]);

  // Monatsdaten für das Diagramm laden.
  useEffect(() => {
    fetch(`/api/waermepumpe/kpi/monat?month=${chartMonat}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMonatData(d?.tage ?? null))
      .catch(() => setMonatData(null));
  }, [chartMonat]);

  const fmtRange = (v: string, b: string) => {
    const f = (s: string) => s.split("-").reverse().join(".");
    return v === b ? f(v) : `${f(v)} – ${f(b)}`;
  };

  return (
    <div className="card">
      <div className="chart-kopf"><h3>Kennzahlen-Auswertung</h3><ChartDownloadButton dateiname="wp-kennzahlen" /></div>
      <p className="hint">
        Wichtige Kennzahlen der Wärmepumpe für einen wählbaren Zeitraum. Die
        Tageswerte werden beim Tagesabschluss berechnet und hier zusammengefasst;
        der laufende Tag wird live ergänzt. Ein Klick auf eine Energie-, Wärme-,
        Takt- oder Abtau-Kachel zeigt das passende Monatsdiagramm darunter.
      </p>

      <div className="wpkpi-controls">
        <div className="wpkpi-modus">
          {(["winter", "tag", "woche", "monat", "frei"] as Modus[]).map((m) => (
            <button key={m} className={modus === m ? "active" : ""} onClick={() => setModus(m)}>
              {m === "winter" ? "Heizsaison" : m === "tag" ? "Tag" : m === "woche" ? "Woche" : m === "monat" ? "Monat" : "frei"}
            </button>
          ))}
        </div>
        <div className="wpkpi-range">
          {modus === "winter" && (
            <select value={winterStart} onChange={(e) => setWinterStart(Number(e.target.value))}>
              {winterListe().map((y) => (
                <option key={y} value={y}>Winter {y}/{String((y + 1) % 100).padStart(2, "0")}</option>
              ))}
            </select>
          )}
          {modus === "tag" && <input type="date" value={tag} onChange={(e) => setTag(e.target.value)} />}
          {modus === "woche" && (
            <label>Woche ab <input type="date" value={wocheStart} onChange={(e) => setWocheStart(e.target.value)} /></label>
          )}
          {modus === "monat" && <input type="month" value={monat} onChange={(e) => setMonat(e.target.value)} />}
          {modus === "frei" && (
            <span className="wpkpi-frei">
              <input type="date" value={freiVon} onChange={(e) => setFreiVon(e.target.value)} />
              <span>–</span>
              <input type="date" value={freiBis} onChange={(e) => setFreiBis(e.target.value)} />
            </span>
          )}
        </div>
      </div>

      <p className="wpkpi-zeitraum">Zeitraum: <strong>{fmtRange(von, bis)}</strong>{kpi ? ` · ${kpi.tage} Tage mit Daten` : ""}</p>

      {loading && !kpi && <p className="hint">Berechne Kennzahlen…</p>}
      {kpi && (() => {
        // Energie-Cluster als sortierbare Einheiten; jede enthält ein
        // sortierbares Kachel-Grid. Kühlen nur, wenn relevant.
        const clusterHeizen = (
          <div className="wpkpi-cluster">
            <div className="wpkpi-cluster-titel" style={{ color: COL_HEIZ }}>Heizen</div>
            <SortableGrid bereich="wpkpi-heizen" className="wpkpi-grid" sortMode={sortMode} items={[
              { id: "energieHeiz", node: <Kachel label="Energiebedarf Heizen" wert={nf(kpi.energieHeizKwh, 1)} einheit="kWh" sub={`${nf(kpi.energieHeizAnteil, 0)} %`} active={chart === "energie"} onClick={() => setChart("energie")} /> },
              { id: "waermeHeiz", node: <Kachel label="Abgegebene Wärme (Heizen)" wert={nf(kpi.waermeHeizKwh, 1)} einheit="kWh" active={chart === "waerme"} onClick={() => setChart("waerme")} /> },
            ]} />
          </div>
        );
        const clusterWw = (
          <div className="wpkpi-cluster">
            <div className="wpkpi-cluster-titel" style={{ color: COL_WW }}>Warmwasser</div>
            <SortableGrid bereich="wpkpi-ww" className="wpkpi-grid" sortMode={sortMode} items={[
              { id: "energieWw", node: <Kachel label="Energiebedarf Warmwasser" wert={nf(kpi.energieWwKwh, 1)} einheit="kWh" sub={`${nf(kpi.energieWwAnteil, 0)} %`} active={chart === "energie"} onClick={() => setChart("energie")} /> },
              { id: "waermeWw", node: <Kachel label="Abgegebene Wärme (Warmwasser)" wert={nf(kpi.waermeWwKwh, 1)} einheit="kWh" active={chart === "waerme"} onClick={() => setChart("waerme")} /> },
            ]} />
          </div>
        );
        const clusterKuehl = (kpi.kuehlH > 0 || kpi.energieKuehlKwh > 0 || kpi.kaelteKwh > 0) ? (
          <div className="wpkpi-cluster">
            <div className="wpkpi-cluster-titel" style={{ color: COL_KUEHL }}>Kühlen</div>
            <SortableGrid bereich="wpkpi-kuehl" className="wpkpi-grid" sortMode={sortMode} items={[
              { id: "energieKuehl", node: <Kachel label="Energiebedarf Kühlen" wert={nf(kpi.energieKuehlKwh, 1)} einheit="kWh" sub={`${nf(kpi.energieKuehlAnteil, 0)} %`} active={chart === "energie"} onClick={() => setChart("energie")} /> },
              { id: "kaelte", node: <Kachel label="Abgegebene Kälte (Kühlung)" wert={nf(kpi.kaelteKwh, 1)} einheit="kWh" active={chart === "waerme"} onClick={() => setChart("waerme")} /> },
            ]} />
          </div>
        ) : null;
        const clusterGesamt = (
          <div className="wpkpi-cluster">
            <div className="wpkpi-cluster-titel">Gesamt</div>
            <SortableGrid bereich="wpkpi-gesamt" className="wpkpi-grid" sortMode={sortMode} items={[
              { id: "energieGesamt", node: <Kachel label="Energiebedarf gesamt" wert={nf(kpi.energieKwh, 1)} einheit="kWh" onClick={() => setChart("energie")} active={chart === "energie"} /> },
              { id: "standby", node: <Kachel label="davon Standby" wert={nf(kpi.energieStandbyKwh, 1)} einheit="kWh" sub="< 20 W" /> },
              { id: "waermeGesamt", node: <Kachel label="Abgegebene Wärme (gesamt)" wert={nf(kpi.waermeKwh, 1)} einheit="kWh" active={chart === "waerme"} onClick={() => setChart("waerme")} /> },
              { id: "pvAbdeckung", node: <Kachel label="Abdeckung durch PV" wert={nf(kpi.pvAnteil, 0)} einheit="%" sub={`${nf(kpi.pvKwh, 1)} kWh`} active={chart === "pv"} onClick={() => setChart("pv")} /> },
            ]} />
          </div>
        );
        const clusterItems: SortableItem[] = [
          { id: "heizen", node: clusterHeizen },
          { id: "warmwasser", node: clusterWw },
          ...(clusterKuehl ? [{ id: "kuehlen", node: clusterKuehl }] : []),
          { id: "gesamt", node: clusterGesamt },
        ];
        return (
          <>
            <div className="tile-sort-bar">
              <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} />
            </div>
            {sortMode && <p className="tile-sort-hint">Im Anordnen-Modus: Kacheln innerhalb ihres Bereichs ziehen, ganze Cluster über ihre Überschrift, und die Kompressor-Kacheln separat. Die Anordnung wird gespeichert. Zum Umschalten der Diagramme „Fertig" wählen.</p>}

            {/* Gruppe Energie – Cluster sind untereinander sortierbar */}
            <div className="wpkpi-gruppe">
              <div className="wpkpi-gruppe-titel">Energie</div>
              <SortableGrid bereich="wpkpi-cluster" className="wpkpi-cluster-liste" sortMode={sortMode} items={clusterItems} />
            </div>

            {/* Gruppe Kompressor */}
            <div className="wpkpi-gruppe">
              <div className="wpkpi-gruppe-titel">Kompressor</div>
              <SortableGrid bereich="wpkpi-kompressor" className="wpkpi-grid" sortMode={sortMode} items={[
                { id: "laufzeit", node: <Kachel label="Laufzeit Kompressor" wert={nf(kpi.kompressorH, 1)} einheit="h" active={chart === "laufzeit"} onClick={() => setChart("laufzeit")} /> },
                { id: "anteilHeiz", node: <Kachel label="Anteil Heizbetrieb" wert={nf(kpi.heizAnteil, 0)} einheit="%" sub={`${nf(kpi.heizH, 1)} h`} /> },
                { id: "anteilWw", node: <Kachel label="Anteil Warmwasser" wert={nf(kpi.wwAnteil, 0)} einheit="%" sub={`${nf(kpi.wwH, 1)} h`} /> },
                { id: "cop", node: <Kachel label="COP (Arbeitszahl)" wert={kpi.cop != null ? nf(kpi.cop, 2) : "–"} einheit="" sub="Wärme / Strom" /> },
                { id: "takte", node: <Kachel label="Kompressortakte" wert={nf(kpi.takte, 0)} einheit="" active={chart === "takte"} onClick={() => setChart("takte")} /> },
                { id: "abtauungen", node: <Kachel label="Abtauungen" wert={nf(kpi.abtauungen, 0)} einheit="" active={chart === "abtauungen"} onClick={() => setChart("abtauungen")} /> },
              ]} />
            </div>
          </>
        );
      })()}
      {kpi && (
        <>
          {/* Monats-Diagramm (per Kachelklick umschaltbar) */}
          <div className="wpkpi-chartbox">
            <div className="wpkpi-chart-head">
              <span className="wpkpi-chart-titel">
                {chart === "energie" && "Energieverbrauch je Tag (Heizen / Warmwasser / Kühlen)"}
                {chart === "waerme" && "Abgegebene Wärme/Kälte je Tag"}
                {chart === "takte" && "Kompressortakte je Tag"}
                {chart === "abtauungen" && "Abtauungen je Tag"}
                {chart === "laufzeit" && "Laufzeit Kompressor je Tag"}
                {chart === "pv" && "Abdeckung durch PV je Tag"}
              </span>
              <input type="month" value={chartMonat} onChange={(e) => setChartMonat(e.target.value)} />
            </div>
            {monatData
              ? <MonatChart data={monatData} kind={chart} />
              : <p className="hint">Lade Monatsdaten…</p>}
          </div>
        </>
      )}
    </div>
  );
}

function Kachel({ label, wert, einheit, sub, onClick, active }: {
  label: string; wert: string; einheit: string; sub?: string;
  onClick?: () => void; active?: boolean;
}) {
  const clickable = !!onClick;
  return (
    <div
      className={`wpkpi-kachel${clickable ? " klickbar" : ""}${active ? " aktiv" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      title={clickable ? "Zeigt das zugehörige Monatsdiagramm" : undefined}
    >
      <div className="wpkpi-kachel-label">{label}</div>
      <div className="wpkpi-kachel-wert">{wert}{einheit && <span className="wpkpi-kachel-einheit"> {einheit}</span>}</div>
      {sub && <div className="wpkpi-kachel-sub">{sub}</div>}
    </div>
  );
}

// Monats-Balkendiagramm. Für "energie" gestapelt (Heizen/WW/Kühlen), sonst
// einfaches Balkendiagramm einer Größe.
function MonatChart({ data, kind }: { data: MonatTag[]; kind: ChartKind }) {
  const W = 760, H = 260, padL = 52, padR = 12, padT = 16, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = data.length || 1;
  const slotW = plotW / n;
  const barW = Math.min(slotW * 0.72, 22);
  const [hover, setHover] = useState<number | null>(null);

  // Segmente je Balken je nach Diagrammtyp.
  const segsOf = (t: MonatTag): Array<{ v: number; color: string; name: string }> => {
    if (kind === "energie") return [
      { v: t.energieHeizKwh, color: COL_HEIZ, name: "Heizen" },
      { v: t.energieWwKwh, color: COL_WW, name: "Warmwasser" },
      { v: t.energieKuehlKwh, color: COL_KUEHL, name: "Kühlen" },
    ];
    if (kind === "waerme") return [
      { v: t.waermeHeizKwh, color: COL_HEIZ, name: "Wärme Heizen" },
      { v: t.waermeWwKwh, color: COL_WW, name: "Wärme Warmwasser" },
      { v: t.kaelteKwh, color: COL_KUEHL, name: "Kälte" },
    ];
    if (kind === "takte") return [{ v: t.takte, color: "#5b7fc0", name: "Takte" }];
    if (kind === "abtauungen") return [{ v: t.abtauungen, color: "#8e6fc0", name: "Abtauungen" }];
    if (kind === "laufzeit") return [{ v: t.kompressorH, color: "#4a8f5b", name: "Laufzeit" }];
    // pv: prozentualer Anteil des Energiebedarfs, der durch PV gedeckt wurde
    return [{ v: t.pvAnteil, color: "#e0a500", name: "PV-Deckung" }];
  };
  const totalOf = (t: MonatTag) => segsOf(t).reduce((a, s) => a + s.v, 0);
  // Bei PV ist die Skala fest 0..100 %.
  const maxV = kind === "pv" ? 100 : Math.max(0.0001, ...data.map(totalOf));
  const pow = Math.pow(10, Math.floor(Math.log10(maxV)));
  const dispMax = kind === "pv" ? 100 : (Math.ceil(maxV / pow) * pow || 1);
  const yOf = (v: number) => padT + (1 - v / dispMax) * plotH;
  const baseY = padT + plotH;
  const einheit = (kind === "energie" || kind === "waerme") ? "kWh" : kind === "laufzeit" ? "h" : kind === "pv" ? "%" : "";
  const yTitel = kind === "energie" ? "Energie (kWh)"
    : kind === "waerme" ? "Wärme/Kälte (kWh)"
    : kind === "takte" ? "Takte"
    : kind === "abtauungen" ? "Abtauungen"
    : kind === "laufzeit" ? "Laufzeit (h)"
    : "PV-Deckung (%)";
  const gestapelt = kind === "energie" || kind === "waerme";

  return (
    <div className="cdc-bars-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="cdc-bars" preserveAspectRatio="xMidYMid meet">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = dispMax * f;
          return (
            <g key={i}>
              <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke="#eee" />
              <text x={padL - 6} y={yOf(v) + 4} textAnchor="end" className="tv-axis">{nf(v, v >= 10 ? 0 : 1)}</text>
            </g>
          );
        })}
        {data.map((t, i) => {
          const segs = segsOf(t);
          const xC = padL + slotW * i + slotW / 2;
          const x = padL + slotW * i + (slotW - barW) / 2;
          let yCursor = baseY;
          const rects = segs.filter((s) => s.v > 0).map((s, si) => {
            const h = (s.v / dispMax) * plotH;
            yCursor -= h;
            return <rect key={si} x={x} y={yCursor} width={barW} height={Math.max(0.5, h)} fill={s.color} opacity={hover === i ? 1 : 0.9} />;
          });
          const showLabel = data.length <= 16 || (i % Math.ceil(data.length / 16) === 0);
          const tot = totalOf(t);
          return (
            <g key={t.tag} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + slotW * i} y={padT} width={slotW} height={plotH} fill="transparent" />
              {rects}
              {showLabel && <text x={xC} y={H - padB + 14} textAnchor="middle" className="tv-axis">{t.label}</text>}
              {hover === i && tot > 0 && (
                <text x={xC} y={yOf(tot) - 4} textAnchor="middle" className="tv-axis" fill="#333">
                  {nf(tot, gestapelt || kind === "laufzeit" ? 1 : 0)}{einheit ? ` ${einheit}` : ""}
                </text>
              )}
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" className="tv-axis-title">Tag des Monats</text>
        <text x={14} y={padT + plotH / 2} textAnchor="middle" className="tv-axis-title"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}>{yTitel}</text>
      </svg>
      {gestapelt && (
        <div className="wpkpi-legende">
          <span><i style={{ background: COL_HEIZ }} />{kind === "energie" ? "Heizen" : "Wärme Heizen"}</span>
          <span><i style={{ background: COL_WW }} />{kind === "energie" ? "Warmwasser" : "Wärme Warmwasser"}</span>
          <span><i style={{ background: COL_KUEHL }} />{kind === "energie" ? "Kühlen" : "Kälte"}</span>
        </div>
      )}
    </div>
  );
}
