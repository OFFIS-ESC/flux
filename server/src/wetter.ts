// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Wettervorhersage über Bright Sky (freie JSON-API für DWD-MOSMIX-Daten).
// https://brightsky.dev  – kein API-Schlüssel nötig.
//
// Abgefragt wird die stündliche Vorhersage per Koordinaten (Standort der
// PV-Anlagen). Es wird nichts persistiert; ein kurzer In-Memory-Cache verhindert
// zu häufige Abrufe (die DWD-Vorhersage wird nur 4x täglich aktualisiert).

import https from "node:https";

export interface WetterStunde {
  ts: string;            // ISO-Zeitpunkt
  temperature?: number;  // °C
  cloudCover?: number;   // % Bewölkung
  precipitation?: number;// mm Niederschlag
  precipProb?: number;   // % Niederschlagswahrscheinlichkeit
  sunshine?: number;     // Minuten Sonnenschein in der Stunde
  condition?: string;    // z.B. "dry", "rain", "sleet", "snow", "fog", "thunderstorm"
  icon?: string;         // z.B. "clear-day", "partly-cloudy-day", "rain", ...
  windSpeed?: number;    // km/h
}

export interface WetterVorhersage {
  ok: boolean;
  error?: string;
  lat?: number;
  lon?: number;
  quelle?: string;       // Stationsname/Quelle von Bright Sky
  abgerufen?: number;    // ms-Zeitstempel des Abrufs
  stunden: WetterStunde[];
}

let cache: WetterVorhersage | null = null;
let cacheKey = "";
let cacheMs = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min (Vorhersage ändert sich nur 4x/Tag)

function httpsGetJson(url: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "User-Agent": "FLUX-HEMS" } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error("Ungültige Antwort")); }
      });
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
  });
}

function num(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Vorhersage abrufen (mit Cache). tage = Vorhersagehorizont in Tagen (max. 10).
export async function holeWetter(lat: number, lon: number, tage = 7): Promise<WetterVorhersage> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${tage}`;
  if (cache && cacheKey === key && (Date.now() - cacheMs) < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const jetzt = new Date();
    // Ab gestern anfragen (Puffer gegen Zeitzonen-Verschiebung), bis heute+tage.
    const von = new Date(jetzt); von.setDate(von.getDate() - 1);
    const bis = new Date(jetzt); bis.setDate(bis.getDate() + Math.max(1, Math.min(10, tage)));
    // Lokales Datum (nicht UTC), damit die Tagesgrenzen zur lokalen Zeit passen.
    const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${isoDate(von)}&last_date=${isoDate(bis)}`;
    const j = await httpsGetJson(url);
    const rows: any[] = Array.isArray(j?.weather) ? j.weather : [];
    const stunden: WetterStunde[] = rows.map((r) => ({
      ts: String(r.timestamp),
      temperature: num(r.temperature),
      cloudCover: num(r.cloud_cover),
      precipitation: num(r.precipitation),
      precipProb: num(r.precipitation_probability),
      sunshine: num(r.sunshine),
      condition: r.condition != null ? String(r.condition) : undefined,
      icon: r.icon != null ? String(r.icon) : undefined,
      windSpeed: num(r.wind_speed),
    }));
    const quelle = Array.isArray(j?.sources) && j.sources[0]?.station_name ? String(j.sources[0].station_name) : undefined;
    const erg: WetterVorhersage = { ok: true, lat, lon, quelle, abgerufen: Date.now(), stunden };
    cache = erg; cacheKey = key; cacheMs = Date.now();
    return erg;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Abruf fehlgeschlagen", lat, lon, stunden: [] };
  }
}
