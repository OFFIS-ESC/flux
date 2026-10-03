// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

interface Channel { id: string; name: string; server: string; topic: string; priority: number; enabled: boolean; }
interface TriggerGruppe { kategorie: string; triggers: Array<{ id: string; label: string }> }

export function BenachrichtigungenPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [gruppen, setGruppen] = useState<TriggerGruppe[]>([]);
  const [routing, setRouting] = useState<Record<string, string[]>>({});
  const [gespeichert, setGespeichert] = useState("");
  const [dragTrigger, setDragTrigger] = useState<string | null>(null);
  const [testMeldung, setTestMeldung] = useState("");

  useEffect(() => {
    fetch("/api/notify/channels").then((r) => r.json()).then((j) => { if (j.ok) setChannels(j.channels ?? []); });
    fetch("/api/notify/triggers").then((r) => r.json()).then((j) => { if (j.ok) setGruppen(j.gruppen ?? []); });
    fetch("/api/notify/routing").then((r) => r.json()).then((j) => { if (j.ok) setRouting(j.routing ?? {}); });
  }, []);

  const speichereChannels = (next: Channel[]) => {
    setChannels(next);
    fetch("/api/notify/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channels: next }) })
      .then(() => { setGespeichert("Kanäle gespeichert"); setTimeout(() => setGespeichert(""), 2000); }).catch(() => {});
  };
  const speichereRouting = (next: Record<string, string[]>) => {
    setRouting(next);
    fetch("/api/notify/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routing: next }) }).catch(() => {});
  };

  const neuerKanal = () => {
    const id = `ch_${Date.now()}`;
    speichereChannels([...channels, { id, name: "Neuer Kanal", server: "https://ntfy.sh", topic: "", priority: 3, enabled: true }]);
  };
  const updateKanal = (id: string, patch: Partial<Channel>) => speichereChannels(channels.map((c) => c.id === id ? { ...c, ...patch } : c));
  const loescheKanal = (id: string) => {
    speichereChannels(channels.filter((c) => c.id !== id));
    const next: Record<string, string[]> = {};
    for (const k of Object.keys(routing)) { const r = routing[k].filter((x) => x !== id); if (r.length) next[k] = r; }
    speichereRouting(next);
  };

  const zuordnen = (triggerId: string, channelId: string) => {
    const aktuell = routing[triggerId] ?? [];
    if (aktuell.includes(channelId)) return;
    speichereRouting({ ...routing, [triggerId]: [...aktuell, channelId] });
  };
  const entfernen = (triggerId: string, channelId: string) => {
    const r = (routing[triggerId] ?? []).filter((x) => x !== channelId);
    const next = { ...routing };
    if (r.length) next[triggerId] = r; else delete next[triggerId];
    speichereRouting(next);
  };

  const triggerLabel = (id: string) => {
    for (const g of gruppen) { const t = g.triggers.find((x) => x.id === id); if (t) return t.label; }
    return id;
  };
  const triggersFuerKanal = (channelId: string) => Object.keys(routing).filter((t) => routing[t].includes(channelId));

  const testen = (channelId: string) => {
    setTestMeldung("");
    fetch("/api/notify/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId }) })
      .then((r) => r.json()).then((j) => setTestMeldung(j.ok ? "✓ Testnachricht gesendet" : `Fehler: ${j.error ?? "?"}`))
      .catch(() => setTestMeldung("Test fehlgeschlagen"));
  };

  return (
    <div className="page">
      <h2 className="page-maintitle">Benachrichtigungen</h2>
      <p className="hint">
        Lege mehrere ntfy-Kanäle an und ordne jedem Kanal die gewünschten Auslöser zu.
        So kann jede Person nur die Kanäle abonnieren, die sie interessieren. Ziehe einen
        Auslöser aus der linken Liste auf einen Kanal.
      </p>
      {gespeichert && <p className="hint" style={{ color: "#1d7a3a" }}>{gespeichert}</p>}

      <div className="notify-layout">
        <div className="card notify-trigger-liste">
          <h3>Verfügbare Auslöser</h3>
          {gruppen.length === 0 && <p className="hint">Keine Auslöser gefunden.</p>}
          {gruppen.map((g) => (
            <div key={g.kategorie} className="notify-trigger-gruppe">
              <div className="notify-trigger-kat">{g.kategorie}</div>
              {g.triggers.map((t) => {
                const zugeordnet = (routing[t.id] ?? []).length;
                return (
                  <div key={t.id} className={`notify-trigger${zugeordnet ? " zugeordnet" : ""}`}
                    draggable onDragStart={() => setDragTrigger(t.id)} onDragEnd={() => setDragTrigger(null)}
                    title={zugeordnet ? `${zugeordnet} Kanal/Kanäle` : "noch keinem Kanal zugeordnet"}>
                    <span className="notify-trigger-grip">⠿</span>
                    <span className="notify-trigger-label">{t.label}</span>
                    {zugeordnet > 0 && <span className="notify-trigger-badge">{zugeordnet}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="notify-channels">
          <div className="notify-channels-head">
            <h3>Kanäle</h3>
            <button className="src-add-btn" onClick={neuerKanal}>+ Kanal</button>
          </div>
          {channels.length === 0 && <p className="hint">Noch keine Kanäle. Lege einen an.</p>}
          {channels.map((c) => {
            const topicUrl = `${(c.server || "https://ntfy.sh").replace(/\/+$/, "")}/${c.topic}`;
            const zugeordnet = triggersFuerKanal(c.id);
            return (
              <div key={c.id} className={`card notify-channel${!c.enabled ? " aus" : ""}`}
                onDragOver={(e) => { if (dragTrigger) e.preventDefault(); }}
                onDrop={() => { if (dragTrigger) { zuordnen(dragTrigger, c.id); setDragTrigger(null); } }}>
                <div className="notify-channel-kopf">
                  <input className="notify-channel-name" value={c.name} onChange={(e) => updateKanal(c.id, { name: e.target.value })} />
                  <label className="notify-channel-aktiv"><input type="checkbox" checked={c.enabled} onChange={(e) => updateKanal(c.id, { enabled: e.target.checked })} /> aktiv</label>
                  <button className="notify-channel-del" title="Kanal löschen" onClick={() => loescheKanal(c.id)}>✕</button>
                </div>
                <div className="notify-channel-felder">
                  <label>Server</label>
                  <input value={c.server} onChange={(e) => updateKanal(c.id, { server: e.target.value })} placeholder="https://ntfy.sh" />
                  <label>Topic</label>
                  <input value={c.topic} onChange={(e) => updateKanal(c.id, { topic: e.target.value })} placeholder="z.B. flux-haus-alarm" />
                  <label>Priorität</label>
                  <select value={c.priority} onChange={(e) => updateKanal(c.id, { priority: Number(e.target.value) })}>
                    <option value={1}>1 – min</option><option value={2}>2 – niedrig</option>
                    <option value={3}>3 – normal</option><option value={4}>4 – hoch</option><option value={5}>5 – dringend</option>
                  </select>
                </div>
                {c.topic && <p className="hint" style={{ fontSize: 11 }}>Abo-Link: <code>{topicUrl}</code> <button className="notify-test-btn" onClick={() => testen(c.id)}>Test</button></p>}
                <div className="notify-channel-drop">
                  {zugeordnet.length === 0 ? (
                    <span className="notify-drop-hint">Auslöser hierher ziehen …</span>
                  ) : zugeordnet.map((tid) => (
                    <span key={tid} className="notify-chip">
                      {triggerLabel(tid)}
                      <button onClick={() => entfernen(tid, c.id)} title="entfernen">✕</button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {testMeldung && <p className="hint">{testMeldung}</p>}
        </div>
      </div>
    </div>
  );
}
