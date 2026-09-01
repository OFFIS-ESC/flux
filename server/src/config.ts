// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Zentrale Konfiguration des Servers (generisch, geräteunabhängig).
// Geräte/URLs werden NICHT hier gepflegt, sondern als Quellen-Konfiguration
// (siehe sources.ts / Quellen-Seite) datengetrieben verwaltet.

// Mindest-Pollintervall (verhindert versehentliches Dauerfeuer).
export const MIN_INTERVAL_SEC = 2;

// Default-Einstellungen (werden in der DB persistiert und dort überschrieben).
export const DEFAULTS = {
  strompreis: 0.268, // €/kWh
};

// HTTP-Port des Servers.
export const PORT = 3000;
