// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// HTTP-Client für LAN-Geräte (Shelly, OpenDTU, Tasmota, …).
//
// Warum nicht global `fetch`? Node's fetch (undici) hält Keep-Alive-Verbindungen
// in einem Pool offen und wiederverwendet sie. Schwache Geräte – vor allem
// Shelly Gen1 auf ESP8266 – verkraften oft nur EINE gleichzeitige Verbindung und
// geraten durch offen gehaltene/halb geschlossene Sockets in einen Zustand, in
// dem sie neue Verbindungen (auch WLAN-/DHCP-Erneuerung) nicht mehr bedienen.
//
// Diese Hilfsfunktion nutzt daher Node's eingebautes http/https-Modul mit
// `agent: false`: keine Verbindungs-Wiederverwendung, die Verbindung wird nach
// jeder Antwort sauber geschlossen (Server sendet zusätzlich „Connection: close").
// Das ist etwas weniger effizient, schont aber genau die Geräte, die sonst
// aussteigen.

import http from "node:http";
import https from "node:https";

// Dedizierte Agents mit keepAlive:false. Anders als `agent: false` (das pro
// Request ein neues Agent-Konstrukt erzeugt und bei Timeouts Sockets/Buffer
// ansammeln kann) verwaltet EIN Agent die Sockets zentral, schließt sie nach der
// Antwort (kein Keep-Alive → schont schwache Geräte) und begrenzt gleichzeitig
// offene Verbindungen. maxSockets hält die Zahl paralleler Verbindungen je Host
// klein; freie Sockets werden nicht vorgehalten (maxFreeSockets 0).
const httpAgent = new http.Agent({ keepAlive: false, maxSockets: 8, maxFreeSockets: 0 });
const httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 8, maxFreeSockets: 0 });

export interface HttpGetOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  // Cache/Request-Sharing umgehen (für Schaltbefehle und Status-Abfragen direkt
  // nach dem Schalten, die immer frisch sein müssen).
  noCache?: boolean;
  // Maximales Alter eines Cache-Eintrags, das noch akzeptiert wird. Ohne Angabe
  // gilt CACHE_TTL_MS (kurz, ~1,5 s, nur zum Zusammenfassen gleichzeitiger
  // Abfragen). Ein größerer Wert erlaubt es, den zuletzt vom Poller geholten
  // Gerätestatus wiederzuverwenden, statt einen zusätzlichen Request zu feuern
  // (schont Geräte, die keine parallelen Verbindungen vertragen).
  maxAgeMs?: number;
}

// Sehr kurzlebiger Cache pro (URL + Header-Signatur). Wenn mehrere Quellen im
// selben Poll-Fenster EXAKT dieselbe URL abfragen (z. B. zwei Senken, die
// denselben Shelly lesen), wird das Gerät nur EINMAL kontaktiert und die Antwort
// geteilt. TTL bewusst klein (Standard 1500 ms), damit die Werte praktisch
// aktuell bleiben – es geht nur darum, echte Doppelabfragen im selben Moment zu
// vermeiden, nicht darum, Daten über Zeit zu cachen.
const CACHE_TTL_MS = 1500;
interface CacheEntry { at: number; text: string; }
const textCache = new Map<string, CacheEntry>();
// Laufende Requests, damit parallele Abfragen derselben URL sich denselben
// In-Flight-Request teilen (statt zwei gleichzeitige Verbindungen zu öffnen).
const inFlight = new Map<string, Promise<string>>();

function cacheKey(url: string, headers?: Record<string, string>): string {
  // Authorization in den Schlüssel, damit unterschiedlich authentifizierte
  // Abfragen sich nicht vermischen; andere Header sind für GET unkritisch.
  return `${url}\u0000${headers?.Authorization ?? ""}`;
}

// Führt ein HTTP-GET aus und gibt den Rohtext des Bodys zurück. Verbindung wird
// nach der Antwort geschlossen (kein Keep-Alive). Identische URLs im selben
// kurzen Zeitfenster teilen sich Antwort bzw. laufenden Request.
export function httpGetText(url: string, opts: HttpGetOptions = {}): Promise<string> {
  if (opts.noCache) return doHttpGetText(url, opts);
  const key = cacheKey(url, opts.headers);
  const now = Date.now();
  const cached = textCache.get(key);
  const maxAge = opts.maxAgeMs ?? CACHE_TTL_MS;
  if (cached && now - cached.at < maxAge) {
    return Promise.resolve(cached.text);
  }
  const running = inFlight.get(key);
  if (running) return running;
  const p = doHttpGetText(url, opts).then((text) => {
    textCache.set(key, { at: Date.now(), text });
    inFlight.delete(key);
    pruneCache();
    return text;
  }).catch((e) => {
    inFlight.delete(key);
    throw e;
  });
  inFlight.set(key, p);
  return p;
}

// Entfernt veraltete Cache-Einträge. Läuft bei jedem abgeschlossenen Request und
// hält den Cache klein (der Datenbestand ist ohnehin nur wenige Sekunden gültig).
const CACHE_MAX_AGE_MS = 30000;
function pruneCache(): void {
  const cutoff = Date.now() - CACHE_MAX_AGE_MS;
  for (const [k, v] of textCache) {
    if (v.at < cutoff) textCache.delete(k);
  }
}

// Der eigentliche HTTP-GET ohne Cache.
function doHttpGetText(url: string, opts: HttpGetOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const mod = u.protocol === "https:" ? https : http;
    const agent = u.protocol === "https:" ? httpsAgent : httpAgent;

    let settled = false;
    let req: http.ClientRequest | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (req) {
        const r = req;
        req = null;
        // no-op error-Handler vor dem Zerstören: ein destroyter Socket kann noch
        // ein spätes 'error'-Event feuern (ECONNRESET, "socket hang up"); ohne
        // Handler würde das den Prozess crashen.
        try { r.on("error", () => {}); } catch { /* ignore */ }
        try { r.destroy(); } catch { /* ignore */ }
      }
    };
    const done = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err); else resolve(text!);
    };

    req = mod.request(
      url,
      {
        method: "GET",
        agent,
        headers: {
          Connection: "close",
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume(); // Body verwerfen, Socket freigeben
          res.on("end", () => done(new Error(`HTTP ${status}`)));
          res.on("error", () => done(new Error(`HTTP ${status}`)));
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => done(null, data));
        res.on("error", (e) => done(e));
      },
    );

    // Eigener Watchdog statt req.setTimeout: garantiert das Zerstören auch dann,
    // wenn der Socket im Verbindungsaufbau hängt (dann feuert req.setTimeout nicht
    // zuverlässig). Bei Auslösen wird der Request komplett abgeräumt.
    watchdog = setTimeout(() => done(new Error("timeout")), timeoutMs);

    req.on("error", (e) => done(e));
    req.end();
  });
}

// Wie httpGetText, aber parst die Antwort als JSON.
export async function httpGetJson(url: string, opts: HttpGetOptions = {}): Promise<any> {
  const text = await httpGetText(url, opts);
  return JSON.parse(text);
}
