// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { LuftsensorChart } from "./LuftsensorChart";

interface WetterStunde {
  ts: string; temperature?: number; cloudCover?: number; precipitation?: number;
  precipProb?: number; sunshine?: number; condition?: string; icon?: string; windSpeed?: number;
}
interface WetterData {
  ok: boolean; error?: string; quelle?: string; standortLabel?: string; stunden: WetterStunde[];
}

// Emoji je Bright-Sky-Icon (grobe, robuste Zuordnung).
function wetterIcon(icon?: string, cloud?: number): string {
  if (icon) {
    if (icon.includes("thunder")) return "⛈️";
    if (icon.includes("snow") || icon.includes("sleet")) return "🌨️";
    if (icon.includes("rain")) return "🌧️";
    if (icon.includes("fog")) return "🌫️";
    if (icon.includes("wind")) return "💨";
    if (icon.includes("partly")) return "⛅";
    if (icon.includes("cloudy")) return "☁️";
    if (icon.includes("clear")) return "☀️";
  }
  if (cloud != null) return cloud > 80 ? "☁️" : cloud > 40 ? "⛅" : "☀️";
  return "•";
}

function tagName(d: Date): string {
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const morgen = new Date(heute); morgen.setDate(morgen.getDate() + 1);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  if (dd.getTime() === heute.getTime()) return "Heute";
  if (dd.getTime() === morgen.getTime()) return "Morgen";
  return dd.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" });
}

// Lokaler Datums-Schlüssel (YYYY-MM-DD) – NICHT toISOString (das wäre UTC und
// verschiebt die Tagesgrenzen gegenüber der lokalen Zeit).
function lokalerTag(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const t = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${t}`;
}

// Tagesabschnitt einer Stunde (lokale Stunde).
function abschnitt(h: number): "nacht" | "vormittag" | "nachmittag" | "abend" {
  if (h < 6) return "nacht";
  if (h < 12) return "vormittag";
  if (h < 18) return "nachmittag";
  return "abend";
}

export function WetterPage() {
  const [data, setData] = useState<WetterData | null>(null);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch("/api/wetter?tage=7").then((r) => r.json()).then((j) => { setData(j); setLaden(false); })
        .catch(() => { setData({ ok: false, error: "Abruf fehlgeschlagen", stunden: [] }); setLaden(false); });
    };
    load();
    const t = setInterval(load, 30 * 60 * 1000); // alle 30 min aktualisieren
    return () => clearInterval(t);
  }, []);

  if (laden) return <div className="page"><h2>Wetter</h2><p className="hint">lädt …</p></div>;
  if (!data?.ok) return (
    <div className="page">
      <h2>Wetter</h2>
      <p className="src-error">{data?.error ?? "Keine Wetterdaten verfügbar."}</p>
      {data?.error?.includes("Standort") && (
        <p className="hint">Der Standort wird von den PV-Anlagen übernommen. Trage ihn dort ein (Menü „PV-Anlagen").</p>
      )}
    </div>
  );

  // Stunden nach LOKALEM Tag gruppieren.
  const proTag = new Map<string, WetterStunde[]>();
  for (const s of data.stunden) {
    const d = new Date(s.ts);
    const key = lokalerTag(d);
    if (!proTag.has(key)) proTag.set(key, []);
    proTag.get(key)!.push(s);
  }
  const heuteKey = lokalerTag(new Date());
  const morgenD = new Date(); morgenD.setDate(morgenD.getDate() + 1);
  const morgenKey = lokalerTag(morgenD);
  const jetztH = new Date().getHours();
  // Nur Tage ab heute anzeigen (vergangene Tage aus der Vorhersage ausblenden).
  const tage = [...proTag.keys()].filter((t) => t >= heuteKey).sort();

  // Tages-Zusammenfassung berechnen.
  const zusammen = (stunden: WetterStunde[]) => {
    const temps = stunden.map((s) => s.temperature).filter((v): v is number => v != null);
    const sonneMin = stunden.reduce((a, s) => a + (s.sunshine ?? 0), 0);
    const regen = stunden.reduce((a, s) => a + (s.precipitation ?? 0), 0);
    const wolkenAvg = stunden.length ? stunden.reduce((a, s) => a + (s.cloudCover ?? 0), 0) / stunden.length : 0;
    const maxRegenProb = Math.max(0, ...stunden.map((s) => s.precipProb ?? 0));
    return {
      tMin: temps.length ? Math.min(...temps) : undefined,
      tMax: temps.length ? Math.max(...temps) : undefined,
      sonneStd: sonneMin / 60,
      regen, wolkenAvg, maxRegenProb,
    };
  };

  // Abschnitts-Aggregation (Nacht/Vormittag/Nachmittag/Abend) für Folgetage.
  const abschnitte = (stunden: WetterStunde[]) => {
    const gruppen: Record<string, WetterStunde[]> = { nacht: [], vormittag: [], nachmittag: [], abend: [] };
    for (const s of stunden) gruppen[abschnitt(new Date(s.ts).getHours())].push(s);
    const labels: Record<string, string> = { nacht: "Nacht", vormittag: "Vormittag", nachmittag: "Nachmittag", abend: "Abend" };
    return (["nacht", "vormittag", "nachmittag", "abend"] as const)
      .filter((k) => gruppen[k].length > 0)
      .map((k) => {
        const g = gruppen[k];
        const temps = g.map((s) => s.temperature).filter((v): v is number => v != null);
        const wolken = g.length ? g.reduce((a, s) => a + (s.cloudCover ?? 0), 0) / g.length : 0;
        const regen = g.reduce((a, s) => a + (s.precipitation ?? 0), 0);
        const regenProb = Math.max(0, ...g.map((s) => s.precipProb ?? 0));
        // repräsentatives Icon: das häufigste bzw. mittlere.
        const mid = g[Math.floor(g.length / 2)];
        return {
          key: k, label: labels[k],
          temp: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : undefined,
          wolken: Math.round(wolken), regen, regenProb: Math.round(regenProb),
          icon: wetterIcon(mid?.icon, mid?.cloudCover),
        };
      });
  };

  return (
    <div className="page">
      <h2>Wetter{data.standortLabel ? ` – ${data.standortLabel}` : ""}</h2>
      <p className="hint" style={{ fontSize: 12 }}>
        Vorhersage vom Deutschen Wetterdienst (MOSMIX){data.quelle ? `, Station ${data.quelle}` : ""}.
        Stündlich für heute und morgen, danach in Tagesabschnitten. Legende: ☁️ Bewölkung, 🌧️ Niederschlagsmenge, ☔ Regenwahrscheinlichkeit, ☀️ Sonnenstunden.
      </p>

      {tage.map((tag) => {
        const stunden = proTag.get(tag)!;
        const z = zusammen(stunden);
        const d = new Date(tag + "T12:00:00");
        const stuendlich = tag === heuteKey || tag === morgenKey; // heute + morgen stündlich
        // Bei heute die bereits vergangenen Stunden ausblenden.
        const sichtbar = tag === heuteKey ? stunden.filter((s) => new Date(s.ts).getHours() >= jetztH) : stunden;
        const absStuffen = abschnitte(stunden);
        return (
          <div key={tag} className="wetter-tag card">
            <div className="wetter-tag-kopf">
              <h3>{tagName(d)}</h3>
              <div className="wetter-tag-summary">
                {z.tMin != null && <span>🌡️ {Math.round(z.tMin!)}–{Math.round(z.tMax!)} °C</span>}
                <span>☀️ {z.sonneStd.toFixed(1)} h Sonne</span>
                <span>☁️ {Math.round(z.wolkenAvg)} %</span>
                {z.regen > 0.05 ? <span>🌧️ {z.regen.toFixed(1)} mm ({Math.round(z.maxRegenProb)} %)</span> : <span>🌂 trocken</span>}
              </div>
            </div>
            {stuendlich ? (
              <div className="wetter-stunden">
                {sichtbar.map((s) => {
                  const h = new Date(s.ts).getHours();
                  return (
                    <div key={s.ts} className="wetter-stunde">
                      <div className="wetter-h">{String(h).padStart(2, "0")}</div>
                      <div className="wetter-emoji">{wetterIcon(s.icon, s.cloudCover)}</div>
                      <div className="wetter-temp">{s.temperature != null ? `${Math.round(s.temperature)}°` : "–"}</div>
                      <div className="wetter-detail" title="Bewölkung">{s.cloudCover != null ? `☁️ ${Math.round(s.cloudCover)}%` : ""}</div>
                      <div className="wetter-regen" title="Niederschlag">{(s.precipitation ?? 0) > 0.05 ? `🌧️ ${s.precipitation!.toFixed(1)}mm` : ((s.precipProb ?? 0) >= 20 ? `☔ ${Math.round(s.precipProb!)}%` : "")}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="wetter-abschnitte">
                {absStuffen.map((a) => (
                  <div key={a.key} className="wetter-abschnitt">
                    <div className="wetter-abschnitt-label">{a.label}</div>
                    <div className="wetter-emoji">{a.icon}</div>
                    <div className="wetter-temp">{a.temp != null ? `${a.temp}°` : "–"}</div>
                    <div className="wetter-detail" title="Bewölkung">☁️ {a.wolken}%</div>
                    <div className="wetter-regen" title="Niederschlag">{a.regen > 0.05 ? `🌧️ ${a.regen.toFixed(1)}mm` : (a.regenProb >= 20 ? `☔ ${a.regenProb}%` : "")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <LuftsensorChart />
    </div>
  );
}
