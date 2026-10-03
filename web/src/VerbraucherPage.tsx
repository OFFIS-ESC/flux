// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { ConsumerTable } from "./ConsumerTable";
import type { FullState } from "./types";

export function VerbraucherPage({ state }: { state: FullState }) {
  const consumers = state.live.consumers ?? [];
  return (
    <div className="page">
      <h2>Verbraucher</h2>
      {consumers.length === 0 ? (
        <p className="hint">Keine Verbraucher konfiguriert.</p>
      ) : (
        <>
          <p className="hint">
            Übersicht aller konfigurierten Verbraucher mit ihrem Tagesverbrauch.
            Über die Datumsauswahl lassen sich auch vergangene Tage einsehen; die
            Momentanleistung gilt nur für den heutigen Tag (an vergangenen Tagen
            ausgegraut). Der Tagesverbrauch wird über die Zeit integriert, da
            Verbraucher meist keinen eigenen Energiezähler liefern. Für den
            Tagesverlauf eines einzelnen Geräts oder eines Raums auf die Zeile
            klicken; die Gesamtzeile öffnet ein gestapeltes Tagesdiagramm aller
            Verbraucher.
          </p>
          <div className="card">
            <ConsumerTable state={state} />
          </div>
        </>
      )}
    </div>
  );
}
