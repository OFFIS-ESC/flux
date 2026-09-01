// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Zentrale Bestimmung des anzuzeigenden Icons einer Quelle/eines Verbrauchers.
// Ein explizit gesetztes Icon hat immer Vorrang. Ist keines gesetzt, wird ein
// sinnvoller Default abgeleitet – zuerst nach Gerätetyp (deviceType), dann nach
// Rolle. So zeigt auch die Quellen-Konfiguration dasselbe effektive Icon wie die
// Verbraucher-/Übersichtsansichten.

// Default-Icon je Gerätetyp (nur für Verbraucher relevant).
export const ICON_BY_DEVICE: Record<string, string> = {
  car: "\u{1F697}", // 🚗
  heater: "\u{1F525}", // 🔥
  heatpump: "\u{1F321}", // 🌡️
  climate: "\u{2744}\u{FE0F}", // ❄️ Schneeflocke/Eiskristall
  generic: "\u{1F50C}", // 🔌
};

// Default-Icon je Rolle.
export const ICON_BY_ROLE: Record<string, string> = {
  pv: "\u{2600}\u{FE0F}", // ☀️ Sonne – alle PV-Erzeugung
  batteryOut: "\u{1F50B}", // 🔋 Batterie – Entladung
  batteryIn: "\u{1F50B}", // 🔋 Batterie – Netzladung
  acBattery: "\u{1F50B}", // 🔋 AC-Batterie (lokale API)
  grid: "\u{1F3E0}", // 🏠 Haus – alle Netz-Rollen
  gridEmu: "\u{1F3E0}", // 🏠
  grid42c: "\u{1F3E0}", // 🏠
  grid42cEmu: "\u{1F3E0}", // 🏠
};

const FALLBACK = "\u{1F50C}"; // 🔌

// Effektives Icon: explizites Icon > Gerätetyp-Default > Rollen-Default > Fallback.
export function effectiveIcon(opts: {
  icon?: string;
  deviceType?: string;
  role?: string;
}): string {
  if (opts.icon) return opts.icon;
  if (opts.deviceType && opts.deviceType !== "generic") {
    const d = ICON_BY_DEVICE[opts.deviceType];
    if (d) return d;
  }
  if (opts.role) {
    const r = ICON_BY_ROLE[opts.role];
    if (r) return r;
  }
  // Verbraucher ohne spezifischen Gerätetyp bekommen das generische Geräte-Icon.
  if (opts.role === "consumer") return ICON_BY_DEVICE.generic;
  return FALLBACK;
}
