// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Zeitversionierte Kostenperioden.
//
// Die vier versionierten Blöcke (Stromtarif, §14a Modul 1, §14a Modul 3,
// Wasserkosten) werden je als Perioden-Liste gehalten. Zu einem Datum gilt die
// Periode mit dem größten gueltigAb <= Datum. Die §42c-Abnehmer werden pro
// Abnehmer separat versioniert (siehe db.loadAbnehmer / sharing).
//
// Dieses Modul kapselt Auswahl (pickPeriode), Migration aus den bisherigen
// zeitlosen Settings sowie das Zusammensetzen "effektiver" Settings für ein
// gegebenes Datum (effectiveSettingsForDate) – so bleibt die Kostenberechnung
// nahezu unverändert und arbeitet weiter mit einem Settings-Objekt.

import type {
  Settings,
  StromtarifPeriode, Modul1Periode, Modul3Periode, WasserPeriode,
  StromtarifWerte, Modul1Werte, Modul3Werte, WasserWerte,
  Periode,
} from "./types.js";

export const MIN_DATE = "2000-01-01";

// Wählt die für ein Datum (YYYY-MM-DD) gültige Periode: die mit dem größten
// gueltigAb <= date. Liegt date vor der ersten Periode, wird die erste genommen
// (früheste bekannte Werte gelten also auch rückwärts, statt zu fehlen).
export function pickPeriode<T>(perioden: Periode<T>[], date: string): Periode<T> | null {
  if (!perioden || perioden.length === 0) return null;
  const sorted = [...perioden].sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
  let chosen = sorted[0];
  for (const p of sorted) {
    if (p.gueltigAb <= date) chosen = p;
    else break;
  }
  return chosen;
}

// "bis"-Datum (Anzeige) einer Periode = Vortag der nächsten Periode, sonst offen.
export function periodeBis(perioden: Periode<unknown>[], index: number): string | null {
  const sorted = [...perioden].sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
  const next = sorted[index + 1];
  if (!next) return null;
  const d = new Date(next.gueltigAb + "T00:00:00");
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Werte aus den (bisherigen) Settings extrahieren (für Migration/Fallback) ---
export function stromtarifFromSettings(s: Settings): StromtarifWerte {
  return {
    strompreis: s.strompreis, tarifMode: s.tarifMode, anbieterName: s.anbieterName,
    grundgebuehrMonat: s.grundgebuehrMonat,
    messstelleEuroJahr: s.messstelleEuroJahr,
    sofortbonus: s.sofortbonus, neukundenbonus: s.neukundenbonus,
    beschaffung: s.beschaffung,
    stromsteuer: s.stromsteuer, konzessionsabgabe: s.konzessionsabgabe,
    aufschlagNetznutzung: s.aufschlagNetznutzung, offshoreUmlage: s.offshoreUmlage,
    kwkgUmlage: s.kwkgUmlage, umsatzsteuer: s.umsatzsteuer,
  };
}
export function modul1FromSettings(s: Settings): Modul1Werte {
  return { paragraf14aModul1Aktiv: s.paragraf14aModul1Aktiv, modul1PauschaleNetto: s.modul1PauschaleNetto };
}
export function modul3FromSettings(s: Settings): Modul3Werte {
  return {
    paragraf14aAktiv: s.paragraf14aAktiv, netzentgeltStandard: s.netzentgeltStandard,
    netzentgeltHoch: s.netzentgeltHoch, netzentgeltNiedrig: s.netzentgeltNiedrig,
    lastWindows: s.lastWindows,
  };
}
export function wasserFromSettings(s: Settings): WasserWerte {
  return {
    wasserFrischEuroM3: s.wasserFrischEuroM3, wasserAbwasserEuroM3: s.wasserAbwasserEuroM3,
    wasserGrundpreisMonat: s.wasserGrundpreisMonat,
  };
}

// Setzt aus einem Basis-Settings-Objekt und den Werten der vier Perioden ein
// "effektives" Settings-Objekt für ein bestimmtes Datum zusammen. Nicht
// versionierte Felder (Farben, Sharing-Modus …) bleiben aus base erhalten.
export function composeSettings(
  base: Settings,
  strom: StromtarifWerte | null,
  m1: Modul1Werte | null,
  m3: Modul3Werte | null,
  wasser: WasserWerte | null
): Settings {
  return {
    ...base,
    ...(strom ?? {}),
    ...(m1 ?? {}),
    ...(m3 ?? {}),
    ...(wasser ?? {}),
  };
}
