// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Eingebauter MQTT-Broker (Aedes), der im FLUX-Serverprozess läuft.
//
// Lauscht lokal auf Port 1883 ohne Authentifizierung. Erfasst alle eingehenden
// PUBLISH-Nachrichten je Topic (Zähler, Zeitpunkt der letzten Nachricht, letzter
// Payload) für die Anzeige auf der Statusseite. Andere Module (Klima, Lüftung,
// ...) können die zuletzt empfangenen Daten je Topic abfragen.

import net from "node:net";
import { Aedes } from "aedes";
export interface TopicInfo {
  topic: string;
  count: number;        // Anzahl empfangener Nachrichten
  lastTs: number;       // Zeitpunkt der letzten Nachricht (ms)
  lastPayload: string;  // letzter Payload (als Text, gekürzt)
}

const MAX_PAYLOAD_LEN = 4000;         // längere Payloads werden gekürzt
const topics = new Map<string, TopicInfo>();
let broker: Awaited<ReturnType<typeof Aedes.createBroker>> | null = null;
let server: net.Server | null = null;
let laeuft = false;
let letzterFehler: string | null = null;

// Abonnenten, die bei jeder Nachricht benachrichtigt werden wollen (z. B. um
// Gerätezustände aus bestimmten Topics zu aktualisieren).
type Listener = (topic: string, payload: string) => void;
const listeners: Listener[] = [];
export function onMqttMessage(fn: Listener): void { listeners.push(fn); }

export async function startMqttBroker(port = 1883): Promise<void> {
  if (laeuft) return;
  try {
    broker = await Aedes.createBroker();
    server = net.createServer(broker.handle);
    broker.on("publish", (packet: any, _client: any) => {
      // Interne $SYS- und Broker-eigene Nachrichten ignorieren.
      if (!packet.topic || packet.topic.startsWith("$SYS")) return;
      const payloadRaw = packet.payload != null ? packet.payload.toString("utf8") : "";
      const payload = payloadRaw.length > MAX_PAYLOAD_LEN ? payloadRaw.slice(0, MAX_PAYLOAD_LEN) + "…" : payloadRaw;
      const vorhanden = topics.get(packet.topic);
      topics.set(packet.topic, {
        topic: packet.topic,
        count: (vorhanden?.count ?? 0) + 1,
        lastTs: Date.now(),
        lastPayload: payload,
      });
      for (const fn of listeners) { try { fn(packet.topic, payload); } catch { /* ignore */ } }
    });
    server.on("error", (e: any) => { letzterFehler = e?.message ?? String(e); laeuft = false; });
    await new Promise<void>((resolve) => server!.listen(port, () => { laeuft = true; letzterFehler = null; resolve(); }));
  } catch (e: any) {
    letzterFehler = e?.message ?? String(e);
    laeuft = false;
  }
}

export function stopMqttBroker(): void {
  try { server?.close(); } catch { /* ignore */ }
  try { broker?.close(); } catch { /* ignore */ }
  laeuft = false;
}

export function getMqttStatus(): { laeuft: boolean; port: number; topicAnzahl: number; fehler: string | null } {
  return { laeuft, port: 1883, topicAnzahl: topics.size, fehler: letzterFehler };
}

// Alle bekannten Topics (für die Statusseite), sortiert nach Topic-Name.
export function getMqttTopics(): TopicInfo[] {
  return [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}

// Letzten Payload eines bestimmten Topics abfragen (für Geräte-Module).
export function getLastPayload(topic: string): string | undefined {
  return topics.get(topic)?.lastPayload;
}

// Über den lokalen Broker publizieren (für Gerätesteuerung, wenn der lokale
// Broker genutzt wird). Bei externem Broker nutzen die Geräte-Module den
// mqtt-Client (siehe mqttclient.ts).
export function publishLocal(topic: string, payload: string): boolean {
  if (!broker || !laeuft) return false;
  try {
    broker.publish({ cmd: "publish", topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false } as any, () => {});
    return true;
  } catch {
    return false;
  }
}
export function istBrokerAktiv(): boolean { return laeuft; }
