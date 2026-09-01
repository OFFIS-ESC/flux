// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Marstek-Cloud-Registrierung eines emulierten CT-Geräts (CT002/CT003).
//
// Portierung der Referenzimplementierung aus AstraMeter (src/astrameter/
// marstek_api.py, tomquist/AstraMeter). Zweck: einmalig ein "managed" Fake-CT
// im Marstek-Account anlegen, damit die Marstek-App den emulierten Zähler zur
// Auswahl anbietet. Die Zugangsdaten werden NUR für diesen einmaligen Vorgang
// verwendet und niemals gespeichert.
//
// Ablauf (alle Requests sind GET mit Query-Parametern gegen eu.hamedata.com):
//  1) Login  /app/Solar/v2_get_device.php?mailbox=&pwd=<md5>   -> code "2" + token
//  2) Liste  /ems/api/v1/getDeviceList?mailbox=&token=          -> vorhandene Geräte
//  3) Anlegen /app/Solar/v2_add_device.php?...                  -> code "1"/"2"
//  4) Erneut Liste holen und prüfen, ob das Managed-Gerät nun existiert.
//
// Ein "managed" Gerät erkennt man am MAC/DEVID-Präfix 02b250 (frei gewählter,
// von echten Geräten unterscheidbarer Adressbereich) und am Gerätetyp
// (HME-4 = CT002, HME-3 = CT003).

import { createHash } from "node:crypto";

const MANAGED_MAC_PREFIX = "02b250";
const DEFAULT_BASE_URL = "https://eu.hamedata.com";

export interface MarstekRegisterInput {
  mailbox: string;
  password: string;
  deviceType: "ct002" | "ct003";
  timezone?: string;
  baseUrl?: string;
}

export interface MarstekRegisterResult {
  ok: boolean;
  alreadyExisted: boolean;
  ctMac?: string;          // devid == mac des angelegten/gefundenen Geräts
  deviceType: "ct002" | "ct003";
  cloudType?: string;      // HME-4 / HME-3
  message: string;
}

interface CloudDevice {
  devid?: string;
  mac?: string;
  type?: string;
  name?: string;
  [k: string]: unknown;
}

function md5(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

function randomHex(n: number): string {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

function desiredType(deviceType: "ct002" | "ct003"): string {
  return deviceType === "ct002" ? "HME-4" : "HME-3";
}

function desiredName(deviceType: "ct002" | "ct003"): string {
  return deviceType === "ct002" ? "HEMS CT002" : "HEMS CT003";
}

function isManagedPrefix(v: unknown): boolean {
  return typeof v === "string" && v.toLowerCase().startsWith(MANAGED_MAC_PREFIX);
}

// Übersetzt die häufigste Marstek-Fehlermeldung (falsches Passwort) ins Deutsche.
function translateMessage(code: unknown, msg: unknown): string {
  const msgText = msg == null ? "" : String(msg);
  const codeText = code == null ? "" : String(code);
  if (codeText === "4" && (msgText.includes("密码错误") || msgText.toLowerCase().includes("password"))) {
    return "Passwort falsch";
  }
  return msgText;
}

async function httpGetJson(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
  headers?: Record<string, string>,
): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const fullUrl = `${baseUrl.replace(/\/$/, "")}${path}?${query}`;
  let body = "";
  let status = 0;
  try {
    const resp = await fetch(fullUrl, { method: "GET", headers: headers ?? {}, signal: AbortSignal.timeout(20000) });
    status = resp.status;
    body = await resp.text();
  } catch (e: any) {
    throw new Error(`Netzwerkfehler beim Aufruf der Marstek-Cloud: ${e?.message ?? e}`);
  }
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    const snippet = body ? body.slice(0, 200) : "<leer>";
    throw new Error(`Unerwartete Antwort der Marstek-Cloud: ${snippet}`);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} von der Marstek-Cloud: ${JSON.stringify(payload)}`);
  }
  return payload;
}

// Login + vorhandene Geräte holen. Gibt Token und die zusammengeführte
// Geräteliste (Solar- + EMS-Endpoint) zurück.
async function fetchTokenAndDevices(
  baseUrl: string, mailbox: string, password: string,
): Promise<{ token: string; devices: CloudDevice[] }> {
  const pwdMd5 = md5(password);
  const tokenResp = await httpGetJson(baseUrl, "/app/Solar/v2_get_device.php", { mailbox, pwd: pwdMd5 });

  if (String(tokenResp?.code) !== "2" || !tokenResp?.token) {
    const code = tokenResp?.code;
    const rawMsg = tokenResp?.msg;
    const translated = translateMessage(code, rawMsg);
    throw new Error(`Login fehlgeschlagen (code=${code}): ${translated || rawMsg}`);
  }
  const token: string = tokenResp.token;
  const solarDevices: CloudDevice[] = Array.isArray(tokenResp?.data) ? tokenResp.data : [];

  const listResp = await httpGetJson(
    baseUrl, "/ems/api/v1/getDeviceList",
    { mailbox, token },
    { "User-Agent": "Dart/2.19 (dart:io)" },
  );
  const emsDevices: CloudDevice[] = Array.isArray(listResp?.data) ? listResp.data : [];

  const byDevid = new Map<string, CloudDevice>();
  for (const d of emsDevices) {
    if (d && typeof d === "object" && d.devid) byDevid.set(String(d.devid), d);
  }
  const merged: CloudDevice[] = [];
  for (const d of solarDevices) {
    if (!d || typeof d !== "object") continue;
    const did = String(d.devid ?? "");
    const e = byDevid.get(did) ?? {};
    merged.push({
      devid: did,
      name: (d.name as string) ?? (e.name as string),
      mac: (d.mac as string) ?? (e.mac as string),
      type: (d.type as string) ?? (e.type as string),
    });
  }
  return { token, devices: merged };
}

function findExistingManaged(devices: CloudDevice[], expectedType: string): CloudDevice | null {
  for (const d of devices) {
    const devid = String(d.devid ?? "").toLowerCase();
    const mac = String(d.mac ?? "").toLowerCase();
    if (String(d.type ?? "") !== expectedType) continue;
    if (isManagedPrefix(devid) && isManagedPrefix(mac)) return d;
  }
  return null;
}

function generateNewId(devices: CloudDevice[]): string {
  const existing = new Set<string>();
  for (const d of devices) {
    if (d.devid) existing.add(String(d.devid).toLowerCase());
    if (d.mac) existing.add(String(d.mac).toLowerCase());
  }
  for (let i = 0; i < 200; i++) {
    const candidate = `${MANAGED_MAC_PREFIX}${randomHex(6)}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Konnte keine eindeutige Managed-MAC erzeugen");
}

async function addDevice(
  baseUrl: string, mailbox: string, token: string,
  deviceType: "ct002" | "ct003", devidMac: string, timezone: string,
): Promise<void> {
  const typeValue = desiredType(deviceType);
  const suffix = devidMac.slice(-4);
  const params: Record<string, string> = {
    name: desiredName(deviceType),
    mailbox,
    devid: devidMac,
    mac: devidMac,
    type: typeValue,
    token,
    access: "1",
    bluetooth_name: `MST-SMR_${suffix}`,
    position: "{}",
    timeZone: timezone,
    version: "121",
  };
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "token": token,
    "User-Agent": "Dart/2.19 (dart:io)",
  };
  const resp = await httpGetJson(baseUrl, "/app/Solar/v2_add_device.php", params, headers);
  const code = String(resp?.code ?? "");
  if (code !== "1" && code !== "2") {
    throw new Error(`Anlegen des CT-Geräts fehlgeschlagen (code=${code}): ${resp?.msg}`);
  }
}

// Legt einmalig ein Managed-CT-Gerät im Marstek-Account an (falls noch keins
// existiert) und bestätigt danach durch erneutes Abrufen der Geräteliste, dass
// es tatsächlich vorhanden ist. Die Zugangsdaten werden nach diesem Aufruf vom
// Aufrufer verworfen und nirgends gespeichert.
export async function registerCtDevice(input: MarstekRegisterInput): Promise<MarstekRegisterResult> {
  const baseUrl = input.baseUrl || DEFAULT_BASE_URL;
  const timezone = input.timezone || "Europe/Berlin";
  const expectedType = desiredType(input.deviceType);

  const { token, devices } = await fetchTokenAndDevices(baseUrl, input.mailbox, input.password);

  // Bereits vorhandenes Managed-Gerät?
  const existing = findExistingManaged(devices, expectedType);
  if (existing) {
    return {
      ok: true,
      alreadyExisted: true,
      ctMac: String(existing.mac ?? existing.devid ?? ""),
      deviceType: input.deviceType,
      cloudType: expectedType,
      message: `Es existiert bereits ein passendes ${input.deviceType.toUpperCase()} im Marstek-Account (MAC ${existing.mac ?? existing.devid}).`,
    };
  }

  // Neu anlegen.
  const newId = generateNewId(devices);
  await addDevice(baseUrl, input.mailbox, token, input.deviceType, newId, timezone);

  // Zur Bestätigung erneut abrufen und prüfen.
  const { devices: refreshed } = await fetchTokenAndDevices(baseUrl, input.mailbox, input.password);
  const created = findExistingManaged(refreshed, expectedType);
  if (!created) {
    return {
      ok: false,
      alreadyExisted: false,
      deviceType: input.deviceType,
      cloudType: expectedType,
      message: "Das Gerät wurde angelegt, konnte aber in der Geräteliste nicht bestätigt werden. Bitte in der Marstek-App die CT-Liste aktualisieren und erneut prüfen.",
    };
  }
  return {
    ok: true,
    alreadyExisted: false,
    ctMac: String(created.mac ?? created.devid ?? newId),
    deviceType: input.deviceType,
    cloudType: expectedType,
    message: `${input.deviceType.toUpperCase()} erfolgreich registriert und in der Cloud bestätigt (MAC ${created.mac ?? created.devid}).`,
  };
}
