// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";
import { nf } from "./chartUtils";

// §14a-Überwachung: steuerbare Verbrauchseinrichtungen (SteuVE) definieren und
// ihre Summen-Momentanleistung live gegen den empfangenen Bezugs-Sollwert prüfen.
// Reine Anzeige/Warnung/Protokoll – kein realer Eingriff.

interface SteuVe { id: string; name: string; sourceId: string; }
interface LpcConfig { enabled: boolean; steuve: SteuVe[]; warnschwelleProzent: number; }
interface LpcStatus {
  enabled: boolean; limitAktiv: boolean; limitW: number; summeW: number;
  auslastungProzent: number; status: "kein-limit" | "ok" | "warnung" | "ueberschreitung";
  einzel: Array<{ id: string; name: string; leistungW: number }>;
  anzahlSteuVe: number;
  berechnetesLimitW: number;
  berechnetGzf: number;
  berechnetFormel: string;
  abweichungBerechnetW: number | null;
}
interface LpcLogEntry { ts: string; summeW: number; limitW: number; text: string; }
interface QuelleOpt { id: string; label: string; }

function fmtZeit(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LpcMonitor() {
  const [cfg, setCfg] = useState<LpcConfig | null>(null);
  const [status, setStatus] = useState<LpcStatus | null>(null);
  const [logbuch, setLogbuch] = useState<LpcLogEntry[]>([]);
  const [quellen, setQuellen] = useState<QuelleOpt[]>([]);

  const load = useCallback(() => {
    fetch("/api/lpcmonitor/config").then((r) => r.json()).then((d) => {
      if (d?.config) setCfg(d.config);
      if (d?.status) setStatus(d.status);
      if (d?.log) setLogbuch(d.log);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    fetch("/api/sources").then((r) => r.json()).then((arr: any[]) => {
      if (Array.isArray(arr)) setQuellen(arr.map((s) => ({ id: s.id, label: s.label ?? s.id })));
    }).catch(() => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  function save(patch: Partial<LpcConfig>) {
    if (cfg) setCfg({ ...cfg, ...patch });
    fetch("/api/lpcmonitor/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json()).then((d) => { if (d?.config) setCfg(d.config); load(); }).catch(() => {});
  }
  function setSteuve(list: SteuVe[]) { save({ steuve: list }); }
  function addSteuve() {
    if (!cfg) return;
    const id = `steuve_${Date.now().toString(36)}`;
    setSteuve([...(cfg.steuve ?? []), { id, name: "", sourceId: quellen[0]?.id ?? "" }]);
  }
  function updateSteuve(i: number, patch: Partial<SteuVe>) {
    if (!cfg) return;
    setSteuve(cfg.steuve.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeSteuve(i: number) {
    if (!cfg) return;
    setSteuve(cfg.steuve.filter((_, idx) => idx !== i));
  }

  if (!cfg) return null;

  const ampel = status?.status ?? "kein-limit";
  const ampelText = ampel === "ueberschreitung" ? "Bezug über Limit"
    : ampel === "warnung" ? "nahe am Limit"
    : ampel === "ok" ? "im Rahmen" : "kein Limit aktiv";

  return (
    <section className="card">
      <h3>§14a-Überwachung – Bezug steuerbarer Einrichtungen</h3>
      <p className="hint">
        Vergleicht die Summe der Momentanleistungen der beim Netzbetreiber
        angemeldeten steuerbaren Verbrauchseinrichtungen (SteuVE) gegen den per
        EEBUS empfangenen Bezugs-Sollwert. Der Sollwert (Watt) enthält bereits alle
        netzbetreiberseitigen Berechnungen. Reine Anzeige – kein Eingriff.
      </p>

      <div className="src-grid">
        <label>Überwachung</label>
        <button className={`tile-sort-toggle${cfg.enabled ? " active" : ""}`} onClick={() => save({ enabled: !cfg.enabled })}>
          {cfg.enabled ? "aktiv" : "inaktiv"}
        </button>
      </div>
      <div className="src-grid">
        <label>Warnschwelle (%)</label>
        <input type="number" min={50} max={100} value={cfg.warnschwelleProzent} onChange={(e) => save({ warnschwelleProzent: Number(e.target.value) })} style={{ maxWidth: 100 }} />
      </div>

      {/* Live-Anzeige */}
      {status && (
        <div className={`lpc-mon-box lpc-${ampel}`}>
          <div className="lpc-mon-head">
            <span className={`lpc-ampel lpc-ampel-${ampel}`} />
            <strong>{ampelText}</strong>
          </div>
          {status.limitAktiv ? (
            <>
              <div className="lpc-mon-zahlen">
                SteuVE-Bezug <strong>{nf(status.summeW, 0)} W</strong> von Limit{" "}
                <strong>{nf(status.limitW, 0)} W</strong> ({status.auslastungProzent} %)
              </div>
              <div className="lpc-mon-bar">
                <div className={`lpc-mon-fill lpc-fill-${ampel}`} style={{ width: `${Math.min(100, status.auslastungProzent)}%` }} />
              </div>
              {status.einzel.length > 0 && (
                <div className="lpc-mon-einzel">
                  {status.einzel.map((e) => `${e.name || e.id}: ${nf(e.leistungW, 0)} W`).join(" · ")}
                </div>
              )}
            </>
          ) : (
            <div className="lpc-mon-zahlen">Aktuell kein Bezugslimit von der Steuerbox aktiv.</div>
          )}
        </div>
      )}

      {/* Berechnete §14a-Mindestleistung (Erwartungswert zum Abgleich) */}
      {status && status.anzahlSteuVe > 0 && (
        <div className="lpc-mon-calc">
          <div className="lpc-mon-calc-head">Berechnete §14a-Mindestleistung (Erwartungswert)</div>
          <div className="lpc-mon-calc-val">
            <strong>{nf(status.berechnetesLimitW, 0)} W</strong>
            {" "}({(status.berechnetesLimitW / 1000).toFixed(2).replace(".", ",")} kW)
            {status.abweichungBerechnetW != null && (
              <span className={`lpc-mon-calc-diff${Math.abs(status.abweichungBerechnetW) <= 200 ? " ok" : " warn"}`}>
                {" · "}empfangenes Limit weicht um {status.abweichungBerechnetW > 0 ? "+" : ""}{nf(status.abweichungBerechnetW, 0)} W ab
              </span>
            )}
          </div>
          <div className="lpc-mon-calc-formel">{status.berechnetFormel}</div>
          <p className="hint" style={{ marginTop: 6 }}>
            So entsteht der Wert: Bei Steuerung über ein Energiemanagementsystem
            garantiert der Netzbetreiber im Steuerungsfall einen Mindest-Bezug. Für
            eine einzelne steuerbare Verbrauchseinrichtung (SteuVE) sind das
            4,2&nbsp;kW. Bei mehreren SteuVE wird nicht einfach summiert, sondern ein
            von der Bundesnetzagentur vorgegebener <em>Gleichzeitigkeitsfaktor</em>
            {" "}(GZF) angewandt, der berücksichtigt, dass selten alle Geräte
            gleichzeitig mit voller Leistung laufen. Die Formel lautet: 4,2&nbsp;kW +
            (Anzahl − 1) × GZF × 4,2&nbsp;kW. Der GZF sinkt mit steigender Gerätezahl
            (2&nbsp;Geräte: 0,8 · 3: 0,75 · 4: 0,7 · 5: 0,65 · 6: 0,6 · 7: 0,55 ·
            8: 0,5 · ab&nbsp;9: 0,45).
          </p>
          <p className="hint" style={{ fontStyle: "italic" }}>
            Dieser Wert ist ein <strong>Erwartungswert zur Plausibilisierung</strong>:
            Maßgeblich für die Steuerung ist allein das tatsächlich von der Steuerbox
            empfangene Limit. Der genaue GZF und damit der reale Wert kann je nach
            Netzbetreiber und Fallgruppe abweichen (BNetzA-Festlegung BK6-22-300).
            Weicht das empfangene Limit stark vom berechneten ab, lohnt ein Blick auf
            die Anzahl/Zuordnung der SteuVE oder eine Rückfrage beim Netzbetreiber.
          </p>
        </div>
      )}

      {/* SteuVE-Liste */}
      <h4 className="eebus-h4">Steuerbare Verbrauchseinrichtungen</h4>
      <p className="hint">Beim Netzbetreiber angemeldete Einrichtungen (z. B. Wallbox, Wärmepumpe). Je Eintrag die Quelle wählen, aus der die Momentanleistung gelesen wird.</p>
      {cfg.steuve.length === 0 && <p className="hint">Noch keine SteuVE definiert.</p>}
      {cfg.steuve.map((s, i) => (
        <div key={s.id} className="lpc-steuve-row">
          <input type="text" placeholder="Name (z. B. Wallbox)" value={s.name} onChange={(e) => updateSteuve(i, { name: e.target.value })} style={{ maxWidth: 180 }} />
          <select value={s.sourceId} onChange={(e) => updateSteuve(i, { sourceId: e.target.value })}>
            <option value="">– Quelle wählen –</option>
            {quellen.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
          <button className="ie-cancel" onClick={() => removeSteuve(i)}>entfernen</button>
        </div>
      ))}
      <button className="src-add-btn" onClick={addSteuve}>+ SteuVE hinzufügen</button>

      {/* Protokoll */}
      <h4 className="eebus-h4">Überwachungs-Protokoll</h4>
      {logbuch.length === 0 ? (
        <p className="hint">Noch keine Ereignisse.</p>
      ) : (
        <table className="eebus-log-table">
          <thead><tr><th>Zeit</th><th>Bezug</th><th>Limit</th><th>Ereignis</th></tr></thead>
          <tbody>
            {logbuch.map((e, i) => (
              <tr key={i}>
                <td>{fmtZeit(e.ts)}</td>
                <td>{nf(e.summeW, 0)} W</td>
                <td>{nf(e.limitW, 0)} W</td>
                <td>{e.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
