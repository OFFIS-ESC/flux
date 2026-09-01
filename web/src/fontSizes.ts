// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Wendet die konfigurierten Schriftgrößen als CSS-Variablen an.
//
// Desktop-Werte werden direkt auf :root (document.documentElement) gesetzt.
// Mobil-Werte werden über ein injiziertes <style>-Element mit einer
// Media-Query (max-width: 800px) gesetzt, damit sie nur auf schmalen Viewports
// greifen und die Desktop-Werte überschreiben.
//
// Die Schlüssel entsprechen den CSS-Raster-Variablen --fs-<key> in app.css.

export interface FontSizeEntry { desktop: number; mobile: number; }
export type FontSizeConfig = Record<string, FontSizeEntry>;

// Reihenfolge/Metadaten der Text-Typen für die UI (Label + Beschreibung).
export const FONT_TYPES: Array<{ key: string; label: string; wo: string }> = [
  { key: "h2", label: "Seitentitel", wo: "oberste Überschrift einer Seite" },
  { key: "h3", label: "Block-/Kartenüberschrift", wo: "Titel eines Blocks/einer Karte" },
  { key: "h4", label: "Zwischenüberschrift", wo: "kleinere Gliederungsebene" },
  { key: "body", label: "Normaler Text", wo: "Fließtext, Formulare, Buttons" },
  { key: "hint", label: "Erklärtext / Hinweis", wo: "graue Erklärtexte" },
  { key: "table", label: "Text in Tabellen", wo: "alle Tabellenzellen" },
  { key: "small", label: "Kleine Beschriftung", wo: "Detailzeilen, Tags, Labels" },
  { key: "tiny", label: "Sehr kleine Angabe", wo: "Fußzeile, Version" },
  { key: "diagram-value", label: "Diagramm-Messwert", wo: "Messwerte an den Knoten (Startseite)" },
  { key: "diagram-text", label: "Diagramm-Text", wo: "große Texte im Übersichts-Diagramm" },
  { key: "kpi", label: "Kennzahl (großer Wert)", wo: "große Werte der Statistik-Karten" },
  { key: "nav", label: "Menü / Seitenleiste", wo: "Navigation links" },
  { key: "charttitle", label: "Chart-/Tabellentitel", wo: "Überschrift über Diagrammen" },
  { key: "badge", label: "Status-Badge", wo: "kleine Statusmarker" },
  { key: "axis", label: "Diagramm-Achse", wo: "Achsenbeschriftung in Charts" },
];

export const FONT_SIZE_DEFAULTS: FontSizeConfig = {
  h1:    { desktop: 26, mobile: 20 },
  h2:    { desktop: 20, mobile: 16 },
  h3:    { desktop: 18, mobile: 14 },
  h4:    { desktop: 16, mobile: 12 },
  body:  { desktop: 14, mobile: 11 },
  hint:  { desktop: 14, mobile: 10 },
  table: { desktop: 13, mobile: 10 },
  small: { desktop: 12, mobile: 10 },
  tiny:  { desktop: 11, mobile: 9 },
  "diagram-value": { desktop: 14, mobile: 14 },
  "diagram-text":  { desktop: 20, mobile: 20 },
  kpi:   { desktop: 24, mobile: 20 },
  nav:   { desktop: 15, mobile: 15 },
  charttitle: { desktop: 15, mobile: 15 },
  badge: { desktop: 12, mobile: 12 },
  axis:  { desktop: 10, mobile: 10 },
};

const STYLE_ID = "flux-font-sizes-mobile";

export function applyFontSizes(cfg: FontSizeConfig | undefined | null): void {
  const conf = cfg ?? FONT_SIZE_DEFAULTS;
  const root = document.documentElement;

  // WICHTIG: Desktop-Werte NICHT als inline-style auf :root setzen – inline-Styles
  // haben höhere Priorität als jede @media-Regel und würden die Mobil-Werte immer
  // überschreiben. Stattdessen BEIDE (Desktop-Basis + Mobil-Override) in EIN
  // injiziertes <style>-Element schreiben. Die Media-Query steht danach und
  // gewinnt bei schmalen Viewports mit gleicher Spezifität.
  const desktopLines: string[] = [];
  const mobileLines: string[] = [];
  for (const t of FONT_TYPES) {
    const entry = conf[t.key] ?? FONT_SIZE_DEFAULTS[t.key];
    const desktop = Number.isFinite(entry?.desktop) ? entry.desktop : FONT_SIZE_DEFAULTS[t.key].desktop;
    const mobile = Number.isFinite(entry?.mobile) ? entry.mobile : FONT_SIZE_DEFAULTS[t.key].mobile;
    desktopLines.push(`  --fs-${t.key}: ${desktop}px;`);
    mobileLines.push(`    --fs-${t.key}: ${mobile}px;`);
    // Eventuell früher gesetzte inline-Variablen entfernen (aus alter Version),
    // sonst würden sie weiterhin die Media-Query blockieren.
    root.style.removeProperty(`--fs-${t.key}`);
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent =
    `:root {\n${desktopLines.join("\n")}\n}\n` +
    `@media (max-width: 800px) {\n  :root {\n${mobileLines.join("\n")}\n  }\n}`;
}
