// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";

interface Begruendung {
  titel: string;
  felder: Array<{ label: string; wert: string; hervor?: boolean }>;
  verlauf?: { einheit: string; schwelleOben?: number; tage: Array<{ tag: string; wert: number }>; heuteWert: number };
}
interface Anomalie {
  id: string; detektorId: string; detektorName: string;
  objektId: string; objektName: string; status: string;
  seit: string; zuletztGesehen: string; beendetAm: string | null; quittiertAm: string | null;
  detail: string; messwerte: Record<string, number>;
  begruendung?: Begruendung;
  feedback?: string | null; feedbackAm?: string | null;
}
interface DetektorConfig {
  id: string; enabled: boolean; params: Record<string, number>; ignoriert: string[];
  erzwungen?: string[];
  urlaubStart?: string | null; urlaubEnde?: string | null;
  ueberwachteVerbraucher?: string[]; ueberwacheWasser?: boolean; ueberwachteHue?: string[];
}
interface AnomalieConfig { enabled: boolean; detektoren: DetektorConfig[]; vorschlagSchwelle?: number; }
interface Objekt { id: string; label: string; }
interface BaselineTransp {
  objektId: string; objektName: string; mittelKwh: number; sigmaKwh: number;
  variationsKoeffProzent: number; geeignet: boolean; erzwungen: boolean; ignoriert: boolean;
  tageBasis: number; schwelleObenKwh: number; schwelleUntenKwh: number;
  tage: Array<{ tag: string; kwh: number }>;
}
interface Vorschlag {
  id: string; art: "ignorieren" | "empfindlichkeit-senken" | "positiv";
  detektorId: string; detektorName: string; objektId: string | null; objektName: string | null;
  text: string; anzahl: number;
}
interface StatusResp {
  enabled: boolean; aktiv: Anomalie[]; quittiert: Anomalie[]; gesamtStatus: "ok" | "auffaellig";
}

const DETEKTOR_INFO: Record<string, { name: string; was: string }> = {
  "source-offline": { name: "Quellen-Ausfall", was: "Meldet Geräte/Quellen, die deutlich länger als üblich nicht mehr antworten." },
  "pv-string": { name: "PV-Strang-Einbruch", was: "Vergleicht die PV-Stränge untereinander und meldet einen, der bei Sonne stark hinter den anderen zurückbleibt." },
  "grid-trotz-speicher": { name: "Netzbezug trotz Speicher", was: "Meldet anhaltenden Netzbezug, obwohl der Speicher gut geladen ist und ihn decken könnte (Hinweis auf Regelungsproblem)." },
  "verbrauch-baseline": { name: "Verbrauchs-Auffälligkeit", was: "Lernt je Verbraucher den üblichen Tagesverbrauch und meldet beim Tageswechsel, wenn ein Gerät deutlich mehr zieht als sonst oder plötzlich gar nicht mehr läuft. Unregelmäßige Geräte werden automatisch ausgespart." },
  "urlaub": { name: "Urlaubs-Überwachung", was: "Nur im geplanten Zeitraum aktiv. Meldet, wenn eines der ausgewählten Geräte läuft oder Wasser fließt, obwohl niemand da ist." },
};

function fmtZeit(iso: string | null): string {
  if (!iso) return "–";
  try { return new Date(iso).toLocaleString("de-DE"); } catch { return iso; }
}

// Ausführliche, eingefrorene Begründung einer Anomalie.
function BegruendungBlock({ b }: { b: Begruendung }) {
  const maxWert = b.verlauf
    ? Math.max(b.verlauf.heuteWert, b.verlauf.schwelleOben ?? 0, ...b.verlauf.tage.map((x) => x.wert), 0.01)
    : 0;
  return (
    <div className="anomalie-begr">
      <div className="anomalie-begr-titel">{b.titel}</div>
      <table className="anomalie-begr-felder">
        <tbody>
          {b.felder.map((f, i) => (
            <tr key={i}><td>{f.label}</td><td className={f.hervor ? "hervor" : ""}>{f.wert}</td></tr>
          ))}
        </tbody>
      </table>
      {b.verlauf && b.verlauf.tage.length > 0 && (
        <div className="anomalie-begr-verlauf">
          <div className="anomalie-begr-grafik">
            {b.verlauf.tage.map((x) => {
              const h = Math.max(2, Math.round((x.wert / maxWert) * 44));
              return <div key={x.tag} className="anomalie-begr-bar" style={{ height: h }} title={`${x.tag}: ${x.wert} ${b.verlauf!.einheit}`} />;
            })}
            {/* der auslösende Wert als hervorgehobener Balken rechts */}
            <div className="anomalie-begr-bar heute" style={{ height: Math.max(2, Math.round((b.verlauf.heuteWert / maxWert) * 44)) }}
              title={`Auslöser: ${b.verlauf.heuteWert} ${b.verlauf.einheit}`} />
          </div>
          <div className="anomalie-begr-legende">
            <span className="anomalie-begr-leg-bar" /> Verlauf ·
            <span className="anomalie-begr-leg-bar heute" /> Auslöser
            {b.verlauf.schwelleOben != null && <> · Schwelle {b.verlauf.schwelleOben} {b.verlauf.einheit}</>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnomaliePage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [config, setConfig] = useState<AnomalieConfig | null>(null);
  const [historie, setHistorie] = useState<Anomalie[]>([]);
  const [objekte, setObjekte] = useState<{ verbraucher: Objekt[]; wasserzaehler: Objekt[] }>({ verbraucher: [], wasserzaehler: [] });
  const [hueGeraete, setHueGeraete] = useState<Array<{ serviceId: string; name: string; kind: string; room?: string }>>([]);
  useEffect(() => {
    fetch("/api/hue/devices").then((r) => r.json())
      .then((j) => { if (j.ok) setHueGeraete((j.devices ?? []).filter((d: any) => d.kind === "light" || d.kind === "motion")); })
      .catch(() => {});
  }, []);
  const [transparenz, setTransparenz] = useState<BaselineTransp[]>([]);
  const [zeigeTransparenz, setZeigeTransparenz] = useState(false);
  const [offeneBegr, setOffeneBegr] = useState<Set<string>>(new Set());
  const [feedbackProtokoll, setFeedbackProtokoll] = useState<Anomalie[]>([]);
  const [vorschlaege, setVorschlaege] = useState<Vorschlag[]>([]);
  const [msg, setMsg] = useState("");

  const laden = useCallback(async () => {
    try {
      const r = await fetch("/api/anomalie/status");
      const j = await r.json();
      if (j.ok) {
        setStatus(j.status); setConfig(j.config); setHistorie(j.historie ?? []);
        if (j.objekte) setObjekte(j.objekte);
        if (j.baselineTransparenz) setTransparenz(j.baselineTransparenz);
        if (j.feedbackProtokoll) setFeedbackProtokoll(j.feedbackProtokoll);
        if (j.vorschlaege) setVorschlaege(j.vorschlaege);
      }
    } catch { /* ignore */ }
  }, []);

  async function vorschlagAnwenden(id: string) {
    try {
      const r = await fetch("/api/anomalie/vorschlag", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (j.ok) {
        if (j.config) setConfig(j.config);
        if (j.vorschlaege) setVorschlaege(j.vorschlaege);
        setMsg("Übernommen"); setTimeout(() => setMsg(""), 2000);
      }
    } catch { /* ignore */ }
  }

  async function bewerten(id: string, feedback: "richtig" | "unwichtig" | "fehlalarm") {
    try {
      const r = await fetch("/api/anomalie/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, feedback }),
      });
      const j = await r.json();
      if (j.ok) {
        if (j.status) setStatus(j.status);
        if (j.historie) setHistorie(j.historie);
        if (j.feedbackProtokoll) setFeedbackProtokoll(j.feedbackProtokoll);
        setMsg("Danke fürs Feedback"); setTimeout(() => setMsg(""), 2000);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    laden();
    const t = setInterval(laden, 15000);
    return () => clearInterval(t);
  }, [laden]);

  async function speichern(next: AnomalieConfig) {
    setConfig(next);
    try {
      const r = await fetch("/api/anomalie/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (j.ok) { setConfig(j.config); setMsg("gespeichert"); setTimeout(() => setMsg(""), 2000); }
    } catch { /* ignore */ }
  }

  function setzeDetektor(id: string, patch: Partial<DetektorConfig>) {
    if (!config) return;
    const next = { ...config, detektoren: config.detektoren.map((d) => d.id === id ? { ...d, ...patch } : d) };
    speichern(next);
  }
  function setzeParam(id: string, key: string, val: number) {
    if (!config) return;
    const next = { ...config, detektoren: config.detektoren.map((d) => d.id === id ? { ...d, params: { ...d.params, [key]: val } } : d) };
    speichern(next);
  }
  function setzeFeld(id: string, patch: Partial<DetektorConfig>) {
    if (!config) return;
    const next = { ...config, detektoren: config.detektoren.map((d) => d.id === id ? { ...d, ...patch } : d) };
    speichern(next);
  }
  // Ein Objekt in einer Listen-Property (ignoriert/erzwungen/ueberwachteVerbraucher) togglen.
  function toggleInListe(id: string, feld: "ignoriert" | "erzwungen" | "ueberwachteVerbraucher" | "ueberwachteHue", objId: string) {
    if (!config) return;
    const d = config.detektoren.find((x) => x.id === id);
    if (!d) return;
    const liste = new Set((d[feld] as string[] | undefined) ?? []);
    if (liste.has(objId)) liste.delete(objId); else liste.add(objId);
    setzeFeld(id, { [feld]: [...liste] } as Partial<DetektorConfig>);
  }

  const ampel = !status?.enabled ? "aus" : status.gesamtStatus;

  return (
    <div className="page">
      <h2>Anomalie-Erkennung</h2>
      <p className="hint">
        Überwacht die Anlage automatisch auf Auffälligkeiten – ohne dass pro Gerät
        eine Regel angelegt werden muss. Die Detektoren laufen selbstständig über
        alle passenden Objekte. Eine Auffälligkeit lässt sich quittieren; sie wird
        dann unterdrückt, bis sie sich einmal von selbst auflöst.
      </p>

      {/* Gesundheits-Kopf */}
      <section className={`card anomalie-kopf anomalie-${ampel}`}>
        <div className="anomalie-ampel-punkt" />
        <div>
          <div className="anomalie-kopf-titel">
            {!status?.enabled ? "Anomalie-Erkennung ist deaktiviert"
              : ampel === "ok" ? "Alles in Ordnung"
              : `${status.aktiv.length} ${status.aktiv.length === 1 ? "Auffälligkeit" : "Auffälligkeiten"}`}
          </div>
          {status?.enabled && status.quittiert.length > 0 && (
            <div className="anomalie-kopf-sub">{status.quittiert.length} quittiert (andauernd)</div>
          )}
        </div>
        {msg && <span className="exthems-formel-ok" style={{ marginLeft: "auto" }}>{msg}</span>}
      </section>

      {/* Verbesserungsvorschläge (Stufe 4) */}
      {vorschlaege.length > 0 && (
        <section className="card anomalie-vorschlaege">
          <h3>Vorschläge</h3>
          <p className="hint">Aus deinen Bewertungen abgeleitet – transparent und regelbasiert. Du entscheidest, ob du sie übernimmst.</p>
          <div className="anomalie-vor-liste">
            {vorschlaege.map((v) => (
              <div key={v.id} className={`anomalie-vor-eintrag ${v.art}`}>
                <div className="anomalie-vor-text">{v.text}</div>
                {v.art !== "positiv" && (
                  <button className="src-add-btn" onClick={() => vorschlagAnwenden(v.id)}>
                    {v.art === "ignorieren" ? "Überwachung deaktivieren" : "Empfindlichkeit senken"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Aktive Anomalien */}
      {status?.enabled && status.aktiv.length > 0 && (
        <section className="card">
          <h3>Aktive Auffälligkeiten</h3>
          <div className="anomalie-liste">
            {status.aktiv.map((a) => (
              <div key={a.id} className="anomalie-eintrag aktiv">
                <div className="anomalie-eintrag-haupt">
                  <span className="anomalie-badge">{a.detektorName}</span>
                  <strong>{a.objektName}</strong>
                </div>
                <div className="anomalie-detail">{a.detail}</div>
                <div className="anomalie-meta">seit {fmtZeit(a.seit)}</div>
                {a.begruendung && (
                  <button className="anomalie-transp-toggle" onClick={() => setOffeneBegr((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}>
                    {offeneBegr.has(a.id) ? "▾" : "▸"} Warum wurde das gemeldet?
                  </button>
                )}
                {a.begruendung && offeneBegr.has(a.id) && <BegruendungBlock b={a.begruendung} />}
                <div className="anomalie-feedback-row">
                  <span className="anomalie-feedback-frage">War das hilfreich?</span>
                  <button className="anomalie-fb-btn richtig" onClick={() => bewerten(a.id, "richtig")}>✓ Richtig</button>
                  <button className="anomalie-fb-btn unwichtig" onClick={() => bewerten(a.id, "unwichtig")}>~ Richtig, aber unwichtig</button>
                  <button className="anomalie-fb-btn fehlalarm" onClick={() => bewerten(a.id, "fehlalarm")}>✕ Fehlalarm</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quittierte (andauernd) */}
      {status?.enabled && status.quittiert.length > 0 && (
        <section className="card">
          <h3>Quittiert (dauert noch an)</h3>
          <p className="hint">Diese Auffälligkeiten bestehen weiter, wurden aber bestätigt und daher unterdrückt. Sie erscheinen erneut, falls sie sich auflösen und danach wieder auftreten.</p>
          <div className="anomalie-liste">
            {status.quittiert.map((a) => (
              <div key={a.id} className="anomalie-eintrag quittiert">
                <div className="anomalie-eintrag-haupt">
                  <span className="anomalie-badge">{a.detektorName}</span>
                  <strong>{a.objektName}</strong>
                </div>
                <div className="anomalie-detail">{a.detail}</div>
                <div className="anomalie-meta">seit {fmtZeit(a.seit)} · quittiert {fmtZeit(a.quittiertAm)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Detektor-Konfiguration */}
      {config && (
        <section className="card">
          <h3>Detektoren</h3>
          <label className="anomalie-gesamt">
            <input type="checkbox" checked={config.enabled} onChange={(e) => speichern({ ...config, enabled: e.target.checked })} />
            Anomalie-Erkennung insgesamt aktiv
          </label>
          <div className="anomalie-params" style={{ marginBottom: 12, maxWidth: 360 }}>
            <label>Vorschläge ab (gleiche Bewertungen)</label>
            <input type="number" min={2} value={config.vorschlagSchwelle ?? 3}
              onChange={(e) => speichern({ ...config, vorschlagSchwelle: Math.max(2, Number(e.target.value)) })} />
          </div>
          <div className="anomalie-detektoren">
            {config.detektoren.map((d) => {
              const info = DETEKTOR_INFO[d.id];
              return (
                <div key={d.id} className="anomalie-det-karte">
                  <label className="anomalie-det-head">
                    <input type="checkbox" checked={d.enabled} disabled={!config.enabled}
                      onChange={(e) => setzeDetektor(d.id, { enabled: e.target.checked })} />
                    <strong>{info?.name ?? d.id}</strong>
                  </label>
                  <p className="hint">{info?.was}</p>
                  {/* Empfindlichkeits-Parameter je Detektor */}
                  <div className="anomalie-params">
                    {d.id === "source-offline" && (
                      <>
                        <label>Faktor × Poll-Intervall</label>
                        <input type="number" value={d.params.faktor ?? 5} min={2} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "faktor", Number(e.target.value))} />
                        <label>Mindest-Stille (s)</label>
                        <input type="number" value={d.params.minSekunden ?? 120} min={10} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "minSekunden", Number(e.target.value))} />
                      </>
                    )}
                    {d.id === "pv-string" && (
                      <>
                        <label>Schwelle (% des Mittels)</label>
                        <input type="number" value={d.params.anteilProzent ?? 25} min={5} max={90} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "anteilProzent", Number(e.target.value))} />
                        <label>Mindestleistung Referenz (W)</label>
                        <input type="number" value={d.params.minWatt ?? 150} min={0} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "minWatt", Number(e.target.value))} />
                        <label>Bestätigung (min)</label>
                        <input type="number" value={d.params.bestaetigungMin ?? 10} min={0} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "bestaetigungMin", Number(e.target.value))} />
                      </>
                    )}
                    {d.id === "grid-trotz-speicher" && (
                      <>
                        <label>Mindest-Bezug (W)</label>
                        <input type="number" value={d.params.minWatt ?? 300} min={50} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "minWatt", Number(e.target.value))} />
                        <label>Mindest-SoC (%)</label>
                        <input type="number" value={d.params.minSoc ?? 30} min={0} max={100} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "minSoc", Number(e.target.value))} />
                        <label>Bestätigung (min)</label>
                        <input type="number" value={d.params.bestaetigungMin ?? 5} min={0} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "bestaetigungMin", Number(e.target.value))} />
                      </>
                    )}
                    {d.id === "verbrauch-baseline" && (
                      <>
                        <label>Lern-Fenster (Tage)</label>
                        <input type="number" value={d.params.tageFenster ?? 14} min={3} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "tageFenster", Number(e.target.value))} />
                        <label>Empfindlichkeit (× Streuung)</label>
                        <input type="number" value={d.params.sigmaFaktor ?? 3} min={1} step={0.5} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "sigmaFaktor", Number(e.target.value))} />
                        <label>Max. Streuung für Eignung (%)</label>
                        <input type="number" value={d.params.maxVariationsKoeff ?? 40} min={5} max={100} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "maxVariationsKoeff", Number(e.target.value))} />
                        <label>„Läuft nicht mehr" unter (%)</label>
                        <input type="number" value={d.params.ausfallProzent ?? 10} min={0} max={50} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "ausfallProzent", Number(e.target.value))} />
                        <label>Bagatellgrenze (kWh/Tag)</label>
                        <input type="number" value={d.params.minKwh ?? 0.1} min={0} step={0.05} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "minKwh", Number(e.target.value))} />
                      </>
                    )}
                  </div>
                  {/* Baseline: gelernter Normalzustand (Transparenz) */}
                  {d.id === "verbrauch-baseline" && d.enabled && (
                    <div className="anomalie-uebersteuern">
                      <button className="anomalie-transp-toggle" onClick={() => setZeigeTransparenz((v) => !v)}>
                        {zeigeTransparenz ? "▾" : "▸"} Gelernter Normalzustand je Gerät
                      </button>
                      {zeigeTransparenz && (
                        <div className="anomalie-transp-liste">
                          {transparenz.length === 0 && <p className="hint">Noch keine Verbrauchsdaten gelernt.</p>}
                          {transparenz.map((t) => {
                            const maxKwh = Math.max(t.schwelleObenKwh, ...t.tage.map((x) => x.kwh), 0.01);
                            return (
                              <div key={t.objektId} className="anomalie-transp-geraet">
                                <div className="anomalie-transp-kopf">
                                  <strong>{t.objektName}</strong>
                                  {t.geeignet
                                    ? <span className="anomalie-tag ok">überwacht</span>
                                    : <span className="anomalie-tag aus" title={`Streuung ${t.variationsKoeffProzent}% zu hoch für verlässliche Aussage`}>ausgespart</span>}
                                  {t.erzwungen && <span className="anomalie-tag force">erzwungen</span>}
                                  {t.ignoriert && <span className="anomalie-tag ign">ignoriert</span>}
                                </div>
                                <div className="anomalie-transp-zahlen">
                                  üblich <strong>{t.mittelKwh.toFixed(2)} ± {t.sigmaKwh.toFixed(2)} kWh/Tag</strong>
                                  {" "}· Streuung {t.variationsKoeffProzent}% · aus {t.tageBasis} Tagen
                                  {" "}· Alarm ab {t.schwelleObenKwh.toFixed(2)} kWh
                                </div>
                                {/* Balkengrafik der letzten Tage + Mittel-/Schwellenlinie */}
                                <div className="anomalie-balken">
                                  {t.tage.map((x) => {
                                    const h = Math.max(2, Math.round((x.kwh / maxKwh) * 40));
                                    const ueber = x.kwh > t.schwelleObenKwh;
                                    return <div key={x.tag} className={`anomalie-balken-bar${ueber ? " hoch" : ""}`}
                                      style={{ height: h }} title={`${x.tag}: ${x.kwh.toFixed(2)} kWh`} />;
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Baseline: manuelle Übersteuerung je Gerät */}
                  {d.id === "verbrauch-baseline" && d.enabled && objekte.verbraucher.length > 0 && (
                    <div className="anomalie-uebersteuern">
                      <div className="anomalie-uebersteuern-titel">Geräte-Übersteuerung (optional)</div>
                      <p className="hint">Standardmäßig entscheidet FLUX automatisch, welche Geräte sich für die Überwachung eignen. Hier lässt sich pro Gerät „immer überwachen" (auch bei hoher Streuung) oder „nie überwachen" erzwingen.</p>
                      <table className="anomalie-geraete-tab">
                        <thead><tr><th>Gerät</th><th>erzwingen</th><th>ignorieren</th></tr></thead>
                        <tbody>
                          {objekte.verbraucher.map((v) => (
                            <tr key={v.id}>
                              <td>{v.label}</td>
                              <td style={{ textAlign: "center" }}>
                                <input type="checkbox" checked={(d.erzwungen ?? []).includes(v.id)}
                                  onChange={() => toggleInListe(d.id, "erzwungen", v.id)} />
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <input type="checkbox" checked={(d.ignoriert ?? []).includes(v.id)}
                                  onChange={() => toggleInListe(d.id, "ignoriert", v.id)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {/* Urlaub: Zeitraum + Geräteauswahl */}
                  {d.id === "urlaub" && (
                    <div className="anomalie-urlaub">
                      <div className="anomalie-urlaub-zeitraum">
                        <label>Von</label>
                        <input type="date" value={d.urlaubStart ?? ""} disabled={!d.enabled}
                          onChange={(e) => setzeFeld(d.id, { urlaubStart: e.target.value || null })} />
                        <label>Bis (Rückkehr)</label>
                        <input type="date" value={d.urlaubEnde ?? ""} disabled={!d.enabled}
                          onChange={(e) => setzeFeld(d.id, { urlaubEnde: e.target.value || null })} />
                      </div>
                      <div className="anomalie-params" style={{ marginTop: 8 }}>
                        <label>Schwelle (W)</label>
                        <input type="number" value={d.params.schwelleWatt ?? 15} min={1} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "schwelleWatt", Number(e.target.value))} />
                        <label>Bestätigung (min)</label>
                        <input type="number" value={d.params.bestaetigungMin ?? 10} min={0} disabled={!d.enabled}
                          onChange={(e) => setzeParam(d.id, "bestaetigungMin", Number(e.target.value))} />
                      </div>
                      {objekte.wasserzaehler.length > 0 && (
                        <label className="anomalie-wasser-check">
                          <input type="checkbox" checked={d.ueberwacheWasser ?? false} disabled={!d.enabled}
                            onChange={(e) => setzeFeld(d.id, { ueberwacheWasser: e.target.checked })} />
                          Wasserabgabe mit überwachen
                        </label>
                      )}
                      {d.enabled && objekte.verbraucher.length > 0 && (
                        <div className="anomalie-uebersteuern">
                          <div className="anomalie-uebersteuern-titel">Zu überwachende Geräte im Urlaub</div>
                          <p className="hint">Nur die hier ausgewählten Geräte lösen im Urlaub Alarm aus, wenn sie laufen (z.&nbsp;B. Kaffeemaschine, Herd, Bügeleisen). Dauerläufer wie Kühl-/Gefrierschrank bleiben unausgewählt.</p>
                          <div className="anomalie-geraete-auswahl">
                            {objekte.verbraucher.map((v) => (
                              <label key={v.id} className="anomalie-chip">
                                <input type="checkbox" checked={(d.ueberwachteVerbraucher ?? []).includes(v.id)}
                                  onChange={() => toggleInListe(d.id, "ueberwachteVerbraucher", v.id)} />
                                {v.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {d.enabled && hueGeraete.length > 0 && (
                        <div className="anomalie-uebersteuern">
                          <div className="anomalie-uebersteuern-titel">Zu überwachende Hue-Geräte im Urlaub</div>
                          <p className="hint">Ausgewählte Hue-Leuchten lösen Alarm aus, wenn sie im Urlaub angehen; ausgewählte Bewegungsmelder, wenn sie Bewegung erkennen. Das ist genauer als die Stromüberwachung.</p>
                          <div className="anomalie-geraete-auswahl">
                            {hueGeraete.map((h) => (
                              <label key={h.serviceId} className="anomalie-chip">
                                <input type="checkbox" checked={(d.ueberwachteHue ?? []).includes(h.serviceId)}
                                  onChange={() => toggleInListe(d.id, "ueberwachteHue", h.serviceId)} />
                                {h.room ? `${h.room}: ` : ""}{h.name} {h.kind === "motion" ? "(Bewegung)" : "(Licht)"}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Historie (beendete) */}
      <section className="card">
        <h3>Verlauf</h3>
        {historie.length === 0 ? (
          <p className="hint">Noch keine abgeschlossenen Auffälligkeiten protokolliert.</p>
        ) : (
          <div className="table-scroll">
            <table className="rule-log">
              <thead><tr><th>Beendet</th><th>Detektor</th><th>Objekt</th><th>Meldung</th><th>Bewertung</th></tr></thead>
              <tbody>
                {historie.map((a, i) => (
                  <tr key={i}>
                    <td>{fmtZeit(a.beendetAm)}</td>
                    <td>{a.detektorName}</td>
                    <td>{a.objektName}</td>
                    <td>{a.detail}</td>
                    <td>
                      {a.feedback
                        ? <span className={`anomalie-fb-tag ${a.feedback}`}>{feedbackLabel(a.feedback)}</span>
                        : (
                          <span className="anomalie-fb-mini">
                            <button title="Richtig" onClick={() => bewerten(a.id, "richtig")}>✓</button>
                            <button title="Richtig, aber unwichtig" onClick={() => bewerten(a.id, "unwichtig")}>~</button>
                            <button title="Fehlalarm" onClick={() => bewerten(a.id, "fehlalarm")}>✕</button>
                          </span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Feedback-Protokoll */}
      {feedbackProtokoll.length > 0 && (
        <section className="card">
          <h3>Dein Feedback</h3>
          <p className="hint">Deine Bewertungen fließen künftig in Verbesserungsvorschläge für die Detektoren ein.</p>
          <div className="table-scroll">
            <table className="rule-log">
              <thead><tr><th>Wann</th><th>Detektor</th><th>Objekt</th><th>Bewertung</th></tr></thead>
              <tbody>
                {feedbackProtokoll.map((a, i) => (
                  <tr key={i}>
                    <td>{fmtZeit(a.feedbackAm ?? null)}</td>
                    <td>{a.detektorName}</td>
                    <td>{a.objektName}</td>
                    <td><span className={`anomalie-fb-tag ${a.feedback}`}>{feedbackLabel(a.feedback)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function feedbackLabel(f?: string | null): string {
  if (f === "richtig") return "Richtig";
  if (f === "unwichtig") return "Unwichtig";
  if (f === "fehlalarm") return "Fehlalarm";
  return "–";
}
