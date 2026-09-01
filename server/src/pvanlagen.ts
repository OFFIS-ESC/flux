// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// PV-Anlagendaten und Ertragsprognose.
//
// Verwaltet technische Stammdaten von PV-Anlagen (Standort + beliebig viele
// Strings mit Modulzahl, Modulleistung, Ausrichtung/Azimut und Aufstellwinkel/
// Neigung) und ruft darüber eine Ertragsprognose für heute und morgen von
// forecast.solar ab. forecast.solar ist ohne API-Key nutzbar; der kostenlose
// Zugang erlaubt allerdings nur EINE Ebene (Ausrichtung/Neigung) pro Anfrage,
// daher wird pro String eine eigene Abfrage gemacht und serverseitig summiert.
//
// API (öffentlich, ohne Key):
//   https://api.forecast.solar/estimate/:lat/:lon/:dec/:az/:kwp
//   :dec = Neigung 0 (horizontal) … 90 (vertikal)
//   :az  = Azimut -180…180 (-90 = Ost, 0 = Süd, 90 = West)
//   :kwp = installierte Leistung in kWp
// Antwort: result.watt_hours_day (WATTSTUNDEN/Tag je Datum -> wird in kWh
// umgerechnet) und result.watts (zeitlicher Leistungsverlauf in W) sowie
// result.watt_hours_period.

import * as db from "./db.js";

const FORECAST_BASE = "https://api.forecast.solar/estimate";
// forecast.solar aktualisiert nur alle ~15 min; der Scheduler ruft stündlich ab.
// Cache etwas unter 1 h, damit der stündliche Lauf frische Daten bekommt, ein
// manueller Zwischenabruf aber nicht sofort erneut das (limitierte) API trifft.
const CACHE_TTL_MS = 55 * 60 * 1000; // 55 Minuten

export interface PvString {
  id: string;            // stabile ID (für Reihenfolge/Bearbeitung)
  nr: number;            // fortlaufende Nummer (Anzeige)
  moduleCount: number;   // Anzahl Module
  moduleWp: number;      // Modulleistung in Wp
  azimuth: number;       // Ausrichtung in Grad (-180…180, 0 = Süd)
  tilt: number;          // Aufstellwinkel in Grad gegenüber horizontal (0…90)
}

export interface PvAnlage {
  id: string;
  name: string;
  lat?: number;          // Standort Breitengrad
  lon?: number;          // Standort Längengrad
  sourceIds: string[];   // zugeordnete Quellen (Rolle "pv")
  strings: PvString[];
}

// kWp eines Strings = Modulzahl * Modulleistung(Wp) / 1000.
export function stringKwp(s: PvString): number {
  return (s.moduleCount * s.moduleWp) / 1000;
}

// --- Persistenz (Settings-Key "pvAnlagen") -------------------------------

export function loadPvAnlagen(): PvAnlage[] {
  const raw = db.getSettingRaw("pvAnlagen");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePvAnlagen(anlagen: PvAnlage[]): void {
  db.setSettingRaw("pvAnlagen", JSON.stringify(anlagen));
}

// --- Prognose-Abruf -------------------------------------------------------

interface PlaneForecast {
  // Wh je Datum (YYYY-MM-DD) – forecast.solar liefert Wattstunden.
  wattHoursDay: Record<string, number>;
  // Leistungsverlauf: Zeitstempel (ISO, lokale Zeit der Anlage) -> Watt
  watts: Record<string, number>;
}

interface CacheEntry { at: number; data: PlaneForecast }
const planeCache = new Map<string, CacheEntry>();

function planeKey(lat: number, lon: number, dec: number, az: number, kwp: number): string {
  return `${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.round(dec)}/${Math.round(az)}/${kwp.toFixed(3)}`;
}

// Ruft die Prognose für EINE Ebene (String) ab; nutzt Cache.
async function fetchPlane(
  lat: number, lon: number, dec: number, az: number, kwp: number,
): Promise<PlaneForecast> {
  const key = planeKey(lat, lon, dec, az, kwp);
  const cached = planeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = `${FORECAST_BASE}/${key}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`forecast.solar HTTP ${res.status}`);
  }
  const json: any = await res.json();
  const data: PlaneForecast = {
    wattHoursDay: (json?.result?.watt_hours_day ?? {}) as Record<string, number>,
    watts: (json?.result?.watts ?? {}) as Record<string, number>,
  };
  planeCache.set(key, { at: Date.now(), data });
  return data;
}

export interface AnlageForecast {
  anlageId: string;
  name: string;
  ok: boolean;
  error?: string;
  // kWh je Datum
  kwhByDate: Record<string, number>;
  // Leistungsverlauf gesamt (alle Strings summiert): ISO-Zeit -> Watt
  watts: Record<string, number>;
}

// Prognose für eine Anlage: summiert alle Strings (getrennte Abfragen). Der
// Standort (lat/lon) wird zentral übergeben (gemeinsamer Standort aller Anlagen).
async function forecastAnlage(a: PvAnlage, standort: PvStandort | null): Promise<AnlageForecast> {
  const out: AnlageForecast = { anlageId: a.id, name: a.name, ok: false, kwhByDate: {}, watts: {} };
  // Bevorzugt den gemeinsamen Standort; als Rückfall die (alten) anlageneigenen
  // Koordinaten, falls noch vorhanden.
  const lat = standort?.lat ?? a.lat;
  const lon = standort?.lon ?? a.lon;
  if (lat == null || lon == null) {
    out.error = "Kein Standort hinterlegt";
    return out;
  }
  const strings = a.strings.filter((s) => stringKwp(s) > 0);
  if (strings.length === 0) {
    out.error = "Keine Strings mit Leistung";
    return out;
  }
  try {
    for (const s of strings) {
      const pf = await fetchPlane(lat, lon, s.tilt, s.azimuth, stringKwp(s));
      // watt_hours_day ist in WATTSTUNDEN (Wh), nicht kWh -> in kWh umrechnen.
      for (const [date, wh] of Object.entries(pf.wattHoursDay)) {
        out.kwhByDate[date] = (out.kwhByDate[date] ?? 0) + (Number(wh) || 0) / 1000;
      }
      for (const [ts, w] of Object.entries(pf.watts)) {
        out.watts[ts] = (out.watts[ts] ?? 0) + (Number(w) || 0);
      }
    }
    out.ok = true;
  } catch (e: any) {
    out.error = e?.message ?? String(e);
    // Fehler beim Prognose-Abruf protokollieren (Debug-Seite), damit
    // Netzwerk-/API-Probleme nachvollziehbar sind.
    try {
      db.addLog(db.LOG_LEVELS.warn, "forecast",
        `forecast.solar-Abruf fehlgeschlagen für Anlage "${a.name}": ${out.error}`);
    } catch { /* Logging best effort */ }
  }
  return out;
}

export interface ForecastResult {
  anlagen: AnlageForecast[];
  // Zusammenfassung je Anlage: heute/morgen (kWh) und Rest heute (kWh).
  summary: Array<{
    anlageId: string;
    name: string;
    ok: boolean;
    error?: string;
    todayKwh: number;
    tomorrowKwh: number;
    remainingTodayKwh: number;
  }>;
  // Datum, auf das sich todaySlots bezieht (YYYY-MM-DD).
  today: string;
  // Prognostizierter PV-Ertrag heute als 96 Viertelstunden-Werte (kWh je Slot),
  // Summe über alle Anlagen – für die gestrichelte Linie im Tagesverlauf.
  todaySlots: number[];
  // Prognostizierter Gesamt- und Restertrag heute (kWh) über alle Anlagen.
  todayKwhTotal: number;
  remainingTodayKwhTotal: number;
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Verbleibender Ertrag heute = Tagesprognose minus dem bis jetzt (laut Prognose-
// Leistungsverlauf) bereits aufgelaufenen Anteil. Näherung über die watts-Kurve:
// Summe der zukünftigen Perioden. Die watts sind in W an Stützstellen; wir
// integrieren grob über die Zeitabstände.
function remainingToday(fc: AnlageForecast, today: string, now: Date): number {
  const entries = Object.entries(fc.watts)
    .map(([ts, w]) => ({ t: new Date(ts.replace(" ", "T")), w: Number(w) || 0 }))
    .filter((e) => !isNaN(e.t.getTime()) && isoDateLocal(e.t) === today)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (entries.length === 0) return 0;
  let kwh = 0;
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    if (cur.t <= now) continue; // Vergangenes zählt nicht zum Rest
    const prev = entries[i - 1];
    const dtH = prev ? (cur.t.getTime() - Math.max(prev.t.getTime(), now.getTime())) / 3_600_000 : 0;
    kwh += (cur.w / 1000) * Math.max(0, dtH);
  }
  return kwh;
}

// Baut aus der watts-Kurve (W an Stützstellen) ein 96-Slot-Tagesprofil in kWh
// je Viertelstunde für das angegebene Datum. Zwischen den Stützstellen wird die
// Leistung linear interpoliert und über die 15-Minuten-Fenster integriert. So
// entsteht ein Profil, das direkt auf die Viertelstunden-Achse des Erzeuger-
// Tagesverlaufs passt.
function slotProfileForDate(fc: AnlageForecast, dateStr: string): number[] {
  const slots = new Array<number>(96).fill(0);
  const pts = Object.entries(fc.watts)
    .map(([ts, w]) => ({ t: new Date(ts.replace(" ", "T")), w: Number(w) || 0 }))
    .filter((e) => !isNaN(e.t.getTime()) && isoDateLocal(e.t) === dateStr)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (pts.length === 0) return slots;

  // Minuten seit Mitternacht (lokal) je Stützstelle.
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const P = pts.map((p) => ({ min: (p.t.getTime() - dayStart.getTime()) / 60000, w: p.w }));
  // Lineare Interpolation der Leistung (W) zu einem beliebigen Minutenwert.
  const wattAt = (min: number): number => {
    if (min <= P[0].min) return P[0].w;
    if (min >= P[P.length - 1].min) return P[P.length - 1].w;
    for (let i = 1; i < P.length; i++) {
      if (min <= P[i].min) {
        const a = P[i - 1], b = P[i];
        const f = (min - a.min) / (b.min - a.min || 1);
        return a.w + (b.w - a.w) * f;
      }
    }
    return 0;
  };
  // Je Viertelstunde über 3 Stützpunkte (Anfang/Mitte/Ende) mitteln -> kWh.
  for (let s = 0; s < 96; s++) {
    const m0 = s * 15, m1 = m0 + 15;
    const avgW = (wattAt(m0) + wattAt(m0 + 7.5) + wattAt(m1)) / 3;
    slots[s] = (avgW / 1000) * 0.25; // kWh in 15 min
  }
  return slots;
}

// Gesamtprognose über alle Anlagen.
export async function getForecast(): Promise<ForecastResult> {
  const anlagen = loadPvAnlagen();
  const now = new Date();
  const today = isoDateLocal(now);
  const tomorrow = isoDateLocal(new Date(now.getTime() + 24 * 3600 * 1000));

  const results: AnlageForecast[] = [];
  const standort = getPvStandort();
  for (const a of anlagen) {
    results.push(await forecastAnlage(a, standort));
  }

  const summary = results.map((fc) => ({
    anlageId: fc.anlageId,
    name: fc.name,
    ok: fc.ok,
    error: fc.error,
    todayKwh: fc.kwhByDate[today] ?? 0,
    tomorrowKwh: fc.kwhByDate[tomorrow] ?? 0,
    remainingTodayKwh: fc.ok ? remainingToday(fc, today, now) : 0,
  }));

  // 96-Slot-Tagesprofil für heute über alle (erfolgreichen) Anlagen summieren.
  const todaySlots = new Array<number>(96).fill(0);
  for (const fc of results) {
    if (!fc.ok) continue;
    const prof = slotProfileForDate(fc, today);
    for (let i = 0; i < 96; i++) todaySlots[i] += prof[i];
  }
  const todayKwhTotal = summary.reduce((a, s) => a + (s.ok ? s.todayKwh : 0), 0);
  const remainingTodayKwhTotal = summary.reduce((a, s) => a + (s.ok ? s.remainingTodayKwh : 0), 0);

  // Prognose persistieren: heute UND morgen, jeweils JE ANLAGE unter ihrem Datum.
  // Ein erneuter Abruf am selben Tag ersetzt den vorherigen Eintrag (keine
  // Intra-Tag-Historie). Über die Tage entsteht eine fortlaufende Historie. Nur
  // speichern, wenn mindestens eine Anlage erfolgreich war (sonst würde eine
  // Nullprognose gute Daten überschreiben).
  if (results.some((r) => r.ok)) {
    const nowIso = new Date().toISOString();
    for (const fc of results) {
      if (!fc.ok) continue;
      const sumForDate = (date: string) => fc.kwhByDate[date] ?? 0;
      try {
        db.savePvPrognoseAnlage(today, {
          anlageId: fc.anlageId, anlageName: fc.name,
          slots: slotProfileForDate(fc, today), kwhTotal: sumForDate(today), updatedAt: nowIso,
        });
        db.savePvPrognoseAnlage(tomorrow, {
          anlageId: fc.anlageId, anlageName: fc.name,
          slots: slotProfileForDate(fc, tomorrow), kwhTotal: sumForDate(tomorrow), updatedAt: nowIso,
        });
      } catch { /* Persistenz best effort */ }
    }
  }

  return { anlagen: results, summary, today, todaySlots, todayKwhTotal, remainingTodayKwhTotal };
}

// Gespeicherte Tagesprognose laden – je Anlage UND als Gesamtverlauf. Für "heute"
// wird zusätzlich der verbleibende Ertrag aus den Slots ab der aktuellen
// Viertelstunde berechnet. So zeigt die PV-Anlagenseite die Werte auch nach
// Seitenwechsel/Neustart, ohne erneut forecast.solar abzurufen.
export interface StoredPrognose {
  vorhanden: boolean;
  updatedAt: string | null;
  gesamtSlots: number[];    // Summe über alle Anlagen (96 Werte)
  kwhTotal: number;         // Tagesertrag gesamt
  remainingKwh: number;     // Restertrag (heute ab jetzt; sonst voller Tag)
  anlagen: Array<{ anlageId: string; anlageName: string; slots: number[]; kwhTotal: number }>;
}
export function loadStoredPrognose(date: string): StoredPrognose {
  return prognoseFromRows(date, db.loadPvPrognoseTag(date));
}

// Prognose-Gesamtstand zu einem bestimmten Zeitpunkt (fuer den Verlaufs-Slider).
export function loadStoredPrognoseStand(date: string, zeitpunkt: string): StoredPrognose {
  return prognoseFromRows(date, db.loadPvPrognoseTagStand(date, zeitpunkt));
}

// Liste aller Prognose-Zeitpunkte eines Tages (aufsteigend).
export function listPrognoseZeitpunkte(date: string): string[] {
  return db.listPvPrognoseZeitpunkte(date);
}

// Höchster Slot-Summenwert über ALLE Prognosestände des Tages (festes y-Maximum).
export function maxSlotTagesverlauf(date: string): number {
  const zeitpunkte = db.listPvPrognoseZeitpunkte(date);
  let max = 0;
  for (const z of zeitpunkte) {
    const p = prognoseFromRows(date, db.loadPvPrognoseTagStand(date, z));
    for (const v of p.gesamtSlots) if (v > max) max = v;
  }
  return max;
}

function prognoseFromRows(date: string, rows: db.PvPrognoseAnlage[]): StoredPrognose {
  if (rows.length === 0) {
    return { vorhanden: false, updatedAt: null, gesamtSlots: new Array(96).fill(0), kwhTotal: 0, remainingKwh: 0, anlagen: [] };
  }
  const gesamtSlots = new Array<number>(96).fill(0);
  let kwhTotal = 0;
  let updatedAt: string | null = null;
  for (const r of rows) {
    for (let i = 0; i < 96; i++) gesamtSlots[i] += r.slots[i] ?? 0;
    kwhTotal += r.kwhTotal;
    if (!updatedAt || r.updatedAt > updatedAt) updatedAt = r.updatedAt;
  }
  const now = new Date();
  const isToday = date === isoDateLocal(now);
  let remainingKwh = 0;
  if (isToday) {
    const nowSlot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);
    for (let i = nowSlot; i < 96; i++) remainingKwh += gesamtSlots[i];
  } else {
    remainingKwh = kwhTotal;
  }
  return {
    vorhanden: true, updatedAt, gesamtSlots, kwhTotal, remainingKwh,
    anlagen: rows.map((r) => ({ anlageId: r.anlageId, anlageName: r.anlageName, slots: r.slots, kwhTotal: r.kwhTotal })),
  };
}

export function listStoredPrognosen(limit: number): Array<{ date: string; kwhTotal: number; updatedAt: string }> {
  return db.listPvPrognosen(limit);
}

// Einstellung "Prognose an reale Produktion anpassen". Wird persistiert; Default
// ist AKTIV (Häkchen gesetzt), solange nichts anderes gespeichert wurde.
const SKALIERUNG_KEY = "pvPrognoseSkalierungAktiv";
export function getPrognoseSkalierungAktiv(): boolean {
  const raw = db.getSettingRaw(SKALIERUNG_KEY);
  if (raw === undefined) return true; // Default: an
  return raw === "1" || raw === "true";
}
export function setPrognoseSkalierungAktiv(aktiv: boolean): void {
  db.setSettingRaw(SKALIERUNG_KEY, aktiv ? "1" : "0");
}

// Gemeinsamer Standort aller PV-Anlagen. Da alle Anlagen am selben Ort stehen,
// wird der Standort nur einmal zentral gepflegt (statt je Anlage lat/lon). Der
// Wert wird als JSON in den Settings abgelegt.
const STANDORT_KEY = "pvStandort";
export interface PvStandort { lat: number; lon: number; label?: string }
export function getPvStandort(): PvStandort | null {
  const raw = db.getSettingRaw(STANDORT_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (typeof o?.lat === "number" && typeof o?.lon === "number") return o;
  } catch { /* ignore */ }
  return null;
}
export function setPvStandort(s: PvStandort | null): void {
  if (s == null) { db.setSettingRaw(STANDORT_KEY, ""); return; }
  db.setSettingRaw(STANDORT_KEY, JSON.stringify({ lat: s.lat, lon: s.lon, label: s.label ?? "" }));
}

// Skalierungsfaktor für die Prognose des heutigen Tages ("an reale Produktion
// anpassen"). Vergleicht die real erzeugte Energie mit der prognostizierten für
// denselben Zeitraum – über den Vortag (voll) und heute (bis zur aktuellen VS).
// Ergebnis wird auf [0.30, 4.00] begrenzt (entspricht -70% … +300%).
// realHeute/realVortag: 96-Slot-Arrays der realen Gesamterzeugung (kWh je VS).
export function computePrognoseSkalierung(
  today: string, vortag: string, realHeute: number[], realVortag: number[], nowSlot: number,
): { faktor: number; prozent: number; basis: number; vorhanden: boolean } {
  const progHeute = loadStoredPrognose(today);
  const progVortag = loadStoredPrognose(vortag);
  let realSum = 0, progSum = 0, slotsMitErtrag = 0;
  // Eine Viertelstunde nur einbeziehen, wenn dort tatsächlich realer Ertrag
  // erfasst wurde (real > 0). So verfälschen fehlende Messwerte (z. B. weil das
  // Tool erst seit ein paar Stunden läuft) den Faktor nicht nach unten. Es wird
  // ausschließlich über Zeiträume verglichen, für die reale Daten vorliegen.
  const EPS = 0.0005; // ~2 W in 15 min – filtert Nacht/Rauschen heraus
  // Heute: nur bis zur aktuellen Viertelstunde (Vergangenheit).
  if (progHeute.vorhanden) {
    for (let i = 0; i < Math.min(nowSlot, 96); i++) {
      const real = realHeute[i] ?? 0;
      if (real <= EPS) continue;
      realSum += real;
      progSum += progHeute.gesamtSlots[i] ?? 0;
      slotsMitErtrag++;
    }
  }
  // Vortag: ganzer Tag, ebenfalls nur VS mit realem Ertrag.
  if (progVortag.vorhanden) {
    for (let i = 0; i < 96; i++) {
      const real = realVortag[i] ?? 0;
      if (real <= EPS) continue;
      realSum += real;
      progSum += progVortag.gesamtSlots[i] ?? 0;
      slotsMitErtrag++;
    }
  }
  // Zu wenig Vergleichsgrundlage -> kein sinnvoller Faktor. Mindestens ein paar
  // Viertelstunden mit Ertrag und nennenswerte Prognosesumme verlangen.
  if (slotsMitErtrag < 4 || progSum < 0.05) {
    return { faktor: 1, prozent: 0, basis: progSum, vorhanden: false };
  }
  let faktor = realSum / progSum;
  faktor = Math.max(0.30, Math.min(4.0, faktor));
  return { faktor, prozent: Math.round((faktor - 1) * 100), basis: progSum, vorhanden: true };
}

// Prognose-Scheduler mit konfigurierbarem Intervall (Setting
// prognoseIntervalMin, Standard 90 min). forecast.solar erlaubt mit dem
// kostenlosen Zugang etwa stündliche Abrufe; ein größeres Intervall schont das
// Kontingent. Erster Lauf verzögert, damit der Serverstart nicht blockiert.
let prognoseTimer: ReturnType<typeof setInterval> | null = null;
let prognoseIntervalMs = 0;
function currentPrognoseIntervalMs(): number {
  const min = db.loadSettings().prognoseIntervalMin;
  const safe = Number.isFinite(min) && min >= 15 ? min : 90; // Untergrenze 15 min
  return safe * 60 * 1000;
}
export function startPrognoseScheduler(): void {
  const run = () => {
    // Bei Änderung des konfigurierten Intervalls den Timer neu aufsetzen.
    const want = currentPrognoseIntervalMs();
    if (want !== prognoseIntervalMs) {
      prognoseIntervalMs = want;
      if (prognoseTimer) clearInterval(prognoseTimer);
      prognoseTimer = setInterval(run, prognoseIntervalMs);
    }
    // Nur abrufen, wenn überhaupt Anlagen mit Standort konfiguriert sind.
    if (loadPvAnlagen().length === 0) return;
    getForecast().catch(() => { /* Fehler werden je Anlage im Ergebnis geführt */ });
  };
  if (prognoseTimer) return;
  prognoseIntervalMs = currentPrognoseIntervalMs();
  // Erststart 30 s nach Serverstart, danach im konfigurierten Intervall.
  setTimeout(run, 30_000);
  prognoseTimer = setInterval(run, prognoseIntervalMs);
}
