// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

// Konfiguration einer "Datenbereitstellung für externes HEMS"-Senke:
// Broker + Authentifizierung, mehrere Publish-Topics mit per Drag&Drop
// zugeordneten Größen, eigene Formel-Größen und die generierte
// Schnittstellenbeschreibung.

export interface ExtHemsPublishTopic {
  topic: string;
  groessen: string[];
  retain?: boolean;
}
export interface ExtHemsFormelGroesse {
  id: string;
  name: string;
  einheit: string;
  formel: string;
}
interface HemsGroesse {
  id: string;
  name: string;
  einheit: string;
  beschreibung: string;
}
// Nur die für diese Komponente relevanten Felder der Senke.
export interface ExtHemsSink {
  id: string;
  name: string;
  mqttUrl?: string;
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientCert?: string;
  mqttClientKey?: string;
  mqttCaCert?: string;
  mqttRejectUnauthorized?: boolean;
  extHemsTopics?: ExtHemsPublishTopic[];
  extHemsFormeln?: ExtHemsFormelGroesse[];
  extHemsChangeThreshold?: number;
}

export function ExtHemsConfig({ sink, onChange }: {
  sink: ExtHemsSink;
  onChange: (patch: Partial<ExtHemsSink>) => void;
}) {
  const [katalog, setKatalog] = useState<HemsGroesse[]>([]);
  const [beschreibung, setBeschreibung] = useState<string | null>(null);
  const [formelCheck, setFormelCheck] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [dragGroesse, setDragGroesse] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/exthems/groessen")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.groessen) setKatalog(d.groessen); })
      .catch(() => {});
  }, []);

  const topics = sink.extHemsTopics ?? [];
  const formeln = sink.extHemsFormeln ?? [];
  // Alle zuordenbaren Größen = kuratierte + eigene Formeln.
  const alleGroessen: HemsGroesse[] = [
    ...katalog,
    ...formeln.map((f) => ({ id: f.id, name: f.name, einheit: f.einheit, beschreibung: `Formel: ${f.formel}` })),
  ];
  const groesseName = (id: string) => alleGroessen.find((g) => g.id === id)?.name ?? id;
  const groesseEinheit = (id: string) => alleGroessen.find((g) => g.id === id)?.einheit ?? "";

  function setTopics(next: ExtHemsPublishTopic[]) { onChange({ extHemsTopics: next }); }
  function addTopic() { setTopics([...topics, { topic: "", groessen: [], retain: true }]); }
  function removeTopic(i: number) { setTopics(topics.filter((_, idx) => idx !== i)); }
  function updateTopic(i: number, patch: Partial<ExtHemsPublishTopic>) {
    setTopics(topics.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function addGroesseToTopic(i: number, gid: string) {
    const t = topics[i];
    if (t.groessen.includes(gid)) return;
    updateTopic(i, { groessen: [...t.groessen, gid] });
  }
  function removeGroesseFromTopic(i: number, gid: string) {
    updateTopic(i, { groessen: topics[i].groessen.filter((g) => g !== gid) });
  }
  // Drag&Drop-Umsortierung innerhalb eines Topics.
  function reorderInTopic(i: number, from: string, to: string) {
    const g = [...topics[i].groessen];
    const fi = g.indexOf(from), ti = g.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    g.splice(fi, 1); g.splice(ti, 0, from);
    updateTopic(i, { groessen: g });
  }

  function setFormeln(next: ExtHemsFormelGroesse[]) { onChange({ extHemsFormeln: next }); }
  function addFormel() {
    const id = `formel_${Date.now().toString(36)}`;
    setFormeln([...formeln, { id, name: "Neue Größe", einheit: "W", formel: "" }]);
  }
  function updateFormel(i: number, patch: Partial<ExtHemsFormelGroesse>) {
    setFormeln(formeln.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeFormel(i: number) {
    const f = formeln[i];
    setFormeln(formeln.filter((_, idx) => idx !== i));
    // Auch aus allen Topics entfernen.
    setTopics(topics.map((t) => ({ ...t, groessen: t.groessen.filter((g) => g !== f.id) })));
  }
  async function checkFormel(i: number) {
    const f = formeln[i];
    try {
      const r = await fetch("/api/exthems/formel/check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formel: f.formel }),
      }).then((x) => x.json());
      setFormelCheck((prev) => ({ ...prev, [f.id]: r }));
    } catch { /* ignore */ }
  }

  async function ladeBeschreibung() {
    try {
      const r = await fetch("/api/exthems/beschreibung", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sink }),
      }).then((x) => x.json());
      setBeschreibung(r?.ok ? r.text : (r?.error ?? "Fehler"));
    } catch { setBeschreibung("Fehler beim Erzeugen der Beschreibung."); }
  }

  return (
    <div className="exthems-config">
      <p className="hint">
        FLUX veröffentlicht ausgewählte Größen per MQTT an einen Broker, damit ein
        externes HEMS (z. B. das eines §42c-Abnehmers) darauf reagieren kann.
        Publiziert wird als JSON-Objekt, nur bei Wertänderung.
      </p>

      {/* Broker + Authentifizierung */}
      <h4 className="exthems-h4">Broker</h4>
      <div className="src-grid">
        <label>Broker-URL</label>
        <input
          type="text" placeholder="mqtts://broker.example:8883"
          value={sink.mqttUrl ?? ""}
          onChange={(e) => onChange({ mqttUrl: e.target.value })}
        />
      </div>
      <div className="src-grid">
        <label>Authentifizierung</label>
        <select
          value={sink.mqttAuthType ?? "none"}
          onChange={(e) => onChange({ mqttAuthType: e.target.value as ExtHemsSink["mqttAuthType"] })}
        >
          <option value="none">keine</option>
          <option value="userpass">Benutzer/Passwort</option>
          <option value="clientcert">Client-Zertifikat</option>
        </select>
      </div>
      {sink.mqttAuthType === "userpass" && (<>
        <div className="src-grid">
          <label>Benutzer</label>
          <input type="text" value={sink.mqttUsername ?? ""} onChange={(e) => onChange({ mqttUsername: e.target.value })} />
        </div>
        <div className="src-grid">
          <label>Passwort</label>
          <input type="password" value={sink.mqttPassword ?? ""} onChange={(e) => onChange({ mqttPassword: e.target.value })} />
        </div>
      </>)}
      {sink.mqttAuthType === "clientcert" && (<>
        <div className="src-grid">
          <label>Client-Zertifikat (PEM)</label>
          <textarea rows={3} value={sink.mqttClientCert ?? ""} onChange={(e) => onChange({ mqttClientCert: e.target.value })} />
        </div>
        <div className="src-grid">
          <label>Privater Schlüssel (PEM)</label>
          <textarea rows={3} value={sink.mqttClientKey ?? ""} onChange={(e) => onChange({ mqttClientKey: e.target.value })} />
        </div>
      </>)}
      <div className="src-grid">
        <label>CA-Zertifikat (PEM, optional)</label>
        <textarea rows={2} placeholder="leer = System-CA" value={sink.mqttCaCert ?? ""} onChange={(e) => onChange({ mqttCaCert: e.target.value })} />
      </div>
      <div className="src-grid">
        <label>Zertifikat prüfen</label>
        <input
          type="checkbox"
          checked={sink.mqttRejectUnauthorized !== false}
          onChange={(e) => onChange({ mqttRejectUnauthorized: e.target.checked })}
        />
      </div>
      <div className="src-grid">
        <label>Sende-Schwelle (Änderung)</label>
        <input
          type="number" step="0.1" min="0" style={{ maxWidth: 120 }}
          value={sink.extHemsChangeThreshold ?? 1}
          onChange={(e) => onChange({ extHemsChangeThreshold: Number(e.target.value) })}
        />
      </div>

      {/* Verfügbare Größen (Quelle für Drag&Drop) */}
      <h4 className="exthems-h4">Verfügbare Größen</h4>
      <p className="hint">Eine Größe in ein Topic ziehen, um sie zuzuordnen. Reihenfolge im Topic per Ziehen änderbar.</p>
      <div className="exthems-palette">
        {alleGroessen.map((g) => (
          <div
            key={g.id}
            className="exthems-chip draggable"
            draggable
            onDragStart={() => setDragGroesse(g.id)}
            onDragEnd={() => setDragGroesse(null)}
            title={g.beschreibung}
          >
            {g.name} <span className="exthems-unit">{g.einheit}</span>
          </div>
        ))}
      </div>

      {/* Publish-Topics */}
      <h4 className="exthems-h4">Publish-Topics</h4>
      {topics.length === 0 && <p className="hint">Noch keine Topics. Füge eines hinzu und ziehe Größen hinein.</p>}
      {topics.map((t, i) => (
        <div
          key={i}
          className="exthems-topic"
          onDragOver={(e) => { if (dragGroesse) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (dragGroesse) { addGroesseToTopic(i, dragGroesse); setDragGroesse(null); } }}
        >
          <div className="exthems-topic-head">
            <input
              type="text" className="exthems-topic-input" placeholder="flux/hems/verfuegbar"
              value={t.topic}
              onChange={(e) => updateTopic(i, { topic: e.target.value })}
            />
            <label className="exthems-retain">
              <input type="checkbox" checked={t.retain !== false} onChange={(e) => updateTopic(i, { retain: e.target.checked })} />
              retain
            </label>
            <button className="ie-cancel" onClick={() => removeTopic(i)}>Topic entfernen</button>
          </div>
          <div className="exthems-topic-groessen">
            {t.groessen.length === 0 && <span className="hint">Größen hierher ziehen…</span>}
            {t.groessen.map((gid) => (
              <div
                key={gid}
                className="exthems-chip assigned draggable"
                draggable
                onDragStart={(e) => { e.stopPropagation(); setDragGroesse(gid); }}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (dragGroesse && t.groessen.includes(dragGroesse)) reorderInTopic(i, dragGroesse, gid);
                  else if (dragGroesse) addGroesseToTopic(i, dragGroesse);
                  setDragGroesse(null);
                }}
                title={groesseName(gid)}
              >
                {groesseName(gid)} <span className="exthems-unit">{groesseEinheit(gid)}</span>
                <button className="exthems-chip-x" onClick={() => removeGroesseFromTopic(i, gid)} title="entfernen">×</button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button className="src-add-btn" onClick={addTopic}>+ Topic hinzufügen</button>

      {/* Eigene Formel-Größen */}
      <h4 className="exthems-h4">Eigene Formel-Größen</h4>
      <p className="hint">
        Berechne eigene Werte aus den verfügbaren Größen. Variablennamen = IDs der
        kuratierten Größen (z. B. verfuegbarerUeberschuss, batterieSoc, pvLeistung,
        hausverbrauch, netzleistung, sharingLeistung, restertragHeute).
      </p>
      {formeln.map((f, i) => {
        const chk = formelCheck[f.id];
        return (
          <div key={f.id} className="exthems-formel">
            <div className="exthems-formel-row">
              <input type="text" placeholder="Name" value={f.name} onChange={(e) => updateFormel(i, { name: e.target.value })} />
              <input type="text" placeholder="Einheit" style={{ maxWidth: 80 }} value={f.einheit} onChange={(e) => updateFormel(i, { einheit: e.target.value })} />
              <button className="ie-cancel" onClick={() => removeFormel(i)}>entfernen</button>
            </div>
            <div className="exthems-formel-row">
              <input
                type="text" className="exthems-formel-input" placeholder="z. B. verfuegbarerUeberschuss - hausverbrauch"
                value={f.formel}
                onChange={(e) => updateFormel(i, { formel: e.target.value })}
                onBlur={() => checkFormel(i)}
              />
            </div>
            {chk && (chk.ok
              ? <span className="exthems-formel-ok">Formel gültig</span>
              : <span className="exthems-formel-err">{chk.error ?? "ungültig"}</span>)}
          </div>
        );
      })}
      <button className="src-add-btn" onClick={addFormel}>+ Formel-Größe hinzufügen</button>

      {/* Schnittstellenbeschreibung */}
      <h4 className="exthems-h4">Schnittstellenbeschreibung</h4>
      <p className="hint">Erklärt dem externen HEMS, welche Topics welche Felder liefern. Zum Weitergeben.</p>
      <button className="src-add-btn" onClick={ladeBeschreibung}>Beschreibung erzeugen</button>
      {beschreibung != null && (
        <textarea className="exthems-beschreibung" rows={12} readOnly value={beschreibung} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
