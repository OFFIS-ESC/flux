// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Jahres-/Monatsrückblick ("Energie-Wrapped"): aggregiert die Tagesbilanzen
// (history) und die evcc-Ladehistorie zu Kennzahlen und Highlights für einen
// Zeitraum. Reine Auswertung vorhandener Daten – keine externe Abhängigkeit
// (die echte CO₂-Verrechnung kommt separat; hier eine klar markierte Schätzung).

import * as db from "./db.js";
import type { HistoryEntry } from "./types.js";

export interface RueckblickKennzahlen {
  zeitraum: string;              // "2026" oder "2026-09"
  ebene: "jahr" | "monat";
  tageMitDaten: number;
  // Energiemengen (kWh)
  erzeugung: number;
  verbrauch: number;
  netzbezug: number;
  eingespeist: number;
  pvDirekt: number;
  speicher: number;
  eigenverbrauch: number;        // pvDirekt + speicher
  // Quoten (%)
  autarkie: number;              // Eigenverbrauch / Verbrauch
  eigenverbrauchsquote: number;  // Eigenverbrauch / Erzeugung
  // Sharing
  sharing42c: number;            // an §42c-Abnehmer geliefert (kWh)
  // Highlights
  ertragreichsterTag?: { datum: string; kwh: number };
  verbrauchsreichsterTag?: { datum: string; kwh: number };
  besterAutarkieTag?: { datum: string; autarkie: number };
  ertragreichsterMonat?: { monat: string; kwh: number }; // nur Jahresebene
  // E-Auto
  autoGeladen: number;           // kWh gesamt
  autoSonne: number;             // kWh mit Sonne
  autoSonnenKm?: number;         // geschätzte km mit Sonnenstrom
  // CO₂ (Schätzung)
  co2VermiedenKg: number;        // vermiedener Netzbezug × Faktor
  co2Geschaetzt: boolean;        // true = Näherung (kein echter Netzmix)
  // Verbrauchsaufteilung in die drei großen Bereiche (kWh + Autarkie je Bereich).
  bereiche?: {
    heizen: { kwh: number; autarkie: number };
    warmwasser: { kwh: number; autarkie: number; wpKwh?: number; heizstabKwh?: number };
    auto: { kwh: number; autarkie: number };
    haushalt: { kwh: number; autarkie: number };
  };
  // Monatswerte für den Chart (Jahresebene) bzw. Tageswerte (Monatsebene)
  verlauf: Array<{ label: string; erzeugung: number; verbrauch: number; autarkie: number }>;
}

// CO₂-Faktor für vermiedenen Netzbezug (g/kWh), grobe Näherung deutscher Strommix.
const CO2_FAKTOR_G = 380;
// Grobe Annahme für "Sonnen-Kilometer": kWh pro 100 km.
const KWH_PRO_100KM = 17;

function tagErzeugung(h: HistoryEntry): number {
  // Erzeugung = Eigenverbrauch direkt + über Speicher + Einspeisung.
  return (h.pvDirekt ?? 0) + (h.speicher ?? 0) + (h.eingespeist ?? 0);
}

export interface EvccSessionLite { created: string; chargedEnergy: number; solarPercentage?: number; }

export function berechneRueckblick(
  ebene: "jahr" | "monat",
  jahr: number,
  monat: number, // 0-basiert, nur bei ebene "monat"
  sessions: EvccSessionLite[],
): RueckblickKennzahlen {
  const alle = db.getAllHistory();
  const prefix = ebene === "jahr" ? `${jahr}-` : `${jahr}-${String(monat + 1).padStart(2, "0")}-`;
  const tage = alle.filter((h) => h.date.startsWith(prefix));

  let erzeugung = 0, verbrauch = 0, netzbezug = 0, eingespeist = 0, pvDirekt = 0, speicher = 0, sharing42c = 0;
  let ertragreichsterTag: { datum: string; kwh: number } | undefined;
  let verbrauchsreichsterTag: { datum: string; kwh: number } | undefined;
  let besterAutarkieTag: { datum: string; autarkie: number } | undefined;
  const monatsErzeugung = new Map<number, number>();

  for (const h of tage) {
    const erz = tagErzeugung(h);
    erzeugung += erz;
    verbrauch += h.verbrauch ?? 0;
    netzbezug += h.netzbezug ?? 0;
    eingespeist += h.eingespeist ?? 0;
    pvDirekt += h.pvDirekt ?? 0;
    speicher += h.speicher ?? 0;
    sharing42c += (h.eingespeist42cPv ?? 0) + (h.eingespeist42cSpeicher ?? 0);
    if (!ertragreichsterTag || erz > ertragreichsterTag.kwh) ertragreichsterTag = { datum: h.date, kwh: erz };
    if (!verbrauchsreichsterTag || (h.verbrauch ?? 0) > verbrauchsreichsterTag.kwh) verbrauchsreichsterTag = { datum: h.date, kwh: h.verbrauch ?? 0 };
    if ((h.verbrauch ?? 0) > 1 && (!besterAutarkieTag || (h.autarkie ?? 0) > besterAutarkieTag.autarkie)) besterAutarkieTag = { datum: h.date, autarkie: h.autarkie ?? 0 };
    const m = new Date(h.date + "T12:00:00").getMonth();
    monatsErzeugung.set(m, (monatsErzeugung.get(m) ?? 0) + erz);
  }

  const eigenverbrauch = pvDirekt + speicher;
  const autarkie = verbrauch > 0 ? (eigenverbrauch / verbrauch) * 100 : 0;
  const eigenverbrauchsquote = erzeugung > 0 ? (eigenverbrauch / erzeugung) * 100 : 0;

  // Ertragreichster Monat (nur Jahresebene).
  let ertragreichsterMonat: { monat: string; kwh: number } | undefined;
  if (ebene === "jahr") {
    const namen = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    for (const [m, kwh] of monatsErzeugung) {
      if (!ertragreichsterMonat || kwh > ertragreichsterMonat.kwh) ertragreichsterMonat = { monat: namen[m], kwh };
    }
  }

  // E-Auto aus den Sessions des Zeitraums.
  let autoGeladen = 0, autoSonne = 0;
  for (const s of sessions) {
    const d = new Date(s.created);
    if (isNaN(d.getTime())) continue;
    const passt = ebene === "jahr" ? d.getFullYear() === jahr : (d.getFullYear() === jahr && d.getMonth() === monat);
    if (!passt) continue;
    autoGeladen += s.chargedEnergy;
    autoSonne += s.chargedEnergy * ((s.solarPercentage ?? 0) / 100);
  }
  const autoSonnenKm = autoSonne > 0 ? Math.round((autoSonne / KWH_PRO_100KM) * 100) : undefined;

  // CO₂-Ersparnis (Schätzung): vermiedener Netzbezug = Eigenverbrauch.
  const co2VermiedenKg = (eigenverbrauch * CO2_FAKTOR_G) / 1000;

  // Verlauf: Jahresebene je Monat, Monatsebene je Tag.
  const verlauf: RueckblickKennzahlen["verlauf"] = [];
  if (ebene === "jahr") {
    const namen = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const proMonat = new Map<number, { erz: number; verb: number; eigen: number }>();
    for (const h of tage) {
      const m = new Date(h.date + "T12:00:00").getMonth();
      const e = proMonat.get(m) ?? { erz: 0, verb: 0, eigen: 0 };
      e.erz += tagErzeugung(h); e.verb += h.verbrauch ?? 0; e.eigen += (h.pvDirekt ?? 0) + (h.speicher ?? 0);
      proMonat.set(m, e);
    }
    for (let m = 0; m < 12; m++) {
      const e = proMonat.get(m);
      verlauf.push({ label: namen[m], erzeugung: e?.erz ?? 0, verbrauch: e?.verb ?? 0, autarkie: e && e.verb > 0 ? (e.eigen / e.verb) * 100 : 0 });
    }
  } else {
    for (const h of tage.sort((a, b) => a.date.localeCompare(b.date))) {
      verlauf.push({ label: String(new Date(h.date + "T12:00:00").getDate()), erzeugung: tagErzeugung(h), verbrauch: h.verbrauch ?? 0, autarkie: h.autarkie ?? 0 });
    }
  }

  return {
    zeitraum: ebene === "jahr" ? String(jahr) : `${jahr}-${String(monat + 1).padStart(2, "0")}`,
    ebene, tageMitDaten: tage.length,
    erzeugung, verbrauch, netzbezug, eingespeist, pvDirekt, speicher, eigenverbrauch,
    autarkie, eigenverbrauchsquote, sharing42c,
    ertragreichsterTag, verbrauchsreichsterTag, besterAutarkieTag, ertragreichsterMonat,
    autoGeladen, autoSonne, autoSonnenKm,
    co2VermiedenKg, co2Geschaetzt: true,
    verlauf,
  };
}
