// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Warmwasser-Kennzahlen (KPI).
//
// Es gibt drei Arten der Warmwassererzeugung: Wärmepumpe (WW-Betrieb), Heizstab
// und Solarthermie. An einem Tag können mehrere Arten zum Einsatz kommen. Die
// Auswertung liefert je Art: Anzahl der Tage mit Einsatz, das Verhältnis (Anteil
// an allen Tagen mit WW-Erzeugung) sowie – für Heizstab und WP – die
// eingesetzte elektrische Energiemenge.

import * as db from "./db.js";
import { aggregateWpKpiRaw } from "./wpkpi.js";
import { evalFormula } from "./formula.js";

// Default-Formel für die im Speicher gebundene thermische Energie (kWh)
// gegenüber 20 °C Referenz. T_u = untere, T_o = obere Speichertemperatur.
// Herleitung siehe Hilfe/Doku (lineare Schichtung, Vaillant VIH S 300, 289 l).
export const WW_WAERME_FORMEL_DEFAULT = "0.2295 * T_u + 0.1068 * T_o - 6.724";
const WW_WAERME_FORMEL_KEY = "wwWaermeFormel";

export function getWwWaermeFormel(): string {
  const raw = db.getSettingRaw(WW_WAERME_FORMEL_KEY);
  return raw && raw.trim() ? raw : WW_WAERME_FORMEL_DEFAULT;
}
export function setWwWaermeFormel(expr: string): void {
  db.setSettingRaw(WW_WAERME_FORMEL_KEY, expr);
}

// Aktuell im Speicher gebundene thermische Energie aus den zuletzt gemessenen
// Speichertemperaturen und der (editierbaren) Formel. Liefert null, wenn keine
// Temperaturen vorliegen oder die Formel fehlerhaft ist.
export function aktuelleSpeicherWaerme(): { kwh: number | null; tankUp: number | null; tankDown: number | null; formel: string } {
  const formel = getWwWaermeFormel();
  const last = db.getLatestWarmwasser();
  if (!last || last.tankUp == null || last.tankDown == null) {
    return { kwh: null, tankUp: last?.tankUp ?? null, tankDown: last?.tankDown ?? null, formel };
  }
  const r = evalFormula(formel, { T_u: last.tankDown, T_o: last.tankUp });
  return { kwh: r.ok ? r.value : null, tankUp: last.tankUp, tankDown: last.tankDown, formel };
}

// Schwelle, ab der ein Tageseinsatz einer Erzeugungsart als "aktiv" gilt (kWh).
// Verhindert, dass Mess-/Standby-Rauschen als Erzeugungstag gezählt wird.
const AKTIV_KWH = 0.05;

export interface WwKpi {
  von: string; bis: string;
  tageGesamt: number;        // Tage mit irgendeiner WW-Erzeugung
  tageWp: number; tageHeizstab: number; tageSolar: number;
  anteilWp: number; anteilHeizstab: number; anteilSolar: number; // % der Erzeugungstage
  energieHeizstabKwh: number; // elektrische Energie Heizstab
  energieWpKwh: number;       // elektrische Energie WP für Warmwasser
  energieSolarKwh: number;    // erfasster Pumpenstrom Solarthermie
}

// Findet die relevanten Quellen-IDs.
function heizstabIds(): string[] {
  return db.loadSources()
    .filter((s) => s.deviceType === "heater")
    .map((s) => s.id);
}
function solarthermieIds(): string[] {
  return db.loadSources()
    .filter((s) => /solarthermie|solar.?thermie/i.test(s.id) || /solarthermie/i.test(s.label ?? ""))
    .map((s) => s.id);
}

// Tages-kWh je Consumer-ID im Zeitraum (bucket = YYYY-MM-DD).
function tagesKwh(id: string, von: string, bis: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of db.getConsumerBuckets(id, von, bis, "tag")) {
    m.set(b.bucket, (m.get(b.bucket) ?? 0) + b.kwh);
  }
  return m;
}

// --- Aktivitäts-Intervalle der Warmwassererzeuger (für den Temperaturchart) ---

export interface AktivIntervall { von: string; bis: string } // lokale ISO-Zeitstempel
export interface WwAktivitaet {
  wp: AktivIntervall[];
  heizstab: AktivIntervall[];
  solar: AktivIntervall[];
}

// Fasst Zeitpunkte, an denen eine Quelle "aktiv" ist, zu zusammenhängenden
// Intervallen zusammen. `punkte` müssen chronologisch sein; `luecke` (ms) gibt
// an, ab welcher Lücke ein neues Intervall beginnt.
function zuIntervallen(punkte: Array<{ ts: number; aktiv: boolean }>, luecke: number, dauer: number): AktivIntervall[] {
  const out: AktivIntervall[] = [];
  let start: number | null = null;
  let last: number | null = null;
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  for (const pt of punkte) {
    if (pt.aktiv) {
      if (start == null) start = pt.ts;
      else if (last != null && pt.ts - last > luecke) {
        out.push({ von: fmt(start), bis: fmt(last + dauer) });
        start = pt.ts;
      }
      last = pt.ts;
    } else if (start != null && last != null) {
      out.push({ von: fmt(start), bis: fmt(last + dauer) });
      start = null; last = null;
    }
  }
  if (start != null && last != null) out.push({ von: fmt(start), bis: fmt(last + dauer) });
  return out;
}

// Ermittelt für den Zeitraum, wann welcher Warmwassererzeuger aktiv war.
//  - Wärmepumpe: feine Reihe _ElektrischW aus wp_data, aber nur im
//    Warmwasserbetrieb (_ModusCode == 2), Schwelle > 50 W.
//  - Heizstab: 15-min-Verbräuche, mittlere Leistung > 200 W.
//  - Solarthermie: 15-min-Verbräuche, mittlere Leistung > 8 W (Pumpe läuft;
//    Standby ~5 W).
export function warmwasserAktivitaet(vonTs: string, bisTs: string): WwAktivitaet {
  // Wärmepumpe (Warmwasserbetrieb): Modus aus wp_data, Leistung aus der
  // separaten Reihe wp_power. Für jeden Leistungspunkt wird der zuletzt bekannte
  // Betriebsmodus zugeordnet (Moduswechsel ist spätestens im nächsten Sample da).
  const wpRows = db.getWpData(vonTs, bisTs); // {ts,label,value} – für _ModusCode
  const modusByTs = new Map<string, number>();
  for (const r of wpRows) {
    if (r.label === "_ModusCode") modusByTs.set(r.ts, r.value);
  }
  const modusTimes = [...modusByTs.keys()].sort();
  const modusMs = modusTimes.map((t) => Date.parse(t.replace(" ", "T")));
  const modusBei = (tsMs: number): number | undefined => {
    // letzter Modus-Zeitpunkt <= tsMs (binäre Suche wäre möglich; linear reicht,
    // da pro Tag wenige Moduswechsel gespeichert sind).
    let m: number | undefined;
    for (let k = 0; k < modusMs.length; k++) {
      if (modusMs[k] <= tsMs) m = modusByTs.get(modusTimes[k]);
      else break;
    }
    return m;
  };
  const powerRows = db.getWpPower(vonTs, bisTs); // {ts,value}
  const wpPunkte = powerRows.map((p) => {
    const ms = Date.parse(p.ts.replace(" ", "T"));
    const wwBetrieb = modusBei(ms) === 2;
    return { ts: ms, aktiv: wwBetrieb && p.value > 50 };
  });

  // Heizstab + Solarthermie aus den 15-min-Verbräuchen (kWh je 15 min -> W).
  const punkteFuer = (ids: string[], schwelleW: number) => {
    const merged = new Map<number, number>(); // ts -> W (max über die Quellen)
    for (const id of ids) {
      for (const q of db.getConsumerViertelstunden(id, vonTs, bisTs)) {
        const w = q.verbrauch * 4000; // kWh/15min -> mittlere Watt
        const ms = Date.parse(q.ts.replace(" ", "T"));
        merged.set(ms, Math.max(merged.get(ms) ?? 0, w));
      }
    }
    return [...merged.entries()].sort((a, b) => a[0] - b[0])
      .map(([ts, w]) => ({ ts, aktiv: w > schwelleW }));
  };

  const VS = 15 * 60 * 1000; // Viertelstunde
  const WP_LUECKE = 6 * 60 * 1000; // WP-Sampling fein -> kleine Lücke erlaubt
  return {
    wp: zuIntervallen(wpPunkte, WP_LUECKE, 0),
    heizstab: zuIntervallen(punkteFuer(heizstabIds(), 200), VS, VS),
    solar: zuIntervallen(punkteFuer(solarthermieIds(), 8), VS, VS),
  };
}

export function computeWwKpi(vonTag: string, bisTag: string): WwKpi {
  const von = `${vonTag}T00:00:00`;
  const bis = `${bisTag}T23:59:59`;

  // Heizstab: Tage mit Einsatz + Energiemenge (über alle Heizstab-Quellen).
  const heizstabTage = new Set<string>();
  let energieHeizstabKwh = 0;
  for (const id of heizstabIds()) {
    for (const [tag, kwh] of tagesKwh(id, von, bis)) {
      energieHeizstabKwh += kwh;
      if (kwh >= AKTIV_KWH) heizstabTage.add(tag);
    }
  }

  // Solarthermie: Tage mit Einsatz + erfasste Energie. Gemessen wird der
  // Stromverbrauch der Solarkreis-Pumpe (die thermisch eingebrachte Solarenergie
  // ist ohne Wärmemengenzähler nicht ableitbar); dieser Wert wird als
  // "Energie Solarthermie" ausgewiesen.
  const solarTage = new Set<string>();
  let energieSolarKwh = 0;
  for (const id of solarthermieIds()) {
    for (const [tag, kwh] of tagesKwh(id, von, bis)) {
      energieSolarKwh += kwh;
      if (kwh >= AKTIV_KWH) solarTage.add(tag);
    }
  }

  // Wärmepumpe im Warmwasserbetrieb: Tage mit WW-Energie + Energiemenge aus den
  // persistierten WP-KPI-Tagessätzen (energieWwKwh je Tag).
  const wpTage = new Set<string>();
  let energieWpKwh = 0;
  for (const row of aggregateWpKpiRaw(vonTag, bisTag)) {
    const ww = row.energieWwKwh ?? 0;
    energieWpKwh += ww;
    if (ww >= AKTIV_KWH) wpTage.add(row.tag);
  }

  // Menge der Tage, an denen überhaupt Warmwasser erzeugt wurde.
  const alleTage = new Set<string>([...heizstabTage, ...solarTage, ...wpTage]);
  const tageGesamt = alleTage.size;
  const anteil = (n: number) => (tageGesamt > 0 ? 100 * (n / tageGesamt) : 0);

  return {
    von: vonTag, bis: bisTag,
    tageGesamt,
    tageWp: wpTage.size,
    tageHeizstab: heizstabTage.size,
    tageSolar: solarTage.size,
    anteilWp: anteil(wpTage.size),
    anteilHeizstab: anteil(heizstabTage.size),
    anteilSolar: anteil(solarTage.size),
    energieHeizstabKwh,
    energieWpKwh,
    energieSolarKwh,
  };
}
