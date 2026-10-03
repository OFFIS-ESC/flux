// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type { CSSProperties } from "react";

// Exakte Overlay-Positionen aus dem ESP32-CSS (Container = 800px breit).
// top/right in px, relativ zum .container.
export const POS: Record<string, CSSProperties> = {
  batterySoC: { top: 428, right: 54 },
  batteryOnOff: { top: 333, right: 81 },
  batteryV: { top: 266, right: 65 },
  // PV->Batterie (DC-Ladung, z.B. EPEver): hellgrüner Pfeil von oben (PV) nach
  // rechts zur Batterie. Ladeleistung waagerecht im Pfeil nahe der Pfeilspitze
  // (Batterie), Tagesenergie hochkant im vertikalen Pfeilstück am oberen Ende.
  batteryCharging: { top: 326, right: 200 }, // ok
  batteryChargedDay: { top: 175, left: 453 }, // ok
  batteryFeedin: { top: 354, left: 200 },
  batteryFeedinDay: { top: 354, right: 200 },
  consume: { top: 266, right: 640 },
  consumedDay: { top: 428, right: 640 },
  heatpumpRunning: { top: 231, right: 640 },
  climaRunning: { top: 10, right: 640 },
  climaConsume: { top: 40, right: 640 },
  car: { top: 96, right: 640 },
  carConsume: { top: 131, right: 640 },
  carSoC: { top: 166, right: 640 },
  pvDrosselt: { top: 10, right: 495 },
  pvSuns: { top: 10, right: 465 },
  pvGenerating: { top: 50, right: 495 }, // muss wieder schwarz, groesser
  pvConsume: { top: 326, left: 200 }, //muss weiss
  pvConsumedDay: { top: 175, left: 366 },  // ok
  pvGeneratedDay: { top: 80, right: 495 }, // ok
  pvFeedin: { bottom: 410, left: 395 },
  pvFeedinDay: { top: 175, left: 395 },
  pvEarnedDay: { top: 530, left: 480 },
  grid: { top: 384, left: 200 },
  gridDay: { bottom: 410, left: 366 },
  gridCostsDay: { top: 530, right: 500 },
  gridTotalIn: { top: 620, right: 490 },
  gridTotalOut: { top: 650, right: 490 },
  // Autarkie + Strompreis: links unter die Netzzählerstände, rechtsbündig
  // passend zu diesen (gleiche rechte Kante, etwas Abstand darunter).
  gridAutarkieDay: { top: 692, right: 490 },
  gridCostsPerkWh: { top: 722, right: 490 },
  // Kostenaufstellung rechts neben dem Netzsymbol, vier Werte untereinander,
  // rechtsbündig (gleiche rechte Kante).
  gridBezugskosten: { top: 620, right: 20 },
  gridEinspeiseverg: { top: 650, right: 20 },
  gridSharingVerg: { top: 680, right: 20 },
  gridCostsDaySum: { top: 715, right: 20 },
  // §42c Energy Sharing: orangener Pfeil Netz -> externer Abnehmer (unterer
  // Bereich des überarbeiteten Diagramms). Leistung + heutige Vergütung.
  sharing42cPower: { bottom: 190, left: 423 },
  sharing42cPowerOther: { bottom: 190, left: 394 },
  sharing42cEnergyDay: { bottom: 410, left: 423 },
  pvTo42cEnergy: { top: 175, left: 423 },
  pvTo42cPower: { top: 390, left: 423 },
  batteryTo42cEnergy: { top: 382, right: 200 },
  batteryTo42cPower: { top: 382, right: 280 },
  sharing42cVerguetung: { top: 775, left: 470 },
  // Batterie-Netzladung (batteryIn): grauer Pfeil Netz -> Batterie. Die
  // Momentanleistung liegt waagerecht IM Pfeil nahe der Pfeilspitze (Batterie),
  // der Tagesenergiewert hochkant IM vertikalen Pfeilstück am anderen Ende.
  batteryInPower: { top: 409, right: 200 },
  batteryInDay: { bottom: 410, left: 452 },
  waterUp: { top: 45, right: 165 },
  waterDown: { top: 80, right: 165 },
  heaterPower: { top: 115, right: 165 },
  time: { top: 10, right: 165 },
};

// Erzeugt den absoluten Positionsstil für ein Overlay.
export function pos(key: keyof typeof POS): CSSProperties {
  return { position: "absolute", ...POS[key] };
}
