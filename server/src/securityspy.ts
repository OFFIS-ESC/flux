// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// SecuritySpy-Anbindung (Überwachungssoftware von Ben Software).
//
// Eine SecuritySpy-Installation wird als EINE FLUX-Quelle geführt. Über die
// dokumentierte Web-API (++systemInfo) wird die Kameraliste eingelesen. Die
// Live-Bilder werden als sich aktualisierende JPEG-Snapshots eingebunden
// (robuster und CPU-schonender als dauerhafte MJPEG-Streams). Aufnahmen und
// Bewegungs-/Klassifikations-Events folgen in weiteren Schritten.
//
// Web-API-Endpunkte (siehe bensoftware.com/securityspy/web-server-spec.html):
//   /++systemInfo                – Server- und Kameraliste (XML)
//   /++image?cameraNum=N         – aktuelles JPEG-Standbild einer Kamera
//   /++video?cameraNum=N         – MJPEG-Livestream einer Kamera
// Authentifizierung per HTTP-Basic (Benutzer:Passwort).

import http from "node:http";

export interface SsCamera {
  number: number;         // Kameranummer (für Bild-/Video-URLs)
  name: string;           // Anzeigename
  connected: boolean;     // Kamera verbunden?
  width?: number;
  height?: number;
  mdEnabled?: boolean;    // Bewegungserkennung aktiv?
  secondsSinceMotion?: number | null; // Sekunden seit letzter Bewegung
}

export interface SsSnapshot {
  ok: boolean;
  error?: string;
  serverName?: string;
  version?: string;
  cameras: SsCamera[];
}

export interface SsConfig { host: string; port?: number; user?: string; pass?: string; }

// Einfacher Tag-Extraktor für das flache SecuritySpy-XML.
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1].trim()) : undefined;
}
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function ssGet(cfg: SsConfig, pfad: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (cfg.user != null) {
      const auth = Buffer.from(`${cfg.user}:${cfg.pass ?? ""}`).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }
    const req = http.request(
      { host: cfg.host, port: cfg.port ?? 8000, path: pfad, method: "GET", headers, timeout: timeoutMs },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(b));
      },
    );
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
    req.end();
  });
}

// Die ++systemInfo-XML-Antwort parsen (Kameraliste).
export function parseSystemInfo(xml: string): SsSnapshot {
  if (!xml || !xml.includes("<system")) {
    return { ok: false, error: "Unerwartete Antwort (kein <system>)", cameras: [] };
  }
  const serverName = tag(xml, "server-name") || tag(xml, "name");
  const version = tag(xml, "version");
  const cameras: SsCamera[] = [];
  // Kamera-Blöcke isolieren.
  const camBlocks = xml.split(/<camera>/).slice(1).map((b) => b.split("</camera>")[0]);
  for (const cb of camBlocks) {
    const numStr = tag(cb, "number");
    if (numStr == null) continue;
    const smStr = tag(cb, "timesincelastmotion");
    cameras.push({
      number: Number(numStr),
      name: tag(cb, "name") || `Kamera ${numStr}`,
      connected: (tag(cb, "connected") ?? "").toLowerCase() === "yes",
      width: tag(cb, "width") ? Number(tag(cb, "width")) : undefined,
      height: tag(cb, "height") ? Number(tag(cb, "height")) : undefined,
      mdEnabled: (tag(cb, "md_enabled") ?? "").toLowerCase() === "yes",
      secondsSinceMotion: smStr != null && smStr !== "" ? Number(smStr) : null,
    });
  }
  return { ok: true, serverName, version, cameras };
}

export async function pollSecuritySpy(cfg: SsConfig): Promise<SsSnapshot> {
  if (!cfg.host) return { ok: false, error: "Host fehlt", cameras: [] };
  try {
    const xml = await ssGet(cfg, "/++systemInfo");
    if (xml.includes("<html") || xml.trim().startsWith("<!DOCTYPE")) {
      return { ok: false, error: "Web-Server nicht erreichbar oder Zugang falsch", cameras: [] };
    }
    return parseSystemInfo(xml);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Abruf fehlgeschlagen", cameras: [] };
  }
}

// --- Snapshot-Speicher je SecuritySpy-Quelle ---
const snapshots = new Map<string, SsSnapshot>();

// === Event-Stream (Bewegung + KI-Klassifikation) ===
// Der ++eventStream ist eine langlebige HTTP-Verbindung, die der SERVER offen
// hält, um Ereignisse zu empfangen. Zeilen sind CR-getrennt. Erkannte Ereignisse
// (Bewegung, Klassifikation) werden als kurzlebige "Impulse" abgelegt, die die
// Regel-Auswertung als Auslöser abfragt (Taster-Charakter).
//
// Ein Impuls je (sourceId, kameraNummer, art) mit Ablaufzeit. art:
//   "motion"  – Bewegung erkannt
//   "human" / "vehicle" / "animal" – KI-Klassifikation über Schwelle
export type SsEventArt = "motion" | "human" | "vehicle" | "animal";
interface SsImpuls { bis: number; }
const impulse = new Map<string, SsImpuls>(); // key: `${sourceId}|${cam}|${art}`
const IMPULS_MS = 4000;           // wie lange ein Ereignis als "aktiv" gilt
const CLASSIFY_SCHWELLE = 50;     // ab wieviel % gilt eine Klassifikation als erkannt

function setzeImpuls(sourceId: string, cam: number, art: SsEventArt): void {
  impulse.set(`${sourceId}|${cam}|${art}`, { bis: Date.now() + IMPULS_MS });
}
// Für die Regel-Auswertung: ist gerade ein Ereignis aktiv? (verfällt nach IMPULS_MS)
export function hatSsEreignis(sourceId: string, cam: number, art: SsEventArt): boolean {
  const imp = impulse.get(`${sourceId}|${cam}|${art}`);
  return imp != null && Date.now() < imp.bis;
}

// Eine einzelne Event-Stream-Zeile verarbeiten.
// Beispielzeilen (Format: ISO-Zeit NUMMER KAMERA TYP [INFO...]):
//   2026-09-06T13:24:04 123 2 MOTION
//   2026-09-06T13:24:04 124 2 CLASSIFY 0 88   (Info: Klasse-Index, Prozent) – Variante
// Da das INFO-Feld je Version variiert, werten wir tolerant aus.
function verarbeiteEventZeile(sourceId: string, zeile: string): void {
  const z = zeile.trim();
  if (!z || z.includes("NULL")) return; // Heartbeat ignorieren
  const teile = z.split(/\s+/);
  if (teile.length < 4) return;
  // Kameranummer und Typ finden (Typ ist ein Großbuchstaben-Token).
  const typIdx = teile.findIndex((t) => /^[A-Z_]{3,}$/.test(t));
  if (typIdx < 1) return;
  const cam = Number(teile[typIdx - 1]);
  const typ = teile[typIdx];
  const rest = teile.slice(typIdx + 1);
  if (!Number.isFinite(cam)) return;
  if (typ === "MOTION" || typ === "TRIGGER_M") {
    setzeImpuls(sourceId, cam, "motion");
  } else if (typ === "CLASSIFY") {
    // Echtes Format (aus Live-Daten bestätigt):
    //   CLASSIFY HUMAN 97 VEHICLE 16 ANIMAL 22
    // Klassennamen als Wörter, gefolgt von der Prozentzahl. Jede Klasse über der
    // Schwelle löst ihren Impuls aus.
    for (let i = 0; i < rest.length - 1; i++) {
      const wort = rest[i].toUpperCase();
      const proz = Number(rest[i + 1]);
      if (!Number.isFinite(proz) || proz < CLASSIFY_SCHWELLE) continue;
      if (wort === "HUMAN") setzeImpuls(sourceId, cam, "human");
      else if (wort === "VEHICLE") setzeImpuls(sourceId, cam, "vehicle");
      else if (wort === "ANIMAL") setzeImpuls(sourceId, cam, "animal");
    }
  }
}

// Event-Stream je Quelle offen halten (mit automatischem Reconnect).
const streamAktiv = new Map<string, boolean>();
export function starteEventStream(sourceId: string, cfg: SsConfig): void {
  if (streamAktiv.get(sourceId)) return; // schon aktiv
  streamAktiv.set(sourceId, true);

  const verbinde = () => {
    if (!streamAktiv.get(sourceId)) return;
    const headers: Record<string, string> = {};
    if (cfg.user != null) {
      const auth = Buffer.from(`${cfg.user}:${cfg.pass ?? ""}`).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }
    const req = http.request(
      { host: cfg.host, port: cfg.port ?? 8000, path: "/++eventStream?version=3", method: "GET", headers },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          // Zeilen sind CR-getrennt (\r).
          let idx: number;
          while ((idx = buf.indexOf("\r")) >= 0) {
            const zeile = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            try { verarbeiteEventZeile(sourceId, zeile); } catch { /* ignore */ }
          }
        });
        res.on("end", () => reconnect());
        res.on("error", () => reconnect());
      },
    );
    req.on("error", () => reconnect());
    req.end();
  };
  let reconnectTimer: NodeJS.Timeout | null = null;
  const reconnect = () => {
    if (!streamAktiv.get(sourceId)) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; verbinde(); }, 5000);
  };
  verbinde();
}
export function stoppeEventStream(sourceId: string): void {
  streamAktiv.set(sourceId, false);
}

export function setSsSnapshot(sourceId: string, snap: SsSnapshot): void { snapshots.set(sourceId, snap); }
export function getSsSnapshot(sourceId: string): SsSnapshot | undefined { return snapshots.get(sourceId); }
export function getAllSsCameras(): Array<SsCamera & { sourceId: string }> {
  const out: Array<SsCamera & { sourceId: string }> = [];
  for (const [sid, snap] of snapshots) {
    if (!snap.ok) continue;
    for (const c of snap.cameras) out.push({ ...c, sourceId: sid });
  }
  return out;
}

// Einen MJPEG-Livestream einer Kamera an die HTTP-Response weiterleiten (proxen).
// Die Verbindung zu SecuritySpy bleibt offen und wird direkt zum Browser gepiped;
// die Zugangsdaten bleiben serverseitig. Bricht der Browser ab, wird auch die
// Upstream-Verbindung geschlossen (kein Ressourcen-Leck).
export function proxyCameraStream(cfg: SsConfig, cameraNum: number, res: import("node:http").ServerResponse, clientReq: import("node:http").IncomingMessage): void {
  const headers: Record<string, string> = {};
  if (cfg.user != null) {
    const auth = Buffer.from(`${cfg.user}:${cfg.pass ?? ""}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }
  // ++video liefert per Default einen MJPEG-Stream (multipart/x-mixed-replace).
  const upstream = http.request(
    { host: cfg.host, port: cfg.port ?? 8000, path: `/++video?cameraNum=${cameraNum}`, method: "GET", headers },
    (up) => {
      // Content-Type (multipart-Boundary) unverändert an den Browser weitergeben.
      res.writeHead(up.statusCode ?? 200, {
        "Content-Type": up.headers["content-type"] ?? "multipart/x-mixed-replace",
        "Cache-Control": "no-store",
        "Connection": "close",
      });
      up.pipe(res);
      up.on("error", () => { try { res.end(); } catch { /* ignore */ } });
    },
  );
  upstream.on("error", () => { try { res.end(); } catch { /* ignore */ } });
  // Bricht der Browser ab (schließt Tab/Seite), Upstream-Verbindung beenden.
  const abbruch = () => { try { upstream.destroy(); } catch { /* ignore */ } };
  clientReq.on("close", abbruch);
  clientReq.on("aborted", abbruch);
  res.on("close", abbruch);
  upstream.end();
}

// === Aufnahmen (aufgezeichnete Sequenzen) ===
export interface SsRecording {
  title: string;          // z.B. "05-09-2026 17-57-26 M Carport"
  href: string;           // Download-Pfad, z.B. "++getfile/2/2026-09-05/...mov"
  type: string;           // z.B. "video/quicktime"
  length: number;         // Dateigröße in Bytes
  updated: string;        // ISO-Zeitstempel
  cameraNum: number;      // Kameranummer
}

export function parseRecordings(xml: string): SsRecording[] {
  const out: SsRecording[] = [];
  const entries = xml.split(/<entry>/).slice(1).map((e) => e.split("</entry>")[0]);
  for (const e of entries) {
    const linkTag = (e.match(/<link\b[^>]*\/?>/) ?? [""])[0];
    const href = (linkTag.match(/href="([^"]*)"/) ?? [])[1];
    if (!href) continue;
    out.push({
      title: tag(e, "title") ?? "",
      href: decodeXml(href),
      type: (linkTag.match(/type="([^"]*)"/) ?? [])[1] ?? "video/quicktime",
      length: Number((linkTag.match(/length="([^"]*)"/) ?? [])[1] ?? 0),
      updated: tag(e, "updated") ?? "",
      cameraNum: Number(tag(e, "bsl:cameraNum") ?? -1),
    });
  }
  return out;
}

export async function fetchRecordings(cfg: SsConfig, opts: { cameraNum?: number; tage?: number; anzahl?: number } = {}): Promise<{ ok: boolean; error?: string; recordings: SsRecording[] }> {
  if (!cfg.host) return { ok: false, error: "Host fehlt", recordings: [] };
  const params = new URLSearchParams();
  params.set("format", "xml");
  params.set("mcFilesCheck", "1");
  params.set("ccFilesCheck", "1");
  if (opts.cameraNum != null) params.set("cameraNum", String(opts.cameraNum));
  params.set("ageText", String(opts.tage ?? 7));
  params.set("results", String(opts.anzahl ?? 100));
  try {
    const xml = await ssGet(cfg, `/++download?${params.toString()}`);
    if (!xml.includes("<feed") && !xml.includes("<entry")) return { ok: false, error: "Unerwartete Antwort", recordings: [] };
    return { ok: true, recordings: parseRecordings(xml) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Abruf fehlgeschlagen", recordings: [] };
  }
}

// Aufnahmen ALLER Kameras: SecuritySpy liefert bei "alle" (ohne cameraNum) keine
// zuverlässige Liste, deshalb wird jede bekannte Kamera einzeln abgefragt und die
// Ergebnisse werden zusammengeführt und nach Zeit (neueste zuerst) sortiert.
export async function fetchAllRecordings(cfg: SsConfig, kameraNummern: number[], opts: { tage?: number; anzahl?: number } = {}): Promise<{ ok: boolean; error?: string; recordings: SsRecording[] }> {
  if (!cfg.host) return { ok: false, error: "Host fehlt", recordings: [] };
  if (kameraNummern.length === 0) return { ok: true, recordings: [] };
  const ergebnisse = await Promise.all(
    kameraNummern.map((num) => fetchRecordings(cfg, { cameraNum: num, tage: opts.tage, anzahl: opts.anzahl })),
  );
  const alle: SsRecording[] = [];
  for (const r of ergebnisse) if (r.ok) alle.push(...r.recordings);
  // Neueste zuerst (updated ist ISO-Zeit).
  alle.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return { ok: true, recordings: alle };
}

// Eine Aufnahme-Datei an die Response streamen (Range-Requests fürs Spulen).
export function proxyRecording(cfg: SsConfig, href: string, res: import("node:http").ServerResponse, clientReq: import("node:http").IncomingMessage): void {
  const headers: Record<string, string> = {};
  if (cfg.user != null) {
    const auth = Buffer.from(`${cfg.user}:${cfg.pass ?? ""}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }
  if (clientReq.headers["range"]) headers["Range"] = String(clientReq.headers["range"]);
  const pfad = href.startsWith("/") ? href : `/${href}`;
  const upstream = http.request(
    { host: cfg.host, port: cfg.port ?? 8000, path: pfad, method: "GET", headers },
    (up) => {
      const h: Record<string, string> = { "Cache-Control": "no-store" };
      if (up.headers["content-type"]) h["Content-Type"] = String(up.headers["content-type"]);
      if (up.headers["content-length"]) h["Content-Length"] = String(up.headers["content-length"]);
      if (up.headers["content-range"]) h["Content-Range"] = String(up.headers["content-range"]);
      if (up.headers["accept-ranges"]) h["Accept-Ranges"] = String(up.headers["accept-ranges"]);
      res.writeHead(up.statusCode ?? 200, h);
      up.pipe(res);
      up.on("error", () => { try { res.end(); } catch { /* ignore */ } });
    },
  );
  upstream.on("error", () => { try { res.end(); } catch { /* ignore */ } });
  const abbruch = () => { try { upstream.destroy(); } catch { /* ignore */ } };
  clientReq.on("close", abbruch);
  res.on("close", abbruch);
  upstream.end();
}

export function fetchCameraImage(cfg: SsConfig, cameraNum: number, timeoutMs = 8000): Promise<{ ok: boolean; data?: Buffer; contentType?: string; error?: string }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (cfg.user != null) {
      const auth = Buffer.from(`${cfg.user}:${cfg.pass ?? ""}`).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }
    const req = http.request(
      { host: cfg.host, port: cfg.port ?? 8000, path: `/++image?cameraNum=${cameraNum}`, method: "GET", headers, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ ok: true, data: Buffer.concat(chunks), contentType: res.headers["content-type"] ?? "image/jpeg" }));
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: (e as any)?.message ?? "Fehler" }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "Zeitüberschreitung" }); });
    req.end();
  });
}
