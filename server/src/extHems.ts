// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Datenbereitstellung für externe HEMS (sinkRole "extHems").
//
// FLUX publiziert ausgewählte Live-Größen per MQTT an einen Broker, damit ein
// anderes Energiemanagementsystem (z. B. das eines §42c-Abnehmers mit eigenem
// HEMS) darauf reagieren kann. Dieses Modul definiert die kuratierte Liste der
// bereitstellbaren Größen, berechnet ihre aktuellen Werte aus dem Live-Zustand,
// wertet benutzerdefinierte Formel-Größen aus und übernimmt das änderungs-
// basierte Publizieren je Topic.

import type { Sink, ExtHemsFormelGroesse } from "./types.js";
import { evalFormula } from "./formula.js";
import { publishExtHemsMqtt } from "./mqttClient.js";

// Eine kuratierte, für den HEMS-zu-HEMS-Austausch sinnvolle Größe.
export interface HemsGroesse {
  id: string;
  name: string;
  einheit: string;
  beschreibung: string; // verständliche Erklärung fürs externe HEMS
}

// Die kuratierte Liste. Reihenfolge = Anzeigereihenfolge in der Auswahl.
// IDs sind stabil und dienen zugleich als JSON-Schlüssel beim Publizieren.
export const HEMS_GROESSEN: HemsGroesse[] = [
  {
    id: "verfuegbarerUeberschuss",
    name: "Verfügbarer Überschuss",
    einheit: "W",
    beschreibung:
      "Aktuell ins Netz eingespeiste Leistung (PV-Überschuss plus einspeisende Batterie). " +
      "Zeigt an, wie viel Leistung FLUX gerade abgeben kann.",
  },
  {
    id: "abgebbaresLimit",
    name: "Abgebbares Leistungslimit",
    einheit: "W",
    beschreibung:
      "Maximale Leistung, die FLUX über die Speicheransteuerung zusätzlich ins Netz " +
      "abgeben könnte (Grenze der für §42c/externe Abgabe konfigurierten Senken). " +
      "0 bedeutet unbegrenzt bzw. nicht limitiert.",
  },
  {
    id: "batterieSoc",
    name: "Speicherstand (SoC)",
    einheit: "%",
    beschreibung:
      "Höchster aktueller Ladezustand der Batteriespeicher in Prozent.",
  },
  {
    id: "batterieLeistung",
    name: "Batterie-Leistung",
    einheit: "W",
    beschreibung:
      "Aktuelle Batterieleistung. Positiv = Entladung (Abgabe), negativ = Ladung.",
  },
  {
    id: "pvLeistung",
    name: "PV-Leistung",
    einheit: "W",
    beschreibung: "Aktuelle Gesamt-Erzeugungsleistung der PV-Anlagen.",
  },
  {
    id: "hausverbrauch",
    name: "Hausverbrauch",
    einheit: "W",
    beschreibung: "Aktueller eigener Hausverbrauch (Näherung aus der Leistungsbilanz).",
  },
  {
    id: "netzleistung",
    name: "Netzleistung",
    einheit: "W",
    beschreibung:
      "Leistung am Netzanschlusspunkt. Positiv = Bezug aus dem Netz, negativ = Einspeisung.",
  },
  {
    id: "sharingLeistung",
    name: "Aktuell bereitgestellte Sharing-Leistung",
    einheit: "W",
    beschreibung:
      "Leistung, die FLUX gerade über die eigene Einspeisung zum Bedarf von " +
      "§42c-Abnehmern beiträgt.",
  },
  {
    id: "restertragHeute",
    name: "Prognostizierter Rest-PV-Ertrag heute",
    einheit: "kWh",
    beschreibung:
      "Für den restlichen Tag prognostizierte, noch zu erwartende PV-Erzeugung.",
  },
];

// Bündel der aktuellen Roh-Werte, aus denen sowohl die kuratierten Größen als
// auch die Variablen für Formel-Größen gespeist werden.
export interface ExtHemsInputs {
  ueberschuss: number;
  abgebbaresLimit: number;
  batterieSoc: number;
  batterieLeistung: number;   // >0 Entladung, <0 Ladung
  pvLeistung: number;
  hausverbrauch: number;
  netzleistung: number;       // >0 Bezug, <0 Einspeisung
  sharingLeistung: number;
  restertragHeute: number;    // kWh
}

// Liefert den aktuellen Wert einer kuratierten Größe aus den Inputs.
function kuratierterWert(id: string, inp: ExtHemsInputs): number | null {
  switch (id) {
    case "verfuegbarerUeberschuss": return inp.ueberschuss;
    case "abgebbaresLimit": return inp.abgebbaresLimit;
    case "batterieSoc": return inp.batterieSoc;
    case "batterieLeistung": return inp.batterieLeistung;
    case "pvLeistung": return inp.pvLeistung;
    case "hausverbrauch": return inp.hausverbrauch;
    case "netzleistung": return inp.netzleistung;
    case "sharingLeistung": return inp.sharingLeistung;
    case "restertragHeute": return inp.restertragHeute;
    default: return null;
  }
}

// Variablen, die in benutzerdefinierten Formel-Größen verwendet werden dürfen.
// Namen bewusst identisch zu den kuratierten IDs, damit sie intuitiv sind.
export function extHemsVariables(inp: ExtHemsInputs): Record<string, number> {
  return {
    verfuegbarerUeberschuss: inp.ueberschuss,
    abgebbaresLimit: inp.abgebbaresLimit,
    batterieSoc: inp.batterieSoc,
    batterieLeistung: inp.batterieLeistung,
    pvLeistung: inp.pvLeistung,
    hausverbrauch: inp.hausverbrauch,
    netzleistung: inp.netzleistung,
    sharingLeistung: inp.sharingLeistung,
    restertragHeute: inp.restertragHeute,
  };
}

export const EXTHEMS_VARIABLE_NAMEN = [
  "verfuegbarerUeberschuss", "abgebbaresLimit", "batterieSoc", "batterieLeistung",
  "pvLeistung", "hausverbrauch", "netzleistung", "sharingLeistung", "restertragHeute",
];

// Liefert den Wert einer Formel-Größe (oder null bei ungültiger Formel).
function formelWert(f: ExtHemsFormelGroesse, inp: ExtHemsInputs): number | null {
  const r = evalFormula(f.formel, extHemsVariables(inp));
  return r.ok && Number.isFinite(r.value) ? r.value : null;
}

// Ermittelt den aktuellen Wert einer beliebigen Größen-ID (kuratiert oder Formel).
export function groesseWert(id: string, inp: ExtHemsInputs, formeln: ExtHemsFormelGroesse[]): number | null {
  const kur = kuratierterWert(id, inp);
  if (kur != null) return kur;
  const f = formeln.find((x) => x.id === id);
  if (f) return formelWert(f, inp);
  return null;
}

// Anzeigename + Einheit einer Größe (für die Schnittstellenbeschreibung).
export function groesseMeta(id: string, formeln: ExtHemsFormelGroesse[]): { name: string; einheit: string; beschreibung: string } | null {
  const k = HEMS_GROESSEN.find((g) => g.id === id);
  if (k) return { name: k.name, einheit: k.einheit, beschreibung: k.beschreibung };
  const f = formeln.find((x) => x.id === id);
  if (f) return { name: f.name, einheit: f.einheit, beschreibung: `Benutzerdefinierte Formel-Größe: ${f.formel}` };
  return null;
}

// Letzter publizierter Payload je (Senke, Topic) – für Änderungserkennung.
const lastPublished = new Map<string, Record<string, number>>();

// Rundet gemäß Schwelle, damit Rauschen nicht dauernd publiziert. Zwei Werte
// gelten als "gleich", wenn sie sich um weniger als threshold unterscheiden.
function unveraendert(prev: Record<string, number> | undefined, next: Record<string, number>, threshold: number): boolean {
  if (!prev) return false;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) {
    if (!(k in prev)) return false;
    if (Math.abs((prev[k] ?? 0) - (next[k] ?? 0)) >= threshold) return false;
  }
  return true;
}

// Publiziert alle Topics einer extHems-Senke, sofern sich Werte geändert haben.
// Wird regelmäßig aus dem Poll-Zyklus aufgerufen; sendet aber nur bei Änderung.
export function publishExtHems(
  sink: Sink,
  inp: ExtHemsInputs,
  onLog?: (msg: string) => void,
): void {
  if (sink.sinkRole !== "extHems" || sink.enabled === false) return;
  if (!sink.mqttUrl || !sink.extHemsTopics || sink.extHemsTopics.length === 0) return;
  const formeln = sink.extHemsFormeln ?? [];
  const threshold = sink.extHemsChangeThreshold ?? 1;

  for (const t of sink.extHemsTopics) {
    if (!t.topic || !t.groessen || t.groessen.length === 0) continue;
    // JSON-Objekt aus den zugeordneten Größen bauen (immer Objekt, auch bei einer).
    const payloadObj: Record<string, number> = {};
    for (const gid of t.groessen) {
      const v = groesseWert(gid, inp, formeln);
      if (v != null) payloadObj[gid] = Math.round(v * 1000) / 1000;
    }
    if (Object.keys(payloadObj).length === 0) continue;

    const key = `${sink.id}::${t.topic}`;
    if (unveraendert(lastPublished.get(key), payloadObj, threshold)) continue;
    lastPublished.set(key, payloadObj);

    // Zeitstempel ergänzen (hilft dem Empfänger, Aktualität zu prüfen).
    const payload = JSON.stringify({ ...payloadObj, ts: new Date().toISOString() });
    publishExtHemsMqtt(sink, t.topic, payload, t.retain !== false, onLog);
  }
}

// Setzt den Änderungs-Cache einer Senke zurück (z. B. nach Config-Änderung),
// damit beim nächsten Zyklus garantiert einmal publiziert wird.
export function resetExtHemsCache(sinkId?: string): void {
  if (!sinkId) { lastPublished.clear(); return; }
  for (const k of [...lastPublished.keys()]) {
    if (k.startsWith(`${sinkId}::`)) lastPublished.delete(k);
  }
}

// Baut die Schnittstellenbeschreibung (verständlicher Text) für eine Senke.
// Erklärt dem externen HEMS, welche Topics welche Größen in welcher Einheit
// liefern und wie das JSON aufgebaut ist.
export function beschreibungFuerSenke(sink: Sink): string {
  const formeln = sink.extHemsFormeln ?? [];
  const zeilen: string[] = [];
  zeilen.push(`Schnittstellenbeschreibung – FLUX Datenbereitstellung "${sink.name}"`);
  zeilen.push("");
  zeilen.push(`Broker: ${sink.mqttUrl ?? "(nicht gesetzt)"}`);
  zeilen.push("Übertragung: MQTT. Jeder unten genannte Topic erhält ein JSON-Objekt.");
  zeilen.push("Es wird nur bei Wertänderung gesendet; jedes JSON enthält zusätzlich das");
  zeilen.push('Feld "ts" (ISO-8601-Zeitstempel des Sendezeitpunkts).');
  zeilen.push("");
  for (const t of sink.extHemsTopics ?? []) {
    if (!t.topic || !t.groessen?.length) continue;
    zeilen.push(`Topic: ${t.topic}`);
    zeilen.push("  JSON-Felder:");
    for (const gid of t.groessen) {
      const m = groesseMeta(gid, formeln);
      if (!m) continue;
      zeilen.push(`   - "${gid}" (${m.einheit}): ${m.name}. ${m.beschreibung}`);
    }
    zeilen.push('   - "ts" (ISO-8601): Sendezeitpunkt.');
    zeilen.push("");
  }
  return zeilen.join("\n");
}
