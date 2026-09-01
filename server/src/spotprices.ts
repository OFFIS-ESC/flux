// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Abruf der Day-Ahead-Spotpreise (EPEX, Marktzone DE-LU) über die frei
// nutzbare Energy-Charts-API des Fraunhofer ISE. Die API liefert die
// EPEX-Preise als JSON; wir rechnen EUR/MWh -> ct/kWh (Faktor 1/10).
//
// Endpunkt-Beispiel:
//   https://api.energy-charts.info/price?bzn=DE-LU&start=2026-06-23&end=2026-06-23
// Antwort:
//   { "unix_seconds": [...], "price": [...], "unit": "EUR/MWh", ... }

import * as db from "./db.js";
import { log } from "./logger.js";
import type { SpotpreisTag } from "./types.js";

const BZN = "DE-LU";
const BASE = "https://api.energy-charts.info/price";

// Öffentliche Abruf-URL für die Day-Ahead-Preise eines Tages (zum manuellen
// Aufrufen, falls der automatische Abruf noch nicht erfolgreich war).
export function spotSourceUrl(date: string): string {
  return `${BASE}?bzn=${BZN}&start=${date}&end=${date}`;
}

// Kennzeichnung für synthetische Beispiel-/Testpreise im Feld "fetched".
// Solche Einträge gelten NICHT als echte Preise: Sie werden beim ersten
// erfolgreichen Abruf durch die tatsächlichen Börsenpreise ersetzt und blockieren
// den Download für die betroffenen Tage nicht.
export const TESTDATA_MARKER = "testdata";

// Liefert true, wenn für den Tag bereits ECHTE Preise gespeichert sind.
// Synthetische Testpreise zählen bewusst nicht mit, damit sie durch echte
// Marktdaten überschrieben werden.
export function hasSpotpreise(date: string): boolean {
  const t = db.getSpotpreise(date);
  return !!t && t.prices.length > 0 && t.fetched !== TESTDATA_MARKER;
}

// Ergebnis eines einzelnen Abrufs:
//  "ok"        – Preise geholt und gespeichert
//  "empty"     – Antwort ok, aber (noch) keine Preisdaten (z.B. Folgetag früh)
//  "ratelimit" – HTTP 429 (zu viele Anfragen) -> später erneut versuchen
//  "error"     – sonstiger Fehler -> später erneut versuchen
type FetchOutcome =
  | { status: "ok"; rec: SpotpreisTag }
  | { status: "empty" }
  | { status: "ratelimit" }
  | { status: "error" };

async function fetchOnce(date: string, quiet = false): Promise<FetchOutcome> {
  const url = spotSourceUrl(date);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      if (!quiet) log.warn("spot", `HTTP 429 (Rate-Limit) für ${date}`);
      return { status: "ratelimit" };
    }
    if (!res.ok) {
      // Vor der Veröffentlichung liefert die Quelle für den morgigen Tag ein 404.
      // In der "leisen" Phase (z. B. vormittags) wird das NICHT als Fehler
      // geloggt, da es der erwartete Normalzustand ist.
      if (!quiet) log.error("spot", `HTTP ${res.status} für ${date}`);
      return { status: "error" };
    }
    const data: any = await res.json();
    const eurMwh: number[] = Array.isArray(data?.price) ? data.price : [];
    if (eurMwh.length === 0) {
      return { status: "empty" };
    }
    const prices = eurMwh.map((v) => (Number.isFinite(v) ? v / 10 : 0));
    const rec: SpotpreisTag = { date, prices, fetched: new Date().toISOString() };
    db.saveSpotpreise(rec);
    log.info("spot", `${date}: ${prices.length} Viertelstundenwerte gespeichert`);
    return { status: "ok", rec };
  } catch (e: any) {
    if (!quiet) log.error("spot", `Fehler beim Abruf für ${date}: ${e?.message ?? e}`);
    return { status: "error" };
  }
}

// Holt die Preise eines Liefertags von Energy-Charts und speichert sie.
// Gibt den gespeicherten Datensatz zurück oder null bei Fehler/keine Daten.
// quiet unterdrückt Fehlermeldungen (für erwartbare 404 vor Veröffentlichung).
export async function fetchSpotpreise(
  date: string,
  quiet = false
): Promise<SpotpreisTag | null> {
  const out = await fetchOnce(date, quiet);
  return out.status === "ok" ? out.rec : null;
}

// Stellt sicher, dass die Preise für heute und morgen vorhanden sind.
// Bereits gespeicherte Tage werden nicht erneut abgefragt (Daten sind fix).
//
// Besonderheit für den morgigen Tag: Die Börsenpreise des Folgetags werden erst
// im Laufe des Nachmittags veröffentlicht; vorher liefert die Quelle ein 404.
// Deshalb:
//   - vor 12:00 Uhr wird "morgen" gar nicht erst abgefragt (spart sinnlose 404),
//   - zwischen 12:00 und 16:00 wird abgefragt, aber ein Fehlschlag NICHT geloggt
//     (leise – die Daten sind einfach noch nicht da),
//   - ab 16:00 werden Fehlschläge wie gewohnt protokolliert (dann ist ein
//     fehlender morgiger Tag tatsächlich auffällig).
export async function ensureSpotpreise(): Promise<void> {
  const now = new Date();
  const today = isoDate(now);
  if (!hasSpotpreise(today)) {
    await fetchSpotpreise(today);
  }
  const hour = now.getHours();
  if (hour >= 12) {
    const tomorrow = isoDate(new Date(Date.now() + 24 * 3600 * 1000));
    if (!hasSpotpreise(tomorrow)) {
      const quiet = hour < 16; // vor 16 Uhr Fehlschläge nicht loggen
      await fetchSpotpreise(tomorrow, quiet);
    }
  }
}

function isoDate(d: Date): string {
  // lokales Datum als YYYY-MM-DD (nicht UTC, damit der Liefertag stimmt)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Einmaliger Backfill: holt alle im aktuellen Kalenderjahr noch fehlenden
// Tagespreisverläufe (1. Januar bis einschließlich heute; der Folgetag wird
// ausgelassen und vom stündlichen Scheduler nachgeholt). Bereits gespeicherte
// Tage werden übersprungen.
//
// Robustheit gegen das Rate-Limit der Energy-Charts-API:
//  - Grundpause zwischen Abrufen (PAUSE_BASE), die sich bei HTTP 429 jeweils
//    verdoppelt (bis PAUSE_MAX) und nach erfolgreichen Abrufen wieder langsam
//    sinkt.
//  - Fehlgeschlagene Tage (429/Fehler) werden gemerkt und in weiteren Runden
//    erneut versucht, bis keine mehr offen sind. "empty"-Tage (noch keine
//    Daten veröffentlicht) gelten nicht als Fehler und werden nicht endlos
//    wiederholt.
const num = (env: string | undefined, def: number) => {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const PAUSE_BASE = num(process.env.SPOT_PAUSE_BASE, 1500); // ms
const PAUSE_MAX = num(process.env.SPOT_PAUSE_MAX, 60000); // ms
const PAUSE_MIN = num(process.env.SPOT_PAUSE_MIN, 800); // ms
const MAX_ROUNDS = num(process.env.SPOT_MAX_ROUNDS, 20);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Startjahr für den historischen Backfill der Börsenpreise. Die Energy-Charts-
// API (Day-Ahead DE-LU) reicht deutlich weiter zurück; 2020 ist der für die
// Vergleichstabelle interessante Bereich (ab da traten nennenswert negative
// Preise auf) und hält die Datenmenge überschaubar.
export const BACKFILL_START_YEAR = 2020;

export async function backfillFromYear(startYear = BACKFILL_START_YEAR): Promise<void> {
  const now = new Date();
  const start = new Date(startYear, 0, 1);
  // Nur bis einschließlich heute. Der morgige Tag wird bewusst ausgelassen:
  // seine Preise werden meist erst nachmittags veröffentlicht, sodass er beim
  // Backfill dauerhaft "empty" bliebe. Den Folgetag holt der stündliche
  // Scheduler (ensureSpotpreise) ab, sobald er verfügbar ist.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Liste aller noch fehlenden Tage aufbauen
  let pending: string[] = [];
  let skipped = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = isoDate(d);
    if (hasSpotpreise(day)) skipped++;
    else pending.push(day);
  }

  let pause = PAUSE_BASE;
  let totalFetched = 0;

  for (let round = 1; round <= MAX_ROUNDS && pending.length > 0; round++) {
    const retry: string[] = [];
    let r429 = 0;
    for (const day of pending) {
      const out = await fetchOnce(day);
      if (out.status === "ok") {
        totalFetched++;
        // nach Erfolg Pause langsam wieder verkürzen
        pause = Math.max(PAUSE_MIN, Math.round(pause * 0.9));
      } else if (out.status === "ratelimit") {
        r429++;
        retry.push(day);
        // Pause verlängern (exponentiell, gedeckelt)
        pause = Math.min(PAUSE_MAX, pause * 2);
      } else if (out.status === "error") {
        retry.push(day); // später erneut versuchen
      }
      // "empty": Tag existiert (noch) nicht -> nicht erneut versuchen
      await sleep(pause);
    }
    pending = retry;
    if (pending.length > 0) {
      // vor der nächsten Runde zusätzlich warten, wenn Rate-Limit auftrat
      const cooldown = r429 > 0 ? Math.min(PAUSE_MAX, pause * 2) : pause;
      log.warn(
        "spot",
        `Backfill Runde ${round}: ${pending.length} Tage offen` +
          (r429 > 0 ? ` (${r429}× 429)` : "") +
          `, nächste Runde in ${Math.round(cooldown / 1000)} s`
      );
      await sleep(cooldown);
    }
  }

  if (pending.length > 0) {
    log.warn(
      "spot",
      `Backfill ab ${startYear}: ${totalFetched} geholt, ${skipped} vorhanden, ` +
        `${pending.length} nach ${MAX_ROUNDS} Runden weiter offen (später erneut).`
    );
  } else {
    log.info(
      "spot",
      `Backfill ab ${startYear}: ${totalFetched} neu geholt, ${skipped} bereits vorhanden, vollständig.`
    );
  }
}

// Scheduler: einmal beim Start ein Backfill ab dem Startjahr (historische
// Preise), danach stündlich nur heute/morgen nachziehen. Bereits gespeicherte
// Tage werden nie erneut abgefragt (Daten sind fix).
let timer: ReturnType<typeof setInterval> | null = null;
export function startSpotScheduler(): void {
  void backfillFromYear().then(() => ensureSpotpreise());
  if (timer) clearInterval(timer);
  timer = setInterval(() => void ensureSpotpreise(), 60 * 60 * 1000);
}
