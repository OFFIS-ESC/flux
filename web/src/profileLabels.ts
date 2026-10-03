// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Erweiterte Anzeigenamen der BDEW-Standardlastprofile. Zentral, damit Quellen-
// und Lastprofil-Seite dieselben Bezeichnungen verwenden.
const PROFILE_LABELS: Record<string, string> = {
  H25: "Haushalt",
  G25: "Gewerbe allgemein",
  L25: "Landwirtschaft",
  P25: "Kombinationsprofil PV",
  S25: "Kombinationsprofil PV-Speicher",
};

// Voller Anzeigename: "<Kürzel> – <Beschreibung>" für bekannte BDEW-Profile,
// sonst der unveränderte Name (z. B. eigene Profile).
export function profileLabel(name: string): string {
  const beschreibung = PROFILE_LABELS[name];
  return beschreibung ? `${name} – ${beschreibung}` : name;
}
