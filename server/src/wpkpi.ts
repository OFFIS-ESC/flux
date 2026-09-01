// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Wärmepumpen-Kennzahlen (KPI).
//
// Strategie: Pro Kalendertag werden die KPIs EINMAL aus den feingranularen
// wp_data-Rohdaten (plus 15-min-Bilanzdaten für Energie/PV) berechnet und in
// wp_kpi_tag persistiert. Die Auswertung beliebiger Zeiträume aggregiert dann
// nur noch die Tagessätze – das ist schnell und skaliert über einen ganzen
// Winter. Zählungen, die über den Tageswechsel laufen (Kompressortakte,
// Abtauungen), werden robust behandelt, indem der Zustand am Tagesende
// gespeichert und beim Folgetag berücksichtigt wird.

import * as db from "./db.js";

// Findet die Wärmepumpen-Quelle (deviceType heatpump).
function findWpSource() {
  return db.loadSources().find((s) => s.deviceType === "heatpump");
}

// Reihen-Labels (wie in sources.ts definiert).
const L_HEIZ = "Heizleistung";        // W (thermische Heizleistung)
const L_KOMP = "Kompressorfrequenz";  // Hz (>0 = Kompressor läuft)
const L_ABTAU = "Abtauung";           // 0/1
const L_MODUS = "_ModusCode";         // 1=Heiz, 2=WW, 3=Kühl
const L_ELEKT = "_ElektrischW";       // W (elektrische Leistungsaufnahme, Shelly)

const STANDBY_W = 20; // Leistungsaufnahme darunter gilt als Standby

export interface WpKpi {
  kompressorH: number;
  heizH: number;
  wwH: number;
  energieKwh: number;
  energieStandbyKwh: number;
  // Elektrischer Energiebedarf je Betriebsart – direkt bei der Integration nach
  // dem gleichzeitig aktiven Betriebsmodus getrennt (nicht anteilig geschätzt).
  energieHeizKwh: number;
  energieWwKwh: number;
  energieKuehlKwh: number;
  waermeKwh: number;
  // Abgegebene thermische Energie je Betriebsart (Heizen/Warmwasser = Wärme,
  // Kühlen = Kälte), aus der Heizleistung nach gleichzeitigem Modus getrennt.
  waermeHeizKwh: number;
  waermeWwKwh: number;
  kaelteKwh: number;
  takte: number;
  abtauungen: number;
  pvKwh: number;
}

export interface WpKpiTagRow extends WpKpi {
  tag: string;
  endKompLief: number;
  endAbtau: number;
}

// Berechnet die KPIs für EINEN Kalendertag aus den Rohdaten.
// prevEndKompLief/prevEndAbtau: Zustand am Ende des Vortags (für Zählung über
// Mitternacht – ein Takt/eine Abtauung, die um 23:59 begann, wird nicht am
// Folgetag erneut gezählt).
export function computeWpKpiForDay(
  tag: string,
  prevEndKompLief = 0,
  prevEndAbtau = 0
): WpKpiTagRow {
  const von = `${tag}T00:00:00`;
  const bis = `${tag}T23:59:59`;
  const rows = db.getWpData(von, bis); // {ts,label,value} chronologisch
  // Elektrische Leistung liegt in einer eigenen, dichten Reihe (entkoppelt, weil
  // der Messwert fast bei jedem Poll leicht schwankt). Wird separat integriert
  // und dabei dem zuletzt bekannten Betriebszustand (Modus/Kompressor) zugeordnet.
  const powerRows = db.getWpPower(von, bis); // {ts,value} chronologisch

  // Rohdaten je Zeitpunkt gruppieren (ts -> {label: value}).
  const byTs = new Map<string, Record<string, number>>();
  for (const r of rows) {
    let o = byTs.get(r.ts);
    if (!o) { o = {}; byTs.set(r.ts, o); }
    o[r.label] = r.value;
  }
  const times = Array.from(byTs.keys()).sort();

  let kompressorSec = 0, heizSec = 0, wwSec = 0, waermeWh = 0;
  let waermeHeizWh = 0, waermeWwWh = 0, kaelteWh = 0;
  let takte = 0, abtauungen = 0;
  let kompLief = prevEndKompLief === 1;
  let abtauAktiv = prevEndAbtau === 1;
  // Elektrische Energie (Wh), direkt aus der feinen Leistungsreihe _ElektrischW
  // integriert und nach dem gleichzeitig aktiven Betriebsmodus getrennt.
  let elGesamtWh = 0, elHeizWh = 0, elWwWh = 0, elKuehlWh = 0, elStandbyWh = 0;
  let hatElektrisch = false;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const cur = byTs.get(t)!;
    const komp = cur[L_KOMP] ?? 0;      // Hz
    const heiz = cur[L_HEIZ] ?? 0;      // W
    const abtau = (cur[L_ABTAU] ?? 0) >= 0.5;
    const modus = cur[L_MODUS];         // 1/2/3 oder undefined
    const laeuftJetzt = komp > 0;

    // Takt-/Abtau-Zählung immer an der Flanke (aus→an), unabhängig vom Sample-Raster.
    if (laeuftJetzt && !kompLief) takte++;
    if (abtau && !abtauAktiv) abtauungen++;

    // Integration über das Intervall [t, t_next]. Ein Intervall zählt als
    // Kompressor-Laufzeit, wenn BEIDE Endpunkte laufen (Kernlaufzeit). Das
    // unterschätzt jede Flanke um ein halbes Intervall, Start- und Endflanke
    // heben sich über einen Lauf hinweg aber gegenseitig auf – anders als eine
    // einseitige Endpunkt-Betrachtung, die systematisch über- oder unterschätzt.
    // Für die Wärmemenge wird das Trapez (Mittel der Heizleistung) integriert.
    if (i + 1 < times.length) {
      const dtSec = Math.min(300, Math.max(0, (Date.parse(times[i + 1]) - Date.parse(t)) / 1000));
      const next = byTs.get(times[i + 1])!;
      const kompNext = (next[L_KOMP] ?? 0) > 0;
      const heizNext = next[L_HEIZ] ?? 0;
      if (laeuftJetzt && kompNext) {
        kompressorSec += dtSec;
        // Betriebsart nach dem aktuellen Sample (Beginn des Intervalls):
        //   Modus 2 = Warmwasser, Modus 3 = Kühlen (fällt in die Restgröße und
        //   wird NICHT zu Heizen gezählt), sonst (Modus 1 oder ohne Moduscode in
        //   Altdaten) = Heizen.
        if (modus === 2) wwSec += dtSec;
        else if (modus === 3) { /* Kühlen: Restgröße, weder heiz noch ww */ }
        else heizSec += dtSec;
      }
      // Wärme-/Kältemenge: Trapez-Integration der (thermischen) Heizleistung
      // (W) -> Wh, getrennt nach Betriebsmodus zu Intervallbeginn. Bei Kühlen
      // (Modus 3) wird die abgegebene Leistung als Kälte gewertet.
      const pMittel = (heiz + heizNext) / 2;
      if (pMittel > 0) {
        const wh = pMittel * (dtSec / 3600);
        waermeWh += wh;
        if (modus === 3) kaelteWh += wh;
        else if (modus === 2) waermeWwWh += wh;
        else waermeHeizWh += wh;
      }
    }

    kompLief = laeuftJetzt;
    abtauAktiv = abtau;
  }

  // --- Elektrische Energie aus der separaten Leistungsreihe (wp_power) ---
  // Trapez-Integration der Leistungsaufnahme (W) -> Wh, jedem Intervall nach dem
  // zuletzt bekannten Betriebszustand zugeordnet (Modus + Kompressor an/aus). Der
  // Zustand stammt aus der wp_data-Reihe; ein Moduswechsel ist spätestens im
  // nächsten 5-s-Sample bekannt, sodass die Zuordnung höchstens um ein Intervall
  // verzögert ist (energetisch vernachlässigbar). Standby = Kompressor aus UND
  // Leistung unter der Standby-Schwelle.
  if (powerRows.length > 0) hatElektrisch = true;
  // Zustandsabfrage: zu einem Zeitstempel den zuletzt gültigen Modus/Kompressor
  // liefern (letzter Zustands-Sample <= ts). times/byTs sind chronologisch.
  let zIdx = 0;
  const zustandBei = (tsMs: number): { modus: number | undefined; laeuft: boolean } => {
    while (zIdx + 1 < times.length && Date.parse(times[zIdx + 1]) <= tsMs) zIdx++;
    // zIdx zeigt auf den letzten Zustand <= tsMs (oder den ersten, falls tsMs davor).
    const o = byTs.get(times[zIdx]);
    if (!o) return { modus: undefined, laeuft: false };
    return { modus: o[L_MODUS], laeuft: (o[L_KOMP] ?? 0) > 0 };
  };
  for (let i = 0; i + 1 < powerRows.length; i++) {
    const tMs = Date.parse(powerRows[i].ts);
    const tNextMs = Date.parse(powerRows[i + 1].ts);
    const dtSec = Math.min(300, Math.max(0, (tNextMs - tMs) / 1000));
    if (dtSec <= 0) continue;
    const pMittel = (powerRows[i].value + powerRows[i + 1].value) / 2;
    const wh = pMittel * (dtSec / 3600);
    elGesamtWh += wh;
    const { modus, laeuft } = zustandBei(tMs);
    if (!laeuft && pMittel < STANDBY_W) elStandbyWh += wh;
    else if (laeuft && modus === 2) elWwWh += wh;
    else if (laeuft && modus === 3) elKuehlWh += wh;
    else if (laeuft) elHeizWh += wh;
    // (Läuft nicht, aber über Standby-Schwelle: Hilfsaggregate/Umwälzung – zählt
    //  zu Gesamt, aber keiner Betriebsart. Bewusst nicht zugeordnet.)
  }

  // Energiebedarf + PV-Abdeckung.
  // Bevorzugt wird die aus der feinen _ElektrischW-Reihe integrierte Energie
  // (modusgenau). Fehlt sie (Altdaten ohne diese Reihe), wird als Rückfall die
  // grobe 15-Minuten-Bilanz herangezogen (dann ohne Modustrennung).
  const wp = findWpSource();
  let energieKwh = 0, energieStandbyKwh = 0, pvKwh = 0;
  let energieHeizKwh = 0, energieWwKwh = 0, energieKuehlKwh = 0;
  if (hatElektrisch) {
    energieKwh = elGesamtWh / 1000;
    energieStandbyKwh = elStandbyWh / 1000;
    energieHeizKwh = elHeizWh / 1000;
    energieWwKwh = elWwWh / 1000;
    energieKuehlKwh = elKuehlWh / 1000;
  } else if (wp) {
    const vs = db.getConsumerViertelstunden(wp.id, von, bis);
    for (const q of vs) energieKwh += q.verbrauch;
    for (const q of vs) {
      const avgW = q.verbrauch * 4000;
      if (avgW > 0 && avgW < STANDBY_W) energieStandbyKwh += q.verbrauch;
    }
  }
  if (wp) {
    // PV-Abdeckung: PV vorrangig allen ANDEREN Verbrauchern zurechnen; nur der
    // Überschuss deckt die WP. Speicher bleibt außen vor. Aus 15-min-Slots.
    pvKwh = pvAbdeckungKwh(wp.id, von, bis);
  }

  return {
    tag,
    kompressorH: kompressorSec / 3600,
    heizH: heizSec / 3600,
    wwH: wwSec / 3600,
    energieKwh,
    energieStandbyKwh,
    energieHeizKwh,
    energieWwKwh,
    energieKuehlKwh,
    waermeKwh: waermeWh / 1000,
    waermeHeizKwh: waermeHeizWh / 1000,
    waermeWwKwh: waermeWwWh / 1000,
    kaelteKwh: kaelteWh / 1000,
    takte,
    abtauungen,
    pvKwh,
    endKompLief: kompLief ? 1 : 0,
    endAbtau: abtauAktiv ? 1 : 0,
  };
}

// PV-Abdeckung der WP über 15-min-Slots. PV geht vorrangig an alle anderen
// Verbraucher; nur der Rest deckt die WP (ohne Speicher).
function pvAbdeckungKwh(wpId: string, von: string, bis: string): number {
  // PV-Erzeugung je Slot (Summe aller PV-Quellen).
  const pvRows = db.getPvViertelstundenAlle(von, bis); // {ts, kwh} summiert
  const pvBySlot = new Map<string, number>();
  for (const r of pvRows) {
    pvBySlot.set(r.ts, (pvBySlot.get(r.ts) ?? 0) + r.kwh);
  }
  // Gesamtverbrauch je Slot (alle Consumer) und WP-Verbrauch je Slot.
  const allCons = db.getConsumerViertelstundenAlle(von, bis); // {ts, consumer, verbrauch}
  const gesamtBySlot = new Map<string, number>();
  const wpBySlot = new Map<string, number>();
  for (const r of allCons) {
    gesamtBySlot.set(r.ts, (gesamtBySlot.get(r.ts) ?? 0) + r.verbrauch);
    if (r.consumer === wpId) wpBySlot.set(r.ts, (wpBySlot.get(r.ts) ?? 0) + r.verbrauch);
  }
  let pvWp = 0;
  for (const [ts, wpV] of wpBySlot) {
    if (wpV <= 0) continue;
    const pv = pvBySlot.get(ts) ?? 0;
    const andere = Math.max(0, (gesamtBySlot.get(ts) ?? 0) - wpV);
    const pvRest = Math.max(0, pv - andere);
    pvWp += Math.min(wpV, pvRest);
  }
  return pvWp;
}

// Persistiert die KPIs eines Tages (Tagesabschluss). Holt den Endzustand des
// Vortags für robuste Zählung über Mitternacht.
export function persistWpKpiForDay(tag: string): WpKpiTagRow {
  const prev = db.getWpKpiTag(vortag(tag));
  const kpi = computeWpKpiForDay(tag, prev?.endKompLief ?? 0, prev?.endAbtau ?? 0);
  db.saveWpKpiTag(kpi);
  return kpi;
}

function vortag(tag: string): string {
  const d = new Date(`${tag}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Aggregiert die KPIs über einen Zeitraum [vonTag, bisTag] (inklusive) aus den
// persistierten Tagessätzen. Fehlende Tage (noch nicht aggregiert, z.B. der
// laufende Tag) werden on-the-fly berechnet, aber nicht gespeichert.
export function aggregateWpKpi(vonTag: string, bisTag: string): WpKpi & { tage: number } {
  const rows = db.getWpKpiRange(vonTag, bisTag);
  const have = new Set(rows.map((r) => r.tag));
  const acc: WpKpi = {
    kompressorH: 0, heizH: 0, wwH: 0, energieKwh: 0, energieStandbyKwh: 0,
    energieHeizKwh: 0, energieWwKwh: 0, energieKuehlKwh: 0,
    waermeKwh: 0, waermeHeizKwh: 0, waermeWwKwh: 0, kaelteKwh: 0,
    takte: 0, abtauungen: 0, pvKwh: 0,
  };
  let tage = 0;
  const add = (k: WpKpi) => {
    acc.kompressorH += k.kompressorH; acc.heizH += k.heizH; acc.wwH += k.wwH;
    acc.energieKwh += k.energieKwh; acc.energieStandbyKwh += k.energieStandbyKwh;
    acc.energieHeizKwh += k.energieHeizKwh ?? 0; acc.energieWwKwh += k.energieWwKwh ?? 0;
    acc.energieKuehlKwh += k.energieKuehlKwh ?? 0;
    acc.waermeKwh += k.waermeKwh;
    acc.waermeHeizKwh += k.waermeHeizKwh ?? 0; acc.waermeWwKwh += k.waermeWwKwh ?? 0;
    acc.kaelteKwh += k.kaelteKwh ?? 0;
    acc.takte += k.takte; acc.abtauungen += k.abtauungen;
    acc.pvKwh += k.pvKwh;
  };
  for (const r of rows) { add(r); tage++; }
  // Fehlende Tage im Bereich (v.a. der heutige, noch nicht abgeschlossene Tag)
  // live berechnen.
  for (const t of eachDay(vonTag, bisTag)) {
    if (have.has(t)) continue;
    const prev = db.getWpKpiTag(vortag(t));
    const live = computeWpKpiForDay(t, prev?.endKompLief ?? 0, prev?.endAbtau ?? 0);
    // nur zählen, wenn an dem Tag überhaupt Daten existieren
    if (live.kompressorH > 0 || live.energieKwh > 0 || live.waermeKwh > 0) {
      add(live); tage++;
    }
  }
  return { ...acc, tage };
}

function eachDay(vonTag: string, bisTag: string): string[] {
  const out: string[] = [];
  const d = new Date(`${vonTag}T12:00:00`);
  const end = new Date(`${bisTag}T12:00:00`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}

// Liefert die einzelnen Tages-KPI-Sätze im Zeitraum (persistierte plus live
// berechnete für noch nicht abgeschlossene Tage). Für Auswertungen, die die
// Tagesauflösung brauchen (z.B. Warmwasser-Erzeugungstage).
export function aggregateWpKpiRaw(vonTag: string, bisTag: string): WpKpiTagRow[] {
  const rows = db.getWpKpiRange(vonTag, bisTag) as WpKpiTagRow[];
  const have = new Set(rows.map((r) => r.tag));
  const out: WpKpiTagRow[] = [...rows];
  for (const t of eachDay(vonTag, bisTag)) {
    if (have.has(t)) continue;
    const prev = db.getWpKpiTag(vortag(t));
    const live = computeWpKpiForDay(t, prev?.endKompLief ?? 0, prev?.endAbtau ?? 0);
    if (live.kompressorH > 0 || live.energieKwh > 0 || live.waermeKwh > 0) out.push(live);
  }
  return out;
}
