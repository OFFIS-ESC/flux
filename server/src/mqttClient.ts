// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import mqtt from "mqtt";
import type { MqttClient, IClientOptions } from "mqtt";
import type { SourceConfig } from "./sources.js";

// MQTT-Anbindung für Quellen.
//
// Anders als REST (aktives Polling) ist MQTT push-basiert: Der Client verbindet
// sich mit einem Broker, abonniert die konfigurierten Topics und erhält Werte,
// sobald das Gerät sie publiziert. Wir cachen je Topic die zuletzt empfangene
// Payload; readSource() liest dann synchron aus diesem Cache.
//
// Verbindungen werden je (Broker-URL + Auth) gebündelt: Mehrere Quellen am
// selben Broker teilen sich eine Verbindung. Topics werden nach Bedarf
// abonniert.

interface Conn {
  client: MqttClient;
  key: string;
  topics: Set<string>;
  // letzte Payload je Topic (roher String) + Zeitpunkt
  lastPayload: Map<string, { raw: string; ts: number }>;
  connected: boolean;
  lastError: string | null;
}

const conns = new Map<string, Conn>();

// Eindeutiger Schlüssel je Verbindung (Broker + Auth-Parameter), damit Quellen
// mit identischer Broker-Konfiguration sich eine Verbindung teilen, aber
// unterschiedliche Zugangsdaten getrennte Verbindungen bekommen.
function connKey(src: SourceConfig): string {
  return [
    src.mqttUrl ?? "",
    src.mqttAuthType ?? "none",
    src.mqttUsername ?? "",
    // Passwort/Cert nicht im Klartext in den Key – Hash-artiger Marker reicht,
    // um verschiedene Zugangsdaten zu unterscheiden.
    (src.mqttPassword ? "p" : "") + (src.mqttClientCert ? "c" : ""),
  ].join("|");
}

// Gemeinsame MQTT-Auth-Felder (identisch bei Quellen und extHems-Senken), damit
// buildOptions/publishMqtt sowohl SourceConfig als auch Sink akzeptieren.
export interface MqttAuthConfig {
  mqttUrl?: string;
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientCert?: string;
  mqttClientKey?: string;
  mqttCaCert?: string;
  mqttRejectUnauthorized?: boolean;
}

function buildOptions(src: MqttAuthConfig): IClientOptions {
  const opts: IClientOptions = {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };
  const auth = src.mqttAuthType ?? "none";
  if (auth === "userpass") {
    opts.username = src.mqttUsername;
    opts.password = src.mqttPassword;
  } else if (auth === "clientcert") {
    if (src.mqttClientCert) opts.cert = src.mqttClientCert;
    if (src.mqttClientKey) opts.key = src.mqttClientKey;
    if (src.mqttCaCert) opts.ca = src.mqttCaCert;
    opts.rejectUnauthorized = src.mqttRejectUnauthorized !== false;
  } else if (src.mqttCaCert) {
    // Auch ohne Client-Cert kann eine CA für mqtts sinnvoll sein.
    opts.ca = src.mqttCaCert;
    opts.rejectUnauthorized = src.mqttRejectUnauthorized !== false;
  }
  return opts;
}

function getOrCreateConn(src: SourceConfig, onLog?: (msg: string) => void): Conn | null {
  if (!src.mqttUrl) return null;
  const key = connKey(src);
  let conn = conns.get(key);
  if (conn) return conn;

  const client = mqtt.connect(src.mqttUrl, buildOptions(src));
  conn = {
    client,
    key,
    topics: new Set(),
    lastPayload: new Map(),
    connected: false,
    lastError: null,
  };
  conns.set(key, conn);

  client.on("connect", () => {
    conn!.connected = true;
    conn!.lastError = null;
    // Alle bereits registrierten Topics (neu) abonnieren.
    for (const t of conn!.topics) client.subscribe(t, (err) => {
      if (err && onLog) onLog(`MQTT subscribe ${t}: ${err.message}`);
    });
  });
  client.on("reconnect", () => { if (onLog) onLog(`MQTT reconnect ${src.mqttUrl}`); });
  client.on("close", () => { conn!.connected = false; });
  client.on("error", (err) => {
    conn!.lastError = err?.message ?? String(err);
    if (onLog) onLog(`MQTT error ${src.mqttUrl}: ${conn!.lastError}`);
  });
  client.on("message", (topic, payload) => {
    conn!.lastPayload.set(topic, { raw: payload.toString(), ts: Date.now() });
  });

  return conn;
}

// Registriert (idempotent) das Topic einer MQTT-Quelle und stellt sicher, dass
// die Verbindung besteht und das Topic abonniert ist.
export function ensureMqttSubscription(src: SourceConfig, onLog?: (msg: string) => void): void {
  if ((src.connection ?? "rest") !== "mqtt") return;
  if (!src.mqttUrl || !src.mqttTopic) return;
  const conn = getOrCreateConn(src, onLog);
  if (!conn) return;
  if (!conn.topics.has(src.mqttTopic)) {
    conn.topics.add(src.mqttTopic);
    if (conn.connected) {
      conn.client.subscribe(src.mqttTopic, (err) => {
        if (err && onLog) onLog(`MQTT subscribe ${src.mqttTopic}: ${err.message}`);
      });
    }
  }
}

export interface MqttPayload { raw: string; ts: number; }

// Liefert die zuletzt für die Quelle empfangene Payload (oder null, wenn noch
// nichts angekommen ist / Verbindung fehlt).
export function getMqttPayload(src: SourceConfig): MqttPayload | null {
  if (!src.mqttUrl || !src.mqttTopic) return null;
  const conn = conns.get(connKey(src));
  if (!conn) return null;
  return conn.lastPayload.get(src.mqttTopic) ?? null;
}

export function isMqttConnected(src: SourceConfig): boolean {
  const conn = conns.get(connKey(src));
  return conn?.connected ?? false;
}

// Publiziert eine Nachricht auf ein MQTT-Topic über die (Broker-)Verbindung der
// angegebenen Quelle. Für die Steuerung von Speichern wie Zendure, die über
// MQTT-Properties gesteuert werden. Nutzt/öffnet die Verbindung anhand der
// mqttUrl/Zugangsdaten der Quelle.
export function publishMqtt(
  src: SourceConfig, topic: string, payload: string, onLog?: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!src.mqttUrl) { reject(new Error("keine MQTT-Broker-URL an der Quelle")); return; }
    const conn = getOrCreateConn(src, onLog);
    if (!conn) { reject(new Error("MQTT-Verbindung konnte nicht hergestellt werden")); return; }
    const doPublish = () => {
      conn.client.publish(topic, payload, { qos: 0 }, (err) => {
        if (err) reject(err); else resolve();
      });
    };
    if (conn.connected) doPublish();
    else {
      // Kurz auf Verbindung warten.
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error("MQTT-Verbindungs-Timeout")); } }, 5000);
      conn.client.once("connect", () => { if (!done) { done = true; clearTimeout(to); doPublish(); } });
    }
  });
}

// Einmaliger Verbindungstest für eine MQTT-Quelle: verbindet kurz, abonniert das
// Topic und wartet bis zu timeoutMs auf die erste Nachricht. Nutzt eine eigene,
// sofort wieder geschlossene Verbindung, um die laufenden Abos nicht zu stören.
export function testMqttSource(src: SourceConfig, timeoutMs = 8000): Promise<{ raw: string }> {
  return new Promise((resolve, reject) => {
    if (!src.mqttUrl) { reject(new Error("Broker-URL fehlt")); return; }
    if (!src.mqttTopic) { reject(new Error("Topic fehlt")); return; }
    let done = false;
    const client = mqtt.connect(src.mqttUrl, { ...buildOptions(src), reconnectPeriod: 0 });
    const finish = (err: Error | null, raw?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { client.end(true); } catch { /* ignore */ }
      if (err) reject(err); else resolve({ raw: raw ?? "" });
    };
    const timer = setTimeout(
      () => finish(new Error("Zeitüberschreitung – keine Nachricht auf dem Topic empfangen")),
      timeoutMs,
    );
    client.on("connect", () => {
      client.subscribe(src.mqttTopic!, (err) => {
        if (err) finish(new Error(`Abonnement fehlgeschlagen: ${err.message}`));
      });
    });
    client.on("message", (_topic, payload) => finish(null, payload.toString()));
    client.on("error", (err) => finish(new Error(err?.message ?? String(err))));
  });
}

// Wird nach jeder Quellen-Änderung aufgerufen.
export function reconcileMqtt(sources: SourceConfig[], onLog?: (msg: string) => void): void {
  const needed = new Set<string>();
  for (const s of sources) {
    if ((s.connection ?? "rest") === "mqtt" && s.enabled && s.mqttUrl && s.mqttTopic) {
      needed.add(connKey(s));
      ensureMqttSubscription(s, onLog);
    }
  }
  // Nicht mehr benötigte Verbindungen schließen.
  for (const [key, conn] of conns) {
    if (!needed.has(key)) {
      try { conn.client.end(true); } catch { /* ignore */ }
      conns.delete(key);
    }
  }
}

// --- Publish-Verbindungen (für extHems-Senken) ---
//
// Getrennt von den Subscriber-Verbindungen der Quellen: Senken publizieren nur,
// abonnieren nichts. Verbindungen werden je (Broker + Auth) gebündelt und bei
// Bedarf aufgebaut. Publiziert wird QoS 0 (Statuswerte, retain sorgt dafür, dass
// ein neu verbundenes externes HEMS sofort den letzten Stand erhält).
interface PubConn {
  client: MqttClient;
  connected: boolean;
  lastError: string | null;
}
const pubConns = new Map<string, PubConn>();

function pubKey(cfg: MqttAuthConfig): string {
  return [
    cfg.mqttUrl ?? "",
    cfg.mqttAuthType ?? "none",
    cfg.mqttUsername ?? "",
    (cfg.mqttPassword ? "p" : "") + (cfg.mqttClientCert ? "c" : ""),
  ].join("|");
}

function getOrCreatePubConn(cfg: MqttAuthConfig, onLog?: (msg: string) => void): PubConn | null {
  if (!cfg.mqttUrl) return null;
  const key = pubKey(cfg);
  let conn = pubConns.get(key);
  if (conn) return conn;
  const client = mqtt.connect(cfg.mqttUrl, buildOptions(cfg));
  conn = { client, connected: false, lastError: null };
  client.on("connect", () => { conn!.connected = true; conn!.lastError = null; });
  client.on("close", () => { conn!.connected = false; });
  client.on("error", (err) => {
    conn!.lastError = err?.message ?? String(err);
    if (onLog) onLog(`MQTT publish ${cfg.mqttUrl}: ${conn!.lastError}`);
  });
  pubConns.set(key, conn);
  return conn;
}

// Publiziert eine Nachricht über die (ggf. neu aufgebaute) Publish-Verbindung
// einer extHems-Senke (fire-and-forget mit retain, eigene Verbindungspools).
export function publishExtHemsMqtt(
  cfg: MqttAuthConfig,
  topic: string,
  payload: string,
  retain: boolean,
  onLog?: (msg: string) => void,
): void {
  const conn = getOrCreatePubConn(cfg, onLog);
  if (!conn) return;
  // Auch wenn (noch) nicht verbunden: mqtt.js puffert und sendet nach Connect.
  try {
    conn.client.publish(topic, payload, { qos: 0, retain });
  } catch (e: any) {
    if (onLog) onLog(`MQTT publish ${topic}: ${e?.message ?? String(e)}`);
  }
}

// Räumt Publish-Verbindungen auf, die von keiner aktiven extHems-Senke mehr
// gebraucht werden. keys = Menge der aktuell benötigten pubKey-Werte.
export function reconcilePublishers(keys: Set<string>): void {
  for (const [key, conn] of pubConns) {
    if (!keys.has(key)) {
      try { conn.client.end(true); } catch { /* ignore */ }
      pubConns.delete(key);
    }
  }
}

// Exportiert den pubKey-Berechner, damit der Poller die benötigten Keys bilden kann.
export function publisherKey(cfg: MqttAuthConfig): string {
  return pubKey(cfg);
}
