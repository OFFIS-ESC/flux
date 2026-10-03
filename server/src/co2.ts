// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// CO₂-Intensität des deutschen Netzstroms über die ENTSO-E Transparency Platform.
// Ruft die "Actual generation per production type" (documentType A75) ab und
// berechnet daraus die momentane CO₂-Intensität (g/kWh) gewichtet nach dem Anteil
// der Energieträger. Die Werte werden aufgezeichnet und laufend mit dem
// tatsächlichen Netzbezug verrechnet (echte, wachsende CO₂-Bilanz).
//
// Registrierung/Token: Konto auf transparency.entsoe.eu anlegen, per E-Mail an
// transparency@entsoe.eu mit Betreff "Restful API access" freischalten lassen,
// dann Token unter "My Account Settings" erzeugen.

import https from "node:https";
import * as db from "./db.js";

// Deutschland (DE-LU Gebotszone).
const EIC_DE = "10Y1001A1001A82H";
const API = "https://web-api.tp.entsoe.eu/api";

// CO₂-Emissionsfaktoren je Energieträger (g CO₂-Äquiv. / kWh, Lebenszyklus-Median
// nach gängigen Referenzwerten). psrType-Codes B01–B20 der ENTSO-E.
const FAKTOR: Record<string, number> = {
  B01: 820,  // Biomasse (verbrennungsbedingt; konservativ)
  B02: 1050, // Braunkohle
  B03: 490,  // Gas (Kombikraftwerk)
  B04: 490,  // Gas
  B05: 820,  // Steinkohle-Gas
  B06: 650,  // Öl
  B07: 650,  // Ölschiefer
  B08: 820,  // Torf
  B09: 12,   // Geothermie
  B10: 24,   // Pumpspeicher (Wasser)
  B11: 24,   // Laufwasser
  B12: 24,   // Wasser Speicher
  B14: 12,   // Kernkraft
  B15: 24,   // sonstige erneuerbare
  B16: 45,   // Solar
  B17: 230,  // Abfall
  B18: 11,   // Wind offshore
  B19: 11,   // Wind onshore
  B20: 820,  // sonstige (konservativ fossil)
  B25: 820,  // Steinkohle (teils als B25 gemeldet)
};

export interface Co2Config { token: string; }

function httpsGetText(url: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { if ((res.statusCode ?? 500) < 400) resolve(b); else reject(new Error(`ENTSO-E HTTP ${res.statusCode}: ${b.slice(0, 160)}`)); });
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("Zeitüberschreitung")); });
  });
}

// Zeitformat für ENTSO-E: yyyyMMddHHmm in UTC.
function fmtEntsoe(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

// Sehr einfacher XML-Parser für die A75-Antwort: summiert je psrType die
// Erzeugungsmengen (letzter/aktuellster Zeitpunkt genügt für die Momentanintensität).
function berechneIntensitaet(xml: string): number | null {
  // Jede <TimeSeries> hat einen psrType und <Point><quantity>-Werte.
  const serien = xml.split("<TimeSeries>").slice(1);
  const mengeProTyp: Record<string, number> = {};
  for (const s of serien) {
    const typMatch = s.match(/<psrType>(B\d{2})<\/psrType>/);
    if (!typMatch) continue;
    const typ = typMatch[1];
    // "outBiddingZone_Domain" = Verbrauch/Pumpen -> ignorieren, nur Erzeugung zählen.
    if (/outBiddingZone_Domain/.test(s)) continue;
    // Letzten quantity-Wert der Serie nehmen (aktuellster Punkt).
    const q = [...s.matchAll(/<quantity>([\d.]+)<\/quantity>/g)];
    if (q.length === 0) continue;
    const letzte = Number(q[q.length - 1][1]);
    if (Number.isFinite(letzte)) mengeProTyp[typ] = (mengeProTyp[typ] ?? 0) + letzte;
  }
  const gesamt = Object.values(mengeProTyp).reduce((a, b) => a + b, 0);
  if (gesamt <= 0) return null;
  let emissionen = 0;
  for (const [typ, menge] of Object.entries(mengeProTyp)) {
    emissionen += menge * (FAKTOR[typ] ?? 400);
  }
  return emissionen / gesamt; // g/kWh
}

// Aktuelle CO₂-Intensität von ENTSO-E abrufen (g/kWh).
export async function holeCo2Intensitaet(cfg: Co2Config): Promise<{ ok: boolean; gPerKwh?: number; error?: string }> {
  if (!cfg.token) return { ok: false, error: "Kein ENTSO-E-Token konfiguriert" };
  try {
    const jetzt = new Date();
    const von = new Date(jetzt.getTime() - 3 * 3600 * 1000); // letzte 3 h (Daten sind leicht verzögert)
    const url = `${API}?documentType=A75&processType=A16&in_Domain=${EIC_DE}&periodStart=${fmtEntsoe(von)}&periodEnd=${fmtEntsoe(jetzt)}&securityToken=${encodeURIComponent(cfg.token)}`;
    const xml = await httpsGetText(url);
    const intensitaet = berechneIntensitaet(xml);
    if (intensitaet == null) return { ok: false, error: "Keine Erzeugungsdaten in der Antwort" };
    return { ok: true, gPerKwh: Math.round(intensitaet) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "ENTSO-E-Abruf fehlgeschlagen" };
  }
}


// Historische CO₂-Intensität je Stunde für einen Zeitbereich abrufen. Map
// "YYYY-MM-DDTHH" (lokale Zeit) -> g/kWh. ENTSO-E: A75 je Produktionstyp mit
// stündlichen Punkten; wir gewichten je Stunde nach Energieträger-Anteil.
export async function holeCo2Historie(cfg: Co2Config, von: Date, bis: Date): Promise<{ ok: boolean; werte?: Map<string, number>; error?: string }> {
  if (!cfg.token) return { ok: false, error: "Kein ENTSO-E-Token konfiguriert" };
  try {
    const url = `${API}?documentType=A75&processType=A16&in_Domain=${EIC_DE}&periodStart=${fmtEntsoe(von)}&periodEnd=${fmtEntsoe(bis)}&securityToken=${encodeURIComponent(cfg.token)}`;
    const xml = await httpsGetText(url, 30000);
    const serien = xml.split("<TimeSeries>").slice(1);
    const proStunde = new Map<string, Record<string, number>>();
    for (const s of serien) {
      const typMatch = s.match(/<psrType>(B\d{2})<\/psrType>/);
      if (!typMatch) continue;
      if (/outBiddingZone_Domain/.test(s)) continue;
      const typ = typMatch[1];
      const startMatch = s.match(/<start>([^<]+)<\/start>/);
      if (!startMatch) continue;
      const start = new Date(startMatch[1]);
      const resolMatch = s.match(/<resolution>PT(\d+)M<\/resolution>/);
      const minuten = resolMatch ? Number(resolMatch[1]) : 60;
      for (const pt of s.matchAll(/<Point>\s*<position>(\d+)<\/position>\s*<quantity>([\d.]+)<\/quantity>/g)) {
        const pos = Number(pt[1]); const menge = Number(pt[2]);
        if (!Number.isFinite(pos) || !Number.isFinite(menge)) continue;
        const zeit = new Date(start.getTime() + (pos - 1) * minuten * 60000);
        const p = (n: number) => String(n).padStart(2, "0");
        const key = `${zeit.getFullYear()}-${p(zeit.getMonth() + 1)}-${p(zeit.getDate())}T${p(zeit.getHours())}`;
        if (!proStunde.has(key)) proStunde.set(key, {});
        const rec = proStunde.get(key)!;
        rec[typ] = (rec[typ] ?? 0) + menge;
      }
    }
    const werte = new Map<string, number>();
    for (const [key, rec] of proStunde) {
      const gesamt = Object.values(rec).reduce((a, b) => a + b, 0);
      if (gesamt <= 0) continue;
      let em = 0;
      for (const [typ, m] of Object.entries(rec)) em += m * (FAKTOR[typ] ?? 400);
      werte.set(key, em / gesamt);
    }
    return { ok: true, werte };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "ENTSO-E-Historie-Abruf fehlgeschlagen" };
  }
}

let letzteIntensitaet: { gPerKwh: number; ts: number } | null = null;
export function getLetzteCo2Intensitaet(): { gPerKwh: number; ts: number } | null { return letzteIntensitaet; }
export function setLetzteCo2Intensitaet(gPerKwh: number): void { letzteIntensitaet = { gPerKwh, ts: Date.now() }; }
