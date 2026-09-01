// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Simulator für die repräsentativen BDEW-Standardlastprofile (gültig ab 2025):
//   H25 = Haushalt, G25 = Gewerbe allgemein, L25 = Landwirtschaft,
//   P25, S25 – jeweils aus der BDEW-Tabelle "Repräsentative Profile",
//   normiert auf 1 Mio kWh Jahresverbrauch.
// Jedes Profil ist nach Monat (1–12) und Tagestyp gegliedert:
//   WT = Werktag (Mo–Fr), SA = Samstag, FT = Sonn-/Feiertag.
// Jeder Tagestyp hat 96 Viertelstundenwerte (kWh je Viertelstunde bei 1 Mio
// kWh/a). Auf einen anderen Jahresverbrauch wird linear skaliert, sodass die
// Jahressumme exakt dem angegebenen Verbrauch entspricht.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Tagestyp = "WT" | "SA" | "FT";
type MonatsProfil = Record<string, Record<Tagestyp, number[]>>;
type AllProfiles = Record<string, MonatsProfil>;

// Eingebaute Profile (read-only) aus der mitgelieferten JSON.
const builtinProfiles: AllProfiles = JSON.parse(
  readFileSync(path.join(__dirname, "emu_profiles.json"), "utf8")
);
const BUILTIN_NAMES = Object.keys(builtinProfiles);

// Benutzerdefinierte (hochgeladene) Profile – zur Laufzeit gesetzt (aus DB).
let customProfiles: AllProfiles = {};

// Erzeugungsprofile (auf 1 kWp normiert, kWh je Viertelstunde bei 1 kWp).
// Gleiche Datenstruktur wie Lastprofile, aber eigene Verwaltung/Skalierung.
let genProfiles: AllProfiles = {};

export const DEFAULT_EMU_PROFILE = "H25";

// Benutzerprofile injizieren (wird beim Start und nach Upload/Löschen gerufen).
export function setCustomProfiles(p: AllProfiles): void {
  customProfiles = p ?? {};
}

// Erzeugungsprofile injizieren (Start + nach Upload/Löschen).
export function setGenProfiles(p: AllProfiles): void {
  genProfiles = p ?? {};
}

// Liste aller verfügbaren Profilnamen mit Quelle (eingebaut/benutzerdefiniert).
export function listProfiles(): Array<{ name: string; builtin: boolean }> {
  const out = BUILTIN_NAMES.map((n) => ({ name: n, builtin: true }));
  for (const n of Object.keys(customProfiles)) {
    if (!BUILTIN_NAMES.includes(n)) out.push({ name: n, builtin: false });
  }
  return out;
}

// Liste der Erzeugungsprofile. Es gibt (noch) keine eingebauten Profile.
export function listGenProfiles(): Array<{ name: string; builtin: boolean }> {
  return Object.keys(genProfiles).map((n) => ({ name: n, builtin: false }));
}

// Rohes Erzeugungs-Monatsprofil (für Visualisierung/Download).
export function getGenProfileData(name: string): MonatsProfil | null {
  return name in genProfiles ? genProfiles[name] : null;
}

// Erzeugungsleistung (W) jetzt, skaliert auf die Anlagengröße kwp. Die Profile
// sind auf 1 kWp normiert (kWh je Viertelstunde bei 1 kWp), daher genügt die
// lineare Multiplikation mit kwp – KEINE Jahresnormierung wie beim Lastprofil.
export function genPowerNow(
  profilName: string,
  kwp: number,
  now = new Date()
): number {
  const prof = genProfiles[profilName];
  if (!prof) return 0;
  const slot = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
  const arr = prof[String(now.getMonth() + 1)][tagestyp(now)];
  const raw = arr[Math.max(0, Math.min(95, slot))];
  const kwh = raw * (kwp || 0);
  return (kwh / 0.25) * 1000;
}

// Erzeugungs-Tagesgang (96 Viertelstundenwerte in kWh) für die Visualisierung
// auf der Erzeugerprofil-Seite, skaliert auf kwp.
export function genDayProfile(
  profilName: string,
  kwp: number,
  d: Date
): { tagestyp: Tagestyp; values: number[] } {
  const prof = genProfiles[profilName];
  const t = tagestyp(d);
  if (!prof) return { tagestyp: t, values: new Array(96).fill(0) };
  const arr = prof[String(d.getMonth() + 1)][t];
  return { tagestyp: t, values: arr.map((v) => v * (kwp || 0)) };
}

// Rohes Monatsprofil (für Visualisierung/Download).
export function getProfileData(name: string): MonatsProfil | null {
  if (name in customProfiles) return customProfiles[name];
  if (name in builtinProfiles) return builtinProfiles[name];
  return null;
}

function profilOf(name: string | undefined): MonatsProfil {
  if (name && name in customProfiles) return customProfiles[name];
  if (name && name in builtinProfiles) return builtinProfiles[name];
  return builtinProfiles[DEFAULT_EMU_PROFILE];
}

function gaussEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function isHoliday(d: Date): boolean {
  const y = d.getFullYear();
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  const fixed = [101, 501, 1003, 1225, 1226];
  if (fixed.includes(md)) return true;
  const easter = gaussEaster(y);
  const offsets = [-2, 1, 39, 50];
  for (const off of offsets) {
    const day = new Date(easter);
    day.setDate(day.getDate() + off);
    if (day.getMonth() === d.getMonth() && day.getDate() === d.getDate()) return true;
  }
  return false;
}

export function tagestyp(d: Date): Tagestyp {
  if (isHoliday(d)) return "FT";
  const wd = d.getDay();
  if (wd === 0) return "FT";
  if (wd === 6) return "SA";
  return "WT";
}

function jahresRohsumme(prof: MonatsProfil, year: number): number {
  let total = 0;
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    const arr = prof[String(d.getMonth() + 1)][tagestyp(d)];
    for (const v of arr) total += v;
    d.setDate(d.getDate() + 1);
  }
  return total;
}

const rohsummeCache: Record<string, number> = {};
function rohsumme(profilName: string, prof: MonatsProfil, year: number): number {
  const key = `${profilName}:${year}`;
  if (!(key in rohsummeCache)) rohsummeCache[key] = jahresRohsumme(prof, year);
  return rohsummeCache[key];
}

export function emuBezug(
  profilName: string,
  jahresverbrauchKWh: number,
  d: Date,
  slotIndex: number
): number {
  const prof = profilOf(profilName);
  const arr = prof[String(d.getMonth() + 1)][tagestyp(d)];
  const raw = arr[Math.max(0, Math.min(95, slotIndex))];
  const scale = jahresverbrauchKWh / rohsumme(profilName, prof, d.getFullYear());
  return raw * scale;
}

export function emuPowerNow(
  profilName: string,
  jahresverbrauchKWh: number,
  now = new Date()
): number {
  const slot = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
  const kwh = emuBezug(profilName, jahresverbrauchKWh, now, slot);
  return (kwh / 0.25) * 1000;
}

// Kumulierter Bezugs-Zählerstand (gridIn): summiert nur positive Slot-Werte.
// Negative Profilwerte (Eigeneinspeisung des Abnehmers) zählen hier nicht.
export function emuMeterReading(
  profilName: string,
  jahresverbrauchKWh: number,
  now = new Date()
): number {
  return emuMeterReadingSigned(profilName, jahresverbrauchKWh, now, "in");
}

// Kumulierter Einspeise-Zählerstand (gridOut): summiert die Beträge der
// negativen Slot-Werte. 0, wenn das Profil keine negativen Werte enthält.
export function emuMeterReadingOut(
  profilName: string,
  jahresverbrauchKWh: number,
  now = new Date()
): number {
  return emuMeterReadingSigned(profilName, jahresverbrauchKWh, now, "out");
}

function emuMeterReadingSigned(
  profilName: string,
  jahresverbrauchKWh: number,
  now: Date,
  which: "in" | "out"
): number {
  const prof = profilOf(profilName);
  const year = now.getFullYear();
  const scale = jahresverbrauchKWh / rohsumme(profilName, prof, year);
  const take = (v: number) =>
    which === "in" ? Math.max(0, v) : Math.max(0, -v);
  let sum = 0;
  const d = new Date(year, 0, 1);
  while (
    d.getMonth() < now.getMonth() ||
    (d.getMonth() === now.getMonth() && d.getDate() < now.getDate())
  ) {
    const arr = prof[String(d.getMonth() + 1)][tagestyp(d)];
    for (const v of arr) sum += take(v);
    d.setDate(d.getDate() + 1);
  }
  const arrToday = prof[String(now.getMonth() + 1)][tagestyp(now)];
  const slotNow = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
  // Alle BEREITS ABGESCHLOSSENEN Viertelstunden des Tages voll aufsummieren.
  for (let i = 0; i < slotNow && i < 96; i++) sum += take(arrToday[i]);
  // Die aktuell LAUFENDE Viertelstunde nur anteilig nach den verstrichenen
  // Sekunden interpolieren. Dadurch steigt der (kumulierte) Zählerstand
  // kontinuierlich und linear über die 15 Minuten, statt am Slot-Anfang
  // komplett zu springen. Ein abrupter Sprung führte je nach Abtastzeitpunkt
  // dazu, dass der Zuwachs der falschen Viertelstunde zugeordnet wurde
  // (Lücken mit Doppelwert in der Nachbar-Viertelstunde).
  if (slotNow < 96) {
    const secsIntoSlot = (now.getMinutes() % 15) * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    const frac = Math.min(1, secsIntoSlot / (15 * 60));
    sum += take(arrToday[slotNow]) * frac;
  }
  // Bei "in" multiplizieren wir mit dem (vorzeichenbehafteten) scale; da scale
  // bei sinnvollen Profilen positiv ist, bleibt der Zähler monoton.
  return sum * Math.abs(scale);
}

// ============================================================================
//  EIGENHAUSHALT-EMULATION (Rolle "gridEmu")
//  Netto-Netzleistung = Lastprofil (skaliert auf jahresverbrauch) minus
//  Erzeugungsprofil (skaliert auf kwp). Positiv = Netzbezug, negativ =
//  Einspeisung. Liefert Momentanleistung und kumulierte Netto-Zählerstände.
// ============================================================================

// Skalierter Last-Slotwert (kWh je Viertelstunde) am gegebenen Tag/Slot.
function lastSlotKwh(profilName: string, jahresverbrauchKWh: number, d: Date, slot: number): number {
  const prof = profilOf(profilName);
  const arr = prof[String(d.getMonth() + 1)][tagestyp(d)];
  const raw = arr[Math.max(0, Math.min(95, slot))];
  const scale = jahresverbrauchKWh / rohsumme(profilName, prof, d.getFullYear());
  return raw * scale;
}

// Skalierter Erzeugungs-Slotwert (kWh je Viertelstunde) am gegebenen Tag/Slot.
// Profile sind auf 1 kWp normiert -> lineare Skalierung mit kwp.
function genSlotKwh(genName: string | undefined, kwp: number, d: Date, slot: number): number {
  if (!genName) return 0;
  const prof = genProfiles[genName];
  if (!prof) return 0;
  const arr = prof[String(d.getMonth() + 1)][tagestyp(d)];
  const raw = arr[Math.max(0, Math.min(95, slot))];
  return raw * (kwp || 0);
}

// Momentane Netto-Netzleistung (W): +Bezug / -Einspeisung.
export function gridEmuPowerNow(
  lastProfil: string,
  jahresverbrauchKWh: number,
  genProfil: string | undefined,
  kwp: number,
  now = new Date()
): number {
  const slot = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
  const nettoKwh =
    lastSlotKwh(lastProfil, jahresverbrauchKWh, now, slot) -
    genSlotKwh(genProfil, kwp, now, slot);
  return (nettoKwh / 0.25) * 1000;
}

// Kumulierter Netto-Zählerstand seit Jahresbeginn. which="in": Summe der
// positiven Netto-Slots (Netzbezug), which="out": Summe der Beträge negativer
// Netto-Slots (Einspeisung). Laufende Viertelstunde anteilig interpoliert.
function gridEmuMeterSigned(
  lastProfil: string,
  jahresverbrauchKWh: number,
  genProfil: string | undefined,
  kwp: number,
  now: Date,
  which: "in" | "out"
): number {
  const year = now.getFullYear();
  const take = (v: number) => (which === "in" ? Math.max(0, v) : Math.max(0, -v));
  const netto = (d: Date, slot: number) =>
    lastSlotKwh(lastProfil, jahresverbrauchKWh, d, slot) - genSlotKwh(genProfil, kwp, d, slot);
  let sum = 0;
  const d = new Date(year, 0, 1);
  while (
    d.getMonth() < now.getMonth() ||
    (d.getMonth() === now.getMonth() && d.getDate() < now.getDate())
  ) {
    for (let i = 0; i < 96; i++) sum += take(netto(d, i));
    d.setDate(d.getDate() + 1);
  }
  const slotNow = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
  for (let i = 0; i < slotNow && i < 96; i++) sum += take(netto(now, i));
  if (slotNow < 96) {
    const secsIntoSlot =
      (now.getMinutes() % 15) * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    const frac = Math.min(1, secsIntoSlot / (15 * 60));
    sum += take(netto(now, slotNow)) * frac;
  }
  return sum;
}

export function gridEmuMeterIn(
  lastProfil: string, jahresverbrauchKWh: number, genProfil: string | undefined, kwp: number, now = new Date()
): number {
  return gridEmuMeterSigned(lastProfil, jahresverbrauchKWh, genProfil, kwp, now, "in");
}
export function gridEmuMeterOut(
  lastProfil: string, jahresverbrauchKWh: number, genProfil: string | undefined, kwp: number, now = new Date()
): number {
  return gridEmuMeterSigned(lastProfil, jahresverbrauchKWh, genProfil, kwp, now, "out");
}

// Lastgang (96 Viertelstundenwerte in kWh) eines konkreten Tages, skaliert auf
// den Jahresverbrauch. Für die Visualisierung auf der Lastprofil-Seite.
export function dayProfile(
  profilName: string,
  jahresverbrauchKWh: number,
  d: Date
): { tagestyp: Tagestyp; values: number[] } {
  const prof = profilOf(profilName);
  const t = tagestyp(d);
  const arr = prof[String(d.getMonth() + 1)][t];
  const scale = jahresverbrauchKWh / rohsumme(profilName, prof, d.getFullYear());
  return { tagestyp: t, values: arr.map((v) => v * scale) };
}

// ============================================================================
//  DATEIFORMAT FÜR LASTPROFILE (.csv, Semikolon-getrennt)
// ----------------------------------------------------------------------------
//  Ein Profil beschreibt den Tagesverlauf des Strombezugs in 96 Viertelstunden
//  (00:00–00:15 ... 23:45–00:00), aufgeschlüsselt nach Monat (1–12) und
//  Tagestyp (WT=Werktag, SA=Samstag, FT=Sonn-/Feiertag).
//
//  - Zeilen, die mit '#' beginnen, sind Kommentare und werden ignoriert.
//  - Trennzeichen ist das Semikolon ';'. Dezimaltrenner ist der Punkt '.'.
//  - Erste Datenspalte ist das Zeitfenster (nur zur Lesbarkeit, wird beim
//    Import ignoriert). Es folgen die Wertespalten.
//  - Es gibt zwei zulässige Detailgrade:
//
//    (A) EINFACH – ein einziger Tagesgang für alle Monate und Tagestypen:
//        Kopfzeile:   zeit;wert
//        96 Datenzeilen mit je einem Wert. Dieser Tagesgang gilt für jeden
//        Tag im Jahr. Ideal für eigene Messreihen ohne Saison-/Wochentag-
//        Differenzierung.
//
//    (B) VOLL – getrennt nach Monat und Tagestyp (36 Wertespalten):
//        Kopfzeile:   zeit;1_WT;1_SA;1_FT;2_WT;2_SA;2_FT;...;12_WT;12_SA;12_FT
//        96 Datenzeilen mit je 36 Werten in genau dieser Spaltenreihenfolge.
//
//  Die Absolutwerte sind beliebig (z.B. kWh je Viertelstunde): der Simulator
//  normiert intern und skaliert auf den je Quelle eingestellten
//  Jahresverbrauch. Es zählt also nur die FORM des Verlaufs, nicht die Höhe.
// ============================================================================

const TAGESTYPEN: Tagestyp[] = ["WT", "SA", "FT"];

// Beispiel-/Vorlageninhalt (einfaches Format) für die UI.
// Beispiel-Tagesgang (relativer Verlauf) für Vorlagen.
function beispielTag(i: number, offset = 0): number {
  return 0.4 + 0.6 * Math.max(0, Math.sin(((i - 24 + offset) / 96) * 2 * Math.PI));
}
function zeitfenster(i: number): string {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  const von = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const e =
    i === 95
      ? "00:00"
      : `${String(Math.floor(((i + 1) * 15) / 60) % 24).padStart(2, "0")}:${String(((i + 1) * 15) % 60).padStart(2, "0")}`;
  return `${von}-${e}`;
}

export type ProfilFormat = "einfach" | "erweitert" | "vollstaendig";

// Erzeugt eine CSV-Vorlage im gewünschten Format.
//  einfach       -> zeit;wert                       (1 Wertespalte)
//  erweitert     -> zeit;WT;SA;FT                    (3 Wertespalten)
//  vollstaendig  -> zeit;1_WT;1_SA;1_FT;...;12_FT    (36 Wertespalten)
export function exampleProfileCsv(format: ProfilFormat = "einfach"): string {
  if (format === "einfach") {
    const lines = [
      "# Lastprofil-Vorlage – einfaches Format (ein Tagesgang fuer alle Tage)",
      "# Spalte 1 = Zeitfenster (nur Info), Spalte 2 = relativer Wert.",
      "# 96 Datenzeilen (00:00-00:15 ... 23:45-00:00). Dezimaltrenner: Punkt.",
      "zeit;wert",
    ];
    for (let i = 0; i < 96; i++)
      lines.push(`${zeitfenster(i)};${beispielTag(i).toFixed(3)}`);
    return lines.join("\n") + "\n";
  }

  if (format === "erweitert") {
    const lines = [
      "# Lastprofil-Vorlage – erweitertes Format (je ein Tagesgang fuer",
      "# Werktag (WT), Samstag (SA) und Sonn-/Feiertag (FT); fuer alle Monate gleich).",
      "# Spalte 1 = Zeitfenster (nur Info). 96 Datenzeilen. Dezimaltrenner: Punkt.",
      "zeit;WT;SA;FT",
    ];
    for (let i = 0; i < 96; i++) {
      const wt = beispielTag(i).toFixed(3);
      const sa = beispielTag(i, 8).toFixed(3); // Samstag etwas verschoben
      const ft = beispielTag(i, 16).toFixed(3); // Sonn-/Feiertag flacher/spaeter
      lines.push(`${zeitfenster(i)};${wt};${sa};${ft}`);
    }
    return lines.join("\n") + "\n";
  }

  // vollstaendig: 12 Monate × 3 Tagestypen = 36 Wertespalten
  const head: string[] = ["zeit"];
  for (let mo = 1; mo <= 12; mo++)
    for (const t of TAGESTYPEN) head.push(`${mo}_${t}`);
  const lines = [
    "# Lastprofil-Vorlage – vollstaendiges Format (12 Monate × 3 Tagestypen).",
    "# Spaltenreihenfolge: zeit;1_WT;1_SA;1_FT;2_WT;...;12_FT (36 Wertespalten).",
    "# Spalte 1 = Zeitfenster (nur Info). 96 Datenzeilen. Dezimaltrenner: Punkt.",
    head.join(";"),
  ];
  for (let i = 0; i < 96; i++) {
    const row: string[] = [zeitfenster(i)];
    for (let mo = 1; mo <= 12; mo++) {
      // leichte saisonale Variation als Platzhalter
      const saison = 1 + 0.15 * Math.cos(((mo - 1) / 12) * 2 * Math.PI);
      row.push((beispielTag(i) * saison).toFixed(3)); // WT
      row.push((beispielTag(i, 8) * saison).toFixed(3)); // SA
      row.push((beispielTag(i, 16) * saison).toFixed(3)); // FT
    }
    lines.push(row.join(";"));
  }
  return lines.join("\n") + "\n";
}

// Serialisiert ein gespeichertes Profil ins VOLLE CSV-Format (Download).
export function profileToCsv(name: string): string | null {
  const prof = getProfileData(name);
  if (!prof) return null;
  return profToCsv(name, prof, "Lastprofil");
}

// CSV-Export eines Erzeugungsprofils (auf 1 kWp normiert).
export function genProfileToCsv(name: string): string | null {
  const prof = getGenProfileData(name);
  if (!prof) return null;
  return profToCsv(name, prof, "Erzeugungsprofil (1 kWp)");
}

function profToCsv(name: string, prof: MonatsProfil, art: string): string {
  const header = ["zeit"];
  for (let mo = 1; mo <= 12; mo++)
    for (const t of TAGESTYPEN) header.push(`${mo}_${t}`);
  const lines = [
    `# ${art} "${name}" – volles Format (Monat_Tagestyp), 96 Viertelstunden`,
    `# Tagestyp: WT=Werktag, SA=Samstag, FT=Sonn-/Feiertag`,
    header.join(";"),
  ];
  for (let i = 0; i < 96; i++) {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    const von = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const eMin = (i + 1) * 15;
    const bis = `${String(Math.floor(eMin / 60) % 24).padStart(2, "0")}:${String(eMin % 60).padStart(2, "0")}`;
    const row = [`${von}-${bis}`];
    for (let mo = 1; mo <= 12; mo++)
      for (const t of TAGESTYPEN) row.push(prof[String(mo)][t][i].toFixed(3));
    lines.push(row.join(";"));
  }
  return lines.join("\n") + "\n";
}

// Parst eine hochgeladene CSV (Format A oder B) in ein MonatsProfil.
// Wirft bei Formatfehlern einen Error mit verständlicher Meldung.
export function parseProfileCsv(text: string): MonatsProfil {
  const rawLines = text.split(/\r?\n/);
  const dataLines: string[] = [];
  let header: string[] | null = null;
  for (const ln of rawLines) {
    const line = ln.trim();
    if (!line || line.startsWith("#")) continue;
    const cols = line.split(";").map((c) => c.trim());
    if (header === null) {
      header = cols;
      continue;
    }
    dataLines.push(line);
  }
  if (header === null) throw new Error("Datei enthält keine Kopfzeile.");
  const valueCols = header.length - 1; // erste Spalte = Zeit
  if (dataLines.length !== 96)
    throw new Error(
      `Es werden genau 96 Datenzeilen erwartet (eine je Viertelstunde), gefunden: ${dataLines.length}.`
    );

  const parseRow = (line: string): number[] => {
    const cols = line.split(";").map((c) => c.trim());
    return cols.slice(1).map((c) => {
      const v = Number(c.replace(",", "."));
      if (!Number.isFinite(v)) throw new Error(`Ungültiger Zahlenwert: "${c}".`);
      return v;
    });
  };

  const empty = (): Record<Tagestyp, number[]> => ({ WT: [], SA: [], FT: [] });
  const prof: MonatsProfil = {};
  for (let mo = 1; mo <= 12; mo++) prof[String(mo)] = empty();

  if (valueCols === 1) {
    // Einfaches Format: ein Tagesgang für alle Monate/Tagestypen.
    const day: number[] = [];
    for (const line of dataLines) day.push(parseRow(line)[0]);
    for (let mo = 1; mo <= 12; mo++)
      for (const t of TAGESTYPEN) prof[String(mo)][t] = [...day];
    return prof;
  }
  if (valueCols === 3) {
    // Erweitertes Format: je ein Tagesgang für WT, SA, FT (für alle Monate
    // gleich). Spaltenreihenfolge: zeit;WT;SA;FT.
    const cols: Record<Tagestyp, number[]> = { WT: [], SA: [], FT: [] };
    for (const line of dataLines) {
      const row = parseRow(line);
      cols.WT.push(row[0]);
      cols.SA.push(row[1]);
      cols.FT.push(row[2]);
    }
    for (let mo = 1; mo <= 12; mo++)
      for (const t of TAGESTYPEN) prof[String(mo)][t] = [...cols[t]];
    return prof;
  }
  if (valueCols === 36) {
    // Vollständiges Format: 12 Monate × 3 Tagestypen.
    const matrix: number[][] = dataLines.map(parseRow);
    for (let i = 0; i < 96; i++) {
      let col = 0;
      for (let mo = 1; mo <= 12; mo++)
        for (const t of TAGESTYPEN) prof[String(mo)][t][i] = matrix[i][col++];
    }
    return prof;
  }
  throw new Error(
    `Unerwartete Spaltenzahl: ${valueCols} Wertespalten. Erlaubt sind 1 (einfaches Format), 3 (erweitertes Format: WT/SA/FT) oder 36 (vollständiges Format).`
  );
}
