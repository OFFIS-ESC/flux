// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Anomalie-Erkennung – eigenständiges Subsystem.
//
// Kategorienbasierte Detektoren laufen periodisch (eigener langsamer Tick) über
// alle passenden Objekte und melden Auffälligkeiten. Ein Detektor liefert bei
// jedem Lauf pro Objekt einen "Befund": auffällig (mit Detailtext/Messwerten)
// oder normal. Der Lebenszyklus (aktiv/quittiert/beendet), die Hysterese gegen
// Flattern und die Unterdrückung quittierter Dauer-Anomalien werden zentral hier
// verwaltet – die einzelnen Detektoren bleiben dadurch einfach und zustandslos.

import * as db from "./db.js";
import type {
  AnomalieConfig, AnomalieDetektorConfig, AnomalieDetektorId,
  Anomalie, AnomalieStatus, AnomalieStatusResponse,
} from "./types.js";

// --- Detektor-Schnittstelle ---
// Ein Befund je Objekt. auffaellig=false bedeutet Normalzustand.
export interface Befund {
  objektId: string;
  objektName: string;
  auffaellig: boolean;
  detail: string;
  messwerte: Record<string, number>;
  begruendung?: import("./types.js").AnomalieBegruendung;
}
// Kontext, den die Detektoren zum Prüfen brauchen (von außen injiziert, damit das
// Modul nicht direkt vom Poller abhängt -> keine Zirkularität).
export interface AnomalieKontext {
  // Quellen mit Status (für source-offline).
  quellen: Array<{ id: string; label: string; role: string; intervalSec: number; enabled: boolean; lastSuccess: number | null; ausgeschaltet?: boolean }>;
  // PV-Stränge mit aktueller Leistung (für pv-string).
  pvStraenge: Array<{ id: string; label: string; watt: number; gruppe?: string }>;
  // Standort (für Sonnenstand-Berechnung, optional).
  standort?: { lat: number; lon: number } | null;
  // Systemzustand (für grid-trotz-speicher).
  gridPowerW: number;         // >0 Bezug, <0 Einspeisung
  batterieSocMax: number;     // höchster SoC aller Speicher (%)
  batterieEntladeReserveW: number; // wie viel die Speicher gerade noch liefern könnten (grob)
  jetztMs: number;
  startMs?: number; // Startzeitpunkt von FLUX (für die Neustart-Schonfrist)
  // Für die Verbrauchs-Baseline: Liste der Verbraucher (id/label) und das Datum
  // des zuletzt ABGESCHLOSSENEN Tages, sobald ein Tageswechsel stattfand (sonst
  // null). Der Baseline-Detektor wertet nur beim Tageswechsel aus.
  verbraucher?: Array<{ id: string; label: string }>;
  abgeschlossenerTag?: string | null; // "YYYY-MM-DD" oder null
  // Für den Urlaubs-Detektor: aktuelle Momentanleistung je Verbraucher (W) und
  // aktueller Wasserdurchfluss (l/min oder >0 = Abgabe), plus das heutige Datum.
  verbraucherLeistung?: Record<string, number>;
  wasserFliesst?: boolean;
  heuteDatum?: string; // "YYYY-MM-DD"
  // Für den Urlaubs-Detektor: aktuelle Hue-Untergeräte (Zustand von Leuchten und
  // Bewegungsmeldern), je serviceId.
  hueGeraete?: Array<{ serviceId: string; name: string; kind: string; on?: boolean; motion?: boolean | null }>;
}

export const DETEKTOR_NAMEN: Record<AnomalieDetektorId, string> = {
  "source-offline": "Quellen-Ausfall",
  "pv-string": "PV-Strang-Einbruch",
  "grid-trotz-speicher": "Netzbezug trotz Speicher",
  "verbrauch-baseline": "Verbrauchs-Auffälligkeit",
  "urlaub": "Urlaubs-Überwachung",
};

// Sinnvolle Default-Konfiguration.
const DEFAULT_CONFIG: AnomalieConfig = {
  enabled: true,
  detektoren: [
    { id: "source-offline", enabled: true, params: { faktor: 5, minSekunden: 120 }, ignoriert: [] },
    { id: "pv-string", enabled: true, params: { anteilProzent: 25, minWatt: 150, bestaetigungMin: 10 }, ignoriert: [] },
    { id: "grid-trotz-speicher", enabled: true, params: { minWatt: 300, minSoc: 30, bestaetigungMin: 5 }, ignoriert: [] },
    // Verbrauchs-Baseline: lernt Tagesverbrauch je Verbraucher über 'tageFenster'
    // Tage. sigmaFaktor = ab wie vielen Standardabweichungen über dem Mittel eine
    // Anomalie gilt. maxVariationsKoeff = obere Grenze für die relative Streuung,
    // ab der ein Gerät als "zu unregelmäßig für eine verlässliche Aussage" gilt
    // (dann schweigt der Detektor automatisch). minTageDaten = wie viele Tage
    // Historie mindestens vorliegen müssen. ausfallProzent = ab wie wenig % des
    // Üblichen als "läuft nicht mehr" gilt. minKwh = Bagatellgrenze (Kleinstgeräte
    // ohne relevanten Verbrauch werden nicht überwacht).
    { id: "verbrauch-baseline", enabled: true, params: {
      tageFenster: 14, sigmaFaktor: 3, maxVariationsKoeff: 40, minTageDaten: 5,
      ausfallProzent: 10, minKwh: 0.1,
    }, ignoriert: [], erzwungen: [] },
    // Urlaubs-Überwachung: nur zwischen urlaubStart und urlaubEnde aktiv. Meldet,
    // wenn ein überwachter Verbraucher über schwelleWatt zieht (nach kurzer
    // Bestätigung) oder – falls aktiviert – Wasser fließt. Standardmäßig aus
    // (enabled=false), bis ein Urlaub geplant wird.
    { id: "urlaub", enabled: false, params: { schwelleWatt: 15, bestaetigungMin: 10 },
      ignoriert: [], urlaubStart: null, urlaubEnde: null,
      ueberwachteVerbraucher: [], ueberwacheWasser: true },
  ],
};

// Hysterese: wie lange Normalzustand stabil sein muss, bevor eine Anomalie als
// "beendet" gilt (gegen Flattern). Global, in Millisekunden.
const BERUHIGUNG_MS = 3 * 60 * 1000;
// Wie oft ein noch auffälliger Befund als "zuletztGesehen" aktualisiert wird,
// bevor pv-string/grid ihre Bestätigungszeit erreicht haben (siehe Detektoren).

let config: AnomalieConfig = { ...DEFAULT_CONFIG };

// Laufende Anomalien im Speicher (aktiv + quittiert-andauernd). Beendete wandern
// nur ins persistente Protokoll. Schlüssel: detektorId|objektId (ein aktiver
// Eintrag je Detektor+Objekt).
interface LaufendeAnomalie extends Anomalie {
  // interner Hysterese-Zustand:
  normalSeitMs: number | null; // seit wann wieder normal (für Beruhigung); null = aktuell auffällig
  // Kandidat-Startzeit für Detektoren mit Bestätigungsdauer (pv/grid):
  auffaelligSeitMs: number;
}
const laufend = new Map<string, LaufendeAnomalie>();
const schluessel = (d: AnomalieDetektorId, o: string) => `${d}|${o}`;

let idCounter = 1;
function neueId(): string { return `an_${Date.now()}_${idCounter++}`; }

// --- Konfiguration laden/speichern ---
export function loadAnomalieConfig(): void {
  const raw = db.getSettingRaw("anomalieConfig");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AnomalieConfig;
      // Mit Defaults mergen, damit neue Detektoren nach Update automatisch dazukommen.
      const merged: AnomalieConfig = { enabled: parsed.enabled !== false, detektoren: [] };
      for (const def of DEFAULT_CONFIG.detektoren) {
        const vorhanden = parsed.detektoren?.find((d) => d.id === def.id);
        merged.detektoren.push(vorhanden
          ? { ...def, ...vorhanden, params: { ...def.params, ...(vorhanden.params ?? {}) }, ignoriert: vorhanden.ignoriert ?? [],
              erzwungen: vorhanden.erzwungen ?? def.erzwungen ?? [],
              urlaubStart: vorhanden.urlaubStart ?? def.urlaubStart ?? null,
              urlaubEnde: vorhanden.urlaubEnde ?? def.urlaubEnde ?? null,
              ueberwachteVerbraucher: vorhanden.ueberwachteVerbraucher ?? def.ueberwachteVerbraucher ?? [],
              ueberwacheWasser: vorhanden.ueberwacheWasser ?? def.ueberwacheWasser ?? false,
              ueberwachteHue: vorhanden.ueberwachteHue ?? def.ueberwachteHue ?? [] }
          : { ...def });
      }
      config = merged;
    } catch { config = { ...DEFAULT_CONFIG }; }
  } else {
    config = { ...DEFAULT_CONFIG };
  }
}
export function getAnomalieConfig(): AnomalieConfig { return config; }
export function saveAnomalieConfig(next: AnomalieConfig): void {
  config = next;
  db.setSettingRaw("anomalieConfig", JSON.stringify(next));
}

function detektorCfg(id: AnomalieDetektorId): AnomalieDetektorConfig | undefined {
  return config.detektoren.find((d) => d.id === id);
}

// ================= Detektoren (zustandslos, liefern Befunde) =================

// Detektor 1: Quellen-Ausfall. Eine Quelle gilt als ausgefallen, wenn ihr letzter
// erfolgreicher Poll länger her ist als max(faktor × Poll-Intervall, minSekunden).
// Grobe Sonnenstands-Berechnung: liefert die Sonnenhöhe über dem Horizont (Grad)
// für Koordinaten und Zeitpunkt. Positiv = über Horizont (Tag). Genauigkeit
// reicht für die Tag/Nacht-Unterscheidung völlig aus.
function sonnenhoeheGrad(lat: number, lon: number, d: Date): number {
  const rad = Math.PI / 180;
  const tag = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  // Deklination der Sonne (Näherung).
  const dekl = 23.45 * Math.sin(rad * 360 * (284 + tag) / 365);
  // Stundenwinkel aus der wahren Ortszeit (Näherung ohne Zeitgleichung).
  const stundenUTC = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const wahreOrtszeit = stundenUTC + lon / 15;
  const stundenwinkel = (wahreOrtszeit - 12) * 15;
  const h = Math.asin(
    Math.sin(lat * rad) * Math.sin(dekl * rad) +
    Math.cos(lat * rad) * Math.cos(dekl * rad) * Math.cos(stundenwinkel * rad)
  ) / rad;
  return h;
}

// Ist es gerade "PV-Zeit"? Kombiniert robust: Sonne merklich über Horizont
// (> -2°, deckt auch Dämmerung ab) ODER die PV-Anlage liefert noch nennenswert.
// Nur wenn BEIDES verneint ist (Nacht UND keine Erzeugung), gilt ein PV-Ausfall
// als sonnenuntergangsbedingt und wird nicht gemeldet.
function istPvZeit(ctx: AnomalieKontext): boolean {
  const pvGesamt = ctx.pvStraenge.reduce((a, s) => a + s.watt, 0);
  if (pvGesamt > 25) return true; // Anlage liefert noch -> Tag
  if (ctx.standort && Number.isFinite(ctx.standort.lat) && Number.isFinite(ctx.standort.lon)) {
    const jetzt = new Date(ctx.jetztMs);
    const h = sonnenhoeheGrad(ctx.standort.lat, ctx.standort.lon, jetzt);
    // Puffer nach Sonnenaufgang: Wechselrichter brauchen nach dem astronomischen
    // Sonnenaufgang noch etwas, bis sie hochfahren und antworten. Erst 30 min nach
    // Sonnenaufgang gilt PV-Zeit – vorher wird ein stummer WR NICHT als Ausfall
    // gewertet. (Abends bleibt es beim direkten Horizont, damit ein echter Ausfall
    // am Nachmittag weiterhin erkannt wird.)
    const hVor30 = sonnenhoeheGrad(ctx.standort.lat, ctx.standort.lon, new Date(ctx.jetztMs - 30 * 60 * 1000));
    const steigt = h > hVor30; // morgens steigt die Sonne
    if (steigt) {
      // Morgens: erst PV-Zeit, wenn die Sonne schon vor 30 min über dem Horizont war.
      return hVor30 > -2;
    }
    // Nachmittags/Abends: direkt am Horizont (kein Puffer nötig).
    return h > -2;
  }
  // Ohne Standort: nur die Erzeugung als Kriterium.
  return pvGesamt > 0;
}

function detektorSourceOffline(ctx: AnomalieKontext, cfg: AnomalieDetektorConfig): Befund[] {
  const faktor = cfg.params.faktor ?? 5;
  const minSek = cfg.params.minSekunden ?? 120;
  const pvZeit = istPvZeit(ctx);
  const out: Befund[] = [];
  for (const q of ctx.quellen) {
    if (!q.enabled) continue;
    if (cfg.ignoriert.includes(q.id)) continue;
    const schwelleSek = Math.max(faktor * q.intervalSec, minSek);
    const stilleSek = q.lastSuccess == null ? Infinity : (ctx.jetztMs - q.lastSuccess) / 1000;
    let auffaellig = stilleSek > schwelleSek;
    // Sonnenuntergang-Ausnahme: PV-Wechselrichter sind DC-versorgt und gehen bei
    // Dunkelheit offline. Ist gerade keine PV-Zeit (Nacht + keine Erzeugung),
    // wird ein stummer PV-Wechselrichter NICHT als Ausfall gemeldet.
    if (auffaellig && q.role === "pv" && !pvZeit) auffaellig = false;
    // Neustart-Schonfrist: In den ersten 30 min nach dem Start von FLUX hatten die
    // Quellen noch keine (ausreichende) Gelegenheit zu antworten – besonders solche
    // mit seltenem Sendeintervall. Ein "noch nie ausgelesen" (lastSuccess == null)
    // wird daher erst nach der Schonfrist gemeldet, um Neustart-Rauschen zu vermeiden.
    if (auffaellig && q.lastSuccess == null && ctx.startMs != null && (ctx.jetztMs - ctx.startMs) < 30 * 60 * 1000) auffaellig = false;
    // "Ausgeschaltet"-Ausnahme: Ist die Quelle über einen verknüpften Schalter
    // (powerSourceId) stromlos geschaltet, ist ein fehlgeschlagener Abruf normal
    // (z. B. Prusa-Drucker, dessen Shelly aus ist) – dann kein Ausfall melden.
    if (auffaellig && q.ausgeschaltet) auffaellig = false;
    out.push({
      objektId: q.id, objektName: q.label, auffaellig,
      detail: auffaellig
        ? (q.lastSuccess == null
            ? "Noch nie erfolgreich abgefragt."
            : `Seit ${Math.round(stilleSek / 60)} min keine Antwort (Schwelle ${Math.round(schwelleSek / 60)} min).`)
        : "",
      messwerte: { stilleSek: Math.round(Number.isFinite(stilleSek) ? stilleSek : -1), schwelleSek: Math.round(schwelleSek) },
      begruendung: auffaellig ? {
        titel: "Warum wurde das gemeldet?",
        felder: [
          { label: "Quelle stumm seit", wert: q.lastSuccess == null ? "noch nie geantwortet" : `${Math.round(stilleSek / 60)} min`, hervor: true },
          { label: "Poll-Intervall der Quelle", wert: `${q.intervalSec} s` },
          { label: "Ausfall-Schwelle", wert: `${Math.round(schwelleSek / 60)} min (= ${faktor}× Intervall, mind. ${Math.round(minSek / 60)} min)` },
        ],
      } : undefined,
    });
  }
  return out;
}

// Detektor 2: PV-Strang-Einbruch. Vergleich der Stränge UNTEREINANDER zur selben
// Zeit (robust gegen Wetter): Ein Strang, der deutlich unter dem Median der
// anderen liegt, während diese nennenswert liefern, ist verdächtig. Greift nur,
// wenn mindestens 2 Vergleichsstränge normal liefern (bei nur einem Strang ist
// kein Vergleich möglich). Die Bestätigungsdauer (bestaetigungMin) wird zentral
// über den auffaelligSeitMs-Mechanismus im Lebenszyklus gehandhabt.


// Detektor 3: Netzbezug trotz Speicher. Verdächtig, wenn nennenswerter Netzbezug
// besteht, obwohl der Speicher gut geladen ist UND genug Entladereserve hätte, um
// den Bezug zu decken. Kurzzeitige Lastspitzen werden über die Bestätigungsdauer
// (bestaetigungMin) herausgefiltert.
// PV-Strang-Einbruch: vergleicht Stränge NUR innerhalb desselben Wechselrichters
// (gleiche Gruppe/IP). Ein Strang, der deutlich weniger liefert als die anderen
// Stränge desselben Geräts, gilt als auffällig (Verschattung, Defekt).
function detektorPvString(ctx: AnomalieKontext, cfg: AnomalieDetektorConfig): Befund[] {
  const anteil = (cfg.params.anteilProzent ?? 25) / 100;
  const minWatt = cfg.params.minWatt ?? 150;
  const straenge = ctx.pvStraenge.filter((s) => !cfg.ignoriert.includes(s.id));
  const out: Befund[] = [];

  for (const s of straenge) {
    // NUR Stränge desselben Wechselrichters (gleiche Gruppe/IP) als Referenz.
    const gruppe = s.gruppe ?? s.id;
    const andere = straenge.filter((x) => x.id !== s.id && (x.gruppe ?? x.id) === gruppe).map((x) => x.watt);
    if (andere.length === 0) {
      // Einzelner Strang am Wechselrichter -> kein interner Vergleich möglich.
      out.push({ objektId: s.id, objektName: s.label, auffaellig: false, detail: "", messwerte: { watt: Math.round(s.watt), referenzW: 0 } });
      continue;
    }
    const ref = median(andere);
    if (ref < minWatt) {
      out.push({ objektId: s.id, objektName: s.label, auffaellig: false, detail: "", messwerte: { watt: Math.round(s.watt), referenzW: Math.round(ref) } });
      continue;
    }
    const auffaellig = s.watt < ref * anteil;
    out.push({
      objektId: s.id, objektName: s.label, auffaellig,
      detail: auffaellig ? `Liefert ${Math.round(s.watt)} W, andere Stränge desselben Wechselrichters im Mittel ${Math.round(ref)} W (unter ${Math.round(anteil * 100)} %).` : "",
      messwerte: { watt: Math.round(s.watt), referenzW: Math.round(ref) },
      begruendung: auffaellig ? {
        titel: "Warum wurde das gemeldet?",
        felder: [
          { label: "Dieser Strang liefert", wert: `${Math.round(s.watt)} W`, hervor: true },
          { label: "Andere Stränge am selben Wechselrichter (Median)", wert: `${Math.round(ref)} W` },
          { label: "Verhältnis", wert: `${Math.round((s.watt / (ref || 1)) * 100)} % (Alarm unter ${Math.round(anteil * 100)} %)` },
        ],
      } : undefined,
    });
  }
  return out;
}

function detektorGridTrotzSpeicher(ctx: AnomalieKontext, cfg: AnomalieDetektorConfig): Befund[] {
  const minWatt = cfg.params.minWatt ?? 300;
  const minSoc = cfg.params.minSoc ?? 30;
  const objektId = "system";
  const bezug = ctx.gridPowerW > 0 ? ctx.gridPowerW : 0;
  // Verdächtig nur, wenn Bezug > Schwelle, SoC hoch genug UND der Speicher den
  // Bezug rechnerisch decken könnte (Reserve >= Bezug). Deckt er ihn nicht (echte
  // Grenze/hohe Last), ist der Bezug erklärbar -> kein Befund.
  const auffaellig = bezug > minWatt && ctx.batterieSocMax >= minSoc && ctx.batterieEntladeReserveW >= bezug;
  return [{
    objektId, objektName: "Gesamtsystem", auffaellig,
    detail: auffaellig
      ? `Netzbezug ${Math.round(bezug)} W trotz Speicher-SoC ${Math.round(ctx.batterieSocMax)} % und ~${Math.round(ctx.batterieEntladeReserveW)} W Entladereserve.`
      : "",
    messwerte: { bezugW: Math.round(bezug), socMax: Math.round(ctx.batterieSocMax), reserveW: Math.round(ctx.batterieEntladeReserveW) },
    begruendung: auffaellig ? {
      titel: "Warum wurde das gemeldet?",
      felder: [
        { label: "Netzbezug", wert: `${Math.round(bezug)} W`, hervor: true },
        { label: "Höchster Speicher-SoC", wert: `${Math.round(ctx.batterieSocMax)} %` },
        { label: "Geschätzte Entladereserve", wert: `~${Math.round(ctx.batterieEntladeReserveW)} W` },
        { label: "Bewertung", wert: "Speicher könnte den Bezug decken – deutet auf ein Regelungsproblem hin." },
      ],
    } : undefined,
  }];
}

// Detektor 4: Verbrauchs-Baseline (nur beim Tageswechsel).
function detektorVerbrauchBaseline(ctx: AnomalieKontext, cfg: AnomalieDetektorConfig): Befund[] {
  const tag = ctx.abgeschlossenerTag;
  if (!tag) return []; // nur beim Tageswechsel auswerten
  const verbraucher = ctx.verbraucher ?? [];
  if (verbraucher.length === 0) return [];

  const tageFenster = Math.max(3, cfg.params.tageFenster ?? 14);
  const sigmaFaktor = cfg.params.sigmaFaktor ?? 3;
  const maxVarK = (cfg.params.maxVariationsKoeff ?? 40) / 100;
  const minTage = Math.max(3, cfg.params.minTageDaten ?? 5);
  const ausfallAnteil = (cfg.params.ausfallProzent ?? 10) / 100;
  const minKwh = cfg.params.minKwh ?? 0.1;
  const erzwungen = cfg.erzwungen ?? [];

  // Historie: die letzten tageFenster Tage vor dem abgeschlossenen Tag als
  // Baseline, plus der abgeschlossene Tag als zu bewertender Wert.
  const bisTs = `${tag}T23:59:59`;
  const von = new Date(Date.parse(`${tag}T00:00:00`) - tageFenster * 86400000);
  const vonTs = von.toISOString().slice(0, 10) + "T00:00:00";
  const rows = db.getConsumerTagesSummen(vonTs, bisTs);

  const perConsumer = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = perConsumer.get(r.consumer);
    if (!m) { m = new Map(); perConsumer.set(r.consumer, m); }
    m.set(r.tag, r.kwh);
  }

  const out: Befund[] = [];
  for (const v of verbraucher) {
    if (cfg.ignoriert.includes(v.id)) continue;
    const tage = perConsumer.get(v.id);
    if (!tage) continue;
    const heuteKwh = tage.get(tag) ?? 0;
    const basis: number[] = [];
    for (const [t, kwh] of tage) if (t !== tag) basis.push(kwh);
    if (basis.length < minTage) continue;

    const mittel = basis.reduce((a, b) => a + b, 0) / basis.length;
    if (mittel < minKwh) continue;
    const varianz = basis.reduce((a, b) => a + (b - mittel) ** 2, 0) / basis.length;
    const sigma = Math.sqrt(varianz);
    const variationsKoeff = mittel > 0 ? sigma / mittel : Infinity;

    // Selbst-Aussparung zu unregelmäßiger Geräte (außer erzwungen).
    if (variationsKoeff > maxVarK && !erzwungen.includes(v.id)) continue;

    // Für die eingefrorene Verlaufsgrafik: chronologische Tageswerte der Baseline.
    const verlaufTage = [...tage.entries()]
      .filter(([t]) => t !== tag)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, kwh]) => ({ tag: t, wert: round2(kwh) }));

    // Befund "läuft nicht mehr": heute praktisch 0 trotz üblichem Verbrauch.
    if (heuteKwh < mittel * ausfallAnteil) {
      out.push({
        objektId: v.id, objektName: v.label, auffaellig: true,
        detail: `Nur ${heuteKwh.toFixed(2)} kWh am ${tag} – üblich ~${mittel.toFixed(2)} kWh. Läuft das Gerät noch?`,
        messwerte: { heuteKwh: round2(heuteKwh), mittelKwh: round2(mittel), sigmaKwh: round2(sigma) },
        begruendung: {
          titel: "Warum wurde das gemeldet? (läuft nicht mehr)",
          felder: [
            { label: `Verbrauch am ${tag}`, wert: `${heuteKwh.toFixed(2)} kWh`, hervor: true },
            { label: "Üblich", wert: `${mittel.toFixed(2)} ± ${sigma.toFixed(2)} kWh/Tag` },
            { label: "Untergrenze (laeuft nicht mehr)", wert: `${(mittel * ausfallAnteil).toFixed(2)} kWh` },
            { label: "Baseline aus", wert: `${basis.length} Tagen` },
          ],
          verlauf: { einheit: "kWh/Tag", tage: verlaufTage, heuteWert: round2(heuteKwh) },
        },
      });
      continue;
    }
    // Befund "zu hoch": Ausreißer nach oben (mind. sigmaFaktor×Sigma UND 20% über Mittel).
    const schwelle = mittel + sigmaFaktor * sigma;
    if (heuteKwh > schwelle && heuteKwh > mittel * 1.2) {
      out.push({
        objektId: v.id, objektName: v.label, auffaellig: true,
        detail: `${heuteKwh.toFixed(2)} kWh am ${tag} – üblich ~${mittel.toFixed(2)} ± ${sigma.toFixed(2)} kWh (auffällig hoch).`,
        messwerte: { heuteKwh: round2(heuteKwh), mittelKwh: round2(mittel), sigmaKwh: round2(sigma), schwelleKwh: round2(schwelle) },
        begruendung: {
          titel: "Warum wurde das gemeldet? (auffällig hoch)",
          felder: [
            { label: `Verbrauch am ${tag}`, wert: `${heuteKwh.toFixed(2)} kWh`, hervor: true },
            { label: "Üblich", wert: `${mittel.toFixed(2)} ± ${sigma.toFixed(2)} kWh/Tag` },
            { label: "Alarmschwelle", wert: `${schwelle.toFixed(2)} kWh (Mittel + ${sigmaFaktor}× Streuung)` },
            { label: "Überschritten um", wert: `${(heuteKwh - schwelle).toFixed(2)} kWh` },
            { label: "Baseline aus", wert: `${basis.length} Tagen` },
          ],
          verlauf: { einheit: "kWh/Tag", schwelleOben: round2(schwelle), tage: verlaufTage, heuteWert: round2(heuteKwh) },
        },
      });
      continue;
    }
    // Sonst: dieser Verbraucher ist heute normal. EXPLIZIT normalen Befund liefern,
    // damit der Lebenszyklus eine gestrige Anomalie dieses Geräts beenden kann.
    out.push({ objektId: v.id, objektName: v.label, auffaellig: false, detail: "", messwerte: { heuteKwh: round2(heuteKwh), mittelKwh: round2(mittel) } });
  }
  return out;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// Transparenz: gelernter Normalzustand je Verbraucher für die Baseline-Anzeige.
// Liefert Mittel, Streuung, Eignung und die einzelnen Tageswerte (für die
// Balkengrafik) – dieselbe Rechnung wie im Detektor, aber für die Einsicht.
export interface BaselineTransparenz {
  objektId: string;
  objektName: string;
  mittelKwh: number;
  sigmaKwh: number;
  variationsKoeffProzent: number;
  geeignet: boolean;         // erfüllt die Streuungs-Bedingung (oder erzwungen)?
  erzwungen: boolean;
  ignoriert: boolean;
  tageBasis: number;         // wie viele Tage in die Baseline eingehen
  schwelleObenKwh: number;   // ab wann "zu hoch"
  schwelleUntenKwh: number;  // ab wann "läuft nicht mehr"
  tage: Array<{ tag: string; kwh: number }>; // für die Balkengrafik (chronologisch)
}
export function getBaselineTransparenz(verbraucher: Array<{ id: string; label: string }>): BaselineTransparenz[] {
  const cfg = config.detektoren.find((d) => d.id === "verbrauch-baseline");
  if (!cfg) return [];
  const tageFenster = Math.max(3, cfg.params.tageFenster ?? 14);
  const maxVarK = (cfg.params.maxVariationsKoeff ?? 40) / 100;
  const sigmaFaktor = cfg.params.sigmaFaktor ?? 3;
  const ausfallAnteil = (cfg.params.ausfallProzent ?? 10) / 100;
  const minKwh = cfg.params.minKwh ?? 0.1;
  const erzwungen = cfg.erzwungen ?? [];

  // Fenster: die letzten tageFenster Tage bis heute.
  const heute = new Date();
  const bisTs = heute.toISOString().slice(0, 10) + "T23:59:59";
  const von = new Date(heute.getTime() - tageFenster * 86400000);
  const vonTs = von.toISOString().slice(0, 10) + "T00:00:00";
  const rows = db.getConsumerTagesSummen(vonTs, bisTs);
  const perConsumer = new Map<string, Array<{ tag: string; kwh: number }>>();
  for (const r of rows) {
    let a = perConsumer.get(r.consumer);
    if (!a) { a = []; perConsumer.set(r.consumer, a); }
    a.push({ tag: r.tag, kwh: r.kwh });
  }

  const out: BaselineTransparenz[] = [];
  for (const v of verbraucher) {
    const tageRoh = (perConsumer.get(v.id) ?? []).sort((a, b) => a.tag.localeCompare(b.tag));
    const werte = tageRoh.map((t) => t.kwh);
    const mittel = werte.length ? werte.reduce((a, b) => a + b, 0) / werte.length : 0;
    const varianz = werte.length ? werte.reduce((a, b) => a + (b - mittel) ** 2, 0) / werte.length : 0;
    const sigma = Math.sqrt(varianz);
    const varK = mittel > 0 ? sigma / mittel : Infinity;
    const geeignet = mittel >= minKwh && (varK <= maxVarK || erzwungen.includes(v.id));
    out.push({
      objektId: v.id, objektName: v.label,
      mittelKwh: round2(mittel), sigmaKwh: round2(sigma),
      variationsKoeffProzent: Number.isFinite(varK) ? Math.round(varK * 100) : 999,
      geeignet, erzwungen: erzwungen.includes(v.id), ignoriert: cfg.ignoriert.includes(v.id),
      tageBasis: werte.length,
      schwelleObenKwh: round2(mittel + sigmaFaktor * sigma),
      schwelleUntenKwh: round2(mittel * ausfallAnteil),
      tage: tageRoh.map((t) => ({ tag: t.tag, kwh: round2(t.kwh) })),
    });
  }
  return out;
}

// Detektor 5: Urlaubs-Überwachung. Nur aktiv, wenn heute im geplanten Zeitraum
// [urlaubStart, urlaubEnde] liegt. Meldet einen überwachten Verbraucher, der über
// schwelleWatt zieht (nach Bestätigungsdauer), bzw. Wasserabgabe. Negativliste:
// nur die in ueberwachteVerbraucher gelisteten Geräte werden geprüft.
function detektorUrlaub(ctx: AnomalieKontext, cfg: AnomalieDetektorConfig): Befund[] {
  const heute = ctx.heuteDatum;
  if (!heute) return [];
  // Zeitraum-Prüfung (inklusive Grenzen). Fehlt ein Datum, gilt es als offen.
  if (cfg.urlaubStart && heute < cfg.urlaubStart) return [];
  if (cfg.urlaubEnde && heute > cfg.urlaubEnde) return [];

  const schwelle = cfg.params.schwelleWatt ?? 15;
  const ueberwacht = cfg.ueberwachteVerbraucher ?? [];
  const out: Befund[] = [];

  // Überwachte Verbraucher: laufen sie, obwohl im Urlaub?
  for (const id of ueberwacht) {
    if (cfg.ignoriert.includes(id)) continue;
    const watt = ctx.verbraucherLeistung?.[id] ?? 0;
    const name = ctx.verbraucher?.find((v) => v.id === id)?.label ?? id;
    const auffaellig = watt > schwelle;
    out.push({
      objektId: id, objektName: name, auffaellig,
      detail: auffaellig ? `Zieht ${Math.round(watt)} W, obwohl Urlaub (bis ${cfg.urlaubEnde ?? "offen"}).` : "",
      messwerte: { watt: Math.round(watt), schwelleWatt: schwelle },
      begruendung: auffaellig ? {
        titel: "Warum wurde das gemeldet? (Urlaub)",
        felder: [
          { label: "Aktuelle Leistung", wert: `${Math.round(watt)} W`, hervor: true },
          { label: "Alarmschwelle", wert: `${schwelle} W` },
          { label: "Urlaubszeitraum", wert: `${cfg.urlaubStart ?? "offen"} bis ${cfg.urlaubEnde ?? "offen"}` },
        ],
      } : undefined,
    });
  }

  // Wasserabgabe im Urlaub (falls aktiviert).
  if (cfg.ueberwacheWasser) {
    const fliesst = ctx.wasserFliesst === true;
    out.push({
      objektId: "wasser", objektName: "Wasserabgabe", auffaellig: fliesst,
      detail: fliesst ? `Wasserabgabe erkannt, obwohl Urlaub (bis ${cfg.urlaubEnde ?? "offen"}).` : "",
      messwerte: { fliesst: fliesst ? 1 : 0 },
    });
  }

  // Hue-Geräte im Urlaub: gemeldete Bewegung oder eingeschaltete Leuchte ist
  // verdächtig (präzise Anwesenheitserkennung).
  const hueUeberwacht = cfg.ueberwachteHue ?? [];
  for (const svc of hueUeberwacht) {
    if (cfg.ignoriert.includes(svc)) continue;
    const g = ctx.hueGeraete?.find((h) => h.serviceId === svc);
    if (!g) continue;
    let auffaellig = false;
    let detail = "";
    if (g.kind === "motion") {
      auffaellig = g.motion === true;
      if (auffaellig) detail = `Bewegung erkannt (${g.name}), obwohl Urlaub.`;
    } else if (g.kind === "light") {
      auffaellig = g.on === true;
      if (auffaellig) detail = `Leuchte „${g.name}" ist an, obwohl Urlaub.`;
    }
    out.push({
      objektId: `hue:${svc}`, objektName: g.name, auffaellig, detail,
      messwerte: g.kind === "motion" ? { bewegung: g.motion ? 1 : 0 } : { an: g.on ? 1 : 0 },
    });
  }
  return out;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Bestätigungsdauer je Detektor (min), 0 = sofort.
function bestaetigungMin(id: AnomalieDetektorId, cfg: AnomalieDetektorConfig): number {
  if (id === "pv-string") return cfg.params.bestaetigungMin ?? 10;
  if (id === "grid-trotz-speicher") return cfg.params.bestaetigungMin ?? 5;
  if (id === "urlaub") return cfg.params.bestaetigungMin ?? 10;
  return 0; // source-offline: die Schwelle steckt schon in der Stille-Zeit
}

// ================= Lebenszyklus-Verwaltung (zentral) =================

// Ein Tick: alle aktiven Detektoren laufen lassen, Befunde in den Lebenszyklus
// überführen. Wird alle 60 s vom Poller aufgerufen.
// Hook für Benachrichtigung bei neu bestätigter Anomalie. Wird von index.ts mit
// dem ntfy-Versand verbunden. Bekommt (detektorId, detektorName, objektName, detail).
type AnomalieNotifyHook = (detektorId: string, detektorName: string, objektName: string, detail: string) => void;
let anomalieNotifyHook: AnomalieNotifyHook | null = null;
export function setAnomalieNotifyHook(fn: AnomalieNotifyHook): void { anomalieNotifyHook = fn; }

export function tickAnomalie(ctx: AnomalieKontext): void {
  if (!config.enabled) return;
  const jetzt = ctx.jetztMs;
  const jetztIso = new Date(jetzt).toISOString();

  for (const cfg of config.detektoren) {
    // Ist dieser Detektor gerade aktiv? Der Urlaubs-Detektor ist zusätzlich nur
    // innerhalb seines Zeitraums aktiv.
    let aktivJetzt = cfg.enabled;
    if (aktivJetzt && cfg.id === "urlaub") {
      const heute = ctx.heuteDatum;
      if (!heute) aktivJetzt = false;
      else if (cfg.urlaubStart && heute < cfg.urlaubStart) aktivJetzt = false;
      else if (cfg.urlaubEnde && heute > cfg.urlaubEnde) aktivJetzt = false;
    }
    if (!aktivJetzt) {
      // Detektor inaktiv -> alle seine laufenden Anomalien beenden (aufräumen),
      // damit z.B. nach Urlaubsende oder Abschalten keine Alt-Einträge kleben.
      for (const [key, a] of [...laufend.entries()]) {
        if (a.detektorId === cfg.id) {
          beendeUndProtokolliere(a, jetztIso);
          laufend.delete(key);
        }
      }
      continue;
    }
    let befunde: Befund[] = [];
    try {
      if (cfg.id === "source-offline") befunde = detektorSourceOffline(ctx, cfg);
      else if (cfg.id === "pv-string") befunde = detektorPvString(ctx, cfg);
      else if (cfg.id === "grid-trotz-speicher") befunde = detektorGridTrotzSpeicher(ctx, cfg);
      else if (cfg.id === "verbrauch-baseline") befunde = detektorVerbrauchBaseline(ctx, cfg);
      else if (cfg.id === "urlaub") befunde = detektorUrlaub(ctx, cfg);
    } catch { befunde = []; } // ein defekter Detektor darf die anderen nicht stören

    const bestMin = bestaetigungMin(cfg.id, cfg);
    for (const b of befunde) {
      const key = schluessel(cfg.id, b.objektId);
      const vorhanden = laufend.get(key);

      if (b.auffaellig) {
        if (!vorhanden) {
          // Neuer Kandidat. Bei Detektoren mit Bestätigungsdauer erst nach Ablauf
          // wirklich als Anomalie führen – bis dahin nur vormerken.
          laufend.set(key, {
            id: neueId(), detektorId: cfg.id, detektorName: DETEKTOR_NAMEN[cfg.id],
            objektId: b.objektId, objektName: b.objektName,
            status: bestMin > 0 ? "aktiv" : "aktiv",
            seit: jetztIso, zuletztGesehen: jetztIso, beendetAm: null, quittiertAm: null,
            detail: b.detail, messwerte: b.messwerte,
            begruendung: b.begruendung, // eingefroren zum Auslösezeitpunkt
            normalSeitMs: null, auffaelligSeitMs: jetzt,
          });
          // Bei Bestätigungsdauer > 0: noch NICHT als bestätigt melden.
          const eintrag = laufend.get(key)!;
          if (bestMin > 0) eintrag.status = "aktiv"; // wird unten ggf. wieder entfernt, wenn zu kurz
        } else {
          // Weiterhin auffällig -> aktualisieren, Normal-Timer zurücksetzen.
          vorhanden.normalSeitMs = null;
          vorhanden.zuletztGesehen = jetztIso;
          vorhanden.detail = b.detail;
          vorhanden.messwerte = b.messwerte;
          // Quittierte, weiterhin auffällige bleiben quittiert (unterdrückt).
        }
        // Benachrichtigung: sobald die Anomalie bestätigt ist (Bestätigungsdauer
        // erreicht) und noch nicht gemeldet wurde, den Hook auslösen. Quittierte
        // werden nicht gemeldet.
        const eintrag = laufend.get(key);
        if (eintrag && !(eintrag as any).gemeldet && eintrag.quittiertAm == null && istBestaetigt(eintrag, jetzt)) {
          (eintrag as any).gemeldet = true;
          try { anomalieNotifyHook?.(cfg.id, eintrag.detektorName, eintrag.objektName ?? "", eintrag.detail ?? ""); } catch { /* ignore */ }
        }
      } else {
        // Normalzustand. Wenn ein Eintrag läuft: Beruhigung starten/prüfen.
        if (vorhanden) {
          if (vorhanden.normalSeitMs == null) vorhanden.normalSeitMs = jetzt;
          if (jetzt - vorhanden.normalSeitMs >= BERUHIGUNG_MS) {
            // Beruhigt -> beenden und ins Protokoll schreiben (sofern es je als
            // bestätigte Anomalie geführt wurde).
            beendeUndProtokolliere(vorhanden, jetztIso);
            laufend.delete(key);
          }
        }
      }
    }
  }

  // Nachlauf: Kandidaten mit Bestätigungsdauer, die die Dauer noch nicht erreicht
  // haben, aus der aktiven Anzeige heraushalten, bis sie bestätigt sind. Das lösen
  // wir über die Anzeige (getStatus) statt über Löschen, damit der auffaelligSeitMs-
  // Timer weiterläuft.
}

// Prüft, ob eine laufende Anomalie bereits "bestätigt" ist (Bestätigungsdauer
// erreicht). Für source-offline immer true.
function istBestaetigt(a: LaufendeAnomalie, jetztMs: number): boolean {
  const cfg = detektorCfg(a.detektorId);
  if (!cfg) return true;
  const bestMs = bestaetigungMin(a.detektorId, cfg) * 60 * 1000;
  if (bestMs <= 0) return true;
  return (jetztMs - a.auffaelligSeitMs) >= bestMs;
}

function beendeUndProtokolliere(a: LaufendeAnomalie, jetztIso: string): void {
  // Nur protokollieren, wenn die Anomalie je bestätigt war (sonst war es nur ein
  // kurzer Kandidat unterhalb der Bestätigungsdauer -> ignorieren).
  if (!istBestaetigt(a, Date.parse(jetztIso))) return;
  a.status = "beendet";
  a.beendetAm = jetztIso;
  db.persistAnomalie({ ...stripIntern(a) });
}

function stripIntern(a: LaufendeAnomalie): Anomalie {
  const { normalSeitMs, auffaelligSeitMs, ...rest } = a;
  void normalSeitMs; void auffaelligSeitMs;
  return rest;
}

// --- Öffentliche API für Endpunkte ---

export function getAnomalieStatus(jetztMs?: number): AnomalieStatusResponse {
  const jetzt = jetztMs ?? Date.now();
  const aktiv: Anomalie[] = [];
  const quittiert: Anomalie[] = [];
  for (const a of laufend.values()) {
    if (!istBestaetigt(a, jetzt)) continue; // Kandidat unterhalb Bestätigungsdauer -> noch nicht zeigen
    if (a.normalSeitMs != null) continue;   // gerade in Beruhigung -> nicht mehr als aktiv zeigen
    if (a.status === "quittiert") quittiert.push(stripIntern(a));
    else aktiv.push(stripIntern(a));
  }
  return {
    enabled: config.enabled,
    aktiv, quittiert,
    gesamtStatus: aktiv.length > 0 ? "auffaellig" : "ok",
  };
}

// Historie (beendete Anomalien) aus dem Protokoll.
export function getAnomalieHistorie(limit = 200): Anomalie[] {
  return db.loadAnomalieHistorie(limit);
}

// Feedback-Protokoll: was wurde wann wie bewertet (für die Anzeige, Stufe 3).
export function getAnomalieFeedbackProtokoll(limit = 100): Anomalie[] {
  return db.loadAnomalieFeedback(limit);
}

// --- Stufe 4: regelbasierte Verbesserungsvorschläge aus dem Feedback ---
// Wertet das Feedback-Protokoll aus und leitet transparente Vorschläge ab. Rein
// regelbasiert (keine Black Box): Ein Vorschlag entsteht erst bei einem WIEDER-
// HOLTEN Muster (>= Schwelle gleichartiger Bewertungen für dasselbe Detektor+
// Objekt). Bereits umgesetzte Zustände (Objekt schon ignoriert) erzeugen keinen
// Vorschlag mehr.
import type { AnomalieVorschlag } from "./types.js";
export function getAnomalieVorschlaege(): AnomalieVorschlag[] {
  const schwelle = Math.max(2, config.vorschlagSchwelle ?? 3);
  const fb = db.loadAnomalieFeedback(1000) as Array<{ detektorId: AnomalieDetektorId; objektId: string; objektName: string; feedback: string }>;

  // Zählen: (detektor|objekt|art) -> Anzahl. Und detektorweit (detektor|art).
  const proObjekt = new Map<string, { detektorId: AnomalieDetektorId; objektId: string; objektName: string; art: string; n: number }>();
  const proDetektor = new Map<string, { detektorId: AnomalieDetektorId; art: string; n: number }>();
  for (const e of fb) {
    if (!e.feedback) continue;
    const kObj = `${e.detektorId}|${e.objektId}|${e.feedback}`;
    const o = proObjekt.get(kObj) ?? { detektorId: e.detektorId, objektId: e.objektId, objektName: e.objektName, art: e.feedback, n: 0 };
    o.n++; proObjekt.set(kObj, o);
    const kDet = `${e.detektorId}|${e.feedback}`;
    const dd = proDetektor.get(kDet) ?? { detektorId: e.detektorId, art: e.feedback, n: 0 };
    dd.n++; proDetektor.set(kDet, dd);
  }

  const out: AnomalieVorschlag[] = [];
  // 1) Fehlalarm-Muster je Objekt -> "ignorieren"-Vorschlag.
  for (const o of proObjekt.values()) {
    if (o.art !== "fehlalarm" || o.n < schwelle) continue;
    const cfg = config.detektoren.find((d) => d.id === o.detektorId);
    if (cfg?.ignoriert.includes(o.objektId)) continue; // schon ignoriert
    out.push({
      id: `ign|${o.detektorId}|${o.objektId}`, art: "ignorieren",
      detektorId: o.detektorId, detektorName: DETEKTOR_NAMEN[o.detektorId],
      objektId: o.objektId, objektName: o.objektName,
      text: `„${o.objektName}" wurde ${o.n}× als Fehlalarm bewertet (${DETEKTOR_NAMEN[o.detektorId]}). Für dieses Objekt die Überwachung deaktivieren?`,
      anzahl: o.n,
      aktion: { typ: "ignorieren", detektorId: o.detektorId, objektId: o.objektId },
    });
  }
  // 2) Detektorweites Fehlalarm-Muster (viele Objekte) -> Empfindlichkeit senken.
  for (const dd of proDetektor.values()) {
    if (dd.art !== "fehlalarm" || dd.n < schwelle * 2) continue; // strenger, weil global
    // nur, wenn nicht schon ein einzelner Objekt-Vorschlag dominiert
    const einzelne = [...proObjekt.values()].filter((o) => o.detektorId === dd.detektorId && o.art === "fehlalarm" && o.n >= schwelle);
    if (einzelne.length >= 2) {
      out.push({
        id: `emp|${dd.detektorId}`, art: "empfindlichkeit-senken",
        detektorId: dd.detektorId, detektorName: DETEKTOR_NAMEN[dd.detektorId],
        objektId: null, objektName: null,
        text: `${DETEKTOR_NAMEN[dd.detektorId]} lieferte ${dd.n} Fehlalarme über mehrere Objekte. Empfindlichkeit dieses Detektors senken?`,
        anzahl: dd.n, aktion: { typ: "empfindlichkeit-senken", detektorId: dd.detektorId },
      });
    }
  }
  // 3) Positive Rückmeldung: durchgehend "richtig" -> Bestätigung (keine Aktion).
  for (const dd of proDetektor.values()) {
    if (dd.art !== "richtig" || dd.n < schwelle) continue;
    // nur zeigen, wenn dieser Detektor NICHT gleichzeitig ein Fehlalarm-Muster hat
    const hatFehlalarm = [...proDetektor.values()].some((x) => x.detektorId === dd.detektorId && x.art === "fehlalarm" && x.n >= schwelle);
    if (hatFehlalarm) continue;
    out.push({
      id: `pos|${dd.detektorId}`, art: "positiv",
      detektorId: dd.detektorId, detektorName: DETEKTOR_NAMEN[dd.detektorId],
      objektId: null, objektName: null,
      text: `${DETEKTOR_NAMEN[dd.detektorId]} lag ${dd.n}× richtig – der Detektor arbeitet zuverlässig.`,
      anzahl: dd.n, aktion: { typ: "keine" },
    });
  }
  return out;
}

// Einen Vorschlag per Ein-Klick übernehmen. Gibt true bei Erfolg.
export function wendeVorschlagAn(id: string): boolean {
  const v = getAnomalieVorschlaege().find((x) => x.id === id);
  if (!v) return false;
  const cfg = config.detektoren.find((d) => d.id === v.detektorId);
  if (!cfg) return false;
  if (v.aktion.typ === "ignorieren") {
    if (!cfg.ignoriert.includes(v.aktion.objektId)) cfg.ignoriert.push(v.aktion.objektId);
    saveAnomalieConfig(config);
    return true;
  }
  if (v.aktion.typ === "empfindlichkeit-senken") {
    // Detektorabhängig die maßgebliche Schwelle konservativer stellen.
    const p = cfg.params;
    if (v.detektorId === "verbrauch-baseline") p.sigmaFaktor = Math.min(6, (p.sigmaFaktor ?? 3) + 1);
    else if (v.detektorId === "pv-string") p.anteilProzent = Math.max(5, (p.anteilProzent ?? 25) - 5);
    else if (v.detektorId === "grid-trotz-speicher") p.minWatt = (p.minWatt ?? 300) + 200;
    else if (v.detektorId === "source-offline") p.faktor = (p.faktor ?? 5) + 2;
    else if (v.detektorId === "urlaub") p.schwelleWatt = (p.schwelleWatt ?? 15) + 10;
    saveAnomalieConfig(config);
    return true;
  }
  return false; // "keine" (positiv) hat keine Aktion
}

// Eine aktive Anomalie quittieren (per Eintrags-ID).
export function quittiereAnomalie(id: string): boolean {
  for (const a of laufend.values()) {
    if (a.id === id && a.status === "aktiv") {
      a.status = "quittiert";
      a.quittiertAm = new Date().toISOString();
      return true;
    }
  }
  return false;
}

// Feedback zu einer Anomalie geben (Stufe 3). Bewertet gleichzeitig als quittiert,
// wenn die Anomalie noch aktiv ist. Funktioniert für laufende (aktiv/quittiert)
// UND für bereits beendete Anomalien in der Historie.
export function bewerteAnomalie(id: string, feedback: import("./types.js").AnomalieFeedback): boolean {
  const jetzt = new Date().toISOString();
  // 1) Laufende Anomalie?
  for (const a of laufend.values()) {
    if (a.id === id) {
      a.feedback = feedback;
      a.feedbackAm = jetzt;
      if (a.status === "aktiv") { a.status = "quittiert"; a.quittiertAm = jetzt; }
      // Auch ins Feedback-Protokoll schreiben (persistent, für Stufe 4).
      db.persistAnomalieFeedback({ ...stripIntern(a) });
      return true;
    }
  }
  // 2) Beendete Anomalie in der Historie?
  return db.updateAnomalieFeedback(id, feedback, jetzt);
}
