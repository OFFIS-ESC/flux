// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type { LoadWindow, Settings } from "./types";

// Welcher §14a-Lasttarif gilt zur gegebenen Minute (0..1439) im Quartal (1..4)?
// Standard gilt immer, außer ein Hoch-/Niedriglastfenster trifft zu.
// Spiegelt die Backend-Logik (poller.ts: activeLastTarif).
export function tarifAt(
  minute: number,
  quarter: number,
  windows: LoadWindow[]
): "standard" | "hoch" | "niedrig" {
  const inWindow = (w: LoadWindow) =>
    w.startMin <= w.endMin
      ? minute >= w.startMin && minute < w.endMin
      : minute >= w.startMin || minute < w.endMin; // über Mitternacht
  for (const w of windows) {
    if (!w.quarters.includes(quarter)) continue;
    if (inWindow(w)) return w.kind;
  }
  return "standard";
}

// Netzentgelt (ct/kWh netto) für eine Viertelstunde an einem bestimmten Tag.
// Ist §14a inaktiv, gilt immer das Standard-Netzentgelt.
export function netzentgeltAt(s: Settings, date: Date): number {
  if (!s.paragraf14aAktiv) return s.netzentgeltStandard;
  const minute = date.getHours() * 60 + date.getMinutes();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  const t = tarifAt(minute, quarter, s.lastWindows);
  return t === "hoch"
    ? s.netzentgeltHoch
    : t === "niedrig"
    ? s.netzentgeltNiedrig
    : s.netzentgeltStandard;
}
