// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useRef } from "react";
import { downloadChartAlsJpg } from "./chartDownload";

// Wiederverwendbarer Download-Button für Charts. Er sucht beim Klick selbst den
// umschließenden Chart-Container (das nächste Vorfahren-Element, das ein <svg>
// enthält – bevorzugt eine .card/.chart-wrap/section), sodass er ohne ref-
// Verwaltung in jede Chart-Datei mit einer Zeile eingefügt werden kann.
export function ChartDownloadButton({ dateiname }: { dateiname: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const findeContainer = (): HTMLElement | null => {
    let el: HTMLElement | null = btnRef.current;
    // Nach oben laufen, bis ein Vorfahre ein <svg> enthält.
    while (el) {
      el = el.parentElement;
      if (el && el.querySelector("svg")) {
        // Bevorzugt einen "sauberen" Container (Karte/Chart-Wrapper) nehmen, wenn
        // wir tiefer als nötig sind – sonst reicht das erste svg-haltige Element.
        return el;
      }
    }
    return null;
  };

  return (
    <button
      ref={btnRef}
      className="chart-download-btn"
      title="Als Bild herunterladen"
      onClick={() => {
        const c = findeContainer();
        if (c) downloadChartAlsJpg(c, dateiname);
      }}
    >⬇</button>
  );
}
