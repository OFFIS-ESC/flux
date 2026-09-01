// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Statistik zum dynamischen Börsenstrompreis, insbesondere zu negativen Preisen.
// Alle Kennzahlen werden selbstständig aus den gespeicherten Spotpreisen
// (Tabelle spotpreise, in ct/kWh) berechnet – keine Abfrage externer Seiten.
//
// Zeitauflösung: Der deutsche Day-Ahead-Markt lieferte bis 30.09.2025 STÜNDLICHE
// Preise (24 Werte/Tag); seit 01.10.2025 gibt es VIERTELSTÜNDLICHE Produkte
// (96 Werte/Tag). Damit alle Jahre einheitlich und vergleichbar ausgewertet
// werden, werden stündliche Tage intern auf 96 Viertelstunden normalisiert
// (jeder Stundenwert gilt für seine vier Viertelstunden – bei Stundenprodukten
// ist der Preis innerhalb der Stunde konstant). So bleiben negative Stunden,
// Spread und Durchschnitt über die Jahre konsistent.
//
// Methodik (analog zur üblichen Zählweise, u. a. SMARD/Bundesnetzagentur):
//   - "Negative Stunde" = Anzahl der Viertelstunden mit Preis < 0, geteilt durch 4.
//   - Tagesspread = höchster minus niedrigster Preis eines Tages.
//   - Preise in ct/kWh.
import * as db from "./db.js";
import { netzentgeltCt } from "./costs.js";

// Erkennt die Zeitauflösung eines Tages und liefert die Viertelstunden-
// Darstellung. Behandelt auch Tage mit Zeitumstellung (DST):
//   - stündlich normal: 24 Werte  -> je ×4  = 96 Slots
//   - stündlich Frühjahr (23 h):   23 Werte -> je ×4  = 92 Slots
//   - stündlich Herbst (25 h):     25 Werte -> je ×4  = 100 Slots
//   - viertelstündlich normal:     96 Werte
//   - viertelstündlich Frühjahr:   92 Werte
//   - viertelstündlich Herbst:     100 Werte
// Rückgabe: Array in Viertelstunden-Auflösung (Länge 92/96/100), oder null,
// wenn die Länge zu keinem bekannten Muster passt (unvollständiger Tag).
//
// Für die Kennzahlen ist die native Länge ausreichend und korrekt: negative
// Stunden = (Anzahl negativer Viertelstunden) / 4 gilt unabhängig davon, ob der
// Tag 92, 96 oder 100 Slots hat. Downstream muss daher NICHT auf exakt 96
// normiert werden – die Schleifen laufen über prices.length.
function toQuarterHours(prices: number[]): number[] | null {
  const n = prices.length;
  // Viertelstündlich (inkl. DST): 92, 96, 100 direkt übernehmen.
  if (n === 96 || n === 92 || n === 100) return prices;
  // Stündlich (inkl. DST): 23, 24, 25 -> jeder Wert ×4.
  if (n === 24 || n === 23 || n === 25) {
    const out: number[] = [];
    for (const p of prices) out.push(p, p, p, p);
    return out;
  }
  return null;
}

// Rückwärtskompatibler Name; liefert jetzt Viertelstunden variabler Länge.
function to96(prices: number[]): number[] | null {
  return toQuarterHours(prices);
}

// Prüft, ob ein Tag verwertbar ist (bekannte stündliche oder viertelstündliche
// Länge, inkl. der DST-Sonderfälle 23/25 bzw. 92/100).
function usableDay(prices: number[]): boolean {
  const n = prices.length;
  return n === 96 || n === 92 || n === 100 || n === 24 || n === 23 || n === 25;
}


export interface BoersenStatistik {
  jahr: number;
  tageMitDaten: number;
  // Kennzahlen (kumuliert über alle vorhandenen Tage)
  negStundenGesamt: number;      // Summe negativer Stunden
  negViertelstundenGesamt: number;
  negStundenHeute: number;
  nullStundenGesamt: number;     // Stunden mit Preis exakt 0
  nullViertelstundenGesamt: number;
  tiefstpreis: number;           // niedrigster je aufgetretener Preis (ct/kWh)
  tiefstpreisDatum: string | null;
  hoechstpreis: number;
  hoechstpreisDatum: string | null;
  durchschnittspreis: number;    // Mittel über alle Viertelstunden (netto, Day-Ahead)
  durchschnittspreisBrutto: number; // Ø Endkunden-Gesamtpreis brutto (ct/kWh, inkl. §14a Modul 3)
  avgTagesspread: number;        // mittlerer Tages-Spread
  maxTagesspread: number;
  maxTagesspreadDatum: string | null;
  anteilNegProzent: number;      // Anteil negativer Viertelstunden an allen

  // kumulativer Verlauf der negativen Stunden über das Jahr
  kumulativ: Array<{ date: string; negStundenTag: number; kumuliert: number }>;
  // Verteilung negativer Viertelstunden über die 24 Tagesstunden
  stundenVerteilung: number[];   // Länge 24: Anzahl negativer Viertelstunden je Stunde
  // Verteilung negativer Viertelstunden über die Wochentage (Mo..So)
  wochentagVerteilung: number[]; // Länge 7: Mo=0 .. So=6
  // negative Stunden je Monat
  proMonat: Array<{ monat: string; negStunden: number }>;
  // Täglicher Preisspread (Höchst- minus Tiefstpreis) je Tag
  spreadProTag: Array<{ date: string; spread: number }>;
  // Heatmap: je Tag EINE Zelle mit Anzahl negativer Viertelstunden des Tages,
  // angeordnet als Wochen (Spalten) × Wochentage (Zeilen Mo..So).
  heatmap: Array<{ date: string; woche: number; wochentag: number; negVs: number }>;
  // Gesamtzahl der Wochenspalten des Zieljahres (damit die Heatmap immer das ganze
  // Jahr aufspannt, auch wenn die letzten Wochen keine Daten haben).
  heatmapWochen: number;
}

// Kompakte Kennzahlen eines Kalenderjahres für die Jahresvergleichs-Tabelle.
export interface JahresKennzahlen {
  jahr: number;
  tageMitDaten: number;
  negStunden: number;
  nullStunden: number;
  tiefstpreis: number;
  hoechstpreis: number;
  durchschnittspreis: number;
  avgTagesspread: number;
  maxTagesspread: number;
  anteilNegProzent: number;
  // Anteil der Stunden mit Preis <= 0 (negativ ODER null) am Jahr, in Prozent.
  anteilNullOderNegProzent: number;
}

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Liste aller Kalenderjahre, für die Spotpreis-Daten vorliegen (aufsteigend).
export function verfuegbareJahre(): number[] {
  const set = new Set<number>();
  for (const t of db.getAllSpotpreise()) {
    if (usableDay(t.prices)) set.add(Number(t.date.slice(0, 4)));
  }
  return [...set].sort((a, b) => a - b);
}

export function computeBoersenStatistik(jahrParam?: number): BoersenStatistik {
  // Standardjahr: das jüngste Jahr mit Daten (sonst aktuelles Jahr).
  const jahre = verfuegbareJahre();
  const zieljahr = jahrParam ?? (jahre.length ? jahre[jahre.length - 1] : new Date().getFullYear());
  const tage = db
    .getAllSpotpreise()
    .filter((t) => usableDay(t.prices) && Number(t.date.slice(0, 4)) === zieljahr);

  const kumulativ: BoersenStatistik["kumulativ"] = [];
  const stundenVerteilung = new Array(24).fill(0);
  const wochentagVerteilung = new Array(7).fill(0); // Mo..So
  const monatsMap = new Map<string, number>(); // "YYYY-MM" -> negVs
  const spreadProTag: BoersenStatistik["spreadProTag"] = [];
  const heatmap: BoersenStatistik["heatmap"] = [];

  let negVsGesamt = 0;
  let nullVsGesamt = 0;
  let alleVsSumme = 0, alleVsCount = 0;
  // Brutto-Gesamtpreis (ct/kWh) je Viertelstunde aufsummieren, exakt wie im
  // Tagespreisverlauf-Chart: Börsenpreis + feste Bestandteile + Netzentgelt
  // (zeit-/quartalsabhängig bei §14a inkl. Modul 3), dann Umsatzsteuer. So zeigt
  // die KPI-Kachel „Ø Gesamtpreis (brutto)" den vollen Endkundenpreis.
  const s = db.loadSettings();
  const bestandteileOhneNetz =
    s.beschaffung + s.stromsteuer + s.konzessionsabgabe +
    s.aufschlagNetznutzung + s.offshoreUmlage + s.kwkgUmlage;
  let bruttoSumme = 0, bruttoCount = 0;
  let tiefst = Infinity, tiefstDatum: string | null = null;
  let hoechst = -Infinity, hoechstDatum: string | null = null;
  let spreadSumme = 0, maxSpread = -Infinity, maxSpreadDatum: string | null = null;
  let kum = 0;

  const heute = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const heuteStr = `${heute.getFullYear()}-${p2(heute.getMonth() + 1)}-${p2(heute.getDate())}`;
  let negStundenHeute = 0;

  // Referenz für die Heatmap-Wochenspalte: Montag der Woche des 1. Januar des
  // Zieljahres. So spannt die Heatmap immer das GANZE Jahr auf (KW1..KW52/53);
  // Tage ohne Daten und in der Zukunft liegende Tage erscheinen schlicht als
  // Lücke (keine Zelle) – genau wie gewünscht, ohne vertikale Streckung.
  const mondayIndex = (d: Date) => (d.getDay() + 6) % 7; // So(0)->6, Mo(1)->0 ...
  const jahresStart = new Date(`${zieljahr}-01-01T00:00:00`);
  const wocheBasis: Date = new Date(jahresStart);
  wocheBasis.setDate(jahresStart.getDate() - mondayIndex(jahresStart)); // Montag der KW1

  for (const t of tage) {
    const prices = to96(t.prices);
    if (!prices) continue;
    const dObj = new Date(t.date + "T00:00:00");
    const wt = mondayIndex(dObj); // 0=Mo..6=So
    let negVsTag = 0;
    let tagMin = Infinity, tagMax = -Infinity;

    const len = prices.length;
    for (let i = 0; i < len; i++) {
      const preis = prices[i];
      // Stunden-Index (0..23) für die Stundenverteilung. Bei DST-Tagen mit 92
      // oder 100 Slots die Position relativ auf 24 Stunden abbilden, damit der
      // Index im Bereich 0..23 bleibt.
      const stunde = Math.min(23, Math.floor((i / len) * 24));
      alleVsSumme += preis; alleVsCount++;
      // Brutto-Gesamtpreis dieser Viertelstunde (ct/kWh) für den Ø-Bruttowert.
      // Slot-Zeitpunkt für das §14a-abhängige Netzentgelt: Tagesbeginn + i·Slot.
      const slotMin = len <= 26 ? 60 : 15;
      const slotZeit = new Date(dObj.getTime() + i * slotMin * 60 * 1000);
      const bruttoCt = (preis + bestandteileOhneNetz + netzentgeltCt(s, slotZeit)) * (1 + s.umsatzsteuer / 100);
      bruttoSumme += bruttoCt; bruttoCount++;
      if (preis < tagMin) tagMin = preis;
      if (preis > tagMax) tagMax = preis;
      if (preis < tiefst) { tiefst = preis; tiefstDatum = t.date; }
      if (preis > hoechst) { hoechst = preis; hoechstDatum = t.date; }
      if (preis < 0) {
        negVsTag++;
        stundenVerteilung[stunde]++;
        wochentagVerteilung[wt]++;
      } else if (preis === 0) {
        nullVsGesamt++;
      }
    }

    negVsGesamt += negVsTag;
    const negStundenTag = negVsTag / 4;
    kum += negStundenTag;
    kumulativ.push({ date: t.date, negStundenTag, kumuliert: +kum.toFixed(2) });

    const monKey = t.date.slice(0, 7);
    monatsMap.set(monKey, (monatsMap.get(monKey) ?? 0) + negVsTag);

    // Heatmap-Position: Wochenindex relativ zur Basiswoche.
    let woche = 0;
    if (wocheBasis) {
      const diffDays = Math.round((dObj.getTime() - wocheBasis.getTime()) / 86400000);
      woche = Math.floor(diffDays / 7);
    }
    heatmap.push({ date: t.date, woche, wochentag: wt, negVs: negVsTag });

    const spread = tagMax - tagMin;
    spreadProTag.push({ date: t.date, spread: +spread.toFixed(2) });
    spreadSumme += spread;
    if (spread > maxSpread) { maxSpread = spread; maxSpreadDatum = t.date; }

    if (t.date === heuteStr) negStundenHeute = negStundenTag;
  }

  const proMonat = [...monatsMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, negVs]) => {
      const m = Number(k.slice(5, 7));
      return { monat: `${MONATE[m - 1]} ${k.slice(0, 4)}`, negStunden: +(negVs / 4).toFixed(2) };
    });

  const n = tage.length;
  return {
    jahr: zieljahr,
    tageMitDaten: n,
    negStundenGesamt: +(negVsGesamt / 4).toFixed(2),
    negViertelstundenGesamt: negVsGesamt,
    negStundenHeute: +negStundenHeute.toFixed(2),
    nullStundenGesamt: +(nullVsGesamt / 4).toFixed(2),
    nullViertelstundenGesamt: nullVsGesamt,
    tiefstpreis: isFinite(tiefst) ? +tiefst.toFixed(2) : 0,
    tiefstpreisDatum: tiefstDatum,
    hoechstpreis: isFinite(hoechst) ? +hoechst.toFixed(2) : 0,
    hoechstpreisDatum: hoechstDatum,
    durchschnittspreis: alleVsCount ? +(alleVsSumme / alleVsCount).toFixed(2) : 0,
    durchschnittspreisBrutto: bruttoCount ? +(bruttoSumme / bruttoCount).toFixed(2) : 0,
    avgTagesspread: n ? +(spreadSumme / n).toFixed(2) : 0,
    maxTagesspread: isFinite(maxSpread) ? +maxSpread.toFixed(2) : 0,
    maxTagesspreadDatum: maxSpreadDatum,
    anteilNegProzent: alleVsCount ? +((negVsGesamt / alleVsCount) * 100).toFixed(2) : 0,
    kumulativ,
    stundenVerteilung,
    wochentagVerteilung,
    spreadProTag,
    proMonat,
    heatmap,
    heatmapWochen: (() => {
      const jahresEnde = new Date(`${zieljahr}-12-31T00:00:00`);
      const diffDays = Math.round((jahresEnde.getTime() - wocheBasis.getTime()) / 86400000);
      return Math.floor(diffDays / 7) + 1;
    })(),
  };
}

// Jahresvergleich: für jedes Kalenderjahr mit Daten die Kernkennzahlen. Wird für
// die Vergleichstabelle unten auf der Börsenseite genutzt (unabhängig von der
// Jahresauswahl der übrigen Seite). Nur Jahre ab minYear werden berücksichtigt.
export function computeJahresvergleich(minYear = 2020): JahresKennzahlen[] {
  // Alle Tage einmal laden und nach Jahr gruppieren (effizienter als je Jahr neu).
  const perYear = new Map<number, Array<{ date: string; prices: number[] }>>();
  for (const t of db.getAllSpotpreise()) {
    if (!usableDay(t.prices)) continue;
    const y = Number(t.date.slice(0, 4));
    if (y < minYear) continue;
    if (!perYear.has(y)) perYear.set(y, []);
    perYear.get(y)!.push(t);
  }

  const out: JahresKennzahlen[] = [];
  for (const [jahr, tage] of [...perYear.entries()].sort((a, b) => a[0] - b[0])) {
    let negVs = 0, nullVs = 0, sum = 0, cnt = 0;
    let tiefst = Infinity, hoechst = -Infinity;
    let spreadSum = 0, maxSpread = -Infinity;
    let tageCount = 0;
    for (const t of tage) {
      const prices = to96(t.prices);
      if (!prices) continue;
      tageCount++;
      let tagMin = Infinity, tagMax = -Infinity;
      const len = prices.length;
      for (let i = 0; i < len; i++) {
        const p = prices[i];
        sum += p; cnt++;
        if (p < tagMin) tagMin = p;
        if (p > tagMax) tagMax = p;
        if (p < tiefst) tiefst = p;
        if (p > hoechst) hoechst = p;
        if (p < 0) negVs++;
        else if (p === 0) nullVs++;
      }
      const spread = tagMax - tagMin;
      spreadSum += spread;
      if (spread > maxSpread) maxSpread = spread;
    }
    const n = tageCount;
    out.push({
      jahr,
      tageMitDaten: n,
      negStunden: +(negVs / 4).toFixed(2),
      nullStunden: +(nullVs / 4).toFixed(2),
      tiefstpreis: isFinite(tiefst) ? +tiefst.toFixed(2) : 0,
      hoechstpreis: isFinite(hoechst) ? +hoechst.toFixed(2) : 0,
      durchschnittspreis: cnt ? +(sum / cnt).toFixed(2) : 0,
      avgTagesspread: n ? +(spreadSum / n).toFixed(2) : 0,
      maxTagesspread: isFinite(maxSpread) ? +maxSpread.toFixed(2) : 0,
      anteilNegProzent: cnt ? +((negVs / cnt) * 100).toFixed(2) : 0,
      anteilNullOderNegProzent: cnt ? +(((negVs + nullVs) / cnt) * 100).toFixed(2) : 0,
    });
  }
  return out;
}
