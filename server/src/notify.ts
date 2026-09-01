// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Push-Benachrichtigungen via ntfy (https://ntfy.sh).
//
// ntfy funktioniert ohne Account: eine Nachricht wird per HTTP-POST an
// <server>/<topic> gesendet, Abonnenten dieses Topics (App/Browser) erhalten
// sie als Push. Titel, Priorität und Tags werden über HTTP-Header übergeben.

import * as db from "./db.js";

// Merker für den letzten Versand je Ereignis-Schlüssel (Anti-Spam) und der
// zuletzt gemeldete Zustand je Schlüssel (Flankenerkennung).
const lastSent: Record<string, number> = {};
const lastState: Record<string, boolean> = {};

export interface NtfyOptions {
  title?: string;
  priority?: 1 | 2 | 3 | 4 | 5; // 3 = default
  tags?: string[]; // Emojis/Tags, z. B. ["warning"]
  // Schlüssel zur Entprellung: gleiche Meldung wird frühestens nach
  // minIntervalMin erneut gesendet. Ohne key keine Entprellung.
  dedupeKey?: string;
}

// Sendet eine Nachricht an das konfigurierte ntfy-Topic. Liefert true bei
// Erfolg, false wenn deaktiviert/entprellt/fehlgeschlagen.
export async function sendNtfy(message: string, opts: NtfyOptions = {}): Promise<boolean> {
  const cfg = db.loadNotifySettings();
  if (!cfg.enabled) return false;
  if (!cfg.topic.trim()) return false;

  // Entprellung je Ereignis
  if (opts.dedupeKey) {
    const now = Date.now();
    const last = lastSent[opts.dedupeKey] ?? 0;
    if (now - last < cfg.minIntervalMin * 60_000) return false;
  }

  const base = cfg.server.trim().replace(/\/+$/, "") || "https://ntfy.sh";
  const url = `${base}/${encodeURIComponent(cfg.topic.trim())}`;
  const headers: Record<string, string> = { "Content-Type": "text/plain" };
  if (opts.title) headers["Title"] = sanitizeHeader(opts.title);
  if (opts.priority) headers["Priority"] = String(opts.priority);
  if (opts.tags?.length) headers["Tags"] = opts.tags.join(",");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: message,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      db.addLog(db.LOG_LEVELS.warn, "notify", `ntfy HTTP ${res.status}`);
      return false;
    }
    if (opts.dedupeKey) lastSent[opts.dedupeKey] = Date.now();
    return true;
  } catch (e: any) {
    db.addLog(db.LOG_LEVELS.warn, "notify", `ntfy Fehler: ${e?.message ?? e}`);
    return false;
  }
}

// ntfy-Header dürfen keine Zeilenumbrüche enthalten; Umlaute werden von ntfy
// akzeptiert, Steuerzeichen entfernen wir.
function sanitizeHeader(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

// Testnachricht (ignoriert enabled-Flag, damit man beim Einrichten testen kann).
export async function sendNtfyTest(): Promise<{ ok: boolean; error?: string }> {
  const cfg = db.loadNotifySettings();
  if (!cfg.topic.trim()) return { ok: false, error: "Kein Topic konfiguriert." };
  const base = cfg.server.trim().replace(/\/+$/, "") || "https://ntfy.sh";
  const url = `${base}/${encodeURIComponent(cfg.topic.trim())}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Title: "HEMS Test", Tags: "white_check_mark" },
      body: "Testbenachrichtigung von deinem HEMS – die Einrichtung funktioniert.",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// --- Ereignis-Auslöser (aus dem Poller aufgerufen) ---

// Flankengesteuert: sendet nur beim Wechsel des Zustands (online<->offline etc.),
// nicht bei jedem Tick.
export function notifyEdge(
  key: string,
  active: boolean,
  onMessage: () => { text: string; opts: NtfyOptions }
): void {
  const prev = lastState[key];
  if (prev === active) return; // keine Flanke
  lastState[key] = active;
  if (prev === undefined) return; // ersten beobachteten Zustand nicht melden
  if (active) {
    const { text, opts } = onMessage();
    void sendNtfy(text, opts);
  }
}

// Wie notifyEdge, aber sendet in BEIDE Richtungen (z. B. offline UND recovered).
export function notifyTransition(
  key: string,
  active: boolean,
  onActive: () => { text: string; opts: NtfyOptions } | null,
  onInactive: () => { text: string; opts: NtfyOptions } | null
): void {
  const prev = lastState[key];
  if (prev === active) return;
  lastState[key] = active;
  if (prev === undefined) return;
  const build = active ? onActive : onInactive;
  const payload = build();
  if (payload) void sendNtfy(payload.text, payload.opts);
}
