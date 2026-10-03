// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { SourceLinks } from "./SourceLinks";
import { WarmwasserChart } from "./WarmwasserChart";
import { WwKpiBlock } from "./WwKpiBlock";

// Eigene Seite für Warmwasser: Kennzahlen-Auswertung der Erzeugungsarten plus
// der Temperaturverlauf des Warmwasserspeichers (zuvor auf der WP-Seite).
export function WarmwasserPage() {
  return (
    <div className="page">
      <div className="page-head">
        <h2>Warmwasser</h2>
      </div>
      <SourceLinks roles="waterTank,heater" title="Weboberflächen der Warmwasser-Erzeuger" />
      <WwKpiBlock />
      <WarmwasserChart />
    </div>
  );
}
