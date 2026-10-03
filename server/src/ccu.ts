// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Smart-Home-Hub-Anbindung (Homematic CCU3, generisch für spätere Hubs wie HCU).
//
// Eine CCU3 wird als EINE FLUX-Quelle geführt. Ein Poll (XML-API: statelist.cgi)
// liefert alle Geräte mit ihren Kanälen und aktuellen Werten in einem Aufruf;
// daraus wird eine flache Untergeräte-Liste zusammengeführt. Die Verwaltung der
// Geräte bleibt in der CCU/Homematic-App; FLUX liest nur und hält synchron.
//
// Architektur-Hinweis: Der GENERISCHE Teil (Snapshot-Speicher, Untergeräte-Typ,
// öffentliche API) ist bewusst hub-unabhängig gehalten, damit später ein
// HCU-Backend als weitere Implementierung andocken kann, ohne das Drumherum neu
// zu bauen. Nur der CCU-spezifische Teil (pollCcuHub, XML-Parsing) ist konkret.
//
// Voraussetzung: Das XML-API-Addon (jens-maus/XML-API) ist auf der CCU3
// installiert. Es stellt u. a. bereit:
//   /addons/xmlapi/statelist.cgi   – alle Geräte/Kanäle/Zustände (ein Abruf)
//   /addons/xmlapi/statechange.cgi?ise_id=<id>&new_value=<v> – Wert setzen

import http from "node:http";

// Ein aus dem Hub abgeleitetes Untergerät (ein Datenpunkt eines Kanals). Bewusst
// generisch (nicht CCU-spezifisch) für spätere Hub-Typen.
export interface HubSubDevice {
  id: string;          // stabile ID (CCU: ise_id des Datenpunkts; HCU: dev:ch:dp)
  channelId: string;   // ID des Kanals
  name: string;        // Anzeigename (Gerät/Kanal)
  room?: string;       // Raum, falls zuordenbar
  kind: HubKind;       // abgeleitete Art (switch/sensor/climate/shutter/...)
  datapoint: string;   // Name des Datenpunkts (z. B. STATE, LEVEL, shutterLevel)
  wert: number | boolean | string | null; // aktueller Wert
  einheit?: string;    // Einheit, falls vorhanden
  schaltbar?: boolean; // kann dieser Datenpunkt gesetzt werden?
  // Für Funktionsgruppen (HCU): kennzeichnet, dass dies eine Gruppe ist, die als
  // Einheit angesteuert wird (nicht ein Einzelgerät).
  istGruppe?: boolean;
  gruppenId?: string;  // groupId für Gruppen-Schaltbefehle
}

export type HubKind = "switch" | "dimmer" | "shutter" | "contact" | "motion" | "temperature" | "humidity" | "climate" | "button" | "sonstiges";

export interface HubSnapshot {
  rawState?: any; // roher getCurrentState (nur HCU, für Diagnose)
  ok: boolean;
  error?: string;
  hubName?: string;
  geraeteAnzahl: number;
  subDevices: HubSubDevice[];
  // Alarm-/Sicherheitszustand (nur HCU/Homematic mit Sicherheitszonen).
  alarm?: {
    internal: boolean;   // Innenzone scharf?
    external: boolean;   // Außenzone scharf?
    modus: "unscharf" | "anwesenheit" | "vollschutz"; // abgeleiteter Klartext-Modus
    ausgeloest?: boolean; // Alarm aktuell ausgelöst?
  };
  // HCU-Automatisierungen (nur Abruf/Anzeige, nicht änderbar).
  automatisierungen?: Array<{ id: string; name: string; aktiv: boolean; typ: string; zuletzt?: number }>;
}

// Datenpunkt-Namen -> Art (grobe Zuordnung der gängigen Homematic-Typen).
function kindFromDatapoint(dp: string): HubKind {
  const u = dp.toUpperCase();
  if (u === "STATE") return "switch";
  if (u === "LEVEL") return "dimmer";
  if (u.includes("MOTION") || u === "PRESENCE_DETECTION_STATE") return "motion";
  if (u.includes("CONTACT") || u === "WINDOW_STATE" || u === "DOOR_STATE") return "contact";
  if (u.includes("ACTUAL_TEMPERATURE") || u === "TEMPERATURE") return "temperature";
  if (u.includes("HUMIDITY")) return "humidity";
  if (u.includes("SET_POINT_TEMPERATURE") || u === "SET_TEMPERATURE") return "climate";
  if (u.includes("PRESS")) return "button";
  return "sonstiges";
}

// Welche Datenpunkte sind für die Anzeige relevant? (Reduziert das Rauschen der
// vielen internen Kanäle einer CCU.)
const RELEVANTE_DATENPUNKTE = new Set([
  "STATE", "LEVEL", "ACTUAL_TEMPERATURE", "TEMPERATURE", "HUMIDITY",
  "SET_POINT_TEMPERATURE", "SET_TEMPERATURE", "MOTION", "PRESENCE_DETECTION_STATE",
  "WINDOW_STATE", "DOOR_STATE", "ILLUMINATION", "CURRENT", "POWER", "VOLTAGE",
]);

function wertParsen(roh: string, dp: string): number | boolean | string {
  const u = dp.toUpperCase();
  // Boolesche Datenpunkte
  if (u === "STATE" || u.includes("MOTION") || u.includes("CONTACT") || u === "WINDOW_STATE" || u === "PRESENCE_DETECTION_STATE") {
    if (roh === "true" || roh === "1") return true;
    if (roh === "false" || roh === "0") return false;
  }
  const n = Number(roh);
  return Number.isFinite(n) ? n : roh;
}

// --- CCU-spezifisch: HTTP-GET an die XML-API ---
function ccuGet(host: string, port: number, pfad: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: pfad, method: "GET", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.end();
  });
}

// Sehr einfacher, toleranter XML-Attribut-Extraktor (die XML-API liefert flaches,
// gut parsbares XML; wir vermeiden eine schwere XML-Bibliothek).
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// Die statelist.cgi-Antwort parsen. Struktur (vereinfacht):
//   <stateList>
//     <device name=".." ise_id="..">
//       <channel name=".." ise_id="..">
//         <datapoint name=".." type=".." ise_id=".." value=".." valueunit=".." operations=".."/>
//   ...
export function parseCcuStatelist(xml: string): HubSnapshot {
  const devices: HubSubDevice[] = [];
  let geraete = 0;
  // Geräte-Blöcke isolieren
  const deviceBlocks = xml.split(/<device\b/).slice(1);
  for (const db of deviceBlocks) {
    const devTag = "<device " + db.split(">")[0];
    const devName = attr(devTag, "name") ?? "CCU-Gerät";
    geraete++;
    // Kanäle innerhalb dieses Geräts (bis zum nächsten </device>)
    const devInhalt = db.split("</device>")[0];
    const channelBlocks = devInhalt.split(/<channel\b/).slice(1);
    for (const cb of channelBlocks) {
      const chTag = "<channel " + cb.split(">")[0];
      const chName = attr(chTag, "name") ?? devName;
      const chId = attr(chTag, "ise_id") ?? "";
      // Datenpunkte des Kanals
      const dpMatches = cb.match(/<datapoint\b[^>]*\/?>/g) ?? [];
      for (const dpTag of dpMatches) {
        const dpName = attr(dpTag, "type") ?? attr(dpTag, "name") ?? "";
        const dpFull = attr(dpTag, "name") ?? ""; // enthält den Gerätetyp, z.B. HmIP-SWDO...
        const kurz = dpName.includes(".") ? dpName.split(".").pop()! : dpName;
        if (!RELEVANTE_DATENPUNKTE.has(kurz.toUpperCase())) continue;
        const iseId = attr(dpTag, "ise_id") ?? "";
        const roh = attr(dpTag, "value") ?? "";
        const einheit = attr(dpTag, "valueunit") || undefined;
        const ops = attr(dpTag, "operations") ?? ""; // Bitmaske: 2 = write
        // Art bestimmen: STATE ist mehrdeutig (Schaltaktor vs. Fensterkontakt).
        // Über den Gerätetyp im Datenpunkt-Namen unterscheiden.
        let kind = kindFromDatapoint(kurz);
        const opsN = Number(ops);
        const schreibbar = Number.isFinite(opsN) ? (opsN & 2) !== 0 : false;
        if (kurz.toUpperCase() === "STATE") {
          const gt = dpFull.toUpperCase();
          if (gt.includes("SWDO") || gt.includes("SCI") || gt.includes("RCV") || gt.includes("CONTACT")) kind = "contact";
          else if (gt.includes("SMI") || gt.includes("SMO") || gt.includes("MOTION") || gt.includes("PIR")) kind = "motion";
          else if (schreibbar) kind = "switch";
          else kind = "contact"; // nicht schreibbarer STATE -> eher Sensor
        }
        const schaltbar = schreibbar && (kind === "switch" || kind === "dimmer");
        devices.push({
          id: iseId, channelId: chId, name: chName, kind,
          datapoint: kurz, wert: roh === "" ? null : wertParsen(roh, kurz),
          einheit, schaltbar,
        });
      }
    }
  }
  return { ok: true, hubName: "Homematic CCU3", geraeteAnzahl: geraete, subDevices: devices };
}

// Den Hub pollen (CCU3 via XML-API).
export async function pollCcuHub(host: string, port = 80): Promise<HubSnapshot> {
  if (!host) return { ok: false, error: "Host fehlt", geraeteAnzahl: 0, subDevices: [] };
  try {
    const xml = await ccuGet(host, port, "/addons/xmlapi/statelist.cgi");
    if (!xml || xml.trim().startsWith("<!DOCTYPE") || xml.includes("<html")) {
      return { ok: false, error: "XML-API nicht erreichbar (Addon installiert?)", geraeteAnzahl: 0, subDevices: [] };
    }
    return parseCcuStatelist(xml);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Fehler beim Abruf", geraeteAnzahl: 0, subDevices: [] };
  }
}

// Einen Datenpunkt setzen (schalten/dimmen) über statechange.cgi.
export async function schalteCcuDatenpunkt(host: string, port: number, iseId: string, wert: number | boolean): Promise<{ ok: boolean; error?: string }> {
  if (!host || !iseId) return { ok: false, error: "Host/ID fehlt" };
  const v = typeof wert === "boolean" ? (wert ? "true" : "false") : String(wert);
  try {
    const resp = await ccuGet(host, port || 80, `/addons/xmlapi/statechange.cgi?ise_id=${encodeURIComponent(iseId)}&new_value=${encodeURIComponent(v)}`);
    if (resp.includes("not_found") || resp.includes("<error")) return { ok: false, error: "CCU meldete Fehler" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Schaltfehler" };
  }
}

// --- Generischer Snapshot-Speicher (hub-unabhängig) ---
const snapshots = new Map<string, HubSnapshot>();

// =====================================================================
// HCU-Backend (Homematic IP Home Control Unit) über die lokale API.
//
// Die HCU bietet lokalen Zugriff über eine REST-API (Zustandsabruf) und
// WebSocket (Echtzeit-Events). FLUX nutzt den REST-Zustandsabruf per Polling –
// analog zu Hue/CCU3, robust und ohne fragile Dauerverbindung. Authentifiziert
// wird mit einem Auth-Token (per Knopfdruck an der HCU erzeugt) und der
// SGTIN/Access-Point-ID; beide gehen als Header (AUTHTOKEN, CLIENTAUTH) mit.
//
// WICHTIG – ehrlicher Hinweis: Diese Anbindung ist gegen die dokumentierte
// JSON-Struktur der Homematic-IP-API gebaut, NICHT gegen eine echte HCU. Beim
// ersten echten Kontakt sind Anpassungen wahrscheinlich (Endpunkt-Pfad,
// Header-Format, Zertifikatsbehandlung). Die Parserstruktur ist bewusst tolerant.
// =====================================================================

import https from "node:https";
import crypto from "node:crypto";

interface HcuConfig { host: string; port?: number; authToken?: string; sgtin?: string; }

// Vollständige clientCharacteristics. WICHTIG: Die HCU1 lehnt einen Aufruf mit nur
// { apiVersion } als INVALID_REQUEST ab – sie erwartet den vollständigen Satz
// (bestätigt gegen echte HCU1). apiVersion "10" ist der von der HCU akzeptierte Wert.
const CLIENT_CHARACTERISTICS = {
  apiVersion: "10",
  applicationIdentifier: "flux",
  applicationVersion: "1.0",
  deviceManufacturer: "none",
  deviceType: "Computer",
  language: "de-DE",
  osType: "macOS",
  osVersion: "14",
};

// CLIENTAUTH = SHA512(sgtin + "jiLpVitHvWnIGD1yo7MA"). Der Suffix ist der bekannte
// feste Client-Auth-Wert der Homematic-IP-API (aus den offenen Projekten).
function clientAuth(sgtin: string): string {
  return crypto.createHash("sha512").update(sgtin + "jiLpVitHvWnIGD1yo7MA").digest("hex").toUpperCase();
}

function hcuRequest(cfg: HcuConfig, pfad: string, bodyObj?: unknown, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(bodyObj ?? {});
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "VERSION": "12",
      "Content-Length": String(Buffer.byteLength(payload)),
    };
    if (cfg.authToken) headers["AUTHTOKEN"] = cfg.authToken;
    if (cfg.sgtin) headers["CLIENTAUTH"] = clientAuth(cfg.sgtin);
    const req = https.request(
      { host: cfg.host, port: cfg.port ?? 6969, path: pfad, method: "POST", headers, rejectUnauthorized: false, timeout: timeoutMs },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (b.trim().startsWith("<")) { reject(new Error("HCU lieferte HTML statt JSON (Token/SGTIN prüfen)")); return; }
          const status = res.statusCode ?? 0;
          // HCU-Steuerbefehle antworten mit 200 (oft leerer Body). Ein Fehlerstatus
          // (4xx/5xx) bedeutet, dass der Endpunkt/die Parameter nicht akzeptiert
          // wurden – das muss als Fehler durchschlagen, sonst wirkt ein
          // fehlgeschlagenes Schalten wie "nichts passiert".
          if (status >= 400) {
            let detail = b.trim();
            try { const j = JSON.parse(b); detail = j?.errorCode || j?.message || detail; } catch { /* Rohtext */ }
            reject(new Error(`HCU HTTP ${status}${detail ? `: ${detail}` : ""} (Pfad ${pfad})`));
            return;
          }
          try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
        });
      },
    );
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.write(payload);
    req.end();
  });
}

// functionalChannelType -> HubKind (grobe Zuordnung der gängigen HmIP-Kanäle).
function kindFromChannelType(ct: string): HubKind {
  const u = (ct || "").toUpperCase();
  if (u.includes("CONTACT") || u.includes("ROTARY_HANDLE")) return "contact";
  if (u.includes("MOTION") || u.includes("PRESENCE")) return "motion";
  if (u.includes("SWITCH")) return "switch";
  if (u.includes("DIMMER") || u.includes("BRIGHTNESS")) return "dimmer";
  if (u.includes("SHUTTER") || u.includes("BLIND")) return "dimmer";
  if (u.includes("CLIMATE") || u.includes("HEATING") || u.includes("WALL_MOUNTED_THERMOSTAT")) return "climate";
  if (u.includes("SMOKE") || u.includes("WATER") || u.includes("ALARM")) return "sonstiges";
  return "sonstiges";
}

// Aus einem functionalChannel ALLE relevanten Zustandswerte ziehen (ein Kanal
// kann mehrere haben, z. B. Thermostat: Ist-Temp, Soll-Temp, Feuchte).
function extractChannelStates(ch: any): Array<{ datapoint: string; wert: number | boolean | string | null; einheit?: string; schaltbar: boolean }> {
  const out: Array<{ datapoint: string; wert: number | boolean | string | null; einheit?: string; schaltbar: boolean }> = [];
  const t = (ch.functionalChannelType || "").toUpperCase();
  if (t.includes("SWITCH") && ch.on != null) out.push({ datapoint: "on", wert: !!ch.on, schaltbar: true });
  if (ch.dimLevel != null) out.push({ datapoint: "dimLevel", wert: Math.round(ch.dimLevel * 100), einheit: "%", schaltbar: true });
  if (ch.shutterLevel != null) out.push({ datapoint: "shutterLevel", wert: Math.round(ch.shutterLevel * 100), einheit: "%", schaltbar: true });
  // Fenster-/Türkontakt: Kanaltyp SHUTTER_CONTACT_CHANNEL bzw. channelRole
  // WINDOW_SENSOR/DOOR. Der Zustand liegt direkt als STRING "CLOSED"/"OPEN" auf
  // diesem Kanal. Ein Boolean-windowState anderswo meint NICHT den Kontaktzustand.
  const chRolle = (ch.channelRole || "").toUpperCase();
  const istKontaktKanal = t.includes("CONTACT") || t.includes("ROTARY_HANDLE")
    || chRolle.includes("WINDOW") || chRolle.includes("DOOR");
  if (istKontaktKanal && typeof ch.windowState === "string") {
    out.push({ datapoint: "windowState", wert: ch.windowState.toUpperCase() !== "CLOSED", schaltbar: false });
  }
  if (ch.presenceDetected != null) out.push({ datapoint: "presence", wert: !!ch.presenceDetected, schaltbar: false });
  if (ch.motionDetected != null) out.push({ datapoint: "motion", wert: !!ch.motionDetected, schaltbar: false });
  // Temperatur: Ist-Wert (verschiedene Feldnamen je Gerät)
  const ist = ch.actualTemperature ?? ch.valveActualTemperature;
  if (ist != null) out.push({ datapoint: "actualTemperature", wert: ist, einheit: "°C", schaltbar: false });
  if (ch.setPointTemperature != null) out.push({ datapoint: "setPointTemperature", wert: ch.setPointTemperature, einheit: "°C", schaltbar: true });
  if (ch.humidity != null) out.push({ datapoint: "humidity", wert: ch.humidity, einheit: "%", schaltbar: false });
  return out;
}

async function pollHcuHub(cfg: HcuConfig): Promise<HubSnapshot> {
  if (!cfg.host || !cfg.authToken || !cfg.sgtin) {
    return { ok: false, error: "HCU: Host, Auth-Token und SGTIN erforderlich", geraeteAnzahl: 0, subDevices: [] };
  }
  let state: any;
  try {
    state = await hcuRequest(cfg, "/hmip/home/getCurrentState", { clientCharacteristics: CLIENT_CHARACTERISTICS });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "HCU-Abruf fehlgeschlagen", geraeteAnzahl: 0, subDevices: [] };
  }
  const devicesObj = state?.devices;
  if (!devicesObj || typeof devicesObj !== "object") {
    return { ok: false, error: "Unerwartete HCU-Antwort (keine devices)", geraeteAnzahl: 0, subDevices: [] };
  }
  // Gruppen (Räume) auflösen: groups mit type METAGROUP/... enthalten Labels.
  const groups = state?.groups ?? {};
  // Nur META-Gruppen sind echte RÄUME. Alle anderen Gruppentypen (SECURITY_ZONE
  // "PRESENCE", EXTENDED_LINKED_SHUTTER "Obergeschoss", HEATING, INDOOR_CLIMATE,
  // SWITCHING, LOCK_OUT_PROTECTION_RULE usw.) sind Funktionsgruppen und dürfen NICHT
  // als Raum eines Geräts erscheinen.
  const raumLabel = new Map<string, string>();   // gid -> Raumname (nur META)
  const groupLabel = new Map<string, string>();  // gid -> Label (alle, für Gruppen-Anzeige)
  for (const gid of Object.keys(groups)) {
    const g = groups[gid];
    if (g?.label) {
      groupLabel.set(gid, g.label.trim());
      if ((g.type || "").toUpperCase() === "META") raumLabel.set(gid, g.label.trim());
    }
  }
  // Die Menge aller Raumnamen (für Namensabgleich als Fallback).
  const raumNamen = new Set([...raumLabel.values()]);
  // Den echten Raum (META) eines Kanals bestimmen: direkt META, per metaGroupId,
  // oder Fallback über eine Kanal-Gruppe mit Raumnamen (z. B. Shutter-Gruppe "Büro").
  const raumFuerKanal = (chGroups: string[] | undefined): string | undefined => {
    for (const gid of chGroups ?? []) {
      const direkt = raumLabel.get(gid);
      if (direkt) return direkt;
      const meta = groups[gid]?.metaGroupId;
      if (meta && raumLabel.get(meta)) return raumLabel.get(meta);
    }
    for (const gid of chGroups ?? []) {
      const lbl = groups[gid]?.label?.trim();
      if (lbl && raumNamen.has(lbl)) return lbl;
    }
    return undefined;
  };

  const subDevices: HubSubDevice[] = [];
  let geraete = 0;
  for (const devId of Object.keys(devicesObj)) {
    const dev = devicesObj[devId];
    geraete++;
    const devName = dev?.label || "HmIP-Gerät";
    const channels = dev?.functionalChannels ?? {};
    for (const chIdx of Object.keys(channels)) {
      const ch = channels[chIdx];
      const states = extractChannelStates(ch);
      if (states.length === 0) continue;
      // Raum aus der META-Gruppe (echter Raum), nicht aus irgendeiner Gruppe.
      let room: string | undefined = raumFuerKanal(ch.groups);
      const kind = kindFromChannelType(ch.functionalChannelType);
      for (const st of states) {
        // Feinere kind-Zuordnung je Datenpunkt.
        let stKind = kind;
        if (st.datapoint === "actualTemperature") stKind = "temperature";
        else if (st.datapoint === "humidity") stKind = "humidity";
        else if (st.datapoint === "shutterLevel") stKind = "shutter";
        else if (st.datapoint === "dimLevel") stKind = "dimmer";
        subDevices.push({
          id: `${devId}:${chIdx}:${st.datapoint}`, // Gerät+Kanal+Datenpunkt = eindeutig
          channelId: String(chIdx),
          name: ch.label || devName,
          room,
          kind: stKind,
          datapoint: st.datapoint,
          wert: st.wert,
          einheit: st.einheit,
          schaltbar: st.schaltbar,
        });
      }
    }
  }

  // Rollladen-Gruppen: Die HCU führt Rollladen-Sammelgruppen als Typ
  // EXTENDED_LINKED_SHUTTER (Raum-Gruppen wie "Büro"/"Badezimmer" UND Etagen-
  // Gruppen wie "Obergeschoss"/"Erdgeschoss"). Alle als steuerbare Gruppen
  // anbieten – für raum- und etagenweises Fahren.
  for (const gid of Object.keys(groups)) {
    const g = groups[gid];
    if ((g?.type || "").toUpperCase() !== "EXTENDED_LINKED_SHUTTER") continue;
    if (!g?.label) continue;
    subDevices.push({
      id: `group:${gid}`,
      channelId: "",
      name: g.label.trim(),
      room: undefined,
      kind: "shutter",
      datapoint: "shutterLevel",
      wert: g.shutterLevel != null ? Math.round(g.shutterLevel * 100) : null,
      einheit: "%",
      schaltbar: true,
      istGruppe: true,
      gruppenId: gid,
    });
  }

  // Alarm-/Sicherheitszustand aus home.functionalHomes.SECURITY_AND_ALARM ablesen.
  let alarm: HubSnapshot["alarm"];
  try {
    const sec = state?.home?.functionalHomes?.SECURITY_AND_ALARM;
    if (sec) {
      const za = sec.securityZoneActivationMode; // z.B. "ACTIVATION_WITH_DEVICE_IGNORELIST"
      // Die tatsächliche Scharfschaltung steht in den Sicherheitszonen-Gruppen.
      let internal = false, external = false;
      for (const gid of Object.keys(groups)) {
        const g = groups[gid];
        const t = (g?.type || "").toUpperCase();
        if (t === "SECURITY_ZONE") {
          if ((g.label || "").toUpperCase().includes("INTERNAL") || g.zoneType === "INTERNAL") internal = !!g.active;
          if ((g.label || "").toUpperCase().includes("EXTERNAL") || g.zoneType === "EXTERNAL") external = !!g.active;
        }
      }
      void za;
      const modus = internal && external ? "vollschutz" : (external ? "anwesenheit" : "unscharf");
      alarm = { internal, external, modus, ausgeloest: !!sec.alarmActive };
    }
  } catch { /* Alarm optional */ }

  // HCU-Automatisierungen (nur Abruf). In der API sind das "homeAutomation"-
  // Einträge bzw. Regeln; Struktur variiert – tolerant auslesen. Wenn die API
  // einen letzten Auslösezeitpunkt liefert, wird er mitgegeben.
  let automatisierungen: HubSnapshot["automatisierungen"];
  try {
    const rules = state?.home?.ruleMetaDatas ?? state?.ruleMetaDatas ?? {};
    const arr: NonNullable<HubSnapshot["automatisierungen"]> = [];
    for (const rid of Object.keys(rules)) {
      const r = rules[rid];
      // Verschiedene mögliche Felder für den letzten Auslösezeitpunkt (ms seit
      // Epoche). Die HCU-API ist hier nicht einheitlich – mehrere Kandidaten prüfen.
      const lastMs = r?.lastExecutionTimestamp ?? r?.lastExecution ?? r?.lastTriggerTimestamp
        ?? r?.lastActivationTimestamp ?? r?.lastTimeTriggered ?? null;
      arr.push({
        id: rid,
        name: r?.label || "Automatisierung",
        aktiv: r?.active !== false,
        typ: r?.type || "?",
        zuletzt: typeof lastMs === "number" && lastMs > 0 ? lastMs : undefined,
      });
    }
    if (arr.length) automatisierungen = arr;
  } catch { /* optional */ }

  return { ok: true, hubName: "Homematic IP HCU", geraeteAnzahl: geraete, subDevices, alarm, automatisierungen, rawState: state };
}

// Schaltbefehl an ein HCU-Untergerät. Der Wert-Typ bestimmt die Aktion:
//   - boolean: Schaltkanal an/aus (oder Gruppen-Schalten)
//   - Zahl 0..100: Rollladen-/Dimmer-Position (Prozent)
//   - "stop": Rollladen stoppen
async function schalteHcuDatenpunkt(cfg: HcuConfig, id: string, wert: number | boolean | "stop"): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.host || !cfg.authToken || !cfg.sgtin) return { ok: false, error: "HCU: Zugangsdaten fehlen" };

  // Gruppen-Befehl? id = "group:<gid>" (Rollladen-Gruppe, Typ EXTENDED_LINKED_SHUTTER).
  // Der korrekte HmIP-Endpunkt für Rollladen-Gruppen ist group/switching/setShutterLevel
  // bzw. group/switching/stop (bestätigt gegen die homematicip-Referenzbibliothek).
  if (id.startsWith("group:")) {
    const gid = id.slice("group:".length);
    try {
      if (wert === "stop") {
        await hcuRequest(cfg, "/hmip/group/switching/stop", { groupId: gid });
      } else if (typeof wert === "number") {
        await hcuRequest(cfg, "/hmip/group/switching/setShutterLevel", { groupId: gid, shutterLevel: Math.max(0, Math.min(1, wert / 100)) });
      } else {
        await hcuRequest(cfg, "/hmip/group/switching/setShutterLevel", { groupId: gid, shutterLevel: wert ? 1 : 0 });
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "HCU-Gruppenschaltfehler" };
    }
  }

  // Einzelgerät: id = "<deviceId>:<channelIndex>:<datapoint>"
  const teile = id.split(":");
  const deviceId = teile[0];
  const channelIndex = teile[1] != null ? Number(teile[1]) : 1;
  const datapoint = teile[2] ?? "on";
  if (!deviceId) return { ok: false, error: "Ungültige Geräte-ID" };
  try {
    if (datapoint === "shutterLevel") {
      if (wert === "stop") {
        await hcuRequest(cfg, "/hmip/device/control/stop", { deviceId, channelIndex });
      } else if (typeof wert === "number") {
        // FLUX-Prozent (0=offen..100=zu) -> HmIP shutterLevel (0.0=offen..1.0=zu)
        await hcuRequest(cfg, "/hmip/device/control/setShutterLevel", { deviceId, channelIndex, shutterLevel: Math.max(0, Math.min(1, wert / 100)) });
      }
    } else if (datapoint === "dimLevel") {
      const lvl = typeof wert === "number" ? Math.max(0, Math.min(1, wert / 100)) : (wert ? 1 : 0);
      await hcuRequest(cfg, "/hmip/device/control/setDimLevel", { deviceId, channelIndex, dimLevel: lvl });
    } else if (datapoint === "setPointTemperature") {
      if (typeof wert === "number") await hcuRequest(cfg, "/hmip/device/control/setSetPointTemperature", { deviceId, channelIndex, setPointTemperature: wert });
    } else {
      // Schaltkanal
      await hcuRequest(cfg, "/hmip/device/control/setSwitchState", { deviceId, channelIndex, on: !!wert });
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "HCU-Schaltfehler" };
  }
}

// --- Generische Hub-Weiche: wählt anhand hubTyp das passende Backend ---
// Bekommt die volle relevante Config, damit hub-spezifische Felder (HCU-Token)
// durchgereicht werden können.
export interface HubConfig {
  hubTyp?: "ccu3" | "hcu";
  host: string; port?: number;
  hcuAuthToken?: string; hcuSgtin?: string;
}
export async function pollHub(cfg: HubConfig): Promise<HubSnapshot> {
  if (cfg.hubTyp === "hcu") return pollHcuHub({ host: cfg.host, port: cfg.port, authToken: cfg.hcuAuthToken, sgtin: cfg.hcuSgtin });
  return pollCcuHub(cfg.host, cfg.port ?? 80);
}
export async function schalteHub(cfg: HubConfig, id: string, wert: number | boolean | "stop"): Promise<{ ok: boolean; error?: string }> {
  if (cfg.hubTyp === "hcu") return schalteHcuDatenpunkt({ host: cfg.host, port: cfg.port, authToken: cfg.hcuAuthToken, sgtin: cfg.hcuSgtin }, id, wert);
  // CCU3 kennt bislang nur bool/Zahl; "stop" wird dort ignoriert.
  if (wert === "stop") return { ok: false, error: "Stop wird für CCU3 (noch) nicht unterstützt" };
  return schalteCcuDatenpunkt(cfg.host, cfg.port ?? 80, id, wert);
}

// --- Alarm-/Sicherheitsfunktionen (nur HCU) ---
// Modi: unscharf (beide Zonen aus), anwesenheit (nur Außenhaut), vollschutz (beide).
export async function setAlarmModus(cfg: HubConfig, modus: "unscharf" | "anwesenheit" | "vollschutz"): Promise<{ ok: boolean; error?: string }> {
  if (cfg.hubTyp !== "hcu") return { ok: false, error: "Alarm nur für HCU verfügbar" };
  const hcfg: HcuConfig = { host: cfg.host, port: cfg.port, authToken: cfg.hcuAuthToken, sgtin: cfg.hcuSgtin };
  const internal = modus === "vollschutz";
  const external = modus === "vollschutz" || modus === "anwesenheit";
  try {
    await hcuRequest(hcfg, "/hmip/home/security/setZonesActivation", { zonesActivation: { EXTERNAL: external, INTERNAL: internal } });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Alarm-Schaltfehler" };
  }
}

// Sirene / Intrusion-Alarm manuell auslösen bzw. beenden. Sicherheitskritisch –
// im Frontend zusätzlich mit Bestätigungsabfrage abgesichert.
export async function loeseSirenAus(cfg: HubConfig, ausloesen: boolean): Promise<{ ok: boolean; error?: string }> {
  if (cfg.hubTyp !== "hcu") return { ok: false, error: "Sirene nur für HCU verfügbar" };
  const hcfg: HcuConfig = { host: cfg.host, port: cfg.port, authToken: cfg.hcuAuthToken, sgtin: cfg.hcuSgtin };
  try {
    await hcuRequest(hcfg, "/hmip/home/security/setIntrusionAlertThroughSmokeDetectors", { intrusionAlertThroughSmokeDetectors: ausloesen });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Sirenen-Fehler" };
  }
}

export function setHubSnapshot(sourceId: string, snap: HubSnapshot): void { snapshots.set(sourceId, snap); }
export function getHubSnapshot(sourceId: string): HubSnapshot | undefined { return snapshots.get(sourceId); }
export function getAllHubSubDevices(): Array<HubSubDevice & { sourceId: string }> {
  const out: Array<HubSubDevice & { sourceId: string }> = [];
  for (const [sid, snap] of snapshots) {
    if (!snap.ok) continue;
    for (const s of snap.subDevices) out.push({ ...s, sourceId: sid });
  }
  return out;
}
