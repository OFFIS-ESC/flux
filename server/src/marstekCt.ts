// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// UDP-Emulation eines Marstek CT002/CT003 Smart Meters.
//
// Anders als der Shelly (den der Speicher lokal per Broadcast findet) läuft ein
// CT002/CT003 über eine feste Geräte-Identität (CT-MAC + Batterie-MAC), die in
// der Marstek-App/-Cloud registriert sein muss. Dieses Modul emuliert
// AUSSCHLIESSLICH den laufenden Betrieb – also die lokalen UDP-Antworten auf
// Port 12345. Die einmalige Cloud-Registrierung des Fake-CT ist NICHT Teil
// dieses Moduls (siehe Hilfe/Doku: extern mit Community-Tool durchzuführen,
// danach CT-MAC und Batterie-MAC hier eintragen).
//
// Protokoll (Community-Reverse-Engineering, siehe AstraMeter/rweijnen-Notes):
//  - Transport: UDP, Port 12345. Speicher (Consumer) fragt an, CT antwortet.
//  - Frame: SOH(0x01) STX(0x02) <ASCII-Längenziffern> |feld1|feld2|... ETX(0x03)
//           <2 Zeichen ASCII-Hex-Prüfsumme>.
//  - Länge = Gesamt-Byte-Länge des Pakets (inkl. Längenziffern und Prüfsumme),
//    iterativ zu bestimmen, da die Ziffernzahl selbst in die Länge eingeht.
//  - Prüfsumme = XOR aller Bytes von SOH bis einschließlich ETX, als 2-stelliges
//    Kleinbuchstaben-Hex.
//  - CT-Typ: CT002 = "HME-4", CT003 = "HME-3".
//
// Request-Felder (Consumer -> CT):
//  1 meter_dev_type, 2 meter_mac (Batterie-MAC), 3 hhm_dev_type (CT-Typ),
//  4 hhm_mac (CT-MAC), 5 phase (A/B/C = zugeordnet, sonst Inspektionsmodus),
//  6 phase_power (signed W).
//
// Response-Felder (CT -> Consumer): echo dev_type + Batterie-MAC, CT-Typ, CT-MAC,
//  A/B/C-Phasenleistung, Summe, chrg_nb-Flags, wifi_rssi, info_idx, dann die
//  charge/discharge-Aufteilung nach Vorzeichen. Insgesamt 24 Felder.

import dgram from "node:dgram";
import { CtBalancer, type CtBalancerSnapshot } from "./ctBalancer.js";

export const CT_UDP_PORT = 12345;

const SOH = 0x01;
const STX = 0x02;
const ETX = 0x03;

export type CtModel = "ct002" | "ct003";

// CT-Typ-Kennung im Protokoll.
function ctTypeCode(model: CtModel): string {
  return model === "ct003" ? "HME-3" : "HME-4";
}

// Liefert Sollleistung, CT-Modell und die (registrierten) MACs der aktiven
// Discovery-Senke – oder null, wenn keine CT-Senke aktiv ist.
export type CtInfoProvider = () => {
  power: number;
  model: CtModel;
  ctMac: string;
  batteryMac: string;
  weights?: Array<{ ip: string; weight: number }>;
  deadbandW?: number;
  maxStepW?: number;
  fadeout?: boolean;
  fadeStepW?: number;
  noAcCharge?: boolean;
  maxTotalW?: number;
  balanceStepW?: number;
  balanceToleranceW?: number;
  alternierendeEntladung?: boolean;
  socByIp?: Record<string, number>;
} | null;

let server: dgram.Socket | null = null;
let running = false;
// Balancer-Instanz auf Modulebene, damit ihr Live-Zustand für die Anzeige
// abgefragt werden kann (getCtBalancerSnapshot).
let balancer: CtBalancer | null = null;

// Live-Zustand des Multi-Speicher-Balancers für die Senkenseite. null, wenn die
// CT-Emulation nicht läuft.
export function getCtBalancerSnapshot(): CtBalancerSnapshot | null {
  return balancer ? balancer.snapshot() : null;
}

// XOR-Prüfsumme über alle Bytes des Puffers.
function xorChecksum(buf: Buffer): number {
  let x = 0;
  for (const b of buf) x ^= b;
  return x & 0xff;
}

// Baut ein vollständiges CT-Frame aus den Feldern. Die Länge wird iterativ
// bestimmt, weil ihre eigene Ziffernzahl in die Gesamtlänge eingeht.
export function buildFrame(fields: (string | number)[]): Buffer {
  const body = "|" + fields.map((f) => String(f)).join("|");
  const bodyBuf = Buffer.from(body, "ascii");
  // Grundgröße ohne Längenziffern: SOH + STX + body + ETX + 2 Prüfsummenzeichen.
  const fixed = 1 /*SOH*/ + 1 /*STX*/ + bodyBuf.length + 1 /*ETX*/ + 2 /*checksum*/;
  // Länge iterativ: Gesamtlänge = fixed + Anzahl der Ziffern in der Länge.
  let digits = 1;
  let total = fixed + digits;
  while (String(total).length !== digits) {
    digits = String(total).length;
    total = fixed + digits;
  }
  const lenStr = String(total);
  // Frame ohne Prüfsumme zusammensetzen: SOH STX <len> <body> ETX
  const pre = Buffer.concat([
    Buffer.from([SOH, STX]),
    Buffer.from(lenStr, "ascii"),
    bodyBuf,
    Buffer.from([ETX]),
  ]);
  const cs = xorChecksum(pre);
  const csStr = cs.toString(16).padStart(2, "0"); // Kleinbuchstaben-Hex
  return Buffer.concat([pre, Buffer.from(csStr, "ascii")]);
}

// Zerlegt ein empfangenes Frame in seine Felder. Gibt null zurück, wenn das
// Format nicht passt oder die Prüfsumme nicht stimmt.
export function parseFrame(buf: Buffer): string[] | null {
  if (buf.length < 5) return null;
  if (buf[0] !== SOH || buf[1] !== STX) return null;
  const etxIdx = buf.indexOf(ETX);
  if (etxIdx < 0 || etxIdx + 2 >= buf.length + 1) return null;
  // Prüfsumme prüfen (2 Zeichen nach ETX).
  const csGiven = buf.slice(etxIdx + 1, etxIdx + 3).toString("ascii").toLowerCase();
  const csCalc = xorChecksum(buf.slice(0, etxIdx + 1)).toString(16).padStart(2, "0");
  if (csGiven !== csCalc) return null;
  // Zwischen STX und ETX steht: <Längenziffern>|feld|feld|...
  const inner = buf.slice(2, etxIdx).toString("ascii");
  const bar = inner.indexOf("|");
  if (bar < 0) return null;
  const fieldStr = inner.slice(bar + 1); // führende Längenziffern abschneiden
  return fieldStr.split("|");
}

// Baut die CT-Antwort auf eine Anfrage. `phaseShare` ist das (ggf. auf mehrere
// Speicher aufgeteilte) Grid-Reading, das dieser Speicher auf seiner Phase
// erhalten soll. Vorzeichen wie im Shelly-Fall: >0 = Bezug (Speicher soll
// entladen). Im Inspektionsmodus (Phase nicht A/B/C) wird ohne Phasenzuordnung
// geantwortet.
export function buildResponse(
  reqFields: string[],
  phaseShare: number,
  model: CtModel,
  ctMac: string,
  infoIdx: number,
): Buffer {
  const meterDevType = reqFields[0] ?? "HMG-50";
  const batteryMac = reqFields[1] ?? "";
  const phase = (reqFields[4] ?? "").toUpperCase();
  const p = Math.round(phaseShare);
  const singlePhase = phase === "A" || phase === "B" || phase === "C";
  const combined = phase === "D"; // dreiphasig saldierend (whole-home)

  // Phasenaufteilung.
  //  - Einphasiger Betrieb (Phase A/B/C): Sollwert auf die angefragte Phase.
  //  - Dreiphasig saldierend (Phase "D", whole-home): Der Speicher liest das
  //    Gesamtfeld (Feld 8, Summe) und regelt die Gesamtbilanz aller drei Phasen
  //    aus. Wir legen den saldierten Sollwert auf Phase A, sodass die Summe
  //    (total) genau dem Sollwert entspricht – das ist das Feld, das der Speicher
  //    im D-Modus verwendet.
  //  - Inspektions-/Diagnosemodus (Phase "0"/leer): einphasiger Messwert per
  //    Konvention auf Phase A (wie beim echten CT für einphasige Zähler), damit
  //    der Speicher die Diagnose abschließen kann.
  let a = 0, b = 0, c = 0;
  if (singlePhase) {
    if (phase === "A") a = p;
    else if (phase === "B") b = p;
    else c = p;
  } else {
    // "D" (saldierend) und Inspektion: Wert auf Phase A -> total == p.
    a = p;
  }

  const total = a + b + c;
  const nb = (v: number) => (v !== 0 ? 1 : 0);

  // WICHTIG: Feldreihenfolge exakt wie beim echten CT (AstraMeter-Referenz
  // _build_response_fields). Die ersten vier Felder sind:
  //   1 ct_type, 2 ct_mac, 3 meter_dev_type (echo), 4 meter_mac (echo)
  // Der Speicher identifiziert "sein" CT an genau diesen ersten beiden Feldern –
  // stehen dort (wie zuvor fälschlich) die Echo-Werte, findet der Speicher das
  // CT nicht. Die chrg/dchrg-Power-Felder (15-24) dienen nur dem Cross-Talk
  // zwischen mehreren Batterien und bleiben hier 0; das Target steckt in den
  // Phasenfeldern 5-7.
  const fields: (string | number)[] = [
    ctTypeCode(model),   // 1 ct_type (HME-4/HME-3)
    ctMac,               // 2 ct_mac
    meterDevType,        // 3 meter_dev_type (echo)
    batteryMac,          // 4 meter_mac (echo Batterie-MAC)
    a, b, c,             // 5-7 phase power
    total,               // 8 total_power
    nb(a), nb(b), nb(c), // 9-11 A/B/C_chrg_nb (1 wenn Phase aktiv)
    0,                   // 12 ABC_chrg_nb
    -50,                 // 13 wifi_rssi
    infoIdx & 0xff,      // 14 info_idx (0..255)
    0,                   // 15 x_chrg_power
    0, 0, 0,             // 16-18 A/B/C_chrg_power
    0,                   // 19 ABC_chrg_power
    0,                   // 20 x_dchrg_power
    0, 0, 0,             // 21-23 A/B/C_dchrg_power
    0,                   // 24 ABC_dchrg_power
  ];
  return buildFrame(fields);
}

// Startet den CT-UDP-Listener auf Port 12345. getInfo liefert Sollwert, Modell
// und die registrierten MACs der aktiven CT-Senke (oder null).
export function startCtEmulation(getInfo: CtInfoProvider, log?: (m: string) => void): void {
  if (running) return;
  running = true;
  let idx = 0;
  balancer = new CtBalancer();
  let sock: dgram.Socket;
  try {
    sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  } catch (e: any) {
    log?.(`CT-Emulation Socket-Fehler: ${e?.message ?? e}`);
    running = false;
    return;
  }
  sock.on("error", (err) => {
    log?.(`CT-Emulation Port ${CT_UDP_PORT}: ${err.message}`);
    try { sock.close(); } catch { /* ignore */ }
  });
  sock.on("message", (msg, rinfo) => {
    const info = getInfo();
    if (info == null) return; // keine aktive CT-Senke -> nicht antworten
    const fields = parseFrame(msg);
    if (!fields) return; // ungültiges/nicht-CT-Frame
    if (fields.length < 4) return; // Pflichtfelder fehlen
    // Nur die CT-MAC validieren – exakt wie der echte CT (AstraMeter-Referenz
    // _validate_ct_mac). Der in der Anfrage gemeldete CT-TYP wird bewusst NICHT
    // gefiltert (die Referenz nutzt ihn nur informativ); ein zu strenger
    // Typ-Filter verhinderte bisher, dass der Speicher das CT überhaupt findet.
    // Ist eine CT-MAC konfiguriert, muss die Anfrage-MAC (Feld 4) dazu passen;
    // eine leere Anfrage-MAC wird – wie in der Referenz – nicht beantwortet.
    if (info.ctMac) {
      const reqCtMac = (fields[3] ?? "").toLowerCase();
      if (!reqCtMac || reqCtMac !== info.ctMac.toLowerCase()) return;
    }
    // Multi-Speicher-Aufteilung: Jeder pollende Speicher meldet seine Phase
    // (Feld 5) und seine aktuelle Ausgangsleistung (Feld 6). Der Balancer teilt
    // die gesamte auszuregelnde Netzleistung (info.power) gewichtet auf alle
    // aktiven Speicher auf und gibt diesem Speicher nur seinen Anteil zurück –
    // so regeln mehrere Speicher gemeinsam die Netzabweichung aus, ohne sich
    // gegenseitig hochzuschaukeln. Bei nur einem Speicher entspricht der Anteil
    // exakt der vollen Netzleistung (unverändertes Verhalten).
    const reqPhase = (fields[4] ?? "").toUpperCase();
    const reportedPower = Number.parseInt(fields[5] ?? "0", 10) || 0;
    // Betriebsmodus = bekannte Phase A/B/C (einphasig) ODER D (dreiphasig
    // saldierend). Nur der echte Inspektions-/Diagnosemodus ("0"/leer) ist keine
    // bekannte Phase.
    const known = reqPhase === "A" || reqPhase === "B" || reqPhase === "C" || reqPhase === "D";
    // Balancer weiterhin über jeden Poll informieren (Consumer-Tracking, damit
    // die Aufteilung stimmt, sobald die Phase feststeht).
    // Gewicht dieses Speichers aus der Konfiguration (nach IP); Standard 1.
    const wCfg = info.weights?.find((w) => w.ip === rinfo.address);
    const weight = wCfg && wCfg.weight > 0 ? wCfg.weight : 1;
    const share = balancer!.report(rinfo.address, reqPhase, reportedPower, info.power, weight, {
      deadbandW: info.deadbandW,
      maxStepW: info.maxStepW,
      fadeout: info.fadeout,
      fadeStepW: info.fadeStepW,
      noAcCharge: info.noAcCharge,
      maxTotalW: info.maxTotalW,
      balanceStepW: info.balanceStepW,
      balanceToleranceW: info.balanceToleranceW,
      alternierendeEntladung: info.alternierendeEntladung,
      socByIp: info.socByIp,
    });
    // Im Inspektions-/Diagnosemodus (Phase noch unbekannt) den vollen realen
    // Netzwert senden, damit der Speicher seine Phase-Discovery abschließen kann;
    // im Betrieb (A/B/C/D) den auf die Speicher aufgeteilten Anteil.
    const value = known ? share : info.power;
    const reply = buildResponse(fields, value, info.model, info.ctMac, idx++);
    try { sock.send(reply, rinfo.port, rinfo.address); } catch { /* ignore */ }
  });
  try {
    // Explizit an 0.0.0.0 binden (wie der echte CT), damit auch an das Gerät
    // gerichtete Broadcast-/Subnetz-Suchpakete empfangen werden.
    sock.bind(CT_UDP_PORT, "0.0.0.0", () => {
      log?.(`CT-Emulation lauscht auf UDP ${CT_UDP_PORT}`);
    });
    server = sock;
  } catch (e: any) {
    log?.(`CT-Emulation bind ${CT_UDP_PORT} fehlgeschlagen: ${e?.message ?? e}`);
  }
}

export function stopCtEmulation(): void {
  if (server) { try { server.close(); } catch { /* ignore */ } }
  server = null;
  running = false;
  balancer = null;
}
