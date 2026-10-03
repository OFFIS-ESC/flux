// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Zugangskontrolle: Wiegand-RFID/PIN-Reader über MQTT.
//
// Der Reader ist ein reiner Sensor+Aktor. Er meldet gelesene Karten (card) und
// eingegebene PINs (pin); FLUX prüft (Schritt 2: gegen eine Whitelist), löst
// Aktionen aus und sendet Feedback (cmd → LED/Buzzer). Dieses Modul deckt
// Schritt 1 ab: Empfang, Protokollierung, Online-Status.

import { onMqttMessage, publishLocal, getLastPayload } from "./mqttbroker.js";
import { subscribeExternal, getExternalPayload, publishExternal } from "./mqttExtClient.js";
import type { SourceConfig } from "./sources.js";
import * as db from "./db.js";

export interface ReaderStatus {
  sourceId: string;
  online: boolean | null;      // aus dem retained status-Topic (null = unbekannt)
  letztesEreignis?: { art: "card" | "pin"; wert: string; bits?: number; ts: string; ergebnis?: string };
  // Diagnose: ob auf dem konfigurierten Basis-Topic jemals eine Nachricht eintraf
  // (hilft, einen falsch gesetzten Topic-Namen zu erkennen), plus das Basis-Topic.
  topicBasis?: string;
  nachrichtenEmpfangen?: boolean;
}

const status = new Map<string, ReaderStatus>();
// Callback, den Schritt 2 (Whitelist/Aktionen) setzt. Bekommt das Ereignis und
// entscheidet über Ergebnis + Feedback. In Schritt 1 nur Protokollierung.
type EreignisHook = (src: SourceConfig, art: "card" | "pin", wert: string, bits: number | undefined) => void;
let ereignisHook: EreignisHook | null = null;
export function setAccessEreignisHook(fn: EreignisHook): void { ereignisHook = fn; }

// Basis-Topic einer Reader-Quelle (ohne Suffix), Default "zutritt/reader".
function topicBase(src: SourceConfig): string {
  return (src.readerTopicBase ?? "zutritt/reader").replace(/\/+$/, "");
}

// Eine Reader-Quelle für den Empfang registrieren (Abos + lokaler Listener).
export function registriereReader(src: SourceConfig): void {
  if (!status.has(src.id)) status.set(src.id, { sourceId: src.id, online: null });
  const base = topicBase(src);
  // Retained-Status aus dem lokalen Broker-Cache übernehmen (falls die "online"-
  // Nachricht schon VOR dem Listener-Start eintraf – der interne Listener sieht
  // sonst nur live eintreffende Nachrichten, nicht den retained-Wert).
  try {
    const cached = getLastPayload(`${base}/status`);
    if (cached != null) {
      const st = status.get(src.id)!;
      st.online = cached.trim() === "online";
      status.set(src.id, st);
    }
  } catch { /* ignore */ }
  const extern = !!src.geraeteMqttExtern && !!src.geraeteMqttHost;
  if (extern) {
    const host = src.geraeteMqttHost!; const port = src.geraeteMqttPort ?? 1883;
    subscribeExternal(host, port, `${base}/card`);
    subscribeExternal(host, port, `${base}/pin`);
    subscribeExternal(host, port, `${base}/status`);
  }
  // Beim lokalen Broker liefert onMqttMessage ohnehin alle Topics (siehe init()).
}

// Ein eingehendes Ereignis verarbeiten (von lokal ODER extern).
function verarbeite(src: SourceConfig, topic: string, payload: string): void {
  const base = topicBase(src);
  const jetztIso = new Date().toISOString();
  const st = status.get(src.id) ?? { sourceId: src.id, online: null };

  if (topic === `${base}/status`) {
    st.online = payload.trim() === "online";
    status.set(src.id, st);
    return;
  }
  if (topic === `${base}/card` || topic === `${base}/pin`) {
    let art: "card" | "pin" = topic.endsWith("/pin") ? "pin" : "card";
    let wert = ""; let bits: number | undefined;
    try {
      const j = JSON.parse(payload);
      wert = String(j.value ?? "");
      bits = j.bits != null ? Number(j.bits) : undefined;
      // Vorbehalt aus der Spec: Manche Keypads senden die PIN als CARD-Frame
      // (26 Bit) auf dem card-Topic. Wir belassen die Art beim Topic, geben aber
      // die Bits weiter, damit Schritt 2 das ggf. behandeln kann.
      if (j.type === "PIN") art = "pin";
    } catch {
      wert = payload.trim();
    }
    if (!wert) return;
    // Protokollieren (Schritt 1). Ergebnis/Name folgen in Schritt 2.
    db.addAccessLog({ sourceId: src.id, ts: jetztIso, art, wert, bits });
    st.letztesEreignis = { art, wert, bits, ts: jetztIso };
    status.set(src.id, st);
    // Schritt-2-Hook (Whitelist/Aktionen/Feedback), falls gesetzt.
    try { ereignisHook?.(src, art, wert, bits); } catch { /* ignore */ }
  }
}

// Feedback an den Reader senden (LED/Buzzer). Wird in Schritt 2 genutzt.
export function sendeFeedback(src: SourceConfig, result: "ok" | "denied"): void {
  const base = topicBase(src);
  const payload = JSON.stringify({ result });
  if (src.geraeteMqttExtern && src.geraeteMqttHost) {
    publishExternal(src.geraeteMqttHost, src.geraeteMqttPort ?? 1883, `${base}/cmd`, payload);
  } else {
    publishLocal(`${base}/cmd`, payload);
  }
}

export function getReaderStatus(sourceId: string): ReaderStatus | undefined { return status.get(sourceId); }
export function getAllReaderStatus(): ReaderStatus[] {
  // Vor der Rückgabe den Online-Status mit dem retained Broker-Cache abgleichen,
  // damit auch ein vor dem Listener-Start empfangener Status korrekt erscheint.
  const quellen = quellenGetter?.() ?? [];
  for (const src of quellen) {
    if (src.role !== "accessReader") continue;
    const st = status.get(src.id) ?? { sourceId: src.id, online: null };
    const base = topicBase(src);
    if (st.online === null) {
      try {
        const cached = getLastPayload(`${base}/status`);
        if (cached != null) { st.online = cached.trim() === "online"; }
      } catch { /* ignore */ }
    }
    // Diagnose: kam auf irgendeinem der erwarteten Topics jemals eine Nachricht an?
    st.topicBasis = base;
    try {
      st.nachrichtenEmpfangen = !!(getLastPayload(`${base}/status`) ?? getLastPayload(`${base}/card`) ?? getLastPayload(`${base}/pin`))
        || st.online !== null || st.letztesEreignis != null;
    } catch { /* ignore */ }
    status.set(src.id, st);
  }
  return [...status.values()];
}

// Initialisierung: lokalen Broker-Listener anmelden. Für jede eingehende lokale
// Nachricht prüfen, ob sie zu einer Reader-Quelle gehört.
let quellenGetter: (() => SourceConfig[]) | null = null;
export function initAccessReader(getQuellen: () => SourceConfig[]): void {
  quellenGetter = getQuellen;
  onMqttMessage((topic, payload) => {
    const quellen = quellenGetter?.() ?? [];
    for (const src of quellen) {
      if (src.role !== "accessReader") continue;
      const base = topicBase(src);
      if (topic.startsWith(base + "/")) { verarbeite(src, topic, payload); break; }
    }
  });
  // Externe Reader abonnieren + deren Nachrichten pollen (der externe Client
  // cached die letzte Nachricht; wir prüfen im Poll-Zyklus auf Änderungen).
  for (const src of (getQuellen() ?? [])) {
    if (src.role === "accessReader") registriereReader(src);
  }
}

// Für externe Broker: zuletzt empfangene Nachrichten je Topic abholen und
// verarbeiten (wird vom Poller regelmäßig aufgerufen). Verhindert Doppel-
// verarbeitung über einen einfachen Payload-Vergleich je Topic.
const externLetzte = new Map<string, string>();
export function pollExterneReader(): void {
  const quellen = quellenGetter?.() ?? [];
  for (const src of quellen) {
    if (src.role !== "accessReader" || !src.geraeteMqttExtern || !src.geraeteMqttHost) continue;
    const base = topicBase(src);
    const host = src.geraeteMqttHost; const port = src.geraeteMqttPort ?? 1883;
    for (const suffix of ["card", "pin", "status"]) {
      const topic = `${base}/${suffix}`;
      const payload = getExternalPayload(host, port, topic);
      if (payload == null) continue;
      const key = `${src.id}:${suffix}`;
      // Bei card/pin: nur verarbeiten, wenn sich der Payload geändert hat (neues
      // Ereignis). Da die Payloads ein ms-Feld tragen, sind Wiederholungen selten
      // identisch; Status ist retained und ändert sich nur bei Wechsel.
      if (externLetzte.get(key) === payload) continue;
      externLetzte.set(key, payload);
      verarbeite(src, topic, payload);
    }
  }
}
