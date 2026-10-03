// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useMemo } from "react";
import { ChartDownloadButton } from "./ChartDownloadButton";

interface EvccSession {
  created: string; finished: string; loadpoint: string; vehicle: string;
  chargedEnergy: number; chargeDurationS?: number; solarPercentage?: number;
  price?: number; avgPowerW?: number;
}

interface EvccDev {
  sourceId: string; label: string; ok: boolean; error?: string;
  title?: string; mode?: string; connected?: boolean; charging?: boolean;
  chargePower?: number; chargedEnergy?: number; sessionEnergy?: number;
  vehicleSoc?: number; vehicleRange?: number; vehicleTitle?: string;
  limitSoc?: number; phasesActive?: number; chargeDuration?: number;
  chargeRemainingDuration?: number;
  phasesConfigured?: number; minCurrent?: number; maxCurrent?: number;
}

const MODI: Array<{ v: string; l: string }> = [
  { v: "off", l: "Aus" },
  { v: "pv", l: "PV" },
  { v: "minpv", l: "Min+PV" },
  { v: "now", l: "Schnell" },
];

// --- Ladehistorie: Barchart (Sonne/Netz), Detailtabelle, Spinnendiagramm ---
function LadehistorieBlock() {
  const [sessions, setSessions] = useState<EvccSession[]>([]);
  const [laden, setLaden] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ebene, setEbene] = useState<"monat" | "jahr" | "gesamt">("monat");
  const [jahr, setJahr] = useState<number>(new Date().getFullYear());
  const [monat, setMonat] = useState<number>(new Date().getMonth()); // 0-basiert
  const [sichtbar, setSichtbar] = useState({ sonne: true, netz: true });
  const [hover, setHover] = useState<{ x: number; label: string; sonne: number; netz: number } | null>(null);

  useEffect(() => {
    fetch("/api/evcc/sessions").then((r) => r.json()).then((j) => {
      if (j.ok) setSessions(j.sessions ?? []);
      else setFehler(j.error ?? "Historie nicht verfügbar");
      setLaden(false);
    }).catch(() => { setFehler("Historie nicht verfügbar"); setLaden(false); });
  }, []);

  // Verfügbare Jahre aus den Daten.
  const jahre = useMemo(() => {
    const set = new Set<number>();
    for (const s of sessions) { const d = new Date(s.created); if (!isNaN(d.getTime())) set.add(d.getFullYear()); }
    return [...set].sort((a, b) => b - a);
  }, [sessions]);

  // Kennzahl-Helfer: Sonne-/Netz-Anteil einer Session in kWh.
  const sonneKwh = (s: EvccSession) => s.chargedEnergy * ((s.solarPercentage ?? 0) / 100);
  const netzKwh = (s: EvccSession) => s.chargedEnergy * (1 - (s.solarPercentage ?? 0) / 100);

  // Balken-Daten je nach Ebene.
  const balken = useMemo(() => {
    if (ebene === "monat") {
      // Ein Balken je Tag des gewählten Monats.
      const tage = new Date(jahr, monat + 1, 0).getDate();
      const arr = Array.from({ length: tage }, (_, i) => ({ label: String(i + 1), sonne: 0, netz: 0 }));
      for (const s of sessions) {
        const d = new Date(s.created);
        if (d.getFullYear() === jahr && d.getMonth() === monat) {
          const idx = d.getDate() - 1;
          arr[idx].sonne += sonneKwh(s); arr[idx].netz += netzKwh(s);
        }
      }
      return arr;
    }
    if (ebene === "jahr") {
      // Ein Balken je Monat des gewählten Jahres.
      const namen = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
      const arr = namen.map((n) => ({ label: n, sonne: 0, netz: 0 }));
      for (const s of sessions) {
        const d = new Date(s.created);
        if (d.getFullYear() === jahr) { arr[d.getMonth()].sonne += sonneKwh(s); arr[d.getMonth()].netz += netzKwh(s); }
      }
      return arr;
    }
    // Gesamt: ein Balken je Jahr.
    const proJahr = new Map<number, { sonne: number; netz: number }>();
    for (const s of sessions) {
      const d = new Date(s.created); const y = d.getFullYear();
      if (!proJahr.has(y)) proJahr.set(y, { sonne: 0, netz: 0 });
      const e = proJahr.get(y)!; e.sonne += sonneKwh(s); e.netz += netzKwh(s);
    }
    return [...proJahr.keys()].sort().map((y) => ({ label: String(y), sonne: proJahr.get(y)!.sonne, netz: proJahr.get(y)!.netz }));
  }, [sessions, ebene, jahr, monat]);

  // Einzelsitzungen des gewählten Monats (für die Tabelle).
  const monatsSessions = useMemo(() => {
    return sessions.filter((s) => { const d = new Date(s.created); return d.getFullYear() === jahr && d.getMonth() === monat; })
      .sort((a, b) => a.created.localeCompare(b.created));
  }, [sessions, jahr, monat]);

  // Summen für die Tabelle.
  const summe = useMemo(() => {
    let kwh = 0, sonne = 0, kosten = 0, dauer = 0;
    for (const s of monatsSessions) { kwh += s.chargedEnergy; sonne += sonneKwh(s); kosten += s.price ?? 0; dauer += s.chargeDurationS ?? 0; }
    return { kwh, sonne, kosten, dauer, sonneAnteil: kwh > 0 ? (sonne / kwh) * 100 : 0 };
  }, [monatsSessions]);

  const fmtDauer = (s?: number) => { if (!s || s <= 0) return "–"; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h > 0 ? `${h}:${String(m).padStart(2, "0")} h` : `${m} min`; };
  const fmtZeit = (iso: string) => { try { return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };
  const monatsName = (m: number) => ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][m];

  if (laden) return <div className="card"><h3>Ladehistorie</h3><p className="hint">lädt …</p></div>;
  if (fehler) return <div className="card"><h3>Ladehistorie</h3><p className="hint">{fehler}</p></div>;
  if (sessions.length === 0) return <div className="card"><h3>Ladehistorie</h3><p className="hint">Noch keine Ladevorgänge aufgezeichnet.</p></div>;

  // Barchart-Geometrie
  const W = 900, H = 300, padL = 44, padR = 16, padT = 16, padB = 40;
  const maxVal = Math.max(0.1, ...balken.map((b) => (sichtbar.sonne ? b.sonne : 0) + (sichtbar.netz ? b.netz : 0)));
  const bw = balken.length > 0 ? (W - padL - padR) / balken.length : 0;
  const yOf = (v: number) => padT + (1 - v / maxVal) * (H - padT - padB);

  return (
    <div className="card">
      <div className="chart-kopf">
        <h3>Ladehistorie</h3>
        <ChartDownloadButton dateiname="ladehistorie" />
      </div>

      {/* Ebenen-Auswahl */}
      <div className="ev-hist-controls">
        <div className="ww-range-btns">
          <button className={`ww-range-btn${ebene === "monat" ? " active" : ""}`} onClick={() => setEbene("monat")}>Monat</button>
          <button className={`ww-range-btn${ebene === "jahr" ? " active" : ""}`} onClick={() => setEbene("jahr")}>Jahr</button>
          <button className={`ww-range-btn${ebene === "gesamt" ? " active" : ""}`} onClick={() => setEbene("gesamt")}>Gesamt</button>
        </div>
        {ebene !== "gesamt" && (
          <div className="ww-nav">
            <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
              {jahre.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {ebene === "monat" && (
              <select value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{monatsName(m)}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Legende (klickbar zum Ein-/Ausblenden) */}
      <div className="ev-hist-legende">
        <button className={`ev-legend-btn${sichtbar.sonne ? "" : " aus"}`} onClick={() => setSichtbar((s) => ({ ...s, sonne: !s.sonne }))}>
          <span className="ev-legend-dot" style={{ background: "#e8a13a" }} /> Sonne
        </button>
        <button className={`ev-legend-btn${sichtbar.netz ? "" : " aus"}`} onClick={() => setSichtbar((s) => ({ ...s, netz: !s.netz }))}>
          <span className="ev-legend-dot" style={{ background: "#5a7fa5" }} /> Netz
        </button>
      </div>

      {/* Barchart (gestapelt Sonne/Netz) mit Tooltip */}
      <div className="ww-chart-wrap" style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="ww-chart-svg" preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = maxVal * f; const y = yOf(v);
            return <g key={f}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f5" /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#889">{v.toFixed(0)}</text></g>;
          })}
          {balken.map((b, i) => {
            const x = padL + i * bw + bw * 0.15;
            const w = bw * 0.7;
            const sv = sichtbar.sonne ? b.sonne : 0;
            const nv = sichtbar.netz ? b.netz : 0;
            const hSonne = (sv / maxVal) * (H - padT - padB);
            const hNetz = (nv / maxVal) * (H - padT - padB);
            const yNetz = yOf(nv);
            const ySonne = yOf(nv + sv);
            const zeigLabel = balken.length <= 16 || i % Math.ceil(balken.length / 16) === 0;
            return (
              <g key={i} onMouseEnter={() => setHover({ x: x + w / 2, label: b.label, sonne: b.sonne, netz: b.netz })}>
                {/* transparente Hover-Fläche über die volle Höhe */}
                <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
                {hNetz > 0 && <rect x={x} y={yNetz} width={w} height={hNetz} fill="#5a7fa5" />}
                {hSonne > 0 && <rect x={x} y={ySonne} width={w} height={hSonne} fill="#e8a13a" />}
                {zeigLabel && <text x={x + w / 2} y={H - padB + 14} textAnchor="middle" fontSize="10" fill="#889">{b.label}</text>}
              </g>
            );
          })}
          {hover && <line x1={hover.x} y1={padT} x2={hover.x} y2={H - padB} stroke="#bbb" strokeDasharray="3 3" />}
          <text x={12} y={padT + (H - padT - padB) / 2} textAnchor="middle" fontSize="10" fill="#889" transform={`rotate(-90 12 ${padT + (H - padT - padB) / 2})`}>kWh</text>
        </svg>
        {hover && (
          <div className="ww-tooltip" style={{ left: `${(hover.x / W) * 100}%` }}>
            <div className="ww-tooltip-t">{hover.label}</div>
            {sichtbar.sonne && <div className="ww-tooltip-row"><span className="ev-legend-dot" style={{ background: "#e8a13a" }} />Sonne: <b>{hover.sonne.toFixed(1)} kWh</b></div>}
            {sichtbar.netz && <div className="ww-tooltip-row"><span className="ev-legend-dot" style={{ background: "#5a7fa5" }} />Netz: <b>{hover.netz.toFixed(1)} kWh</b></div>}
            <div className="ww-tooltip-row">Gesamt: <b>{(hover.sonne + hover.netz).toFixed(1)} kWh</b>{hover.sonne + hover.netz > 0 ? ` · ${Math.round(hover.sonne / (hover.sonne + hover.netz) * 100)}% Sonne` : ""}</div>
          </div>
        )}
      </div>

      {/* Jahresansicht: Spinnendiagramm Sonnenanteil je Monat.
          Gesamtansicht: alle Jahre übereinander, je Jahr eine Farbe. */}
      {ebene === "jahr" && <SpinneSonnenanteil sessions={sessions} jahre={[jahr]} />}
      {ebene === "gesamt" && jahre.length > 0 && <SpinneSonnenanteil sessions={sessions} jahre={[...jahre].sort((a, b) => a - b)} />}

      {/* Monatsansicht: Detailtabelle aller Einzelladungen */}
      {ebene === "monat" && (
        <div className="ev-tabelle-wrap">
          <h4>Einzelne Ladevorgänge – {monatsName(monat)} {jahr}</h4>
          {monatsSessions.length === 0 ? (
            <p className="hint">Keine Ladevorgänge in diesem Monat.</p>
          ) : (
            <div className="table-scroll">
              <table className="ev-tabelle">
                <thead><tr><th>Ladebeginn</th><th>Geladen</th><th>Sonne</th><th>Kosten</th><th>Dauer</th><th>Ø Leistung</th></tr></thead>
                <tbody>
                  {monatsSessions.map((s, i) => (
                    <tr key={i}>
                      <td>{fmtZeit(s.created)}</td>
                      <td>{s.chargedEnergy.toFixed(1)} kWh</td>
                      <td>{s.solarPercentage != null ? `${Math.round(s.solarPercentage)} %` : "–"}</td>
                      <td>{s.price != null ? `${s.price.toFixed(2)} €` : "–"}</td>
                      <td>{fmtDauer(s.chargeDurationS)}</td>
                      <td>{s.avgPowerW != null ? `${(s.avgPowerW / 1000).toFixed(1)} kW` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><b>Summe ({monatsSessions.length})</b></td>
                    <td><b>{summe.kwh.toFixed(1)} kWh</b></td>
                    <td><b>{Math.round(summe.sonneAnteil)} %</b></td>
                    <td><b>{summe.kosten > 0 ? `${summe.kosten.toFixed(2)} €` : "–"}</b></td>
                    <td><b>{fmtDauer(summe.dauer)}</b></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Spinnendiagramm: Sonnenanteil je Monat. Ein oder mehrere Jahre (je Farbe).
function SpinneSonnenanteil({ sessions, jahre }: { sessions: EvccSession[]; jahre: number[] }) {
  const namen = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const farben = ["#e8a13a", "#5a7fa5", "#5aa469", "#d9534f", "#8e6fb0", "#4aa6b8", "#c9803a", "#7a8a3a"];
  const [ausgeblendet, setAusgeblendet] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number; monat: number; eintraege: Array<{ jahr: number; wert: number; farbe: string }> } | null>(null);
  const proJahr = useMemo(() => {
    return jahre.map((jahr) => {
      const sonne = new Array(12).fill(0); const gesamt = new Array(12).fill(0);
      for (const s of sessions) {
        const d = new Date(s.created);
        if (d.getFullYear() !== jahr) continue;
        const m = d.getMonth();
        sonne[m] += s.chargedEnergy * ((s.solarPercentage ?? 0) / 100);
        gesamt[m] += s.chargedEnergy;
      }
      return { jahr, werte: namen.map((_, m) => gesamt[m] > 0 ? (sonne[m] / gesamt[m]) * 100 : 0) };
    });
  }, [sessions, jahre]);

  const size = 300, cx = size / 2, cy = size / 2, r = size / 2 - 40;
  const punkt = (m: number, val: number) => {
    const winkel = (m / 12) * 2 * Math.PI - Math.PI / 2;
    const rad = (val / 100) * r;
    return { x: cx + rad * Math.cos(winkel), y: cy + rad * Math.sin(winkel) };
  };
  const achsePunkt = (m: number, faktor = 1) => {
    const winkel = (m / 12) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + r * faktor * Math.cos(winkel), y: cy + r * faktor * Math.sin(winkel) };
  };
  const mehrere = proJahr.length > 1;

  return (
    <div className="ev-spinne-wrap">
      <div className="chart-kopf">
        <h4>Sonnenanteil je Monat{mehrere ? "" : ` – ${jahre[0]}`}</h4>
        <ChartDownloadButton dateiname={`sonnenanteil-${mehrere ? "gesamt" : jahre[0]}`} />
      </div>
      {mehrere && (
        <div className="ev-hist-legende">
          {proJahr.map((pj, i) => (
            <button key={pj.jahr} className={`ev-legend-btn${ausgeblendet.has(pj.jahr) ? " aus" : ""}`}
              onClick={() => setAusgeblendet((prev) => { const n = new Set(prev); n.has(pj.jahr) ? n.delete(pj.jahr) : n.add(pj.jahr); return n; })}>
              <span className="ev-legend-dot" style={{ background: farben[i % farben.length] }} /> {pj.jahr}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="ev-spinne" preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHover(null)}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <circle key={f} cx={cx} cy={cy} r={r * f} fill="none" stroke="#eef1f5" />
          ))}
          {namen.map((n, m) => {
            const a = achsePunkt(m); const l = achsePunkt(m, 1.12);
            // unsichtbare Hover-Fläche entlang der Achse für den Tooltip
            const eintraege = proJahr
              .filter((pj) => !ausgeblendet.has(pj.jahr))
              .map((pj, idx) => ({ jahr: pj.jahr, wert: pj.werte[m], farbe: farben[proJahr.indexOf(pj) % farben.length] }));
            return (
              <g key={m} onMouseEnter={() => setHover({ x: l.x, y: l.y, monat: m, eintraege })}>
                <line x1={cx} y1={cy} x2={a.x} y2={a.y} stroke="#eef1f5" />
                <line x1={cx} y1={cy} x2={a.x} y2={a.y} stroke="transparent" strokeWidth="16" />
                <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#889">{n}</text>
              </g>
            );
          })}
          {proJahr.map((pj, i) => {
            if (ausgeblendet.has(pj.jahr)) return null;
            const farbe = farben[i % farben.length];
            const polygon = pj.werte.map((v, m) => { const p = punkt(m, v); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ");
            return (
              <g key={pj.jahr}>
                <polygon points={polygon} fill={mehrere ? "none" : "rgba(232,161,58,0.25)"} stroke={farbe} strokeWidth="1.6" />
                {pj.werte.map((v, m) => { const p = punkt(m, v); return v > 0 ? <circle key={m} cx={p.x} cy={p.y} r={2.5} fill={farbe} /> : null; })}
              </g>
            );
          })}
          <text x={cx} y={cy - r - 24} textAnchor="middle" fontSize="10" fill="#aaa">100%</text>
        </svg>
        {hover && hover.eintraege.length > 0 && (
          <div className="ww-tooltip" style={{ left: `${(hover.x / size) * 100}%`, top: `${(hover.y / size) * 100}%` }}>
            <div className="ww-tooltip-t">{["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][hover.monat]}</div>
            {hover.eintraege.map((e) => (
              <div key={e.jahr} className="ww-tooltip-row"><span className="ev-legend-dot" style={{ background: e.farbe }} />{mehrere ? `${e.jahr}: ` : "Sonnenanteil: "}<b>{e.wert > 0 ? `${Math.round(e.wert)} %` : "–"}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ElektroautoPage() {
  const [devs, setDevs] = useState<EvccDev[]>([]);
  const [laden, setLaden] = useState(true);
  const [limitEingabe, setLimitEingabe] = useState<Record<string, number>>({});
  const [minEingabe, setMinEingabe] = useState<Record<string, number>>({});
  const [maxEingabe, setMaxEingabe] = useState<Record<string, number>>({});

  const load = () => {
    fetch("/api/evcc/devices").then((r) => r.json()).then((j) => {
      if (j.ok) setDevs(j.devices ?? []);
      setLaden(false);
    }).catch(() => setLaden(false));
  };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const setMode = (sourceId: string, mode: string) => {
    setDevs((ds) => ds.map((d) => d.sourceId === sourceId ? { ...d, mode } : d));
    fetch("/api/evcc/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, mode }) })
      .then(() => setTimeout(load, 1500)).catch(() => {});
  };
  const setLimit = (sourceId: string, soc: number) => {
    fetch("/api/evcc/limitsoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, soc }) })
      .then(() => setTimeout(load, 1500)).catch(() => {});
  };
  const setMinStrom = (sourceId: string, ampere: number) => {
    fetch("/api/evcc/mincurrent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, ampere }) })
      .then(() => setTimeout(load, 1500)).catch(() => {});
  };
  const setMaxStrom = (sourceId: string, ampere: number) => {
    fetch("/api/evcc/maxcurrent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, ampere }) })
      .then(() => setTimeout(load, 1500)).catch(() => {});
  };
  const setPhasen = (sourceId: string, phasen: number) => {
    setDevs((ds) => ds.map((d) => d.sourceId === sourceId ? { ...d, phasesConfigured: phasen } : d));
    fetch("/api/evcc/phases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, phasen }) })
      .then(() => setTimeout(load, 1500)).catch(() => {});
  };
  // Leistung (kW) aus Ampere und Phasen: A × 230V × Phasenzahl.
  const kwVon = (ampere: number, phasen: number) => (ampere * 230 * (phasen === 1 ? 1 : 3)) / 1000;

  const fmtDauer = (s?: number) => {
    if (s == null || s <= 0) return null;
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
  };

  if (laden) return <div className="page"><h2 className="page-maintitle">Elektroauto</h2><p className="hint">lädt …</p></div>;

  return (
    <div className="page">
      <h2 className="page-maintitle">Elektroauto</h2>
      {devs.length === 0 && <p className="hint">Keine evcc-Quelle konfiguriert.</p>}

      {devs.map((d) => (
        <div key={d.sourceId} className="card ev-card">
          <h3>{d.title || d.label}{d.vehicleTitle ? ` – ${d.vehicleTitle}` : ""}</h3>
          {!d.ok ? (
            <p className="src-error">{d.error ?? "Nicht erreichbar"}</p>
          ) : (
            <>
              {/* Status-Zeile */}
              <div className="ev-status">
                <span className={`ev-badge ${d.connected ? (d.charging ? "laedt" : "verbunden") : "getrennt"}`}>
                  {d.connected ? (d.charging ? "⚡ lädt" : "🔌 verbunden") : "getrennt"}
                </span>
                {d.chargePower != null && d.chargePower > 0 && <span className="ev-kv">Leistung: <b>{(d.chargePower / 1000).toFixed(1)} kW</b></span>}
                {d.phasesActive != null && d.phasesActive > 0 && <span className="ev-kv">{d.phasesActive}-phasig</span>}
              </div>

              {/* Ladestand */}
              {d.vehicleSoc != null && (
                <div className="ev-soc">
                  <div className="ev-soc-bar">
                    <div className="ev-soc-fill" style={{ width: `${d.vehicleSoc}%` }} />
                    {d.limitSoc != null && d.limitSoc > 0 && d.limitSoc < 100 && (
                      <div className="ev-soc-limit" style={{ left: `${d.limitSoc}%` }} title={`Limit ${d.limitSoc}%`} />
                    )}
                  </div>
                  <div className="ev-soc-text">
                    <b>{d.vehicleSoc.toFixed(1)}%</b>{d.vehicleRange != null ? ` · ${d.vehicleRange} km` : ""}
                    {d.limitSoc != null && d.limitSoc > 0 ? ` · Limit ${d.limitSoc}%` : ""}
                  </div>
                </div>
              )}

              {/* Aktuelle Sitzung */}
              {(d.chargedEnergy != null && d.chargedEnergy > 0) && (
                <div className="ev-session">
                  Aktuelle Ladung: <b>{(d.chargedEnergy / 1000).toFixed(1)} kWh</b>
                  {fmtDauer(d.chargeDuration) ? ` in ${fmtDauer(d.chargeDuration)}` : ""}
                </div>
              )}
              {/* Prognostizierte Restdauer bis zum Ladeziel */}
              {d.charging && fmtDauer(d.chargeRemainingDuration) && (
                <div className="ev-session ev-rest">
                  ⏳ Voraussichtlich fertig in <b>~{fmtDauer(d.chargeRemainingDuration)}</b>
                  {(() => {
                    const fertig = new Date(Date.now() + (d.chargeRemainingDuration ?? 0) * 1000);
                    return ` (ca. ${fertig.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr)`;
                  })()}
                </div>
              )}

              {/* Modus-Steuerung */}
              <div className="ev-steuerung">
                <div className="ev-modus">
                  <span className="ev-label">Modus:</span>
                  {MODI.map((m) => (
                    <button key={m.v} className={`ev-modus-btn${d.mode === m.v || (d.mode === "smart" && m.v === "pv") ? " aktiv" : ""}`}
                      onClick={() => setMode(d.sourceId, m.v)}>{m.l}</button>
                  ))}
                </div>
                <div className="ev-limit">
                  <span className="ev-label">Ladelimit:</span>
                  <input type="range" min={0} max={100} step={5}
                    value={limitEingabe[d.sourceId] ?? d.limitSoc ?? 80}
                    onChange={(e) => setLimitEingabe((l) => ({ ...l, [d.sourceId]: Number(e.target.value) }))}
                    onMouseUp={(e) => setLimit(d.sourceId, Number((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => setLimit(d.sourceId, Number((e.target as HTMLInputElement).value))} />
                  <b>{limitEingabe[d.sourceId] ?? d.limitSoc ?? 80}%</b>
                </div>

                {/* Phasen-Umschaltung */}
                <div className="ev-phasen">
                  <span className="ev-label">Phasen:</span>
                  {[{ v: 0, l: "Auto" }, { v: 1, l: "1-phasig" }, { v: 3, l: "3-phasig" }].map((p) => (
                    <button key={p.v} className={`ev-modus-btn${(d.phasesConfigured ?? 0) === p.v ? " aktiv" : ""}`}
                      onClick={() => setPhasen(d.sourceId, p.v)}>{p.l}</button>
                  ))}
                </div>

                {/* Ladestrom-Grenzen mit kW-Anzeige */}
                {(() => {
                  // Phasenzahl für die kW-Rechnung: konfiguriert (1/3) oder aktiv, sonst 3.
                  const ph = d.phasesConfigured === 1 ? 1 : d.phasesConfigured === 3 ? 3 : (d.phasesActive || 3);
                  const minA = minEingabe[d.sourceId] ?? d.minCurrent ?? 6;
                  const maxA = maxEingabe[d.sourceId] ?? d.maxCurrent ?? 16;
                  return (
                    <>
                      <div className="ev-strom">
                        <span className="ev-label">Min. Strom:</span>
                        <input type="range" min={1} max={maxA} step={1} value={minA}
                          onChange={(e) => setMinEingabe((l) => ({ ...l, [d.sourceId]: Number(e.target.value) }))}
                          onMouseUp={(e) => setMinStrom(d.sourceId, Number((e.target as HTMLInputElement).value))}
                          onTouchEnd={(e) => setMinStrom(d.sourceId, Number((e.target as HTMLInputElement).value))} />
                        <b>{minA} A</b><span className="ev-kw">≈ {kwVon(minA, ph).toFixed(1)} kW</span>
                      </div>
                      <div className="ev-strom">
                        <span className="ev-label">Max. Strom:</span>
                        <input type="range" min={minA} max={32} step={1} value={maxA}
                          onChange={(e) => setMaxEingabe((l) => ({ ...l, [d.sourceId]: Number(e.target.value) }))}
                          onMouseUp={(e) => setMaxStrom(d.sourceId, Number((e.target as HTMLInputElement).value))}
                          onTouchEnd={(e) => setMaxStrom(d.sourceId, Number((e.target as HTMLInputElement).value))} />
                        <b>{maxA} A</b><span className="ev-kw">≈ {kwVon(maxA, ph).toFixed(1)} kW</span>
                      </div>
                    </>
                  );
                })()}
              </div>

            </>
          )}
        </div>
      ))}

      {devs.some((d) => d.ok) && <LadehistorieBlock />}
    </div>
  );
}
