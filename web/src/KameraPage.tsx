// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

interface SsCamera {
  number: number; name: string; connected: boolean;
  width?: number; height?: number; mdEnabled?: boolean; secondsSinceMotion?: number | null;
  sourceId: string;
}

// Kameraseite: zeigt die Live-Bilder aller SecuritySpy-Kameras. Die Bilder werden
// als JPEG-Snapshots über den Server-Proxy geladen (Zugangsdaten bleiben server-
// seitig) und in einem konfigurierbaren Intervall aktualisiert.
export function KameraPage() {
  const [cameras, setCameras] = useState<SsCamera[]>([]);
  const [tick, setTick] = useState(0);
  const [intervallMs, setIntervallMs] = useState(2000);
  const [liveVideo, setLiveVideo] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gross, setGross] = useState<{ sourceId: string; cam: number } | null>(null);

  const [aufnahmen, setAufnahmen] = useState<Array<{ title: string; href: string; length: number; updated: string; cameraNum: number; sourceId?: string }>>([]);
  const [aufnahmenLaden, setAufnahmenLaden] = useState(false);
  const [aufnahmenKamera, setAufnahmenKamera] = useState<number | "">("");
  const [videoAn, setVideoAn] = useState<{ sourceId: string; href: string; title: string } | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/securityspy/cameras").then((r) => r.json()).then((j) => {
        if (j?.ok) {
          setCameras(j.cameras ?? []);
          // Server-Fehler einer Quelle anzeigen, falls vorhanden.
          const srv = j.server ?? {};
          const err = Object.values(srv).map((s: any) => s?.error).find((e: any) => e);
          setFehler(err ?? null);
        }
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  // Bild-Aktualisierungs-Tick (nur im Bildmodus; der Live-Stream aktualisiert sich selbst).
  useEffect(() => {
    if (liveVideo) return;
    const t = setInterval(() => setTick((n) => n + 1), intervallMs);
    return () => clearInterval(t);
  }, [intervallMs, liveVideo]);

  // Aufnahmen automatisch laden, sobald Kameras da sind (Standard: alle).
  useEffect(() => {
    if (cameras.length > 0 && aufnahmen.length === 0 && !aufnahmenLaden) ladeAufnahmen(aufnahmenKamera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras.length]);

  const bildUrl = (c: SsCamera) => `/api/securityspy/image?sourceId=${encodeURIComponent(c.sourceId)}&cam=${c.number}&t=${tick}`;
  const streamUrl = (sourceId: string, cam: number) => `/api/securityspy/stream?sourceId=${encodeURIComponent(sourceId)}&cam=${cam}`;

  const bewText = (s: number | null | undefined) => {
    if (s == null) return "keine Angabe";
    if (s < 60) return "gerade eben";
    if (s < 3600) return `vor ${Math.round(s / 60)} min`;
    return `vor ${Math.round(s / 3600)} h`;
  };

  // Aufnahmen laden (optional nach Kamera gefiltert).
  const ladeAufnahmen = (cam: number | "") => {
    setAufnahmenLaden(true);
    const q = cam !== "" ? `?cam=${cam}&tage=14` : "?tage=14";
    fetch(`/api/securityspy/recordings${q}`).then((r) => r.json()).then((j) => {
      if (j.ok) setAufnahmen((j.recordings ?? []).map((r: any) => ({ ...r, sourceId: j.sourceId })));
      else setAufnahmen([]);
    }).catch(() => setAufnahmen([])).finally(() => setAufnahmenLaden(false));
  };

  const fmtGroesse = (bytes: number) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  const fmtDatum = (iso: string) => { try { return new Date(iso).toLocaleString("de-DE"); } catch { return iso; } };

  return (
    <div className="page">
      <h2>Kameras</h2>
      {fehler && <p className="src-error">SecuritySpy: {fehler}</p>}
      <div className="kamera-toolbar">
        <label className="kamera-live-toggle">
          <input type="checkbox" checked={liveVideo} onChange={(e) => setLiveVideo(e.target.checked)} />
          Live-Video {liveVideo ? "an" : "aus"}
        </label>
        {!liveVideo && (
          <label>Aktualisierung:
            <select value={intervallMs} onChange={(e) => setIntervallMs(Number(e.target.value))}>
              <option value={1000}>jede Sekunde</option>
              <option value={2000}>alle 2 s</option>
              <option value={5000}>alle 5 s</option>
              <option value={10000}>alle 10 s</option>
            </select>
          </label>
        )}
        {liveVideo && <span className="hint" style={{ marginLeft: 8 }}>Live-Video verbraucht mehr Bandbreite – nur aktiv, solange die Seite offen ist.</span>}
      </div>

      {cameras.length === 0 ? (
        <p className="hint">Keine Kameras gefunden. Prüfe, ob der SecuritySpy-Webserver läuft und die Zugangsdaten stimmen.</p>
      ) : (
        <div className="kamera-grid">
          {cameras.map((c) => (
            <div key={`${c.sourceId}:${c.number}`} className={`kamera-kachel${c.connected ? "" : " getrennt"}`}>
              <div className="kamera-bild" onClick={() => setGross({ sourceId: c.sourceId, cam: c.number })} title="Vergrößern">
                {c.connected
                  ? <img src={liveVideo ? streamUrl(c.sourceId, c.number) : bildUrl(c)} alt={c.name} loading="lazy" />
                  : <div className="kamera-offline">nicht verbunden</div>}
              </div>
              <div className="kamera-info">
                <span className="kamera-name">{c.name}</span>
                <span className="kamera-meta">
                  {c.mdEnabled ? `Bewegung: ${bewText(c.secondsSinceMotion)}` : "Bewegungserkennung aus"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Aufnahmen dauerhaft unterhalb der Kamerabilder */}
      {cameras.length > 0 && (
        <div className="kamera-aufnahmen">
          <h3>Aufnahmen</h3>
          <div className="kamera-aufnahmen-filter">
            <label>Kamera:
              <select value={aufnahmenKamera} onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setAufnahmenKamera(v); ladeAufnahmen(v); }}>
                <option value="">alle</option>
                {cameras.map((c) => <option key={c.number} value={c.number}>{c.name}</option>)}
              </select>
            </label>
            {aufnahmenLaden && <span className="hint">lädt …</span>}
          </div>
          {!aufnahmenLaden && aufnahmen.length === 0 ? (
            <p className="hint">Keine Aufnahmen gefunden.</p>
          ) : (
            <div className="table-scroll">
              <table className="rule-log">
                <thead><tr><th>Zeitpunkt</th><th>Kamera</th><th>Größe</th><th></th></tr></thead>
                <tbody>
                  {aufnahmen.map((r, i) => {
                    const kam = cameras.find((c) => c.number === r.cameraNum)?.name ?? `Kamera ${r.cameraNum}`;
                    return (
                      <tr key={i}>
                        <td>{fmtDatum(r.updated)}</td>
                        <td>{kam}</td>
                        <td>{fmtGroesse(r.length)}</td>
                        <td>
                          <button className="kamera-play-btn" onClick={() => setVideoAn({ sourceId: r.sourceId!, href: r.href, title: r.title })}>▶ Ansehen</button>
                          <a className="kamera-dl-btn" href={`/api/securityspy/recording?sourceId=${encodeURIComponent(r.sourceId!)}&href=${encodeURIComponent(r.href)}`} download title="Herunterladen">⬇ Download</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Großansicht */}
      {gross && (
        <div className="kamera-overlay" onClick={() => setGross(null)}>
          <img src={streamUrl(gross.sourceId, gross.cam)}
            alt="Großansicht" onClick={(e) => e.stopPropagation()} />
          <button className="kamera-close" onClick={() => setGross(null)}>✕</button>
        </div>
      )}

      {/* Aufnahme abspielen */}
      {videoAn && (
        <div className="kamera-overlay" onClick={() => setVideoAn(null)}>
          <div className="kamera-video-box" onClick={(e) => e.stopPropagation()}>
            <div className="kamera-video-titel">{videoAn.title}</div>
            <video controls autoPlay className="kamera-video"
              src={`/api/securityspy/recording?sourceId=${encodeURIComponent(videoAn.sourceId)}&href=${encodeURIComponent(videoAn.href)}`} />
          </div>
          <button className="kamera-close" onClick={() => setVideoAn(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
