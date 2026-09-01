// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { PORT } from "./config.js";
import { is42cRole, type SourceConfig } from "./sources.js";
import {
  startPoller,
  subscribe,
  getState,
  getDiagnostics,
  newDay,
  setCosts,
  saveEnergySettings,
  setSources,
  getSources,
  getLastRead,
  getRooms,
  setRooms,
  resetDrosselungen,
  resetDrosselungenForSource,
  resetHistory,
  deleteHistoryMonth,
  getSinks,
  setSinks,
  getSinkStatus,
  getSinkOutputPower,
  getDiscoverySinkPower,
  getDiscoverySinkInfo,
  getCtSinkInfo,
  setCtFadeout,
  getCtFadeout,
  setCtNoAcCharge,
  getCtNoAcCharge,
  sinkFormulaVariables,
  evalSinkFormula,
  getConsumerCurrentSlot,
  getPvCurrentSlot,
  currentDayHistory,
  currentViertelstunde,
  computeCurrentViertelstunde,
  powerOf,
} from "./poller.js";
import { readSource as testSource, extractFields } from "./fetcher.js";
import { testMqttSource } from "./mqttClient.js";
import * as pvanlagen from "./pvanlagen.js";
import * as db from "./db.js";
import { startShellyDiscovery } from "./shellyudp.js";
import { startCtEmulation, getCtBalancerSnapshot } from "./marstekCt.js";
import { registerCtDevice } from "./marstekCloud.js";
import {
  SECTIONS,
  collectSection,
  countSection,
  buildExport,
  inspectImport,
  applyImport,  type ImportMode,
} from "./importexport.js";
import {
  buildDataExport,
  countDataExport,
  inspectDataImport,
  applyDataImport,
  dataCalendar,
  dayDetail,
  deleteDataRange,
  runSql,
  sqlSchema,
  DATA_TABLE_LABELS,
} from "./dataexport.js";
import { aggregateWpKpi, aggregateWpKpiRaw } from "./wpkpi.js";
import { computeWwKpi, warmwasserAktivitaet, aktuelleSpeicherWaerme, getWwWaermeFormel, setWwWaermeFormel, WW_WAERME_FORMEL_DEFAULT } from "./wwkpi.js";
import { validateFormula } from "./formula.js";
import { HEMS_GROESSEN, EXTHEMS_VARIABLE_NAMEN, beschreibungFuerSenke } from "./extHems.js";
import {
  getEebusState, getEebusLog, clearEebusLog, setEebusConfig,
  simulateEvent, serializeEebusConfig, loadEebusConfig, tickEebus,
  applyIncomingLimit, applyIncomingFailsafe, applyIncomingHeartbeat,
  setConnectionState, setEigenerSki, getSidecarHttp, setSidecarHttp,
  setLppUmsetzung, setLimitFlankeHandler,
} from "./eebus.js";
import {
  getLppControlConfig, getLppControlLog, setLppControlConfig,
  serializeLppControlConfig, loadLppControlConfig, setLppLimit, testInverterWrite,
  getLppRegelStatus, regelLpp, erkenneInverterAusQuellen, setIstLeistungProvider,
} from "./lppControl.js";
import {
  getLpcMonitorConfig, getLpcMonitorLog, setLpcMonitorConfig,
  serializeLpcMonitorConfig, loadLpcMonitorConfig, getLpcMonitorStatus,
  tickLpcMonitor, setLpcIstLeistungProvider,
} from "./lpcMonitor.js";
import { sendNtfyTest, notifyTransition } from "./notify.js";
import { getConditionStatus, getActionStatus, getRuleActive, getRuleActiveSince, manualTrigger, setCtFadeoutProvider, setCtFadeStateProvider, setCtNoAcChargeProvider, setCtNoAcChargeStateProvider, PUSH_VARIABLES } from "./rules.js";
import { switchSource, getSwitchState, resolveSwitchChannel } from "./switch.js";
import {
  parseMarstekTarget,
  readMarstek,
  getMarstekMode,
  setMarstekMode,
  marstekStructured,
  type MarstekMode,
} from "./marstek.js";
import {
  readMarstekModbus,
  readMarstekModbusControl,
  setMarstekModbusForce,
  setMarstekModbusBackup,
} from "./marstekModbus.js";
import { setZendureMode } from "./zendure.js";
import {
  fetchSpotpreise,
  startSpotScheduler,
  spotSourceUrl,
} from "./spotprices.js";
import { computeSharingDay } from "./sharing.js";
import { computeTagesKosten, computeSharingAnalysis, computeTagBezugVergleich } from "./costs.js";
import { pickPeriode } from "./periods.js";
import { computeBoersenStatistik, computeJahresvergleich, verfuegbareJahre } from "./boersenstatistik.js";
import {
  listProfiles,
  getProfileData,
  dayProfile,
  exampleProfileCsv,
  profileToCsv,
  parseProfileCsv,
  setCustomProfiles,
  listGenProfiles,
  getGenProfileData,
  genDayProfile,
  genProfileToCsv,
  setGenProfiles,
} from "./emu.js";

// lokales Datum als YYYY-MM-DD
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Zentrale Versionsnummer der Anwendung (Anzeige unter "Live" im Menü und klein
// auf der Übersichtsseite). Bei jeder Auslieferung erhöhen.
const APP_VERSION = "v412";
// Body-Limit großzügig: Der Daten-Import (Messwerte über lange Zeiträume) kann
// viele MB groß werden. Läuft rein lokal, daher unkritisch.
app.use(express.json({ limit: "200mb" }));

// --- SSE: Live-State-Stream ---
app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  // sofort aktuellen State senden
  res.write(`data: ${JSON.stringify(getState())}\n\n`);

  const unsubscribe = subscribe((state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  });

  // Heartbeat gegen Timeouts
  const hb = setInterval(() => res.write(": ping\n\n"), 20000);

  req.on("close", () => {
    clearInterval(hb);
    unsubscribe();
  });
});

// einmaliger State-Abruf (z.B. für initiales Laden ohne SSE)
app.get("/api/state", (_req, res) => res.json(getState()));

// Diagnose: warum läuft die kWh-Aggregation (noch) nicht?
app.get("/api/diag", (_req, res) => res.json(getDiagnostics()));

// vollständige Listen für die Unterseiten
app.get("/api/history/all", (_req, res) => {
  const s = db.loadSettings();
  const rows = db.getAllHistory().map((h) => {
    // Kosten werden viertelstundengenau on-the-fly berechnet (nicht persistiert).
    // Für Tage ohne Viertelstundenwerte ergeben sich entsprechend 0-Beträge.
    const tk = computeTagesKosten(h.date, s);
    return {
      ...h,
      kosten: tk.saldo,
      bezugskosten: tk.bezugskosten,
      einspeiseverguetung: tk.einspeiseverguetung,
      sharingVerguetung: tk.sharingVerguetung,
      einsparung: tk.einsparung,
      kostenAufschluesselung: {
        arbeitskosten: tk.arbeitskosten,
        einspeiseverguetung: tk.einspeiseverguetung,
        sharingVerguetung: tk.sharingVerguetung,
        grundgebuehrAnteil: tk.grundgebuehrAnteil,
        sofortbonusAnteil: tk.sofortbonusAnteil,
        neukundenbonusAnteil: tk.neukundenbonusAnteil,
        messstelleAnteil: tk.messstelleAnteil,
        modul1Anteil: tk.modul1Anteil,
      },
    };
  });

  // Laufenden (heutigen) Tag mit den bisher aufgelaufenen Werten ergänzen, damit
  // die Monatsstatistik auch den aktuellen, noch nicht abgeschlossenen Tag zeigt.
  // Steht er bereits in der History (z.B. nach zwischenzeitlichem Abschluss),
  // wird der vorhandene Eintrag durch die aktuelleren Live-Werte ersetzt.
  const today = currentDayHistory();
  if (today) {
    const tk = computeTagesKosten(today.date, s);
    const liveRow = {
      ...today,
      kosten: tk.saldo,
      bezugskosten: tk.bezugskosten,
      einspeiseverguetung: tk.einspeiseverguetung,
      sharingVerguetung: tk.sharingVerguetung,
      einsparung: tk.einsparung,
      kostenAufschluesselung: {
        arbeitskosten: tk.arbeitskosten,
        einspeiseverguetung: tk.einspeiseverguetung,
        sharingVerguetung: tk.sharingVerguetung,
        grundgebuehrAnteil: tk.grundgebuehrAnteil,
        sofortbonusAnteil: tk.sofortbonusAnteil,
        neukundenbonusAnteil: tk.neukundenbonusAnteil,
        messstelleAnteil: tk.messstelleAnteil,
        modul1Anteil: tk.modul1Anteil,
      },
    };
    const idx = rows.findIndex((r) => r.date === today.date);
    if (idx >= 0) rows[idx] = liveRow;
    else rows.push(liveRow);
  }

  res.json(rows);
});

// Periodenweite Kostenaufstellung ("Stromabrechnung") für einen wählbaren
// Datumsbereich [von, bis]. Summiert die viertelstundengenauen Tageskosten und
// deren Bestandteile über alle Tage im Bereich. Da computeTagesKosten die
// anteiligen Fixkosten (Grundgebühr, Messstelle, Boni, §14a Modul 1) bereits je
// Tag liefert, ergibt die Summe über die Tage automatisch die korrekte
// Periodensumme (z.B. Grundgebühr × Monate über die Tagesanteile). Der heutige
// (laufende) Tag wird mit den bisher aufgelaufenen Werten berücksichtigt.
//
// Zusätzlich werden die Tage nach ihrer Stromtarif-Periode gruppiert. Erstreckt
// sich der Zeitraum über mehrere Perioden (Tarifwechsel), erscheint jede Periode
// separat mit eigener bezogener Energie, eigenem mittleren Arbeitspreis und
// eigenen Kostenbestandteilen. So bleibt bei einem Anbieter-/Tarifwechsel
// nachvollziehbar, welcher Preis wann galt.
app.get("/api/abrechnung", (req, res) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const von = typeof req.query.von === "string" && re.test(req.query.von) ? req.query.von : null;
  const bis = typeof req.query.bis === "string" && re.test(req.query.bis) ? req.query.bis : null;
  if (!von || !bis || von > bis) {
    res.status(400).json({ error: "von/bis (YYYY-MM-DD) erforderlich, von <= bis" });
    return;
  }
  const s = db.loadSettings();
  const heute = currentDayHistory();
  const stPerioden = db.loadStromtarifPerioden();

  // Menge aller Tage mit Daten im Bereich: History-Tage + ggf. heutiger Tag.
  const tage = new Set<string>();
  for (const h of db.getAllHistory()) if (h.date >= von && h.date <= bis) tage.add(h.date);
  if (heute && heute.date >= von && heute.date <= bis) tage.add(heute.date);

  // Leerer, additiver Aggregator für einen Satz Kostenbestandteile.
  const leer = () => ({
    tage: 0,
    ersterTag: null as string | null,
    letzterTag: null as string | null,
    bezogenKwh: 0,
    eingespeistKwh: 0,
    arbeitskosten: 0,
    modul3Effekt: 0,
    modul3EffektHoch: 0,
    modul3EffektNiedrig: 0,
    modul3KwhHoch: 0,
    modul3KwhNiedrig: 0,
    modul3KwhStandard: 0,
    grundgebuehr: 0,
    messstelle: 0,
    sofortbonus: 0,
    neukundenbonus: 0,
    modul1: 0,
    einspeiseverguetung: 0,
    sharingVerguetung: 0,
    saldo: 0,
    einsparung: 0,
    einsparungPv: 0,
    einsparungSpeicher: 0,
    eigenKwhPv: 0,
    eigenKwhSpeicher: 0,
  });
  type Agg = ReturnType<typeof leer>;
  const addTag = (a: Agg, tk: ReturnType<typeof computeTagesKosten>, d: string) => {
    a.tage++;
    if (a.ersterTag === null || d < a.ersterTag) a.ersterTag = d;
    if (a.letzterTag === null || d > a.letzterTag) a.letzterTag = d;
    a.bezogenKwh += tk.bezogenKwh;
    a.eingespeistKwh += tk.eingespeistKwh;
    a.arbeitskosten += tk.arbeitskosten;
    a.modul3Effekt += tk.modul3Effekt;
    a.modul3EffektHoch += tk.modul3EffektHoch;
    a.modul3EffektNiedrig += tk.modul3EffektNiedrig;
    a.modul3KwhHoch += tk.modul3KwhHoch;
    a.modul3KwhNiedrig += tk.modul3KwhNiedrig;
    a.modul3KwhStandard += tk.modul3KwhStandard;
    a.grundgebuehr += tk.grundgebuehrAnteil;
    a.messstelle += tk.messstelleAnteil;
    a.sofortbonus += tk.sofortbonusAnteil;
    a.neukundenbonus += tk.neukundenbonusAnteil;
    a.modul1 += tk.modul1Anteil;
    a.einspeiseverguetung += tk.einspeiseverguetung;
    a.sharingVerguetung += tk.sharingVerguetung;
    a.saldo += tk.saldo;
    a.einsparung += tk.einsparung;
    a.einsparungPv += tk.einsparungPv;
    a.einsparungSpeicher += tk.einsparungSpeicher;
    a.eigenKwhPv += tk.eigenKwhPv;
    a.eigenKwhSpeicher += tk.eigenKwhSpeicher;
  };

  const gesamt = leer();
  // Gruppierung nach Stromtarif-Periode (Schlüssel = gueltigAb der Periode).
  const proPeriode = new Map<string, Agg>();
  const periodeInfo = new Map<string, { gueltigAb: string; anbieter: string; tarifMode: string; strompreis: number }>();

  const tageSortiert = [...tage].sort();
  for (const d of tageSortiert) {
    const tk = computeTagesKosten(d, s);
    addTag(gesamt, tk, d);
    // Zugehörige Stromtarif-Periode bestimmen.
    const p = pickPeriode(stPerioden, d);
    const key = p ? p.gueltigAb : "?";
    if (!proPeriode.has(key)) {
      proPeriode.set(key, leer());
      periodeInfo.set(key, {
        gueltigAb: p ? p.gueltigAb : "?",
        anbieter: p?.werte.anbieterName ?? "",
        tarifMode: p?.werte.tarifMode ?? "",
        strompreis: p?.werte.strompreis ?? 0,
      });
    }
    addTag(proPeriode.get(key)!, tk, d);
  }

  // Mittlerer Arbeitspreis (ct/kWh, brutto) = Arbeitskosten / bezogene kWh.
  const mittelCt = (a: Agg) => (a.bezogenKwh > 0 ? (a.arbeitskosten / a.bezogenKwh) * 100 : 0);
  // Mittlerer Einspeisepreis (ct/kWh) = Vergütung / eingespeiste kWh.
  const einspeiseMittelCt = (a: Agg) => (a.eingespeistKwh > 0 ? (a.einspeiseverguetung / a.eingespeistKwh) * 100 : 0);

  const perioden = [...proPeriode.keys()].sort().map((key) => {
    const a = proPeriode.get(key)!;
    const info = periodeInfo.get(key)!;
    return {
      ...info,
      ...a,
      arbeitspreisMittelCt: mittelCt(a),
      einspeiseMittelCt: einspeiseMittelCt(a),
    };
  });

  res.json({
    von,
    bis,
    tageMitDaten: gesamt.tage,
    ersterTag: gesamt.ersterTag,
    letzterTag: gesamt.letzterTag,
    // Gesamtsummen (flach, für die Hauptaufstellung):
    arbeitskosten: gesamt.arbeitskosten,
    bezogenKwh: gesamt.bezogenKwh,
    arbeitspreisMittelCt: mittelCt(gesamt),
    modul3Effekt: gesamt.modul3Effekt,
    modul3EffektHoch: gesamt.modul3EffektHoch,
    modul3EffektNiedrig: gesamt.modul3EffektNiedrig,
    modul3KwhHoch: gesamt.modul3KwhHoch,
    modul3KwhNiedrig: gesamt.modul3KwhNiedrig,
    modul3KwhStandard: gesamt.modul3KwhStandard,
    grundgebuehr: gesamt.grundgebuehr,
    messstelle: gesamt.messstelle,
    sofortbonus: gesamt.sofortbonus,
    neukundenbonus: gesamt.neukundenbonus,
    modul1: gesamt.modul1,
    einspeiseverguetung: gesamt.einspeiseverguetung,
    eingespeistKwh: gesamt.eingespeistKwh,
    einspeiseMittelCt: einspeiseMittelCt(gesamt),
    sharingVerguetung: gesamt.sharingVerguetung,
    saldo: gesamt.saldo,
    einsparung: gesamt.einsparung,
    einsparungPv: gesamt.einsparungPv,
    einsparungSpeicher: gesamt.einsparungSpeicher,
    eigenKwhPv: gesamt.eigenKwhPv,
    eigenKwhSpeicher: gesamt.eigenKwhSpeicher,
    // Aufsplittung nach Stromtarif-Periode (nur relevant, wenn > 1 Eintrag):
    perioden,
    mehrperiodig: perioden.length > 1,
  });
});

// Vergleich der reinen Tagesbezugskosten (ohne Einspeisevergütung) zwischen
// Fixtarif und dynamischem Tarif für einen wählbaren Zeitraum. Je Tag werden
// beide Preisvarianten auf denselben tatsächlichen Netzbezug angewandt, sodass
// sichtbar wird, welches Tarifmodell für den eigenen Lastgang günstiger gewesen
// wäre. Der heutige (laufende) Tag wird einbezogen, falls im Bereich.
app.get("/api/tarifvergleich", (req, res) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const von = typeof req.query.von === "string" && re.test(req.query.von) ? req.query.von : null;
  const bis = typeof req.query.bis === "string" && re.test(req.query.bis) ? req.query.bis : null;
  if (!von || !bis || von > bis) {
    res.status(400).json({ error: "von/bis (YYYY-MM-DD) erforderlich, von <= bis" });
    return;
  }
  const s = db.loadSettings();
  const heute = currentDayHistory();
  const tage = new Set<string>();
  for (const h of db.getAllHistory()) if (h.date >= von && h.date <= bis) tage.add(h.date);
  if (heute && heute.date >= von && heute.date <= bis) tage.add(heute.date);

  const tageSortiert = [...tage].sort();
  const rows = tageSortiert.map((d) => computeTagBezugVergleich(d, s));
  const summe = rows.reduce(
    (a, r) => ({
      bezogenKwh: a.bezogenKwh + r.bezogenKwh,
      fix: a.fix + r.fix,
      dyn: a.dyn + r.dyn,
    }),
    { bezogenKwh: 0, fix: 0, dyn: 0 },
  );
  res.json({
    von,
    bis,
    tageMitDaten: rows.length,
    rows,
    summe,
  });
});

// Wirtschaftlichkeitsanalyse Energy Sharing vs. klassische Einspeisung: je Tag
// mit Sharing-Aktivität den tatsächlichen Sharing-Erlös, den hypothetischen
// klassischen Einspeise-Erlös für dieselbe Energie und den Mehrerlös. Der
// heutige (laufende) Tag wird mit den bisher aufgelaufenen Werten ergänzt.
app.get("/api/sharing/analysis", (_req, res) => {
  const s = db.loadSettings();
  const dates = db.getSharingDates();
  const today = isoToday();
  if (!dates.includes(today)) dates.push(today);
  const rows = dates.map((d) => computeSharingAnalysis(d, s));
  res.json(rows);
});

// Börsenstrompreis-Statistik (v. a. negative Preise) – selbst berechnet aus den
// gespeicherten Spotpreisen.
app.get("/api/boerse/statistik", (req, res) => {
  const jahrParam = req.query.jahr ? Number(req.query.jahr) : undefined;
  const jahr = Number.isFinite(jahrParam) ? jahrParam : undefined;
  res.json({
    ...computeBoersenStatistik(jahr),
    verfuegbareJahre: verfuegbareJahre(),
    jahresvergleich: computeJahresvergleich(2020),
  });
});

// --- Marstek AC-Batterie: Status + Steuerung ---
// Findet die erste aktive acBattery-Quelle und liefert Host/Port.
function firstMarstek(): { src: any; host: string; port: number } | null {
  for (const src of getSources()) {
    if (src.role !== "acBattery") continue;
    if (src.enabled === false) continue;
    const target = parseMarstekTarget(src.url, src.acUdpPort ?? 30000);
    if (target) return { src, host: target.host, port: target.port };
  }
  return null;
}

// --- AC-Speicher (allgemein): Status + Steuerung für alle Anbindungen ---
// Effektive Anbindung einer Quelle (abwärtskompatibel).
function effConnection(src: any): string {
  if (src.connection) return src.connection;
  if (src.role === "acBattery" && (src.acModel ?? "marstek-venus") === "marstek-venus") return "udp";
  return "rest";
}

// Begrenzt eine Promise hart auf maxMs; danach wird der Fallback geliefert.
// Verhindert, dass eine langsame Geräteabfrage (nicht erreichbarer Schalter, der
// ins volle Timeout läuft) einen Status-Endpunkt und damit den Seitenaufbau
// blockiert. Der Schaltzustand erscheint dann als „unbekannt".
function withTimeout<T>(p: Promise<T>, maxMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, maxMs);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}

// Liefert Status aller aktiven AC-Speicher, je nach Anbindung passend ausgelesen.
app.get("/api/acspeicher/status", async (_req, res) => {
  const _t0 = Date.now();
  const allSources = getSources();
  // Leistung (W) der per powerSourceId verknüpften Quelle als Anzeigefeld, damit
  // sie im zusammengefassten Speicher als dessen Leistung erscheint. null, wenn
  // keine Verknüpfung besteht oder kein aktueller Wert vorliegt.
  const linkedPowerFields = (src: any): Array<{ label: string; value: number; unit: string }> | null => {
    if (!src.powerSourceId) return null;
    const last = getLastRead(src.powerSourceId);
    const p = last?.values?.power;
    if (typeof p !== "number") return null;
    return [{ label: "Batterie-Leistung", value: p, unit: "W" }];
  };
  // IDs von Quellen, die nur als Leistungslieferant einer anderen Quelle dienen
  // (powerSourceId-Verknüpfung). Diese gehören zum verknüpfenden Gerät und
  // werden NICHT als eigener Speicher gelistet, sondern dort eingewoben.
  const linkedPowerIds = new Set(
    allSources.map((s) => s.powerSourceId).filter((id): id is string => typeof id === "string" && !!id)
  );
  const list = allSources.filter(
    (s) => s.role === "acBattery" && s.enabled !== false && !linkedPowerIds.has(s.id)
  );
  const speicher = await Promise.all(list.map(async (src) => {
    const conn = effConnection(src);
    // Schaltbare AC-Speicher (z. B. über einen zwischengeschalteten Shelly Pro
    // 2PM): Schaltzustand des zuständigen Kanals ermitteln, damit auf der
    // Speicher-Seite ein Ein/Aus-Schalter mit Zustandsanzeige erscheint –
    // unabhängig davon, ob die Anbindung eine eigene Modus-Steuerung bietet.
    const switchCh = resolveSwitchChannel(src);
    let switchState: boolean | null | undefined;
    let switchSourceId = src.id;
    let switchChannel = switchCh;
    let switchable = src.switchable === true;
    if (src.switchable) {
      switchState = await withTimeout(getSwitchState(src, switchCh), 800, null);
    } else if (src.powerSourceId) {
      // Hauptspeicher selbst nicht schaltbar, aber der verlinkte Speicher (der
      // die Leistung beisteuert, z. B. ein zwischengeschalteter Shelly) ist es:
      // dessen Schalter in die Kachel des Hauptspeichers einweben. Geschaltet
      // wird dann der verlinkte Speicher (switchSourceId), nicht der Haupt-
      // speicher.
      const linked = allSources.find((s) => s.id === src.powerSourceId) as any;
      if (linked?.switchable) {
        switchable = true;
        switchSourceId = linked.id;
        switchChannel = resolveSwitchChannel(linked);
        switchState = await withTimeout(getSwitchState(linked, switchChannel), 800, null);
      }
    }
    const base = {
      sourceId: src.id, label: src.label, connection: conn,
      switchable,
      switchSourceId,
      switchChannel,
      switchState,
    };
    try {
      if (conn === "udp") {
        const target = parseMarstekTarget(src.url, src.acUdpPort ?? 30000);
        if (!target) throw new Error("ungültige Adresse");
        const reading = await readMarstek(target.host, target.port, src.timeoutMs ?? 3000);
        const mode = await getMarstekMode(target.host, target.port, src.timeoutMs ?? 3000);
        const structured = marstekStructured(reading);
        if (mode?.mode && !structured.mode) structured.mode = mode.mode;
        return { ...base, control: "udp", ...structured, online: true };
      }
      if (conn === "modbus") {
        // Wie die REST/MQTT-Speicher: die zuletzt vom Poller geholten Modbus-
        // Werte aus dem Live-State nutzen, statt beim Seitenaufruf LIVE (zwei
        // sequenzielle Modbus-TCP-Roundtrips mit langem Timeout) abzufragen. Das
        // machte die Speicherseite sehr langsam, wenn das Gerät träge/nicht
        // erreichbar war. Der Poller liest diese Quelle ohnehin regelmäßig.
        const last = getLastRead(src.id);
        const linkedFields = linkedPowerFields(src);
        const display = last?.display ?? [];
        return {
          ...base,
          online: last != null,
          control: "modbus",
          fields: linkedFields ? [...linkedFields, ...display] : display,
          values: last?.values ?? {},
          modules: last?.modules ?? [],
          // Steuerungs-Infos (forceMode/chargeToSoc/backup) kommen nicht aus dem
          // normalen Poll. Sie werden bei Bedarf über die Steuer-Endpunkte
          // (force/backup) frisch geladen, nicht bei jedem Seitenaufruf.
          mode: null,
          forceMode: null,
          chargeToSoc: null,
          backup: null,
        };
      }
      // REST/MQTT: die zuletzt gepollten Werte aus dem Live-State nutzen.
      const last = getLastRead(src.id);
      // Zendure-Speicher (acModel "zendure" mit appKey+Serial) sind über MQTT
      // steuerbar; sonst reines Monitoring.
      const isZendure = (src as any).acModel === "zendure" && (src as any).zendureAppKey && (src as any).zendureSerial;
      return {
        ...base, online: last != null, control: isZendure ? "zendure" : "none", generic: true,
        fields: last?.display ?? [],
        values: last?.values ?? {},
      };
    } catch (e: any) {
      return { ...base, online: false, error: e?.message ?? String(e) };
    }
  }));
  // Kürzel AC1/AC2/… in Listenreihenfolge anhängen (identisch zur SoC-Liste auf
  // der Übersicht), damit sich die Speicher dort leicht zuordnen lassen.
  speicher.forEach((sp: any, i) => { sp.kuerzel = `AC${i + 1}`; });
  const _dt = Date.now() - _t0;
  if (_dt > 1000) db.addLog(db.LOG_LEVELS.warn, "acspeicher", `Statusabruf dauerte ${_dt} ms (Geräte träge?)`);
  res.json({ configured: speicher.length > 0, speicher });
});

// DC-Speicher: Status aller dcBattery-Quellen. Die Momentanwerte ergeben sich
// aus den verlinkten Quellen (PV/Ladung + batteryOut/Entladung) plus optionalen
// schaltbaren Quellen, deren Schalter auf der Speicher-Seite erscheinen.
app.get("/api/dcspeicher/status", async (_req, res) => {
  const _t0 = Date.now();
  const list = getSources().filter((s) => s.role === "dcBattery" && s.enabled !== false);
  const allSources = getSources();
  const speicher = await Promise.all(list.map(async (src) => {
    const linkedPv = src.dcLinkedPv ? allSources.find((s) => s.id === src.dcLinkedPv) : undefined;
    const linkedBatt = src.dcLinkedBatteryOut ? allSources.find((s) => s.id === src.dcLinkedBatteryOut) : undefined;
    const linkedCharger = src.dcLinkedCharger ? allSources.find((s) => s.id === src.dcLinkedCharger) : undefined;
    const pvRead = linkedPv ? getLastRead(linkedPv.id) : null;
    const battRead = linkedBatt ? getLastRead(linkedBatt.id) : null;
    const chargerRead = linkedCharger ? getLastRead(linkedCharger.id) : null;

    // Momentanwerte zusammenstellen: alle Display-Felder der verlinkten Quellen,
    // jeweils mit Herkunft beschriftet.
    const fields: Array<{ label: string; value: number | boolean | string; unit: string; from?: string }> = [];
    if (pvRead) for (const d of pvRead.display) fields.push({ ...d, from: linkedPv!.label });
    if (battRead) for (const d of battRead.display) fields.push({ ...d, from: linkedBatt!.label });
    if (chargerRead) for (const d of chargerRead.display) fields.push({ ...d, from: linkedCharger!.label });

    // Abgeleitete Kernwerte: Ladeleistung (aus PV-Quelle), Entladeleistung (aus
    // batteryOut), SoC (falls eine der Quellen ihn liefert).
    const ladeW = pvRead?.values?.power ?? null;
    const entladeW = battRead?.values?.power ?? null;
    const soc = battRead?.values?.soc ?? pvRead?.values?.soc ?? null;

    // Schalter ergeben sich IMPLIZIT aus den verlinkten Quellen (PV, batteryOut,
    // AC-Ladegerät), soweit diese schaltbar sind – keine separate Schalterliste.
    const switchCandidates = [linkedPv, linkedBatt, linkedCharger]
      .filter((s): s is NonNullable<typeof s> => s != null && s.switchable === true);
    // Duplikate (falls z. B. dieselbe Quelle mehrfach) entfernen.
    const seen = new Set<string>();
    const uniqueSwitches = switchCandidates.filter((s) => {
      if (seen.has(s.id)) return false; seen.add(s.id); return true;
    });
    // Je Schalter nur den zuständigen Kanal (switchChannel, Default 0) und
    // dessen aktuellen Zustand ermitteln. state = null, wenn nicht sicher lesbar.
    const switches = await Promise.all(uniqueSwitches.map(async (s) => {
      const ch = resolveSwitchChannel(s);
      const state = await withTimeout(getSwitchState(s, ch), 800, null);
      return { id: s.id, label: s.label, channel: ch, state };
    }));

    // Weboberflächen-Links aller verlinkten Quellen einsammeln (für den Link-
    // Kasten auf der Speicher-Seite).
    const links: Array<{ url: string; label: string }> = [];
    for (const q of [linkedPv, linkedBatt, linkedCharger]) {
      for (const l of (q?.extraLinks ?? [])) {
        if (l?.url && l?.label) links.push({ url: l.url, label: l.label });
      }
    }

    return {
      id: src.id,
      label: src.label,
      linkedPv: linkedPv ? { id: linkedPv.id, label: linkedPv.label } : null,
      linkedBatteryOut: linkedBatt ? { id: linkedBatt.id, label: linkedBatt.label } : null,
      linkedCharger: linkedCharger ? { id: linkedCharger.id, label: linkedCharger.label } : null,
      online: pvRead != null || battRead != null || chargerRead != null,
      ladeW, entladeW, soc,
      fields,
      switches,
      links,
    };
  }));
  // Kürzel DC1/DC2/… in Listenreihenfolge (analog AC), passend zur SoC-Liste.
  speicher.forEach((sp: any, i) => { sp.kuerzel = `DC${i + 1}`; });
  const _dt = Date.now() - _t0;
  if (_dt > 1000) db.addLog(db.LOG_LEVELS.warn, "dcspeicher", `Statusabruf dauerte ${_dt} ms (Geräte träge?)`);
  res.json({ configured: speicher.length > 0, speicher });
});

// Speicher-Wirkungsgrad / -verluste: stellt je Speicher Lade- gegen Entlademenge
// (viertelstunden-basiert, leistungsintegrierte Näherung). Query-Parameter:
//   von=YYYY-MM-DD  Stichtag (Beginn, inklusive) – Pflicht
//   bis=YYYY-MM-DD  Ende (inklusive), Standard heute
//   granularitaet=tag|monat  Standard monat
// Für jeden auswertbaren Speicher werden Lade- und Entlademengen je Periode
// summiert und der Wirkungsgrad (Entladung/Ladung) sowie der Verlust (1-Wg)
// ausgewiesen. Quellenzuordnung:
//   acBattery: Ladung = "<id>" (Bezug), Entladung = "<id>::feedin".
//   dcBattery: Ladung = dcLinkedPv (pv) + dcLinkedCharger (consumer),
//              Entladung = dcLinkedBatteryOut + "::feedin".
// Ein DC-Speicher ohne vollständig messbare Ladung (fehlendes dcLinkedPv) wird
// als nicht auswertbar markiert (evaluable=false).
app.get("/api/speicherverluste", (req, res) => {
  const isoDate = (x: unknown): x is string =>
    typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const von = isoDate(req.query.von) ? req.query.von : null;
  if (!von) {
    res.status(400).json({ error: "Parameter 'von' (YYYY-MM-DD) erforderlich." });
    return;
  }
  const bis = isoDate(req.query.bis) ? req.query.bis : isoToday();
  const granularitaet = req.query.granularitaet === "tag" ? "tag" : "monat";
  const { von: vonTs } = db.dayBounds(von);
  const { bis: bisTs } = db.dayBounds(bis);

  const allSources = getSources();
  // Rohdaten einmalig laden: Consumer-Tagessummen und PV-Tagessummen.
  const consumerTage = db.getConsumerTagesSummen(vonTs, bisTs); // {consumer, tag, kwh}
  const pvTage = db.getPvTagesSummen(vonTs, bisTs); // {source, tag, kwh}
  // Nachschlage-Indizes: quelle -> (tag -> kwh)
  const consIdx: Record<string, Record<string, number>> = {};
  for (const r of consumerTage) (consIdx[r.consumer] ??= {})[r.tag] = r.kwh;
  const pvIdx: Record<string, Record<string, number>> = {};
  for (const r of pvTage) (pvIdx[r.source] ??= {})[r.tag] = r.kwh;

  // Periodenschlüssel (Tag oder Monat) aus einem Tagesdatum.
  const periode = (tag: string) => (granularitaet === "tag" ? tag : tag.slice(0, 7));

  // Alle vorkommenden Tage über beide Quellen sammeln.
  const alleTage = new Set<string>();
  for (const r of consumerTage) alleTage.add(r.tag);
  for (const r of pvTage) alleTage.add(r.tag);

  type Reihe = { periode: string; ladung: number; entladung: number };
  const baueReihen = (
    ladeQuellen: { kind: "consumer" | "pv"; id: string }[],
    entladeConsumerId: string, // Basis-ID; Entladung liegt unter "<id>::feedin"
  ): Reihe[] => {
    const acc: Record<string, { ladung: number; entladung: number }> = {};
    for (const tag of alleTage) {
      const p = periode(tag);
      const bucket = (acc[p] ??= { ladung: 0, entladung: 0 });
      for (const q of ladeQuellen) {
        const v = q.kind === "pv" ? pvIdx[q.id]?.[tag] : consIdx[q.id]?.[tag];
        if (v) bucket.ladung += v;
      }
      const ent = consIdx[`${entladeConsumerId}::feedin`]?.[tag];
      if (ent) bucket.entladung += ent;
    }
    return Object.entries(acc)
      .map(([periode, v]) => ({ periode, ladung: v.ladung, entladung: v.entladung }))
      .sort((a, b) => a.periode.localeCompare(b.periode));
  };

  const speicher: any[] = [];
  // Reihenfolge wie im oberen Teil der Seite: zuerst alle AC-Speicher, dann alle
  // DC-Speicher. Daher zwei getrennte Durchläufe statt gemischter Quellenordnung.
  const acSources = allSources.filter((s) => s.role === "acBattery" && s.enabled !== false && !s.subordinateOf);
  const dcSources = allSources.filter((s) => s.role === "dcBattery" && s.enabled !== false);
  for (const s of acSources) {
    const reihen = baueReihen([{ kind: "consumer", id: s.id }], s.id);
    const hatDaten = reihen.some((r) => r.ladung > 0 || r.entladung > 0);
    speicher.push({
      id: s.id, label: s.label, typ: "AC", evaluable: true, hatDaten,
      hinweis: null, reihen: reihen.map(withWirkungsgrad),
    });
  }
  for (const s of dcSources) {
    const ladeQuellen: { kind: "consumer" | "pv"; id: string }[] = [];
    if (s.dcLinkedPv) ladeQuellen.push({ kind: "pv", id: s.dcLinkedPv });
    if (s.dcLinkedCharger) ladeQuellen.push({ kind: "consumer", id: s.dcLinkedCharger });
    const entladeId = s.dcLinkedBatteryOut;
    const evaluable = !!entladeId && !!s.dcLinkedPv;
    if (!entladeId) continue; // ohne Entladepfad gar nicht darstellbar
    const reihen = evaluable ? baueReihen(ladeQuellen, entladeId) : [];
    speicher.push({
      id: s.id, label: s.label, typ: "DC", evaluable,
      hatDaten: reihen.some((r) => r.ladung > 0 || r.entladung > 0),
      hinweis: evaluable
        ? null
        : "Nicht auswertbar: die Einspeicherung aus der Solaranlage wird bei diesem Speicher nicht gemessen (kein PV-Ladepfad verknüpft).",
      reihen: reihen.map(withWirkungsgrad),
    });
  }

  res.json({ von, bis, granularitaet, speicher });
});

// Ergänzt eine Reihe um Wirkungsgrad (%) und Verlust (%). Wirkungsgrad =
// Entladung/Ladung. Nur sinnvoll, wenn Ladung > 0; sonst null (z.B. Tage ohne
// Ladung oder wenn erst entladen wurde, was vorher geladen war).
function withWirkungsgrad(r: { periode: string; ladung: number; entladung: number }) {
  const wg = r.ladung > 0 ? (r.entladung / r.ladung) * 100 : null;
  return {
    periode: r.periode,
    ladung: Math.round(r.ladung * 1000) / 1000,
    entladung: Math.round(r.entladung * 1000) / 1000,
    wirkungsgradProzent: wg == null ? null : Math.round(wg * 10) / 10,
    verlustProzent: wg == null ? null : Math.round((100 - wg) * 10) / 10,
  };
}

// Modbus-Ansteuerung: Force-Modus (Laden/Entladen/Automatik) setzen.
app.post("/api/acspeicher/modbus/force", async (req, res) => {
  const sourceId = req.body?.sourceId as string;
  const src = getSources().find((s) => s.id === sourceId && s.role === "acBattery");
  if (!src || effConnection(src) !== "modbus") {
    return res.status(400).json({ ok: false, error: "kein Modbus-AC-Speicher mit dieser ID" });
  }
  const mode = req.body?.mode as "none" | "charge" | "discharge";
  if (!["none", "charge", "discharge"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "ungültiger Modus" });
  }
  const powerW = typeof req.body?.powerW === "number" ? req.body.powerW : undefined;
  const toSoc = typeof req.body?.toSoc === "number" ? req.body.toSoc : undefined;
  const host = (src.url || "").replace(/^\w+:\/\//, "").replace(/[/:].*$/, "").trim();
  try {
    await setMarstekModbusForce(host, src.modbusPort ?? 502, src.modbusUnitId ?? 1, src.timeoutMs ?? 4000, mode, { powerW, toSoc });
    db.addLog(db.LOG_LEVELS.info, "acspeicher", `Modbus Force ${mode}${powerW != null ? ` (${powerW} W)` : ""} an ${src.label}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Modbus-Ansteuerung: Backup-Funktion schalten.
app.post("/api/acspeicher/modbus/backup", async (req, res) => {
  const sourceId = req.body?.sourceId as string;
  const src = getSources().find((s) => s.id === sourceId && s.role === "acBattery");
  if (!src || effConnection(src) !== "modbus") {
    return res.status(400).json({ ok: false, error: "kein Modbus-AC-Speicher mit dieser ID" });
  }
  const on = req.body?.on === true;
  const host = (src.url || "").replace(/^\w+:\/\//, "").replace(/[/:].*$/, "").trim();
  try {
    await setMarstekModbusBackup(host, src.modbusPort ?? 502, src.modbusUnitId ?? 1, src.timeoutMs ?? 4000, on);
    db.addLog(db.LOG_LEVELS.info, "acspeicher", `Modbus Backup ${on ? "an" : "aus"} an ${src.label}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Modbus-Steuerungs-Status (forceMode/chargeToSoc/backup) EINES Speichers frisch
// vom Gerät lesen. Wird von der Speicherseite NACH dem schnellen Initial-Load
// nachgeladen (nicht-blockierend), damit die Seite sofort erscheint und der
// Betriebsmodus kurz darauf nachpoppt. Ein einzelner Speicher pro Aufruf hält
// die Modbus-Last gering.
app.get("/api/acspeicher/modbus/control-status", async (req, res) => {
  const sourceId = String(req.query?.sourceId ?? "");
  const src = getSources().find((s) => s.id === sourceId && s.role === "acBattery");
  if (!src || effConnection(src) !== "modbus") {
    return res.status(400).json({ ok: false, error: "kein Modbus-AC-Speicher mit dieser ID" });
  }
  const host = (src.url || "").replace(/^\w+:\/\//, "").replace(/[/:].*$/, "").trim();
  try {
    const ctrl = await readMarstekModbusControl(host, src.modbusPort ?? 502, src.modbusUnitId ?? 1, src.timeoutMs ?? 4000);
    const fm = ctrl?.forceMode;
    const modeLabel = fm === 1 ? "Laden (erzwungen)" : fm === 2 ? "Entladen (erzwungen)" : fm === 0 ? "Automatik" : null;
    res.json({
      ok: true,
      mode: modeLabel,
      forceMode: fm ?? null,
      chargeToSoc: ctrl?.chargeToSoc ?? null,
      backup: ctrl?.backup ?? null,
    });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Zendure-Ansteuerung (MQTT): Laden/Entladen/Ruhe mit Leistung.
app.post("/api/acspeicher/zendure/mode", async (req, res) => {
  const sourceId = req.body?.sourceId as string;
  const src = getSources().find((s) => s.id === sourceId && s.role === "acBattery") as any;
  if (!src || src.acModel !== "zendure") {
    return res.status(400).json({ ok: false, error: "kein Zendure-AC-Speicher mit dieser ID" });
  }
  const mode = req.body?.mode as "charge" | "discharge" | "idle";
  if (!["charge", "discharge", "idle"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "ungültiger Modus" });
  }
  // Leistung: explizit übergeben oder aus den Quell-Defaults.
  let powerW = typeof req.body?.powerW === "number" ? req.body.powerW : undefined;
  if (powerW == null) {
    powerW = mode === "charge" ? (src.zendureMaxChargeW ?? 800) : mode === "discharge" ? (src.zendureMaxDischargeW ?? 800) : 0;
  }
  try {
    await setZendureMode(src, mode, powerW, (m) => db.addLog(db.LOG_LEVELS.info, "zendure", m));
    db.addLog(db.LOG_LEVELS.info, "acspeicher", `Zendure ${mode}${powerW ? ` ${powerW} W` : ""} an ${src.label}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

app.get("/api/marstek/status", async (_req, res) => {
  const m = firstMarstek();
  if (!m) return res.json({ configured: false });
  try {
    const reading = await readMarstek(m.host, m.port, m.src.timeoutMs ?? 3000);
    const mode = await getMarstekMode(m.host, m.port, m.src.timeoutMs ?? 3000);
    const structured = marstekStructured(reading);
    if (mode?.mode && !structured.mode) structured.mode = mode.mode;
    res.json({ configured: true, sourceId: m.src.id, label: m.src.label, ...structured });
  } catch (e: any) {
    res.json({ configured: true, online: false, error: e?.message ?? String(e) });
  }
});

app.post("/api/marstek/mode", async (req, res) => {
  const m = firstMarstek();
  if (!m) return res.status(400).json({ ok: false, error: "keine AC-Batterie konfiguriert" });
  const mode = req.body?.mode as MarstekMode;
  const power = typeof req.body?.power === "number" ? req.body.power : undefined;
  const durationS = typeof req.body?.durationS === "number" ? req.body.durationS : undefined;
  if (!["Auto", "AI", "Manual", "Passive"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "ungültiger Modus" });
  }
  try {
    const result = await setMarstekMode(m.host, m.port, mode, { power, durationS }, m.src.timeoutMs ?? 4000);
    db.addLog(
      result.ok ? db.LOG_LEVELS.info : db.LOG_LEVELS.warn,
      "marstek",
      `SetMode ${mode}${power != null ? ` (${power} W)` : ""}: ${result.ok ? "ok" : result.error}`
    );
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// --- Aktionen (REST-Endpunkte für Reset/Verwaltung) ---
app.post("/api/newDay", (_req, res) => {
  newDay();
  res.json({ ok: true });
});
app.post("/api/setCosts", (req, res) => {
  const costs = Number(req.query.costs);
  if (Number.isFinite(costs)) setCosts(costs);
  res.json({ ok: true });
});
// Gesamte Energiekosten-Einstellungen speichern (Body = Settings-Teilobjekt)
app.post("/api/energySettings", (req, res) => {
  const body = req.body;
  if (body && typeof body === "object") {
    saveEnergySettings(body);
    res.json({ ok: true });
  } else {
    res.status(400).json({ ok: false, error: "Objekt erwartet" });
  }
});
// Quellen-Konfiguration lesen (für Editor) und schreiben
app.get("/api/sources", (_req, res) => res.json(getSources()));

// Prüft, dass jeder Kernwert der Netzbilanz (Leistung, Bezugszähler,
// Einspeisezähler) von höchstens EINER aktiven grid-Quelle geliefert wird.
// Gibt eine Fehlermeldung zurück, wenn eine Metrik mehrfach aktiv belegt ist,
// sonst null. Die Anzahl der Netz-Quellen selbst ist nicht begrenzt.
function validateGridCoreValues(list: any[]): string | null {
  const active = list.filter((s) => s?.role === "grid" && s?.enabled);
  const hasMetric = (s: any, m: string) =>
    Array.isArray(s?.fields) && s.fields.some((f: any) => f?.metric === m);
  // power kann aus einem eigenen power-Feld ODER einer verknüpften
  // Leistungsquelle (powerSourceId) stammen.
  const powerSrcs = active.filter((s) => hasMetric(s, "power") || s?.powerSourceId);
  const inSrcs = active.filter((s) => hasMetric(s, "gridInTotal"));
  const outSrcs = active.filter((s) => hasMetric(s, "gridOutTotal"));
  const nameOf = (s: any) => s.label || s.id;
  if (powerSrcs.length > 1) {
    return `Es darf nur eine aktive Netz-Quelle die Leistung (power) liefern. `
      + `Aktuell: ${powerSrcs.map(nameOf).join(", ")}. Bitte bei den übrigen das `
      + `Leistungs-Feld auf „info" stellen oder die Verknüpfung entfernen.`;
  }
  if (inSrcs.length > 1) {
    return `Es darf nur eine aktive Netz-Quelle den Bezugszähler (gridInTotal) `
      + `liefern. Aktuell: ${inSrcs.map(nameOf).join(", ")}.`;
  }
  if (outSrcs.length > 1) {
    return `Es darf nur eine aktive Netz-Quelle den Einspeisezähler `
      + `(gridOutTotal) liefern. Aktuell: ${outSrcs.map(nameOf).join(", ")}.`;
  }
  return null;
}

app.post("/api/sources", (req, res) => {
  const next = req.body?.sources;
  if (!Array.isArray(next)) {
    return res.status(400).json({ ok: false, error: "sources-Array erwartet" });
  }
  // Netz-Validierung: Es dürfen beliebig viele aktive Netz-Quellen (Rolle
  // "grid") existieren, aber jeder Kernwert der Netzbilanz darf nur von GENAU
  // einer aktiven Quelle kommen – sonst würde er sich aufsummieren. Konkret:
  // höchstens eine aktive grid-Quelle mit Leistung (power – eigenes power-Feld
  // oder über eine verknüpfte Leistungsquelle powerSourceId), höchstens eine mit
  // Bezugszähler (gridInTotal) und höchstens eine mit Einspeisezähler
  // (gridOutTotal). So können sich z. B. ein Zähler mit den Zählerständen und ein
  // schneller Leistungsmesser die Netzrolle teilen.
  const gridErr = validateGridCoreValues(next);
  if (gridErr) return res.status(400).json({ ok: false, error: gridErr });
  setSources(next);
  res.json({ ok: true });
});
// Speicher-Reihenfolge per Drag&Drop ändern: erwartet geordnete ID-Listen für
// AC- und/oder DC-Speicher. Die betreffenden Quellen werden in der
// sourcesConfig in genau diese Reihenfolge gebracht (dauerhaft gespeichert);
// alle übrigen Quellen behalten ihre Position. Daraus ergibt sich automatisch
// die Reihenfolge der Speicher-Seite UND der SoC-Anzeige auf der Übersicht.
app.post("/api/speicher/reorder", (req, res) => {
  const acOrder: unknown = req.body?.acOrder;
  const dcOrder: unknown = req.body?.dcOrder;
  const isIdList = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((v) => typeof v === "string");
  if (acOrder !== undefined && !isIdList(acOrder)) {
    return res.status(400).json({ ok: false, error: "acOrder muss eine ID-Liste sein" });
  }
  if (dcOrder !== undefined && !isIdList(dcOrder)) {
    return res.status(400).json({ ok: false, error: "dcOrder muss eine ID-Liste sein" });
  }

  const current = getSources();
  // Gewünschte Reihenfolge je Rolle als Rang-Map (id -> Position).
  const rankOf = (order: string[] | undefined): Map<string, number> => {
    const m = new Map<string, number>();
    (order ?? []).forEach((id, i) => m.set(id, i));
    return m;
  };
  const acRank = rankOf(isIdList(acOrder) ? acOrder : undefined);
  const dcRank = rankOf(isIdList(dcOrder) ? dcOrder : undefined);

  // Stabil neu ordnen: Wir sortieren NUR innerhalb der jeweiligen Speicher-Rolle
  // und lassen die absoluten Positionen der übrigen Quellen unangetastet. Dazu
  // sammeln wir die Indizes der acBattery- bzw. dcBattery-Quellen und füllen sie
  // in der neuen Reihenfolge wieder auf.
  const reorderRole = (
    list: SourceConfig[], isRole: (s: SourceConfig) => boolean, rank: Map<string, number>,
  ): SourceConfig[] => {
    if (rank.size === 0) return list;
    const slots: number[] = [];
    const items: SourceConfig[] = [];
    list.forEach((s, i) => { if (isRole(s)) { slots.push(i); items.push(s); } });
    // Nach gewünschtem Rang sortieren; unbekannte IDs hinten anhängen (stabil).
    items.sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
    const out = [...list];
    slots.forEach((slotIdx, k) => { out[slotIdx] = items[k]; });
    return out;
  };

  let next = current;
  next = reorderRole(next, (s) => s.role === "acBattery", acRank);
  next = reorderRole(next, (s) => s.role === "dcBattery", dcRank);
  setSources(next);
  res.json({ ok: true });
});

app.get("/api/rooms", (_req, res) => res.json(getRooms()));
app.post("/api/rooms", (req, res) => {
  const next = req.body?.rooms;
  if (Array.isArray(next)) {
    setRooms(next);
    res.json({ ok: true });
  } else {
    res.status(400).json({ ok: false, error: "rooms-Array erwartet" });
  }
});

// --- Import/Export der Einstellungen ---
app.get("/api/settings/sections", (_req, res) => {
  // Verfügbare Bereiche inkl. Info, wie viele Datensätze vorhanden sind.
  res.json(
    SECTIONS.map((s) => ({ key: s.key, label: s.label, count: countSection(s.key) }))
  );
});

app.post("/api/settings/export", (req, res) => {
  const sel = Array.isArray(req.body?.sections) ? req.body.sections : SECTIONS.map((s) => s.key);
  const known = new Set(SECTIONS.map((s) => s.key));
  const sections = sel.filter((k: any) => known.has(k));
  res.json(buildExport(sections));
});

app.post("/api/settings/import/inspect", (req, res) => {
  try {
    const info = inspectImport(req.body?.data);
    const labels = SECTIONS.filter((s) => info.sections.includes(s.key));
    res.json({ ok: true, version: info.version, sections: labels });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? "ungültige Datei" });
  }
});

app.post("/api/settings/import", (req, res) => {
  try {
    const obj = req.body?.data;
    inspectImport(obj); // validiert Format
    const known = new Set(SECTIONS.map((s) => s.key));
    const sel = Array.isArray(req.body?.sections)
      ? req.body.sections.filter((k: any) => known.has(k))
      : [];
    const mode: ImportMode = req.body?.mode === "replace" ? "replace" : "merge";

    // Wird die Quellen-Konfiguration importiert, vorab die Eindeutigkeit der
    // Netz-Quelle (Rolle "grid") prüfen – wie beim normalen Speichern.
    if (sel.includes("quellen") && Array.isArray(obj.sections?.quellen)) {
      let candidate = obj.sections.quellen;
      if (mode === "merge") {
        const byId = new Map(getSources().map((x: any) => [x.id, x]));
        for (const x of candidate) byId.set(x.id, x);
        candidate = [...byId.values()];
      }
      const gridErr = validateGridCoreValues(candidate);
      if (gridErr) {
        return res.status(400).json({
          ok: false,
          error: `Import abgebrochen: ${gridErr}`,
        });
      }
    }

    const applied = applyImport(obj, sel, mode, (list) => setSources(list as any));
    // Falls EEBUS-Konfigurationen importiert wurden, die laufenden Module sofort
    // neu laden, damit die Änderungen ohne Neustart wirksam werden.
    if (applied.includes("eebus")) {
      try { loadEebusConfig(db.getSettingRaw("eebusConfig") ?? null); } catch { /* ignore */ }
      try { loadLppControlConfig(db.getSettingRaw("lppControlConfig") ?? null); } catch { /* ignore */ }
      try { loadLpcMonitorConfig(db.getSettingRaw("lpcMonitorConfig") ?? null); } catch { /* ignore */ }
    }
    db.addLog(db.LOG_LEVELS.info, "settings", `Import (${mode}): ${applied.join(", ") || "nichts"}`);
    res.json({ ok: true, applied });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? "Import fehlgeschlagen" });
  }
});

// --- Daten-Export/Import über Zeitspanne (Messdaten, getrennt von Einstellungen) ---
app.get("/api/data/export", (req, res) => {
  const von = String(req.query?.von ?? "").trim();
  const bis = String(req.query?.bis ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    return res.status(400).json({ ok: false, error: "von/bis als YYYY-MM-DD erwartet" });
  }
  if (von > bis) return res.status(400).json({ ok: false, error: "Startdatum liegt nach Enddatum" });
  const data = buildDataExport(von, bis);
  db.addLog(db.LOG_LEVELS.info, "data", `Datenexport ${von}..${bis}: ${Object.values(data.counts).reduce((a, b) => a + b, 0)} Datensätze`);
  res.json({ hemsDataExport: true, ...data });
});

// Vorschau: nur die Datensatzzahlen je Tabelle für den Zeitraum (ohne die Daten
// selbst zu laden) – für die Anzeige "wie viele Daten enthalten sind", analog zum
// Einstellungs-Export.
app.get("/api/data/export/preview", (req, res) => {
  const von = String(req.query?.von ?? "").trim();
  const bis = String(req.query?.bis ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    return res.status(400).json({ ok: false, error: "von/bis als YYYY-MM-DD erwartet" });
  }
  if (von > bis) return res.status(400).json({ ok: false, error: "Startdatum liegt nach Enddatum" });
  res.json({ ok: true, ...countDataExport(von, bis), labels: DATA_TABLE_LABELS });
});

app.post("/api/data/import/inspect", (req, res) => {
  try {
    const info = inspectDataImport(req.body?.data);
    res.json({ ok: true, ...info, labels: DATA_TABLE_LABELS });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? "Ungültige Datei" });
  }
});

app.post("/api/data/import", (req, res) => {
  try {
    const obj = req.body?.data;
    const mode = req.body?.mode === "overwrite" ? "overwrite" : "skip";
    const written = applyDataImport(obj, mode);
    const total = Object.values(written).reduce((a, b) => a + b, 0);
    db.addLog(db.LOG_LEVELS.info, "data", `Datenimport (${mode}): ${total} Datensätze geschrieben`);
    res.json({ ok: true, written, labels: DATA_TABLE_LABELS });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? "Import fehlgeschlagen" });
  }
});

// Kalender-Übersicht eines Jahres: je Tag mit Daten die Slot-Fülle.
app.get("/api/data/calendar", (req, res) => {
  const year = Number(req.query?.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ ok: false, error: "year (2000..2100) erwartet" });
  }
  res.json({ ok: true, year, days: dataCalendar(year) });
});

// Detail eines einzelnen Tages (für das Overlay).
app.get("/api/data/day", (req, res) => {
  const date = String(req.query?.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "date als YYYY-MM-DD erwartet" });
  }
  try {
    res.json({ ok: true, ...dayDetail(date), labels: DATA_TABLE_LABELS });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Messdaten eines Tagesbereichs löschen.
app.post("/api/data/delete", (req, res) => {
  const von = String(req.body?.von ?? "").trim();
  const bis = String(req.body?.bis ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    return res.status(400).json({ ok: false, error: "von/bis als YYYY-MM-DD erwartet" });
  }
  if (von > bis) return res.status(400).json({ ok: false, error: "Startdatum liegt nach Enddatum" });
  const deleted = deleteDataRange(von, bis);
  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  db.addLog(db.LOG_LEVELS.warn, "data", `Datenlöschung ${von}..${bis}: ${total} Datensätze entfernt`);
  res.json({ ok: true, deleted, labels: DATA_TABLE_LABELS });
});

// Datenbankschema (Tabellen + Spalten) für die SQL-Hilfestellung.
app.get("/api/data/sql/schema", (_req, res) => {
  try {
    res.json({ ok: true, schema: sqlSchema() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Direkte SQL-Ausführung (Abfragen und Eingriffe). Bewusst mächtig.
app.post("/api/data/sql", (req, res) => {
  const sql = String(req.body?.sql ?? "");
  try {
    const result = runSql(sql);
    if (result.kind === "changes") {
      db.addLog(db.LOG_LEVELS.warn, "sql", `SQL-Eingriff: ${result.changes} Zeile(n) betroffen | ${sql.slice(0, 200)}`);
    }
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// --- Benachrichtigungen (ntfy) ---
app.get("/api/notify", (_req, res) => res.json(db.loadNotifySettings()));
app.post("/api/notify", (req, res) => {
  const s = req.body?.settings;
  if (!s || typeof s !== "object") {
    return res.status(400).json({ ok: false, error: "settings erwartet" });
  }
  db.saveNotifySettings(s);
  res.json({ ok: true, settings: db.loadNotifySettings() });
});
app.post("/api/notify/test", async (_req, res) => {
  const r = await sendNtfyTest();
  if (r.ok) res.json({ ok: true });
  else res.status(400).json({ ok: false, error: r.error });
});

// Diagnose: setzt den Tageswechsel-Merker auf "gestern" zurück, sodass eine
// aktive Tageswechsel-Regel beim nächsten Auswertungszyklus (wenige Sekunden)
// garantiert auslöst. Damit lässt sich der tägliche Push testen, ohne bis
// Mitternacht zu warten.
app.post("/api/rules/trigger-daily-test", (_req, res) => {
  const d = new Date(Date.now() - 86_400_000);
  const gestern = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  db.setLastDailyTrigger(gestern);
  res.json({ ok: true, hinweis: "Merker auf gestern gesetzt; die Tageswechsel-Regel löst beim nächsten Zyklus aus." });
});

// --- Automatisierungsregeln ---
app.get("/api/rules", (_req, res) => {
  const rules = db.loadRules();
  const status = getConditionStatus();
  const actStatus = getActionStatus();
  // Regeln mit Live-Status (aktiv? Bedingungen grün/rot, Aktions-Zielzustände) anreichern.
  const enriched = rules.map((r) => ({
    ...r,
    active: getRuleActive(r.id),
    conditionStatus: status[r.id] ?? {},
    actionStatus: actStatus[r.id] ?? {},
  }));
  res.json(enriched);
});
// Liste der in Push-Nachrichten verwendbaren Platzhalter (für Info-Anzeige).
app.get("/api/push-variables", (_req, res) => {
  res.json({ variables: PUSH_VARIABLES });
});
app.post("/api/rules", (req, res) => {
  const rules = req.body?.rules;
  if (!Array.isArray(rules)) {
    return res.status(400).json({ ok: false, error: "rules-Array erwartet" });
  }
  db.saveRules(rules);
  res.json({ ok: true });
});
// Regelgruppen (Strukturierung der Automatisierungsregeln).
app.get("/api/rule-groups", (_req, res) => {
  res.json(db.loadRuleGroups());
});
app.post("/api/rule-groups", (req, res) => {
  const groups = req.body?.groups;
  if (!Array.isArray(groups)) {
    return res.status(400).json({ ok: false, error: "groups-Array erwartet" });
  }
  db.saveRuleGroups(groups);
  res.json({ ok: true });
});
// --- PV-Anlagendaten + Ertragsprognose ---
app.get("/api/pvanlagen", (_req, res) => {
  res.json(pvanlagen.loadPvAnlagen());
});
app.post("/api/pvanlagen", (req, res) => {
  const anlagen = req.body?.anlagen;
  if (!Array.isArray(anlagen)) {
    return res.status(400).json({ ok: false, error: "anlagen-Array erwartet" });
  }
  pvanlagen.savePvAnlagen(anlagen);
  res.json({ ok: true });
});
// Ertragsprognose (heute/morgen) für alle Anlagen. Ruft forecast.solar ab
// (kann je nach Anzahl Strings einige Sekunden dauern).
app.get("/api/pvanlagen/forecast", async (_req, res) => {
  try {
    const fc = await pvanlagen.getForecast();
    res.json({ ok: true, ...fc });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message ?? String(e) });
  }
});
// Gespeicherte (persistierte) Prognose für einen Tag – ohne neuen Abruf. Dient
// dem Tagesverlauf-Chart und der PV-Anlagenseite, damit die zuletzt abgerufene
// Prognose einen Seitenwechsel/Neustart übersteht.
// Reale PV-Slot-Summen (über alle Anlagen mit Leistung) für einen Tag.
function realPvSlots(date: string): number[] {
  const { von, bis } = db.dayBounds(date);
  const slots = new Array(96).fill(0);
  for (const g of pvAnlagenMitLeistung()) {
    for (const r of db.getPvViertelstunden(g.id, von, bis)) {
      const [h, m] = r.ts.slice(11).split(":").map(Number);
      let idx = Math.round((h * 60 + m) / 15) - 1;
      if (idx < 0) idx = 95;
      if (idx >= 0 && idx < 96) slots[idx] += r.ertrag;
    }
  }
  return slots;
}
// Aktuellen Skalierungsfaktor für heute berechnen (real vs. Prognose).
function aktuelleSkalierung(): { faktor: number; prozent: number; vorhanden: boolean } {
  const today = isoToday();
  const gestern = new Date(Date.parse(today + "T12:00:00") - 86400000).toLocaleDateString("sv-SE");
  const now = new Date();
  const nowSlot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);
  const s = pvanlagen.computePrognoseSkalierung(today, gestern, realPvSlots(today), realPvSlots(gestern), nowSlot);
  return { faktor: s.faktor, prozent: s.prozent, vorhanden: s.vorhanden };
}

app.get("/api/version", (_req, res) => res.json({ version: APP_VERSION }));

// Menüstruktur (vom Nutzer per Editor anpassbare Reihenfolge/Gruppierung). Es
// wird nur die Struktur (IDs + Gruppen) gespeichert; die Labels kommen weiterhin
// aus dem Frontend, damit Umbenennungen in Updates automatisch greifen. Liefert
// null, wenn der Nutzer nichts angepasst hat (Frontend nutzt dann den Default).
app.get("/api/menu", (_req, res) => {
  const raw = db.getSettingRaw("menuConfig");
  let config: unknown = null;
  if (raw) { try { config = JSON.parse(raw); } catch { config = null; } }
  res.json({ ok: true, config });
});
app.post("/api/menu", (req, res) => {
  const cfg = req.body?.config;
  // Grundvalidierung: Array aus Items mit id (string) und optionalen children.
  if (!Array.isArray(cfg)) {
    return res.status(400).json({ ok: false, error: "config muss ein Array sein" });
  }
  const clean = cfg
    .filter((it) => it && typeof it.id === "string")
    .map((it) => ({
      id: String(it.id),
      children: Array.isArray(it.children)
        ? it.children.filter((c: any) => c && typeof c.id === "string").map((c: any) => ({ id: String(c.id) }))
        : undefined,
    }));
  db.setSettingRaw("menuConfig", JSON.stringify(clean));
  res.json({ ok: true, config: clean });
});
app.delete("/api/menu", (_req, res) => {
  db.setSettingRaw("menuConfig", "");
  res.json({ ok: true });
});

// --- Reihenfolge sortierbarer Kachel-Bereiche (Drag&Drop) ---
// Gespeichert wird ein Objekt { [bereich]: string[] } mit der gewünschten
// Reihenfolge der Kachel-IDs je Bereich (z.B. "wpkpi", "wwkpi", "acspeicher",
// "sharing", "rules"). Unbekannte/fehlende IDs werden im Frontend robust
// ans Ende gehängt bzw. ausgefiltert, damit neue Kacheln nicht verloren gehen.
app.get("/api/tileorder", (_req, res) => {
  const raw = db.getSettingRaw("tileOrder");
  let order: Record<string, string[]> = {};
  if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === "object") order = p; } catch { order = {}; } }
  res.json({ ok: true, order });
});
app.post("/api/tileorder", (req, res) => {
  const bereich = typeof req.body?.bereich === "string" ? req.body.bereich.trim() : "";
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === "string") : null;
  if (!bereich || !ids) {
    return res.status(400).json({ ok: false, error: "bereich (string) und ids (string[]) erwartet" });
  }
  const raw = db.getSettingRaw("tileOrder");
  let order: Record<string, string[]> = {};
  if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === "object") order = p; } catch { order = {}; } }
  order[bereich] = ids;
  db.setSettingRaw("tileOrder", JSON.stringify(order));
  res.json({ ok: true, order });
});
app.delete("/api/tileorder", (req, res) => {
  const bereich = typeof req.query?.bereich === "string" ? req.query.bereich.trim() : "";
  const raw = db.getSettingRaw("tileOrder");
  let order: Record<string, string[]> = {};
  if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === "object") order = p; } catch { order = {}; } }
  if (bereich) delete order[bereich]; else order = {};
  db.setSettingRaw("tileOrder", JSON.stringify(order));
  res.json({ ok: true, order });
});
// Gemeinsamer Standort aller PV-Anlagen (lat/lon + optionale Beschriftung).
app.get("/api/pvanlagen/standort", (_req, res) => {
  res.json({ ok: true, standort: pvanlagen.getPvStandort() });
});
app.post("/api/pvanlagen/standort", (req, res) => {
  const b = req.body ?? {};
  if (b.standort === null) { pvanlagen.setPvStandort(null); return res.json({ ok: true, standort: null }); }
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ ok: false, error: "Ungültige Koordinaten" });
  }
  const s = { lat, lon, label: typeof b.label === "string" ? b.label : "" };
  pvanlagen.setPvStandort(s);
  res.json({ ok: true, standort: s });
});
app.get("/api/pvanlagen/prognose", (req, res) => {
  const date = String(req.query.date ?? "").trim() || new Date().toLocaleDateString("sv-SE");
  const p = pvanlagen.loadStoredPrognose(date);
  // Skalierte Rest-kWh nur für heute und nur wenn die Einstellung aktiv ist und
  // ein Faktor vorliegt. Sonst = unskaliert.
  let remainingKwhSkaliert = p.remainingKwh;
  let skalierungProzent = 0;
  const istHeute = date === isoToday();
  const aktiv = pvanlagen.getPrognoseSkalierungAktiv();
  if (istHeute && aktiv) {
    const sk = aktuelleSkalierung();
    if (sk.vorhanden) { remainingKwhSkaliert = p.remainingKwh * sk.faktor; skalierungProzent = sk.prozent; }
  }
  res.json({ ok: true, date, ...p, remainingKwhSkaliert, skalierungAktiv: aktiv, skalierungProzent });
});
// Historie der Tagesprognosen (je Tag der letzte Abruf).
app.get("/api/pvanlagen/prognose/historie", (req, res) => {
  const limit = Math.min(365, Math.max(1, Number(req.query.limit) || 90));
  res.json({ ok: true, tage: pvanlagen.listStoredPrognosen(limit) });
});
// Prognose-Verlauf eines Tages fuer den Slider: Liste der Zeitpunkte, zu denen
// es eine (veraenderte) Prognose gab. Optional ein bestimmter Stand ("stand"),
// dann werden zusaetzlich die Gesamt-Slots dieses Standes geliefert. Ohne
// "stand" liefert es nur die Zeitpunkte (und den letzten Stand als Default).
app.get("/api/pvanlagen/prognose/verlauf", (req, res) => {
  const date = String(req.query.date ?? "").trim() || new Date().toLocaleDateString("sv-SE");
  const zeitpunkte = pvanlagen.listPrognoseZeitpunkte(date);
  const stand = String(req.query.stand ?? "").trim();
  if (stand) {
    const p = pvanlagen.loadStoredPrognoseStand(date, stand);
    return res.json({ ok: true, date, zeitpunkte, gewaehlt: stand, gesamtSlots: p.gesamtSlots, kwhTotal: p.kwhTotal, anlagen: p.anlagen });
  }
  res.json({ ok: true, date, zeitpunkte, slotMax: pvanlagen.maxSlotTagesverlauf(date) });
});
// Skalierungsfaktor "an reale Produktion anpassen" für heute.
app.get("/api/pvanlagen/prognose/skalierung", (_req, res) => {
  const today = isoToday();
  const gestern = new Date(Date.parse(today + "T12:00:00") - 86400000).toLocaleDateString("sv-SE");
  const now = new Date();
  const nowSlot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);
  const s = pvanlagen.computePrognoseSkalierung(today, gestern, realPvSlots(today), realPvSlots(gestern), nowSlot);
  res.json({ ok: true, ...s, aktiv: pvanlagen.getPrognoseSkalierungAktiv() });
});
// Einstellung "Prognose an reale Produktion anpassen" lesen/schreiben.
app.get("/api/pvanlagen/prognose/skalierung/einstellung", (_req, res) => {
  res.json({ ok: true, aktiv: pvanlagen.getPrognoseSkalierungAktiv() });
});
app.post("/api/pvanlagen/prognose/skalierung/einstellung", (req, res) => {
  const aktiv = req.body?.aktiv;
  if (typeof aktiv !== "boolean") return res.status(400).json({ ok: false, error: "aktiv (boolean) erwartet" });
  pvanlagen.setPrognoseSkalierungAktiv(aktiv);
  res.json({ ok: true, aktiv });
});
app.get("/api/rules/log", (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json(db.getRuleLog(limit));
});
// Manuelles Starten/Stoppen einer Regel (unabhängig von Bedingungen/scharf).
app.post("/api/rules/:id/trigger", async (req, res) => {
  const start = req.body?.start !== false; // Default: starten
  const ok = await manualTrigger(req.params.id, start);
  res.status(ok ? 200 : 404).json({ ok });
});
// Gerade laufende (aktive) Regeln – für die Kacheln auf der Übersichtsseite.
// Enthält nur Regeln, die aktuell eingeschaltet sind, mit Startzeit.
app.get("/api/rules/running", (_req, res) => {
  const rules = db.loadRules();
  const running = rules
    .filter((r) => getRuleActive(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      showOnOverview: r.showOnOverview === true,
      startedAt: getRuleActiveSince(r.id),
    }));
  res.json(running);
});

// --- Zeitversionierte Kostenperioden ---
app.get("/api/perioden/stromtarif", (_req, res) => res.json(db.loadStromtarifPerioden()));
app.get("/api/perioden/modul1", (_req, res) => res.json(db.loadModul1Perioden()));
app.get("/api/perioden/modul3", (_req, res) => res.json(db.loadModul3Perioden()));
app.get("/api/perioden/wasser", (_req, res) => res.json(db.loadWasserPerioden()));
app.post("/api/perioden/stromtarif", (req, res) => {
  if (!Array.isArray(req.body?.perioden)) return res.status(400).json({ ok: false, error: "perioden-Array erwartet" });
  db.saveStromtarifPerioden(req.body.perioden); res.json({ ok: true });
});
app.post("/api/perioden/modul1", (req, res) => {
  if (!Array.isArray(req.body?.perioden)) return res.status(400).json({ ok: false, error: "perioden-Array erwartet" });
  db.saveModul1Perioden(req.body.perioden); res.json({ ok: true });
});
app.post("/api/perioden/modul3", (req, res) => {
  if (!Array.isArray(req.body?.perioden)) return res.status(400).json({ ok: false, error: "perioden-Array erwartet" });
  db.saveModul3Perioden(req.body.perioden); res.json({ ok: true });
});
app.post("/api/perioden/wasser", (req, res) => {
  if (!Array.isArray(req.body?.perioden)) return res.status(400).json({ ok: false, error: "perioden-Array erwartet" });
  db.saveWasserPerioden(req.body.perioden); res.json({ ok: true });
});

// Schaltbare Quellen (für die Aktions-Auswahl in der Regel-UI).
app.get("/api/switchable", (_req, res) => {
  const list = getSources()
    .filter((s) => s.switchable)
    .map((s) => ({ id: s.id, label: s.label, channels: s.switchChannels ?? 1 }));
  res.json(list);
});

// Liste der per Modbus TCP angebundenen AC-Speicher (für Automatisierungsregeln,
// die den Speicher direkt laden/entladen sollen).
app.get("/api/acspeicher/modbus-list", (_req, res) => {
  const list = getSources()
    .filter((s: any) => s.role === "acBattery" && s.connection === "modbus")
    .map((s) => ({ id: s.id, label: s.label }));
  res.json(list);
});
// Manuelles Testschalten eines Ausgangs.
app.post("/api/switch/test", async (req, res) => {
  const { sourceId, channel, on } = req.body ?? {};
  const src = getSources().find((s) => s.id === sourceId);
  if (!src) return res.status(400).json({ ok: false, error: "Quelle nicht gefunden" });
  if (!src.switchable) return res.status(400).json({ ok: false, error: "Quelle ist nicht schaltbar" });
  // Kanal automatisch aus dem JSON-Pfad ableiten, falls keiner übergeben wurde.
  const ch = channel != null && channel !== "" ? Number(channel) : resolveSwitchChannel(src);
  const ok = await switchSource(src, ch || 0, !!on);
  res.json({ ok });
});

// --- Wasserverbrauch ---
app.get("/api/wasser/stand", (_req, res) => {
  const r = db.getLetzterWasserStand();
  res.json(r ?? { ts: null, stand: null });
});
app.get("/api/wasser/tag", (req, res) => {
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date : isoToday();
  const { von, bis } = db.dayBounds(date);
  const values = new Array(96).fill(0);
  for (const r of db.getWasserViertelstunden(von, bis)) {
    const [h, m] = r.ts.slice(11).split(":").map(Number);
    let idx = Math.round((h * 60 + m) / 15) - 1;
    if (idx < 0) idx = 95;
    if (idx >= 0 && idx < 96) values[idx] = r.liter;
  }
  res.json({ date, values, summe: values.reduce((a, b) => a + b, 0) });
});

app.get("/api/wasser/monat", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : isoToday().slice(0, 7);
  const von = `${month}-01T00:00`;
  const bis = `${month}-31T23:59`;
  const tage = db.getWasserTagesverbrauch(von, bis);
  // Zeitversionierte Wasserkosten: die zum Monatsersten gültige Periode.
  const s = db.effectiveSettings(`${month}-01`);
  const preisProM3 = (s.wasserFrischEuroM3 ?? 0) + (s.wasserAbwasserEuroM3 ?? 0);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const grundpreisProTag = (s.wasserGrundpreisMonat ?? 0) / daysInMonth;
  const rows = tage.map((t) => {
    const m3 = t.liter / 1000;
    const verbrauchskosten = m3 * preisProM3;
    return { tag: t.tag, liter: t.liter, kosten: verbrauchskosten + grundpreisProTag, verbrauchskosten, grundpreis: grundpreisProTag };
  });
  res.json({ month, rows, preisFrisch: s.wasserFrischEuroM3, preisAbwasser: s.wasserAbwasserEuroM3, grundpreisMonat: s.wasserGrundpreisMonat });
});

// Spotpreise eines Tages liefern. ?date=YYYY-MM-DD (Default: heute).
// Sind die Daten noch nicht gespeichert, wird einmalig versucht, sie zu holen.
app.get("/api/spotpreise", async (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  let rec = db.getSpotpreise(date);
  if (!rec || rec.prices.length === 0) {
    rec = await fetchSpotpreise(date);
  }
  res.json({ ...(rec ?? { date, prices: [], fetched: "" }), sourceUrl: spotSourceUrl(date) });
});
// Liste der Tage, für die Preise vorliegen (z.B. zum Markieren im Kalender)
app.get("/api/spotpreise/dates", (_req, res) =>
  res.json(db.getSpotpreisDates())
);

// Spätestes verfügbares Börsenpreis-Datum (für die Folgetag-Navigation).
app.get("/api/spotpreise/latest", (_req, res) =>
  res.json({ latest: db.getSpotpreisLatest() })
);

// Viertelstunden-Energiewerte eines Tages (?date=YYYY-MM-DD, Default heute).
app.get("/api/viertelstunden", (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  // Slots des Tages: erstes Intervall endet 00:15, letztes (23:45–00:00)
  // endet am Folgetag um 00:00.
  const { von, bis } = db.dayBounds(date);
  const rows = db.getViertelstunden(von, bis);
  // Laufende (noch nicht abgeschlossene) Viertelstunde ergänzen, falls der
  // angefragte Tag heute ist – so ist der angefangene Slot im Tagesverlauf
  // sichtbar (analog zu PV-Ertrag und Verbrauchern). Der Wert steht noch nicht
  // in der DB (wird erst beim VS-Wechsel geschrieben).
  if (date === isoToday()) {
    const cur = currentViertelstunde();
    if (cur) {
      // Falls durch Timing bereits ein Eintrag mit diesem Zeitstempel existiert,
      // nicht doppeln.
      if (!rows.some((r) => r.ts === cur.ts)) rows.push(cur);
    }
  }
  res.json(rows);
});

// Diagnose: zeigt, warum der laufende Viertelstunden-Slot ggf. (noch) nicht
// geliefert wird (Zwischenwerte + Grund).
app.get("/api/viertelstunden/debug", (_req, res) => {
  res.json(computeCurrentViertelstunde().debug);
});

// Energy-Sharing-Modus setzen (statisch/dynamisch).
app.post("/api/sharing/config", (req, res) => {
  const { mode } = req.body ?? {};
  if (mode === "statisch" || mode === "dynamisch") {
    saveEnergySettings({ sharingMode: mode });
  }
  res.json({ ok: true });
});

// Abnehmer lesen.
app.get("/api/abnehmer", (_req, res) => res.json(db.loadAbnehmer()));
// Abnehmer speichern (komplette Liste; Quoten werden auf Summe ≤ 100 gedeckelt).
app.post("/api/abnehmer", (req, res) => {
  const list = req.body?.abnehmer;
  if (Array.isArray(list)) {
    db.saveAbnehmer(list);
    res.json({ ok: true, abnehmer: db.loadAbnehmer() });
  } else {
    res.status(400).json({ ok: false, error: "abnehmer-Array erwartet" });
  }
});

// --- Senken (emulierter Shelly Pro 3EM) ---
// Senken-Konfiguration lesen (inkl. verfügbarer Netz-Quellen für die Auswahl).
app.get("/api/sinks", (_req, res) => {
  const netzQuellen = getSources()
    .filter((src) => src.role === "grid")
    .map((src) => ({ id: src.id, label: src.label, enabled: src.enabled }));
  // Alle Quellen mit Leistungswert – für frei konfigurierbare Offsets einer Senke.
  const alleQuellen = getSources()
    .filter((src) => src.role !== "helper" && src.role !== "info" && src.role !== "waterTank")
    .map((src) => ({ id: src.id, label: src.label, role: src.role, enabled: src.enabled }));
  res.json({
    sinks: getSinks(),
    status: getSinkStatus(),
    netzQuellen,
    alleQuellen,
    formulaVariables: sinkFormulaVariables(),
    ctBalancer: getCtBalancerSnapshot(),
  });
});

// Formel einer Senke prüfen + Live-Wert berechnen (für die Vorschau im Editor).
app.post("/api/sinks/formula/check", (req, res) => {
  const formula = typeof req.body?.formula === "string" ? req.body.formula : "";
  const baseSourceId = typeof req.body?.baseSourceId === "string" ? req.body.baseSourceId : undefined;
  res.json(evalSinkFormula(formula, baseSourceId));
});
// Senken speichern (komplette Liste).
app.post("/api/sinks", (req, res) => {
  const list = req.body?.sinks;
  if (Array.isArray(list)) {
    setSinks(list);
    res.json({ ok: true, sinks: getSinks() });
  } else {
    res.status(400).json({ ok: false, error: "sinks-Array erwartet" });
  }
});

// --- EEBUS: Empfang von Steuerbefehlen einer Steuerbox (§14a/§9) ---
app.get("/api/eebus/state", (_req, res) => {
  res.json({ ok: true, state: getEebusState() });
});
app.get("/api/eebus/log", (req, res) => {
  const limit = Number(req.query?.limit ?? 200) || 200;
  res.json({ ok: true, log: getEebusLog(limit) });
});
app.post("/api/eebus/log/clear", (_req, res) => {
  clearEebusLog();
  res.json({ ok: true });
});
app.post("/api/eebus/config", (req, res) => {
  const b = req.body ?? {};
  const cfg: any = {};
  if (typeof b.enabled === "boolean") cfg.enabled = b.enabled;
  if (typeof b.steuerboxSki === "string") cfg.steuerboxSki = b.steuerboxSki.trim() || null;
  if (typeof b.eigenerSki === "string") cfg.eigenerSki = b.eigenerSki.trim() || null;
  if (b.lpcFailsafe && typeof b.lpcFailsafe === "object") cfg.lpcFailsafe = { wert: Number(b.lpcFailsafe.wert) || 0, dauerSek: Number(b.lpcFailsafe.dauerSek) || 7200 };
  if (b.lppFailsafe && typeof b.lppFailsafe === "object") cfg.lppFailsafe = { wert: Number(b.lppFailsafe.wert) || 0, dauerSek: Number(b.lppFailsafe.dauerSek) || 7200 };
  const st = setEebusConfig(cfg);
  db.setSettingRaw("eebusConfig", serializeEebusConfig());
  res.json({ ok: true, state: st });
});
// Simulator-Eingang (für Tests ohne echte Steuerbox).
app.post("/api/eebus/simulate", (req, res) => {
  const kind = String(req.body?.kind ?? "").trim();
  const useCase = (req.body?.useCase === "lpp" ? "lpp" : "lpc");
  const wert = Number(req.body?.wert) || 0;
  const dauerSek = req.body?.dauerSek == null ? null : (Number(req.body.dauerSek) || 0);
  if (!kind) return res.status(400).json({ ok: false, error: "kind erwartet" });
  simulateEvent(kind, useCase, wert, dauerSek);
  res.json({ ok: true, state: getEebusState() });
});
// Ingest-Endpunkt: der EEBUS-Sidecar meldet hier empfangene Steuerbefehle.
// Dies ist die interne Empfangsschnittstelle, die der Go-Sidecar bedient.
app.post("/api/eebus/ingest", (req, res) => {
  const b = req.body ?? {};
  const kind = String(b.kind ?? "").trim();
  const useCase = b.useCase === "lpp" ? "lpp" : "lpc";
  const wert = Number(b.wert) || 0;
  const dauerSek = b.dauerSek == null ? null : (Number(b.dauerSek) || 0);
  try {
    switch (kind) {
      case "limit": applyIncomingLimit(useCase, !!b.aktiv, wert, dauerSek); break;
      case "failsafe": applyIncomingFailsafe(useCase, wert, dauerSek ?? 7200); break;
      case "heartbeat": applyIncomingHeartbeat(); break;
      case "connect": setConnectionState(true, typeof b.ski === "string" ? b.ski : undefined); break;
      case "disconnect": setConnectionState(false); break;
      case "own": if (typeof b.ownSki === "string") setEigenerSki(b.ownSki); break;
      default: return res.status(400).json({ ok: false, error: "unbekanntes kind" });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});
// Status des Sidecars abfragen (eigener SKI, Verbindungszustand) – wird an den
// Sidecar durchgereicht, sofern er läuft.
app.get("/api/eebus/sidecar/status", async (_req, res) => {
  try {
    const r = await fetch(`${getSidecarHttp()}/status`, { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    res.json({ ok: true, sidecar: d, running: true });
  } catch {
    res.json({ ok: true, running: false });
  }
});
// SKI der Steuerbox an den Sidecar weiterreichen.
app.post("/api/eebus/sidecar/config", async (req, res) => {
  const remoteSki = typeof req.body?.remoteSki === "string" ? req.body.remoteSki.trim() : "";
  if (typeof req.body?.sidecarHttp === "string" && req.body.sidecarHttp.trim()) setSidecarHttp(req.body.sidecarHttp.trim());
  try {
    const r = await fetch(`${getSidecarHttp()}/config`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remoteSki }),
      signal: AbortSignal.timeout(3000),
    });
    const d = await r.json();
    res.json({ ok: true, sidecar: d });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: `Sidecar nicht erreichbar: ${e?.message ?? e}` });
  }
});

// --- §9-Umsetzung (LPP-Einspeisedrosselung, Live-Regelung mehrerer WR) ---
app.get("/api/lppcontrol/config", (_req, res) => {
  res.json({ ok: true, config: getLppControlConfig(), log: getLppControlLog(100), regel: getLppRegelStatus() });
});
app.post("/api/lppcontrol/config", (req, res) => {
  const b = req.body ?? {};
  const patch: any = {};
  for (const k of ["enabled", "scharf", "persistent"] as const) if (typeof b[k] === "boolean") patch[k] = b[k];
  for (const k of ["reserveW", "regelIntervalSek"] as const) if (b[k] != null && Number.isFinite(Number(b[k]))) patch[k] = Number(b[k]);
  if (Array.isArray(b.inverter)) patch.inverter = b.inverter;
  const cfg = setLppControlConfig(patch);
  db.setSettingRaw("lppControlConfig", serializeLppControlConfig());
  res.json({ ok: true, config: cfg });
});
// Test-Schreibvorgang für einen bestimmten WR (respektiert Dry-Run/Scharf).
app.post("/api/lppcontrol/test", async (req, res) => {
  const invId = typeof req.body?.invId === "string" ? req.body.invId : "";
  const prozent = Number(req.body?.prozent);
  if (!invId || !Number.isFinite(prozent)) return res.status(400).json({ ok: false, error: "invId und prozent erwartet" });
  const r = await testInverterWrite(invId, prozent);
  res.json(r);
});
// Steuerbare Wechselrichter automatisch aus den Quellen erkennen (Vorschlag).
app.get("/api/lppcontrol/erkennen", (_req, res) => {
  const vorschlag = erkenneInverterAusQuellen(getSources());
  res.json({ ok: true, inverter: vorschlag });
});

// --- §14a-Überwachung (LPC): SteuVE-Bezug gegen Limit prüfen (nur Anzeige) ---
app.get("/api/lpcmonitor/config", (_req, res) => {
  const est = getEebusState();
  res.json({
    ok: true,
    config: getLpcMonitorConfig(),
    status: getLpcMonitorStatus(est.lpc.aktiv, est.lpc.wert),
    log: getLpcMonitorLog(100),
  });
});
app.post("/api/lpcmonitor/config", (req, res) => {
  const b = req.body ?? {};
  const patch: any = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (b.warnschwelleProzent != null && Number.isFinite(Number(b.warnschwelleProzent))) patch.warnschwelleProzent = Number(b.warnschwelleProzent);
  if (Array.isArray(b.steuve)) {
    patch.steuve = b.steuve
      .filter((s: any) => s && typeof s.sourceId === "string")
      .map((s: any) => ({ id: String(s.id ?? `steuve_${Math.random().toString(36).slice(2, 8)}`), name: String(s.name ?? ""), sourceId: String(s.sourceId) }));
  }
  const cfg = setLpcMonitorConfig(patch);
  db.setSettingRaw("lpcMonitorConfig", serializeLpcMonitorConfig());
  res.json({ ok: true, config: cfg });
});

// --- extHems: Datenbereitstellung an externe HEMS ---
// Kuratierte Liste der bereitstellbaren Größen (für die Auswahl im Frontend).
app.get("/api/exthems/groessen", (_req, res) => {
  res.json({ ok: true, groessen: HEMS_GROESSEN, variablen: EXTHEMS_VARIABLE_NAMEN });
});
// Prüft eine benutzerdefinierte Formel-Größe gegen die erlaubten Variablen.
app.post("/api/exthems/formel/check", (req, res) => {
  const formel = typeof req.body?.formel === "string" ? req.body.formel : "";
  const r = validateFormula(formel, EXTHEMS_VARIABLE_NAMEN);
  res.json(r);
});
// Generiert die verständliche Schnittstellenbeschreibung für eine Senke (per
// gepostetem Sink-Objekt, damit auch ungespeicherte Entwürfe beschreibbar sind).
app.post("/api/exthems/beschreibung", (req, res) => {
  const sink = req.body?.sink;
  if (!sink || typeof sink !== "object") {
    return res.status(400).json({ ok: false, error: "sink-Objekt erwartet" });
  }
  try {
    res.json({ ok: true, text: beschreibungFuerSenke(sink) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// Schaltet den CT-Ausfade-Modus (AC-Speicher sanft auf 0) sofort, ohne die ganze
// Senke neu speichern zu müssen – für den Schalter auf der Senkenseite.
app.post("/api/sinks/ctfade", (req, res) => {
  const on = req.body?.on === true;
  const ok = setCtFadeout(on);
  res.json({ ok, fadeout: on });
});

// Schaltet den CT-Modus "kein AC-Laden" (CT-Wert auf >= 0 begrenzen) sofort.
app.post("/api/sinks/ctnoac", (req, res) => {
  const on = req.body?.on === true;
  const ok = setCtNoAcCharge(on);
  res.json({ ok, noAcCharge: on });
});

// Einmalige Registrierung eines CT002/CT003 in der Marstek-Cloud. Die
// Zugangsdaten (mailbox/password) kommen NUR in diesem Request und werden
// weder geloggt noch gespeichert. Bei Erfolg wird die erzeugte/gefundene CT-MAC
// in die betreffende Senke übernommen (sinkId), damit der Emulator sich mit
// derselben Identität meldet, die die Cloud kennt.
app.post("/api/sinks/register-ct", async (req, res) => {
  const mailbox = String(req.body?.mailbox ?? "").trim();
  const password = String(req.body?.password ?? "");
  const deviceType = req.body?.deviceType === "ct003" ? "ct003" : "ct002";
  const sinkId = typeof req.body?.sinkId === "string" ? req.body.sinkId : undefined;
  if (!mailbox || !password) {
    return res.status(400).json({ ok: false, error: "Mailbox und Passwort sind erforderlich." });
  }
  try {
    const result = await registerCtDevice({ mailbox, password, deviceType });
    // Bei Erfolg CT-MAC in die Senke übernehmen (falls sinkId übergeben).
    if (result.ok && result.ctMac && sinkId) {
      const sinks = getSinks().map((s: any) =>
        s.id === sinkId ? { ...s, ctMac: result.ctMac } : s
      );
      setSinks(sinks);
    }
    // Zugangsdaten NICHT loggen – nur das Ergebnis (ohne Klartext-Credentials).
    db.addLog(db.LOG_LEVELS.info, "marstek-cloud",
      `CT-Registrierung ${deviceType}: ${result.ok ? "OK" : "fehlgeschlagen"}${result.alreadyExisted ? " (bereits vorhanden)" : ""}`);
    res.json(result);
  } catch (e: any) {
    db.addLog(db.LOG_LEVELS.warn, "marstek-cloud", `CT-Registrierung fehlgeschlagen: ${e?.message ?? e}`);
    res.status(400).json({ ok: false, error: e?.message ?? "Registrierung fehlgeschlagen" });
  }
});

// Emulierter Shelly Pro 3EM (Gen2 RPC): liefert die momentane Wirkleistung
// einer Senke unter /sink/:id/rpc/EM.GetStatus, feldidentisch zum echten Gerät.
// total_act_power positiv = Bezug (vom Speicher auszuregeln).
function shellyEmStatus(power: number) {
  // Gleichmäßig auf drei Phasen aufgeteilt, wie es ein 3EM bei symmetrischer
  // Last melden würde. Spannung/Frequenz als plausible Festwerte.
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const pPh = power / 3;
  const voltage = 230.0;
  const pf = 1.0;
  const iPh = r3(Math.abs(pPh) / voltage); // Strombetrag je Phase
  const phase = (p: number) => ({
    current: iPh,
    voltage: voltage,
    act_power: r1(p),
    aprt_power: r1(Math.abs(p)),
    pf: pf,
    freq: 50.0,
  });
  const a = phase(pPh), b = phase(pPh), c = phase(pPh);
  return {
    id: 0,
    a_current: a.current,
    a_voltage: a.voltage,
    a_act_power: a.act_power,
    a_aprt_power: a.aprt_power,
    a_pf: a.pf,
    a_freq: a.freq,
    b_current: b.current,
    b_voltage: b.voltage,
    b_act_power: b.act_power,
    b_aprt_power: b.aprt_power,
    b_pf: b.pf,
    b_freq: b.freq,
    c_current: c.current,
    c_voltage: c.voltage,
    c_act_power: c.act_power,
    c_aprt_power: c.aprt_power,
    c_pf: c.pf,
    c_freq: c.freq,
    n_current: null,
    total_current: r3(Math.abs(power) / voltage),
    total_act_power: Math.round(power * 1000) / 1000,
    total_aprt_power: r3(Math.abs(power)),
    user_calibrated_phase: [],
  };
}
// Gen2 RPC-Form: /sink/:id/rpc/EM.GetStatus  (echtes Gerät: ...?id=0)
app.get("/sink/:id/rpc/EM.GetStatus", (req, res) => {
  const power = getSinkOutputPower(req.params.id);
  if (power == null) return res.status(404).json({ error: "unknown sink" });
  res.json(shellyEmStatus(power));
});
// Generische RPC-URL mit ?method=EM.GetStatus (alternative Aufrufform).
app.get("/sink/:id/rpc", (req, res) => {
  const power = getSinkOutputPower(req.params.id);
  if (power == null) return res.status(404).json({ error: "unknown sink" });
  res.json(shellyEmStatus(power));
});

// Energy-Sharing-Analyse eines Tages, basierend auf den Abnehmern.
app.get("/api/sharing", (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const s = db.loadSettings();
  const abnehmer = db.loadAbnehmer();
  const slots = computeSharingDay(date, abnehmer, s.sharingMode);
  // §42c-Quellen mit Rolle (für Anzeige in der Abnehmerliste).
  // Deaktivierte Quellen werden nicht angezeigt und nicht berücksichtigt.
  const quellen = getSources()
    .filter((src) => is42cRole(src.role) && src.enabled)
    .map((src) => ({
      id: src.id,
      label: src.label,
      enabled: src.enabled,
      role: src.role,
    }));
  res.json({ date, mode: s.sharingMode, abnehmer, quellen, slots });
});

// Verbraucher-Tagesverlauf: 96 Viertelstundenwerte (kWh) eines Geräts für einen Tag.
app.get("/api/consumer/:id/day", (req, res) => {
  const id = req.params.id;
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const { von, bis } = db.dayBounds(date);
  const rows = db.getConsumerViertelstunden(id, von, bis);
  const values = new Array(96).fill(0);
  for (const r of rows) {
    const t = r.ts.slice(11); // HH:MM
    const [h, m] = t.split(":").map(Number);
    let idx = Math.round((h * 60 + m) / 15) - 1; // Ende-Zeitstempel -> Slot-Index
    if (idx < 0) idx = 95;
    if (idx >= 0 && idx < 96) values[idx] = r.verbrauch;
  }
  const src = getSources().find((s) => s.id === id);
  const bidirectional = src?.role === "acBattery" || src?.role === "batteryOut";
  // Laufende (angefangene) Viertelstunde ergänzen, falls der angefragte Tag heute
  // ist: Der bisher aufgelaufene Verbrauch dieses Slots steht noch nicht in der
  // DB (wird erst beim VS-Wechsel geschrieben), soll aber schon sichtbar sein.
  if (date === isoToday()) {
    const cur = getConsumerCurrentSlot(id);
    if (cur.slotIndex >= 0 && cur.slotIndex < 96 && cur.kwh > 0) {
      values[cur.slotIndex] = cur.kwh;
    }
  }
  const summe = values.reduce((a, b) => a + b, 0);

  // Bidirektionale Speicher: zusätzlich die Einspeise-Serie (unter "<id>::feedin")
  // laden, damit Bezug und Einspeisung getrennt dargestellt werden können.
  let feedinValues: number[] | undefined;
  let feedinSumme: number | undefined;
  if (bidirectional) {
    const fid = `${id}::feedin`;
    feedinValues = new Array(96).fill(0);
    for (const r of db.getConsumerViertelstunden(fid, von, bis)) {
      const [h, m] = r.ts.slice(11).split(":").map(Number);
      let idx = Math.round((h * 60 + m) / 15) - 1;
      if (idx < 0) idx = 95;
      if (idx >= 0 && idx < 96) feedinValues[idx] = r.verbrauch;
    }
    if (date === isoToday()) {
      const cur = getConsumerCurrentSlot(fid);
      if (cur.slotIndex >= 0 && cur.slotIndex < 96 && cur.kwh > 0) feedinValues[cur.slotIndex] = cur.kwh;
    }
    feedinSumme = feedinValues.reduce((a, b) => a + b, 0);
  }

  res.json({
    id,
    date,
    label: src?.label ?? id,
    icon: src?.icon ?? null,
    room: src?.room ?? null,
    values,
    summe,
    bidirectional,
    feedinValues,
    feedinSumme,
  });
});

// Aggregierter Verbrauch EINES Geräts über Monat oder Jahr.
//  gran=monat: Balken je Kalendertag des Monats von `date` (YYYY-MM-..).
//  gran=jahr:  Balken je Kalendermonat des Jahres von `date` (YYYY-..).
// Liefert die Balken (bucket + kWh) und die Gesamtsumme über den Zeitraum.
app.get("/api/consumer/:id/range", (req, res) => {
  const id = req.params.id;
  const gran = req.query.gran === "jahr" ? "jahr" : "monat";
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  let vonDate: string, bisDate: string, by: "tag" | "monat";
  if (gran === "jahr") {
    vonDate = `${year}-01-01`;
    bisDate = `${year}-12-31`;
    by = "monat";
  } else {
    const p = (n: number) => String(n).padStart(2, "0");
    const lastDay = new Date(year, month, 0).getDate();
    vonDate = `${year}-${p(month)}-01`;
    bisDate = `${year}-${p(month)}-${p(lastDay)}`;
    by = "tag";
  }
  const von = db.dayBounds(vonDate).von;
  const bis = db.dayBounds(bisDate).bis;
  const rows = db.getConsumerBuckets(id, von, bis, by);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.bucket] = r.kwh;

  // Bidirektionale Speicher: zusätzlich die Einspeise-/Entlade-Serie (::feedin)
  // aggregieren, damit im Monats-/Jahreschart nicht nur der Ladevorgang, sondern
  // auch die Entladung sichtbar ist.
  const src = getSources().find((s) => s.id === id);
  const bidirectional = src?.role === "acBattery" || src?.role === "batteryOut";
  const feedinMap: Record<string, number> = {};
  if (bidirectional) {
    for (const r of db.getConsumerBuckets(`${id}::feedin`, von, bis, by)) feedinMap[r.bucket] = r.kwh;
  }

  // Vollständige, lückenlose Bucket-Liste erzeugen (Tage bzw. Monate ohne Daten
  // als 0), damit das Balkendiagramm eine feste Achse hat.
  const buckets: Array<{ bucket: string; label: string; kwh: number; feedin?: number }> = [];
  const p = (n: number) => String(n).padStart(2, "0");
  if (gran === "jahr") {
    const names = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    for (let mo = 1; mo <= 12; mo++) {
      const key = `${year}-${p(mo)}`;
      buckets.push({ bucket: key, label: names[mo - 1], kwh: map[key] ?? 0, ...(bidirectional ? { feedin: feedinMap[key] ?? 0 } : {}) });
    }
  } else {
    const lastDay = new Date(year, month, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const key = `${year}-${p(month)}-${p(d)}`;
      buckets.push({ bucket: key, label: String(d), kwh: map[key] ?? 0, ...(bidirectional ? { feedin: feedinMap[key] ?? 0 } : {}) });
    }
  }
  const summe = buckets.reduce((a, b) => a + b.kwh, 0);
  const feedinSumme = bidirectional ? buckets.reduce((a, b) => a + (b.feedin ?? 0), 0) : undefined;
  res.json({ id, gran, date, label: src?.label ?? id, bidirectional, buckets, summe, feedinSumme });
});


// Liefert je Gerät eine Reihe mit 96 Viertelstundenwerten (kWh) plus Label/Icon.
app.get("/api/room/day", (req, res) => {
  const room = typeof req.query.room === "string" ? req.query.room : "";
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const { von, bis } = db.dayBounds(date);
  const OHNE = "Ohne Raum";
  // Alle Consumer-Quellen dieses Raums (untergeordnete Leistungsquellen außen vor).
  const geraete = getSources().filter(
    (s) => s.role === "consumer" && !s.subordinateOf && (s.room?.trim() || OHNE) === (room || OHNE)
  );
  const series = geraete.map((g) => {
    const values = new Array(96).fill(0);
    for (const r of db.getConsumerViertelstunden(g.id, von, bis)) {
      const [h, m] = r.ts.slice(11).split(":").map(Number);
      let idx = Math.round((h * 60 + m) / 15) - 1;
      if (idx < 0) idx = 95;
      if (idx >= 0 && idx < 96) values[idx] = r.verbrauch;
    }
    if (date === isoToday()) {
      const cur = getConsumerCurrentSlot(g.id);
      if (cur.slotIndex >= 0 && cur.slotIndex < 96 && cur.kwh > 0) values[cur.slotIndex] = cur.kwh;
    }
    return { id: g.id, label: g.label, icon: g.icon ?? null, deviceType: g.deviceType ?? null, values, summe: values.reduce((a, b) => a + b, 0) };
  });
  res.json({ room: room || OHNE, date, series });
});

// Alle Verbraucher eines Tages: je Gerät die 96 Viertelstundenwerte (kWh) samt
// Tagessumme und Raumzuordnung. Für vergangene Tage rein historisch; am heutigen
// Tag wird der laufende Slot ergänzt. Dient der Verbraucher-Tabelle mit
// Tagesauswahl und dem gestapelten Tagesdiagramm aller Verbraucher.
app.get("/api/consumers/day", (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const { von, bis } = db.dayBounds(date);
  const OHNE = "Ohne Raum";
  const heute = date === isoToday();
  // Verbraucher UND Speicher (AC-/DC-Speicher, Lader/Entlader) einbeziehen – auch
  // deaktivierte, damit die historische Tabelle dieselbe Geräteliste zeigt wie
  // die Live-Ansicht. Untergeordnete Leistungsquellen werden ausgelassen.
  const geraete = getSources().filter(
    (s) => (s.role === "consumer" || s.role === "batteryIn" || s.role === "batteryOut" || s.role === "acBattery") && !s.subordinateOf
  );
  const series = geraete.map((g) => {
    const values = new Array(96).fill(0);
    for (const r of db.getConsumerViertelstunden(g.id, von, bis)) {
      const [h, m] = r.ts.slice(11).split(":").map(Number);
      let idx = Math.round((h * 60 + m) / 15) - 1;
      if (idx < 0) idx = 95;
      if (idx >= 0 && idx < 96) values[idx] = r.verbrauch;
    }
    if (heute) {
      const cur = getConsumerCurrentSlot(g.id);
      if (cur.slotIndex >= 0 && cur.slotIndex < 96 && cur.kwh > 0) values[cur.slotIndex] = cur.kwh;
    }
    return {
      id: g.id,
      label: g.label,
      room: g.room?.trim() || OHNE,
      icon: g.icon ?? null,
      deviceType: g.deviceType ?? null,
      role: g.role ?? null,
      values,
      summe: values.reduce((a, b) => a + b, 0),
      disabled: g.enabled === false,
    };
  });
  res.json({ date, heute, series });
});

// Liefert die in der Quellendefinition hinterlegten Links (extraLinks) aller
// Quellen mit einer der angefragten Rollen. Wird genutzt, um die Geräte-Links
// kontextabhängig auf den jeweiligen Seiten anzuzeigen (PV → Stromerzeugung,
// acBattery → AC-Speicher, heatpump/waterTank → Wärmepumpe & Warmwasser).
// Parameter: roles = kommaseparierte Rollenliste. Zusätzlich werden bei
// role=heatpump auch Quellen mit deviceType "heatpump" einbezogen.
app.get("/api/source-links", (req, res) => {
  const rolesParam = typeof req.query.roles === "string" ? req.query.roles : "";
  const roles = new Set(rolesParam.split(",").map((r) => r.trim()).filter(Boolean));
  const wantHeatpump = roles.has("heatpump");
  const out = getSources()
    .filter((s: any) => {
      const roleMatch = roles.has(s.role);
      const hpMatch = wantHeatpump && s.deviceType === "heatpump";
      return (roleMatch || hpMatch) && Array.isArray(s.extraLinks) && s.extraLinks.some((l: any) => l?.url);
    })
    .map((s: any) => ({
      id: s.id,
      label: s.label,
      links: (s.extraLinks ?? []).filter((l: any) => l?.url).map((l: any) => ({ url: l.url, label: l.label || l.url })),
    }));
  res.json({ sources: out });
});


function pvAnlagenMitLeistung(): Array<{ id: string; label: string }> {
  return getSources()
    .filter((s: any) => s.role === "pv" && (!!s.powerSourceId || (s.fields ?? []).some((f: any) => f.metric === "power")))
    .map((s) => ({ id: s.id, label: s.label }));
}

// PV-Ertrag je Anlage als Tagesverlauf (96 Viertelstunden-Slots).
app.get("/api/pv/day", (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const { von, bis } = db.dayBounds(date);
  const heute = date === isoToday();
  const anlagen = pvAnlagenMitLeistung();
  const series = anlagen.map((g) => {
    const values = new Array(96).fill(0);
    for (const r of db.getPvViertelstunden(g.id, von, bis)) {
      const [h, m] = r.ts.slice(11).split(":").map(Number);
      let idx = Math.round((h * 60 + m) / 15) - 1;
      if (idx < 0) idx = 95;
      if (idx >= 0 && idx < 96) values[idx] = r.ertrag;
    }
    if (heute) {
      const cur = getPvCurrentSlot(g.id);
      if (cur.slotIndex >= 0 && cur.slotIndex < 96 && cur.kwh > 0) values[cur.slotIndex] = cur.kwh;
    }
    return { id: g.id, label: g.label, values, summe: values.reduce((a, b) => a + b, 0) };
  });
  res.json({ date, heute, series });
});

// PV-Ertrag je Anlage als Tagesbilanz über einen Monat (YYYY-MM).
app.get("/api/pv/month", (req, res) => {
  const month =
    typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : isoToday().slice(0, 7);
  const von = `${month}-01T00:00`;
  const [y, mo] = month.split("-").map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  const bis = `${month}-${String(lastDay).padStart(2, "0")}T23:59`;
  const anlagenInfo = pvAnlagenMitLeistung();
  // tag -> { source -> kWh }
  const perDay = new Map<string, Record<string, number>>();
  for (const r of db.getPvTagesSummen(von, bis)) {
    if (!perDay.has(r.tag)) perDay.set(r.tag, {});
    perDay.get(r.tag)![r.source] = r.kwh;
  }
  const rows = [...perDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, perSource]) => ({
      tag,
      perSource,
      summe: Object.values(perSource).reduce((a, b) => a + b, 0),
    }));
  res.json({ month, anlagen: anlagenInfo, rows });
});
// Liefert je Reihe die Punkte {t: "HH:MM:SS", v} plus die Einheit (aus der
// WP-Quellen-Konfiguration, sofern das Feld dort existiert).
app.get("/api/waermepumpe/day", (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const { von, bis } = db.dayBounds(date);
  const rows = db.getWpData(von, bis);

  // Einheiten aus der WP-Quelle (nur numerische Felder relevant).
  const wpSrc = getSources().find((s) => s.deviceType === "heatpump");
  const unitByLabel: Record<string, string> = {};
  for (const f of wpSrc?.fields ?? []) unitByLabel[f.label] = f.unit ?? "";

  // Reihen aufbauen. Verfügbare Labels = Vereinigung aus heutigen Daten und
  // allen jemals gespeicherten (damit die Auswahl-Liste stabil bleibt).
  const seriesMap: Record<string, Array<{ t: string; v: number }>> = {};
  for (const r of rows) {
    (seriesMap[r.label] ??= []).push({ t: r.ts.slice(11), v: r.value });
  }
  // Elektrische Leistung liegt in der separaten Reihe wp_power – als eigene
  // Datenreihe "_ElektrischW" wieder in die Anzeige einfügen.
  for (const p of db.getWpPower(von, bis)) {
    (seriesMap["_ElektrischW"] ??= []).push({ t: p.ts.slice(11), v: p.value });
  }
  const allLabels = new Set<string>([...db.getWpLabels(), ...Object.keys(unitByLabel), ...Object.keys(seriesMap)]);
  const series = [...allLabels].sort().map((label) => ({
    label,
    unit: unitByLabel[label] ?? "",
    points: seriesMap[label] ?? [],
  }));

  res.json({ date, label: wpSrc?.label ?? "Wärmepumpe", series });
});

// Wärmepumpen-Kennzahlen (KPI) über einen frei wählbaren Zeitraum. Aggregiert
// die persistierten Tagessätze (schnell); der laufende Tag wird live ergänzt.
// Parameter: von=YYYY-MM-DD, bis=YYYY-MM-DD (inklusive).
app.get("/api/waermepumpe/kpi", (req, res) => {
  const rx = /^\d{4}-\d{2}-\d{2}$/;
  const von = typeof req.query.von === "string" && rx.test(req.query.von) ? req.query.von : isoToday();
  const bis = typeof req.query.bis === "string" && rx.test(req.query.bis) ? req.query.bis : isoToday();
  const [a, b] = von <= bis ? [von, bis] : [bis, von];
  const kpi = aggregateWpKpi(a, b);
  const heizAnteil = kpi.kompressorH > 0 ? 100 * (kpi.heizH / kpi.kompressorH) : 0;
  const wwAnteil = kpi.kompressorH > 0 ? 100 * (kpi.wwH / kpi.kompressorH) : 0;
  const pvAnteil = kpi.energieKwh > 0 ? 100 * (kpi.pvKwh / kpi.energieKwh) : 0;

  // Kühl-Laufzeit als Restgröße (Gesamt minus Heizen und Warmwasser).
  const kuehlH = Math.max(0, kpi.kompressorH - kpi.heizH - kpi.wwH);

  // Energiebedarf je Betriebsart: direkt bei der Integration nach dem
  // gleichzeitig aktiven Betriebsmodus getrennt erfasst (nicht anteilig
  // geschätzt) – aus der feinen Leistungsreihe des verlinkten Mess-Shelly.
  const energieHeizKwh = kpi.energieHeizKwh;
  const energieWwKwh = kpi.energieWwKwh;
  const energieKuehlKwh = kpi.energieKuehlKwh;
  const energieHeizAnteil = kpi.energieKwh > 0 ? 100 * (energieHeizKwh / kpi.energieKwh) : 0;
  const energieWwAnteil = kpi.energieKwh > 0 ? 100 * (energieWwKwh / kpi.energieKwh) : 0;
  const energieKuehlAnteil = kpi.energieKwh > 0 ? 100 * (energieKuehlKwh / kpi.energieKwh) : 0;

  // COP (Arbeitszahl): abgegebene Wärmemenge / eingesetzte elektrische Energie.
  const cop = kpi.energieKwh > 0 ? kpi.waermeKwh / kpi.energieKwh : null;

  res.json({
    von: a, bis: b, ...kpi, kuehlH,
    heizAnteil, wwAnteil, pvAnteil,
    energieHeizKwh, energieWwKwh, energieKuehlKwh,
    energieHeizAnteil, energieWwAnteil, energieKuehlAnteil,
    cop,
  });
});

// Warmwasser-Kennzahlen über einen Zeitraum (Erzeugungsarten WP/Heizstab/Solar).
app.get("/api/warmwasser/kpi", (req, res) => {
  const rx = /^\d{4}-\d{2}-\d{2}$/;
  const von = typeof req.query.von === "string" && rx.test(req.query.von) ? req.query.von : isoToday();
  const bis = typeof req.query.bis === "string" && rx.test(req.query.bis) ? req.query.bis : isoToday();
  const [a, b] = von <= bis ? [von, bis] : [bis, von];
  // Zusätzlich die aktuell im Speicher gebundene thermische Energie (Momentanwert
  // aus den zuletzt gemessenen Temperaturen und der editierbaren Formel).
  res.json({ ...computeWwKpi(a, b), speicherWaerme: aktuelleSpeicherWaerme() });
});

// Formel für die gespeicherte thermische Energie laden/speichern.
app.get("/api/warmwasser/waermeformel", (_req, res) => {
  res.json({ formel: getWwWaermeFormel(), default: WW_WAERME_FORMEL_DEFAULT });
});
app.post("/api/warmwasser/waermeformel", (req, res) => {
  const expr = typeof req.body?.formel === "string" ? req.body.formel.trim() : "";
  if (!expr) { res.status(400).json({ ok: false, error: "leere Formel" }); return; }
  // Syntaxprüfung: nur die Variablen T_u und T_o sind erlaubt.
  const chk = validateFormula(expr, ["T_u", "T_o"]);
  if (!chk.ok) { res.status(400).json({ ok: false, error: chk.error }); return; }
  setWwWaermeFormel(expr);
  res.json({ ok: true, formel: expr, probe: aktuelleSpeicherWaerme() });
});

// Wärmepumpen-KPI je Tag über einen Monat (für die Monats-Diagramme in der
// Kennzahlen-Auswertung). month=YYYY-MM. Liefert für jeden Tag des Monats einen
// Satz mit Energie (heiz/ww/kühl), Wärme (heiz/ww), Kälte, Takten und Abtauungen.
app.get("/api/waermepumpe/kpi/monat", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : isoToday().slice(0, 7);
  const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
  const lastDay = new Date(y, mo, 0).getDate();
  const von = `${month}-01`;
  const bis = `${month}-${String(lastDay).padStart(2, "0")}`;
  const rows = aggregateWpKpiRaw(von, bis);
  const byTag = new Map(rows.map((r) => [r.tag, r]));
  const p = (n: number) => String(n).padStart(2, "0");
  const tage: any[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const tag = `${month}-${p(d)}`;
    const r: any = byTag.get(tag);
    tage.push({
      tag, label: String(d),
      energieHeizKwh: r?.energieHeizKwh ?? 0,
      energieWwKwh: r?.energieWwKwh ?? 0,
      energieKuehlKwh: r?.energieKuehlKwh ?? 0,
      waermeKwh: r?.waermeKwh ?? 0,
      waermeHeizKwh: r?.waermeHeizKwh ?? 0,
      waermeWwKwh: r?.waermeWwKwh ?? 0,
      kaelteKwh: r?.kaelteKwh ?? 0,
      takte: r?.takte ?? 0,
      abtauungen: r?.abtauungen ?? 0,
      kompressorH: r?.kompressorH ?? 0,
      energieKwh: r?.energieKwh ?? 0,
      pvKwh: r?.pvKwh ?? 0,
      // Anteil des Energiebedarfs, der durch PV gedeckt wurde (0..100).
      pvAnteil: r && r.energieKwh > 0 ? 100 * ((r.pvKwh ?? 0) / r.energieKwh) : 0,
    });
  }
  res.json({ month, tage });
});

// Chart-Voreinstellungen der Wärmepumpen-Seite laden/speichern.
app.get("/api/waermepumpe/prefs", (_req, res) => {
  res.json(db.getWpPrefs());
});
app.post("/api/waermepumpe/prefs", (req, res) => {
  const body = req.body ?? {};
  const visible =
    body.visible && typeof body.visible === "object" ? body.visible : {};
  const axisOf = body.axisOf && typeof body.axisOf === "object" ? body.axisOf : {};
  db.saveWpPrefs({ visible, axisOf });
  res.json({ ok: true });
});

// Warmwasserspeicher-Temperaturverlauf für ein frei wählbares Zeitfenster.
// Parameter: von, bis als lokale ISO-Zeit (YYYY-MM-DDTHH:MM:SS). Fällt ohne
// Angabe auf die letzten 24 Stunden zurück.
app.get("/api/warmwasser/verlauf", (req, res) => {
  const von = typeof req.query.von === "string" ? req.query.von : null;
  const bis = typeof req.query.bis === "string" ? req.query.bis : null;
  let vonTs = von, bisTs = bis;
  if (!vonTs || !bisTs) {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 3600 * 1000);
    const fmt = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    vonTs = fmt(past); bisTs = fmt(now);
  }
  const rows = db.getWarmwasser(vonTs, bisTs);
  const up = rows.filter((r) => r.tankUp != null).map((r) => ({ t: r.ts, v: r.tankUp as number }));
  const down = rows.filter((r) => r.tankDown != null).map((r) => ({ t: r.ts, v: r.tankDown as number }));
  // Label der aktiven Warmwasserquelle (für die Anzeige der Feldnamen).
  const wtSrc = getSources().find((s) => s.role === "waterTank" && s.enabled !== false);
  const upLabel = wtSrc?.fields?.[0]?.label ?? "Oben";
  const downLabel = wtSrc?.fields?.[1]?.label ?? "Unten";
  res.json({
    von: vonTs, bis: bisTs,
    configured: !!wtSrc,
    series: [
      { key: "tankUp", label: upLabel, unit: "°C", points: up },
      { key: "tankDown", label: downLabel, unit: "°C", points: down },
    ],
    // Aktivitätsintervalle der Warmwassererzeuger (für farbige Overlays).
    aktivitaet: warmwasserAktivitaet(vonTs, bisTs),
  });
});
// Erzwungener Neu-Download für einen Tag (überschreibt vorhandene Daten).
app.post("/api/spotpreise/reload", async (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const rec = await fetchSpotpreise(date);
  res.json(rec ?? { date, prices: [], fetched: "" });
});
// Testabfrage einer (noch nicht gespeicherten) Quelle: liefert die per
// JSON-Pfad gelesenen Werte zurück, damit man die Konfiguration prüfen kann.
app.post("/api/sources/test", async (req, res) => {
  try {
    const src = req.body?.source;
    if (!src) {
      res.status(400).json({ ok: false, error: "source erwartet" });
      return;
    }
    if ((src.connection ?? "rest") === "mqtt") {
      // MQTT: kurz verbinden und auf eine Nachricht warten, dann die Felder aus
      // der Payload extrahieren (analog zur laufenden Auswertung).
      if (!src.mqttUrl || !src.mqttTopic) {
        res.status(400).json({ ok: false, error: "mqttUrl und mqttTopic erwartet" });
        return;
      }
      const { raw } = await testMqttSource(src, Math.max(2000, src.timeoutMs ?? 8000));
      let doc: any;
      try {
        const parsed = JSON.parse(raw);
        doc = parsed !== null && typeof parsed === "object" ? parsed : { value: parsed };
      } catch {
        const n = Number(raw);
        doc = { value: Number.isFinite(n) ? n : raw };
      }
      const result = extractFields(src, doc);
      res.json({ ok: true, ...result, raw });
      return;
    }
    if (!src.url) {
      res.status(400).json({ ok: false, error: "source mit url erwartet" });
      return;
    }
    const result = await testSource(src);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.json({ ok: false, error: e?.message ?? String(e) });
  }
});
app.post("/api/resetDrosselungen", (req, res) => {
  const source = req.query.source;
  if (typeof source === "string" && source) {
    resetDrosselungenForSource(source);
  } else {
    resetDrosselungen();
  }
  res.json({ ok: true });
});
app.post("/api/resetTagesstatistiken", (_req, res) => {
  resetHistory();
  res.json({ ok: true });
});
app.post("/api/deleteMonth", (req, res) => {
  const month = req.query.month ?? req.body?.month;
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    deleteHistoryMonth(month);
    res.json({ ok: true });
  } else {
    res.status(400).json({ ok: false, error: "month=YYYY-MM erwartet" });
  }
});

// --- Lastprofile (Emulations-Simulator) ---
// Liste aller verfügbaren Profile (eingebaut + benutzerdefiniert).
app.get("/api/profiles", (_req, res) => {
  res.json({ profiles: listProfiles() });
});
// Lastgang eines Profils für einen konkreten Tag (zur Visualisierung).
// Query: ?date=YYYY-MM-DD&jv=<Jahresverbrauch kWh> (jv optional, Default 1000)
app.get("/api/profiles/:name/day", (req, res) => {
  const name = req.params.name;
  if (!getProfileData(name)) return res.status(404).json({ error: "unknown profile" });
  const dateStr =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const jv = Number(req.query.jv) > 0 ? Number(req.query.jv) : 1000;
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = dayProfile(name, jv, new Date(y, m - 1, d));
  res.json({ name, date: dateStr, jahresverbrauch: jv, ...day });
});
// Download eines Profils im vollen CSV-Format.
app.get("/api/profiles/:name/download", (req, res) => {
  const csv = profileToCsv(req.params.name);
  if (csv == null) return res.status(404).json({ error: "unknown profile" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="lastprofil_${req.params.name}.csv"`
  );
  res.send(csv);
});
// Download einer leeren Vorlage (einfaches Format).
app.get("/api/profiles-template", (req, res) => {
  const f = String(req.query.format ?? "einfach");
  const format =
    f === "erweitert" || f === "vollstaendig" ? f : "einfach";
  const dateiname =
    format === "erweitert"
      ? "lastprofil_vorlage_erweitert.csv"
      : format === "vollstaendig"
        ? "lastprofil_vorlage_vollstaendig.csv"
        : "lastprofil_vorlage_einfach.csv";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${dateiname}"`);
  res.send(exampleProfileCsv(format));
});
// Upload eines eigenen Profils. Body: { name, csv }.
app.post("/api/profiles", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const csv = String(req.body?.csv ?? "");
  if (!name) return res.status(400).json({ ok: false, error: "Name fehlt." });
  if (!/^[A-Za-z0-9 _.\-]{1,40}$/.test(name))
    return res.status(400).json({
      ok: false,
      error: "Name darf nur Buchstaben, Ziffern, Leerzeichen, _ . - enthalten (max. 40).",
    });
  const builtin = listProfiles().find((p) => p.name === name && p.builtin);
  if (builtin)
    return res.status(400).json({ ok: false, error: "Name ist ein eingebautes Profil." });
  try {
    const prof = parseProfileCsv(csv);
    const custom = db.loadCustomProfiles();
    custom[name] = prof;
    db.saveCustomProfiles(custom);
    setCustomProfiles(custom);
    res.json({ ok: true, profiles: listProfiles() });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? "Ungültiges Format." });
  }
});
// Löschen eines benutzerdefinierten Profils.
app.delete("/api/profiles/:name", (req, res) => {
  const name = req.params.name;
  const custom = db.loadCustomProfiles();
  if (!(name in custom))
    return res.status(404).json({ ok: false, error: "Kein benutzerdefiniertes Profil." });
  delete custom[name];
  db.saveCustomProfiles(custom);
  setCustomProfiles(custom);
  res.json({ ok: true, profiles: listProfiles() });
});

// === Erzeugungsprofile (auf 1 kWp normiert) – analog zu den Lastprofilen ===
app.get("/api/genprofiles", (_req, res) => {
  res.json({ profiles: listGenProfiles() });
});
// Erzeugungs-Tagesgang für einen Tag, skaliert auf kWp. Query: ?date&kwp
app.get("/api/genprofiles/:name/day", (req, res) => {
  const name = req.params.name;
  if (!getGenProfileData(name)) return res.status(404).json({ error: "unknown profile" });
  const dateStr =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : isoToday();
  const kwp = Number(req.query.kwp) > 0 ? Number(req.query.kwp) : 1;
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = genDayProfile(name, kwp, new Date(y, m - 1, d));
  res.json({ name, date: dateStr, kwp, ...day });
});
app.get("/api/genprofiles/:name/download", (req, res) => {
  const csv = genProfileToCsv(req.params.name);
  if (csv == null) return res.status(404).json({ error: "unknown profile" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="erzeugungsprofil_${req.params.name}.csv"`
  );
  res.send(csv);
});
// Vorlagen: gleiches Dateiformat wie Lastprofile.
app.get("/api/genprofiles-template", (req, res) => {
  const f = String(req.query.format ?? "einfach");
  const format = f === "erweitert" || f === "vollstaendig" ? f : "einfach";
  const dateiname =
    format === "erweitert"
      ? "erzeugungsprofil_vorlage_erweitert.csv"
      : format === "vollstaendig"
        ? "erzeugungsprofil_vorlage_vollstaendig.csv"
        : "erzeugungsprofil_vorlage_einfach.csv";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${dateiname}"`);
  res.send(exampleProfileCsv(format));
});
app.post("/api/genprofiles", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const csv = String(req.body?.csv ?? "");
  if (!name) return res.status(400).json({ ok: false, error: "Name fehlt." });
  if (!/^[A-Za-z0-9 _.\-]{1,40}$/.test(name))
    return res.status(400).json({
      ok: false,
      error: "Name darf nur Buchstaben, Ziffern, Leerzeichen, _ . - enthalten (max. 40).",
    });
  try {
    const prof = parseProfileCsv(csv);
    const gen = db.loadGenProfiles();
    gen[name] = prof;
    db.saveGenProfiles(gen);
    setGenProfiles(gen);
    res.json({ ok: true, profiles: listGenProfiles() });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? "Ungültiges Format." });
  }
});
app.delete("/api/genprofiles/:name", (req, res) => {
  const name = req.params.name;
  const gen = db.loadGenProfiles();
  if (!(name in gen))
    return res.status(404).json({ ok: false, error: "Kein Erzeugungsprofil." });
  delete gen[name];
  db.saveGenProfiles(gen);
  setGenProfiles(gen);
  res.json({ ok: true, profiles: listGenProfiles() });
});

// --- Debug / Logs ---
// Logs lesen: ?min=<level>&limit=<n>. Liefert auch Counts + Mindest-Level.
app.get("/api/logs", (req, res) => {
  const min = Number(req.query.min);
  const minLevel = Number.isFinite(min) ? min : 0;
  const limit = Math.min(5000, Number(req.query.limit) || 1000);
  res.json({
    logs: db.getLogs(minLevel, limit),
    counts: db.getLogCounts(),
    minStoreLevel: db.getLogMinLevel(),
  });
});
// Mindest-Speicher-Level setzen (welche Level überhaupt gespeichert werden).
app.post("/api/logs/level", (req, res) => {
  const level = Number(req.body?.level);
  if (level in db.LOG_LEVEL_NAME) {
    db.setLogMinLevel(level);
    res.json({ ok: true, minStoreLevel: db.getLogMinLevel() });
  } else {
    res.status(400).json({ ok: false, error: "Ungültiges Level." });
  }
});
// Alle Logs löschen.
app.delete("/api/logs", (_req, res) => {
  db.clearLogs();
  res.json({ ok: true });
});

// --- Statisches Frontend (gebautes Vite-Bundle) ---
const webDist = path.join(__dirname, "..", "..", "web", "dist");
app.use(express.static(webDist));
app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));

startPoller();
startSpotScheduler();
pvanlagen.startPrognoseScheduler();

// Falls beim Start Daten aus einer hems_old.db übernommen wurden: kurze Meldung
// (Konsole + Log). Sonst passiert nichts.
{
  const imp = db.getOldDbImportResult();
  if (imp.imported && imp.tables.length > 0) {
    const summe = imp.tables.reduce((a, t) => a + t.rows, 0);
    const detail = imp.tables.filter((t) => t.rows > 0).map((t) => `${t.table}=${t.rows}`).join(", ");
    const msg = `Daten aus hems_old.db übernommen: ${summe} Datensätze (${detail || "nur Einstellungen/keine neuen Zeilen"}).`;
    console.log(msg);
    try { db.addLog(db.LOG_LEVELS.info, "migration", msg); } catch { /* ignore */ }
  } else if (imp.error) {
    const msg = `Übernahme aus hems_old.db fehlgeschlagen: ${imp.error}`;
    console.log(msg);
    try { db.addLog(db.LOG_LEVELS.warn, "migration", msg); } catch { /* ignore */ }
  }
}
// "0.0.0.0" bindet an alle Netzwerk-Interfaces, damit das Backend auch
// von anderen Geräten im LAN erreichbar ist (nicht nur localhost).
app.listen(PORT, "0.0.0.0", () => {
  console.log(`FLUX läuft auf http://localhost:${PORT}`);
  db.addLog(db.LOG_LEVELS.info, "server", `FLUX gestartet auf Port ${PORT}`);
  // EEBUS-Konfiguration laden und periodische Prüfung (ablaufende Limits,
  // Heartbeat-Timeout) starten.
  try { loadEebusConfig(db.getSettingRaw("eebusConfig") ?? null); } catch { /* ignore */ }
  // §9-Umsetzung (Growatt-Ansteuerung) laden und mit dem EEBUS-LPP-Empfang
  // verbinden.
  try { loadLppControlConfig(db.getSettingRaw("lppControlConfig") ?? null); } catch { /* ignore */ }
  setLppUmsetzung((aktiv, wert) => { setLppLimit(aktiv, wert); });
  // Push-Benachrichtigung bei Netzeingriff: wenn eine §9- oder §14a-Drosselung
  // eingeht oder wieder aufgehoben wird. notifyTransition feuert nur bei der
  // Flanke und in beide Richtungen.
  setLimitFlankeHandler((useCase, aktiv, wert, dauerSek) => {
    const para = useCase === "lpc" ? "§14a" : "§9";
    const art = useCase === "lpc" ? "Bezugsbegrenzung" : "Einspeisebegrenzung";
    const key = `eebus_limit_${useCase}`;
    const dauerTxt = dauerSek != null ? ` für ${Math.round(dauerSek / 60)} min` : "";
    notifyTransition(
      key, aktiv,
      () => ({
        text: `Netzbetreiber-Eingriff aktiv: ${art} auf ${wert} W${dauerTxt}.`,
        opts: { title: `${para} Drosselung aktiv`, priority: 4, tags: ["warning"] },
      }),
      () => ({
        text: `${art} nach ${para} wurde aufgehoben. Normalbetrieb.`,
        opts: { title: `${para} Drosselung aufgehoben`, priority: 3, tags: ["white_check_mark"] },
      }),
    );
  });
  // Ist-Leistung je WR aus den Quellen (powerOf) für die Regelung bereitstellen.
  setIstLeistungProvider((sourceId) => powerOf(sourceId));
  // §14a-Überwachung: Konfiguration laden, Ist-Leistungs-Provider setzen.
  try { loadLpcMonitorConfig(db.getSettingRaw("lpcMonitorConfig") ?? null); } catch { /* ignore */ }
  setLpcIstLeistungProvider((sourceId) => powerOf(sourceId));
  setInterval(() => {
    try { tickEebus(); } catch { /* ignore */ }
    try { const est = getEebusState(); tickLpcMonitor(est.lpc.aktiv, est.lpc.wert); } catch { /* ignore */ }
  }, 10000);
  // Vordefinierte Urlaubs-/Leckageüberwachungsregeln einmalig anlegen.
  try { db.ensureUrlaubsRules(); } catch (e: any) { db.addLog(db.LOG_LEVELS.warn, "server", `ensureUrlaubsRules: ${e?.message ?? e}`); }
  // Regel-Aktion "ctfade" mit der Poller-Funktion verbinden.
  setCtFadeoutProvider((on) => setCtFadeout(on));
  // Regel-Bedingung "ctFadeState" mit dem Lese-Zustand verbinden.
  setCtFadeStateProvider(() => getCtFadeout());
  // Regel-Aktion "ctnoac" (Modus "kein AC-Laden") verbinden.
  setCtNoAcChargeProvider((on) => setCtNoAcCharge(on));
  setCtNoAcChargeStateProvider(() => getCtNoAcCharge());
  // Erreichbare LAN-Adressen ausgeben
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`            oder http://${net.address}:${PORT}`);
      }
    }
  }
  // UDP-Discovery-Responder für den emulierten Shelly Pro 3EM starten, damit
  // Marstek-Speicher die Senke automatisch im LAN finden können.
  try {
    startShellyDiscovery(
      () => getDiscoverySinkInfo(),
      (m) => db.addLog(db.LOG_LEVELS.info, "shelly-udp", m)
    );
  } catch (e: any) {
    db.addLog(db.LOG_LEVELS.warn, "shelly-udp", `Start fehlgeschlagen: ${e?.message ?? e}`);
  }
  // UDP-Emulation eines Marstek CT002/CT003 (Port 12345) starten – aktiv nur,
  // wenn eine Senke einen CT-Typ emuliert.
  try {
    startCtEmulation(
      () => getCtSinkInfo(),
      (m) => db.addLog(db.LOG_LEVELS.info, "marstek-ct", m)
    );
  } catch (e: any) {
    db.addLog(db.LOG_LEVELS.warn, "marstek-ct", `Start fehlgeschlagen: ${e?.message ?? e}`);
  }
});
