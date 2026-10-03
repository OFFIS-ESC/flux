// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { ChartDownloadButton } from "./ChartDownloadButton";

interface Kennzahlen {
  zeitraum: string; ebene: "jahr" | "monat"; tageMitDaten: number;
  erzeugung: number; verbrauch: number; netzbezug: number; eingespeist: number;
  pvDirekt: number; speicher: number; eigenverbrauch: number;
  autarkie: number; eigenverbrauchsquote: number; sharing42c: number;
  ertragreichsterTag?: { datum: string; kwh: number };
  verbrauchsreichsterTag?: { datum: string; kwh: number };
  besterAutarkieTag?: { datum: string; autarkie: number };
  ertragreichsterMonat?: { monat: string; kwh: number };
  autoGeladen: number; autoSonne: number; autoSonnenKm?: number;
  co2VermiedenKg: number; co2Geschaetzt: boolean;
  co2NetzEmissionenKg?: number; co2SchnittIntensitaet?: number;
  bereiche?: {
    heizen: { kwh: number; autarkie: number };
    warmwasser: { kwh: number; autarkie: number; wpKwh?: number; heizstabKwh?: number };
    auto: { kwh: number; autarkie: number };
    haushalt: { kwh: number; autarkie: number };
  };
  verlauf: Array<{ label: string; erzeugung: number; verbrauch: number; autarkie: number }>;
}

const fmtKwh = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)} MWh` : `${Math.round(v)} kWh`;
const fmtDatum = (iso: string) => { try { return new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long" }); } catch { return iso; } };

export function RueckblickPage() {
  const [ebene, setEbene] = useState<"jahr" | "monat">("jahr");
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [monat, setMonat] = useState(new Date().getMonth());
  const [jahre, setJahre] = useState<number[]>([]);
  const [k, setK] = useState<Kennzahlen | null>(null);
  const [laden, setLaden] = useState(true);
  const [co2Cfg, setCo2Cfg] = useState<{ tokenGesetzt: boolean; aktuelleIntensitaet: number | null } | null>(null);
  const [co2Gespeichert, setCo2Gespeichert] = useState(false);

  useEffect(() => {
    fetch("/api/co2/config").then((r) => r.json()).then((j) => { if (j.ok) setCo2Cfg({ tokenGesetzt: j.tokenGesetzt, aktuelleIntensitaet: j.aktuelleIntensitaet }); }).catch(() => {});
  }, [co2Gespeichert]);


  useEffect(() => {
    setLaden(true);
    const qs = `ebene=${ebene}&jahr=${jahr}&monat=${monat}`;
    fetch(`/api/rueckblick?${qs}`).then((r) => r.json()).then((j) => {
      if (j.ok) { setK(j.kennzahlen); setJahre(j.jahre ?? []); }
      setLaden(false);
    }).catch(() => setLaden(false));
  }, [ebene, jahr, monat]);

  const monatsName = (m: number) => ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][m];
  const zeitraumText = ebene === "jahr" ? String(jahr) : `${monatsName(monat)} ${jahr}`;

  return (
    <div className="page rb-page">
      <div className="rb-kopf">
        <h2 className="page-maintitle">Energie-Rückblick</h2>
        <div className="rb-controls">
          <div className="ww-range-btns">
            <button className={`ww-range-btn${ebene === "jahr" ? " active" : ""}`} onClick={() => setEbene("jahr")}>Jahr</button>
            <button className={`ww-range-btn${ebene === "monat" ? " active" : ""}`} onClick={() => setEbene("monat")}>Monat</button>
          </div>
          <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {(jahre.length ? jahre : [jahr]).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {ebene === "monat" && (
            <select value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{monatsName(m)}</option>)}
            </select>
          )}
        </div>
      </div>

      {laden ? (
        <p className="hint">lädt …</p>
      ) : !k || k.tageMitDaten === 0 ? (
        <p className="hint">Für {zeitraumText} liegen noch keine Tagesdaten vor.</p>
      ) : (
        <div className="rb-content">
          {/* HERO: die emotionale Kernaussage */}
          <div className="rb-hero">
            <div className="rb-hero-sonne">
              <div className="rb-hero-label">In {zeitraumText} erzeugt</div>
              <div className="rb-hero-zahl">{fmtKwh(k.erzeugung)}</div>
              <div className="rb-hero-sub">Sonnenstrom von deinem Dach</div>
            </div>
            <div className="rb-hero-autarkie">
              <div className="rb-ring" style={{ background: `conic-gradient(#e8a13a ${Math.min(100, k.autarkie) * 3.6}deg, #eef1f5 0)` }}>
                <div className="rb-ring-innen"><b>{Math.round(k.autarkie)}%</b><span>Autarkie</span></div>
              </div>
            </div>
          </div>

          {/* VERBRAUCHSAUFTEILUNG (Donut: außen Anteile, innen Autarkie) */}
          {k.bereiche && (k.bereiche.heizen.kwh + k.bereiche.warmwasser.kwh + k.bereiche.auto.kwh + k.bereiche.haushalt.kwh) > 0 && (
            <div className="card rb-donut-card">
              <div className="chart-kopf"><h3>Wohin ging der Strom?</h3></div>
              {(() => {
                try { return <VerbrauchsDonut bereiche={k.bereiche} gesamt={k.verbrauch} />; }
                catch (e: any) { return <p className="hint" style={{ color: "#c00" }}>Diagramm-Fehler: {String(e?.message ?? e)}</p>; }
              })()}
            </div>
          )}

          {/* HIGHLIGHTS */}
          <div className="rb-highlights">
            {k.ertragreichsterTag && (
              <div className="rb-hl rb-hl-sonne">
                <div className="rb-hl-icon">☀️</div>
                <div className="rb-hl-text"><b>{fmtKwh(k.ertragreichsterTag.kwh)}</b><span>Bester Tag: {fmtDatum(k.ertragreichsterTag.datum)}</span></div>
              </div>
            )}
            {ebene === "jahr" && k.ertragreichsterMonat && (
              <div className="rb-hl rb-hl-sonne">
                <div className="rb-hl-icon">📅</div>
                <div className="rb-hl-text"><b>{k.ertragreichsterMonat.monat}</b><span>Ertragreichster Monat ({fmtKwh(k.ertragreichsterMonat.kwh)})</span></div>
              </div>
            )}
            {k.besterAutarkieTag && (
              <div className="rb-hl rb-hl-gruen">
                <div className="rb-hl-icon">🔋</div>
                <div className="rb-hl-text"><b>{Math.round(k.besterAutarkieTag.autarkie)}% autark</b><span>Bester Autarkie-Tag: {fmtDatum(k.besterAutarkieTag.datum)}</span></div>
              </div>
            )}
            {k.autoGeladen > 0 && (
              <div className="rb-hl rb-hl-auto">
                <div className="rb-hl-icon">🚗</div>
                <div className="rb-hl-text"><b>{fmtKwh(k.autoGeladen)} geladen</b><span>{k.autoSonnenKm ? `≈ ${k.autoSonnenKm} km mit Sonne` : `${Math.round(k.autoSonne / Math.max(1, k.autoGeladen) * 100)}% Sonnenanteil`}</span></div>
              </div>
            )}
            <div className="rb-hl rb-hl-co2">
              <div className="rb-hl-icon">🌱</div>
              <div className="rb-hl-text"><b>{k.co2VermiedenKg >= 1000 ? `${(k.co2VermiedenKg / 1000).toFixed(1)} t` : `${Math.round(k.co2VermiedenKg)} kg`} CO₂</b><span>vermieden{k.co2Geschaetzt ? " (geschätzt)" : ""}</span></div>
            </div>
            {k.sharing42c > 0 && (
              <div className="rb-hl rb-hl-share">
                <div className="rb-hl-icon">🤝</div>
                <div className="rb-hl-text"><b>{fmtKwh(k.sharing42c)}</b><span>an Nachbarn geteilt (§42c)</span></div>
              </div>
            )}
          </div>

          {/* VERLAUF-CHART */}
          <div className="card rb-chart-card">
            <div className="chart-kopf">
              <h3>Erzeugung &amp; Verbrauch je {ebene === "jahr" ? "Monat" : "Tag"}</h3>
              <ChartDownloadButton dateiname={`rueckblick-${k.zeitraum}`} />
            </div>
            <VerlaufChart verlauf={k.verlauf} />
          </div>

          {/* SACHLICHE DETAILS */}
          <div className="card">
            <h3>Details</h3>
            <div className="rb-details">
              <div className="rb-detail"><span>PV-Erzeugung</span><b>{fmtKwh(k.erzeugung)}</b></div>
              <div className="rb-detail"><span>Gesamtverbrauch</span><b>{fmtKwh(k.verbrauch)}</b></div>
              <div className="rb-detail"><span>Eigenverbrauch</span><b>{fmtKwh(k.eigenverbrauch)}</b></div>
              <div className="rb-detail"><span>davon direkt aus PV</span><b>{fmtKwh(k.pvDirekt)}</b></div>
              <div className="rb-detail"><span>davon aus Speicher</span><b>{fmtKwh(k.speicher)}</b></div>
              <div className="rb-detail"><span>Netzbezug</span><b>{fmtKwh(k.netzbezug)}</b></div>
              <div className="rb-detail"><span>Einspeisung</span><b>{fmtKwh(k.eingespeist)}</b></div>
              <div className="rb-detail"><span>Autarkiegrad</span><b>{Math.round(k.autarkie)}%</b></div>
              <div className="rb-detail"><span>Eigenverbrauchsquote</span><b>{Math.round(k.eigenverbrauchsquote)}%</b></div>
              <div className="rb-detail"><span>Tage mit Daten</span><b>{k.tageMitDaten}</b></div>
            </div>
            {k.co2Geschaetzt ? (
              <p className="hint" style={{ fontSize: 12, marginTop: 8 }}>
                CO₂-Ersparnis ist eine Näherung (vermiedener Netzbezug × Durchschnittsfaktor).
                Für echte Werte einen ENTSO-E-Token hinterlegen (siehe unten).
              </p>
            ) : (
              <p className="hint" style={{ fontSize: 12, marginTop: 8 }}>
                CO₂ mit echter Netzintensität berechnet (⌀ {k.co2SchnittIntensitaet} g/kWh im Zeitraum).
                Tatsächlicher Netzstrom-Ausstoß: {k.co2NetzEmissionenKg != null ? (k.co2NetzEmissionenKg >= 1000 ? `${(k.co2NetzEmissionenKg / 1000).toFixed(1)} t` : `${Math.round(k.co2NetzEmissionenKg)} kg`) : "–"}.
              </p>
            )}
          </div>

          {/* CO₂-Datenquelle: nur Statushinweis, Einrichtung/Backfill in Quellenkonfig */}
          <p className="hint" style={{ fontSize: 11 }}>
            {co2Cfg?.tokenGesetzt
              ? `CO₂-Bilanz mit echter Netzintensität über ENTSO-E${co2Cfg.aktuelleIntensitaet != null ? ` (aktuell ${co2Cfg.aktuelleIntensitaet} g/kWh)` : ""}. Einrichtung, Status und Nachladen der Vergangenheit unter Einstellungen → Quellen → ‚ENTSO-E REST API‘.`
              : "CO₂-Ersparnis ist aktuell eine Schätzung. Für echte Werte unter Einstellungen → Quellen eine Quelle der Rolle ‚ENTSO-E REST API‘ anlegen."}
          </p>
        </div>
      )}
    </div>
  );
}

// Kombi-Chart: gestapelte Balken (Erzeugung/Verbrauch) + Autarkie-Linie.
function VerlaufChart({ verlauf }: { verlauf: Kennzahlen["verlauf"] }) {
  // WICHTIG: Hooks immer VOR jedem bedingten return aufrufen (React-Hook-Regel).
  const [hover, setHover] = useState<number | null>(null);
  if (!verlauf.length) return <p className="hint">Keine Daten.</p>;
  const W = 900, H = 300, padL = 46, padR = 46, padT = 16, padB = 30;
  const maxKwh = Math.max(1, ...verlauf.map((v) => Math.max(v.erzeugung, v.verbrauch)));
  const bw = (W - padL - padR) / verlauf.length;
  const yOf = (v: number) => padT + (1 - v / maxKwh) * (H - padT - padB);
  const yAutarkie = (a: number) => padT + (1 - a / 100) * (H - padT - padB);

  const autarkiePfad = verlauf.map((v, i) => `${i === 0 ? "M" : "L"}${(padL + i * bw + bw / 2).toFixed(1)},${yAutarkie(v.autarkie).toFixed(1)}`).join(" ");

  return (
    <div className="ww-chart-wrap" style={{ position: "relative" }}>
      <div className="ev-hist-legende">
        <span><span className="ev-legend-dot" style={{ background: "#e8a13a" }} /> Erzeugung</span>
        <span><span className="ev-legend-dot" style={{ background: "#5a7fa5" }} /> Verbrauch</span>
        <span><span className="ev-legend-dot" style={{ background: "#5aa469" }} /> Autarkie</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ww-chart-svg" preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + f * (H - padT - padB);
          return <g key={f}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f5" /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#889">{Math.round(maxKwh * (1 - f))}</text><text x={W - padR + 6} y={y + 3} fontSize="10" fill="#5aa469">{Math.round(100 * (1 - f))}%</text></g>;
        })}
        {verlauf.map((v, i) => {
          const x = padL + i * bw;
          const bwE = bw * 0.36, gap = bw * 0.12;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              <rect x={x + gap} y={yOf(v.erzeugung)} width={bwE} height={H - padB - yOf(v.erzeugung)} fill="#e8a13a" rx={1} />
              <rect x={x + gap + bwE} y={yOf(v.verbrauch)} width={bwE} height={H - padB - yOf(v.verbrauch)} fill="#5a7fa5" rx={1} />
              {(verlauf.length <= 16 || i % 3 === 0) && <text x={x + bw / 2} y={H - padB + 14} textAnchor="middle" fontSize="10" fill="#889">{v.label}</text>}
            </g>
          );
        })}
        <path d={autarkiePfad} fill="none" stroke="#5aa469" strokeWidth="2" />
        {verlauf.map((v, i) => <circle key={i} cx={padL + i * bw + bw / 2} cy={yAutarkie(v.autarkie)} r={2} fill="#5aa469" />)}
        {hover != null && <line x1={padL + hover * bw + bw / 2} y1={padT} x2={padL + hover * bw + bw / 2} y2={H - padB} stroke="#bbb" strokeDasharray="3 3" />}
      </svg>
      {hover != null && (
        <div className="ww-tooltip" style={{ left: `${((padL + hover * bw + bw / 2) / W) * 100}%` }}>
          <div className="ww-tooltip-t">{verlauf[hover].label}</div>
          <div className="ww-tooltip-row"><span className="ev-legend-dot" style={{ background: "#e8a13a" }} />Erzeugung: <b>{fmtKwh(verlauf[hover].erzeugung)}</b></div>
          <div className="ww-tooltip-row"><span className="ev-legend-dot" style={{ background: "#5a7fa5" }} />Verbrauch: <b>{fmtKwh(verlauf[hover].verbrauch)}</b></div>
          <div className="ww-tooltip-row"><span className="ev-legend-dot" style={{ background: "#5aa469" }} />Autarkie: <b>{Math.round(verlauf[hover].autarkie)}%</b></div>
        </div>
      )}
    </div>
  );
}

// Verbrauchs-Donut: äußerer Ring = Anteile der Bereiche am Gesamtverbrauch,
// innerer Ring = Autarkie (Sonnen-/Eigenstrom-Anteil) je Bereich.
function VerbrauchsDonut({ bereiche, gesamt }: { bereiche: NonNullable<Kennzahlen["bereiche"]>; gesamt: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const daten = [
    { key: "heizen", label: "Heizen", farbe: "#dd9477", farbeDunkel: "#a84f2a", kwh: bereiche.heizen.kwh, autarkie: bereiche.heizen.autarkie },
    { key: "warmwasser", label: "Warmwasser", farbe: "#e0b35a", farbeDunkel: "#b5842a", kwh: bereiche.warmwasser.kwh, autarkie: bereiche.warmwasser.autarkie },
    { key: "auto", label: "Elektroauto", farbe: "#80c090", farbeDunkel: "#3a8450", kwh: bereiche.auto.kwh, autarkie: bereiche.auto.autarkie },
    { key: "haushalt", label: "Haushalt (Rest)", farbe: "#7fa0c4", farbeDunkel: "#3a5f8a", kwh: bereiche.haushalt.kwh, autarkie: bereiche.haushalt.autarkie },
  ].filter((d) => d.kwh > 0);
  const summe = daten.reduce((a, d) => a + d.kwh, 0) || 1;
  // Fallback: Falls (wider Erwarten) keine Bereichsdaten > 0 vorliegen, sauber
  // einen Hinweis zeigen statt eines leeren Kastens.
  if (daten.length === 0) return <p className="hint">Noch keine aufschlüsselbaren Verbrauchsdaten für diesen Zeitraum.</p>;

  const size = 260, cx = size / 2, cy = size / 2;
  // Beide Ringe nach außen gerückt und direkt aneinander (nur 2px Spalt), damit in
  // der Mitte mehr Platz bleibt. Außen = Verbrauchsanteil, innen = Autarkie.
  const rAussen = 122, rAussenInnen = 100; // äußerer Ring (Anteile)
  const rInnen = 98, rInnenInnen = 80;      // innerer Ring (Autarkie), direkt darunter
  const toXY = (r: number, winkel: number) => ({ x: cx + r * Math.cos(winkel - Math.PI / 2), y: cy + r * Math.sin(winkel - Math.PI / 2) });
  const segment = (rO: number, rI: number, start: number, end: number) => {
    // Vollkreis-Sonderfall (ein einziger Bereich = 360°): als Doppel-Halbkreis
    // zeichnen, sonst kollabiert der Arc (Start- und Endpunkt identisch → nichts).
    if (end - start >= 2 * Math.PI - 0.001) {
      const mid = start + Math.PI;
      const oa = toXY(rO, start), om = toXY(rO, mid), ia = toXY(rI, start), im = toXY(rI, mid);
      return `M${oa.x},${oa.y} A${rO},${rO} 0 1 1 ${om.x},${om.y} A${rO},${rO} 0 1 1 ${oa.x},${oa.y} M${ia.x},${ia.y} A${rI},${rI} 0 1 0 ${im.x},${im.y} A${rI},${rI} 0 1 0 ${ia.x},${ia.y}`;
    }
    const large = end - start > Math.PI ? 1 : 0;
    const a = toXY(rO, start), b = toXY(rO, end), c = toXY(rI, end), d = toXY(rI, start);
    return `M${a.x},${a.y} A${rO},${rO} 0 ${large} 1 ${b.x},${b.y} L${c.x},${c.y} A${rI},${rI} 0 ${large} 0 ${d.x},${d.y} Z`;
  };

  let winkel = 0;
  const aussenSeg = daten.map((d, i) => {
    const anteil = d.kwh / summe;
    const start = winkel; const end = winkel + anteil * 2 * Math.PI; winkel = end;
    // Innerer Autarkie-Bogen im selben Winkelbereich, aber nur bis Autarkie-Anteil gefüllt.
    const autEnd = start + anteil * 2 * Math.PI * (d.autarkie / 100);
    // Position für das Prozent-Label: Mitte des Segments, auf dem äußeren Ring.
    const mitte = (start + end) / 2;
    const labelPos = toXY((rAussen + rAussenInnen) / 2, mitte);
    const prozent = Math.round(anteil * 100);
    return { d, i, start, end, autEnd, labelPos, prozent, path: segment(rAussen, rAussenInnen, start, end), autPath: d.autarkie > 0 ? segment(rInnen, rInnenInnen, start, autEnd) : "" };
  });

  return (
    <div className="rb-donut">
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={260} height={260} className="rb-donut-svg" onMouseLeave={() => setHover(null)}>
          {/* innerer Ring Hintergrund (grau = Netzanteil) */}
          {aussenSeg.map((s) => <path key={`bg${s.i}`} d={segment(rInnen, rInnenInnen, s.start, s.end)} fill="#eef1f5" />)}
          {/* äußere Anteile */}
          {aussenSeg.map((s) => (
            <path key={`a${s.i}`} d={s.path} fill={s.d.farbe} opacity={hover == null || hover === s.i ? 1 : 0.4}
              onMouseEnter={() => setHover(s.i)} style={{ cursor: "pointer" }} />
          ))}
          {/* innere Autarkie (dunklere, kräftigere Variante für starken Kontrast) */}
          {aussenSeg.map((s) => s.autPath && (
            <path key={`i${s.i}`} d={s.autPath} fill={s.d.farbeDunkel} opacity={hover == null || hover === s.i ? 1 : 0.35} />
          ))}
          {/* Prozentwerte dezent auf dem äußeren Ring */}
          {aussenSeg.map((s) => s.prozent >= 5 && (
            <text key={`p${s.i}`} x={s.labelPos.x} y={s.labelPos.y + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#fff" style={{ pointerEvents: "none" }}>{s.prozent}%</text>
          ))}
          {/* Mitte – jetzt mehr Platz */}
          <text x={cx} y={cy - 8} textAnchor="middle" fontSize="26" fontWeight="700" fill="#223">{fmtKwh(gesamt)}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="12" fill="#778">Gesamtverbrauch</text>
        </svg>
        {hover != null && (
          <div className="ww-tooltip" style={{ left: "50%", top: "8%" }}>
            <div className="ww-tooltip-t">{aussenSeg[hover].d.label}</div>
            <div className="ww-tooltip-row">Verbrauch: <b>{fmtKwh(aussenSeg[hover].d.kwh)}</b> ({Math.round(aussenSeg[hover].d.kwh / summe * 100)}%)</div>
            <div className="ww-tooltip-row">Autarkie: <b>{Math.round(aussenSeg[hover].d.autarkie)}%</b> aus Sonne/Speicher</div>
            {aussenSeg[hover].d.key === "warmwasser" && (bereiche.warmwasser.wpKwh || bereiche.warmwasser.heizstabKwh) ? (
              <div className="ww-tooltip-row">WP {fmtKwh(bereiche.warmwasser.wpKwh ?? 0)} · Heizstab {fmtKwh(bereiche.warmwasser.heizstabKwh ?? 0)}</div>
            ) : null}
          </div>
        )}
      </div>
      {/* Legende */}
      <div className="rb-donut-legende">
        {daten.map((d, i) => (
          <div key={d.key} className="rb-donut-leg" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
            <span className="ev-legend-dot" style={{ background: d.farbe }} />
            <div className="rb-donut-leg-text">
              <b>{d.label}</b>
              <span>{fmtKwh(d.kwh)} · {Math.round(d.kwh / summe * 100)}% · {Math.round(d.autarkie)}% autark</span>
              {d.key === "warmwasser" && (bereiche.warmwasser.wpKwh || bereiche.warmwasser.heizstabKwh) ? (
                <span className="rb-wp-split">↳ WP {fmtKwh(bereiche.warmwasser.wpKwh ?? 0)} · Heizstab {fmtKwh(bereiche.warmwasser.heizstabKwh ?? 0)}</span>
              ) : null}
            </div>
          </div>
        ))}
        <p className="hint" style={{ fontSize: 11, marginTop: 6 }}>
          Außen: Anteil am Gesamtverbrauch. Innen (dunkler): Autarkie je Bereich.
          Warmwasser teilt sich in Wärmepumpe und Heizstab.
        </p>
      </div>
    </div>
  );
}
