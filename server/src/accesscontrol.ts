// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Zugangskontrolle Schritt 2: Whitelist-Prüfung, Aktions-Auslösung, Feedback.
//
// Hängt sich in den Ereignis-Hook des Reader-Moduls (Schritt 1). Für jedes
// empfangene card/pin-Ereignis wird geprüft, ob eine passende, aktive und aktuell
// gültige Berechtigung existiert. Wenn ja: Aktionen + Regeln auslösen, "ok"-
// Feedback senden. Wenn nein: "denied"-Feedback. Das Protokoll wird um Ergebnis
// und Klartext-Namen ergänzt.

import type { AccessEntry } from "./types.js";
import type { SourceConfig } from "./sources.js";
import * as db from "./db.js";
import { setAccessEreignisHook, sendeFeedback } from "./accessreader.js";

// Callback zum Ausführen einer RuleAction (wird von index.ts gesetzt, damit die
// vorhandene Aktions-Ausführung der Regeln wiederverwendet wird).
type AktionRunner = (action: any) => Promise<void> | void;
let aktionRunner: AktionRunner | null = null;
export function setAccessAktionRunner(fn: AktionRunner): void { aktionRunner = fn; }

// Callback zum Auslösen einer Regel per ID (wie /api/rules/:id/trigger).
type RegelTrigger = (ruleId: string) => Promise<void> | void;
let regelTrigger: RegelTrigger | null = null;
export function setAccessRegelTrigger(fn: RegelTrigger): void { regelTrigger = fn; }

// Prüft, ob eine Berechtigung JETZT zeitlich gültig ist.
function zeitlichGueltig(e: AccessEntry, jetzt: Date): boolean {
  if (e.ablauf) {
    // Ablaufdatum inklusive: bis Ende des Tages gültig.
    const ab = new Date(e.ablauf + "T23:59:59");
    if (!Number.isNaN(ab.getTime()) && jetzt > ab) return false;
  }
  if (e.wochentage && e.wochentage.length > 0) {
    if (!e.wochentage.includes(jetzt.getDay())) return false;
  }
  if (e.vonUhr || e.bisUhr) {
    const min = jetzt.getHours() * 60 + jetzt.getMinutes();
    const parse = (s?: string) => { if (!s) return null; const [h, m] = s.split(":").map(Number); return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0); };
    const von = parse(e.vonUhr); const bis = parse(e.bisUhr);
    if (von != null && bis != null) {
      // Fenster, ggf. über Mitternacht (von > bis).
      if (von <= bis) { if (min < von || min > bis) return false; }
      else { if (min < von && min > bis) return false; }
    } else if (von != null) { if (min < von) return false; }
    else if (bis != null) { if (min > bis) return false; }
  }
  return true;
}

// Ein Ereignis auswerten.
async function werteAus(src: SourceConfig, art: "card" | "pin", wert: string, _bits: number | undefined): Promise<void> {
  const jetzt = new Date();
  const entries = db.loadAccessEntries() as AccessEntry[];
  // Passenden Eintrag suchen: Wert + Art. Hinweis aus der Spec: Manche Keypads
  // senden die PIN als CARD-Frame; daher bei Nichttreffer auch art-übergreifend
  // auf reine Wert-Gleichheit prüfen.
  let treffer = entries.find((e) => e.aktiv && e.wert !== "" && e.art === art && e.wert === wert);
  if (!treffer) treffer = entries.find((e) => e.aktiv && e.wert !== "" && e.wert === wert);

  if (!treffer) {
    db.updateLetztesAccessResult(src.id, "unbekannt", null);
    sendeFeedback(src, "denied");
    return;
  }
  if (!zeitlichGueltig(treffer, jetzt)) {
    db.updateLetztesAccessResult(src.id, "abgelaufen", treffer.name);
    sendeFeedback(src, "denied");
    return;
  }

  // Berechtigt: Protokoll aktualisieren, Feedback, Aktionen + Regeln auslösen.
  db.updateLetztesAccessResult(src.id, "ok", treffer.name);
  sendeFeedback(src, "ok");
  db.addLog(db.LOG_LEVELS.info, "access", `Zugang gewährt: ${treffer.name} (${art} ${wert})`);

  for (const a of (treffer.aktionen ?? [])) {
    try { await aktionRunner?.(a); } catch (e: any) { db.addLog(db.LOG_LEVELS.warn, "access", `Aktion fehlgeschlagen: ${e?.message ?? e}`); }
  }
  for (const rid of (treffer.ausloeseRegeln ?? [])) {
    try { await regelTrigger?.(rid); } catch (e: any) { db.addLog(db.LOG_LEVELS.warn, "access", `Regel-Trigger fehlgeschlagen: ${e?.message ?? e}`); }
  }
}

// Auswertung aktivieren (Hook registrieren).
export function initAccessControl(): void {
  setAccessEreignisHook((src, art, wert, bits) => { void werteAus(src, art, wert, bits); });
}
