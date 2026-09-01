// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Export/Import der gesammelten MESSDATEN über eine Zeitspanne.
//
// Getrennt vom Einstellungs-Export (importexport.ts): Hier geht es um die
// persistierten Verläufe – Viertelstundenwerte (Energie, Verbrauch, PV, Sharing,
// Wasser), Tagesbilanzen, Spotpreise, Drosselungen, Wärmepumpe, Warmwasser. Ziel
// ist, einen Datenbestand von Tag X bis Tag Y auf eine andere/neue Instanz zu
// übertragen.

import db from "./db.js";

export const DATA_EXPORT_VERSION = 1;

// Beschreibt eine exportierbare Datentabelle.
//   timeCol  – Spalte mit dem Zeitbezug
//   kind     – "ts": ISO-Zeitstempel (Filter über Datumspräfix YYYY-MM-DD),
//              "date": reines Tagesdatum YYYY-MM-DD
//   conflict – Spalte(n) für ON CONFLICT beim Import (Primär-/Unique-Key)
interface DataTable {
  table: string;
  timeCol: string;
  kind: "ts" | "date";
  columns: string[];
  conflict: string[];
}

// Reihenfolge bewusst: erst die feinen Viertelstundenwerte, dann Aggregate.
export const DATA_TABLES: DataTable[] = [
  { table: "viertelstunden", timeCol: "ts", kind: "ts",
    columns: ["ts", "eingespeist", "bezogen", "verbrauch", "eingespeistPv", "eingespeistBatt", "verbrauchPv", "verbrauchSpeicher", "eingespeist42cPv", "eingespeist42cBatt"],
    conflict: ["ts"] },
  { table: "consumer_viertelstunden", timeCol: "ts", kind: "ts",
    columns: ["ts", "consumer", "verbrauch"], conflict: ["ts", "consumer"] },
  { table: "pv_viertelstunden", timeCol: "ts", kind: "ts",
    columns: ["ts", "source", "ertrag"], conflict: ["ts", "source"] },
  { table: "sharing_viertelstunden", timeCol: "ts", kind: "ts",
    columns: ["ts", "source", "bezogen"], conflict: ["ts", "source"] },
  { table: "wasser_viertelstunden", timeCol: "ts", kind: "ts",
    columns: ["ts", "liter"], conflict: ["ts"] },
  { table: "wp_data", timeCol: "ts", kind: "ts",
    columns: ["ts", "label", "value"], conflict: ["ts", "label"] },
  { table: "warmwasser_data", timeCol: "ts", kind: "ts",
    columns: ["ts", "tankUp", "tankDown"], conflict: ["ts"] },
  { table: "wp_kpi_tag", timeCol: "tag", kind: "date",
    columns: ["tag", "kompressorH", "heizH", "wwH", "energieKwh", "energieStandbyKwh", "energieHeizKwh", "energieWwKwh", "energieKuehlKwh", "waermeKwh", "waermeHeizKwh", "waermeWwKwh", "kaelteKwh", "takte", "abtauungen", "pvKwh", "endKompLief", "endAbtau"],
    conflict: ["tag"] },
  { table: "history", timeCol: "date", kind: "date",
    columns: ["date", "verbrauch", "pvSpeicher", "netzbezug", "eingespeist", "autarkie", "pvDirekt", "speicher", "eingespeist42cPv", "eingespeist42cSpeicher"],
    conflict: ["date"] },
  { table: "spotpreise", timeCol: "date", kind: "date",
    columns: ["date", "prices", "fetched"], conflict: ["date"] },
  { table: "drosselungen", timeCol: "date", kind: "date",
    columns: ["id", "date", "value", "source"], conflict: ["id"] },
  { table: "pv_prognose", timeCol: "date", kind: "date",
    columns: ["date", "anlage_id", "anlage_name", "slots", "kwh_total", "updated_at"], conflict: ["date", "anlage_id"] },
];

// Menschlich lesbare Bezeichnungen (für die UI und den Import-Bericht).
export const DATA_TABLE_LABELS: Record<string, string> = {
  viertelstunden: "Energie-Viertelstundenwerte",
  consumer_viertelstunden: "Verbraucher-Viertelstundenwerte",
  pv_viertelstunden: "PV-Viertelstundenwerte",
  sharing_viertelstunden: "Sharing-Viertelstundenwerte",
  wasser_viertelstunden: "Wasser-Viertelstundenwerte",
  wp_data: "Wärmepumpen-Daten",
  wp_kpi_tag: "Wärmepumpen-Kennzahlen (Tageswerte)",
  warmwasser_data: "Warmwasser-Temperaturen",
  history: "Tagesbilanzen",
  spotpreise: "Börsenstrompreise",
  drosselungen: "Drosselungen",
  pv_prognose: "PV-Ertragsprognose",
  logs: "Log-Meldungen",
  rule_log: "Regel-Protokoll",
};

// Grenzt einen [von,bis]-Tagesbereich auf die passende Filterbedingung ab.
// Für ts-Spalten wird das Präfix genutzt (ts >= "von" AND ts <= "bis"T23:59:59).
function rangeBounds(kind: "ts" | "date", vonDate: string, bisDate: string): [string, string] {
  if (kind === "date") return [vonDate, bisDate];
  return [vonDate, bisDate + "T23:59:59.999"];
}

export interface DataExportResult {
  version: number;
  exportedAt: string;
  von: string;
  bis: string;
  tables: Record<string, any[]>;
  counts: Record<string, number>;
}

// Zählt nur die Datensätze je Tabelle im Tagesbereich, ohne die Daten selbst zu
// laden – für die Export-Vorschau (schnell, auch bei großen Zeiträumen).
export function countDataExport(vonDate: string, bisDate: string): {
  von: string; bis: string; counts: Record<string, number>; total: number;
} {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const dt of DATA_TABLES) {
    const [lo, hi] = rangeBounds(dt.kind, vonDate, bisDate);
    const r = db.prepare(
      `SELECT COUNT(*) c FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ?`
    ).get(lo, hi) as { c: number };
    counts[dt.table] = r.c;
    total += r.c;
  }
  return { von: vonDate, bis: bisDate, counts, total };
}

// Exportiert alle Datentabellen im Tagesbereich [vonDate, bisDate] (inklusive).
export function buildDataExport(vonDate: string, bisDate: string): DataExportResult {
  const tables: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const dt of DATA_TABLES) {
    const [lo, hi] = rangeBounds(dt.kind, vonDate, bisDate);
    const rows = db.prepare(
      `SELECT ${dt.columns.join(", ")} FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ? ORDER BY ${dt.timeCol} ASC`
    ).all(lo, hi) as any[];
    tables[dt.table] = rows;
    counts[dt.table] = rows.length;
  }
  return {
    version: DATA_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    von: vonDate,
    bis: bisDate,
    tables,
    counts,
  };
}

// Prüft eine Import-Datei und liefert eine Übersicht, ohne zu schreiben. Zusätzlich
// wird ermittelt, wie viele Datensätze im Zielbereich bereits existieren (für die
// Überschreib-Rückfrage).
export function inspectDataImport(obj: any): {
  version: number; von: string; bis: string;
  counts: Record<string, number>;      // enthaltene Datensätze je Tabelle
  existing: Record<string, number>;    // bereits vorhandene im selben Bereich
  totalIncoming: number;
  totalExisting: number;
} {
  if (!obj || obj.hemsDataExport !== true) {
    throw new Error("Keine gültige HEMS-Datenexport-Datei");
  }
  const von = String(obj.von ?? "");
  const bis = String(obj.bis ?? "");
  const counts: Record<string, number> = {};
  const existing: Record<string, number> = {};
  let totalIncoming = 0;
  let totalExisting = 0;
  for (const dt of DATA_TABLES) {
    const rows = Array.isArray(obj.tables?.[dt.table]) ? obj.tables[dt.table] : [];
    counts[dt.table] = rows.length;
    totalIncoming += rows.length;
    if (rows.length > 0 && von && bis) {
      const [lo, hi] = rangeBounds(dt.kind, von, bis);
      const ex = db.prepare(
        `SELECT COUNT(*) c FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ?`
      ).get(lo, hi) as { c: number };
      existing[dt.table] = ex.c;
      totalExisting += ex.c;
    } else {
      existing[dt.table] = 0;
    }
  }
  return { version: Number(obj.version ?? 0), von, bis, counts, existing, totalIncoming, totalExisting };
}

// Importiert die Daten. mode "overwrite" ersetzt vorhandene Datensätze im
// Zielbereich (erst löschen, dann einfügen); mode "skip" fügt nur hinzu und lässt
// vorhandene Datensätze unangetastet (ON CONFLICT DO NOTHING). Gibt die Anzahl
// tatsächlich geschriebener Zeilen je Tabelle zurück.
export function applyDataImport(obj: any, mode: "overwrite" | "skip"): Record<string, number> {
  if (!obj || obj.hemsDataExport !== true) {
    throw new Error("Keine gültige HEMS-Datenexport-Datei");
  }
  const von = String(obj.von ?? "");
  const bis = String(obj.bis ?? "");
  const written: Record<string, number> = {};

  const runAll = db.prepare("BEGIN");
  runAll.run();
  try {
    for (const dt of DATA_TABLES) {
      const rows: any[] = Array.isArray(obj.tables?.[dt.table]) ? obj.tables[dt.table] : [];
      if (rows.length === 0) { written[dt.table] = 0; continue; }
      if (mode === "overwrite" && von && bis) {
        const [lo, hi] = rangeBounds(dt.kind, von, bis);
        db.prepare(`DELETE FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ?`).run(lo, hi);
      }
      const placeholders = dt.columns.map(() => "?").join(", ");
      const conflictClause = mode === "skip"
        ? `ON CONFLICT(${dt.conflict.join(", ")}) DO NOTHING`
        : "";
      const stmt = db.prepare(
        `INSERT INTO ${dt.table} (${dt.columns.join(", ")}) VALUES (${placeholders}) ${conflictClause}`
      );
      let n = 0;
      for (const row of rows) {
        // "drosselungen" hat eine autoincrement-id; beim Überschreiben würde ein
        // fixes id einen Konflikt erzeugen. Daher id beim Import weglassen und neu
        // vergeben (nur diese Tabelle).
        const cols = dt.table === "drosselungen" ? dt.columns.filter((c) => c !== "id") : dt.columns;
        const ph = cols.map(() => "?").join(", ");
        const cc = mode === "skip" ? `ON CONFLICT(${dt.conflict.join(", ")}) DO NOTHING` : "";
        const s = dt.table === "drosselungen"
          ? db.prepare(`INSERT INTO ${dt.table} (${cols.join(", ")}) VALUES (${ph}) ${cc}`)
          : stmt;
        const vals = cols.map((c) => row[c] ?? null);
        try { s.run(...vals); n++; } catch { /* einzelne Zeile überspringen */ }
      }
      written[dt.table] = n;
    }
    db.prepare("COMMIT").run();
  } catch (e) {
    try { db.prepare("ROLLBACK").run(); } catch { /* ignore */ }
    throw e;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Kalender-Übersicht + gezieltes Löschen von Tagen/Zeiträumen
// ---------------------------------------------------------------------------

// Soll-Anzahl der Viertelstunden-Slots eines Tages unter Berücksichtigung der
// mitteleuropäischen Sommerzeit-Umstellung (Europe/Berlin):
//   - normaler Tag: 96
//   - Frühjahrsumstellung (letzter So im März): 92 (Stunde 02–03 fehlt)
//   - Herbstumstellung (letzter So im Oktober): 100 (Stunde 02–03 doppelt)
export function expectedSlotsForDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // letzter Sonntag im Monat bestimmen
  const lastSunday = (year: number, month1: number): number => {
    const last = new Date(Date.UTC(year, month1, 0)).getUTCDate(); // letzter Tag
    const dow = new Date(Date.UTC(year, month1 - 1, last)).getUTCDay();
    return last - dow; // Tag des letzten Sonntags
  };
  if (m === 3 && d === lastSunday(y, 3)) return 92;
  if (m === 10 && d === lastSunday(y, 10)) return 100;
  return 96;
}

export interface DayInfo {
  date: string;
  vsSlots: number;      // belegte Slots in viertelstunden
  vsExpected: number;   // Soll-Slots (DST-korrekt)
  vsPercent: number;    // 0..100
  hasOther: boolean;    // gibt es Daten in anderen Datentabellen an diesem Tag?
}

// Liefert für ein Jahr je Tag mit Daten eine Info. Tage ganz ohne Daten sind
// NICHT enthalten (die UI stellt sie schlicht ausgegraut dar).
export function dataCalendar(year: number): DayInfo[] {
  const von = `${year}-01-01`;
  const bis = `${year}-12-31`;
  // Belegte Slots der Haupttabelle je Tag
  const vsRows = db.prepare(
    "SELECT substr(ts,1,10) d, COUNT(*) c FROM viertelstunden WHERE ts >= ? AND ts <= ? GROUP BY d"
  ).all(von, bis + "T23:59:59.999") as Array<{ d: string; c: number }>;
  const vsMap = new Map(vsRows.map((r) => [r.d, r.c]));

  // Tage, an denen IRGENDEINE der übrigen ts-Datentabellen Werte hat
  const otherDays = new Set<string>();
  for (const t of ["consumer_viertelstunden", "pv_viertelstunden", "sharing_viertelstunden", "wasser_viertelstunden", "wp_data", "warmwasser_data"]) {
    const rows = db.prepare(
      `SELECT DISTINCT substr(ts,1,10) d FROM ${t} WHERE ts >= ? AND ts <= ?`
    ).all(von, bis + "T23:59:59.999") as Array<{ d: string }>;
    for (const r of rows) otherDays.add(r.d);
  }
  // Tagesbasierte Tabellen (history, spotpreise) ebenfalls als „Daten vorhanden"
  for (const t of ["history", "spotpreise"]) {
    const rows = db.prepare(`SELECT DISTINCT date d FROM ${t} WHERE date >= ? AND date <= ?`).all(von, bis) as Array<{ d: string }>;
    for (const r of rows) otherDays.add(r.d);
  }

  const allDays = new Set<string>([...vsMap.keys(), ...otherDays]);
  const out: DayInfo[] = [];
  for (const d of allDays) {
    const slots = vsMap.get(d) ?? 0;
    const expected = expectedSlotsForDay(d);
    out.push({
      date: d,
      vsSlots: slots,
      vsExpected: expected,
      vsPercent: expected > 0 ? Math.round((slots / expected) * 1000) / 10 : 0,
      hasOther: otherDays.has(d),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Detaillierte Datenmengen eines einzelnen Tages (für das Overlay): je Datenart
// die Anzahl Datensätze, für die Viertelstundentabellen zusätzlich der Prozent-
// Anteil belegter Slots.
export function dayDetail(dateStr: string): {
  date: string; expected: number;
  parts: Array<{ table: string; label: string; count: number; percent: number | null }>;
} {
  const expected = expectedSlotsForDay(dateStr);
  const parts: Array<{ table: string; label: string; count: number; percent: number | null }> = [];
  for (const dt of DATA_TABLES) {
    let count = 0;
    if (dt.kind === "ts") {
      const r = db.prepare(`SELECT COUNT(*) c FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ?`)
        .get(dateStr, dateStr + "T23:59:59.999") as { c: number };
      count = r.c;
    } else {
      // Tages-basierte Tabellen: die Zeitspalte (z.B. "date" oder "tag") enthält
      // YYYY-MM-DD. Der Spaltenname variiert je Tabelle -> dt.timeCol nutzen.
      const r = db.prepare(`SELECT COUNT(*) c FROM ${dt.table} WHERE ${dt.timeCol} = ?`).get(dateStr) as { c: number };
      count = r.c;
    }
    // Prozent nur für die Slot-basierten VS-Tabellen mit genau einem Wert je Slot
    // (viertelstunden, wasser_viertelstunden). Bei Tabellen mit mehreren Reihen je
    // Slot (consumer/pv/sharing je Quelle, wp_data je Label) ist ein Prozentsatz
    // nicht eindeutig -> null.
    const slotBased = dt.table === "viertelstunden" || dt.table === "wasser_viertelstunden";
    parts.push({
      table: dt.table,
      label: DATA_TABLE_LABELS[dt.table] ?? dt.table,
      count,
      percent: slotBased && expected > 0 ? Math.round((count / expected) * 1000) / 10 : null,
    });
  }
  return { date: dateStr, expected, parts };
}

// Löscht alle Messdaten im Tagesbereich [vonDate, bisDate] (inklusive) aus allen
// Datentabellen. Gibt die Anzahl gelöschter Zeilen je Tabelle zurück.
// Tabellen, die beim Löschen von Tagen/Zeiträumen NICHT entfernt werden.
// Börsenstrompreise sind externe Marktdaten, die sich nicht wiederbeschaffen
// lassen – sie bleiben immer erhalten, auch wenn alle eigenen Messdaten des Tages
// gelöscht werden.
const DELETE_PROTECTED = new Set(["spotpreise"]);

// Protokoll-Tabellen (Log-/Regelmeldungen). Sie gehören nicht zu den Messdaten
// (DATA_TABLES), werden bei einer Zeitraum-Löschung aber mit entfernt, damit auch
// die zugehörigen Log- und Regelprotokoll-Einträge desselben Zeitraums
// verschwinden. Beide haben eine ISO-Zeitspalte "ts".
const LOG_TABLES: Array<{ table: string; timeCol: string; label: string }> = [
  { table: "logs", timeCol: "ts", label: "Log-Meldungen" },
  { table: "rule_log", timeCol: "ts", label: "Regel-Protokoll" },
];

// Löscht alle Messdaten im Tagesbereich [vonDate, bisDate] (inklusive) aus allen
// Datentabellen – AUSSER den geschützten (Börsenstrompreise bleiben erhalten).
// Zusätzlich werden die Protokoll-Tabellen (Logs, Regel-Protokoll) im selben
// Zeitraum gelöscht. Gibt die Anzahl gelöschter Zeilen je Tabelle zurück.
export function deleteDataRange(vonDate: string, bisDate: string): Record<string, number> {
  const deleted: Record<string, number> = {};
  const hiTs = bisDate + "T23:59:59.999";
  db.prepare("BEGIN").run();
  try {
    for (const dt of DATA_TABLES) {
      if (DELETE_PROTECTED.has(dt.table)) continue; // z. B. spotpreise erhalten
      const [lo, hi] = dt.kind === "date" ? [vonDate, bisDate] : [vonDate, hiTs];
      const before = (db.prepare(`SELECT COUNT(*) c FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ?`).get(lo, hi) as { c: number }).c;
      db.prepare(`DELETE FROM ${dt.table} WHERE ${dt.timeCol} >= ? AND ${dt.timeCol} <= ?`).run(lo, hi);
      deleted[dt.table] = before;
    }
    // Protokoll-Tabellen im selben Zeitraum (ts als ISO-Zeitstempel).
    for (const lt of LOG_TABLES) {
      const before = (db.prepare(`SELECT COUNT(*) c FROM ${lt.table} WHERE ${lt.timeCol} >= ? AND ${lt.timeCol} <= ?`).get(vonDate, hiTs) as { c: number }).c;
      db.prepare(`DELETE FROM ${lt.table} WHERE ${lt.timeCol} >= ? AND ${lt.timeCol} <= ?`).run(vonDate, hiTs);
      deleted[lt.table] = before;
    }
    db.prepare("COMMIT").run();
  } catch (e) {
    try { db.prepare("ROLLBACK").run(); } catch { /* ignore */ }
    throw e;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Direkte SQL-Ausführung (Abfragen und Eingriffe) für die Datenverwaltung
// ---------------------------------------------------------------------------

export interface SqlResult {
  kind: "rows" | "changes";
  columns?: string[];
  rows?: any[];
  rowCount?: number;      // bei SELECT: Anzahl Zeilen
  changes?: number;       // bei INSERT/UPDATE/DELETE: betroffene Zeilen
  truncated?: boolean;    // bei SELECT: wurde die Ausgabe gekürzt?
}

const SQL_ROW_LIMIT = 5000; // Schutz gegen riesige Ergebnismengen in der UI

// Führt EINE SQL-Anweisung aus. SELECT/PRAGMA/EXPLAIN liefern Zeilen; alle
// übrigen (INSERT/UPDATE/DELETE/…) liefern die Anzahl betroffener Zeilen.
// Bewusst mächtig: direkte Eingriffe in die Datenbank sind ausdrücklich gewollt.
export function runSql(sql: string): SqlResult {
  const trimmed = (sql ?? "").trim().replace(/;+\s*$/, "");
  if (!trimmed) throw new Error("Leere Anweisung");
  // Mehrere Anweisungen unterbinden (ein Statement pro Aufruf), damit Ergebnis
  // und Fehlerbehandlung eindeutig bleiben.
  // (Semikolons in String-Literalen sind selten; für dieses Wartungswerkzeug
  // akzeptabel. Wir prüfen nur auf ein Semikolon mitten im Text.)
  if (/;\s*\S/.test(trimmed)) {
    throw new Error("Bitte nur EINE Anweisung pro Ausführung (kein Semikolon in der Mitte).");
  }
  const isRead = /^\s*(select|pragma|explain|with)\b/i.test(trimmed);
  if (isRead) {
    const stmt = db.prepare(trimmed);
    const all = stmt.all() as any[];
    const truncated = all.length > SQL_ROW_LIMIT;
    const rows = truncated ? all.slice(0, SQL_ROW_LIMIT) : all;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { kind: "rows", columns, rows, rowCount: all.length, truncated };
  }
  const info = db.prepare(trimmed).run();
  return { kind: "changes", changes: Number(info.changes ?? 0) };
}

// Liefert das Datenbankschema (Tabellen + Spalten) für die Hilfestellung.
export function sqlSchema(): Array<{ table: string; columns: Array<{ name: string; type: string }> }> {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as Array<{ name: string }>;
  return tables.map((t) => ({
    table: t.name,
    columns: (db.prepare(`PRAGMA table_info(${t.name})`).all() as any[])
      .map((c) => ({ name: c.name, type: c.type || "" })),
  }));
}
