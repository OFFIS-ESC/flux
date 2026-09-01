// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

interface NotifySettings {
  enabled: boolean;
  server: string;
  topic: string;
  minIntervalMin: number;
}

export function BenachrichtigungenPage() {
  const [s, setS] = useState<NotifySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/notify")
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS(null));
  }, []);

  function set<K extends keyof NotifySettings>(k: K, v: NotifySettings[K]) {
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
    setSaved(false);
  }

  async function save() {
    if (!s) return;
    setMsg(null);
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: s }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ ok: false, text: d.error ?? "Speichern fehlgeschlagen." });
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Speichern fehlgeschlagen." });
    }
  }

  async function test() {
    if (!s) return;
    setMsg(null);
    // Vor dem Test speichern, damit der Server das aktuelle Topic nutzt.
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: s }),
    });
    try {
      const res = await fetch("/api/notify/test", { method: "POST" });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ ok: false, text: `Test fehlgeschlagen: ${d.error ?? "unbekannt"}` });
      } else {
        setMsg({ ok: true, text: "Testbenachrichtigung gesendet – prüfe dein ntfy-Gerät." });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Test fehlgeschlagen." });
    }
  }

  async function testDaily() {
    setMsg(null);
    try {
      const res = await fetch("/api/rules/trigger-daily-test", { method: "POST" });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ ok: false, text: `Test fehlgeschlagen: ${d.error ?? "unbekannt"}` });
      } else {
        setMsg({
          ok: true,
          text: "Tageswechsel simuliert – eine aktive „Tageswechsel\"-Regel löst in den nächsten Sekunden aus. Prüfe dein ntfy-Gerät.",
        });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Test fehlgeschlagen." });
    }
  }

  if (!s) return <div className="page"><h2>Benachrichtigungen</h2><p>lädt…</p></div>;

  const topicUrl = `${(s.server || "https://ntfy.sh").replace(/\/+$/, "")}/${s.topic}`;

  return (
    <div className="page">
      <h2>Benachrichtigungen</h2>
      <p className="hint">
        FLUX kann dir Push-Benachrichtigungen über den kostenlosen Dienst{" "}
        <strong>ntfy</strong> senden – ohne Konto. Installiere die ntfy-App
        (Android/iOS) oder öffne die Weboberfläche, abonniere dort dein Topic,
        und FLUX schickt Meldungen an genau dieses Topic. Wähle einen möglichst
        eindeutigen, schwer zu erratenden Topic-Namen, da jeder mit Kenntnis des
        Namens mitlesen kann.
      </p>

      {msg && (
        <p className={msg.ok ? "ie-msg-ok" : "ie-msg-err"}>
          {msg.ok ? "✓ " : "⚠ "}{msg.text}
        </p>
      )}

      <section className="card">
        <h3>ntfy-Konfiguration</h3>
        <label className="notify-row">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <span>Benachrichtigungen aktiv</span>
        </label>

        <div className="notify-grid">
          <label>Server</label>
          <input value={s.server} onChange={(e) => set("server", e.target.value)} placeholder="https://ntfy.sh" />

          <label>Topic</label>
          <input value={s.topic} onChange={(e) => set("topic", e.target.value)} placeholder="z.B. flux-mein-haus" />
        </div>

        <p className="hint" style={{ marginTop: 6 }}>
          Dein Topic-Link: <code>{topicUrl}</code>
        </p>

        <div className="notify-actions">
          <button onClick={test} className="notify-test">Testbenachrichtigung senden</button>
          <button onClick={testDaily} className="notify-test">Tageswechsel-Regel testen</button>
        </div>
      </section>

      <section className="card">
        <h3>Auslöser</h3>
        <p className="hint">
          <strong>Wann</strong> Benachrichtigungen gesendet werden, legst du
          zentral unter <strong>Einstellungen → Automatisierungsregeln</strong>{" "}
          fest: Lege dort eine Regel mit der Aktion „Push-Nachricht" an (z.&nbsp;B.
          negativer Börsenpreis, Quelle offline, Batterie niedrig, §14a-Drosselung
          oder ein Gerät ohne Verbrauch). So bleiben alle Auslöser an einem Ort.
        </p>
        <p className="hint">
          <strong>Automatisch</strong> – ohne eigene Regel – meldet FLUX zusätzlich
          echte Netzbetreiber-Eingriffe über EEBUS: Sobald eine §9-Einspeise- oder
          §14a-Bezugsbegrenzung eingeht oder wieder aufgehoben wird, erhältst du eine
          Push-Nachricht mit den Details (Paragraf, Grenzwert, Dauer). Dafür genügt
          es, hier ein Topic zu hinterlegen und die Benachrichtigungen zu aktivieren.
        </p>

        <div className="notify-grid" style={{ marginTop: 10 }}>
          <label>Mindestabstand gleicher Meldungen (Min.)</label>
          <input
            type="number"
            min={0}
            max={1440}
            value={s.minIntervalMin}
            onChange={(e) => set("minIntervalMin", Number(e.target.value))}
            style={{ maxWidth: 90 }}
          />
        </div>
        <p className="hint" style={{ fontSize: 12 }}>
          Verhindert, dass dieselbe Meldung in kurzer Zeit mehrfach kommt.
        </p>
      </section>

      <div className="notify-actions">
        <button onClick={save} className="ie-primary">Speichern</button>
        {saved && <span className="src-testok">✓ gespeichert</span>}
      </div>
    </div>
  );
}
