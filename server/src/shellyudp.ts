// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// UDP-Discovery-Responder für den emulierten Shelly Pro 3EM.
//
// Hintergrund: Marstek-Speicher (Venus u.a.) finden einen Shelly Pro 3EM NICHT
// über eine fest eingetragene URL, sondern indem sie im lokalen Netz per
// UDP-Broadcast Anfragen senden. Der Zähler muss auf der Broadcast-Adresse auf
// einem festen UDP-Port lauschen und antworten. In der Praxis (uni-meter,
// venuscontrol u.a.) hat sich UDP-Port 1010 als der von Marstek verwendete Port
// herausgestellt; ältere/andere Firmwares nutzen teils 2220. Die Firmware ist
// beim Parsen tolerant (sucht im Grunde nur nach Zahlen an festen Offsets), ein
// Shelly-kompatibles JSON-Datagramm genügt.
//
// Dieser Responder lauscht auf den genannten Ports, ordnet eingehende Anfragen
// einer konfigurierten Senke zu und antwortet mit deren aktueller Sollleistung
// im Gen2-RPC-Format (EM.GetStatus-artig). So kann der Marstek-Speicher die
// emulierte Senke automatisch entdecken, ohne dass eine URL eingetragen wird.
//
// Hinweise:
//  - Reine LAN-Funktion; im Sandbox-/Cloud-Betrieb ohne echtes Gerät ungenutzt.
//  - Das genaue Protokoll ist herstellerseitig nicht offiziell dokumentiert und
//    beruht auf Reverse-Engineering der Community. Antwortformat daher „best
//    effort"; bei künftigen Firmwares ggf. anzupassen.

import dgram from "node:dgram";

// Standard-Ports, auf denen Marstek nach einem Shelly sucht.
export const SHELLY_DISCOVERY_PORTS = [1010, 2220];

// Liefert die aktuell auszugebende Leistung UND den zu emulierenden Zählertyp
// der aktiven Discovery-Senke – oder null, wenn keine aktiv ist.
// Eine einzelne aktive Shelly-Discovery-Senke: auszugebende Leistung + der zu
// emulierende Zählertyp. Mehrere dürfen gleichzeitig aktiv sein (z. B. um zwei
// Marstek-Speicher mit je eigenem emulierten Zähler zu versorgen).
export type ShellySinkInfo = { power: number; meter: "pro3em" | "proem50" | "emg3" };
type InfoProvider = () => ShellySinkInfo[];

let servers: dgram.Socket[] = [];
let running = false;

// Baut ein Shelly-Pro-3EM-kompatibles EM.GetStatus-Ergebnis (Gen2 RPC,
// dreiphasig). power > 0 = Bezug (der Speicher soll entladen), symmetrisch auf
// 3 Phasen verteilt.
function emStatusResult(power: number): Record<string, any> {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const voltage = 230.0;
  const pPh = power / 3;
  const iPh = r3(Math.abs(pPh) / voltage);
  const ph = (p: number) => ({
    current: iPh, voltage, act_power: r1(p), aprt_power: r1(Math.abs(p)), pf: 1.0, freq: 50.0,
  });
  const a = ph(pPh), b = ph(pPh), c = ph(pPh);
  return {
    id: 0,
    a_current: a.current, a_voltage: a.voltage, a_act_power: a.act_power, a_aprt_power: a.aprt_power, a_pf: a.pf, a_freq: a.freq,
    b_current: b.current, b_voltage: b.voltage, b_act_power: b.act_power, b_aprt_power: b.aprt_power, b_pf: b.pf, b_freq: b.freq,
    c_current: c.current, c_voltage: c.voltage, c_act_power: c.act_power, c_aprt_power: c.aprt_power, c_pf: c.pf, c_freq: c.freq,
    n_current: null,
    total_current: r3(Math.abs(power) / voltage),
    total_act_power: Math.round(power * 1000) / 1000,
    total_aprt_power: r3(Math.abs(power)),
    user_calibrated_phase: [],
  };
}

// Baut ein Shelly-Pro-EM-50-kompatibles EM1.GetStatus-Ergebnis (Gen2 RPC,
// einphasig). Die gesamte Leistung liegt auf dem einen Kanal.
function em1StatusResult(power: number): Record<string, any> {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const voltage = 230.0;
  return {
    id: 0,
    current: r3(Math.abs(power) / voltage),
    voltage,
    act_power: r1(power),
    aprt_power: r1(Math.abs(power)),
    pf: 1.0,
    freq: 50.0,
    calibration: "factory",
  };
}

// Ordnet eine eingehende Anfrage einer Shelly-RPC-Methode zu. Marstek fragt den
// Pro 3EM per "EM.GetStatus" und die Pro EM-50 per "EM1.GetStatus" ab. Liefert
// die erkannte Methode oder null.
function parseMethod(msg: Buffer): { method: string | null; id: number } {
  try {
    const parsed = JSON.parse(msg.toString());
    const method = typeof parsed?.method === "string" ? parsed.method : null;
    const id = typeof parsed?.id === "number" ? parsed.id : 1;
    return { method, id };
  } catch {
    return { method: null, id: 1 };
  }
}

// Startet die UDP-Listener. getInfo liefert die aktuell auszugebende Leistung
// und den zu emulierenden Zählertyp (oder null, wenn keine Discovery-Senke aktiv
// ist).
export function startShellyDiscovery(getInfo: InfoProvider, log?: (m: string) => void): void {
  if (running) return;
  running = true;
  for (const port of SHELLY_DISCOVERY_PORTS) {
    let sock: dgram.Socket;
    try {
      sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      continue;
    }
    sock.on("error", (err) => {
      log?.(`Shelly-Discovery Port ${port}: ${err.message}`);
      try { sock.close(); } catch { /* ignore */ }
    });
    sock.on("message", (msg, rinfo) => {
      const sinks = getInfo();
      if (!sinks || sinks.length === 0) return; // keine aktive Discovery-Senke
      const { method, id } = parseMethod(msg);
      // Auf eine Anfrage mit JEDER passenden aktiven Senke antworten – jeweils mit
      // dem korrekten src-Prefix. Der Marstek-Speicher filtert eingehende
      // Antworten anhand dieses src-Feldes (Whitelist: shellypro3em-,
      // shellyproem50-, shellyemg3-) und übernimmt nur die zu dem in seiner App
      // gewählten Zählertyp passende. So lassen sich zwei Speicher mit je eigenem
      // emulierten Zähler gleichzeitig versorgen.
      //  - Pro 3EM  -> EM.GetStatus  (dreiphasig, src shellypro3em-…)
      //  - Pro EM-50 -> EM1.GetStatus (einphasig,  src shellyproem50-…)
      //  - EM Gen3   -> EM1.GetStatus (einphasig,  src shellyemg3-…)
      for (const info of sinks) {
        let result: Record<string, any> | null = null;
        let src: string;
        if (info.meter === "pro3em") {
          // dreiphasig: nur auf EM.GetStatus antworten (nicht auf explizites EM1)
          if (method === "EM1.GetStatus") continue;
          result = emStatusResult(info.power);
          src = "shellypro3em-hemssink";
        } else {
          // einphasig (proem50 / emg3): nur auf EM1.GetStatus antworten (nicht auf
          // explizites EM.GetStatus). Unterscheidung ausschließlich über src.
          if (method === "EM.GetStatus") continue;
          result = em1StatusResult(info.power);
          src = info.meter === "emg3" ? "shellyemg3-hemssink" : "shellyproem50-hemssink";
        }
        const reply = JSON.stringify({ id, src, dst: rinfo.address, result });
        try { sock.send(Buffer.from(reply), rinfo.port, rinfo.address); } catch { /* ignore */ }
      }
    });
    try {
      sock.bind(port, () => {
        try { sock.setBroadcast(true); } catch { /* ignore */ }
        log?.(`Shelly-Discovery lauscht auf UDP ${port}`);
      });
      servers.push(sock);
    } catch (e: any) {
      log?.(`Shelly-Discovery bind ${port} fehlgeschlagen: ${e?.message ?? e}`);
    }
  }
}

export function stopShellyDiscovery(): void {
  for (const s of servers) { try { s.close(); } catch { /* ignore */ } }
  servers = [];
  running = false;
}
