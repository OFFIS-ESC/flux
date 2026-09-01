// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Gemeinsame Chart-Hilfen: „schöne" Achsenskalen mit Zwischenlinien sowie
// Umrechnung von Energie (kWh je Viertelstunde) auf mittlere Leistung (W).

// Rundet den Maximalwert auf einen „glatten" Wert auf und liefert gleichmäßige
// Tick-Werte inklusive Zwischenlinien (z. B. 0 / 0,5 / 1 / 1,5 / 2 / 2,5 / 3).
// Rückgabe: { max, ticks } – ticks aufsteigend inkl. 0 und max.
export function niceScale(rawMax: number, targetSteps = 5): { max: number; ticks: number[] } {
  if (!isFinite(rawMax) || rawMax <= 0) return { max: 1, ticks: [0, 0.5, 1] };
  // Grobe Schrittweite, dann auf 1/2/2.5/5 * 10^n normieren.
  const rough = rawMax / targetSteps;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  // Rundungsfehler vermeiden: Anzahl Schritte bestimmen und iterieren.
  const n = Math.round(max / step);
  for (let i = 0; i <= n; i++) ticks.push(+(i * step).toFixed(10));
  return { max, ticks };
}

// Einheiten-Umschaltung für Energiemengen-Charts.
export type EnergieEinheit = "kwh" | "w";

// kWh je Viertelstunde -> mittlere Leistung in W: * 1000 (kWh->Wh) * 4 (pro h).
export function kwhToW(kwh: number): number {
  return kwh * 4000;
}

// Wert gemäß gewählter Einheit umrechnen (kWh bleibt, W = *4000).
export function convertEnergie(kwh: number, einheit: EnergieEinheit): number {
  return einheit === "w" ? kwhToW(kwh) : kwh;
}

// Passendes Einheiten-Kürzel.
export function einheitLabel(einheit: EnergieEinheit): string {
  return einheit === "w" ? "W" : "kWh";
}

// Achsen-Beschriftung je Tick abhängig von Einheit/Größenordnung formatieren.
export function fmtTick(v: number, einheit: EnergieEinheit): string {
  if (v === 0) return "0";
  if (einheit === "w") {
    // Leistung: ganzzahlig, ab 1000 mit Tausenderpunkt.
    return Math.round(v).toLocaleString("de-DE");
  }
  // kWh: bis 2 Nachkommastellen, aber ohne unnötige Nullen.
  if (Math.abs(v) >= 10) return nf(v, 0);
  if (Math.abs(v) >= 1) return nf(v, 1);
  return nf(v, 2);
}

// Zentrale deutsche Zahlformatierung: Komma als Dezimaltrenner, Punkt als
// Tausendertrenner. Für ALLE angezeigten Zahlen im Tool verwenden, damit der
// Dezimaltrenner einheitlich ist (statt uneinheitlich toFixed = Punkt vs.
// toLocaleString = Komma). `dezimal` legt die feste Nachkommastellenzahl fest;
// wird sie weggelassen, wird kaufmännisch bis 2 Stellen gerundet ohne
// aufgefüllte Nullen.
export function nf(wert: number, dezimal?: number): string {
  if (!Number.isFinite(wert)) return "–";
  if (dezimal == null) {
    return wert.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  }
  return wert.toLocaleString("de-DE", {
    minimumFractionDigits: dezimal,
    maximumFractionDigits: dezimal,
  });
}
