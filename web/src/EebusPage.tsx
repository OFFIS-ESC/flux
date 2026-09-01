// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";
import { nf } from "./chartUtils";
import { LppControlConfig } from "./LppControlConfig";
import { LpcMonitor } from "./LpcMonitor";

// Seite für die EEBUS-Anbindung an eine Steuerbox (§14a EnWG / §9 EEG).
// Empfang der Steuerbefehle über den EEBUS-Sidecar (SHIP/SPINE) oder den
// Simulator. §9-Einspeiselimit wird real per Wechselrichter-Regelung umgesetzt,
// §14a-Bezugslimit wird gegen die steuerbaren Verbraucher überwacht (Anzeige).

interface EebusLimit {
  aktiv: boolean; wert: number; dauerSek: number | null;
  gesetztAm: string | null; gueltigBis: string | null;
}
interface EebusFailsafe { wert: number; dauerSek: number; }
interface EebusState {
  enabled: boolean;
  verbunden: boolean;
  steuerboxSki: string | null;
  eigenerSki: string | null;
  letzterKontakt: string | null;
  heartbeatOk: boolean;
  letzterHeartbeat: string | null;
  lpc: EebusLimit; lpp: EebusLimit;
  lpcFailsafe: EebusFailsafe; lppFailsafe: EebusFailsafe;
  failsafeAktiv: boolean;
}
interface LogEntry {
  ts: string; useCase: string; art: string; text: string;
  wert?: number; dauerSek?: number | null;
}

function fmtZeit(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDauer(sek: number | null): string {
  if (sek == null) return "unbefristet";
  if (sek < 60) return `${sek} s`;
  if (sek < 3600) return `${Math.round(sek / 60)} min`;
  return `${(sek / 3600).toFixed(1)} h`;
}

export function EebusPage() {
  const [state, setState] = useState<EebusState | null>(null);
  const [logbuch, setLogbuch] = useState<LogEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [sidecarInfo, setSidecarInfo] = useState<{ ownSki?: string; remoteSki?: string; connected?: boolean } | null>(null);
  // lokale Formularwerte
  const [steuerboxSki, setSteuerboxSki] = useState("");
  const [eigenerSki, setEigenerSki] = useState("");
  const [lpcFsWert, setLpcFsWert] = useState(0);
  const [lpcFsDauer, setLpcFsDauer] = useState(7200);
  const [lppFsWert, setLppFsWert] = useState(0);
  const [lppFsDauer, setLppFsDauer] = useState(7200);
  // Simulator-Eingaben
  const [simUseCase, setSimUseCase] = useState<"lpc" | "lpp">("lpc");
  const [simWert, setSimWert] = useState(4200);
  const [simDauer, setSimDauer] = useState(3600);

  const loadState = useCallback(() => {
    fetch("/api/eebus/state").then((r) => r.json()).then((d) => {
      if (d?.state) {
        setState(d.state);
        setSteuerboxSki(d.state.steuerboxSki ?? "");
        setEigenerSki(d.state.eigenerSki ?? "");
        setLpcFsWert(d.state.lpcFailsafe?.wert ?? 0);
        setLpcFsDauer(d.state.lpcFailsafe?.dauerSek ?? 7200);
        setLppFsWert(d.state.lppFailsafe?.wert ?? 0);
        setLppFsDauer(d.state.lppFailsafe?.dauerSek ?? 7200);
      }
    }).catch(() => {});
  }, []);
  const loadLog = useCallback(() => {
    fetch("/api/eebus/log?limit=200").then((r) => r.json()).then((d) => { if (d?.log) setLogbuch(d.log); }).catch(() => {});
  }, []);
  const loadSidecar = useCallback(() => {
    fetch("/api/eebus/sidecar/status").then((r) => r.json()).then((d) => {
      setSidecarRunning(!!d?.running);
      setSidecarInfo(d?.sidecar ?? null);
    }).catch(() => { setSidecarRunning(false); });
  }, []);

  useEffect(() => {
    loadState(); loadLog(); loadSidecar();
    const t = setInterval(() => { loadState(); loadLog(); loadSidecar(); }, 5000);
    return () => clearInterval(t);
  }, [loadState, loadLog, loadSidecar]);

  function pushSkiToSidecar() {
    fetch("/api/eebus/sidecar/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remoteSki: steuerboxSki }),
    }).then((r) => r.json()).then(() => loadSidecar()).catch(() => {});
  }

  function saveConfig(patch: Record<string, unknown>) {
    fetch("/api/eebus/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json()).then((d) => {
      if (d?.state) setState(d.state);
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    }).catch(() => {});
  }
  function toggleEnabled() { if (state) saveConfig({ enabled: !state.enabled }); }
  function saveSkis() { saveConfig({ steuerboxSki, eigenerSki }); }
  function saveFailsafe() {
    saveConfig({
      lpcFailsafe: { wert: lpcFsWert, dauerSek: lpcFsDauer },
      lppFailsafe: { wert: lppFsWert, dauerSek: lppFsDauer },
    });
  }
  function simulate(kind: string, extra?: Record<string, unknown>) {
    fetch("/api/eebus/simulate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, useCase: simUseCase, wert: simWert, dauerSek: simDauer, ...extra }),
    }).then((r) => r.json()).then((d) => { if (d?.state) setState(d.state); loadLog(); }).catch(() => {});
  }
  function clearLog() {
    fetch("/api/eebus/log/clear", { method: "POST" }).then(() => setLogbuch([])).catch(() => {});
  }

  if (!state) return <div className="page"><p className="hint">lädt…</p></div>;

  const LimitCard = ({ titel, para, limit }: { titel: string; para: string; limit: EebusLimit }) => (
    <div className={`eebus-limit-card${limit.aktiv ? " aktiv" : ""}`}>
      <div className="eebus-limit-titel">{titel} <span className="eebus-para">{para}</span></div>
      {limit.aktiv ? (
        <>
          <div className="eebus-limit-wert">{nf(limit.wert, 0)} W</div>
          <div className="eebus-limit-sub">Dauer: {fmtDauer(limit.dauerSek)}</div>
          {limit.gueltigBis && <div className="eebus-limit-sub">gültig bis {fmtZeit(limit.gueltigBis)}</div>}
          <div className="eebus-limit-sub">gesetzt {fmtZeit(limit.gesetztAm)}</div>
        </>
      ) : (
        <div className="eebus-limit-inaktiv">keine Begrenzung aktiv</div>
      )}
    </div>
  );

  return (
    <div className="page">
      <h2>EEBUS – Netzsteuerung (§14a / §9)</h2>
      <p className="hint">
        FLUX empfängt Steuerbefehle einer Steuerbox über EEBUS, zeigt sie an und
        protokolliert sie. Das <strong>§9-Einspeiselimit</strong> wird real
        umgesetzt: FLUX drosselt die Wechselrichter live, sodass die Einspeisung
        am Netzpunkt unter dem Grenzwert bleibt (standardmäßig im Dry-Run). Das
        <strong> §14a-Bezugslimit</strong> wird empfangen und laufend überwacht –
        der Bezug der steuerbaren Verbrauchseinrichtungen wird gegen den Sollwert
        geprüft und angezeigt; ein aktiver Eingriff findet hier bewusst nicht statt.
      </p>

      {/* Status */}
      <section className="card">
        <h3>Status</h3>
        <div className="eebus-status-grid">
          <div className={`eebus-badge${state.enabled ? " on" : ""}`}>{state.enabled ? "aktiv" : "deaktiviert"}</div>
          <div className={`eebus-badge${state.verbunden ? " on" : " warn"}`} title="Empfängt FLUX gerade aktiv Steuerbefehle von der Steuerbox? (Anwendungsebene)">
            {state.verbunden ? "Datenaustausch aktiv" : "kein Datenaustausch"}
          </div>
          <div className={`eebus-badge${state.heartbeatOk ? " on" : " warn"}`} title="Lebenszeichen der Steuerbox innerhalb des erwarteten Intervalls?">Heartbeat {state.heartbeatOk ? "ok" : "–"}</div>
          {state.failsafeAktiv && <div className="eebus-badge alarm">Failsafe aktiv</div>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Steuerbox-SKI: <strong>{state.steuerboxSki ?? "–"}</strong> · letzter Kontakt: {fmtZeit(state.letzterKontakt)}
        </p>
        {state.eigenerSki && (
          <p className="hint">
            Eigener SKI (für die Registrierung beim Netzbetreiber):{" "}
            <strong className="eebus-ski">{state.eigenerSki}</strong>
          </p>
        )}
        <p className="hint" style={{ marginTop: 6, fontStyle: "italic" }}>
          Zur Einordnung: „Datenaustausch aktiv" bezieht sich auf die
          Anwendungsebene (fließen gerade Steuerbefehle?). Ob die Steuerbox
          überhaupt mit dem Transport gekoppelt ist, steht weiter unten als
          „Steuerbox gekoppelt". Beides kann auseinanderfallen: Die Kopplung kann
          bestehen und der Heartbeat laufen, während gerade kein aktiver Befehl
          ausgetauscht wird – dann ist die Kopplung ok, aber „kein Datenaustausch".
        </p>
        <div className="eebus-limit-row">
          <LimitCard titel="Bezugsbegrenzung" para="§14a · LPC" limit={state.lpc} />
          <LimitCard titel="Einspeisebegrenzung" para="§9 · LPP" limit={state.lpp} />
        </div>
        {state.lpc.aktiv && (
          <p className="hint lpp-hinweis-14a">
            Hinweis: Die §14a-Bezugsbegrenzung wird empfangen und unten gegen den
            Bezug der steuerbaren Einrichtungen überwacht. Ein aktiver Eingriff
            (Lasten zurückfahren) findet bewusst nicht statt (siehe Hilfe).
          </p>
        )}
      </section>

      {/* Konfiguration & Transport (zusammengeführt, in sinnvoller Reihenfolge:
          1. Anbindung aktivieren, 2. SKIs eintragen+speichern, 3. an Sidecar
          übertragen, 4. Failsafe) */}
      <section className="card">
        <h3>Konfiguration &amp; Transport</h3>
        <p className="hint">
          Die eigentliche EEBUS-Kommunikation (SHIP/SPINE) übernimmt ein separater
          Sidecar-Prozess, der empfangene Befehle an FLUX meldet. Hier wird die
          Anbindung eingerichtet: zuerst die SKIs eintragen und speichern, dann an
          den Sidecar übertragen.
        </p>

        {/* Schritt 1: Anbindung */}
        <div className="src-grid">
          <label>EEBUS-Anbindung</label>
          <button className={`tile-sort-toggle${state.enabled ? " active" : ""}`} onClick={toggleEnabled}>
            {state.enabled ? "aktiviert" : "deaktiviert"}
          </button>
        </div>

        {/* Schritt 2: SKIs eintragen + speichern */}
        <div className="src-grid">
          <label>Eigener SKI (FLUX)</label>
          <input type="text" value={eigenerSki} onChange={(e) => setEigenerSki(e.target.value)} placeholder="wird beim echten Transport erzeugt" />
        </div>
        <div className="src-grid">
          <label>Steuerbox-SKI</label>
          <input type="text" value={steuerboxSki} onChange={(e) => setSteuerboxSki(e.target.value)} placeholder="SKI der Steuerbox (vom Netzbetreiber)" />
        </div>
        <button className="src-add-btn" onClick={saveSkis}>SKI speichern</button>

        {/* Schritt 3: Transport-Status + Übertragung an Sidecar */}
        <h4 className="eebus-h4">Transport (Sidecar)</h4>
        <div className="eebus-status-grid">
          <div className={`eebus-badge${sidecarRunning ? " on" : " warn"}`}>
            Sidecar {sidecarRunning ? "läuft" : "nicht erreichbar"}
          </div>
          {sidecarRunning && sidecarInfo?.connected != null && (
            <div className={`eebus-badge${sidecarInfo.connected ? " on" : " warn"}`} title="Besteht auf Transportebene (SHIP) eine Kopplung zur Steuerbox?">
              Steuerbox {sidecarInfo.connected ? "gekoppelt" : "nicht gekoppelt"}
            </div>
          )}
        </div>
        {sidecarRunning && sidecarInfo?.ownSki && (
          <p className="hint" style={{ marginTop: 6 }}>Sidecar meldet eigenen SKI: <strong className="eebus-ski">{sidecarInfo.ownSki}</strong></p>
        )}
        <div className="src-grid" style={{ marginTop: 8 }}>
          <label>Steuerbox-SKI an Sidecar</label>
          <button className="src-add-btn" onClick={pushSkiToSidecar} disabled={!sidecarRunning}>
            SKI an Sidecar übertragen
          </button>
        </div>
        {!sidecarRunning && (
          <p className="hint">
            Kein Sidecar erreichbar. Der Sidecar wird über die Start-Skripte
            (update.sh/start.sh) automatisch mitgestartet, sofern Binary und
            Zertifikate vorliegen. Ohne ihn funktioniert der Simulator unten trotzdem.
          </p>
        )}
        <p className="hint">
          Zum realistischen Testen mit echter EEBUS-Kommunikation lässt sich eine
          virtuelle Steuerbox koppeln, die LPC- und LPP-Befehle sendet. Anleitung:
          eebus-sidecar/TESTEN-MIT-SIMULATOR.md
        </p>

        {/* Schritt 4: Failsafe */}
        <h4 className="eebus-h4">Failsafe-Werte</h4>
        <p className="hint">Grenzwerte, die bei Kommunikationsausfall gelten (werden i. d. R. von der Steuerbox gesetzt, hier manuell hinterlegbar).</p>
        <div className="eebus-fs-grid">
          <div>
            <div className="eebus-fs-titel">Bezug (§14a)</div>
            <label>Leistung (W)</label>
            <input type="number" value={lpcFsWert} onChange={(e) => setLpcFsWert(Number(e.target.value))} />
            <label>Dauer (s)</label>
            <input type="number" value={lpcFsDauer} onChange={(e) => setLpcFsDauer(Number(e.target.value))} />
          </div>
          <div>
            <div className="eebus-fs-titel">Einspeisung (§9)</div>
            <label>Leistung (W)</label>
            <input type="number" value={lppFsWert} onChange={(e) => setLppFsWert(Number(e.target.value))} />
            <label>Dauer (s)</label>
            <input type="number" value={lppFsDauer} onChange={(e) => setLppFsDauer(Number(e.target.value))} />
          </div>
        </div>
        <button className="src-add-btn" onClick={saveFailsafe}>Failsafe speichern</button>
        {saved && <span className="exthems-formel-ok" style={{ marginLeft: 10 }}>gespeichert</span>}
      </section>

      {/* §14a-Überwachung (SteuVE-Bezug) */}
      <LpcMonitor />

      {/* §9-Umsetzung über Growatt */}
      <LppControlConfig />

      {/* Simulator */}
      <section className="card">
        <h3>Simulator</h3>
        <p className="hint">
          Zum Testen ohne echte Steuerbox: Steuerbefehle einspielen. Sie durchlaufen
          exakt denselben internen Empfangsweg wie später echte EEBUS-Befehle.
        </p>
        <div className="eebus-sim-row">
          <select value={simUseCase} onChange={(e) => setSimUseCase(e.target.value as "lpc" | "lpp")}>
            <option value="lpc">Bezug (§14a · LPC)</option>
            <option value="lpp">Einspeisung (§9 · LPP)</option>
          </select>
          <label>Wert (W)</label>
          <input type="number" value={simWert} onChange={(e) => setSimWert(Number(e.target.value))} style={{ maxWidth: 110 }} />
          <label>Dauer (s)</label>
          <input type="number" value={simDauer} onChange={(e) => setSimDauer(Number(e.target.value))} style={{ maxWidth: 110 }} />
        </div>
        <div className="eebus-sim-btns">
          <button className="src-add-btn" onClick={() => simulate("connect")}>Verbinden</button>
          <button className="src-add-btn" onClick={() => simulate("heartbeat")}>Heartbeat</button>
          <button className="src-add-btn" onClick={() => simulate("limit")}>Limit setzen</button>
          <button className="src-add-btn" onClick={() => simulate("release")}>Limit aufheben</button>
          <button className="src-add-btn" onClick={() => simulate("failsafe")}>Failsafe</button>
          <button className="ie-cancel" onClick={() => simulate("disconnect")}>Trennen</button>
        </div>
      </section>

      {/* Log */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Ereignis-Protokoll</h3>
          <button className="ie-cancel" onClick={clearLog}>Protokoll leeren</button>
        </div>
        {logbuch.length === 0 ? (
          <p className="hint">Noch keine Ereignisse.</p>
        ) : (
          <table className="eebus-log-table">
            <thead>
              <tr><th>Zeit</th><th>Use Case</th><th>Art</th><th>Ereignis</th></tr>
            </thead>
            <tbody>
              {logbuch.map((e, i) => (
                <tr key={i} className={`eebus-log-${e.art}`}>
                  <td>{fmtZeit(e.ts)}</td>
                  <td>{e.useCase === "lpc" ? "Bezug" : e.useCase === "lpp" ? "Einspeisung" : "System"}</td>
                  <td>{e.art}</td>
                  <td>{e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
