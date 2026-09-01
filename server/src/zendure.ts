// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import type { SourceConfig } from "./sources.js";
import { publishMqtt } from "./mqttClient.js";

// Steuerung von Zendure-SolarFlow-Speichern über die lokale MQTT-Properties-API.
//
// Grundlage ist die offizielle Zendure-Local-API (zenSDK) sowie die von der
// Community dokumentierte MQTT-Schnittstelle: Schreibbare Eigenschaften werden
// auf das Topic  iot/{appKey}/{serial}/properties/write  publiziert. Relevante
// Properties für die Lade-/Entladesteuerung:
//   - acMode:       1 = Eingang/Laden, 2 = Ausgang/Entladen (AC-Geräte)
//   - inputLimit:   maximale Ladeleistung (W)
//   - outputLimit:  maximale Entladeleistung (W)
//   - smartMode:    0 = aus (manuelle Limits gelten)
//
// Hinweis: Die genaue Property-Belegung unterscheidet sich je nach Modell
// (SolarFlow 800/AC vs. Hyper 2000). Wir bilden die verbreitete
// acMode/inputLimit/outputLimit-Variante ab.

export type ZendureMode = "charge" | "discharge" | "idle";

// Baut das Properties-Write-Topic aus appKey und Seriennummer der Quelle.
function writeTopic(appKey: string, serial: string): string {
  return `iot/${appKey}/${serial}/properties/write`;
}

// Erzeugt die Payload für einen Steuerbefehl.
function buildPayload(serial: string, mode: ZendureMode, powerW: number): string {
  const props: Record<string, number> = { smartMode: 0 };
  const p = Math.max(0, Math.round(powerW));
  if (mode === "charge") {
    props.acMode = 1;
    props.inputLimit = p;
    props.outputLimit = 0;
  } else if (mode === "discharge") {
    props.acMode = 2;
    props.outputLimit = p;
    props.inputLimit = 0;
  } else {
    // idle: beide Limits auf 0
    props.outputLimit = 0;
    props.inputLimit = 0;
  }
  return JSON.stringify({ sn: serial, properties: props });
}

// Setzt Modus + Leistung eines Zendure-Speichers per MQTT. Erwartet in der
// Quelle: mqttUrl (Broker) sowie zendureAppKey und zendureSerial.
export async function setZendureMode(
  src: SourceConfig & { zendureAppKey?: string; zendureSerial?: string },
  mode: ZendureMode,
  powerW: number,
  onLog?: (msg: string) => void,
): Promise<void> {
  const appKey = src.zendureAppKey;
  const serial = src.zendureSerial;
  if (!appKey || !serial) {
    throw new Error("Zendure-Steuerung braucht appKey und Seriennummer an der Quelle");
  }
  const topic = writeTopic(appKey, serial);
  const payload = buildPayload(serial, mode, powerW);
  await publishMqtt(src, topic, payload, onLog);
}

// Löst eine Telemetrie-Aktualisierung aus (properties/read), damit aktuelle
// Werte gepusht werden. Optional nutzbar, um Monitoring zu beschleunigen.
export async function requestZendureReport(
  src: SourceConfig & { zendureAppKey?: string; zendureSerial?: string },
  onLog?: (msg: string) => void,
): Promise<void> {
  const appKey = src.zendureAppKey;
  const serial = src.zendureSerial;
  if (!appKey || !serial) return;
  const topic = `iot/${appKey}/${serial}/properties/read`;
  await publishMqtt(src, topic, JSON.stringify({ sn: serial, properties: ["getAll"] }), onLog);
}
