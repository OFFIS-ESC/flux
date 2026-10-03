// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Prusa 3D-Drucker über PrusaLink (lokale HTTP-API).
//
// Endpunkte:
//   /api/version  – Firmware, Hostname, API-Version
//   /api/printer  – Status + Telemetrie (Temperaturen, Achsen, Flow, Speed, Lüfter)
//   /api/job      – aktueller Druckauftrag (Fortschritt, Dateiname, Zeiten)
//
// Authentifizierung wahlweise:
//   - API-Key: Header "X-Api-Key: <key>"
//   - HTTP-Digest: Benutzer (oft "maker") + Passwort (der API-Key)

import http from "node:http";
import crypto from "node:crypto";

export interface PrusaState {
  ok: boolean;
  error?: string;
  // Drucker
  state?: string;            // z.B. "PRINTING", "OPERATIONAL", "IDLE"
  tempNozzle?: number;       // Düsentemperatur
  tempNozzleTarget?: number;
  tempBed?: number;          // Betttemperatur
  tempBedTarget?: number;
  axisX?: number;
  axisY?: number;
  axisZ?: number;
  flow?: number;             // %
  speed?: number;            // %
  fanHotend?: number;
  fanPrint?: number;
  // Job
  jobAktiv?: boolean;
  jobDatei?: string;         // Dateiname
  jobFortschritt?: number;   // %
  jobRestzeitSek?: number;   // geschätzte Restzeit
  jobDruckzeitSek?: number;  // bisher gedruckt
  // Version
  firmware?: string;
  hostname?: string;
}

export interface PrusaConfig {
  host: string;
  auth: "apikey" | "digest";
  apiKey?: string;
  user?: string;
  pass?: string;
}

// Ein GET gegen PrusaLink. Bei Digest wird der 401-Challenge-Handshake
// automatisch durchgeführt.
function prusaGet(cfg: PrusaConfig, pfad: string, timeoutMs = 6000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const baseHeaders: Record<string, string> = {};
    if (cfg.auth === "apikey" && cfg.apiKey) baseHeaders["X-Api-Key"] = cfg.apiKey;

    const anfrage = (extraHeaders: Record<string, string>, erlaubeRetry: boolean) => {
      const req = http.request(
        { host: cfg.host, port: 80, path: pfad, method: "GET", headers: { ...baseHeaders, ...extraHeaders }, timeout: timeoutMs },
        (res) => {
          let t = "";
          res.on("data", (c) => (t += c));
          res.on("end", () => {
            // Digest-Challenge: bei 401 mit WWW-Authenticate erneut mit Antwort senden.
            if (res.statusCode === 401 && cfg.auth === "digest" && erlaubeRetry && res.headers["www-authenticate"]) {
              try {
                const authHeader = digestAntwort(cfg, "GET", pfad, String(res.headers["www-authenticate"]));
                anfrage({ Authorization: authHeader }, false);
              } catch (e: any) { reject(e); }
              return;
            }
            resolve({ status: res.statusCode ?? 0, text: t });
          });
        },
      );
      req.on("error", (e) => reject(e));
      req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
      req.end();
    };
    anfrage({}, true);
  });
}

// Digest-Authentifizierungs-Header aus der WWW-Authenticate-Challenge bauen.
function digestAntwort(cfg: PrusaConfig, methode: string, uri: string, challenge: string): string {
  const teile: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m: RegExpExecArray | null;
  const c = challenge.replace(/^Digest\s+/i, "");
  while ((m = regex.exec(c)) !== null) { teile[m[1]] = m[2] ?? m[3] ?? ""; }
  const realm = teile.realm ?? "";
  const nonce = teile.nonce ?? "";
  const qop = teile.qop;
  const user = cfg.user ?? "maker";
  const pass = cfg.pass ?? "";
  const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${methode}:${uri}`);
  let response: string;
  let extra = "";
  if (qop) {
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    extra = `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }
  return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"${teile.opaque ? `, opaque="${teile.opaque}"` : ""}${extra}`;
}

function num(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function pollPrusa(cfg: PrusaConfig): Promise<PrusaState> {
  if (!cfg.host) return { ok: false, error: "Host fehlt" };
  try {
    const [printerRes, jobRes, versionRes] = await Promise.all([
      prusaGet(cfg, "/api/printer").catch(() => ({ status: 0, text: "" })),
      prusaGet(cfg, "/api/job").catch(() => ({ status: 0, text: "" })),
      prusaGet(cfg, "/api/version").catch(() => ({ status: 0, text: "" })),
    ]);
    if (printerRes.status === 401 || jobRes.status === 401) {
      return { ok: false, error: "Zugang abgelehnt (Auth prüfen)" };
    }
    if (printerRes.status === 0 && jobRes.status === 0) {
      return { ok: false, error: "Drucker nicht erreichbar" };
    }
    const st: PrusaState = { ok: true };

    // /api/printer
    try {
      const p = JSON.parse(printerRes.text);
      // Struktur kann variieren: temperature.tool0 / .bed (OctoPrint-Stil) oder
      // telemetry/printer-Objekt (PrusaLink v1). Tolerant lesen.
      const temp = p.temperature ?? {};
      st.tempNozzle = num(temp.tool0?.actual) ?? num(p.printer?.temp_nozzle) ?? num(p.telemetry?.["temp-nozzle"]);
      st.tempNozzleTarget = num(temp.tool0?.target) ?? num(p.printer?.target_nozzle);
      st.tempBed = num(temp.bed?.actual) ?? num(p.printer?.temp_bed) ?? num(p.telemetry?.["temp-bed"]);
      st.tempBedTarget = num(temp.bed?.target) ?? num(p.printer?.target_bed);
      st.axisX = num(p.printer?.axis_x) ?? num(p.telemetry?.["axis-x"]);
      st.axisY = num(p.printer?.axis_y) ?? num(p.telemetry?.["axis-y"]);
      st.axisZ = num(p.printer?.axis_z) ?? num(p.telemetry?.["axis-z"]) ?? num(p.telemetry?.["z-height"]);
      st.flow = num(p.printer?.flow) ?? num(p.telemetry?.flow);
      st.speed = num(p.printer?.speed) ?? num(p.telemetry?.["print-speed"]);
      st.fanHotend = num(p.printer?.fan_hotend);
      st.fanPrint = num(p.printer?.fan_print);
      // Status
      st.state = p.state?.text ?? p.printer?.state ?? p.state;
    } catch { /* printer unlesbar */ }

    // /api/job
    try {
      if (jobRes.text && jobRes.text.trim() && jobRes.text.trim() !== "{}") {
        const j = JSON.parse(jobRes.text);
        // OctoPrint-Stil: job.file.display / progress.completion / progress.printTimeLeft
        // PrusaLink v1: file.display_name / progress (0..100) / time_remaining
        const datei = j.job?.file?.display_name ?? j.job?.file?.name ?? j.file?.display_name ?? j.file?.name;
        if (datei) { st.jobDatei = String(datei); st.jobAktiv = true; }
        // Fortschritt: entweder 0..1 (completion) oder 0..100 (progress)
        const compl = num(j.progress?.completion);
        const prog = num(j.progress) ?? num(j.progress?.percentDone);
        if (compl != null) st.jobFortschritt = Math.round(compl * 100);
        else if (prog != null) st.jobFortschritt = Math.round(prog);
        st.jobRestzeitSek = num(j.progress?.printTimeLeft) ?? num(j.time_remaining) ?? num(j.job?.time_remaining);
        st.jobDruckzeitSek = num(j.progress?.printTime) ?? num(j.time_printing) ?? num(j.job?.time_printing);
        if (st.jobFortschritt != null || st.jobDatei) st.jobAktiv = true;
      }
    } catch { /* job unlesbar oder kein Job */ }

    // /api/version
    try {
      if (versionRes.text) {
        const v = JSON.parse(versionRes.text);
        st.firmware = v.server ?? v.firmware ?? v.text;
        st.hostname = v.hostname ?? v.name;
      }
    } catch { /* version optional */ }

    return st;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Abruf fehlgeschlagen" };
  }
}

// --- Zustands-Speicher je Prusa-Quelle ---
const states = new Map<string, PrusaState>();
export function setPrusaState(sourceId: string, st: PrusaState): void { states.set(sourceId, st); }
export function getPrusaState(sourceId: string): PrusaState | undefined { return states.get(sourceId); }
export function getAllPrusaStates(): Array<PrusaState & { sourceId: string }> {
  const out: Array<PrusaState & { sourceId: string }> = [];
  for (const [sid, st] of states) out.push({ ...st, sourceId: sid });
  return out;
}
