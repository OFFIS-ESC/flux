// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Viertelstundengenaue Berechnung der Bezugskosten und der Einspeisevergütung.
// Wird on-the-fly aus den gespeicherten Viertelstundenwerten und den
// Spotpreisen gerechnet – es werden keine Tageskosten mehr persistiert.
//
//  Bezugskosten:
//    - Fixtarif:    je kWh der eingegebene feste Brutto-Gesamtpreis.
//    - Dyn. Tarif:  je Viertelstunde der Brutto-Endkundenpreis, bestehend aus
//                   Börsenpreis dieser VS + feste Preisbestandteile +
//                   Netzentgelt (zeit-/quartalsabhängig bei §14a), mal USt.
//
//  Einspeisevergütung (je kWh Einspeisung):
//    - EEG vor 25.02.2025:  immer die eingestellte Vergütung.
//    - EEG ab 25.02.2025:   nur wenn der Börsenpreis dieser VS >= 0 ist;
//                           ist er negativ, entfällt die Vergütung für diese VS.
//      (Liegt kein Spotpreis vor, wird die Vergütung gezahlt – vorsichtige,
//       für den Betreiber günstige Annahme; alternativ ließe sich 0 ansetzen.)

import * as db from "./db.js";
import { computeSharingDay } from "./sharing.js";
import { pickPeriode } from "./periods.js";
import type { Settings } from "./types.js";

// Aktiver Netzentgelt-Tarif (Standard/Hoch/Niedrig) zur gegebenen Zeit.
function activeLastTarif(s: Settings, date: Date): "standard" | "hoch" | "niedrig" {
  const minute = date.getHours() * 60 + date.getMinutes();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  const inWindow = (w: { startMin: number; endMin: number }) =>
    w.startMin <= w.endMin
      ? minute >= w.startMin && minute < w.endMin
      : minute >= w.startMin || minute < w.endMin;
  for (const w of s.lastWindows) {
    if (!w.quarters.includes(quarter)) continue;
    if (inWindow(w)) return w.kind;
  }
  return "standard";
}

// Netzentgelt (netto, ct/kWh) zur gegebenen Zeit (§14a-abhängig).
export function netzentgeltCt(s: Settings, date: Date): number {
  if (!s.paragraf14aAktiv) return s.netzentgeltStandard;
  const t = activeLastTarif(s, date);
  if (t === "hoch") return s.netzentgeltHoch;
  if (t === "niedrig") return s.netzentgeltNiedrig;
  return s.netzentgeltStandard;
}

// Brutto-Bezugspreis (€/kWh) für eine konkrete Viertelstunde.
// spotCt = Börsenpreis dieser VS in ct/kWh (oder null, falls nicht vorhanden).
export function bezugspreisVS(s: Settings, slot: Date, spotCt: number | null): number {
  if (s.tarifMode !== "dyn") return s.strompreis; // Fixtarif: fester Gesamtpreis
  // Dynamischer Tarif: Börsenpreis + Anbieter-Aufschlag (Beschaffung/Vertrieb)
  // + feste Bestandteile + Netzentgelt, dann Umsatzsteuer. Liegt kein
  // Börsenpreis vor, wird 0 angesetzt (nur Aufschlag/Bestandteile greifen).
  const spot = spotCt ?? 0;
  const nettoCt =
    spot +
    s.beschaffung +
    s.stromsteuer +
    s.konzessionsabgabe +
    s.aufschlagNetznutzung +
    s.offshoreUmlage +
    s.kwkgUmlage +
    netzentgeltCt(s, slot);
  return (nettoCt * (1 + s.umsatzsteuer / 100)) / 100;
}

// Einspeisevergütung (€/kWh) für eine konkrete Viertelstunde.
export function einspeiseVerguetungVS(s: Settings, spotCt: number | null): number {
  if (s.eegRegelung === "ab2502") {
    // Keine Vergütung bei negativem Börsenpreis dieser Viertelstunde.
    if (spotCt != null && spotCt < 0) return 0;
  }
  return s.einspeiseverguetung;
}

// Index der Viertelstunde (0..95) aus einem End-Zeitstempel "YYYY-MM-DDTHH:MM".
// Die VS wird unter ihrem ENDE gespeichert; Index = (Endminute/15) - 1.
function slotIndexFromEndTs(ts: string): number {
  const hhmm = ts.slice(11);
  const [h, m] = hhmm.split(":").map(Number);
  let idx = Math.round((h * 60 + m) / 15) - 1;
  if (idx < 0) idx = 95; // 00:00 = Ende des letzten Intervalls des Vortags
  return idx;
}

// Startzeit der VS (für Netzentgelt-Fenster) aus dem End-Zeitstempel ableiten.
function slotStartDate(ts: string): Date {
  const end = new Date(ts.replace(" ", "T"));
  return new Date(end.getTime() - 15 * 60 * 1000);
}

export interface TagesKosten {
  bezugskosten: number; // € Bezugskosten des Tages (bis jetzt)
  einspeiseverguetung: number; // € EEG-Einspeisevergütung des Tages (bis jetzt)
  sharingVerguetung: number; // € §42c-Vergütung der an Abnehmer gelieferten Energie
  saldo: number; // bezugskosten - einspeiseverguetung - sharingVerguetung
  einsparung: number; // € vermiedene Bezugskosten durch Eigenverbrauch (PV+Speicher)
  einsparungPv: number;        // € Anteil PV-Direktverbrauch
  einsparungSpeicher: number;  // € Anteil Speicher-Entladung
  eigenKwhPv: number;          // kWh eigenverbrauchte PV-Energie
  eigenKwhSpeicher: number;    // kWh eigenverbrauchte Speicher-Energie
  // Einzelbestandteile für die Aufschlüsselung (Tooltip in der Monatstabelle).
  // Bezugskosten OHNE die anteiligen Fixkosten/Boni (reine Arbeitspreiskosten).
  arbeitskosten: number;       // € reine Bezugs-Arbeitskosten des Tages
  grundgebuehrAnteil: number;  // € anteilige monatliche Grundgebühr
  sofortbonusAnteil: number;   // € anteiliger Sofortbonus (negativ = Gutschrift)
  neukundenbonusAnteil: number; // € anteiliger Neukundenbonus (negativ = Gutschrift)
  messstelleAnteil: number;    // € anteilige Messstellengebühr
  modul1Anteil: number;        // € anteilige §14a-Modul-1-Reduktion (negativ = Gutschrift)
  // Details für die Abrechnungsaufschlüsselung:
  bezogenKwh: number;          // kWh Netzbezug des Tages
  eingespeistKwh: number;      // kWh klassische Netzeinspeisung (ohne §42c-Anteil)
  modul3Effekt: number;        // € §14a-Modul-3-Effekt (zeitvariables Netzentgelt
                               //   ggü. Standard-Netzentgelt), inkl. USt.
                               //   negativ = Einsparung (Niedriglast), positiv = Aufschlag (Hochlast).
                               //   Ist in bezugskosten/arbeitskosten bereits enthalten.
  modul3EffektHoch: number;    // € Modul-3-Effekt in Hochlastphasen (Aufschlag)
  modul3EffektNiedrig: number; // € Modul-3-Effekt in Niedriglastphasen (Einsparung)
  modul3KwhHoch: number;       // kWh Netzbezug in Hochlastphasen
  modul3KwhNiedrig: number;    // kWh Netzbezug in Niedriglastphasen
  modul3KwhStandard: number;   // kWh Netzbezug in Standardlastphasen (kein Effekt)
}

// On-the-fly-Berechnung der Tageskosten/-vergütung aus den Viertelstundenwerten
// und Spotpreisen des Tages. Für einen einzelnen Tag.
export function computeTagesKosten(date: string, s: Settings): TagesKosten {
  // Zeitversionierte Kostensätze: für den konkreten Tag gelten die Werte der zu
  // diesem Datum gültigen Periode (Stromtarif, §14a Modul 1/3, Wasserkosten).
  // Nicht versionierte Felder (Sharing-Modus …) kommen aus dem übergebenen s.
  const eff = db.effectiveSettings(date);
  s = { ...s, ...eff };
  const { von, bis } = db.dayBounds(date);
  const vs = db.getViertelstunden(von, bis);
  const spot = db.getSpotpreise(date)?.prices ?? null;

  let bezugskosten = 0;
  let verguetung = 0;
  let einsparung = 0;
  let einsparungPv = 0;
  let einsparungSpeicher = 0;
  let eigenKwhPv = 0;
  let eigenKwhSpeicher = 0;
  let bezogenKwh = 0;
  let eingespeistKwh = 0;
  let modul3Effekt = 0;
  let modul3EffektHoch = 0;
  let modul3EffektNiedrig = 0;
  let modul3KwhHoch = 0;
  let modul3KwhNiedrig = 0;
  let modul3KwhStandard = 0;
  const ustFaktor = 1 + s.umsatzsteuer / 100;
  for (const e of vs) {
    const idx = slotIndexFromEndTs(e.ts);
    const spotCt = spot && idx < spot.length ? spot[idx] : null;
    const slot = slotStartDate(e.ts);
    let bezugVs = e.bezogen * bezugspreisVS(s, slot, spotCt);
    bezogenKwh += e.bezogen;
    // §14a-Modul-3-Effekt: das zeitvariable Netzentgelt ist ein Netzentgelt-
    // Modell und gilt unabhängig vom Liefertarif, sobald es aktiv ist. Effekt =
    // Differenz des aktuell geltenden Netzentgelts zum Standard-Netzentgelt,
    // brutto, auf die bezogene Energie. Negativ in Niedriglastfenstern
    // (Einsparung), positiv in Hochlastfenstern (Aufschlag).
    //
    // Wichtig für die Kostenzuordnung ohne Doppelzählung:
    //  - dyn. Tarif: das zeitvariable Netzentgelt steckt bereits in
    //    bezugspreisVS (über netzentgeltCt), der Effekt ist also schon in den
    //    Bezugskosten enthalten – hier nur SEPARAT ausweisen, nicht addieren.
    //  - Fixtarif: bezugspreisVS liefert einen pauschalen Arbeitspreis ohne
    //    Netzentgelt-Variation. Der Effekt ist NICHT enthalten und wird daher
    //    zusätzlich zu den Bezugskosten ADDIERT (und ebenfalls separat gezeigt).
    if (s.paragraf14aAktiv) {
      const tarif = activeLastTarif(s, slot);
      const netzCt = tarif === "hoch" ? s.netzentgeltHoch
        : tarif === "niedrig" ? s.netzentgeltNiedrig
        : s.netzentgeltStandard;
      const diffCt = netzCt - s.netzentgeltStandard;
      const effektVs = (e.bezogen * diffCt * ustFaktor) / 100;
      modul3Effekt += effektVs;
      // Aufteilung des bezogenen Stroms und des Effekts nach Lastphase.
      if (tarif === "hoch") {
        modul3KwhHoch += e.bezogen;
        modul3EffektHoch += effektVs;
      } else if (tarif === "niedrig") {
        modul3KwhNiedrig += e.bezogen;
        modul3EffektNiedrig += effektVs;
      } else {
        modul3KwhStandard += e.bezogen;
      }
      if (s.tarifMode !== "dyn") bezugVs += effektVs;
    }
    bezugskosten += bezugVs;
    // Klassische Einspeisevergütung nur auf die Energie, die tatsächlich ins Netz
    // eingespeist wird. Der an §42c-Abnehmer gelieferte Anteil wird separat über
    // die §42c-Vergütung abgegolten und darf hier NICHT doppelt zählen.
    const anteil42c = (e.eingespeist42cPv ?? 0) + (e.eingespeist42cBatt ?? 0);
    const eingespeistNetto = Math.max(0, e.eingespeist - anteil42c);
    verguetung += eingespeistNetto * einspeiseVerguetungVS(s, spotCt);
    eingespeistKwh += eingespeistNetto;

    // Einsparung durch Eigenverbrauch (PV direkt + Speicher): für jede selbst
    // verbrauchte kWh spart man den Bezugspreis dieser Viertelstunde, gibt aber
    // die Einspeisevergütung auf, die man für dieselbe kWh bekommen hätte. Beide
    // Preise sind viertelstundengenau (dyn. Tarif) und berücksichtigen die
    // EEG-Regelung (keine Vergütung bei negativem Börsenpreis ab 25.02.2025).
    //
    // Der Term (Bezug − Vergütung) wird bei 0 geklemmt: Die Einsparung ist eine
    // rein theoretische Vergleichsgröße (die durch Eigenverbrauch vermiedenen
    // Bezugskosten), kein tatsächlicher Geldfluss. Bei stark negativen
    // Börsenpreisen (dyn. Tarif), wenn Beziehen vergütet würde, entsteht durch
    // Eigenverbrauch KEIN realer Verlust – man hätte lediglich noch mehr sparen
    // bzw. verdienen können. Diese entgangene Chance mindert die tatsächlich
    // vermiedenen Kosten nicht, daher fällt die Einsparung nie unter 0. Der reale
    // monetäre Vorteil negativer Preise schlägt sich stattdessen korrekt in den
    // Kosten (Bezugskosten/Saldo) nieder, wo Geld wirklich fließt.
    //
    // Aufgetrennt nach Herkunft: PV-Direktverbrauch und Speicher-Entladung. Der
    // spezifische Vorteil je kWh (bezug − verg, geklemmt) ist für beide identisch,
    // da er nur an der Viertelstunde hängt; die Mengen unterscheiden sich.
    const evPv = e.verbrauchPv ?? 0;
    const evSpeicher = e.verbrauchSpeicher ?? 0;
    const bezug = bezugspreisVS(s, slot, spotCt);
    const verg = einspeiseVerguetungVS(s, spotCt);
    const vorteilProKwh = Math.max(0, bezug - verg);
    einsparungPv += evPv * vorteilProKwh;
    einsparungSpeicher += evSpeicher * vorteilProKwh;
    eigenKwhPv += evPv;
    eigenKwhSpeicher += evSpeicher;
    einsparung += (evPv + evSpeicher) * vorteilProKwh;
  }

  // §42c-Vergütung: für die an Abnehmer gelieferte Energie zahle ich jedem
  // Abnehmer seinen vereinbarten Satz (€/kWh) auf den geteilten Anteil.
  let sharingVerguetung = 0;
  const abnehmer = db.loadAbnehmer();
  if (abnehmer.length > 0) {
    const satz: Record<string, number> = {};
    for (const a of abnehmer) satz[a.id] = a.verguetung ?? 0;
    const slots = computeSharingDay(date, abnehmer, s.sharingMode);
    for (const sl of slots) {
      for (const [id, h] of Object.entries(sl.haushalte)) {
        sharingVerguetung += h.geteilt * (satz[id] ?? 0);
      }
    }
  }

  // Reine Bezugs-Arbeitskosten (vor Fixkosten/Boni) für die Aufschlüsselung.
  const arbeitskosten = bezugskosten;

  // Monatliche Grundgebühr des Stromtarifs anteilig je Tag.
  const [jahr, monat, tag] = date.split("-").map(Number);
  const tageImMonat = new Date(jahr, monat, 0).getDate();
  const grundgebuehrAnteil = (s.grundgebuehrMonat ?? 0) / tageImMonat;

  // Jährliche Messstellen-Mehrkosten (mME/iMSys) anteilig je Tag. Schaltjahre
  // werden über die tatsächliche Tageszahl des Jahres berücksichtigt.
  const istSchaltjahr = (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
  const tageImJahr = istSchaltjahr ? 366 : 365;
  const messstelleAnteil = (s.messstelleEuroJahr ?? 0) / tageImJahr;

  // §14a Modul 1: pauschale jährliche Reduktion der Netzentgelte (Gutschrift).
  let modul1Anteil = 0;
  if (s.paragraf14aModul1Aktiv) {
    const pauschaleBrutto = (s.modul1PauschaleNetto ?? 0) * (1 + (s.umsatzsteuer ?? 0) / 100);
    modul1Anteil = -pauschaleBrutto / tageImJahr; // negativ = Gutschrift
  }

  // Boni: Sofort- und Neukundenbonus werden anteilig über die ersten 365 Tage
  // ab Lieferbeginn (= gueltigAb der zum Tag gültigen Stromtarif-Periode) als
  // Gutschrift verteilt. Außerhalb des ersten Belieferungsjahres kein Anteil.
  let sofortbonusAnteil = 0;
  let neukundenbonusAnteil = 0;
  const stPeriode = pickPeriode(db.loadStromtarifPerioden(), date);
  if (stPeriode) {
    const start = new Date(stPeriode.gueltigAb + "T00:00:00");
    const heute = new Date(`${date}T00:00:00`);
    const tageSeitStart = Math.floor((heute.getTime() - start.getTime()) / 86400000);
    if (tageSeitStart >= 0 && tageSeitStart < 365) {
      sofortbonusAnteil = -(s.sofortbonus ?? 0) / 365;       // negativ = Gutschrift
      neukundenbonusAnteil = -(s.neukundenbonus ?? 0) / 365;
    }
  }

  bezugskosten += grundgebuehrAnteil + messstelleAnteil + modul1Anteil
    + sofortbonusAnteil + neukundenbonusAnteil;

  return {
    bezugskosten,
    einspeiseverguetung: verguetung,
    sharingVerguetung,
    saldo: bezugskosten - verguetung - sharingVerguetung,
    einsparung,
    einsparungPv,
    einsparungSpeicher,
    eigenKwhPv,
    eigenKwhSpeicher,
    arbeitskosten,
    grundgebuehrAnteil,
    sofortbonusAnteil,
    neukundenbonusAnteil,
    messstelleAnteil,
    modul1Anteil,
    bezogenKwh,
    eingespeistKwh,
    modul3Effekt,
    modul3EffektHoch,
    modul3EffektNiedrig,
    modul3KwhHoch,
    modul3KwhNiedrig,
    modul3KwhStandard,
  };
}

// Ergebnis der Energy-Sharing-Wirtschaftlichkeitsanalyse für einen Tag.
export interface SharingAnalysis {
  date: string;
  geteiltKwh: number; // an §42c-Abnehmer gelieferte Energie (kWh)
  sharingErloes: number; // € Sharing-Erlös NUR des geteilten Anteils (Detail)
  klassischErloes: number; // € klassischer Erlös des geteilten Anteils (Detail)
  vorteil: number; // € Mehrerlös durch Energy Sharing (sharing − klassisch)
  // Gesamtbetrachtung über den KOMPLETTEN PV-Überschuss des Tages:
  ueberschussKwh: number; // gesamter Überschuss (ins Netz + an §42c) in kWh
  erloesOhneSharing: number; // € wenn alles klassisch eingespeist würde
  erloesMitSharing: number; // € mit Sharing (geteilt: Sharing-Satz, Rest: Einspeisung)
}

// Wirtschaftlichkeitsvergleich Energy Sharing vs. klassische Einspeisung.
// Zwei Sichten:
//  1. Detail (geteilter Anteil): dieselbe geteilte Energiemenge einmal mit dem
//     Sharing-Satz, einmal mit der Einspeisevergütung bewertet.
//  2. Gesamtbetrachtung: der KOMPLETTE PV-Überschuss des Tages (reguläre
//     Netzeinspeisung + an §42c-Abnehmer gelieferter Anteil) wird zweimal
//     bewertet – einmal als würde alles klassisch eingespeist (erloesOhneSharing),
//     einmal mit Sharing (geteilter Anteil zum Sharing-Satz, Rest zur
//     Einspeisevergütung, erloesMitSharing). So bezieht sich der Vorteil auf den
//     gesamten Überschuss und nicht nur auf den kleinen geteilten Ausschnitt –
//     der prozentuale Vorteil wird dadurch realistisch und variiert übers Jahr.
// Einspeisevergütung viertelstundengenau inkl. der Regel, dass bei negativem
// Börsenpreis (je nach EEG-Einstellung) keine EEG-Vergütung anfällt.
export function computeSharingAnalysis(date: string, s: Settings): SharingAnalysis {
  const spot = db.getSpotpreise(date)?.prices ?? null;
  const abnehmer = db.loadAbnehmer();

  let geteiltKwh = 0;
  let sharingErloes = 0;
  let klassischErloes = 0;

  if (abnehmer.length > 0) {
    const satz: Record<string, number> = {};
    for (const a of abnehmer) satz[a.id] = a.verguetung ?? 0;
    const slots = computeSharingDay(date, abnehmer, s.sharingMode);
    for (const sl of slots) {
      const idx = slotIndexFromEndTs(sl.ts);
      const spotCt = spot && idx >= 0 && idx < spot.length ? spot[idx] : null;
      const einspeise = einspeiseVerguetungVS(s, spotCt);
      for (const [id, h] of Object.entries(sl.haushalte)) {
        geteiltKwh += h.geteilt;
        sharingErloes += h.geteilt * (satz[id] ?? 0);
        klassischErloes += h.geteilt * einspeise;
      }
    }
  }

  // Gesamter PV-Überschuss des Tages und dessen klassische Bewertung.
  // Überschuss = reguläre Netzeinspeisung (eingespeist) + an §42c gelieferter
  // Anteil (eingespeist42cPv + eingespeist42cBatt). Jede Viertelstunde mit ihrer
  // eigenen Einspeisevergütung bewerten (Börsenpreis-abhängig).
  const { von, bis } = db.dayBounds(date);
  const vs = db.getViertelstunden(von, bis);
  let ueberschussKwh = 0;
  let erloesOhneSharing = 0;
  for (const e of vs) {
    const idx = slotIndexFromEndTs(e.ts);
    const spotCt = spot && idx >= 0 && idx < spot.length ? spot[idx] : null;
    const einspeise = einspeiseVerguetungVS(s, spotCt);
    const anteil42c = (e.eingespeist42cPv ?? 0) + (e.eingespeist42cBatt ?? 0);
    const slotUeberschuss = (e.eingespeist ?? 0) + anteil42c;
    ueberschussKwh += slotUeberschuss;
    erloesOhneSharing += slotUeberschuss * einspeise;
  }
  // Mit Sharing: der geteilte Anteil bringt den Sharing-Satz statt der
  // Einspeisevergütung; der Rest des Überschusses bleibt klassisch vergütet.
  // Das ist erloesOhneSharing + Vorteil des geteilten Anteils.
  const erloesMitSharing = erloesOhneSharing + (sharingErloes - klassischErloes);

  return {
    date,
    geteiltKwh,
    sharingErloes,
    klassischErloes,
    vorteil: sharingErloes - klassischErloes,
    ueberschussKwh,
    erloesOhneSharing,
    erloesMitSharing,
  };
}

// Vergleich der reinen Tagesbezugskosten (nur Netzbezug, OHNE Einspeisevergütung)
// zwischen Fixtarif und dynamischem Tarif – unabhängig davon, welcher Modus
// gerade eingestellt ist. Für jeden Tag werden beide Preisvarianten auf denselben
// viertelstundengenauen Netzbezug angewandt. Grundlage sind die zum Tag gültigen
// Perioden-Settings (effectiveSettings); überschrieben wird nur tarifMode.
export interface TagBezugVergleich {
  date: string;
  bezogenKwh: number;
  fix: number; // € reine Bezugskosten mit Fixtarif
  dyn: number; // € reine Bezugskosten mit dynamischem Tarif
}

export function computeTagBezugVergleich(date: string, base: Settings): TagBezugVergleich {
  const eff = db.effectiveSettings(date);
  const s = { ...base, ...eff };
  const sFix: Settings = { ...s, tarifMode: "fix" };
  const sDyn: Settings = { ...s, tarifMode: "dyn" };
  const { von, bis } = db.dayBounds(date);
  const vs = db.getViertelstunden(von, bis);
  const spot = db.getSpotpreise(date)?.prices ?? null;

  let bezogenKwh = 0;
  let fix = 0;
  let dyn = 0;
  for (const e of vs) {
    const idx = slotIndexFromEndTs(e.ts);
    const spotCt = spot && idx < spot.length ? spot[idx] : null;
    const slot = slotStartDate(e.ts);
    bezogenKwh += e.bezogen;
    fix += e.bezogen * bezugspreisVS(sFix, slot, spotCt);
    dyn += e.bezogen * bezugspreisVS(sDyn, slot, spotCt);
  }
  return { date, bezogenKwh, fix, dyn };
}
