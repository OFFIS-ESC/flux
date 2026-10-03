// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// MQTT-Client für EXTERNE Broker.
//
// Wenn ein Gerät nicht den eingebauten lokalen Broker (Default), sondern einen
// externen Broker nutzt, verbindet sich FLUX hierüber als Client, abonniert die
// benötigten Topics und cached die letzten Nachrichten. Publizieren (Steuerung)
// läuft ebenfalls über diesen Client.
//
// Je Broker (host:port) wird EINE Verbindung gehalten und wiederverwendet.

import mqtt, { type MqttClient } from "mqtt";

interface BrokerConn {
  client: MqttClient;
  letzteNachricht: Map<string, string>; // topic -> letzter Payload
  abos: Set<string>;
}

const conns = new Map<string, BrokerConn>();

function key(host: string, port: number): string { return `${host}:${port}`; }

// Verbindung zu einem externen Broker holen/aufbauen (idempotent).
function getConn(host: string, port: number): BrokerConn {
  const k = key(host, port);
  let c = conns.get(k);
  if (c) return c;
  const client = mqtt.connect(`mqtt://${host}:${port}`, { reconnectPeriod: 5000, connectTimeout: 8000 });
  const conn: BrokerConn = { client, letzteNachricht: new Map(), abos: new Set() };
  client.on("message", (topic, payload) => {
    conn.letzteNachricht.set(topic, payload.toString("utf8"));
  });
  client.on("connect", () => {
    // Nach (Re)Connect alle Abos erneut setzen.
    for (const t of conn.abos) client.subscribe(t);
  });
  conns.set(k, conn);
  return conn;
}

// Ein Topic auf einem externen Broker abonnieren (idempotent).
export function subscribeExternal(host: string, port: number, topic: string): void {
  const conn = getConn(host, port);
  if (conn.abos.has(topic)) return;
  conn.abos.add(topic);
  if (conn.client.connected) conn.client.subscribe(topic);
}

// Letzten Payload eines Topics von einem externen Broker holen.
export function getExternalPayload(host: string, port: number, topic: string): string | undefined {
  return conns.get(key(host, port))?.letzteNachricht.get(topic);
}

// Auf einem externen Broker publizieren.
export function publishExternal(host: string, port: number, topic: string, payload: string): boolean {
  const conn = getConn(host, port);
  try {
    conn.client.publish(topic, payload);
    return true;
  } catch {
    return false;
  }
}
