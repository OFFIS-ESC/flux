// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback } from "react";

// §9-Einspeisedrosselung als Live-Regelung über mehrere Wechselrichter.
// Reihenfolge = Drosselpriorität (oben zuerst). Standard Dry-Run.

interface LppInverter {
  id: string; name: string; typ: "growatt" | "opendtu"; nennleistungW: number;
  sourceId?: string; autoErkannt?: boolean;
  kanal?: "http" | "mqtt"; httpUrl?: string; mqttUrl?: string; mqttTopic?: string;
  mqttAuthType?: "none" | "userpass" | "clientcert"; mqttUsername?: string; mqttPassword?: string;
  regProzent?: number; regMeterEnable?: number; regRate?: number; methode?: "prozent" | "absolut";
  opendtuHttpUrl?: string; opendtuSerial?: string; opendtuKanal?: "http" | "mqtt";
  opendtuMqttUrl?: string; opendtuMqttBasetopic?: string;
  opendtuMqttAuthType?: "none" | "userpass" | "clientcert"; opendtuMqttUsername?: string; opendtuMqttPassword?: string;
}
interface LppConfig {
  enabled: boolean; scharf: boolean; inverter: LppInverter[];
  persistent: boolean; reserveW: number; regelIntervalSek: number;
}
interface LppLogEntry { ts: string; scharf: boolean; text: string; fehler?: string; }
interface RegelStatus { limitAktiv: boolean; limitW: number; sollProzent: Record<string, number>; }

function fmtZeit(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LppControlConfig() {
  const [cfg, setCfg] = useState<LppConfig | null>(null);
  const [logbuch, setLogbuch] = useState<LppLogEntry[]>([]);
  const [regel, setRegel] = useState<RegelStatus | null>(null);

  const load = useCallback(() => {
    fetch("/api/lppcontrol/config").then((r) => r.json()).then((d) => {
      if (d?.config) setCfg(d.config);
      if (d?.log) setLogbuch(d.log);
      if (d?.regel) setRegel(d.regel);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  function save(patch: Partial<LppConfig>) {
    const next = { ...cfg, ...patch };
    fetch("/api/lppcontrol/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json()).then((d) => { if (d?.config) setCfg(d.config); load(); }).catch(() => {});
    if (cfg) setCfg(next as LppConfig);
  }
  function saveInverter(list: LppInverter[]) { save({ inverter: list }); }

  function addInverter(typ: "growatt" | "opendtu") {
    if (!cfg) return;
    const id = `wr_${Date.now().toString(36)}`;
    const neu: LppInverter = typ === "growatt"
      ? { id, name: "Growatt", typ, nennleistungW: 6000, kanal: "http", httpUrl: "http://192.168.178.106", methode: "prozent", regProzent: 3, regMeterEnable: 122, regRate: 123 }
      : { id, name: "Hoymiles", typ, nennleistungW: 2000, opendtuKanal: "http", opendtuHttpUrl: "http://192.168.178.39", opendtuSerial: "" };
    saveInverter([...(cfg.inverter ?? []), neu]);
  }
  function updateInverter(i: number, patch: Partial<LppInverter>) {
    if (!cfg) return;
    saveInverter(cfg.inverter.map((inv, idx) => (idx === i ? { ...inv, ...patch } : inv)));
  }
  function removeInverter(i: number) {
    if (!cfg) return;
    saveInverter(cfg.inverter.filter((_, idx) => idx !== i));
  }
  function moveInverter(i: number, dir: -1 | 1) {
    if (!cfg) return;
    const list = [...cfg.inverter];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveInverter(list);
  }
  function testInverter(invId: string, prozent: number) {
    fetch("/api/lppcontrol/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invId, prozent }),
    }).then((r) => r.json()).then(() => load()).catch(() => {});
  }

  function autoErkennen() {
    fetch("/api/lppcontrol/erkennen").then((r) => r.json()).then((d) => {
      if (!d?.inverter || !cfg) return;
      // Vorschlag mit bestehenden manuellen WR zusammenführen: erkannte WR
      // (per sourceId) übernehmen/aktualisieren, manuell angelegte behalten.
      const erkannteIds = new Set(d.inverter.map((w: LppInverter) => w.sourceId));
      const manuell = cfg.inverter.filter((w) => !w.sourceId || !erkannteIds.has(w.sourceId));
      // Bestehende Nennleistung/Namen für schon geführte sourceIds erhalten.
      const altBySource = new Map(cfg.inverter.filter((w) => w.sourceId).map((w) => [w.sourceId!, w]));
      const zusammen = d.inverter.map((w: LppInverter) => {
        const alt = altBySource.get(w.sourceId!);
        return alt ? { ...w, nennleistungW: alt.nennleistungW || w.nennleistungW, name: alt.name || w.name } : w;
      });
      saveInverter([...zusammen, ...manuell]);
    }).catch(() => {});
  }

  if (!cfg) return null;

  return (
    <section className="card">
      <h3>§9-Umsetzung – Einspeisedrosselung (Live-Regelung)</h3>
      <p className="hint">
        §9 begrenzt die Einspeiseleistung am Netzpunkt – Eigenverbrauch bleibt möglich.
        FLUX regelt live: Wechselrichter werden nur so weit gedrosselt, wie die
        tatsächliche Einspeisung die Grenze übersteigt, entlang der Reihenfolge unten
        (oben zuerst). Sinkt die Einspeisung, wird in umgekehrter Reihenfolge wieder
        hochgeregelt. <strong>Standard ist Dry-Run.</strong>
      </p>

      <div className="src-grid">
        <label>§9-Umsetzung</label>
        <button className={`tile-sort-toggle${cfg.enabled ? " active" : ""}`} onClick={() => save({ enabled: !cfg.enabled })}>
          {cfg.enabled ? "aktiv" : "inaktiv"}
        </button>
      </div>
      <div className="src-grid">
        <label>Ausführung</label>
        <div className="lpp-scharf-row">
          <button className={`tile-sort-toggle${cfg.scharf ? " lpp-scharf" : ""}`} onClick={() => save({ scharf: !cfg.scharf })}>
            {cfg.scharf ? "SCHARF (sendet echt)" : "Dry-Run (nur Log)"}
          </button>
          {cfg.scharf && <span className="lpp-warnung">Achtung: schreibt real in die Wechselrichter</span>}
        </div>
      </div>
      <div className="src-grid">
        <label>Limit-Typ</label>
        <select value={cfg.persistent ? "persistent" : "nonpersistent"} onChange={(e) => save({ persistent: e.target.value === "persistent" })}>
          <option value="nonpersistent">nicht-persistent (schont WR-Speicher)</option>
          <option value="persistent">persistent (bleibt nach WR-Neustart)</option>
        </select>
      </div>
      <div className="src-grid">
        <label>Reserve zur Grenze (W)</label>
        <input type="number" value={cfg.reserveW} onChange={(e) => save({ reserveW: Number(e.target.value) })} style={{ maxWidth: 120 }} />
      </div>

      {/* aktueller Regelstatus */}
      {regel?.limitAktiv && (
        <div className="lpp-regel-status">
          Aktives Einspeiselimit: <strong>{regel.limitW} W</strong>. Aktuelle WR-Sollwerte:{" "}
          {cfg.inverter.map((inv) => `${inv.name} ${regel.sollProzent[inv.id] ?? 100}%`).join(" · ") || "–"}
        </div>
      )}

      <h4 className="eebus-h4">Wechselrichter (Drossel-Reihenfolge)</h4>
      <p className="hint">
        Steuerbare Wechselrichter werden automatisch aus den Quellen erkannt
        (Growatt und Hoymiles/OpenDTU). Die Ist-Leistung je Gerät kommt aus der
        jeweiligen Quelle; die Nennleistung trägst du einmalig ein.
      </p>
      <div className="lpp-add-btns" style={{ marginBottom: 8 }}>
        <button className="src-add-btn" onClick={autoErkennen}>Automatisch aus Quellen erkennen</button>
      </div>
      {cfg.inverter.length === 0 && <p className="hint">Noch keine Wechselrichter. Nutze „Automatisch erkennen" oder füge manuell hinzu.</p>}
      {cfg.inverter.map((inv, i) => (
        <div key={inv.id} className="lpp-wr-card">
          <div className="lpp-wr-head">
            <span className="lpp-wr-nr">{i + 1}</span>
            <input type="text" value={inv.name} onChange={(e) => updateInverter(i, { name: e.target.value })} style={{ maxWidth: 160 }} />
            <span className="lpp-wr-typ">{inv.typ === "growatt" ? "Growatt" : "Hoymiles/OpenDTU"}</span>
            {inv.autoErkannt && <span className="lpp-auto-badge">auto</span>}
            <button className="lpp-move" onClick={() => moveInverter(i, -1)} disabled={i === 0} title="nach oben">▲</button>
            <button className="lpp-move" onClick={() => moveInverter(i, 1)} disabled={i === cfg.inverter.length - 1} title="nach unten">▼</button>
            <button className="ie-cancel" onClick={() => removeInverter(i)}>entfernen</button>
          </div>
          <div className="src-grid">
            <label>Nennleistung (W)</label>
            <input type="number" value={inv.nennleistungW} onChange={(e) => updateInverter(i, { nennleistungW: Number(e.target.value) })} style={{ maxWidth: 120 }} />
          </div>
          {(!inv.nennleistungW || inv.nennleistungW <= 0) && (
            <p className="hint lpp-warnung">Bitte Nennleistung eintragen – sie wird für die prozentuale Drosselung benötigt.</p>
          )}

          {inv.typ === "growatt" ? (<>
            <div className="src-grid">
              <label>Methode</label>
              <select value={inv.methode ?? "prozent"} onChange={(e) => updateInverter(i, { methode: e.target.value as LppInverter["methode"] })}>
                <option value="prozent">Prozent (Register {inv.regProzent ?? 3})</option>
                <option value="absolut">Meterbasiert ({inv.regMeterEnable ?? 122}/{inv.regRate ?? 123})</option>
              </select>
            </div>
            <div className="src-grid">
              <label>Kanal</label>
              <select value={inv.kanal ?? "http"} onChange={(e) => updateInverter(i, { kanal: e.target.value as "http" | "mqtt" })}>
                <option value="http">HTTP (/postCommunicationModbus)</option>
                <option value="mqtt">MQTT-Command</option>
              </select>
            </div>
            {(inv.kanal ?? "http") === "http" ? (
              <div className="src-grid">
                <label>Stick-URL</label>
                <input type="text" value={inv.httpUrl ?? ""} onChange={(e) => updateInverter(i, { httpUrl: e.target.value })} placeholder="http://192.168.178.106" />
              </div>
            ) : (<>
              <div className="src-grid"><label>MQTT-URL</label><input type="text" value={inv.mqttUrl ?? ""} onChange={(e) => updateInverter(i, { mqttUrl: e.target.value })} /></div>
              <div className="src-grid"><label>Command-Topic</label><input type="text" value={inv.mqttTopic ?? ""} onChange={(e) => updateInverter(i, { mqttTopic: e.target.value })} /></div>
            </>)}
          </>) : (<>
            <div className="src-grid">
              <label>Kanal</label>
              <select value={inv.opendtuKanal ?? "http"} onChange={(e) => updateInverter(i, { opendtuKanal: e.target.value as "http" | "mqtt" })}>
                <option value="http">HTTP (/api/limit/config)</option>
                <option value="mqtt">MQTT-Command</option>
              </select>
            </div>
            <div className="src-grid">
              <label>WR-Seriennummer</label>
              <input type="text" value={inv.opendtuSerial ?? ""} onChange={(e) => updateInverter(i, { opendtuSerial: e.target.value })} placeholder="z.B. 114183720053" />
            </div>
            {(inv.opendtuKanal ?? "http") === "http" ? (
              <div className="src-grid">
                <label>OpenDTU-URL</label>
                <input type="text" value={inv.opendtuHttpUrl ?? ""} onChange={(e) => updateInverter(i, { opendtuHttpUrl: e.target.value })} placeholder="http://192.168.178.39" />
              </div>
            ) : (<>
              <div className="src-grid"><label>MQTT-URL</label><input type="text" value={inv.opendtuMqttUrl ?? ""} onChange={(e) => updateInverter(i, { opendtuMqttUrl: e.target.value })} /></div>
              <div className="src-grid"><label>Basetopic</label><input type="text" value={inv.opendtuMqttBasetopic ?? ""} onChange={(e) => updateInverter(i, { opendtuMqttBasetopic: e.target.value })} placeholder="z.B. solar" /></div>
            </>)}
          </>)}

          <div className="lpp-wr-test">
            <button className="src-add-btn" onClick={() => testInverter(inv.id, 50)}>Test 50%</button>
            <button className="src-add-btn" onClick={() => testInverter(inv.id, 100)}>Test 100%</button>
            {regel?.limitAktiv && <span className="lpp-wr-soll">aktuell: {regel.sollProzent[inv.id] ?? 100}%</span>}
          </div>
        </div>
      ))}
      <div className="lpp-add-btns">
        <button className="src-add-btn" onClick={() => addInverter("growatt")}>+ Growatt-WR</button>
        <button className="src-add-btn" onClick={() => addInverter("opendtu")}>+ Hoymiles-WR (OpenDTU)</button>
      </div>

      <h4 className="eebus-h4">Protokoll der Ansteuerung</h4>
      {logbuch.length === 0 ? (
        <p className="hint">Noch keine Ansteuerungen.</p>
      ) : (
        <table className="eebus-log-table">
          <thead><tr><th>Zeit</th><th>Modus</th><th>Ereignis</th><th>Status</th></tr></thead>
          <tbody>
            {logbuch.map((e, i) => (
              <tr key={i} className={e.fehler ? "eebus-log-failsafe" : e.scharf ? "eebus-log-limit" : ""}>
                <td>{fmtZeit(e.ts)}</td>
                <td>{e.scharf ? "scharf" : "Dry-Run"}</td>
                <td>{e.text}</td>
                <td>{e.fehler ? <span className="exthems-formel-err">{e.fehler}</span> : "ok"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
