// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Philips Hue – lokale CLIP-v2-API-Anbindung.
//
// Eine Hue-Bridge wird als EINE FLUX-Quelle geführt. Ein einziger Poll
// (GET /clip/v2/resource) liefert alle Ressourcen der Bridge; daraus werden die
// physischen Geräte (device) mit ihren Diensten (light, motion, temperature,
// light_level, device_power, …) zu einer flachen Untergeräte-Liste
// zusammengeführt. Die Verwaltung der Geräte bleibt in der Hue-App; FLUX liest
// nur und hält die Liste synchron.
//
// HTTPS-Hinweis: Die Bridge nutzt ein selbstsigniertes Zertifikat. Für die
// lokale Verbindung wird die Zertifikatsprüfung bewusst übersprungen
// (rejectUnauthorized: false) – das ist bei lokalen Hue-Integrationen üblich.

import https from "node:https";

// Ein aus der Bridge abgeleitetes Untergerät (ein Dienst eines Hue-Geräts).
export interface HueSubDevice {
  serviceId: string;      // rid des Dienstes (light/motion/…), stabil
  deviceId: string;       // rid des physischen Geräts (owner)
  name: string;           // Anzeigename (aus der Hue-App)
  kind: HueKind;          // Art des Untergeräts
  room?: string;          // Raumname, falls zuordenbar
  // Zustandswerte je nach Art (nur die belegten sind gesetzt):
  on?: boolean;           // light: an/aus
  brightness?: number;    // light: 0..100
  hatDimmen?: boolean;    // light: unterstützt Helligkeit?
  hatFarbe?: boolean;     // light: unterstützt Farbe (xy)?
  colorX?: number;        // light: aktuelle Farbe X (CIE xy)
  colorY?: number;        // light: aktuelle Farbe Y (CIE xy)
  motion?: boolean | null;// motion: Bewegung erkannt (null = ungültig/kein Wert)
  temperature?: number;   // temperature: °C
  lightLevel?: number;    // light_level: Rohwert (lux-ähnlich, Hue-Skala)
  batteryLevel?: number;  // device_power: 0..100
  reachable?: boolean;    // aus zigbee_connectivity (status "connected")
  unreachable?: boolean;  // seit Karenzzeit unerreichbar -> als "aus" gewertet
  enabled?: boolean;      // Sensor aktiviert?
}

export type HueKind = "light" | "motion" | "temperature" | "light_level" | "device_power" | "button" | "contact" | "other";

export interface HueBridgeSnapshot {
  ok: boolean;
  error?: string;
  bridgeName?: string;
  geraeteAnzahl: number;
  subDevices: HueSubDevice[];
}

// Karenzzeit, nach der eine durchgehend unerreichbare Lampe als "aus" gewertet
// wird (z. B. hart über den Stromschalter ausgeschaltet). Kürzere Funkaussetzer
// werden so toleriert. Je Lampe wird der Beginn der Unerreichbarkeit gemerkt.
const UNREACHABLE_AUS_MS = 60_000;
const unreachableSeit = new Map<string, number>();

const RTYPE_TO_KIND: Record<string, HueKind> = {
  light: "light", motion: "motion", temperature: "temperature",
  light_level: "light_level", device_power: "device_power",
  button: "button", contact: "contact",
};

// Rohe HTTPS-GET-Anfrage an die Bridge (self-signed Cert akzeptiert).
function hueGet(host: string, appKey: string, pfad: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host, port: 443, path: pfad, method: "GET",
        headers: { "hue-application-key": appKey },
        rejectUnauthorized: false, // lokale Bridge, selbstsigniertes Zertifikat
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          // Die Bridge liefert bei falschem Pfad/Key eine HTML-Fehlerseite.
          if (body.trim().startsWith("<")) {
            reject(new Error("Bridge lieferte HTML statt JSON (Pfad/Key prüfen)"));
            return;
          }
          try { resolve(JSON.parse(body)); } catch { reject(new Error("Antwort nicht als JSON lesbar")); }
        });
      },
    );
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.end();
  });
}

// Rohe HTTPS-PUT-Anfrage an die Bridge (self-signed Cert akzeptiert).
function huePut(host: string, appKey: string, pfad: string, body: unknown, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        host, port: 443, path: pfad, method: "PUT",
        headers: { "hue-application-key": appKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        rejectUnauthorized: false, timeout: timeoutMs,
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (b.trim().startsWith("<")) { reject(new Error("Bridge lieferte HTML statt JSON")); return; }
          try {
            const j = JSON.parse(b);
            // Die v2-API liefert bei Fehlern ein errors-Array.
            if (Array.isArray(j?.errors) && j.errors.length) { reject(new Error(j.errors[0]?.description ?? "Hue-Fehler")); return; }
            resolve(j);
          } catch { reject(new Error("Antwort nicht als JSON lesbar")); }
        });
      },
    );
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.write(payload);
    req.end();
  });
}

// Eine Hue-Leuchte schalten/einstellen. on = an/aus; brightness (0..100) und
// Farbe (CIE xy) optional. Werden nur gesendet, wenn eingeschaltet wird.
export async function schalteHueLicht(host: string, appKey: string, serviceId: string, on: boolean, brightness?: number, colorX?: number, colorY?: number): Promise<{ ok: boolean; error?: string }> {
  if (!host || !appKey || !serviceId) return { ok: false, error: "Host/Key/ID fehlt" };
  const body: any = { on: { on } };
  if (on && brightness != null && Number.isFinite(brightness)) {
    body.dimming = { brightness: Math.max(0, Math.min(100, brightness)) };
  }
  if (on && colorX != null && colorY != null && Number.isFinite(colorX) && Number.isFinite(colorY)) {
    body.color = { xy: { x: colorX, y: colorY } };
  }
  try {
    await huePut(host, appKey, `/clip/v2/resource/light/${serviceId}`, body);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Schaltfehler" };
  }
}
export async function pollHueBridge(host: string, appKey: string): Promise<HueBridgeSnapshot> {
  if (!host || !appKey) return { ok: false, error: "Host oder App-Key fehlt", geraeteAnzahl: 0, subDevices: [] };
  let data: any;
  try {
    const resp = await hueGet(host, appKey, "/clip/v2/resource");
    data = resp?.data;
    if (!Array.isArray(data)) return { ok: false, error: "Unerwartete Antwortstruktur", geraeteAnzahl: 0, subDevices: [] };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Fehler beim Abruf", geraeteAnzahl: 0, subDevices: [] };
  }

  // Indizes aufbauen.
  const byId = new Map<string, any>();
  for (const o of data) if (o?.id) byId.set(o.id, o);

  // Gerät -> Name; Dienst -> Gerät (owner). Raumzuordnung über room-Objekte.
  const deviceName = new Map<string, string>();
  const geraete: any[] = [];
  for (const o of data) {
    if (o.type === "device") {
      deviceName.set(o.id, o.metadata?.name ?? "Hue-Gerät");
      geraete.push(o);
    }
  }
  // Raum -> enthält device-rids (children). Dienst-Zuordnung über owner=device.
  const deviceRoom = new Map<string, string>();
  for (const o of data) {
    if (o.type === "room" || o.type === "zone") {
      const rn = o.metadata?.name;
      for (const child of o.children ?? []) {
        if (child?.rtype === "device" && child.rid) deviceRoom.set(child.rid, rn);
      }
    }
  }

  // reachable je Gerät aus zigbee_connectivity ableiten.
  const deviceReachable = new Map<string, boolean>();
  for (const o of data) {
    if (o.type === "zigbee_connectivity" && o.owner?.rtype === "device") {
      deviceReachable.set(o.owner.rid, o.status === "connected");
    }
  }

  const subDevices: HueSubDevice[] = [];
  for (const o of data) {
    const kind = RTYPE_TO_KIND[o.type];
    if (!kind) continue; // nur die relevanten Dienst-Typen
    const ownerId = o.owner?.rtype === "device" ? o.owner.rid : undefined;
    const name = (ownerId && deviceName.get(ownerId)) || o.metadata?.name || o.type;
    const sub: HueSubDevice = {
      serviceId: o.id, deviceId: ownerId ?? o.id, name, kind,
      room: ownerId ? deviceRoom.get(ownerId) : undefined,
      reachable: ownerId ? deviceReachable.get(ownerId) : undefined,
    };
    if (o.type === "light") {
      sub.on = !!o.on?.on;
      if (o.dimming?.brightness != null) { sub.brightness = Math.round(o.dimming.brightness); sub.hatDimmen = true; }
      if (o.color?.xy) {
        sub.hatFarbe = true;
        sub.colorX = o.color.xy.x;
        sub.colorY = o.color.xy.y;
      }
      // Unerreichbare Lampe (z. B. hart über Stromschalter aus): nach einer
      // Karenzzeit als "aus" werten, da der on-Zustand der Bridge dann veraltet
      // ist. Kurze Funkaussetzer werden durch die Karenzzeit toleriert.
      if (sub.reachable === false) {
        const seit = unreachableSeit.get(sub.serviceId) ?? Date.now();
        unreachableSeit.set(sub.serviceId, seit);
        if (Date.now() - seit >= UNREACHABLE_AUS_MS) { sub.on = false; sub.unreachable = true; }
      } else {
        unreachableSeit.delete(sub.serviceId);
      }
    } else if (o.type === "motion") {
      sub.enabled = !!o.enabled;
      sub.motion = o.motion?.motion_valid ? !!o.motion?.motion : null;
    } else if (o.type === "temperature") {
      sub.enabled = !!o.enabled;
      if (o.temperature?.temperature_valid) sub.temperature = o.temperature.temperature;
    } else if (o.type === "light_level") {
      sub.enabled = !!o.enabled;
      if (o.light?.light_level_valid) sub.lightLevel = o.light.light_level;
    } else if (o.type === "device_power") {
      if (o.power_state?.battery_level != null) sub.batteryLevel = o.power_state.battery_level;
    }
    subDevices.push(sub);
  }

  const bridge = data.find((o: any) => o.type === "bridge");
  return {
    ok: true,
    bridgeName: bridge?.bridge_id ? `Hue Bridge ${String(bridge.bridge_id).slice(-6)}` : "Hue Bridge",
    geraeteAnzahl: geraete.length,
    subDevices,
  };
}

// --- Snapshot-Speicher je Bridge-Quelle (für Statusseite, Detektoren, Regeln) ---
const snapshots = new Map<string, HueBridgeSnapshot>();
export function setHueSnapshot(sourceId: string, snap: HueBridgeSnapshot): void {
  snapshots.set(sourceId, snap);
}
export function getHueSnapshot(sourceId: string): HueBridgeSnapshot | undefined {
  return snapshots.get(sourceId);
}
// Alle bekannten Hue-Untergeräte über alle Bridge-Quellen (für Auswahl-Listen).
export function getAllHueSubDevices(): Array<HueSubDevice & { sourceId: string }> {
  const out: Array<HueSubDevice & { sourceId: string }> = [];
  for (const [sid, snap] of snapshots) {
    if (!snap.ok) continue;
    for (const s of snap.subDevices) out.push({ ...s, sourceId: sid });
  }
  return out;
}
