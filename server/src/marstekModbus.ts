// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import net from "node:net";
import { ModbusTCPClient } from "jsmodbus";

// Marstek Venus – Anbindung per Modbus TCP (Monitoring + Ansteuerung).
//
// Grundlage der Registeradressen ist die Community-Reverse-Engineering-Referenz
// der Home-Assistant-Integration ViperRNMC/marstek_venus_modbus
// (https://github.com/ViperRNMC/marstek_venus_modbus). Marstek stellt Modbus TCP
// je nach Modell/Firmware nativ über LAN/WLAN (Port 502) oder über einen
// RS485-zu-WLAN-Adapter bereit.
//
// Es gibt ZWEI inkompatible Register-Layouts:
//  - "v3-Familie": Venus A, Venus D und Venus E Generation 3 teilen sich dieselben
//    Registeradressen (Spalten a / d / e_v3 der Referenz).
//  - "e-v12": Venus E Generation 1/2 hat abweichende Adressen (Spalte e_v12).
//
// Steuerregister (force mode, Lade-/Entladeleistung, Ziel-SoC, Backup) sind über
// alle Modelle identisch. Für Schreibzugriffe muss der Speicher in den
// RS485-Control-Mode versetzt werden (Register 42000, command_on = 21930).

export type MarstekModbusModel = "venus-v3" | "venus-e-v12" | "anker-m1";

export function isMarstekModbusModel(m: string | undefined): m is MarstekModbusModel {
  return m === "venus-v3" || m === "venus-e-v12" || m === "anker-m1";
}

// Ein einzelnes zu lesendes Register.
interface Reg {
  metric: string;
  label: string;
  addr: number;
  words: 1 | 2;
  signed: boolean;
  scale: number;
  unit: string;
}

// Lese-Register je Layout. metric-Namen power/soc/voltage/current/temperature
// gehen in die Bilanz ein; die übrigen erscheinen nur in der Anzeige.
function coreRegs(model: MarstekModbusModel): Reg[] {
  if (model === "anker-m1") {
    // Anker Solix (Max AC / Solarbank 4) nutzt den „M1"-Third-Party-Registermap
    // mit einem völlig anderen Adressbereich (30001er-Reihe).
    return [
      { metric: "power",         label: "Batterieleistung",     addr: 30001, words: 2, signed: true,  scale: 1,     unit: "W" },
      { metric: "soc",           label: "Ladezustand (SoC)",    addr: 34002, words: 1, signed: false, scale: 1,     unit: "%" },
      { metric: "voltage",       label: "Batteriespannung",     addr: 30100, words: 1, signed: false, scale: 0.01,  unit: "V" },
      { metric: "current",       label: "Batteriestrom",        addr: 30101, words: 1, signed: true,  scale: 0.01,  unit: "A" },
      { metric: "temperature",   label: "Temperatur",           addr: 35000, words: 1, signed: true,  scale: 0.1,   unit: "°C" },
      { metric: "acPower",       label: "AC-Leistung",          addr: 30006, words: 2, signed: true,  scale: 1,     unit: "W" },
      { metric: "capacity",     label: "Batteriegröße",        addr: 32105, words: 1, signed: false, scale: 0.001, unit: "kWh" },
      { metric: "chargeTotal",   label: "Geladen gesamt",       addr: 33000, words: 2, signed: false, scale: 0.01,  unit: "kWh" },
      { metric: "dischargeTotal",label: "Entladen gesamt",      addr: 33002, words: 2, signed: true,  scale: 0.01,  unit: "kWh" },
    ];
  }
  // Marstek Venus – ALLE Generationen (Venus A / D / E-v1/v2/v3) verwenden
  // denselben Registerblock 32100er-Reihe (Community-Referenz ViperRNMC /
  // bvweerd / scruysberghs, mehrfach unabhängig bestätigt):
  //   32100 voltage  uint16 ×0.01 V
  //   32101 current  int16  ×0.01 A  (+ laden / − entladen)
  //   32102-32103 power  int32 ×1 W (+ laden / − entladen)  -> ZWEI Register!
  //   32104 soc      uint16 ×1   %   (direkter Prozentwert, kein 0,1-%-Schritt)
  //   32105 capacity uint16 ×0.001 kWh
  // Wichtig: Die Batterieleistung ist ein int32 über ZWEI Register – ein
  // Ein-Wort-Lesen liefert einen unsinnigen Riesenwert.
  return [
    { metric: "power",         label: "Batterieleistung",     addr: 32102, words: 2, signed: true,  scale: 1,     unit: "W" },
    { metric: "soc",           label: "Ladezustand (SoC)",    addr: 32104, words: 1, signed: false, scale: 1,     unit: "%" },
    { metric: "voltage",       label: "Batteriespannung",     addr: 32100, words: 1, signed: false, scale: 0.01,  unit: "V" },
    { metric: "current",       label: "Batteriestrom",        addr: 32101, words: 1, signed: true,  scale: 0.01,  unit: "A" },
    { metric: "temperature",   label: "Temperatur",           addr: 35000, words: 1, signed: true,  scale: 0.1,   unit: "°C" },
    { metric: "acPower",       label: "AC-Leistung",          addr: 32202, words: 2, signed: true,  scale: 1,     unit: "W" },
    { metric: "capacity",     label: "Batteriegröße",        addr: 32105, words: 1, signed: false, scale: 0.001, unit: "kWh" },
    { metric: "chargeTotal",   label: "Geladen gesamt",       addr: 33000, words: 2, signed: false, scale: 0.01,  unit: "kWh" },
    { metric: "dischargeTotal",label: "Entladen gesamt",      addr: 33002, words: 2, signed: true,  scale: 0.01,  unit: "kWh" },
  ];
}

// Steuerregister (über alle Modelle identisch, Referenz-Spalten a/d/e_v12/e_v3).
const CTRL = {
  rs485ControlMode: 42000, // command_on=21930, command_off=21947
  forceMode: 42010,        // 0=None,1=Charge,2=Discharge
  chargeToSoc: 42011,      // Ziel-SoC (%)
  setChargePower: 42020,   // W
  setDischargePower: 42021,// W
  backup: 41200,           // 0/1
  workMode: 43000,         // 0=Manuell, 1=Anti-Feed-In (Eigenverbrauch), 2=Trade
} as const;
const RS485_ON = 21930;
const RS485_OFF = 21947;

// Betriebsmodus des Speichers (User Work Mode, Register 43000).
export type MarstekWorkMode = "manual" | "selfconsumption" | "trade";
const WORK_MODE_CODE: Record<MarstekWorkMode, number> = {
  manual: 0,
  selfconsumption: 1,
  trade: 2,
};
export function isMarstekWorkMode(m: string | undefined): m is MarstekWorkMode {
  return m === "manual" || m === "selfconsumption" || m === "trade";
}

export interface MarstekModuleStatus {
  index: number;              // Modulnummer (1-basiert)
  soc: number | null;         // Ladestand des Moduls (%, hochauflösend)
  cellMinV: number | null;    // niedrigste Zellspannung im Modul (V)
  cellMaxV: number | null;    // höchste Zellspannung im Modul (V)
  imbalanceV: number | null;  // Spannungsspreizung max−min (V)
}

export interface MarstekModbusReading {
  values: Record<string, number>;
  display: Array<{ label: string; value: number; unit: string }>;
  modules?: MarstekModuleStatus[]; // Status der einzelnen Batteriemodule (falls verfügbar)
}

// Batteriemodul-Register der Marstek Venus (BMS je Modul). Bestätigtes Schema
// aus einer funktionierenden Implementierung:
//   Basisadresse je Modul i (1-basiert): 34000 + (i−1)*100
//   base + 2          SoC des Moduls   (uint16, ×0.1 %)
//   base + 18 .. +30  13 Zellspannungen (int16, ×0.001 V)
// Die Modulzahl steht in einem eigenen Register; liefert es keinen plausiblen
// Wert, wird bis zur Obergrenze gelesen und beim ersten nicht antwortenden
// Modul abgebrochen (wie in der Referenz).
const MARSTEK_MODULE = {
  countAddr: 30086,   // Anzahl angebundener Batteriemodule (uint16)
  base: 34000,        // Basis des ersten Moduls
  stride: 100,        // Adressabstand je Modul
  socOffset: 2,       // SoC-Register relativ zur Modulbasis (×0.1 %)
  cellOffset: 18,     // erstes Zellspannungs-Register relativ zur Modulbasis
  cellCount: 13,      // Zellen je Modul
  maxModules: 16,     // Sicherheitsobergrenze
} as const;

function combine(words: number[], signed: boolean): number {
  let raw = 0;
  for (const w of words) raw = raw * 65536 + (w & 0xffff);
  if (signed) {
    const bits = words.length * 16;
    const max = 2 ** bits;
    if (raw >= max / 2) raw -= max;
  }
  return raw;
}

// Öffnet eine Modbus-TCP-Verbindung und ruft fn mit dem Client auf.
function withClient<T>(
  host: string, port: number, unitId: number, timeoutMs: number,
  fn: (client: ModbusTCPClient) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const client = new ModbusTCPClient(socket, unitId);
    let done = false;
    const finish = (err: Error | null, res?: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      if (err) reject(err); else resolve(res!);
    };
    const timer = setTimeout(() => finish(new Error("Modbus-Zeitüberschreitung")), timeoutMs);
    socket.on("error", (e) => finish(e));
    socket.connect(port, host, async () => {
      try { finish(null, await fn(client)); }
      catch (e: any) { finish(e instanceof Error ? e : new Error(String(e))); }
    });
  });
}

// Liest die Kernregister eines Marstek-Speichers per Modbus TCP.
export function readMarstekModbus(
  host: string, port: number, unitId: number,
  model: MarstekModbusModel, timeoutMs: number,
): Promise<MarstekModbusReading> {
  return withClient(host, port, unitId, timeoutMs, async (client) => {
    const regs = coreRegs(model);
    const values: Record<string, number> = {};
    const display: Array<{ label: string; value: number; unit: string }> = [];
    for (const r of regs) {
      try {
        const resp = await client.readHoldingRegisters(r.addr, r.words);
        const words = resp.response.body.valuesAsArray as unknown as number[];
        const val = combine([...words], r.signed) * r.scale;
        const rounded = Math.round(val * 1000) / 1000;
        values[r.metric] = rounded;
        // Batteriestrom wird zwar gelesen, aber auf Wunsch nicht mehr angezeigt.
        if (r.metric !== "current") {
          display.push({ label: r.label, value: rounded, unit: r.unit });
        }
      } catch {
        // Modellabhängig nicht verfügbare Register überspringen.
      }
    }
    if (Object.keys(values).length === 0) {
      throw new Error("keine Register gelesen (Modell/Adressen prüfen)");
    }
    // Aktuell gespeicherte Energie = Batteriegröße (Kapazität) × Ladezustand.
    // Register 32105 liefert die Kapazität, nicht die momentan gespeicherte
    // Energie – daher hier aus Kapazität und SoC berechnen und als eigene Kachel
    // direkt hinter der Batteriegröße einfügen.
    if (values.capacity != null && values.soc != null) {
      const stored = Math.round(values.capacity * (values.soc / 100) * 1000) / 1000;
      values.storedEnergy = stored;
      const capIdx = display.findIndex((d) => d.label === "Batteriegröße");
      const entry = { label: "Gespeicherte Energie", value: stored, unit: "kWh" };
      if (capIdx >= 0) display.splice(capIdx + 1, 0, entry);
      else display.push(entry);
    }
    // Status der einzelnen Batteriemodule (nur Marstek Venus). Best effort: schlägt
    // das Lesen fehl oder liefert keine plausible Modulzahl, wird es weggelassen.
    let modules: MarstekModuleStatus[] | undefined;
    if (model !== "anker-m1") {
      try {
        modules = await readMarstekModules(client);
        if (modules.length === 0) modules = undefined;
      } catch {
        modules = undefined;
      }
    }
    return { values, display, modules };
  });
}

// Liest je Modul den (hochauflösenden) SoC und die 13 Zellspannungen und leitet
// daraus min/max/Ungleichgewicht ab. Schema aus einer bestätigten
// Implementierung: Modulbasis 34000 + (i−1)*100, SoC bei base+2 (×0,1 %),
// Zellspannungen ab base+18 (13× int16, ×0,001 V). Beim ersten nicht lesbaren
// Modul wird abgebrochen (die gemeldete Modulzahl kann höher sein als real).
async function readMarstekModules(client: ModbusTCPClient): Promise<MarstekModuleStatus[]> {
  const rd1 = async (addr: number): Promise<number | null> => {
    try {
      const r = await client.readHoldingRegisters(addr, 1);
      return (r.response.body.valuesAsArray as unknown as number[])[0];
    } catch { return null; }
  };
  const rdBlock = async (addr: number, count: number): Promise<number[] | null> => {
    try {
      const r = await client.readHoldingRegisters(addr, count);
      return [...(r.response.body.valuesAsArray as unknown as number[])];
    } catch { return null; }
  };
  const s16 = (v: number): number => (v >= 0x8000 ? v - 0x10000 : v);

  // Modulzahl bestimmen; ohne plausiblen Wert bis zur Obergrenze probieren.
  let n = await rd1(MARSTEK_MODULE.countAddr);
  if (n == null || n <= 0 || n > MARSTEK_MODULE.maxModules) n = MARSTEK_MODULE.maxModules;

  const out: MarstekModuleStatus[] = [];
  for (let i = 1; i <= n; i++) {
    const base = MARSTEK_MODULE.base + (i - 1) * MARSTEK_MODULE.stride;
    // SoC (×0,1 %). Schlägt schon das fehl, existiert das Modul nicht -> Abbruch.
    const socRaw = await rd1(base + MARSTEK_MODULE.socOffset);
    if (socRaw == null) break;
    const soc = Math.round(socRaw * 0.1 * 10) / 10;

    // 13 Zellspannungen (int16, ×0,001 V) als Block lesen.
    let cellMinV: number | null = null, cellMaxV: number | null = null, imbalanceV: number | null = null;
    const cellsRaw = await rdBlock(base + MARSTEK_MODULE.cellOffset, MARSTEK_MODULE.cellCount);
    if (cellsRaw && cellsRaw.length > 0) {
      const cells = cellsRaw.map((w) => s16(w) * 0.001).filter((v) => v > 0.5 && v < 5);
      if (cells.length > 0) {
        cellMinV = Math.round(Math.min(...cells) * 1000) / 1000;
        cellMaxV = Math.round(Math.max(...cells) * 1000) / 1000;
        imbalanceV = Math.round((cellMaxV - cellMinV) * 1000) / 1000;
      }
    }
    const socPlausibel = soc > 0 && soc <= 100;
    const hatZellen = cellMinV != null;
    // Ein Modul gilt nur als real vorhanden, wenn es einen plausiblen Ladestand
    // ODER gültige Zellspannungen liefert. Nicht bestückte Modulplätze antworten
    // je nach Firmware mit Nullen/Leerwerten – diese werden nicht als Modul
    // gezählt und beenden die Suche (es folgen keine weiteren belegten Plätze).
    if (!socPlausibel && !hatZellen) break;
    out.push({
      index: i,
      soc: soc >= 0 && soc <= 100 ? soc : null,
      cellMinV, cellMaxV, imbalanceV,
    });
  }
  return out;
}

// Liest zusätzlich die aktuellen Steuerwerte (Betriebsmodus etc.) aus.
export async function readMarstekModbusControl(
  host: string, port: number, unitId: number, timeoutMs: number,
): Promise<{ forceMode: number | null; chargeToSoc: number | null; backup: number | null }> {
  return withClient(host, port, unitId, timeoutMs, async (client) => {
    const rd = async (addr: number): Promise<number | null> => {
      try {
        const r = await client.readHoldingRegisters(addr, 1);
        return (r.response.body.valuesAsArray as unknown as number[])[0];
      } catch { return null; }
    };
    return {
      forceMode: await rd(CTRL.forceMode),
      chargeToSoc: await rd(CTRL.chargeToSoc),
      backup: await rd(CTRL.backup),
    };
  });
}

export type MarstekForceMode = "none" | "charge" | "discharge";

// Setzt den Force-Modus (und optional Leistung/Ziel-SoC). Aktiviert zunächst den
// RS485-Control-Mode, ohne den Steuerregister nicht angenommen werden.
export async function setMarstekModbusForce(
  host: string, port: number, unitId: number, timeoutMs: number,
  mode: MarstekForceMode, opts: { powerW?: number; toSoc?: number } = {},
): Promise<void> {
  return withClient(host, port, unitId, timeoutMs, async (client) => {
    // 1) RS485-Control-Mode aktivieren.
    await client.writeSingleRegister(CTRL.rs485ControlMode, RS485_ON);
    // 2) Optional Leistung/Ziel-SoC setzen.
    if (opts.powerW != null && Number.isFinite(opts.powerW)) {
      const p = Math.max(0, Math.round(Math.abs(opts.powerW)));
      if (mode === "charge") await client.writeSingleRegister(CTRL.setChargePower, p);
      else if (mode === "discharge") await client.writeSingleRegister(CTRL.setDischargePower, p);
    }
    if (opts.toSoc != null && Number.isFinite(opts.toSoc)) {
      const s = Math.min(100, Math.max(0, Math.round(opts.toSoc)));
      await client.writeSingleRegister(CTRL.chargeToSoc, s);
    }
    // 3) Force-Modus setzen.
    const code = mode === "charge" ? 1 : mode === "discharge" ? 2 : 0;
    await client.writeSingleRegister(CTRL.forceMode, code);
  });
}

// Backup-Funktion (Notstromreserve) ein-/ausschalten.
export async function setMarstekModbusBackup(
  host: string, port: number, unitId: number, timeoutMs: number, on: boolean,
): Promise<void> {
  return withClient(host, port, unitId, timeoutMs, async (client) => {
    await client.writeSingleRegister(CTRL.rs485ControlMode, RS485_ON);
    await client.writeSingleRegister(CTRL.backup, on ? 1 : 0);
  });
}

// Setzt den Betriebsmodus (User Work Mode, Register 43000). Zuvor wird ein
// eventuell aktiver Force-Modus beendet (forceMode=0) und die RS485-Übersteuerung
// abgeschaltet (command_off), damit der gewählte Work-Mode tatsächlich greift und
// der Speicher wieder eigenständig regelt.
export async function setMarstekModbusWorkMode(
  host: string, port: number, unitId: number, timeoutMs: number, mode: MarstekWorkMode,
): Promise<void> {
  return withClient(host, port, unitId, timeoutMs, async (client) => {
    // RS485-Steuermodus kurz aktivieren, um schreiben zu dürfen.
    await client.writeSingleRegister(CTRL.rs485ControlMode, RS485_ON);
    // Force-Übersteuerung beenden.
    await client.writeSingleRegister(CTRL.forceMode, 0);
    // Gewünschten Betriebsmodus setzen.
    await client.writeSingleRegister(CTRL.workMode, WORK_MODE_CODE[mode]);
    // RS485-Übersteuerung wieder freigeben, damit der Work-Mode eigenständig regelt.
    await client.writeSingleRegister(CTRL.rs485ControlMode, RS485_OFF);
  });
}
