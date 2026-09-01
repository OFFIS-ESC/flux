// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Energy-Sharing-Analyse nach §42c.
// Verteilt die eigene Netzeinspeisung je Viertelstunde auf die Abnehmer
// (externe Haushalte). Jeder Abnehmer ist einer grid42c-Quelle zugeordnet,
// aus deren 15-Min-Bezug sich sein Verbrauch ergibt. Pro Viertelstunde:
//   - verteilbarer Überschuss = meine Einspeisung (gridOut-Δ) dieser VS
//   - je Abnehmer ein Anteil (statisch nach Quote / dynamisch nach Verbrauch)
//   - gedeckelt durch den eigenen Bezug des Abnehmers
//   - Rest des Bezugs kommt vom Drittstromlieferanten

import * as db from "./db.js";
import type { Abnehmer } from "./types.js";

export interface SharingSlot {
  ts: string;
  haushalte: Record<
    string,
    {
      bezug: number;
      geteilt: number; // gesamter von mir gedeckter Anteil (PV + Speicher)
      geteiltPv: number; // davon aus PV-Überschuss
      geteiltBatt: number; // davon aus Speicher-Einspeisung
      dritt: number; // Rest vom Drittstromlieferanten
    }
  >;
  einspeisung: number; // gesamte Netzeinspeisung dieser VS (PV + Speicher)
  einspeisungPv: number; // davon aus PV-Überschuss
}

export function computeSharingDay(
  date: string,
  abnehmer: Abnehmer[],
  mode: "dynamisch" | "statisch"
): SharingSlot[] {
  const { von, bis } = db.dayBounds(date);

  const ids = abnehmer.map((a) => a.id);
  const quote: Record<string, number> = {};
  const sourceOf: Record<string, string> = {};
  for (const a of abnehmer) {
    quote[a.id] = a.quote ?? 0;
    sourceOf[a.id] = a.sourceId;
  }

  const eigene = db.getViertelstunden(von, bis);
  const eingByTs: Record<string, number> = {};
  const eingPvByTs: Record<string, number> = {};
  const eingBattByTs: Record<string, number> = {};
  for (const e of eigene) {
    eingByTs[e.ts] = e.eingespeist;
    eingPvByTs[e.ts] = e.eingespeistPv ?? 0;
    eingBattByTs[e.ts] = e.eingespeistBatt ?? 0;
  }

  const sharing = db.getSharingViertelstunden(von, bis);
  const bezugByTs: Record<string, Record<string, number>> = {};
  for (const r of sharing) {
    (bezugByTs[r.ts] ??= {})[r.source] = r.bezogen;
  }

  const allTs = new Set<string>([
    ...Object.keys(bezugByTs),
    ...Object.keys(eingByTs),
  ]);
  const slots: SharingSlot[] = [];

  for (const ts of [...allTs].sort()) {
    const einspeisung = eingByTs[ts] ?? 0;
    const eingPv = eingPvByTs[ts] ?? 0;
    const pvFrac = einspeisung > 0 ? Math.min(1, Math.max(0, eingPv / einspeisung)) : 1;
    const bezugQuelle = bezugByTs[ts] ?? {};
    const bezugAbn: Record<string, number> = {};
    // Effektiver, zu deckender Bedarf je Abnehmer: nur positiver Netzbezug.
    // Speist ein Abnehmer mit eigener PV selbst ein (negativer Wert), ist sein
    // Bedarf 0 – er bekommt nichts aus meinem Überschuss.
    const bedarfAbn: Record<string, number> = {};
    for (const id of ids) {
      const roh = bezugQuelle[sourceOf[id]] ?? 0;
      bezugAbn[id] = roh; // Rohwert (kann negativ sein) – informativ
      bedarfAbn[id] = Math.max(0, roh);
    }

    const gewicht: Record<string, number> = {};
    if (mode === "statisch") {
      // Quote nur anwenden, wenn der Abnehmer überhaupt Bedarf hat.
      for (const id of ids) gewicht[id] = bedarfAbn[id] > 0 ? Math.max(0, quote[id]) : 0;
    } else {
      for (const id of ids) gewicht[id] = bedarfAbn[id];
    }
    const gewichtSumme = ids.reduce((a, id) => a + (gewicht[id] ?? 0), 0);

    const haushalteOut: SharingSlot["haushalte"] = {};
    for (const id of ids) {
      const bezug = bezugAbn[id]; // echter (ggf. negativer) Wert für die Anzeige
      const bedarf = bedarfAbn[id]; // zu deckender Bedarf (>= 0)
      let anteil =
        gewichtSumme > 0 ? (einspeisung * (gewicht[id] ?? 0)) / gewichtSumme : 0;
      if (anteil > bedarf) anteil = bedarf; // nie mehr als der echte Bedarf
      if (anteil < 0) anteil = 0;
      const geteiltPv = anteil * pvFrac;
      const geteiltBatt = anteil - geteiltPv;
      haushalteOut[id] = {
        bezug,
        geteilt: anteil,
        geteiltPv,
        geteiltBatt,
        dritt: Math.max(0, bedarf - anteil),
      };
    }

    slots.push({ ts, einspeisung, einspeisungPv: eingPv, haushalte: haushalteOut });
  }

  return slots;
}
