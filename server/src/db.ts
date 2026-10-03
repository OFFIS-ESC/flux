// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "./config.js";
import type { HistoryEntry, DrosselungEntry, Settings, SpotpreisTag, ViertelstundeEntry, Abnehmer, Sink } from "./types.js";

// Nutzt das in Node 22+ eingebaute SQLite-Modul (node:sqlite).
// Kein nativer Build, kein node-gyp, kein Compiler nötig.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "hems.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
// synchronous = NORMAL: im WAL-Modus ohnehin der Default, aber explizit gesetzt,
// damit das Verhalten versionsunabhängig festgelegt ist. NORMAL erzwingt kein
// fsync bei jedem Commit, sondern flusht gebündelt beim WAL-Checkpoint. Das
// reduziert die physische SSD-Schreiblast der häufigen kleinen Poller-Writes
// erheblich, bei WAL ohne Risiko von DB-Korruption (schlimmstenfalls gehen bei
// einem Stromausfall die allerletzten, noch nicht gecheckpointeten Sekunden
// verloren – für die kontinuierlich nachgeführten Energiezähler unkritisch).
db.exec("PRAGMA synchronous = NORMAL");

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    date                   TEXT PRIMARY KEY,
    verbrauch              REAL NOT NULL,
    pvSpeicher             REAL NOT NULL,
    netzbezug              REAL NOT NULL,
    eingespeist            REAL NOT NULL,
    autarkie               REAL NOT NULL,
    pvDirekt               REAL NOT NULL DEFAULT 0, -- Eigenverbrauch unmittelbar aus PV
    speicher               REAL NOT NULL DEFAULT 0, -- Eigenverbrauch aus dem Speicher
    eingespeist42cPv       REAL NOT NULL DEFAULT 0, -- an §42c-Abnehmer aus PV
    eingespeist42cSpeicher REAL NOT NULL DEFAULT 0  -- an §42c-Abnehmer aus Speicher
  );

  CREATE TABLE IF NOT EXISTS drosselungen (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    date   TEXT NOT NULL,
    value  REAL NOT NULL,
    source TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS resets (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spotpreise (
    date   TEXT PRIMARY KEY,    -- Liefertag YYYY-MM-DD
    prices TEXT NOT NULL,       -- JSON: Array von ct/kWh (96 Viertelstunden)
    fetched TEXT NOT NULL       -- Zeitpunkt des Abrufs (ISO)
  );

  CREATE TABLE IF NOT EXISTS viertelstunden (
    ts                 TEXT PRIMARY KEY, -- Ende der Viertelstunde, ISO (lokal): YYYY-MM-DDTHH:MM
    eingespeist        REAL NOT NULL,    -- kWh in dieser Viertelstunde ins Netz
    bezogen            REAL NOT NULL,    -- kWh in dieser Viertelstunde aus dem Netz
    verbrauch          REAL NOT NULL,    -- kWh Hausverbrauch in dieser Viertelstunde
    eingespeistPv      REAL NOT NULL DEFAULT 0, -- Einspeisung aus PV-Überschuss
    eingespeistBatt    REAL NOT NULL DEFAULT 0, -- Einspeisung aus Speicher
    verbrauchPv        REAL NOT NULL DEFAULT 0, -- Hausverbrauch unmittelbar aus PV
    verbrauchSpeicher  REAL NOT NULL DEFAULT 0, -- Hausverbrauch aus dem Speicher
    eingespeist42cPv   REAL NOT NULL DEFAULT 0, -- an §42c-Abnehmer aus PV
    eingespeist42cBatt REAL NOT NULL DEFAULT 0  -- an §42c-Abnehmer aus Speicher
  );

  CREATE TABLE IF NOT EXISTS sharing_viertelstunden (
    ts      TEXT NOT NULL,  -- Ende der Viertelstunde, lokal: YYYY-MM-DDTHH:MM
    source  TEXT NOT NULL,  -- Quellen-ID des externen §42c-Zählers
    bezogen REAL NOT NULL,  -- kWh Netzbezug dieses Haushalts in dieser Viertelstunde
    PRIMARY KEY (ts, source)
  );
  CREATE TABLE IF NOT EXISTS consumer_viertelstunden (
    ts        TEXT NOT NULL,  -- Ende der Viertelstunde, lokal: YYYY-MM-DDTHH:MM
    consumer  TEXT NOT NULL,  -- Quellen-ID des Verbrauchers
    verbrauch REAL NOT NULL,  -- kWh Verbrauch dieses Geräts in dieser Viertelstunde
    PRIMARY KEY (ts, consumer)
  );
  CREATE TABLE IF NOT EXISTS pv_viertelstunden (
    ts      TEXT NOT NULL,  -- Ende der Viertelstunde, lokal: YYYY-MM-DDTHH:MM
    source  TEXT NOT NULL,  -- Quellen-ID der PV-Anlage
    ertrag  REAL NOT NULL,  -- kWh PV-Ertrag dieser Anlage in dieser Viertelstunde
    PRIMARY KEY (ts, source)
  );
  CREATE TABLE IF NOT EXISTS wasser_viertelstunden (
    ts       TEXT PRIMARY KEY, -- Ende der Viertelstunde, lokal: YYYY-MM-DDTHH:MM
    liter    REAL NOT NULL     -- Wasserverbrauch dieser Viertelstunde in Litern
  );
  CREATE TABLE IF NOT EXISTS wasser_zaehler (
    ts    TEXT PRIMARY KEY, -- Zeitpunkt der Ablesung, ISO
    stand REAL NOT NULL     -- Zählerstand in m³ (kubik)
  );
  CREATE TABLE IF NOT EXISTS wp_data (
    ts    TEXT NOT NULL,  -- Zeitpunkt der Messung, lokal: YYYY-MM-DDTHH:MM:SS
    label TEXT NOT NULL,  -- Name der Datenreihe (Feld-Label der WP-Quelle)
    value REAL NOT NULL,  -- numerischer Messwert (bool -> 0/1)
    PRIMARY KEY (ts, label)
  );
  CREATE INDEX IF NOT EXISTS idx_wp_data_ts ON wp_data(ts);
  CREATE TABLE IF NOT EXISTS wp_power (
    ts    TEXT PRIMARY KEY,  -- Zeitpunkt, lokal: YYYY-MM-DDTHH:MM:SS
    value REAL NOT NULL      -- elektrische Leistungsaufnahme der WP (W, ganzzahlig)
  );
  CREATE INDEX IF NOT EXISTS idx_wp_power_ts ON wp_power(ts);
  -- Generische Geräte-Datenreihen (Luftsensor, Lüftung, 3D-Drucker, später mehr).
  -- Nur ausgewählte, nicht-energiebezogene Datenpunkte je Quelle werden hier
  -- persistiert (Auswahl je Quelle in der Konfiguration, Default aus).
  CREATE TABLE IF NOT EXISTS device_data (
    source_id TEXT NOT NULL,  -- Quellen-ID
    ts        TEXT NOT NULL,  -- Zeitpunkt, lokal: YYYY-MM-DDTHH:MM:SS
    label     TEXT NOT NULL,  -- Name des Datenpunkts
    value     REAL NOT NULL,  -- numerischer Wert (bool -> 0/1)
    PRIMARY KEY (source_id, ts, label)
  );
  CREATE INDEX IF NOT EXISTS idx_device_data ON device_data(source_id, label, ts);
  -- Hochaufgelöste Energiemessung (elektrische Leistung) je Gerät, entkoppelt von
  -- device_data. Analog zur früheren wp_power, aber für beliebige Geräte. Der
  -- Leistungswert schwankt fast bei jedem Poll; die Entkopplung hält die
  -- Zustands-Änderungserkennung der übrigen Datenpunkte wirksam.
  CREATE TABLE IF NOT EXISTS device_power (
    source_id TEXT NOT NULL,
    ts        TEXT NOT NULL,
    value     REAL NOT NULL,   -- elektrische Leistungsaufnahme (W, ganzzahlig)
    PRIMARY KEY (source_id, ts)
  );
  CREATE INDEX IF NOT EXISTS idx_device_power ON device_power(source_id, ts);
  -- Zugangskontrolle: Protokoll empfangener Karten/PINs.
  CREATE TABLE IF NOT EXISTS access_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,   -- Reader-Quelle
    ts        TEXT NOT NULL,   -- Empfangszeitpunkt (Wanduhr, lokal ISO)
    art       TEXT NOT NULL,   -- "card" | "pin"
    wert      TEXT NOT NULL,   -- gelesene ID bzw. eingegebene PIN
    bits      INTEGER,         -- Frame-Länge (26/34) bzw. 4
    ergebnis  TEXT,            -- "ok" | "denied" | "unbekannt" (Schritt 2)
    name      TEXT             -- Klartext-Name des Whitelist-Eintrags (Schritt 2)
  );
  CREATE INDEX IF NOT EXISTS idx_access_log ON access_log(source_id, ts);
  -- CO₂-Bilanz: je Viertelstunde die Netz-CO₂-Intensität (g/kWh) und die daraus
  -- mit dem Netzbezug berechneten Emissionen (g). Grundlage der echten CO₂-Bilanz.
  CREATE TABLE IF NOT EXISTS co2_log (
    ts          TEXT PRIMARY KEY,  -- Viertelstunden-Zeitstempel (lokal ISO)
    intensitaet REAL NOT NULL,     -- g CO₂ / kWh (Netz)
    netzbezugKwh REAL NOT NULL,    -- Netzbezug in dieser Viertelstunde (kWh)
    emissionenG REAL NOT NULL      -- intensitaet * netzbezugKwh
  );
  CREATE TABLE IF NOT EXISTS wp_kpi_tag (
    tag              TEXT PRIMARY KEY,  -- YYYY-MM-DD
    kompressorH      REAL,   -- Kompressor-Laufzeit in Stunden
    heizH            REAL,   -- davon Heizbetrieb (h)
    wwH              REAL,   -- davon Warmwasserbetrieb (h)
    energieKwh       REAL,   -- Energiebedarf gesamt (kWh, aus verlinkter Mess-Quelle)
    energieStandbyKwh REAL,  -- Standby-Anteil (<20 W) in kWh
    energieHeizKwh   REAL,   -- elektrische Energie Heizbetrieb (kWh)
    energieWwKwh     REAL,   -- elektrische Energie Warmwasserbetrieb (kWh)
    energieKuehlKwh  REAL,   -- elektrische Energie Kühlbetrieb (kWh)
    waermeKwh        REAL,   -- abgegebene Wärmemenge gesamt (kWh, aus Heizleistung integriert)
    waermeHeizKwh    REAL,   -- davon Heizbetrieb (kWh)
    waermeWwKwh      REAL,   -- davon Warmwasserbetrieb (kWh)
    kaelteKwh        REAL,   -- abgegebene Kältemenge Kühlbetrieb (kWh)
    takte            INTEGER,-- Anzahl Kompressor-Starts
    abtauungen       INTEGER,-- Anzahl Abtauzyklen
    pvKwh            REAL,   -- durch PV gedeckter Energieanteil (kWh)
    -- Übergangszustand am Tagesende (für robuste Zählung über Mitternacht):
    endKompLief      INTEGER,-- lief der Kompressor am Tagesende? (0/1)
    endAbtau         INTEGER  -- war am Tagesende eine Abtauung aktiv? (0/1)
  );
  CREATE TABLE IF NOT EXISTS warmwasser_data (
    ts       TEXT PRIMARY KEY,  -- Zeitpunkt der Messung, lokal: YYYY-MM-DDTHH:MM:SS
    tankUp   REAL,              -- Warmwasserspeicher oben (°C), null wenn n/a
    tankDown REAL               -- Warmwasserspeicher unten (°C), null wenn n/a
  );
  CREATE INDEX IF NOT EXISTS idx_warmwasser_data_ts ON warmwasser_data(ts);
  CREATE TABLE IF NOT EXISTS pv_prognose (
    date            TEXT NOT NULL,     -- Prognosetag: YYYY-MM-DD
    anlage_id       TEXT NOT NULL,     -- ID der PV-Anlage
    anlage_name     TEXT NOT NULL,     -- Anzeigename (Snapshot zum Abrufzeitpunkt)
    slots           TEXT NOT NULL,     -- 96 kWh-Werte je Viertelstunde als JSON-Array
    kwh_total       REAL NOT NULL,     -- prognostizierter Tagesertrag der Anlage (kWh)
    updated_at      TEXT NOT NULL,     -- Zeitpunkt dieses Abrufs (ISO)
    -- Historie: jeder inhaltlich veraenderte Abruf wird als eigener Datensatz
    -- gespeichert (updated_at Teil des Primaerschluessels). So laesst sich der
    -- zeitliche Verlauf der Prognosen je Tag rekonstruieren (Slider im Frontend).
    PRIMARY KEY (date, anlage_id, updated_at)
  );
  CREATE TABLE IF NOT EXISTS logs (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     TEXT NOT NULL,    -- ISO-Zeitstempel (UTC)
    level  INTEGER NOT NULL, -- 10=debug,20=info,30=warn,40=error
    source TEXT NOT NULL,    -- Kontext/Modul (z.B. "poll", "spot")
    msg    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
  CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
  CREATE TABLE IF NOT EXISTS eebus_logs (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,   -- "lpp" = Ansteuerungs-Protokoll, "eebus" = Ereignis-Protokoll
    ts   TEXT NOT NULL,   -- ISO-Zeitstempel
    data TEXT NOT NULL    -- kompletter Log-Eintrag als JSON (struktur-tolerant)
  );
  CREATE INDEX IF NOT EXISTS idx_eebus_logs_kind ON eebus_logs(kind, id);
`);

// Nachrüstung: fehlende Spalten der wp_kpi_tag-Tabelle ergänzen (falls die
// Tabelle aus einer früheren Version ohne die modusgetrennten Energiespalten
// stammt). ADD COLUMN ist idempotent abgesichert über die Spaltenprüfung.
(function ensureWpKpiColumns() {
  try {
    const cols = new Set(
      (db.prepare("PRAGMA table_info(wp_kpi_tag)").all() as Array<{ name: string }>).map((r) => r.name)
    );
    const add = (name: string, decl: string) => {
      if (!cols.has(name)) db.exec(`ALTER TABLE wp_kpi_tag ADD COLUMN ${name} ${decl}`);
    };
    add("energieHeizKwh", "REAL");
    add("energieWwKwh", "REAL");
    add("energieKuehlKwh", "REAL");
    add("waermeHeizKwh", "REAL");
    add("waermeWwKwh", "REAL");
    add("kaelteKwh", "REAL");
  } catch { /* Tabelle existiert noch nicht – wird per CREATE angelegt */ }
})();

// Einmalige Migration: früher lag die elektrische Leistung als Label
// "_ElektrischW" in wp_data. Sie wird jetzt in der separaten, entkoppelten Reihe
// wp_power geführt. Bestehende Werte werden übertragen (auf ganze Watt gerundet)
// und danach aus wp_data entfernt. Idempotent: läuft nur, solange noch
// _ElektrischW-Zeilen in wp_data vorhanden sind.
(function migrateElektrischWToPower() {
  try {
    const vorhanden = db.prepare(
      "SELECT COUNT(*) AS c FROM wp_data WHERE label = '_ElektrischW'"
    ).get() as { c: number };
    if (!vorhanden || vorhanden.c === 0) return;
    db.exec("BEGIN");
    try {
      // Übertragen (round, damit konsistent zur neuen Speicherung). Bei Konflikt
      // (ts existiert schon in wp_power) den vorhandenen Wert behalten.
      db.exec(
        `INSERT OR IGNORE INTO wp_power (ts, value)
         SELECT ts, CAST(ROUND(value) AS INTEGER) FROM wp_data WHERE label = '_ElektrischW'`
      );
      db.exec("DELETE FROM wp_data WHERE label = '_ElektrischW'");
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch { /* wp_data/wp_power evtl. noch nicht vorhanden – unkritisch */ }
})();


const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setSettingStmt = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

function getSetting(key: string): string | undefined {
  const row = getSettingStmt.get(key) as { value: string } | undefined;
  return row?.value;
}
function setSetting(key: string, value: string | number): void {
  setSettingStmt.run(key, String(value));
}

// Öffentliche Roh-Zugriffe auf beliebige Settings-Schlüssel (für Feature-Module
// wie PV-Anlagen, die ihre Daten als JSON unter einem eigenen Schlüssel ablegen).
export function getSettingRaw(key: string): string | undefined {
  return getSetting(key);
}
export function setSettingRaw(key: string, value: string): void {
  setSetting(key, value);
}

// --- Default-Werte für die Energiekosten-Einstellungen ---
// Preisbestandteile in ct/kWh netto (sofern nicht anders vermerkt).
// Zeitfenster vorbelegt mit EWE-Netz Modul 3 (Stand 2026): Hochlast
// 16:30–20:30, Niedriglast 23:00–05:00, ganzjährig (alle Quartale).
const ENERGY_DEFAULTS = {
  tarifMode: "dyn" as "fix" | "dyn",
  anbieterName: "",
  prognoseIntervalMin: 90,
  grundgebuehrMonat: 0,
  messstelleEuroJahr: 0,
  sofortbonus: 0,
  neukundenbonus: 0,
  beschaffung: 1.80673,
  stromsteuer: 2.05,
  konzessionsabgabe: 1.99,
  aufschlagNetznutzung: 1.559,
  offshoreUmlage: 0.941,
  kwkgUmlage: 0.44,
  umsatzsteuer: 19,
  einspeiseverguetung: 0.078785, // €/kWh (Default, in den Einstellungen änderbar)
  eegRegelung: "vor2502" as "vor2502" | "ab2502",
  paragraf14aModul1Aktiv: true,
  modul1PauschaleNetto: 91.23, // €/Jahr netto
  paragraf14aAktiv: true,
  netzentgeltStandard: 3.2,
  netzentgeltHoch: 5.62,
  netzentgeltNiedrig: 0.32,
  lastWindows: [
    { kind: "hoch", startMin: 16 * 60 + 30, endMin: 20 * 60 + 30, quarters: [1, 2, 3, 4] },
    { kind: "niedrig", startMin: 23 * 60, endMin: 5 * 60, quarters: [1, 2, 3, 4] },
  ] as Array<{ kind: "hoch" | "niedrig"; startMin: number; endMin: number; quarters: number[] }>,
  sharingMode: "dynamisch" as "dynamisch" | "statisch",
  // Visualisierungs-Farben (Defaults)
  vizColorSpotPositiv: "#2d6a00",
  vizColorSpotNegativ: "#c0152f",
  vizColorVerbrauchGesamt: "#2563eb",
  vizColorVerbrauchPv: "#f2c200",
  vizColorVerbrauchSpeicher: "#1f6b3b",
  vizColorNetzbezug: "#595959",
  vizColorEinspeisungGesamt: "#111111",
  vizColorEinspeisungPv: "#b8b8b8",
  vizColorEinspeisungSpeicher: "#d2691e",
};

// Standard-Schriftgrößen je Text-Typ (Desktop/Mobil, px) – entsprechen dem
// CSS-Raster. Mobil identisch zum Desktop, bis der Nutzer es anpasst.
export const FONT_SIZE_DEFAULTS = {
  h1:    { desktop: 26, mobile: 20 },
  h2:    { desktop: 20, mobile: 16 },
  h3:    { desktop: 18, mobile: 14 },
  h4:    { desktop: 16, mobile: 12 },
  body:  { desktop: 14, mobile: 11 },
  hint:  { desktop: 14, mobile: 10 },
  table: { desktop: 13, mobile: 10 },
  small: { desktop: 12, mobile: 10 },
  tiny:  { desktop: 11, mobile: 9 },
  "diagram-value": { desktop: 14, mobile: 14 },
  "diagram-text":  { desktop: 20, mobile: 20 },
  kpi:   { desktop: 24, mobile: 20 },
  nav:   { desktop: 15, mobile: 15 },
  charttitle: { desktop: 15, mobile: 15 },
  badge: { desktop: 12, mobile: 12 },
  axis:  { desktop: 10, mobile: 10 },
};

// Defaults initialisieren, falls leer
if (getSetting("strompreis") === undefined)
  setSetting("strompreis", DEFAULTS.strompreis);
if (getSetting("hourLastReset") === undefined) setSetting("hourLastReset", -1);
if (getSetting("minuteLastReset") === undefined)
  setSetting("minuteLastReset", -1);
// Energiekosten-Defaults (Skalare als settings-Zeilen, Zeitfenster als JSON)
for (const [k, v] of Object.entries(ENERGY_DEFAULTS)) {
  if (k === "lastWindows") continue;
  if (getSetting(k) === undefined) setSetting(k, v as number | string);
}
if (getSetting("lastWindows") === undefined)
  setSetting("lastWindows", JSON.stringify(ENERGY_DEFAULTS.lastWindows));

function getNum(key: string, fallback: number): number {
  const v = getSetting(key);
  return v === undefined ? fallback : Number(v);
}

// Lädt die konfigurierten Schriftgrößen (als JSON gespeichert) und füllt fehlende
// Typen/Werte robust aus den Defaults auf.
function loadFontSizes() {
  let raw: any = {};
  try { raw = JSON.parse(getSetting("fontSizes") ?? "{}"); } catch { raw = {}; }
  const out: any = {};
  for (const key of Object.keys(FONT_SIZE_DEFAULTS) as Array<keyof typeof FONT_SIZE_DEFAULTS>) {
    const def = FONT_SIZE_DEFAULTS[key];
    const cur = raw && typeof raw === "object" ? raw[key] : undefined;
    out[key] = {
      desktop: cur && Number.isFinite(Number(cur.desktop)) ? Number(cur.desktop) : def.desktop,
      mobile: cur && Number.isFinite(Number(cur.mobile)) ? Number(cur.mobile) : def.mobile,
    };
  }
  return out;
}

export function loadSettings(): Settings {
  let lastWindows: Settings["lastWindows"];
  try {
    lastWindows = JSON.parse(getSetting("lastWindows") ?? "[]");
    if (!Array.isArray(lastWindows)) lastWindows = ENERGY_DEFAULTS.lastWindows;
  } catch {
    lastWindows = ENERGY_DEFAULTS.lastWindows;
  }
  return {
    strompreis: Number(getSetting("strompreis")),
    tarifMode: (getSetting("tarifMode") as "fix" | "dyn") ?? ENERGY_DEFAULTS.tarifMode,
    anbieterName: (getSetting("anbieterName") as string) ?? ENERGY_DEFAULTS.anbieterName,
    prognoseIntervalMin: getNum("prognoseIntervalMin", ENERGY_DEFAULTS.prognoseIntervalMin),
    grundgebuehrMonat: getNum("grundgebuehrMonat", ENERGY_DEFAULTS.grundgebuehrMonat),
    messstelleEuroJahr: getNum("messstelleEuroJahr", ENERGY_DEFAULTS.messstelleEuroJahr),
    sofortbonus: getNum("sofortbonus", ENERGY_DEFAULTS.sofortbonus),
    neukundenbonus: getNum("neukundenbonus", ENERGY_DEFAULTS.neukundenbonus),
    beschaffung: getNum("beschaffung", ENERGY_DEFAULTS.beschaffung),
    stromsteuer: getNum("stromsteuer", ENERGY_DEFAULTS.stromsteuer),
    konzessionsabgabe: getNum("konzessionsabgabe", ENERGY_DEFAULTS.konzessionsabgabe),
    aufschlagNetznutzung: getNum("aufschlagNetznutzung", ENERGY_DEFAULTS.aufschlagNetznutzung),
    offshoreUmlage: getNum("offshoreUmlage", ENERGY_DEFAULTS.offshoreUmlage),
    kwkgUmlage: getNum("kwkgUmlage", ENERGY_DEFAULTS.kwkgUmlage),
    umsatzsteuer: getNum("umsatzsteuer", ENERGY_DEFAULTS.umsatzsteuer),
    einspeiseverguetung: getNum("einspeiseverguetung", ENERGY_DEFAULTS.einspeiseverguetung),
    eegRegelung:
      (getSetting("eegRegelung") as "vor2502" | "ab2502") ?? "vor2502",
    paragraf14aModul1Aktiv:
      getSetting("paragraf14aModul1Aktiv") == null
        ? ENERGY_DEFAULTS.paragraf14aModul1Aktiv
        : getSetting("paragraf14aModul1Aktiv") === "1",
    modul1PauschaleNetto: getNum("modul1PauschaleNetto", ENERGY_DEFAULTS.modul1PauschaleNetto),
    paragraf14aAktiv:
      getSetting("paragraf14aAktiv") == null
        ? ENERGY_DEFAULTS.paragraf14aAktiv
        : getSetting("paragraf14aAktiv") === "1",
    netzentgeltStandard: getNum("netzentgeltStandard", ENERGY_DEFAULTS.netzentgeltStandard),
    netzentgeltHoch: getNum("netzentgeltHoch", ENERGY_DEFAULTS.netzentgeltHoch),
    netzentgeltNiedrig: getNum("netzentgeltNiedrig", ENERGY_DEFAULTS.netzentgeltNiedrig),
    lastWindows,
    sharingMode:
      (getSetting("sharingMode") as "dynamisch" | "statisch") ?? "dynamisch",
    vizColorSpotPositiv: getSetting("vizColorSpotPositiv") ?? ENERGY_DEFAULTS.vizColorSpotPositiv,
    vizColorSpotNegativ: getSetting("vizColorSpotNegativ") ?? ENERGY_DEFAULTS.vizColorSpotNegativ,
    vizColorVerbrauchGesamt: getSetting("vizColorVerbrauchGesamt") ?? ENERGY_DEFAULTS.vizColorVerbrauchGesamt,
    vizColorVerbrauchPv: getSetting("vizColorVerbrauchPv") ?? ENERGY_DEFAULTS.vizColorVerbrauchPv,
    vizColorVerbrauchSpeicher: getSetting("vizColorVerbrauchSpeicher") ?? ENERGY_DEFAULTS.vizColorVerbrauchSpeicher,
    vizColorNetzbezug: getSetting("vizColorNetzbezug") ?? ENERGY_DEFAULTS.vizColorNetzbezug,
    vizColorEinspeisungGesamt: getSetting("vizColorEinspeisungGesamt") ?? ENERGY_DEFAULTS.vizColorEinspeisungGesamt,
    vizColorEinspeisungPv: getSetting("vizColorEinspeisungPv") ?? ENERGY_DEFAULTS.vizColorEinspeisungPv,
    vizColorEinspeisungSpeicher: getSetting("vizColorEinspeisungSpeicher") ?? ENERGY_DEFAULTS.vizColorEinspeisungSpeicher,
    hourLastReset: Number(getSetting("hourLastReset")),
    minuteLastReset: Number(getSetting("minuteLastReset")),
    fontSizes: loadFontSizes(),
    wasserFrischEuroM3: getNum("wasserFrischEuroM3", 2.0),
    wasserAbwasserEuroM3: getNum("wasserAbwasserEuroM3", 3.0),
    wasserGrundpreisMonat: getNum("wasserGrundpreisMonat", 10.0),
  };
}

// Speichert das komplette Energiekosten-Settings-Objekt (außer Reset-Zeiten).
export function saveSettings(s: Partial<Settings>): void {
  const scalar: Array<keyof Settings> = [
    "strompreis", "tarifMode", "anbieterName", "prognoseIntervalMin", "grundgebuehrMonat", "messstelleEuroJahr", "sofortbonus", "neukundenbonus", "beschaffung", "stromsteuer",
    "konzessionsabgabe", "aufschlagNetznutzung", "offshoreUmlage",
    "kwkgUmlage", "umsatzsteuer", "einspeiseverguetung", "eegRegelung",
    "modul1PauschaleNetto",
    "netzentgeltStandard", "netzentgeltHoch", "netzentgeltNiedrig",
    "sharingMode",
    "vizColorSpotPositiv", "vizColorSpotNegativ",
    "vizColorVerbrauchGesamt", "vizColorVerbrauchPv", "vizColorVerbrauchSpeicher",
    "vizColorNetzbezug",
    "vizColorEinspeisungGesamt", "vizColorEinspeisungPv", "vizColorEinspeisungSpeicher",
    "wasserFrischEuroM3", "wasserAbwasserEuroM3", "wasserGrundpreisMonat",
  ];
  for (const k of scalar) {
    if (s[k] !== undefined) setSetting(k, s[k] as number | string);
  }
  if (s.paragraf14aAktiv !== undefined)
    setSetting("paragraf14aAktiv", s.paragraf14aAktiv ? "1" : "0");
  if (s.paragraf14aModul1Aktiv !== undefined)
    setSetting("paragraf14aModul1Aktiv", s.paragraf14aModul1Aktiv ? "1" : "0");
  if (s.lastWindows !== undefined)
    setSetting("lastWindows", JSON.stringify(s.lastWindows));
  if (s.fontSizes !== undefined)
    setSetting("fontSizes", JSON.stringify(s.fontSizes));
}

export function saveSetting(key: string, value: number | string): void {
  setSetting(key, value);
}

// --- Benachrichtigungs-Einstellungen (ntfy) ---
import type { NotifySettings } from "./types.js";

const NOTIFY_DEFAULTS: NotifySettings = {
  enabled: false,
  server: "https://ntfy.sh",
  topic: "",
  minIntervalMin: 15,
  notifyLpc: true,
  notifyLpp: true,
  notifyRules: true,
  notifyAnomalie: {},
};

export function loadNotifySettings(): NotifySettings {
  const raw = getSetting("notifySettings");
  let parsed: any = {};
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  const merged = { ...NOTIFY_DEFAULTS, ...parsed };
  return {
    enabled: !!merged.enabled,
    server: merged.server,
    topic: merged.topic,
    minIntervalMin: Number(merged.minIntervalMin) || NOTIFY_DEFAULTS.minIntervalMin,
    // Neue thematische Schalter: fehlen sie (Altbestand), gilt "an" als Default,
    // damit bisheriges Verhalten erhalten bleibt.
    notifyLpc: merged.notifyLpc !== false,
    notifyLpp: merged.notifyLpp !== false,
    notifyRules: merged.notifyRules !== false,
    notifyAnomalie: (merged.notifyAnomalie && typeof merged.notifyAnomalie === "object") ? merged.notifyAnomalie : {},
  };
}

// --- Mehrere ntfy-Kanäle + Auslöser-Zuordnung (Routing) ---
export interface NtfyChannel { id: string; name: string; server: string; topic: string; priority?: number; enabled: boolean; }
// Routing: Auslöser-ID -> Liste von Kanal-IDs.
export type NotifyRouting = Record<string, string[]>;

export function loadNtfyChannels(): NtfyChannel[] {
  const raw = getSetting("ntfyChannels");
  if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch { /* ignore */ } }
  // Migration: alten Einzelkanal als ersten Kanal übernehmen.
  const alt = loadNotifySettings();
  if (alt.topic) return [{ id: "ch_default", name: "Standard", server: alt.server, topic: alt.topic, priority: 3, enabled: alt.enabled }];
  return [];
}
export function saveNtfyChannels(channels: NtfyChannel[]): void {
  setSettingRaw("ntfyChannels", JSON.stringify(channels));
}
export function loadNotifyRouting(): NotifyRouting {
  const raw = getSetting("notifyRouting");
  if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === "object") return p; } catch { /* ignore */ } }
  return {};
}
export function saveNotifyRouting(routing: NotifyRouting): void {
  setSettingRaw("notifyRouting", JSON.stringify(routing));
}

export function saveNotifySettings(s: Partial<NotifySettings>): void {
  const merged = { ...loadNotifySettings(), ...s };
  setSetting("notifySettings", JSON.stringify(merged));
}

// --- Zeitversionierte Kostenperioden ---
import type {
  StromtarifPeriode, Modul1Periode, Modul3Periode, WasserPeriode,
} from "./types.js";
import {
  MIN_DATE, pickPeriode, stromtarifFromSettings, modul1FromSettings, modul3FromSettings, wasserFromSettings,
} from "./periods.js";

function loadPerioden<T>(key: string): T[] | null {
  const raw = getSetting(key);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  } catch {
    return null;
  }
}

// Migration: existiert noch keine Perioden-Liste, wird beim ersten Zugriff aus
// den bisherigen (zeitlosen) Settings eine einzige Periode ab MIN_DATE erzeugt.
// Dadurch rechnet alles unverändert weiter, aber eine Historie ist möglich.
function ensurePerioden(): void {
  const s = loadSettings();
  if (!getSetting("stromtarifPerioden")) {
    setSetting("stromtarifPerioden", JSON.stringify([{ gueltigAb: MIN_DATE, werte: stromtarifFromSettings(s) }]));
  }
  if (!getSetting("modul1Perioden")) {
    setSetting("modul1Perioden", JSON.stringify([{ gueltigAb: MIN_DATE, werte: modul1FromSettings(s) }]));
  }
  if (!getSetting("modul3Perioden")) {
    setSetting("modul3Perioden", JSON.stringify([{ gueltigAb: MIN_DATE, werte: modul3FromSettings(s) }]));
  }
  if (!getSetting("wasserPerioden")) {
    setSetting("wasserPerioden", JSON.stringify([{ gueltigAb: MIN_DATE, werte: wasserFromSettings(s) }]));
  }
}

export function loadStromtarifPerioden(): StromtarifPeriode[] {
  ensurePerioden();
  const list = loadPerioden<StromtarifPeriode>("stromtarifPerioden") ?? [];
  // Aufräumen: frühere Versionen haben einspeiseverguetung/eegRegelung in die
  // Stromtarif-Periode migriert. Diese Felder sind nicht mehr versioniert und
  // werden hier entfernt, damit sie die globalen Settings nicht überschreiben.
  return list.map((p) => {
    const w = { ...(p.werte as any) };
    delete w.einspeiseverguetung;
    delete w.eegRegelung;
    return { ...p, werte: w };
  });
}
export function loadModul1Perioden(): Modul1Periode[] {
  ensurePerioden();
  return loadPerioden<Modul1Periode>("modul1Perioden") ?? [];
}
export function loadModul3Perioden(): Modul3Periode[] {
  ensurePerioden();
  return loadPerioden<Modul3Periode>("modul3Perioden") ?? [];
}
export function loadWasserPerioden(): WasserPeriode[] {
  ensurePerioden();
  return loadPerioden<WasserPeriode>("wasserPerioden") ?? [];
}

export function saveStromtarifPerioden(p: StromtarifPeriode[]): void {
  setSetting("stromtarifPerioden", JSON.stringify(p));
  // Die zeitlosen Settings weiter mit der HEUTE gültigen Periode synchron halten,
  // damit Anzeigen/Altpfade, die noch loadSettings() nutzen, konsistent sind.
  syncSettingsFromPerioden();
}
export function saveModul1Perioden(p: Modul1Periode[]): void {
  setSetting("modul1Perioden", JSON.stringify(p));
  syncSettingsFromPerioden();
}
export function saveModul3Perioden(p: Modul3Periode[]): void {
  setSetting("modul3Perioden", JSON.stringify(p));
  syncSettingsFromPerioden();
}
export function saveWasserPerioden(p: WasserPeriode[]): void {
  setSetting("wasserPerioden", JSON.stringify(p));
  syncSettingsFromPerioden();
}

// Schreibt die heute gültigen Periodenwerte zurück in die flachen Settings.
function syncSettingsFromPerioden(): void {
  const d = new Date();
  const heute = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const patch: Record<string, unknown> = {};
  const st = pickPeriode(loadStromtarifPerioden(), heute); // gefiltert (ohne EEG)
  if (st) Object.assign(patch, st.werte);
  const m1 = pickPeriode(loadModul1Perioden(), heute);
  if (m1) Object.assign(patch, m1.werte);
  const m3 = pickPeriode(loadModul3Perioden(), heute);
  if (m3) Object.assign(patch, m3.werte);
  const wa = pickPeriode(loadWasserPerioden(), heute);
  if (wa) Object.assign(patch, wa.werte);
  // Einspeisevergütung/EEG-Regelung sind nicht versioniert -> nie überschreiben.
  delete patch.einspeiseverguetung;
  delete patch.eegRegelung;
  if (Object.keys(patch).length > 0) saveSettings(patch as any);
}

// Liefert ein Settings-Objekt, dessen versionierte Felder (Stromtarif, §14a
// Modul 1/3, Wasserkosten) auf die für DATE gültige Periode gesetzt sind. Nicht
// versionierte Felder stammen aus den Basis-Settings. Zentrale Eintrittsstelle
// für die datumsabhängige Kostenberechnung.
export function effectiveSettings(date: string): Settings {
  const base = loadSettings();
  const st = pickPeriode(loadStromtarifPerioden(), date);
  const m1 = pickPeriode(loadModul1Perioden(), date);
  const m3 = pickPeriode(loadModul3Perioden(), date);
  const wa = pickPeriode(loadWasserPerioden(), date);
  return {
    ...base,
    ...(st?.werte ?? {}),
    ...(m1?.werte ?? {}),
    ...(m3?.werte ?? {}),
    ...(wa?.werte ?? {}),
    // Einspeisevergütung und EEG-Regelung sind nicht versioniert: sie gelten
    // dauerhaft und kommen immer aus den globalen Settings – auch wenn eine
    // alte, migrierte Periode diese Felder noch enthalten sollte.
    einspeiseverguetung: base.einspeiseverguetung,
    eegRegelung: base.eegRegelung,
  };
}

// --- Wasserzähler ---
// Zählerstände (m³) als Zeitreihe; Verbrauch je Viertelstunde (Liter) separat.
const insWasserStandStmt = db.prepare(
  "INSERT OR REPLACE INTO wasser_zaehler (ts, stand) VALUES (?, ?)"
);
const insWasserVsStmt = db.prepare(
  "INSERT INTO wasser_viertelstunden (ts, liter) VALUES (?, ?) ON CONFLICT(ts) DO UPDATE SET liter = liter + excluded.liter"
);

export function saveWasserStand(ts: string, standM3: number): void {
  insWasserStandStmt.run(ts, standM3);
}
export function addWasserViertelstunde(ts: string, liter: number): void {
  insWasserVsStmt.run(ts, liter);
}
export function setWasserViertelstunde(ts: string, liter: number): void {
  db.prepare("INSERT OR REPLACE INTO wasser_viertelstunden (ts, liter) VALUES (?, ?)").run(ts, liter);
}
export function getWasserViertelstunden(von: string, bis: string): Array<{ ts: string; liter: number }> {
  return db.prepare(
    "SELECT ts, liter FROM wasser_viertelstunden WHERE ts >= ? AND ts <= ? ORDER BY ts ASC"
  ).all(von, bis) as any[];
}
export function getLetzterWasserStand(): { ts: string; stand: number } | null {
  const r = db.prepare("SELECT ts, stand FROM wasser_zaehler ORDER BY ts DESC LIMIT 1").get() as any;
  return r ?? null;
}
// Tagesverbräuche (Liter) eines Monats aus den Viertelstunden.
export function getWasserTagesverbrauch(von: string, bis: string): Array<{ tag: string; liter: number }> {
  return db.prepare(
    "SELECT substr(ts,1,10) AS tag, SUM(liter) AS liter FROM wasser_viertelstunden WHERE ts >= ? AND ts <= ? GROUP BY tag ORDER BY tag ASC"
  ).all(von, bis) as any[];
}

// --- Automatisierungsregeln ---
import type { AutomationRule, RuleGroup } from "./types.js";

export function loadRules(): AutomationRule[] {
  const raw = getSetting("automationRules");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveRules(rules: AutomationRule[]): void {
  setSetting("automationRules", JSON.stringify(rules));
}

export function loadRuleGroups(): RuleGroup[] {
  const raw = getSetting("automationRuleGroups");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveRuleGroups(groups: RuleGroup[]): void {
  setSetting("automationRuleGroups", JSON.stringify(groups));
}

// Legt einmalig zwei vordefinierte Regeln für die Urlaubs-/Leckageüberwachung an,
// sofern sie noch nicht existieren (Prüfung anhand des Namens). Der Nutzer kann
// sie danach frei ändern oder löschen; ein gelöschter Name wird NICHT neu
// angelegt (dafür wird ein Merker gesetzt).
export function ensureUrlaubsRules(): void {
  const MARKER = "urlaubsRulesSeeded";
  if (getSetting(MARKER) === "1") return;
  setSetting(MARKER, "1");

  const groups = loadRuleGroups();
  const ensureGroup = (name: string): string => {
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { id: "grp_" + Math.random().toString(36).slice(2, 10), name };
      groups.push(g);
    }
    return g.id;
  };
  const infoGid = ensureGroup("Informationen");
  const warnGid = ensureGroup("Warnungen");
  saveRuleGroups(groups);

  const rules = loadRules();
  const uid = () => Math.random().toString(36).slice(2, 10);

  // Regel 1: "Urlaubsmodus" – manuell start-/stoppbar, ohne Aktivierungs-
  // bedingungen und ohne Aktionen. Die Ausschaltbedingungen sind bewusst
  // widersprüchlich (Überschuss > 0 UND Überschuss < 0), sodass die Regel nie
  // von selbst endet – sie wird nur manuell beendet. Auf der Übersicht sichtbar.
  if (!rules.some((r) => r.name === "Urlaubsmodus")) {
    rules.push({
      id: "rule_" + uid(),
      name: "Urlaubsmodus",
      enabled: false,          // nicht scharf: reine manuelle Info-Regel
      groupId: infoGid,
      onWhen: { logic: "and", conditions: [] },
      offWhen: {
        logic: "and",
        conditions: [
          { id: uid(), kind: "metric", metric: "ueberschuss", op: ">", value: 0 },
          { id: uid(), kind: "metric", metric: "ueberschuss", op: "<", value: 0 },
        ],
      },
      onActions: [],
      offActions: [],
      notifyOnActivate: false,
      showOnOverview: true,
    });
  }

  // Regel 2: "Wasserverbrauch im Urlaub" – scharf. Wenn der Urlaubsmodus läuft
  // UND im laufenden Slot Wasser verbraucht wird (> 0 L), Push-Warnung.
  if (!rules.some((r) => r.name === "Wasserverbrauch im Urlaub")) {
    const urlaub = rules.find((r) => r.name === "Urlaubsmodus");
    rules.push({
      id: "rule_" + uid(),
      name: "Wasserverbrauch im Urlaub",
      enabled: true,           // scharf gestellt
      groupId: warnGid,
      onWhen: {
        logic: "and",
        conditions: [
          { id: uid(), kind: "ruleRunning", ruleId: urlaub?.id, ruleRunningExpected: true },
          { id: uid(), kind: "metric", metric: "wasserverbrauch", op: ">", value: 0 },
        ],
      },
      offWhen: { logic: "and", conditions: [] },
      onActions: [
        { type: "notify", message: "ACHTUNG - WASSERVERBRAUCH ERKANNT!" },
      ],
      offActions: [],
      notifyOnActivate: false,
      showOnOverview: false,
    });
  }
  saveRules(rules);
}

// Log der Regel-Auslösungen (eigene Tabelle mit Ergebnis-Text).
db.exec(`
  CREATE TABLE IF NOT EXISTS rule_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,        -- ISO-Zeit
    ruleId   TEXT NOT NULL,
    ruleName TEXT NOT NULL,
    event    TEXT NOT NULL,        -- 'on' | 'off'
    result   TEXT                  -- Ergebnistext (z.B. Energie/Temperatur)
  );
`);

// --- Einmalige Datenübernahme aus einer vorherigen Version (hems_old.db) ---
// Liegt neben der aktuellen hems.db eine Datei "hems_old.db", werden daraus die
// Daten und Einstellungen in die neue DB übernommen. Es wird NICHT die ganze
// Datei kopiert (neue Versionen können zusätzliche Spalten/Tabellen haben),
// sondern je Tabelle nur die Spalten-Schnittmenge (alt ∩ neu). So bleibt das
// neue Schema unangetastet. Nach erfolgreicher Übernahme wird hems_old.db in
// hems_old.imported.<zeitstempel>.db umbenannt, damit die Übernahme nicht bei
// jedem Start erneut läuft.
export interface OldDbImportResult { imported: boolean; tables: Array<{ table: string; rows: number }>; error?: string }
let oldDbImportResult: OldDbImportResult = { imported: false, tables: [] };
export function getOldDbImportResult(): OldDbImportResult { return oldDbImportResult; }

function migrateFromOldDb() {
  const oldPath = path.join(__dirname, "..", "hems_old.db");
  if (!fs.existsSync(oldPath)) return;

  // Tabellen, die übernommen werden. settings zuerst (Einstellungen), dann die
  // Zeitreihen/Stammdaten. Nur Tabellen, die es in beiden DBs gibt, werden
  // angefasst; fehlende werden übersprungen.
  const TABLES = [
    "settings", "history", "resets", "viertelstunden", "pv_viertelstunden",
    "consumer_viertelstunden", "sharing_viertelstunden", "wasser_viertelstunden",
    "wasser_zaehler", "warmwasser_data", "wp_data", "wp_power", "wp_kpi_tag", "drosselungen", "spotpreise",
    "pv_prognose", "logs", "rule_log",
    // Anomalie-Erkennung (Verlauf + Feedback) und EEBUS-Protokolle: müssen bei der
    // Versionsübernahme mitkommen, sonst ist die Anomalie-Liste nach dem Update leer.
    "anomalie_log", "anomalie_feedback", "eebus_logs",
    // Generische Geräte-Datenreihen (Luftsensor, Lüftung, 3D-Drucker, ...).
    "device_data", "device_power",
    // Zugangskontrolle-Protokoll.
    "access_log",
    // CO₂-Bilanz (Netzintensität × Netzbezug je Viertelstunde).
    "co2_log",
  ];
  const tableCols = (attach: string, table: string): string[] => {
    try {
      const rows = db.prepare(`PRAGMA ${attach}table_info(${table})`).all() as Array<{ name: string }>;
      return rows.map((r) => r.name);
    } catch { return []; }
  };

  try {
    db.exec(`ATTACH DATABASE '${oldPath.replace(/'/g, "''")}' AS old`);
  } catch (e: any) {
    oldDbImportResult = { imported: false, tables: [], error: `ATTACH fehlgeschlagen: ${e?.message ?? e}` };
    return;
  }

  const übernommen: Array<{ table: string; rows: number }> = [];
  try {
    // Prüfen, welche Tabellen in der alten DB existieren.
    const oldTables = new Set(
      (db.prepare("SELECT name FROM old.sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name)
    );
    for (const t of TABLES) {
      if (!oldTables.has(t)) continue;
      const neuCols = tableCols("", t);          // Spalten der neuen DB
      const altCols = tableCols("old.", t);      // Spalten der alten DB
      const common = neuCols.filter((c) => altCols.includes(c));
      if (common.length === 0) continue;
      const colList = common.map((c) => `"${c}"`).join(", ");
      // INSERT OR REPLACE: bei Primärschlüssel-Konflikt gewinnt der alte Wert
      // (die neue DB ist beim Erststart ohnehin leer). Nur gemeinsame Spalten.
      const before = (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c;
      db.exec(`INSERT OR REPLACE INTO "${t}" (${colList}) SELECT ${colList} FROM old."${t}"`);
      const after = (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c;
      übernommen.push({ table: t, rows: after - before });
    }
    oldDbImportResult = { imported: true, tables: übernommen };
  } catch (e: any) {
    oldDbImportResult = { imported: false, tables: übernommen, error: e?.message ?? String(e) };
  } finally {
    try { db.exec("DETACH DATABASE old"); } catch { /* ignore */ }
  }

  // Alte Datei nach erfolgreicher Übernahme wegräumen, damit sie nicht bei jedem
  // Start erneut eingelesen wird.
  if (oldDbImportResult.imported) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(oldPath, path.join(__dirname, "..", `hems_old.imported.${stamp}.db`));
    } catch { /* ignore */ }
  }
}
// Migration wird ans Ende der DB-Initialisierung verschoben (nach ALLEN
// CREATE-TABLE-Statements), damit auch spät angelegte Tabellen (Anomalie,
// EEBUS-Logs) als Ziel existieren und übernommen werden. Aufruf: siehe unten.

export function addRuleLog(ruleId: string, ruleName: string, event: string, result: string): void {
  db.prepare("INSERT INTO rule_log (ts, ruleId, ruleName, event, result) VALUES (?, ?, ?, ?, ?)").run(
    new Date().toISOString(),
    ruleId,
    ruleName,
    event,
    result
  );
}

export function getRuleLog(limit = 100): Array<{ ts: string; ruleId: string; ruleName: string; event: string; result: string }> {
  return db
    .prepare("SELECT ts, ruleId, ruleName, event, result FROM rule_log ORDER BY id DESC LIMIT ?")
    .all(limit) as any[];
}

// --- Quellen-Konfiguration (datengetrieben) ---
// Wird als JSON in settings unter "sourcesConfig" gehalten. Beim ersten
// Start mit der Default-Konfiguration befüllt; danach frei editierbar.
import type { SourceConfig } from "./sources.js";
import { DEFAULT_SOURCES, is42cRole } from "./sources.js";

if (getSetting("sourcesConfig") === undefined)
  setSetting("sourcesConfig", JSON.stringify(DEFAULT_SOURCES));

export function loadSources(): SourceConfig[] {
  try {
    const arr = JSON.parse(getSetting("sourcesConfig") ?? "[]");
    if (Array.isArray(arr) && arr.length > 0) {
      // Emu-Rollen immer normalisieren (mock + Standard-Felder erzwingen), damit
      // eine §42c-/Netz-Emulation nie versehentlich per HTTP abgefragt wird –
      // unabhängig davon, wie die Quelle in die Konfiguration gelangt ist.
      return mergeDefaultSources((arr as SourceConfig[]).map(normalizeEmuSource));
    }
  } catch {
    /* fällt auf Defaults zurück */
  }
  // Tiefe Kopie, damit Aufrufer das Modul-Array DEFAULT_SOURCES nicht mutieren.
  return DEFAULT_SOURCES.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) }));
}

// Mischt neue Default-Quellen in die gespeicherte Konfiguration, die dort noch
// fehlen (per id abgeglichen). Bestehende Quellen und ihre Einstellungen bleiben
// unverändert. Vom Nutzer BEWUSST gelöschte Default-Quellen werden NICHT wieder
// hinzugefügt. Kein Migrationsmechanismus, sondern laufende Default-Pflege.
function mergeDefaultSources(arr: SourceConfig[]): SourceConfig[] {
  const out = arr.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) }));
  let changed = false;
  const have = new Set(out.map((s) => s.id));
  const deleted = loadDeletedDefaults();
  // Fehlende Default-Quellen ergänzen.
  for (const def of DEFAULT_SOURCES) {
    if (!have.has(def.id) && !deleted.includes(def.id)) {
      out.push({ ...def, fields: def.fields.map((f) => ({ ...f })) });
      changed = true;
    }
  }
  // Bei bestehenden Default-Quellen einzelne Felder nachziehen, die in der
  // gespeicherten Config (noch) gar nicht vorkommen – z.B. eine später im
  // Default ergänzte Raumzuordnung. Es werden nur fehlende Schlüssel gesetzt;
  // vom Nutzer bewusst gesetzte (auch leere) Werte bleiben unangetastet.
  const byId = new Map(DEFAULT_SOURCES.map((d) => [d.id, d]));
  for (const s of out) {
    const def = byId.get(s.id);
    if (!def) continue;
    if (!("room" in s) && def.room !== undefined) {
      (s as SourceConfig).room = def.room;
      changed = true;
    }
    // Neu im Default hinzugekommene Felder nachziehen (per jsonPath eindeutig).
    // So erscheinen später ergänzte Datenpunkte (z.B. ein weiterer HeishaMon-
    // Wert) auch bei bereits gespeicherten Quellen, ohne vom Nutzer geänderte
    // oder selbst hinzugefügte Felder anzutasten.
    if (Array.isArray(def.fields) && Array.isArray(s.fields)) {
      const havePaths = new Set(s.fields.map((f) => f.jsonPath));
      for (const df of def.fields) {
        if (!havePaths.has(df.jsonPath)) {
          s.fields.push({ ...df });
          changed = true;
        }
      }
    }
  }
  if (changed) setSetting("sourcesConfig", JSON.stringify(out));
  return out;
}

// IDs von Default-Quellen, die der Nutzer bewusst gelöscht hat (damit sie nicht
// durch das Nachmischen wieder auftauchen).
function loadDeletedDefaults(): string[] {
  try {
    const arr = JSON.parse(getSetting("deletedDefaultSources") ?? "[]");
    if (Array.isArray(arr)) return arr as string[];
  } catch {
    /* leer */
  }
  return [];
}

// Erzwingt für die Emulations-Rollen die passende mock-Kennung und die
// Standard-Felder (power / meter / meterOut). So funktioniert eine im Editor
// per Rollenwechsel angelegte Emu-Quelle ohne manuelle Feldpflege.
const EMU_FIELDS = [
  { metric: "power", jsonPath: "power", label: "Leistung Ø/Viertelstunde", unit: "W" },
  { metric: "gridInTotal", jsonPath: "meter", label: "Bezug gesamt", unit: "kWh" },
  { metric: "gridOutTotal", jsonPath: "meterOut", label: "Einspeisung gesamt", unit: "kWh" },
] as const;

function normalizeEmuSource(s: SourceConfig): SourceConfig {
  if (s.role === "grid42cEmu") {
    return { ...s, mock: "emu", url: "", fields: EMU_FIELDS.map((f) => ({ ...f })) };
  }
  if (s.role === "gridEmu") {
    return { ...s, mock: "gridEmu", url: "", fields: EMU_FIELDS.map((f) => ({ ...f })) };
  }
  // Rolle ist keine Emu-Rolle mehr: eventuell gesetzten mock entfernen.
  if (s.mock) {
    const { mock, ...rest } = s;
    return rest as SourceConfig;
  }
  return s;
}

export function saveSources(sources: SourceConfig[]): void {
  const normalized = sources.map(normalizeEmuSource);
  // Konsistenz der Geräte-Verknüpfung (powerSourceId <-> subordinateOf):
  // Jede Quelle, die als powerSourceId einer anderen referenziert wird, bekommt
  // subordinateOf gesetzt; nicht mehr referenzierte Quellen verlieren es wieder.
  const referenced = new Map<string, string>(); // leistungsquelle -> hauptquelle
  for (const s of normalized) {
    if (s.powerSourceId && s.powerSourceId !== s.id) referenced.set(s.powerSourceId, s.id);
  }
  for (const s of normalized) {
    if (referenced.has(s.id)) s.subordinateOf = referenced.get(s.id);
    else if (s.subordinateOf) delete s.subordinateOf;
  }
  // Welche Default-Quellen fehlen jetzt? Diese gelten als bewusst gelöscht.
  const ids = new Set(normalized.map((s) => s.id));
  const deleted = new Set(loadDeletedDefaults());
  for (const def of DEFAULT_SOURCES) {
    if (!ids.has(def.id)) deleted.add(def.id);
  }
  // Falls eine zuvor gelöschte Default-Quelle wieder vorhanden ist (z.B. neu
  // angelegt mit gleicher id), aus der Lösch-Liste entfernen.
  for (const id of ids) deleted.delete(id);
  setSetting("deletedDefaultSources", JSON.stringify([...deleted]));
  setSetting("sourcesConfig", JSON.stringify(normalized));
}

// --- Raumliste (persistent, im Editor verwaltbar) ---
// Beim ersten Start mit Default-Räumen befüllt; danach frei editierbar.
const DEFAULT_ROOMS = [
  "Carport", "Wohnzimmer", "Esszimmer", "Küche", "Büro",
  "Gästezimmer", "Kinderzimmer", "Schlafzimmer", "Ankleide",
  "Badezimmer", "Gästebad", "Flur UG", "Flur OG",
  "Hauswirtschaftsraum", "Abstellraum", "Gebäudeenergietechnik",
  "Gartenhaus",
];

if (getSetting("rooms") === undefined)
  setSetting("rooms", JSON.stringify(DEFAULT_ROOMS));

export function loadRooms(): string[] {
  try {
    const arr = JSON.parse(getSetting("rooms") ?? "[]");
    if (Array.isArray(arr)) return arr as string[];
  } catch {
    /* fällt auf Defaults zurück */
  }
  return DEFAULT_ROOMS;
}

export function saveRooms(rooms: string[]): void {
  // dedupliziert, leere raus, getrimmt
  const clean = [...new Set(rooms.map((r) => r.trim()).filter(Boolean))];
  setSetting("rooms", JSON.stringify(clean));
}

// --- Abnehmer (Energy Sharing §42c) ---
// 1:1-Beziehung: pro §42c-Quelle (grid42c / grid42cEmu) genau ein Abnehmer.
// Die Abnehmerliste wird daher aus den Quellen ABGELEITET – nicht mehr frei
// hinzugefügt/gelöscht. Nur die editierbaren Attribute (Vergütung, Quote)
// werden pro Quelle gespeichert; Name und Quelle ergeben sich aus der Quelle.
type AbnehmerAttr = { verguetung: number; quote: number };

// Editierbare Attribute je Quelle laden (Map sourceId -> {verguetung, quote}).
function loadAbnehmerAttrs(): Record<string, AbnehmerAttr> {
  try {
    const raw = JSON.parse(getSetting("abnehmerAttrs") ?? "{}");
    if (raw && typeof raw === "object") return raw as Record<string, AbnehmerAttr>;
  } catch {
    /* Defaults unten */
  }
  return {};
}

// Leitet die Abnehmerliste aus den aktuellen §42c-Quellen ab. Jede Quelle
// ergibt genau einen Abnehmer; der Name kommt aus dem Quellen-Label, die
// id ist an die sourceId gebunden. Editierbare Attribute werden gemerged,
// fehlen sie, werden Defaults (Vergütung aus sharingQuote/0.10 €/kWh) genutzt.
export function loadAbnehmer(): Abnehmer[] {
  const attrs = loadAbnehmerAttrs();
  return loadSources()
    .filter((s) => is42cRole(s.role) && s.enabled)
    .map((s) => {
      const a = attrs[s.id];
      return {
        id: `abn_${s.id}`,
        name: s.label,
        sourceId: s.id,
        verguetung: a && Number.isFinite(a.verguetung) ? a.verguetung : 0.1,
        quote: a && Number.isFinite(a.quote) ? a.quote : s.sharingQuote ?? 0,
      } as Abnehmer;
    });
}

// Speichert nur die editierbaren Attribute (Vergütung, Quote) je Quelle.
// Quoten werden so gedeckelt, dass die Summe ≤ 100 bleibt.
export function saveAbnehmer(list: Abnehmer[]): void {
  let rest = 100;
  const m: Record<string, AbnehmerAttr> = {};
  for (const a of list) {
    if (!a.sourceId) continue;
    let q = Math.max(0, Math.round(a.quote) || 0);
    if (q > rest) q = rest;
    rest -= q;
    m[a.sourceId] = {
      verguetung: Number.isFinite(a.verguetung) ? a.verguetung : 0.1,
      quote: q,
    };
  }
  setSetting("abnehmerAttrs", JSON.stringify(m));
}

// --- Logging (persistente Debug-Meldungen) ---
export const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevelName = keyof typeof LOG_LEVELS;
export const LOG_LEVEL_NAME: Record<number, LogLevelName> = {
  10: "debug",
  20: "info",
  30: "warn",
  40: "error",
};
const MAX_LOG_ROWS = 5000; // Ringpuffer-Obergrenze

export interface LogEntry {
  id: number;
  ts: string;
  level: number;
  levelName: LogLevelName;
  source: string;
  msg: string;
}

const insertLogStmt = db.prepare(
  "INSERT INTO logs (ts, level, source, msg) VALUES (?, ?, ?, ?)"
);
let logRowEstimate = (db.prepare("SELECT COUNT(*) AS n FROM logs").get() as { n: number }).n;

// Mindest-Level, ab dem gespeichert wird (Default: info). Persistiert in Settings.
export function getLogMinLevel(): number {
  const v = Number(getSetting("logMinLevel"));
  return Number.isFinite(v) && v in LOG_LEVEL_NAME ? v : LOG_LEVELS.info;
}
export function setLogMinLevel(level: number): void {
  if (level in LOG_LEVEL_NAME) setSetting("logMinLevel", level);
}

// --- EEBUS-Protokolle (Ansteuerung "lpp" + Ereignis "eebus") persistent ---
// Beide Protokolle waren früher reine RAM-Puffer und gingen bei jedem Neustart
// verloren. Sie werden jetzt in eebus_logs gespeichert (JSON je Eintrag), sodass
// sie Neustarts und DB-Migrationen überstehen. Ringpuffer je Art via LIMIT/DELETE.
const insertEebusLogStmt = db.prepare("INSERT INTO eebus_logs (kind, ts, data) VALUES (?, ?, ?)");
const trimEebusLogStmt = db.prepare(
  `DELETE FROM eebus_logs WHERE kind = ? AND id NOT IN (
     SELECT id FROM eebus_logs WHERE kind = ? ORDER BY id DESC LIMIT ?
   )`
);
const loadEebusLogStmt = db.prepare(
  "SELECT data FROM eebus_logs WHERE kind = ? ORDER BY id DESC LIMIT ?"
);
// Einen EEBUS-Log-Eintrag persistieren und den Ringpuffer (max) einhalten.
export function persistEebusLog(kind: "lpp" | "eebus", ts: string, data: unknown, max: number): void {
  try {
    insertEebusLogStmt.run(kind, ts, JSON.stringify(data));
    trimEebusLogStmt.run(kind, kind, max);
  } catch { /* Persistenz ist best-effort; RAM-Puffer bleibt maßgeblich */ }
}
// Persistierte EEBUS-Log-Einträge laden (neueste zuerst), als geparste Objekte.
export function loadEebusLog(kind: "lpp" | "eebus", limit: number): unknown[] {
  try {
    const rows = loadEebusLogStmt.all(kind, limit) as unknown as Array<{ data: string }>;
    return rows.map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter((x) => x != null);
  } catch { return []; }
}
// Alle persistierten Einträge einer Art löschen (für "Protokoll leeren").
const clearEebusLogStmt = db.prepare("DELETE FROM eebus_logs WHERE kind = ?");
export function clearEebusLogPersisted(kind: "lpp" | "eebus"): void {
  try { clearEebusLogStmt.run(kind); } catch { /* ignore */ }
}

// --- Anomalie-Historie (beendete Anomalien) als Ringpuffer ---
db.exec(`
  CREATE TABLE IF NOT EXISTS anomalie_log (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    ts   TEXT NOT NULL,   -- beendetAm (ISO)
    data TEXT NOT NULL    -- kompletter Anomalie-Eintrag als JSON
  );
`);
const ANOMALIE_LOG_MAX = 500;
const insertAnomalieStmt = db.prepare("INSERT INTO anomalie_log (ts, data) VALUES (?, ?)");
const trimAnomalieStmt = db.prepare(
  "DELETE FROM anomalie_log WHERE id NOT IN (SELECT id FROM anomalie_log ORDER BY id DESC LIMIT ?)"
);
const loadAnomalieStmt = db.prepare("SELECT data FROM anomalie_log ORDER BY id DESC LIMIT ?");
export function persistAnomalie(a: unknown): void {
  try {
    const ts = (a as { beendetAm?: string }).beendetAm ?? new Date().toISOString();
    insertAnomalieStmt.run(ts, JSON.stringify(a));
    trimAnomalieStmt.run(ANOMALIE_LOG_MAX);
  } catch { /* best-effort */ }
}
export function loadAnomalieHistorie(limit: number): any[] {
  try {
    const rows = loadAnomalieStmt.all(Math.min(limit, ANOMALIE_LOG_MAX)) as unknown as Array<{ data: string }>;
    return rows.map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter((x) => x != null);
  } catch { return []; }
}

// --- Anomalie-Feedback (Bewertungen, Stufe 3) ---
// Getrennte Tabelle, weil das Feedback gezielt für die Vorschläge (Stufe 4)
// ausgewertet wird und eine andere Semantik als das Verlaufsprotokoll hat.
db.exec(`
  CREATE TABLE IF NOT EXISTS anomalie_feedback (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    anom_id  TEXT NOT NULL,   -- ID der bewerteten Anomalie
    ts       TEXT NOT NULL,   -- feedbackAm (ISO)
    feedback TEXT NOT NULL,   -- richtig | unwichtig | fehlalarm
    data     TEXT NOT NULL    -- kompletter Anomalie-Eintrag als JSON (mit Kontext)
  );
  CREATE INDEX IF NOT EXISTS idx_anom_fb_anom ON anomalie_feedback(anom_id);
`);

// JETZT sind alle Tabellen angelegt – Übernahme aus hems_old.db durchführen.
// (Muss nach ALLEN CREATE-TABLE-Statements stehen, damit jede Ziel-Tabelle
// existiert und die Daten – auch Anomalie/EEBUS-Logs – übernommen werden.)
migrateFromOldDb();

// Einmalige Migration der Wärmepumpen-Datenreihen in die verallgemeinerte
// device_data/device_power-Struktur. Idempotent: läuft nur, solange noch
// wp_data/wp_power-Zeilen existieren und eine WP-Quelle bekannt ist.
(function migrateWpToDevice() {
  try {
    const hatWp = (db.prepare("SELECT COUNT(*) AS c FROM wp_data").get() as any)?.c ?? 0;
    const hatWpPower = (db.prepare("SELECT COUNT(*) AS c FROM wp_power").get() as any)?.c ?? 0;
    if (hatWp === 0 && hatWpPower === 0) return;
    const wpSrc = loadSources().find((s) => s.deviceType === "heatpump");
    if (!wpSrc) return; // ohne bekannte Quelle nicht migrieren (später erneut)
    const wpId = wpSrc.id;
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO device_data (source_id, ts, label, value)
         SELECT ?, ts, label, value FROM wp_data
         WHERE NOT EXISTS (
           SELECT 1 FROM device_data d WHERE d.source_id = ? AND d.ts = wp_data.ts AND d.label = wp_data.label
         )`
      ).run(wpId, wpId);
      db.prepare(
        `INSERT INTO device_power (source_id, ts, value)
         SELECT ?, ts, value FROM wp_power
         WHERE NOT EXISTS (
           SELECT 1 FROM device_power p WHERE p.source_id = ? AND p.ts = wp_power.ts
         )`
      ).run(wpId, wpId);
      db.exec("DELETE FROM wp_data");
      db.exec("DELETE FROM wp_power");
      db.exec("COMMIT");
      addLog(LOG_LEVELS.info, "migration", `Waermepumpen-Daten in device_data/device_power migriert (Quelle ${wpId})`);
    } catch (e: any) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
      addLog(LOG_LEVELS.warn, "migration", `WP->device-Migration fehlgeschlagen: ${e?.message ?? e}`);
    }
  } catch { /* Tabellen evtl. noch nicht da */ }
})();

const ANOMALIE_FB_MAX = 1000;
const insertAnomFbStmt = db.prepare("INSERT INTO anomalie_feedback (anom_id, ts, feedback, data) VALUES (?, ?, ?, ?)");
const trimAnomFbStmt = db.prepare("DELETE FROM anomalie_feedback WHERE id NOT IN (SELECT id FROM anomalie_feedback ORDER BY id DESC LIMIT ?)");
const loadAnomFbStmt = db.prepare("SELECT data FROM anomalie_feedback ORDER BY id DESC LIMIT ?");
const existsAnomFbStmt = db.prepare("SELECT id FROM anomalie_feedback WHERE anom_id = ? LIMIT 1");
const updateAnomFbStmt = db.prepare("UPDATE anomalie_feedback SET feedback = ?, ts = ?, data = ? WHERE anom_id = ?");

export function persistAnomalieFeedback(a: any): void {
  try {
    const anomId = String(a?.id ?? "");
    const fb = String(a?.feedback ?? "");
    const ts = String(a?.feedbackAm ?? new Date().toISOString());
    if (!anomId || !fb) return;
    // Falls schon ein Feedback zu dieser Anomalie existiert -> aktualisieren.
    const vorhanden = existsAnomFbStmt.get(anomId);
    if (vorhanden) {
      updateAnomFbStmt.run(fb, ts, JSON.stringify(a), anomId);
    } else {
      insertAnomFbStmt.run(anomId, ts, fb, JSON.stringify(a));
      trimAnomFbStmt.run(ANOMALIE_FB_MAX);
    }
  } catch { /* best-effort */ }
}
export function loadAnomalieFeedback(limit: number): any[] {
  try {
    const rows = loadAnomFbStmt.all(Math.min(limit, ANOMALIE_FB_MAX)) as unknown as Array<{ data: string }>;
    return rows.map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter((x) => x != null);
  } catch { return []; }
}
// Feedback auf eine bereits BEENDETE Anomalie (in anomalie_log) setzen. Aktualisiert
// den Historie-Eintrag UND schreibt ins Feedback-Protokoll. Gibt true, wenn der
// Eintrag gefunden wurde.
const findAnomLogStmt = db.prepare("SELECT id, data FROM anomalie_log ORDER BY id DESC LIMIT 500");
const updateAnomLogStmt = db.prepare("UPDATE anomalie_log SET data = ? WHERE id = ?");
export function updateAnomalieFeedback(anomId: string, feedback: string, ts: string): boolean {
  try {
    const rows = findAnomLogStmt.all() as unknown as Array<{ id: number; data: string }>;
    for (const r of rows) {
      let obj: any;
      try { obj = JSON.parse(r.data); } catch { continue; }
      if (obj?.id === anomId) {
        obj.feedback = feedback;
        obj.feedbackAm = ts;
        updateAnomLogStmt.run(JSON.stringify(obj), r.id);
        persistAnomalieFeedback(obj);
        return true;
      }
    }
    return false;
  } catch { return false; }
}

// Schreibt eine Logmeldung, sofern ihr Level >= Mindest-Speicher-Level ist.
export function addLog(level: number, source: string, msg: string): void {
  if (level < getLogMinLevel()) return;
  insertLogStmt.run(new Date().toISOString(), level, source, msg);
  logRowEstimate++;
  // Ringpuffer: bei Überschreitung älteste Einträge kappen (selten, in Schüben).
  if (logRowEstimate > MAX_LOG_ROWS + 200) {
    db.exec(
      `DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id ASC LIMIT ${
        logRowEstimate - MAX_LOG_ROWS
      })`
    );
    logRowEstimate = MAX_LOG_ROWS;
  }
}

// Liest Logs (neueste zuerst), optional ab einem Mindest-Level gefiltert.
export function getLogs(minLevel = 0, limit = 1000): LogEntry[] {
  const rows = db
    .prepare(
      "SELECT id, ts, level, source, msg FROM logs WHERE level >= ? ORDER BY id DESC LIMIT ?"
    )
    .all(minLevel, limit) as Array<Omit<LogEntry, "levelName">>;
  return rows.map((r) => ({ ...r, levelName: LOG_LEVEL_NAME[r.level] ?? "info" }));
}

// Anzahl Logs je Level (für die Filter-Badges).
export function getLogCounts(): Record<LogLevelName, number> {
  const rows = db
    .prepare("SELECT level, COUNT(*) AS n FROM logs GROUP BY level")
    .all() as Array<{ level: number; n: number }>;
  const out: Record<LogLevelName, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const r of rows) {
    const name = LOG_LEVEL_NAME[r.level];
    if (name) out[name] = r.n;
  }
  return out;
}

export function clearLogs(): void {
  db.exec("DELETE FROM logs");
  logRowEstimate = 0;
}

// --- Benutzerdefinierte Lastprofile (für den Emulations-Simulator) ---
// JSON { profilName: { monat: { WT/SA/FT: [96] } } }.
export function loadCustomProfiles(): Record<string, any> {
  try {
    const obj = JSON.parse(getSetting("customProfiles") ?? "{}");
    if (obj && typeof obj === "object") return obj;
  } catch {
    /* leer */
  }
  return {};
}
export function saveCustomProfiles(profiles: Record<string, any>): void {
  setSetting("customProfiles", JSON.stringify(profiles));
}

// --- Erzeugungsprofile (auf 1 kWp normiert, für den gridEmu-Simulator) ---
export function loadGenProfiles(): Record<string, any> {
  try {
    const obj = JSON.parse(getSetting("genProfiles") ?? "{}");
    if (obj && typeof obj === "object") return obj;
  } catch {
    /* leer */
  }
  return {};
}
export function saveGenProfiles(profiles: Record<string, any>): void {
  setSetting("genProfiles", JSON.stringify(profiles));
}

// --- Senken (emulierter Shelly Pro 3EM für Speicher-Ansteuerung) ---
const DEFAULT_SINKS: Sink[] = [
  {
    id: "sink_speicher",
    name: "Speicher-Regelung (§42c)",
    baseSourceId: "hichi",
    baseFactor: 1,
    offsets: [],
    include42c: true,
    maxPowerW: 0,
    enabled: false,
  },
];

if (getSetting("sinks") === undefined)
  setSetting("sinks", JSON.stringify(DEFAULT_SINKS));

export function loadSinks(): Sink[] {
  try {
    const arr = JSON.parse(getSetting("sinks") ?? "[]");
    if (Array.isArray(arr)) {
      // Migration: alte Senken ohne die neuen Felder auf sinnvolle Defaults
      // heben (baseFactor 1, keine Offsets, §42c weiterhin einbezogen -> altes
      // Verhalten bleibt unverändert erhalten).
      return (arr as any[]).map((s) => ({
        id: s.id,
        name: s.name,
        sinkRole: s.sinkRole === "extHems" ? "extHems" : "meter",
        baseSourceId: s.baseSourceId ?? "",
        baseFactor: Number.isFinite(s.baseFactor) ? s.baseFactor : 1,
        offsets: Array.isArray(s.offsets)
          ? s.offsets.map((o: any) => ({
              sourceId: o.sourceId ?? "",
              factor: Number.isFinite(o.factor) ? o.factor : 1,
              onlyPositive: o.onlyPositive !== false,
            }))
          : [],
        include42c: s.include42c !== false, // Default true (Rückwärtskompatibilität)
        maxPowerW: Number.isFinite(s.maxPowerW) ? s.maxPowerW : 0,
        maxPower42cW: Number.isFinite(s.maxPower42cW) ? s.maxPower42cW : 0,
        enabled: !!s.enabled,
        useDiscovery: !!s.useDiscovery,
        emulatedMeter: ["proem50", "emg3", "ct002", "ct003"].includes(s.emulatedMeter) ? s.emulatedMeter : "pro3em",
        ctMac: typeof s.ctMac === "string" ? s.ctMac : undefined,
        batteryMac: typeof s.batteryMac === "string" ? s.batteryMac : undefined,
        targetOffsetW: Number.isFinite(s.targetOffsetW) ? s.targetOffsetW : 0,
        ctWeights: Array.isArray(s.ctWeights)
          ? s.ctWeights.filter((w: any) => typeof w.ip === "string").map((w: any) => ({ ip: w.ip, weight: Number.isFinite(w.weight) ? w.weight : 1 }))
          : [],
        ctDeadbandW: Number.isFinite(s.ctDeadbandW) ? s.ctDeadbandW : 0,
        ctMaxStepW: Number.isFinite(s.ctMaxStepW) ? s.ctMaxStepW : 0,
        ctBalanceStepW: Number.isFinite(s.ctBalanceStepW) ? s.ctBalanceStepW : 0,
        ctBalanceToleranceW: Number.isFinite(s.ctBalanceToleranceW) ? s.ctBalanceToleranceW : 0,
        ctFadeout: !!s.ctFadeout,
        ctNoAcCharge: !!s.ctNoAcCharge,
        ctAlternierendeEntladung: !!s.ctAlternierendeEntladung,
        ctFadeStepW: Number.isFinite(s.ctFadeStepW) ? s.ctFadeStepW : 0,
        formula: typeof s.formula === "string" ? s.formula : undefined,
      })) as Sink[];
    }
  } catch {
    /* Default */
  }
  return DEFAULT_SINKS.map((s) => ({ ...s }));
}

export function saveSinks(list: Sink[]): void {
  const clean = list.map((s) => ({
    id: s.id || `sink_${Date.now()}`,
    name: (s.name ?? "").trim() || "Senke",
    sinkRole: s.sinkRole === "extHems" ? "extHems" : "meter",
    baseSourceId: s.baseSourceId ?? "",
    baseFactor: Number.isFinite(s.baseFactor) ? s.baseFactor : 1,
    offsets: Array.isArray(s.offsets)
      ? s.offsets
          .filter((o) => o.sourceId)
          .map((o) => ({
            sourceId: o.sourceId,
            factor: Number.isFinite(o.factor) ? o.factor : 1,
            onlyPositive: o.onlyPositive !== false,
          }))
      : [],
    include42c: s.include42c !== false,
    maxPowerW: Number.isFinite(s.maxPowerW) && s.maxPowerW > 0 ? Math.round(s.maxPowerW) : 0,
    maxPower42cW: Number.isFinite(s.maxPower42cW) && (s.maxPower42cW as number) > 0 ? Math.round(s.maxPower42cW as number) : 0,
    enabled: !!s.enabled,
    useDiscovery: !!s.useDiscovery,
    emulatedMeter: ["proem50", "emg3", "ct002", "ct003"].includes(s.emulatedMeter as string) ? s.emulatedMeter : "pro3em",
    ctMac: typeof s.ctMac === "string" && s.ctMac.trim() ? s.ctMac.trim().toLowerCase().replace(/[^0-9a-f]/g, "") : undefined,
    batteryMac: typeof s.batteryMac === "string" && s.batteryMac.trim() ? s.batteryMac.trim().toLowerCase().replace(/[^0-9a-f]/g, "") : undefined,
    targetOffsetW: Number.isFinite(s.targetOffsetW) ? Math.round(s.targetOffsetW as number) : 0,
    ctWeights: Array.isArray(s.ctWeights)
      ? s.ctWeights.filter((w) => typeof w.ip === "string" && w.ip.trim()).map((w) => ({ ip: w.ip.trim(), weight: Number.isFinite(w.weight) && w.weight > 0 ? w.weight : 1 }))
      : [],
    ctDeadbandW: Number.isFinite(s.ctDeadbandW) && (s.ctDeadbandW as number) > 0 ? Math.round(s.ctDeadbandW as number) : 0,
    ctMaxStepW: Number.isFinite(s.ctMaxStepW) && (s.ctMaxStepW as number) > 0 ? Math.round(s.ctMaxStepW as number) : 0,
    ctBalanceStepW: Number.isFinite(s.ctBalanceStepW) && (s.ctBalanceStepW as number) > 0 ? Math.round(s.ctBalanceStepW as number) : 0,
    ctBalanceToleranceW: Number.isFinite(s.ctBalanceToleranceW) && (s.ctBalanceToleranceW as number) > 0 ? Math.round(s.ctBalanceToleranceW as number) : 0,
    ctFadeout: !!s.ctFadeout,
    ctNoAcCharge: !!s.ctNoAcCharge,
    ctAlternierendeEntladung: !!s.ctAlternierendeEntladung,
    ctFadeStepW: Number.isFinite(s.ctFadeStepW) && (s.ctFadeStepW as number) > 0 ? Math.round(s.ctFadeStepW as number) : 0,
    formula: typeof s.formula === "string" && s.formula.trim() ? s.formula.trim() : undefined,
  }));
  setSetting("sinks", JSON.stringify(clean));
}

// --- Reset-Anker ---
const getResetStmt = db.prepare("SELECT value FROM resets WHERE key = ?");
const setResetStmt = db.prepare(
  "INSERT INTO resets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

// In-Memory-Spiegel der zuletzt geschriebenen/gelesenen Reset-Werte. Der Poller
// ruft setReset sehr häufig auf (mehrere Anker je Quelle, alle paar Sekunden),
// oft mit UNVERÄNDERTEM Wert (z. B. nachts stillstehende Zähler). Ohne Cache
// erzeugt jeder Aufruf einen DB-Write und damit unnötige SSD-Schreiblast. Mit
// dem Cache wird nur bei echter Wertänderung geschrieben.
const resetCache = new Map<string, number>();

export function getReset(key: string, fallback = 0): number {
  const cached = resetCache.get(key);
  if (cached !== undefined) return cached;
  const row = getResetStmt.get(key) as { value: number } | undefined;
  const val = row?.value ?? fallback;
  // Nur einen tatsächlich vorhandenen DB-Wert cachen (nicht den Fallback, sonst
  // würde ein späteres setReset mit genau dem Fallback-Wert fälschlich als
  // "unverändert" übersprungen, obwohl noch nichts persistiert ist).
  if (row) resetCache.set(key, row.value);
  return val;
}
export function setReset(key: string, value: number): void {
  if (resetCache.get(key) === value) return; // unverändert -> kein DB-Write
  setResetStmt.run(key, value);
  resetCache.set(key, value);
}

export function getDayReset(): string {
  return getSetting("dayReset") ?? "";
}
export function setDayReset(date: string): void {
  setSetting("dayReset", date);
}
// Zuletzt per dailyTrigger (Tageswechsel-Regel) ausgelöster Kalendertag.
// Persistent, damit die Regel einen Neustart nicht als neuen Tageswechsel
// missversteht und nicht beim App-Start feuert.
export function getLastDailyTrigger(): string {
  return getSetting("lastDailyTrigger") ?? "";
}
export function setLastDailyTrigger(date: string): void {
  setSetting("lastDailyTrigger", date);
}
// Generische, benannte Merker (z. B. für regel-spezifische Tages-Auslöser zu
// fester Uhrzeit). Key sollte eindeutig sein, etwa "dailyAt:<regelId>".
export function getNamedMarker(key: string): string {
  return getSetting(`marker:${key}`) ?? "";
}
export function setNamedMarker(key: string, value: string): void {
  setSetting(`marker:${key}`, value);
}

// Persistenter Aktiv-Zustand von Regeln (für zeitgesteuertes Auto-Off, das einen
// Neustart überstehen muss). Map ruleId -> Einschalt-Zeitstempel (ms).
export function getRuleActiveState(): Record<string, number> {
  try {
    const raw = getSetting("ruleActiveState");
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
export function setRuleActiveState(state: Record<string, number>): void {
  setSetting("ruleActiveState", JSON.stringify(state));
}
export function getInitDone(): boolean {
  return getSetting("initDone") === "1";
}
export function setInitDone(done: boolean): void {
  setSetting("initDone", done ? "1" : "0");
}

// --- Historie ---
// node:sqlite nutzt benannte Parameter ohne '@'-Präfix im Objekt.
const upsertHistoryStmt = db.prepare(`
  INSERT INTO history (
    date, verbrauch, pvSpeicher, pvDirekt, speicher, netzbezug,
    eingespeist, eingespeist42cPv, eingespeist42cSpeicher, autarkie
  )
  VALUES (
    $date, $verbrauch, $pvSpeicher, $pvDirekt, $speicher, $netzbezug,
    $eingespeist, $eingespeist42cPv, $eingespeist42cSpeicher, $autarkie
  )
  ON CONFLICT(date) DO UPDATE SET
    verbrauch              = excluded.verbrauch,
    pvSpeicher             = excluded.pvSpeicher,
    pvDirekt               = excluded.pvDirekt,
    speicher               = excluded.speicher,
    netzbezug              = excluded.netzbezug,
    eingespeist            = excluded.eingespeist,
    eingespeist42cPv       = excluded.eingespeist42cPv,
    eingespeist42cSpeicher = excluded.eingespeist42cSpeicher,
    autarkie               = excluded.autarkie
`);

export function upsertHistory(entry: HistoryEntry): void {
  upsertHistoryStmt.run({
    date: entry.date,
    verbrauch: entry.verbrauch,
    pvSpeicher: entry.pvSpeicher,
    pvDirekt: entry.pvDirekt,
    speicher: entry.speicher,
    netzbezug: entry.netzbezug,
    eingespeist: entry.eingespeist,
    eingespeist42cPv: entry.eingespeist42cPv,
    eingespeist42cSpeicher: entry.eingespeist42cSpeicher,
    autarkie: entry.autarkie,
  });
}

const getHistoryStmt = db.prepare(
  "SELECT * FROM history ORDER BY date DESC"
);
export function getHistory(): HistoryEntry[] {
  return getHistoryStmt.all() as unknown as HistoryEntry[];
}

// Aggregiert die Viertelstundenwerte eines Kalendertages zu Tagessummen. Dient
// dazu, einen fehlenden History-Eintrag nachträglich zu rekonstruieren (z. B.
// wenn der Tagesabschluss beim Start mitten am Tag ausgelassen wurde, die
// Viertelstundenwerte aber vollständig vorliegen).
const aggViertelStmt = db.prepare(`
  SELECT
    COALESCE(SUM(bezogen), 0)            AS netzbezug,
    COALESCE(SUM(eingespeist), 0)        AS eingespeist,
    COALESCE(SUM(verbrauch), 0)          AS verbrauch,
    COALESCE(SUM(verbrauchPv), 0)        AS verbrauchPv,
    COALESCE(SUM(verbrauchSpeicher), 0)  AS verbrauchSpeicher,
    COALESCE(SUM(eingespeist42cPv), 0)   AS eingespeist42cPv,
    COALESCE(SUM(eingespeist42cBatt), 0) AS eingespeist42cBatt,
    COUNT(*)                             AS n
  FROM viertelstunden
  WHERE substr(ts, 1, 10) = ?
`);

// Liefert alle Kalendertage, für die Viertelstundenwerte existieren, aber (noch)
// kein History-Eintrag vorliegen – Kandidaten für eine Rekonstruktion.
const missingHistoryDaysStmt = db.prepare(`
  SELECT DISTINCT substr(v.ts, 1, 10) AS date
  FROM viertelstunden v
  LEFT JOIN history h ON h.date = substr(v.ts, 1, 10)
  WHERE h.date IS NULL
  ORDER BY date ASC
`);
export function getDaysWithVierteldataButNoHistory(): string[] {
  return (missingHistoryDaysStmt.all() as any[]).map((r) => r.date as string);
}

// Gibt true zurück, wenn ein Eintrag geschrieben wurde. Überschreibt einen
// bestehenden Eintrag nur, wenn overwrite=true; sonst wird ein vorhandener Tag
// unangetastet gelassen. Ohne Viertelstundenwerte (n=0) passiert nichts.
export function rebuildHistoryFromViertelstunden(date: string, overwrite = false): boolean {
  if (!overwrite && getHistoryByDate(date)) return false;
  const a = aggViertelStmt.get(date) as any;
  if (!a || a.n === 0) return false;
  const verbrauchPv = a.verbrauchPv as number;
  const verbrauchSpeicher = a.verbrauchSpeicher as number;
  const eigen = verbrauchPv + verbrauchSpeicher; // Eigenverbrauch (PV+Speicher)
  const verbrauch = a.verbrauch as number;
  upsertHistory({
    date,
    verbrauch,
    pvSpeicher: eigen,
    pvDirekt: verbrauchPv,
    speicher: verbrauchSpeicher,
    netzbezug: a.netzbezug as number,
    eingespeist: a.eingespeist as number,
    eingespeist42cPv: a.eingespeist42cPv as number,
    eingespeist42cSpeicher: a.eingespeist42cBatt as number,
    autarkie: verbrauch > 0 ? 100 * (eigen / verbrauch) : 0,
  });
  return true;
}

const getAllHistoryStmt = db.prepare(
  "SELECT * FROM history ORDER BY date DESC"
);
export function getAllHistory(): HistoryEntry[] {
  return getAllHistoryStmt.all() as unknown as HistoryEntry[];
}

const getHistoryByDateStmt = db.prepare(
  "SELECT * FROM history WHERE date = ?"
);
export function getHistoryByDate(date: string): HistoryEntry | undefined {
  return getHistoryByDateStmt.get(date) as unknown as HistoryEntry | undefined;
}

export function clearHistory(): void {
  db.exec("DELETE FROM history");
}

// Löscht alle Einträge eines Monats (month = "YYYY-MM").
const deleteHistoryMonthStmt = db.prepare(
  "DELETE FROM history WHERE date LIKE ?"
);
export function deleteHistoryMonth(month: string): void {
  deleteHistoryMonthStmt.run(`${month}-%`);
}

// --- Drosselungen ---
// Hinweis: Drosselungen werden nicht mehr in einer eigenen Tabelle historisiert,
// sondern als Info-Meldung protokolliert (Debug-Seite). Die clear-Funktionen
// bleiben erhalten, um Alt-Datenbestände bei Reset/Quellen-Löschung zu bereinigen.
export function clearDrosselungen(): void {
  db.exec("DELETE FROM drosselungen");
}

const clearDrosselungenForSourceStmt = db.prepare(
  "DELETE FROM drosselungen WHERE source = ?"
);
export function clearDrosselungenForSource(sourceId: string): void {
  clearDrosselungenForSourceStmt.run(sourceId);
}

// --- Spotpreise (Day-Ahead) ---
const upsertSpotStmt = db.prepare(
  `INSERT INTO spotpreise (date, prices, fetched) VALUES (?, ?, ?)
   ON CONFLICT(date) DO UPDATE SET prices = excluded.prices, fetched = excluded.fetched`
);
export function saveSpotpreise(t: SpotpreisTag): void {
  upsertSpotStmt.run(t.date, JSON.stringify(t.prices), t.fetched);
}

const getSpotStmt = db.prepare(
  "SELECT date, prices, fetched FROM spotpreise WHERE date = ?"
);
export function getSpotpreise(date: string): SpotpreisTag | null {
  const row = getSpotStmt.get(date) as
    | { date: string; prices: string; fetched: string }
    | undefined;
  if (!row) return null;
  let prices: number[] = [];
  try {
    prices = JSON.parse(row.prices);
  } catch {
    prices = [];
  }
  return { date: row.date, prices, fetched: row.fetched };
}

// Liste vorhandener Tage (für evtl. Übersicht / Kalender-Markierung)
const spotDatesStmt = db.prepare(
  "SELECT date FROM spotpreise ORDER BY date DESC"
);
export function getSpotpreisDates(): string[] {
  return (spotDatesStmt.all() as Array<{ date: string }>).map((r) => r.date);
}
// Spätestes Datum, für das Börsenpreise vorliegen (oder null). Für die
// Chart-Navigation: der Folgetag-Pfeil darf bis zu diesem Tag gehen (Day-Ahead-
// Preise für morgen erscheinen typischerweise am Nachmittag).
const spotLatestStmt = db.prepare("SELECT MAX(date) AS d FROM spotpreise");
export function getSpotpreisLatest(): string | null {
  const row = spotLatestStmt.get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

// Alle Spotpreis-Tage (aufsteigend) – Grundlage der Börsenpreis-Statistik.
const allSpotStmt = db.prepare(
  "SELECT date, prices FROM spotpreise ORDER BY date ASC"
);
export function getAllSpotpreise(): Array<{ date: string; prices: number[] }> {
  const rows = allSpotStmt.all() as Array<{ date: string; prices: string }>;
  return rows.map((r) => {
    let prices: number[] = [];
    try { prices = JSON.parse(r.prices); } catch { prices = []; }
    return { date: r.date, prices };
  });
}

// --- Viertelstunden-Energiewerte ---
const upsertViertelstundeStmt = db.prepare(
  `INSERT INTO viertelstunden (ts, eingespeist, bezogen, verbrauch, eingespeistPv, eingespeistBatt, verbrauchPv, verbrauchSpeicher, eingespeist42cPv, eingespeist42cBatt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(ts) DO UPDATE SET
     eingespeist         = excluded.eingespeist,
     bezogen             = excluded.bezogen,
     verbrauch           = excluded.verbrauch,
     eingespeistPv       = excluded.eingespeistPv,
     eingespeistBatt     = excluded.eingespeistBatt,
     verbrauchPv         = excluded.verbrauchPv,
     verbrauchSpeicher   = excluded.verbrauchSpeicher,
     eingespeist42cPv    = excluded.eingespeist42cPv,
     eingespeist42cBatt  = excluded.eingespeist42cBatt`
);
export function saveViertelstunde(e: ViertelstundeEntry): void {
  upsertViertelstundeStmt.run(
    e.ts,
    e.eingespeist,
    e.bezogen,
    e.verbrauch,
    e.eingespeistPv ?? 0,
    e.eingespeistBatt ?? 0,
    e.verbrauchPv ?? 0,
    e.verbrauchSpeicher ?? 0,
    e.eingespeist42cPv ?? 0,
    e.eingespeist42cBatt ?? 0
  );
}

// Viertelstundenwerte in einem Zeitbereich [vonTs, bisTs] (lokale ISO-Strings).
const viertelstundenRangeStmt = db.prepare(
  "SELECT ts, eingespeist, bezogen, verbrauch, eingespeistPv, eingespeistBatt, verbrauchPv, verbrauchSpeicher, eingespeist42cPv, eingespeist42cBatt FROM viertelstunden WHERE ts >= ? AND ts <= ? ORDER BY ts ASC"
);

// Tagessummen der wichtigsten VS-Energiefelder in einem Zeitfenster. Wird für
// die konsistente Anzeige des PV-Eigenverbrauchs auf der Übersicht genutzt (aus
// den bereits sauber aufgeteilten Viertelstundenwerten statt aus einer live
// kumulierten Bilanz mit Monoton-Klemme).
const viertelstundenSummenStmt = db.prepare(
  `SELECT
     COALESCE(SUM(eingespeist),0)    AS eingespeist,
     COALESCE(SUM(bezogen),0)        AS bezogen,
     COALESCE(SUM(verbrauch),0)      AS verbrauch,
     COALESCE(SUM(eingespeistPv),0)  AS eingespeistPv,
     COALESCE(SUM(verbrauchPv),0)    AS verbrauchPv,
     COALESCE(SUM(verbrauchSpeicher),0) AS verbrauchSpeicher
   FROM viertelstunden WHERE ts >= ? AND ts <= ?`
);
export function getViertelstundenSummen(vonTs: string, bisTs: string): {
  eingespeist: number; bezogen: number; verbrauch: number;
  eingespeistPv: number; verbrauchPv: number; verbrauchSpeicher: number;
} {
  return viertelstundenSummenStmt.get(vonTs, bisTs) as any;
}
// Tagesgrenzen für End-Zeitstempel-basierte Viertelstunden.
// Eine Viertelstunde wird unter ihrem ENDE gespeichert (z.B. 23:45–00:00 des
// Tages X endet "X+1 T00:00"). Ein Kalendertag X umfasst daher die Intervalle
// mit Ende von "X T00:15" (erstes Intervall 00:00–00:15) bis einschließlich
// "X+1 T00:00" (letztes Intervall 23:45–00:00). Beide Grenzen inklusiv.
export function dayBounds(date: string): { von: string; bis: string } {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const nextStr = `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`;
  return { von: `${date}T00:15`, bis: `${nextStr}T00:00` };
}

export function getViertelstunden(
  vonTs: string,
  bisTs: string
): ViertelstundeEntry[] {
  return viertelstundenRangeStmt.all(vonTs, bisTs) as unknown as ViertelstundeEntry[];
}

// --- Energy-Sharing: 15-Min-Bezüge externer §42c-Zähler ---
const upsertSharingStmt = db.prepare(
  `INSERT INTO sharing_viertelstunden (ts, source, bezogen) VALUES (?, ?, ?)
   ON CONFLICT(ts, source) DO UPDATE SET bezogen = excluded.bezogen`
);
export function saveSharingViertelstunde(
  ts: string,
  source: string,
  bezogen: number
): void {
  upsertSharingStmt.run(ts, source, bezogen);
}

// Alle Sharing-Bezüge eines Zeitbereichs (für alle Quellen), aufsteigend.
const sharingRangeStmt = db.prepare(
  "SELECT ts, source, bezogen FROM sharing_viertelstunden WHERE ts >= ? AND ts <= ? ORDER BY ts ASC"
);
export function getSharingViertelstunden(
  vonTs: string,
  bisTs: string
): Array<{ ts: string; source: string; bezogen: number }> {
  return sharingRangeStmt.all(vonTs, bisTs) as unknown as Array<{
    ts: string;
    source: string;
    bezogen: number;
  }>;
}

// Alle Kalendertage (YYYY-MM-DD), für die Sharing-Viertelstundenwerte vorliegen.
// Grundlage für die Wirtschaftlichkeitsanalyse (nur Tage mit Sharing-Aktivität).
const sharingDatesStmt = db.prepare(
  "SELECT DISTINCT substr(ts, 1, 10) AS d FROM sharing_viertelstunden ORDER BY d ASC"
);
export function getSharingDates(): string[] {
  return (sharingDatesStmt.all() as unknown as Array<{ d: string }>).map((r) => r.d);
}

// --- Verbraucher: 15-Min-Energieverbrauch je Gerät ---
const upsertConsumerVsStmt = db.prepare(
  `INSERT INTO consumer_viertelstunden (ts, consumer, verbrauch) VALUES (?, ?, ?)
   ON CONFLICT(ts, consumer) DO UPDATE SET verbrauch = excluded.verbrauch`
);
export function saveConsumerViertelstunde(
  ts: string,
  consumer: string,
  verbrauch: number
): void {
  upsertConsumerVsStmt.run(ts, consumer, verbrauch);
}

const consumerVsRangeStmt = db.prepare(
  "SELECT ts, verbrauch FROM consumer_viertelstunden WHERE consumer = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC"
);
export function getConsumerViertelstunden(
  consumer: string,
  vonTs: string,
  bisTs: string
): Array<{ ts: string; verbrauch: number }> {
  return consumerVsRangeStmt.all(consumer, vonTs, bisTs) as unknown as Array<{
    ts: string;
    verbrauch: number;
  }>;
}

const consumerDaySumStmt = db.prepare(
  "SELECT consumer, SUM(verbrauch) AS kwh FROM consumer_viertelstunden WHERE ts >= ? AND ts <= ? GROUP BY consumer"
);
export function getConsumerDaySums(
  vonTs: string,
  bisTs: string
): Record<string, number> {
  const rows = consumerDaySumStmt.all(vonTs, bisTs) as unknown as Array<{
    consumer: string;
    kwh: number;
  }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.consumer] = r.kwh;
  return out;
}

// Tagessummen je Consumer über einen Zeitraum: consumer -> (Tag -> kWh).
// Analog zu getPvTagesSummen, aber für consumer_viertelstunden. Nützlich für
// die Speicher-Wirkungsgrad-Auswertung (Lade-/Entlademengen je Tag/Monat).
const consumerDayPerSourceStmt = db.prepare(
  `SELECT consumer, substr(ts,1,10) AS tag, SUM(verbrauch) AS kwh
   FROM consumer_viertelstunden WHERE ts >= ? AND ts <= ? GROUP BY consumer, substr(ts,1,10)`
);
export function getConsumerTagesSummen(
  vonTs: string, bisTs: string
): Array<{ consumer: string; tag: string; kwh: number }> {
  return consumerDayPerSourceStmt.all(vonTs, bisTs) as unknown as Array<{ consumer: string; tag: string; kwh: number }>;
}

// Verbrauch EINES Consumers über einen Zeitraum, gruppiert nach Kalendertag
// (substr 1..10 = YYYY-MM-DD) bzw. Kalendermonat (substr 1..7 = YYYY-MM).
// Für die Gesamtverbrauchs-Ansicht je Gerät (Monat = Tagesbalken, Jahr =
// Monatsbalken). Liefert bucket-Schlüssel -> kWh.
export function getConsumerBuckets(
  consumer: string, vonTs: string, bisTs: string, by: "tag" | "monat"
): Array<{ bucket: string; kwh: number }> {
  const len = by === "monat" ? 7 : 10;
  const stmt = db.prepare(
    `SELECT substr(ts,1,${len}) AS bucket, SUM(verbrauch) AS kwh
     FROM consumer_viertelstunden WHERE consumer = ? AND ts >= ? AND ts <= ?
     GROUP BY substr(ts,1,${len}) ORDER BY bucket ASC`
  );
  return stmt.all(consumer, vonTs, bisTs) as unknown as Array<{ bucket: string; kwh: number }>;
}

// --- PV-Ertrag pro Anlage (Viertelstunden) ---
const upsertPvVsStmt = db.prepare(
  `INSERT INTO pv_viertelstunden (ts, source, ertrag) VALUES (?, ?, ?)
   ON CONFLICT(ts, source) DO UPDATE SET ertrag = excluded.ertrag`
);
export function savePvViertelstunde(ts: string, source: string, ertrag: number): void {
  upsertPvVsStmt.run(ts, source, ertrag);
}

const pvVsRangeStmt = db.prepare(
  "SELECT ts, ertrag FROM pv_viertelstunden WHERE source = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC"
);
export function getPvViertelstunden(
  source: string, vonTs: string, bisTs: string
): Array<{ ts: string; ertrag: number }> {
  return pvVsRangeStmt.all(source, vonTs, bisTs) as unknown as Array<{ ts: string; ertrag: number }>;
}

// Tagessummen je PV-Anlage über einen Zeitraum: source -> (YYYY-MM-DD -> kWh).
const pvDayPerSourceStmt = db.prepare(
  `SELECT source, substr(ts,1,10) AS tag, SUM(ertrag) AS kwh
   FROM pv_viertelstunden WHERE ts >= ? AND ts <= ? GROUP BY source, substr(ts,1,10)`
);
export function getPvTagesSummen(
  vonTs: string, bisTs: string
): Array<{ source: string; tag: string; kwh: number }> {
  return pvDayPerSourceStmt.all(vonTs, bisTs) as unknown as Array<{ source: string; tag: string; kwh: number }>;
}

// --- Heartbeat-Konstante für die intelligente Persistierung ---
// Ein unveränderter Zustand wird spätestens nach WP_HEARTBEAT_MS erneut als
// Stützpunkt geschrieben. Der Abstand entspricht dem Integrations-Deckel der
// KPI-Berechnung (max. 300 s), damit die Energieintegration exakt bleibt.
const WP_HEARTBEAT_MS = 5 * 60 * 1000;

// --- Generische Geräte-Datenreihen (device_data) ---
const insertDeviceDataStmt = db.prepare(
  "INSERT INTO device_data (source_id, ts, label, value) VALUES (?, ?, ?, ?) " +
  "ON CONFLICT(source_id, ts, label) DO UPDATE SET value = excluded.value"
);
export function saveDeviceData(sourceId: string, ts: string, series: Record<string, number>): void {
  const rows: Array<[string, string, string, number]> = [];
  for (const [label, value] of Object.entries(series)) {
    if (Number.isFinite(value)) rows.push([sourceId, ts, label, value]);
  }
  if (!rows.length) return;
  db.exec("BEGIN");
  try {
    for (const r of rows) insertDeviceDataStmt.run(...r);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}
export function getDeviceData(sourceId: string, vonTs: string, bisTs: string, label?: string): Array<{ ts: string; label: string; value: number }> {
  if (label != null) {
    return db.prepare(
      "SELECT ts, label, value FROM device_data WHERE source_id = ? AND label = ? AND ts >= ? AND ts <= ? ORDER BY ts"
    ).all(sourceId, label, vonTs, bisTs) as unknown as Array<{ ts: string; label: string; value: number }>;
  }
  return db.prepare(
    "SELECT ts, label, value FROM device_data WHERE source_id = ? AND ts >= ? AND ts <= ? ORDER BY ts"
  ).all(sourceId, vonTs, bisTs) as unknown as Array<{ ts: string; label: string; value: number }>;
}
export function getDeviceDataLabels(sourceId: string): string[] {
  return (db.prepare("SELECT DISTINCT label FROM device_data WHERE source_id = ? ORDER BY label")
    .all(sourceId) as unknown as Array<{ label: string }>).map((r) => r.label);
}

// --- Zugangskontrolle: Protokoll ---
const ACCESS_LOG_MAX = 2000;
const insertAccessStmt = db.prepare(
  "INSERT INTO access_log (source_id, ts, art, wert, bits, ergebnis, name) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
export function addAccessLog(e: { sourceId: string; ts: string; art: string; wert: string; bits?: number; ergebnis?: string; name?: string }): void {
  insertAccessStmt.run(e.sourceId, e.ts, e.art, e.wert, e.bits ?? null, e.ergebnis ?? null, e.name ?? null);
  // Ringpuffer: alte Einträge kappen.
  db.prepare(
    "DELETE FROM access_log WHERE id NOT IN (SELECT id FROM access_log ORDER BY id DESC LIMIT ?)"
  ).run(ACCESS_LOG_MAX);
}
export function getAccessLog(limit = 200): Array<{ id: number; source_id: string; ts: string; art: string; wert: string; bits: number | null; ergebnis: string | null; name: string | null }> {
  return db.prepare("SELECT * FROM access_log ORDER BY id DESC LIMIT ?").all(Math.min(1000, limit)) as any;
}

// --- CO₂-Bilanz ---
const upsertCo2Stmt = db.prepare(
  "INSERT INTO co2_log (ts, intensitaet, netzbezugKwh, emissionenG) VALUES (?, ?, ?, ?) ON CONFLICT(ts) DO UPDATE SET intensitaet=excluded.intensitaet, netzbezugKwh=excluded.netzbezugKwh, emissionenG=excluded.emissionenG"
);
export function saveCo2(ts: string, intensitaet: number, netzbezugKwh: number): void {
  upsertCo2Stmt.run(ts, intensitaet, netzbezugKwh, intensitaet * netzbezugKwh);
}
// CO₂-Summen für einen Zeitraum (ISO-Präfix, z. B. "2026" oder "2026-09").
// Übersicht über die vorliegenden CO₂-Daten: ältester/neuester Zeitpunkt + Anzahl.
export function getCo2Uebersicht(): { von: string | null; bis: string | null; punkte: number; tage: number } {
  const r = db.prepare("SELECT MIN(ts) v, MAX(ts) b, COUNT(*) c, COUNT(DISTINCT substr(ts,1,10)) t FROM co2_log").get() as any;
  return { von: r?.v ?? null, bis: r?.b ?? null, punkte: Number(r?.c ?? 0), tage: Number(r?.t ?? 0) };
}
export function getCo2Summe(prefix: string): { emissionenG: number; netzbezugKwh: number; schnittIntensitaet: number; punkte: number } {
  const r = db.prepare(
    "SELECT COALESCE(SUM(emissionenG),0) e, COALESCE(SUM(netzbezugKwh),0) n, COUNT(*) c FROM co2_log WHERE ts LIKE ?"
  ).get(`${prefix}%`) as any;
  const e = Number(r?.e ?? 0), n = Number(r?.n ?? 0), c = Number(r?.c ?? 0);
  return { emissionenG: e, netzbezugKwh: n, schnittIntensitaet: n > 0 ? e / n : 0, punkte: c };
}
// Aktualisiert Ergebnis + Name des jüngsten Log-Eintrags einer Quelle (nach der
// Whitelist-Prüfung). So erscheint im Protokoll, ob berechtigt und wer.
export function updateLetztesAccessResult(sourceId: string, ergebnis: string, name: string | null): void {
  const row = db.prepare("SELECT id FROM access_log WHERE source_id = ? ORDER BY id DESC LIMIT 1").get(sourceId) as any;
  if (row?.id != null) db.prepare("UPDATE access_log SET ergebnis = ?, name = ? WHERE id = ?").run(ergebnis, name, row.id);
}

// Zugangs-Berechtigungen (Whitelist) als JSON in settings.
export function loadAccessEntries(): any[] {
  const raw = getSetting("accessEntries");
  if (!raw) return [];
  try { const j = JSON.parse(raw); return Array.isArray(j) ? j : []; } catch { return []; }
}
export function saveAccessEntries(entries: any[]): void {
  setSetting("accessEntries", JSON.stringify(entries));
}

// Label der elektrischen Leistungsaufnahme (wird separat gespeichert).
const L_ELEKTRISCH = "_ElektrischW";

// Verallgemeinerte, intelligente Persistierung je Gerät (aus der WP-Logik).
// - Die elektrische Leistung (_ElektrischW) wird entkoppelt in device_power
//   geschrieben (eigene Änderungserkennung + Heartbeat, auf ganze Watt gerundet).
// - Die übrigen Datenpunkte gehen in device_data, ebenfalls mit Änderungserkennung
//   + Heartbeat, damit unveränderte Zustände die Reihe nicht unnötig füllen.
const insertDevicePowerStmt = db.prepare(
  `INSERT INTO device_power (source_id, ts, value) VALUES (?, ?, ?)
   ON CONFLICT(source_id, ts) DO UPDATE SET value = excluded.value`
);
const lastDevicePower = new Map<string, { v: number; ms: number }>();
const lastDeviceWritten = new Map<string, Record<string, number>>();
const lastDeviceWriteMs = new Map<string, number>();

function deviceSeriesUnveraendert(sourceId: string, zustand: Record<string, number>): boolean {
  const prev = lastDeviceWritten.get(sourceId);
  if (!prev) return false;
  const keys = Object.keys(zustand);
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) if (prev[k] !== zustand[k]) return false;
  return true;
}

export function saveDeviceDataSmart(sourceId: string, ts: string, series: Record<string, number>): void {
  const jetztMs = Date.now();
  // 1) Elektrische Leistung entkoppeln (device_power).
  if (L_ELEKTRISCH in series) {
    const pW = Math.round(series[L_ELEKTRISCH]);
    const prev = lastDevicePower.get(sourceId);
    const unveraendert = prev != null && prev.v === pW;
    if (!unveraendert || (jetztMs - (prev?.ms ?? 0)) >= WP_HEARTBEAT_MS) {
      insertDevicePowerStmt.run(sourceId, ts, pW);
      lastDevicePower.set(sourceId, { v: pW, ms: jetztMs });
    }
  }
  // 2) Restliche Zustandsdaten (ohne Leistung) in device_data.
  const zustand: Record<string, number> = {};
  for (const [k, v] of Object.entries(series)) if (k !== L_ELEKTRISCH) zustand[k] = v;
  if (Object.keys(zustand).length === 0) return;
  if (deviceSeriesUnveraendert(sourceId, zustand) && (jetztMs - (lastDeviceWriteMs.get(sourceId) ?? 0)) < WP_HEARTBEAT_MS) {
    return;
  }
  db.exec("BEGIN");
  try {
    for (const [label, value] of Object.entries(zustand)) {
      if (Number.isFinite(value)) insertDeviceDataStmt.run(sourceId, ts, label, value);
    }
    db.exec("COMMIT");
    lastDeviceWritten.set(sourceId, { ...zustand });
    lastDeviceWriteMs.set(sourceId, jetztMs);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

// WP-Speicherung: dünner Wrapper auf die verallgemeinerte Funktion, mit der
// WP-Quellen-ID. Erhält die bisherige Aufrufsignatur (nur ts + series).
export function saveWpData(ts: string, series: Record<string, number>): void {
  const id = wpSourceId();
  if (!id) return;
  saveDeviceDataSmart(id, ts, series);
}

// Die Quellen-ID der Wärmepumpe (deviceType heatpump). Gecacht, da sich Quellen
// selten ändern; bei Bedarf neu ermittelt.
let wpSourceIdCache: string | null | undefined;
function wpSourceId(): string | null {
  if (wpSourceIdCache === undefined) {
    wpSourceIdCache = loadSources().find((s) => s.deviceType === "heatpump")?.id ?? null;
  }
  return wpSourceIdCache;
}
export function invalidateWpSourceId(): void { wpSourceIdCache = undefined; }

// Leistungsreihe (jetzt device_power mit WP-source_id) für einen Zeitraum lesen.
export function getWpPower(vonTs: string, bisTs: string): Array<{ ts: string; value: number }> {
  const id = wpSourceId();
  if (!id) return [];
  return db.prepare(
    "SELECT ts, value FROM device_power WHERE source_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC"
  ).all(id, vonTs, bisTs) as unknown as Array<{ ts: string; value: number }>;
}

// Tagesdaten: je Datenreihe die Zeitpunkte + Werte in [vonTs, bisTs] (device_data).
export function getWpData(
  vonTs: string,
  bisTs: string
): Array<{ ts: string; label: string; value: number }> {
  const id = wpSourceId();
  if (!id) return [];
  return db.prepare(
    "SELECT ts, label, value FROM device_data WHERE source_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC"
  ).all(id, vonTs, bisTs) as unknown as Array<{ ts: string; label: string; value: number }>;
}

// Alle jemals gespeicherten Datenreihen-Labels der WP (device_data).
export function getWpLabels(): string[] {
  const id = wpSourceId();
  if (!id) return [];
  return (db.prepare("SELECT DISTINCT label FROM device_data WHERE source_id = ? ORDER BY label ASC")
    .all(id) as unknown as Array<{ label: string }>).map((r) => r.label);
}

// Chart-Voreinstellungen der Wärmepumpen-Seite (welche Reihen sichtbar sind und
// welcher Achse sie zugeordnet werden). Als JSON in den Settings abgelegt, damit
// die Auswahl über Neuladen und Sitzungen erhalten bleibt.
export function getWpPrefs(): { visible: Record<string, boolean>; axisOf: Record<string, string> } {
  const raw = getSetting("wpChartPrefs");
  if (!raw) return { visible: {}, axisOf: {} };
  try {
    const p = JSON.parse(raw);
    return {
      visible: p.visible && typeof p.visible === "object" ? p.visible : {},
      axisOf: p.axisOf && typeof p.axisOf === "object" ? p.axisOf : {},
    };
  } catch {
    return { visible: {}, axisOf: {} };
  }
}
export function saveWpPrefs(prefs: {
  visible: Record<string, boolean>;
  axisOf: Record<string, string>;
}): void {
  setSetting("wpChartPrefs", JSON.stringify(prefs));
}

// --- Warmwasserspeicher-Temperaturen (Verlauf) ---------------------------------
const insertWarmwasserStmt = db.prepare(
  `INSERT INTO warmwasser_data (ts, tankUp, tankDown) VALUES (?, ?, ?)
   ON CONFLICT(ts) DO UPDATE SET tankUp = excluded.tankUp, tankDown = excluded.tankDown`
);
// Einen Messpunkt (oben/unten °C) speichern. null-Werte werden als NULL abgelegt.
//
// Änderungserkennung mit Heartbeat (analog zu saveWpData): Ein Messpunkt wird
// nur geschrieben, wenn sich tankUp oder tankDown geändert hat, oder wenn seit
// dem letzten Schreiben mindestens WP_HEARTBEAT_MS vergangen sind. Die Warmwasser-
// Daten werden nur visualisiert und für den letzten Speicherwärme-Wert genutzt
// (keine Integration), daher ist das unkritisch; der Heartbeat hält den
// Temperaturverlauf ohne größere Lücken.
let lastWwUp: number | null | undefined;
let lastWwDown: number | null | undefined;
let lastWwWriteMs = 0;
export function saveWarmwasser(ts: string, tankUp: number | null, tankDown: number | null): void {
  const jetztMs = Date.now();
  const unveraendert = lastWwUp === tankUp && lastWwDown === tankDown && lastWwUp !== undefined;
  if (unveraendert && (jetztMs - lastWwWriteMs) < WP_HEARTBEAT_MS) return;
  insertWarmwasserStmt.run(ts, tankUp, tankDown);
  lastWwUp = tankUp; lastWwDown = tankDown; lastWwWriteMs = jetztMs;
}

const warmwasserRangeStmt = db.prepare(
  "SELECT ts, tankUp, tankDown FROM warmwasser_data WHERE ts >= ? AND ts <= ? ORDER BY ts ASC"
);
// Verlauf im Zeitfenster [vonTs, bisTs].
export function getWarmwasser(
  vonTs: string, bisTs: string
): Array<{ ts: string; tankUp: number | null; tankDown: number | null }> {
  return warmwasserRangeStmt.all(vonTs, bisTs) as unknown as Array<{
    ts: string; tankUp: number | null; tankDown: number | null;
  }>;
}

const warmwasserLatestStmt = db.prepare(
  "SELECT ts, tankUp, tankDown FROM warmwasser_data ORDER BY ts DESC LIMIT 1"
);
// Zuletzt gespeicherte Speichertemperaturen (oben/unten) oder null.
export function getLatestWarmwasser():
  { ts: string; tankUp: number | null; tankDown: number | null } | null {
  return (warmwasserLatestStmt.get() as any) ?? null;
}

// --- PV-Ertragsprognose (Historie: jeder inhaltlich neue Abruf als eigener
// Datensatz je date+anlage_id+updated_at) ---
const insertPrognoseStmt = db.prepare(
  `INSERT OR REPLACE INTO pv_prognose (date, anlage_id, anlage_name, slots, kwh_total, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
// Letzten gespeicherten Prognosestand (nach updated_at) je Tag+Anlage holen, um
// unveraenderte Wiederholungen nicht erneut zu speichern.
const lastPrognoseStmt = db.prepare(
  `SELECT slots, kwh_total FROM pv_prognose
   WHERE date = ? AND anlage_id = ? ORDER BY updated_at DESC LIMIT 1`
);
export interface PvPrognoseAnlage {
  anlageId: string; anlageName: string; slots: number[]; kwhTotal: number; updatedAt: string;
}
export function savePvPrognoseAnlage(date: string, p: PvPrognoseAnlage): void {
  // Nur speichern, wenn sich die Prognose gegenueber dem letzten Stand geaendert
  // hat (Slots oder Tagessumme). So waechst die Historie nur bei echten Aenderungen.
  const last = lastPrognoseStmt.get(date, p.anlageId) as { slots: string; kwh_total: number } | undefined;
  const slotsJson = JSON.stringify(p.slots);
  if (last && last.slots === slotsJson && Math.abs((last.kwh_total ?? 0) - p.kwhTotal) < 1e-6) {
    return; // unveraendert -> kein neuer Datensatz
  }
  insertPrognoseStmt.run(date, p.anlageId, p.anlageName, slotsJson, p.kwhTotal, p.updatedAt);
}
// Aktuelle (letzte) Prognose je Anlage fuer einen Tag – speist die Standard-
// anzeige. Da es jetzt eine Historie gibt, wird je Anlage der Datensatz mit dem
// juengsten updated_at genommen.
const getPrognoseTagStmt = db.prepare(
  `SELECT p.anlage_id, p.anlage_name, p.slots, p.kwh_total, p.updated_at
   FROM pv_prognose p
   JOIN (SELECT anlage_id, MAX(updated_at) AS mu FROM pv_prognose WHERE date = ? GROUP BY anlage_id) m
     ON p.anlage_id = m.anlage_id AND p.updated_at = m.mu
   WHERE p.date = ? ORDER BY p.anlage_id`
);
export function loadPvPrognoseTag(date: string): PvPrognoseAnlage[] {
  const rows = getPrognoseTagStmt.all(date, date) as Array<{
    anlage_id: string; anlage_name: string; slots: string; kwh_total: number; updated_at: string;
  }>;
  return rows.map((r) => {
    let slots: number[] = [];
    try { slots = JSON.parse(r.slots); } catch { slots = []; }
    return { anlageId: r.anlage_id, anlageName: r.anlage_name, slots, kwhTotal: r.kwh_total, updatedAt: r.updated_at };
  });
}

// Alle unterschiedlichen Prognose-Zeitpunkte eines Tages (aufsteigend), fuer den
// Verlaufs-Slider. Ein Zeitpunkt gilt, sobald mindestens eine Anlage zu diesem
// updated_at einen Datensatz hat.
const prognoseZeitpunkteStmt = db.prepare(
  // Nur Prognose-Stände, die AM PROGNOSETAG SELBST hereinkamen (updated_at-Datum
  // == date). So werden für "heute" die bereits gestern (für heute) abgerufenen
  // Prognosen NICHT in den Verlaufs-Slider aufgenommen – der Slider zeigt nur den
  // Verlauf der am jeweiligen Tag eingegangenen Prognosen.
  `SELECT DISTINCT updated_at FROM pv_prognose
   WHERE date = ? AND substr(updated_at, 1, 10) = ?
   ORDER BY updated_at ASC`
);
export function listPvPrognoseZeitpunkte(date: string): string[] {
  return (prognoseZeitpunkteStmt.all(date, date) as Array<{ updated_at: string }>).map((r) => r.updated_at);
}

// Prognose je Anlage fuer einen Tag zu einem bestimmten Stand: pro Anlage der
// zuletzt bekannte Datensatz mit updated_at <= gewaehltem Zeitpunkt. So ergibt
// jeder Slider-Schritt den damals gueltigen Gesamtstand (auch wenn einzelne
// Anlagen zu unterschiedlichen Zeiten aktualisiert wurden).
const prognoseBisStmt = db.prepare(
  `SELECT p.anlage_id, p.anlage_name, p.slots, p.kwh_total, p.updated_at
   FROM pv_prognose p
   JOIN (SELECT anlage_id, MAX(updated_at) AS mu FROM pv_prognose
         WHERE date = ? AND updated_at <= ? GROUP BY anlage_id) m
     ON p.anlage_id = m.anlage_id AND p.updated_at = m.mu
   WHERE p.date = ? ORDER BY p.anlage_id`
);
export function loadPvPrognoseTagStand(date: string, zeitpunkt: string): PvPrognoseAnlage[] {
  const rows = prognoseBisStmt.all(date, zeitpunkt, date) as Array<{
    anlage_id: string; anlage_name: string; slots: string; kwh_total: number; updated_at: string;
  }>;
  return rows.map((r) => {
    let slots: number[] = [];
    try { slots = JSON.parse(r.slots); } catch { slots = []; }
    return { anlageId: r.anlage_id, anlageName: r.anlage_name, slots, kwhTotal: r.kwh_total, updatedAt: r.updated_at };
  });
}
const listPrognoseStmt = db.prepare(
  `SELECT date, SUM(kwh_total) AS kwh_total, MAX(updated_at) AS updated_at
   FROM pv_prognose GROUP BY date ORDER BY date DESC LIMIT ?`
);
export function listPvPrognosen(limit = 90): Array<{ date: string; kwhTotal: number; updatedAt: string }> {
  return listPrognoseStmt.all(limit) as unknown as Array<{ date: string; kwhTotal: number; updatedAt: string }>;
}

export default db;

// --- Wärmepumpen-KPI (Tagesaggregate) ---
const wpKpiUpsertStmt = db.prepare(
  `INSERT INTO wp_kpi_tag (tag, kompressorH, heizH, wwH, energieKwh, energieStandbyKwh, energieHeizKwh, energieWwKwh, energieKuehlKwh, waermeKwh, waermeHeizKwh, waermeWwKwh, kaelteKwh, takte, abtauungen, pvKwh, endKompLief, endAbtau)
   VALUES (@tag, @kompressorH, @heizH, @wwH, @energieKwh, @energieStandbyKwh, @energieHeizKwh, @energieWwKwh, @energieKuehlKwh, @waermeKwh, @waermeHeizKwh, @waermeWwKwh, @kaelteKwh, @takte, @abtauungen, @pvKwh, @endKompLief, @endAbtau)
   ON CONFLICT(tag) DO UPDATE SET
     kompressorH=excluded.kompressorH, heizH=excluded.heizH, wwH=excluded.wwH,
     energieKwh=excluded.energieKwh, energieStandbyKwh=excluded.energieStandbyKwh,
     energieHeizKwh=excluded.energieHeizKwh, energieWwKwh=excluded.energieWwKwh, energieKuehlKwh=excluded.energieKuehlKwh,
     waermeKwh=excluded.waermeKwh, waermeHeizKwh=excluded.waermeHeizKwh, waermeWwKwh=excluded.waermeWwKwh, kaelteKwh=excluded.kaelteKwh,
     takte=excluded.takte, abtauungen=excluded.abtauungen,
     pvKwh=excluded.pvKwh, endKompLief=excluded.endKompLief, endAbtau=excluded.endAbtau`
);
export function saveWpKpiTag(k: {
  tag: string; kompressorH: number; heizH: number; wwH: number; energieKwh: number;
  energieStandbyKwh: number; energieHeizKwh: number; energieWwKwh: number; energieKuehlKwh: number;
  waermeKwh: number; waermeHeizKwh: number; waermeWwKwh: number; kaelteKwh: number;
  takte: number; abtauungen: number;
  pvKwh: number; endKompLief: number; endAbtau: number;
}): void {
  wpKpiUpsertStmt.run(k as any);
}
const wpKpiGetStmt = db.prepare("SELECT * FROM wp_kpi_tag WHERE tag = ?");
export function getWpKpiTag(tag: string): any {
  return wpKpiGetStmt.get(tag) ?? null;
}
const wpKpiRangeStmt = db.prepare("SELECT * FROM wp_kpi_tag WHERE tag >= ? AND tag <= ? ORDER BY tag ASC");
export function getWpKpiRange(vonTag: string, bisTag: string): any[] {
  return wpKpiRangeStmt.all(vonTag, bisTag) as any[];
}

// Alle Consumer-Viertelstunden im Zeitraum (für PV-Abdeckungsrechnung).
const consumerVsAlleStmt = db.prepare(
  "SELECT ts, consumer, verbrauch FROM consumer_viertelstunden WHERE ts >= ? AND ts <= ? ORDER BY ts ASC"
);
export function getConsumerViertelstundenAlle(
  vonTs: string, bisTs: string
): Array<{ ts: string; consumer: string; verbrauch: number }> {
  return consumerVsAlleStmt.all(vonTs, bisTs) as unknown as Array<{ ts: string; consumer: string; verbrauch: number }>;
}

// PV-Erzeugung ALLER Anlagen je Viertelstunde (summiert).
const pvVsAlleStmt = db.prepare(
  "SELECT ts, SUM(ertrag) AS kwh FROM pv_viertelstunden WHERE ts >= ? AND ts <= ? GROUP BY ts"
);
export function getPvViertelstundenAlle(
  vonTs: string, bisTs: string
): Array<{ ts: string; kwh: number }> {
  return pvVsAlleStmt.all(vonTs, bisTs) as unknown as Array<{ ts: string; kwh: number }>;
}
