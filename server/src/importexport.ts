// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Import/Export der Einstellungsdaten als JSON.
//
// Enthalten ist die komplette KONFIGURATION – auch die Quellen (Geräte, Rollen,
// URLs, Felder). NICHT enthalten sind die im Betrieb aufgelaufenen Messwerte
// (Historie, Viertelstunden, Zählerstände, Reset-Anker, Logs, Spotpreise): Diese
// entstehen zur Laufzeit aus den Quellen und werden bewusst nicht mitgesichert.
// Exportierte Bereiche:
//   - quellen       : Quellen-Konfiguration (Geräte/Rollen/URLs/Felder)
//   - pvanlagen     : PV-Anlagendaten (Strings, Standort, Quellenzuordnung)
//   - energiekosten : Tarif, Preisbestandteile, Einspeisung, §14a
//   - visualisierung: Chart-Farben
//   - sharing       : §42c-Modus + Abnehmerliste
//   - senken        : Senken-Definitionen (Speicheransteuerung)
//   - lastprofile   : benutzerdefinierte Lastprofile (für Emulation)
//   - erzeugerprofile: benutzerdefinierte Erzeugungsprofile (für Emulation)
//   - raeume        : Raumliste
//
// Dateiformat (JSON):
// {
//   "hemsExport": true,
//   "version": 2,
//   "exportedAt": "<ISO-Zeit>",
//   "sections": { "<bereich>": <daten>, ... }
// }

import * as db from "./db.js";
import * as pvanlagen from "./pvanlagen.js";
import type { Settings } from "./types.js";

export const EXPORT_VERSION = 4;

// Alle exportierbaren Bereiche mit menschenlesbarem Namen.
export const SECTIONS = [
  { key: "quellen", label: "Quellen (Geräte-Konfiguration)" },
  { key: "pvanlagen", label: "PV-Anlagendaten" },
  { key: "energiekosten", label: "Einspeisevergütung & EEG-Regelung" },
  { key: "kostenperioden", label: "Kostenperioden (Strom, §14a, Wasser)" },
  { key: "visualisierung", label: "Visualisierung (Farben, Schriftgrößen)" },
  { key: "sharing", label: "Energy Sharing (§42c)" },
  { key: "senken", label: "Senken" },
  { key: "lastprofile", label: "Lastprofile" },
  { key: "erzeugerprofile", label: "Erzeugerprofile" },
  { key: "raeume", label: "Räume" },
  { key: "regeln", label: "Automatisierungsregeln" },
  { key: "regelgruppen", label: "Regelgruppen" },
  { key: "benachrichtigungen", label: "Benachrichtigungen (ntfy)" },
  { key: "eebus", label: "EEBUS (§14a/§9: Anbindung, WR-Regelung, SteuVE)" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

// Welche Settings-Felder gehören zu "energiekosten" bzw. "visualisierung"?
// Visualisierung = alle vizColor*-Felder; Energiekosten = der Rest der
// tariflichen/rechtlichen Felder (ohne die reinen Anzeige-/Reset-Felder).
// Nur die NICHT zeitversionierten Kostenfelder. Die versionierten Blöcke
// (Stromtarif, §14a Modul 1/3, Wasserkosten) werden über den Bereich
// "kostenperioden" exportiert/importiert – sie hier zu doppeln würde beim
// Import zu Widersprüchen führen. Einspeisevergütung und EEG-Regelung sind
// bewusst global (dauerhaft gültig) und gehören daher hierher.
const ENERGIEKOSTEN_KEYS: (keyof Settings)[] = [
  "einspeiseverguetung", "eegRegelung",
];

function pickKeys<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

// Liefert die ANZAHL der Datensätze eines Bereichs für die UI-Anzeige. Anders
// als ein einfaches Object.keys().length berücksichtigt dies verschachtelte
// Strukturen sinnvoll (z.B. Visualisierung = Farben + einzelne Schriftgrößen,
// Kostenperioden = Summe der Perioden über alle Blöcke), damit die angezeigte
// Zahl der tatsächlich exportierten Datenmenge entspricht.
export function countSection(key: SectionKey): number {
  const data = collectSection(key);
  if (data == null) return 0;
  if (Array.isArray(data)) return data.length;

  if (key === "visualisierung") {
    // Jede Farbe zählt als ein Datensatz; jede konfigurierte Schriftgröße
    // ebenfalls (fontSizes ist ein verschachteltes Objekt).
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
      if (k === "fontSizes" && v && typeof v === "object") n += Object.keys(v).length;
      else n += 1;
    }
    return n;
  }
  if (key === "kostenperioden") {
    // Summe aller Perioden über die vier versionierten Blöcke.
    let n = 0;
    for (const v of Object.values(data)) if (Array.isArray(v)) n += v.length;
    return n;
  }
  if (key === "sharing") {
    // sharingMode (1) + Anzahl Abnehmer.
    const ab = Array.isArray((data as any).abnehmer) ? (data as any).abnehmer.length : 0;
    return 1 + ab;
  }
  if (key === "eebus") {
    // Nur tatsächlich vorhandene (nicht-null) Konfigurationen zählen.
    let n = 0;
    for (const v of Object.values(data)) if (v != null) n += 1;
    return n;
  }
  if (typeof data === "object") return Object.keys(data).length;
  return 1;
}

// Sammelt die Daten eines einzelnen Bereichs.
export function collectSection(key: SectionKey): any {  const s = db.loadSettings();
  switch (key) {
    case "quellen":
      return db.loadSources();
    case "pvanlagen":
      return pvanlagen.loadPvAnlagen();
    case "energiekosten":
      return pickKeys(s, ENERGIEKOSTEN_KEYS);
    case "kostenperioden":
      return {
        stromtarif: db.loadStromtarifPerioden(),
        modul1: db.loadModul1Perioden(),
        modul3: db.loadModul3Perioden(),
        wasser: db.loadWasserPerioden(),
      };
    case "visualisierung": {
      const vizKeys = (Object.keys(s) as (keyof Settings)[]).filter((k) =>
        String(k).startsWith("vizColor")
      );
      const out: any = pickKeys(s, vizKeys);
      // Die konfigurierbaren Schriftgrößen gehören ebenfalls zur Visualisierung.
      if (s.fontSizes) out.fontSizes = s.fontSizes;
      return out;
    }
    case "sharing":
      return { sharingMode: s.sharingMode, abnehmer: db.loadAbnehmer() };
    case "senken":
      return db.loadSinks();
    case "lastprofile":
      return db.loadCustomProfiles();
    case "erzeugerprofile":
      return db.loadGenProfiles();
    case "raeume":
      return db.loadRooms();
    case "regeln":
      return db.loadRules();
    case "regelgruppen":
      return db.loadRuleGroups();
    case "benachrichtigungen":
      return db.loadNotifySettings();
    case "eebus": {
      // Die drei EEBUS-Konfigurationen als Roh-JSON-Strings bündeln.
      const parse = (raw: string | undefined) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
      return {
        eebusConfig: parse(db.getSettingRaw("eebusConfig")),
        lppControlConfig: parse(db.getSettingRaw("lppControlConfig")),
        lpcMonitorConfig: parse(db.getSettingRaw("lpcMonitorConfig")),
      };
    }
    default:
      return null;
  }
}

// Baut das Export-Objekt für die gewählten Bereiche.
export function buildExport(sections: SectionKey[]): any {
  const out: Record<string, any> = {};
  for (const key of sections) out[key] = collectSection(key);
  return {
    hemsExport: true,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sections: out,
  };
}

// Prüft ein hochgeladenes Objekt und liefert die enthaltenen Bereiche zurück
// (für die Auswahl beim Import). Wirft bei ungültigem Format.
export function inspectImport(obj: any): { version: number; sections: SectionKey[] } {
  if (!obj || typeof obj !== "object" || obj.hemsExport !== true || !obj.sections) {
    throw new Error("Keine gültige HEMS-Export-Datei.");
  }
  const known = new Set(SECTIONS.map((s) => s.key));
  const present = Object.keys(obj.sections).filter((k) => known.has(k as SectionKey)) as SectionKey[];
  return { version: Number(obj.version) || 0, sections: present };
}

export type ImportMode = "merge" | "replace";

// Wendet einen einzelnen Bereich an.
//   mode "merge"   : bestehende Daten ergänzen/überschreiben (Schlüssel-weise)
//   mode "replace" : bestehenden Bestand dieses Bereichs komplett ersetzen
function applySection(
  key: SectionKey,
  data: any,
  mode: ImportMode,
  applySources?: (list: any[]) => void
): void {
  switch (key) {
    case "quellen": {
      if (!Array.isArray(data)) break;
      let next: any[];
      if (mode === "replace") {
        next = data;
      } else {
        const existing = db.loadSources();
        const byId = new Map(existing.map((x) => [x.id, x]));
        for (const x of data) byId.set(x.id, x);
        next = [...byId.values()];
      }
      // Über den Poller setzen, damit die Timer/Abfragen sofort neu starten.
      if (applySources) applySources(next);
      else db.saveSources(next);
      break;
    }
    case "energiekosten":
    case "visualisierung":
      // Settings sind immer ein Merge auf Feldebene (es gibt nur EIN
      // Settings-Objekt; "replace" würde die übrigen Felder nicht antasten).
      if (data && typeof data === "object") db.saveSettings(data);
      break;
    case "sharing": {
      if (data?.sharingMode) db.saveSettings({ sharingMode: data.sharingMode });
      if (Array.isArray(data?.abnehmer)) {
        if (mode === "replace") {
          db.saveAbnehmer(data.abnehmer);
        } else {
          const existing = db.loadAbnehmer();
          const byId = new Map(existing.map((a) => [a.id, a]));
          for (const a of data.abnehmer) byId.set(a.id, a);
          db.saveAbnehmer([...byId.values()]);
        }
      }
      break;
    }
    case "senken": {
      if (!Array.isArray(data)) break;
      if (mode === "replace") {
        db.saveSinks(data);
      } else {
        const existing = db.loadSinks();
        const byId = new Map(existing.map((x) => [x.id, x]));
        for (const x of data) byId.set(x.id, x);
        db.saveSinks([...byId.values()]);
      }
      break;
    }
    case "pvanlagen": {
      if (!Array.isArray(data)) break;
      if (mode === "replace") {
        pvanlagen.savePvAnlagen(data);
      } else {
        const existing = pvanlagen.loadPvAnlagen();
        const byId = new Map(existing.map((x) => [x.id, x]));
        for (const x of data) byId.set(x.id, x);
        pvanlagen.savePvAnlagen([...byId.values()]);
      }
      break;
    }
    case "lastprofile": {
      if (!data || typeof data !== "object") break;
      const merged = mode === "replace" ? data : { ...db.loadCustomProfiles(), ...data };
      db.saveCustomProfiles(merged);
      break;
    }
    case "erzeugerprofile": {
      if (!data || typeof data !== "object") break;
      const merged = mode === "replace" ? data : { ...db.loadGenProfiles(), ...data };
      db.saveGenProfiles(merged);
      break;
    }
    case "raeume": {
      if (!Array.isArray(data)) break;
      if (mode === "replace") {
        db.saveRooms(data);
      } else {
        db.saveRooms([...new Set([...db.loadRooms(), ...data])]);
      }
      break;
    }
    case "regeln": {
      if (!Array.isArray(data)) break;
      if (mode === "replace") {
        db.saveRules(data);
      } else {
        const existing = db.loadRules();
        const byId = new Map(existing.map((x) => [x.id, x]));
        for (const x of data) byId.set(x.id, x);
        db.saveRules([...byId.values()]);
      }
      break;
    }
    case "regelgruppen": {
      if (!Array.isArray(data)) break;
      if (mode === "replace") {
        db.saveRuleGroups(data);
      } else {
        const existing = db.loadRuleGroups();
        const byId = new Map(existing.map((x) => [x.id, x]));
        for (const x of data) byId.set(x.id, x);
        db.saveRuleGroups([...byId.values()]);
      }
      break;
    }
    case "benachrichtigungen": {
      // ntfy-Einstellungen sind ein einzelnes Objekt -> immer Merge auf Feldebene.
      if (data && typeof data === "object") db.saveNotifySettings(data);
      break;
    }
    case "eebus": {
      // Die drei EEBUS-Konfigurationen als Roh-JSON zurückschreiben. Nur
      // vorhandene (nicht-null) Blöcke anwenden. Wirkt nach Neustart bzw. beim
      // nächsten Laden der jeweiligen Config.
      if (data && typeof data === "object") {
        if (data.eebusConfig != null) db.setSettingRaw("eebusConfig", JSON.stringify(data.eebusConfig));
        if (data.lppControlConfig != null) db.setSettingRaw("lppControlConfig", JSON.stringify(data.lppControlConfig));
        if (data.lpcMonitorConfig != null) db.setSettingRaw("lpcMonitorConfig", JSON.stringify(data.lpcMonitorConfig));
      }
      break;
    }
    case "kostenperioden": {
      // Ganze Perioden-Listen ersetzen (feldweiser Merge ergäbe keinen Sinn).
      if (data && typeof data === "object") {
        if (Array.isArray(data.stromtarif)) db.saveStromtarifPerioden(data.stromtarif);
        if (Array.isArray(data.modul1)) db.saveModul1Perioden(data.modul1);
        if (Array.isArray(data.modul3)) db.saveModul3Perioden(data.modul3);
        if (Array.isArray(data.wasser)) db.saveWasserPerioden(data.wasser);
      }
      break;
    }
  }
}

// Führt den Import der gewählten Bereiche aus. Gibt die tatsächlich
// angewandten Bereiche zurück.
export function applyImport(
  obj: any,
  sections: SectionKey[],
  mode: ImportMode,
  applySources?: (list: any[]) => void
): SectionKey[] {
  const known = new Set(SECTIONS.map((s) => s.key));
  const applied: SectionKey[] = [];
  for (const key of sections) {
    if (!known.has(key)) continue;
    if (!(key in obj.sections)) continue;
    applySection(key, obj.sections[key], mode, applySources);
    applied.push(key);
  }
  return applied;
}
