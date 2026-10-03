// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { IconPicker } from "./IconPicker";
import { effectiveIcon } from "./iconDefaults";
import { profileLabel } from "./profileLabels";

// --- Typen (Spiegel der Backend-SourceConfig) ---
type Metric =
  | "power" | "energyTotal" | "energyReturnTotal" | "gridInTotal" | "gridOutTotal"
  | "soc" | "voltage" | "temperature" | "rate" | "connected" | "info";

interface SourceField {
  metric: Metric;
  jsonPath: string;
  label: string;
  unit: string;
  scale?: number;
  valueType?: "number" | "bool" | "string";
}
interface PowerCorrection {
  sourceId: string;
  sign: "+" | "-";
}
interface SourceConfig {
  id: string;
  label: string;
  role: string;
  deviceType?: string;
  icon?: string;
  room?: string;
  url: string;
  enabled: boolean;
  intervalSec: number;
  timeoutMs: number;
  fields: SourceField[];
  connection?: "rest" | "mqtt" | "udp" | "modbus";
  modbusPort?: number;
  modbusUnitId?: number;
  modbusModel?: string;
  authType?: "none" | "bearer";
  bearerToken?: string;
  mqttUrl?: string;
  mqttTopic?: string;
  mqttAuthType?: "none" | "userpass" | "clientcert";
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientCert?: string;
  mqttClientKey?: string;
  mqttCaCert?: string;
  mqttRejectUnauthorized?: boolean;
  powerCorrections?: PowerCorrection[];
  pvTarget?: "ac" | "dc";
  energySource?: "counter" | "integrated";
  mock?: "emu" | "gridEmu";
  emuProfile?: string;
  jahresverbrauch?: number;
  erzeugungsProfile?: string;
  kwp?: number;
  sharingQuote?: number;
  acModel?: string;
  acUdpPort?: number;
  zendureAppKey?: string;
  hueBridgeHost?: string;
  hueAppKey?: string;
  ccuHost?: string;
  ccuPort?: number;
  hubTyp?: "ccu3" | "hcu";
  ssHost?: string;
  ssPort?: number;
  ssUser?: string;
  ssPass?: string;
  acHost?: string;
  valloxHost?: string;
  prusaHost?: string;
  prusaAuth?: "apikey" | "digest";
  prusaApiKey?: string;
  prusaUser?: string;
  prusaPass?: string;
  airHost?: string;
  readerTopicBase?: string;
  evccHost?: string;
  evccLoadpoint?: number;
  entsoeToken?: string;
  persistLabels?: string[];
  persistPower?: boolean;
  geraeteMqttExtern?: boolean;
  geraeteMqttHost?: string;
  geraeteMqttPort?: number;
  geraeteMqttTopic?: string;
  hcuAuthToken?: string;
  hcuSgtin?: string;
  zendureSerial?: string;
  zendureMaxChargeW?: number;
  zendureMaxDischargeW?: number;
  extraLinks?: Array<{ url: string; label: string }>;
  switchable?: boolean;
  switchChannels?: number;
  switchChannel?: number;
  powerSourceId?: string;
  subordinateOf?: string;
  dcLinkedPv?: string;
  dcLinkedBatteryOut?: string;
  dcLinkedCharger?: string;
}

// Erweiterte Profilnamen kommen zentral aus profileLabels.

const ROLES = [
  { v: "grid", l: "Netz (Bezug/Einspeisung)" },
  { v: "gridEmu", l: "Netz (Bezug/Einspeisung) Emulation" },
  { v: "pv", l: "PV-Erzeugung" },
  { v: "batteryOut", l: "Batterie-Einspeisung (Entladung)" },
  { v: "batteryIn", l: "Batterie-Netzladung" },
  { v: "acBattery", l: "AC-Speicher" },
  { v: "dcBattery", l: "DC-Speicher" },
  { v: "consumer", l: "Verbraucher" },
  { v: "grid42c", l: "Netz (Bezug/Einspeisung) §42c" },
  { v: "grid42cEmu", l: "Netz (Bezug/Einspeisung) §42c Emulation" },
  { v: "helper", l: "Hilfswert / Info (Anzeige & Formeln)" },
  { v: "waterTank", l: "Warmwasserspeicher-Temperaturen" },
  { v: "hueBridge", l: "Philips Hue Bridge" },
  { v: "ccuHub", l: "Homematic (CCU3 / HCU)" },
  { v: "securitySpy", l: "SecuritySpy (Überwachungskameras)" },
  { v: "mitsubishiAc", l: "Mitsubishi Klimaanlage" },
  { v: "vallox", l: "Vallox Lüftungsanlage (valloxesp)" },
  { v: "prusa", l: "Prusa 3D-Drucker (PrusaLink)" },
  { v: "airSensor", l: "Luftsensor (Feinstaub/Temperatur/Druck)" },
  { v: "accessReader", l: "Zugangskontrolle (RFID/PIN-Reader)" },
  { v: "evcc", l: "Elektroauto (evcc)" },
  { v: "entsoe", l: "ENTSO-E REST API (CO₂-Netzintensität)" },
  { v: "water", l: "Wasserzähler" },
];

// Emulations-Rollen: keine URL, keine manuellen Felder, kein Verbindungstest –
// die Werte kommen aus dem Profil-Simulator.
// Status + Backfill der ENTSO-E-CO₂-Daten, direkt in der Quellenkonfiguration.
function EntsoeStatus({ hatToken }: { hatToken: boolean }) {
  const [info, setInfo] = useState<{ aktuelleIntensitaet: number | null; stand: number | null; daten: { von: string | null; bis: string | null; punkte: number; tage: number } } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetch("/api/co2/config").then((r) => r.json()).then((j) => {
      if (j.ok) setInfo({ aktuelleIntensitaet: j.aktuelleIntensitaet, stand: j.stand, daten: j.daten });
    }).catch(() => {});
  }, [tick]);

  const backfill = (tage: number) => {
    setLaeuft(true); setMeldung("");
    fetch("/api/co2/backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tage }) })
      .then((r) => r.json()).then((j) => {
        setLaeuft(false);
        if (j.ok) { setMeldung(`✓ ${j.geschriebeneViertelstunden} Viertelstunden aus ${j.intensitaetStunden} Stunden geladen.`); setTick((t) => t + 1); }
        else setMeldung(`Fehler: ${j.error ?? "?"}`);
      }).catch(() => { setLaeuft(false); setMeldung("Abruf fehlgeschlagen."); });
  };

  const fmtTs = (iso: string | null) => { if (!iso) return "–"; try { return new Date(iso.length === 16 ? iso + ":00" : iso).toLocaleDateString("de-DE"); } catch { return iso; } };
  const fmtStand = (ms: number | null) => { if (!ms) return "noch kein Abruf"; const min = Math.round((Date.now() - ms) / 60000); return min < 60 ? `vor ${min} min` : `vor ${Math.round(min / 60)} h`; };

  if (!hatToken) return <p className="hint" style={{ marginTop: 8 }}>Trage den Token ein und speichere, dann erscheinen hier Abruf-Status und die Möglichkeit, die Vergangenheit nachzuladen.</p>;

  return (
    <div className="entsoe-status">
      <div className="src-fields-head">Abruf-Status &amp; Daten</div>
      <div className="entsoe-grid">
        <span>Aktuelle Netzintensität:</span>
        <b>{info?.aktuelleIntensitaet != null ? `${info.aktuelleIntensitaet} g/kWh` : "–"}</b>
        <span>Letzter Abruf:</span>
        <b style={{ color: info?.stand ? "#1d7a3a" : "#c0392b" }}>{fmtStand(info?.stand ?? null)}</b>
        <span>Aufgezeichnete Daten:</span>
        <b>{info?.daten?.punkte ? `${fmtTs(info.daten.von)} – ${fmtTs(info.daten.bis)} (${info.daten.tage} Tage)` : "noch keine"}</b>
      </div>
      <p className="hint" style={{ margin: "8px 0 4px" }}>
        Vergangenheit nachladen: FLUX holt die historische Netzintensität von ENTSO-E
        und verrechnet sie mit dem gespeicherten Netzbezug. Nur Zeiträume mit
        vorhandenem Viertelstunden-Netzbezug werden befüllt.
      </p>
      <div className="entsoe-backfill-btns">
        <button onClick={() => backfill(30)} disabled={laeuft}>30 Tage</button>
        <button onClick={() => backfill(90)} disabled={laeuft}>90 Tage</button>
        <button onClick={() => backfill(365)} disabled={laeuft}>1 Jahr</button>
      </div>
      {laeuft && <p className="hint">lädt … (bei einem Jahr etwas Geduld)</p>}
      {meldung && <p className="hint" style={{ fontWeight: 600 }}>{meldung}</p>}
    </div>
  );
}

function isEmuRole(role: string): boolean {
  return role === "grid42cEmu" || role === "gridEmu";
}

const DEVICE_TYPES = [
  { v: "generic", l: "Allgemein" },
  { v: "car", l: "E-Auto" },
  { v: "heater", l: "Heizstab" },
  { v: "heatpump", l: "Wärmepumpe" },
  { v: "climate", l: "Klimaanlage" },
];

const VALUE_TYPES = [
  { v: "number", l: "Zahl" },
  { v: "bool", l: "Ja/Nein" },
  { v: "string", l: "Text" },
];

const METRICS: Metric[] = [
  "power", "energyTotal", "energyReturnTotal", "gridInTotal", "gridOutTotal",
  "soc", "voltage", "temperature", "rate", "connected", "info",
];

function emptyField(): SourceField {
  return { metric: "power", jsonPath: "", label: "", unit: "W", valueType: "number" };
}
function emptySource(): SourceConfig {
  return {
    id: "quelle_" + Math.random().toString(36).slice(2, 8),
    label: "Neue Quelle",
    role: "pv",
    url: "http://",
    enabled: true,
    intervalSec: 5,
    timeoutMs: 3000,
    fields: [emptyField()],
  };
}

// Auswahl, welche Datenpunkte einer Geräte-Quelle persistiert werden sollen.
function PersistAuswahl({ sourceId, selected, onChange, hatLeistung, persistPower, onPowerChange }: {
  sourceId: string; selected: string[]; onChange: (labels: string[]) => void;
  hatLeistung: boolean; persistPower: boolean; onPowerChange: (on: boolean) => void;
}) {
  const [labels, setLabels] = useState<string[] | null>(null);
  useEffect(() => {
    fetch(`/api/source/datapoints?sourceId=${encodeURIComponent(sourceId)}`)
      .then((r) => r.json()).then((j) => { if (j.ok) setLabels(j.labels ?? []); })
      .catch(() => setLabels([]));
  }, [sourceId]);
  const toggle = (label: string, on: boolean) => {
    const set = new Set(selected);
    if (on) set.add(label); else set.delete(label);
    onChange([...set]);
  };
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div className="src-fields-head">Datenpunkte aufzeichnen</div>
      <p className="hint" style={{ margin: "2px 0 6px", fontSize: 12 }}>
        Ausgewählte Datenpunkte werden mit Zeitstempel gespeichert (für spätere
        Verläufe). Ohne Auswahl wird nichts aufgezeichnet.
      </p>
      {labels == null ? (
        <span className="hint">lädt …</span>
      ) : labels.length === 0 ? (
        <span className="hint">Noch keine Datenpunkte empfangen. Quelle speichern, kurz warten, dann erscheint die Auswahl.</span>
      ) : (
        <div className="persist-labels">
          {labels.map((l) => (
            <label key={l} className="persist-label">
              <input type="checkbox" checked={selected.includes(l)} onChange={(e) => toggle(l, e.target.checked)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      )}
      {hatLeistung && (
        <label className="persist-label" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={persistPower} onChange={(e) => onPowerChange(e.target.checked)} />
          <span>Hochaufgelöste Energiemessung aufzeichnen (elektrische Leistung der verlinkten Quelle, entkoppelt gespeichert – wie bei der Wärmepumpe)</span>
        </label>
      )}
    </div>
  );
}

export function QuellenPage() {
  const [sources, setSources] = useState<SourceConfig[] | null>(null);
  // Ein-/ausklappbare Quellen-Boxen. Default: alle eingeklappt. Eine Quelle gilt
  // als eingeklappt, solange ihre ID NICHT in diesem Set steht (so sind neu
  // geladene Quellen automatisch zu).
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  function toggleSource(id: string) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Persistente Raumliste (vom Server)
  const [knownRooms, setKnownRooms] = useState<string[]>([]);
  // Verfügbare Lastprofile (eingebaut + hochgeladen) für die §42c-Emulation
  const [profileNames, setProfileNames] = useState<string[]>([]);
  // Verfügbare Erzeugungsprofile (hochgeladen) für die gridEmu-Rolle
  const [genProfileNames, setGenProfileNames] = useState<string[]>([]);
  // Testergebnisse je Quellen-ID
  const [tests, setTests] = useState<
    Record<string, { ok: boolean; error?: string; display?: any[] }>
  >({});

  async function load() {
    try {
      const res = await fetch("/api/sources");
      setSources(await res.json());
    } catch {
      setSources([]);
    }
    try {
      const r = await fetch("/api/rooms");
      setKnownRooms(await r.json());
    } catch {
      setKnownRooms([]);
    }
    try {
      const r = await fetch("/api/profiles");
      const d = await r.json();
      setProfileNames((d.profiles ?? []).map((p: any) => p.name));
    } catch {
      setProfileNames([]);
    }
    try {
      const r = await fetch("/api/genprofiles");
      const d = await r.json();
      setGenProfileNames((d.profiles ?? []).map((p: any) => p.name));
    } catch {
      setGenProfileNames([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Neuen Raum anlegen und serverseitig persistieren.
  async function addRoom(name: string) {
    const next = [...new Set([...knownRooms, name])];
    setKnownRooms(next);
    try {
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms: next }),
      });
    } catch {
      /* ignore */
    }
  }

  function update(id: string, patch: Partial<SourceConfig>) {
    setSources((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : prev
    );
    setSaved(false);
  }
  function updateField(id: string, idx: number, patch: Partial<SourceField>) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  fields: s.fields.map((f, i) =>
                    i === idx ? { ...f, ...patch } : f
                  ),
                }
              : s
          )
        : prev
    );
    setSaved(false);
  }
  function addField(id: string) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id ? { ...s, fields: [...s.fields, emptyField()] } : s
          )
        : prev
    );
  }
  function removeField(id: string, idx: number) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id
              ? { ...s, fields: s.fields.filter((_, i) => i !== idx) }
              : s
          )
        : prev
    );
  }
  function addSource() {
    setSources((prev) => (prev ? [...prev, emptySource()] : [emptySource()]));
  }
  function removeSource(id: string) {
    if (!confirm("Diese Quelle wirklich löschen?")) return;
    setSources((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    setSaved(false);
  }
  function addCorrection(id: string) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  powerCorrections: [
                    ...(s.powerCorrections ?? []),
                    { sourceId: "", sign: "+" as const },
                  ],
                }
              : s
          )
        : prev
    );
    setSaved(false);
  }
  function updateCorrection(
    id: string,
    idx: number,
    patch: Partial<PowerCorrection>
  ) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  powerCorrections: (s.powerCorrections ?? []).map((c, i) =>
                    i === idx ? { ...c, ...patch } : c
                  ),
                }
              : s
          )
        : prev
    );
    setSaved(false);
  }
  function removeCorrection(id: string, idx: number) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  powerCorrections: (s.powerCorrections ?? []).filter(
                    (_, i) => i !== idx
                  ),
                }
              : s
          )
        : prev
    );
    setSaved(false);
  }

  function addExtraLink(id: string) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id ? { ...s, extraLinks: [...(s.extraLinks ?? []), { url: "", label: "" }] } : s
          )
        : prev
    );
    setSaved(false);
  }
  function updateExtraLink(id: string, idx: number, patch: Partial<{ url: string; label: string }>) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id
              ? { ...s, extraLinks: (s.extraLinks ?? []).map((l, i) => (i === idx ? { ...l, ...patch } : l)) }
              : s
          )
        : prev
    );
    setSaved(false);
  }
  function removeExtraLink(id: string, idx: number) {
    setSources((prev) =>
      prev
        ? prev.map((s) =>
            s.id === id ? { ...s, extraLinks: (s.extraLinks ?? []).filter((_, i) => i !== idx) } : s
          )
        : prev
    );
    setSaved(false);
  }

  // Springt zur Konfigurationsbox einer Quelle, klappt sie aus und hebt sie
  // kurz hervor.
  function jumpToSource(id: string) {
    setExpandedSources((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Nach dem Ausklappen (nächster Frame) scrollen/hervorheben.
    window.setTimeout(() => {
      const el = document.getElementById(`src-box-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("src-box-highlight");
      window.setTimeout(() => el.classList.remove("src-box-highlight"), 1600);
    }, 30);
  }

  async function testSource(src: SourceConfig) {
    setTests((t) => ({ ...t, [src.id]: { ok: false, error: "…" } }));
    try {
      const res = await fetch("/api/sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src }),
      });
      const data = await res.json();
      setTests((t) => ({ ...t, [src.id]: data }));
    } catch (e: any) {
      setTests((t) => ({
        ...t,
        [src.id]: { ok: false, error: e?.message ?? "Fehler" },
      }));
    }
  }

  async function saveAll() {
    if (!sources) return;
    setSaveError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d?.ok === false) {
        setSaveError(d?.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setSaveError(e?.message ?? "Speichern fehlgeschlagen.");
    }
  }

  if (sources === null) return <div className="page"><h2>Quellen</h2><p>lädt…</p></div>;

  // Netz-Kernwerte: beliebig viele aktive Netz-Quellen sind erlaubt, aber jeder
  // Kernwert (Leistung, Bezugszähler, Einspeisezähler) darf nur von genau einer
  // aktiven Quelle kommen. Sonst würde er sich in der Bilanz aufsummieren.
  const activeGrids = sources.filter((s) => s.role === "grid" && s.enabled);
  const hasMetric = (s: SourceConfig, m: string) =>
    (s.fields ?? []).some((f) => f.metric === m);
  const gridPowerN = activeGrids.filter((s) => hasMetric(s, "power") || (s as any).powerSourceId).length;
  const gridInN = activeGrids.filter((s) => hasMetric(s, "gridInTotal")).length;
  const gridOutN = activeGrids.filter((s) => hasMetric(s, "gridOutTotal")).length;
  const gridConflict =
    gridPowerN > 1 ? "Leistung (power)" :
    gridInN > 1 ? "Bezugszähler (gridInTotal)" :
    gridOutN > 1 ? "Einspeisezähler (gridOutTotal)" : null;

  // Räume fürs Dropdown: persistente Liste + tatsächlich verwendete, alphabetisch.
  const rooms = [
    ...new Set([
      ...knownRooms,
      ...sources.map((s) => s.room?.trim()).filter((r): r is string => !!r),
    ]),
  ].sort((a, b) => a.localeCompare(b, "de"));

  function chooseRoom(id: string, value: string) {
    if (value === "__new__") {
      const name = prompt("Name des neuen Raums:")?.trim();
      if (name) {
        update(id, { room: name });
        addRoom(name);
      }
    } else {
      update(id, { room: value || undefined });
    }
  }

  return (
    <div className="page">
      <h2>Quellen-Konfiguration</h2>
      <p className="hint">
        Hier definierst du, welche Geräte abgefragt werden, woher (URL) und
        welche Werte per JSON-Pfad gelesen werden. Die Rolle bestimmt, wie eine
        Quelle in die Auswertung einfließt. Mit „Testen" prüfst du, ob URL und
        Pfade stimmen.
      </p>

      {sources.length > 0 && (
        <div className="src-jumplist">
          <div className="src-jumplist-title">
            Schnellauswahl ({sources.length} Quellen) – zum Bearbeiten anklicken:
          </div>
          <div className="src-jumplist-chips">
            {sources.map((src) => (
              <button
                key={src.id}
                type="button"
                className={`src-chip${src.enabled ? "" : " src-chip-off"}`}
                onClick={() => jumpToSource(src.id)}
                title={src.enabled ? src.label : `${src.label} (inaktiv)`}
              >
                <span className="src-chip-icon">
                  {effectiveIcon({ icon: src.icon, deviceType: src.deviceType, role: src.role })}
                </span>
                <span className="src-chip-label">{src.label || "(ohne Namen)"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="src-editor">
        {sources.map((src) => {
          const test = tests[src.id];
          const expanded = expandedSources.has(src.id);
          return (
            <div key={src.id} id={`src-box-${src.id}`} className={`src-box ${src.enabled ? "" : "src-off"} ${expanded ? "" : "src-box-collapsed"}`}>
              <div className="src-row1">
                <button
                  type="button"
                  className="src-collapse-toggle"
                  onClick={() => toggleSource(src.id)}
                  title={expanded ? "Einklappen" : "Ausklappen"}
                  aria-expanded={expanded}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <input
                  className="src-label"
                  value={src.label}
                  onChange={(e) => update(src.id, { label: e.target.value })}
                  placeholder="Bezeichnung"
                />
                <label className="src-enabled">
                  <input
                    type="checkbox"
                    checked={src.enabled}
                    onChange={(e) => update(src.id, { enabled: e.target.checked })}
                  />{" "}
                  aktiv
                </label>
                <button className="src-del" onClick={() => removeSource(src.id)}>
                  löschen
                </button>
              </div>
              <div className="hint" style={{ marginTop: "-4px", marginBottom: "6px", userSelect: "all" }}>
                ID: <code>{src.id}</code> (wird in Logmeldungen verwendet, nicht änderbar)
              </div>

              <div className="src-grid">
                <label>Rolle</label>
                <select
                  value={src.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    const patch: Partial<SourceConfig> = { role };
                    // Beim Wechsel zur Warmwasserspeicher-Rolle zwei Temperatur-
                    // Felder (oben/unten) vorbelegen, falls nicht schon zwei
                    // °C-Felder existieren – so ist sofort klar, was erwartet wird.
                    if (role === "waterTank") {
                      const cFields = (src.fields ?? []).filter((f) => f.unit === "°C");
                      if (cFields.length < 2) {
                        patch.fields = [
                          { metric: "temperature", jsonPath: "", label: "Temperatur oben", unit: "°C" },
                          { metric: "temperature", jsonPath: "", label: "Temperatur unten", unit: "°C" },
                        ];
                      }
                    }
                    update(src.id, patch);
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r.v} value={r.v}>{r.l}</option>
                  ))}
                </select>



                {src.role === "mitsubishiAc" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Mitsubishi Klimaanlage (mitsubishi2MQTT):</b> Zustand und Steuerung laufen
                      über MQTT. Das Steuergerät publiziert auf <code>&lt;Topic&gt;/settings</code> und
                      <code>&lt;Topic&gt;/state</code>; FLUX steuert per <code>&lt;Topic&gt;/…/set</code>.
                      Standardmäßig wird der eingebaute lokale Broker (Port 1883) genutzt.
                    </div>
                    <label>Basis-Topic</label>
                    <input type="text" value={src.geraeteMqttTopic ?? ""} placeholder="z.B. mitsubishi2mqtt oder wohnzimmer_ac"
                      onChange={(e) => update(src.id, { geraeteMqttTopic: e.target.value })} />
                    <label className="mqtt-extern-toggle">
                      <input type="checkbox" checked={!!src.geraeteMqttExtern}
                        onChange={(e) => update(src.id, { geraeteMqttExtern: e.target.checked })} />
                      <span>Externen MQTT-Broker verwenden (statt des eingebauten lokalen)</span>
                    </label>
                    {src.geraeteMqttExtern && (
                      <>
                        <label>Broker-Host</label>
                        <input type="text" value={src.geraeteMqttHost ?? ""} placeholder="z.B. 192.168.178.10"
                          onChange={(e) => update(src.id, { geraeteMqttHost: e.target.value })} />
                        <label>Broker-Port</label>
                        <input type="number" value={src.geraeteMqttPort ?? 1883}
                          onChange={(e) => update(src.id, { geraeteMqttPort: Number(e.target.value) })} />
                      </>
                    )}
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={!!src.powerSourceId} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "accessReader" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Zugangskontrolle (RFID/PIN-Reader):</b> Empfängt gelesene Karten und PINs
                      über MQTT (Topics <code>&lt;Basis&gt;/card</code>, <code>/pin</code>, <code>/status</code>)
                      und sendet Feedback über <code>/cmd</code>. Standardmäßig wird der eingebaute
                      lokale Broker (Port 1883) genutzt. Gültige Tags/PINs und Aktionen werden auf der
                      Seite „Zugangskontrolle" verwaltet.
                    </div>
                    <label>Basis-Topic</label>
                    <input type="text" value={src.readerTopicBase ?? ""} placeholder="z.B. zutritt/reader"
                      onChange={(e) => update(src.id, { readerTopicBase: e.target.value })} />
                    <label className="mqtt-extern-toggle">
                      <input type="checkbox" checked={!!src.geraeteMqttExtern}
                        onChange={(e) => update(src.id, { geraeteMqttExtern: e.target.checked })} />
                      <span>Externen MQTT-Broker verwenden (statt des eingebauten lokalen)</span>
                    </label>
                    {src.geraeteMqttExtern && (
                      <>
                        <label>Broker-Host</label>
                        <input type="text" value={src.geraeteMqttHost ?? ""} placeholder="z.B. 192.168.178.10"
                          onChange={(e) => update(src.id, { geraeteMqttHost: e.target.value })} />
                        <label>Broker-Port</label>
                        <input type="number" value={src.geraeteMqttPort ?? 1883}
                          onChange={(e) => update(src.id, { geraeteMqttPort: Number(e.target.value) })} />
                      </>
                    )}
                  </>
                )}

                {src.role === "evcc" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Elektroauto (evcc):</b> Vollständige Anbindung an eine evcc-Instanz
                      über deren REST-API. Zeigt auf der Seite „Elektroauto" Live-Status
                      (Modus, Ladestand, Verbindung, Limit) mit Steuerung; die Ladehistorie
                      folgt. Trage Host:Port der evcc-Instanz ein.
                    </div>
                    <label>evcc-Host</label>
                    <input type="text" value={src.evccHost ?? ""} placeholder="z.B. 192.168.178.30:7070"
                      onChange={(e) => update(src.id, { evccHost: e.target.value })} />
                    <label>Ladepunkt-Nr.</label>
                    <input type="number" min={1} value={src.evccLoadpoint ?? 1}
                      onChange={(e) => update(src.id, { evccLoadpoint: Number(e.target.value) })} />
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={true} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "entsoe" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>ENTSO-E REST API:</b> Liefert die CO₂-Intensität des deutschen
                      Netzstroms (aus dem Strommix) für die CO₂-Bilanz im Energie-Rückblick.
                      Token kostenlos: Konto auf transparency.entsoe.eu anlegen, per E-Mail
                      an transparency@entsoe.eu (Betreff „Restful API access") freischalten
                      lassen, dann unter „My Account Settings" erzeugen. Nach dem Eintragen
                      wächst die echte CO₂-Bilanz; die Vergangenheit lässt sich im Rückblick
                      nachladen.
                    </div>
                    <label>ENTSO-E Security-Token</label>
                    <input type="text" value={src.entsoeToken ?? ""} placeholder="Security-Token"
                      onChange={(e) => update(src.id, { entsoeToken: e.target.value })} />
                    <div style={{ gridColumn: "1 / -1" }}>
                      <EntsoeStatus hatToken={!!(src.entsoeToken && src.entsoeToken.trim())} />
                    </div>
                  </>
                )}

                {src.role === "airSensor" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Luftsensor:</b> Liest Feinstaub (PM2.5/PM10), Temperatur und Luftdruck über
                      die lokale HTTP-API (<code>/api/data</code>, <code>/api/status</code>). Die Werte
                      erscheinen auf der Statusseite und sind in Regel-Bedingungen nutzbar.
                    </div>
                    <label>Host/IP</label>
                    <input type="text" value={src.airHost ?? ""} placeholder="z.B. 192.168.178.90"
                      onChange={(e) => update(src.id, { airHost: e.target.value })} />
                    <div style={{ gridColumn: "1 / -1" }} className="src-field-actions">
                      <button onClick={() => testSource(src)}>Verbindung testen</button>
                      {tests[src.id] && !tests[src.id].ok && <span className="src-testerr">Fehler: {tests[src.id].error}</span>}
                      {tests[src.id] && tests[src.id].ok && <span className="src-testok">✓ erreichbar</span>}
                    </div>
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={!!src.powerSourceId} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "prusa" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Prusa 3D-Drucker (PrusaLink):</b> Liest über die lokale PrusaLink-API
                      Druckauftrag, Telemetrie und Status. Für die Energiemessung kann unten unter
                      „Leistung von separater Quelle" der zugehörige Shelly verlinkt werden.
                    </div>
                    <label>Host/IP</label>
                    <input type="text" value={src.prusaHost ?? ""} placeholder="z.B. 192.168.178.80"
                      onChange={(e) => update(src.id, { prusaHost: e.target.value })} />
                    <label>Authentifizierung</label>
                    <select value={src.prusaAuth ?? "digest"} onChange={(e) => update(src.id, { prusaAuth: e.target.value as "apikey" | "digest" })}>
                      <option value="digest">Benutzer + Passwort (Digest)</option>
                      <option value="apikey">API-Key (X-Api-Key)</option>
                    </select>
                    {(src.prusaAuth ?? "digest") === "digest" ? (
                      <>
                        <label>Benutzer</label>
                        <input type="text" value={src.prusaUser ?? "maker"} placeholder="maker" autoComplete="off"
                          onChange={(e) => update(src.id, { prusaUser: e.target.value })} />
                        <label>Passwort</label>
                        <input type="password" value={src.prusaPass ?? ""} autoComplete="new-password"
                          onChange={(e) => update(src.id, { prusaPass: e.target.value })} />
                      </>
                    ) : (
                      <>
                        <label>API-Key</label>
                        <input type="password" value={src.prusaApiKey ?? ""} autoComplete="new-password"
                          onChange={(e) => update(src.id, { prusaApiKey: e.target.value })} />
                      </>
                    )}
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      Der Benutzer ist bei neueren Druckern <code>maker</code>, das Passwort bzw. der
                      API-Key steht in den PrusaLink-Einstellungen (bzw. in Prusa Connect).
                    </div>
                    <div style={{ gridColumn: "1 / -1" }} className="src-field-actions">
                      <button onClick={() => testSource(src)}>Verbindung testen</button>
                      {tests[src.id] && !tests[src.id].ok && <span className="src-testerr">Fehler: {tests[src.id].error}</span>}
                      {tests[src.id] && tests[src.id].ok && <span className="src-testok">✓ erreichbar</span>}
                    </div>
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={!!src.powerSourceId} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "vallox" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Vallox Lüftungsanlage (valloxesp):</b> Zustand und Steuerung laufen über MQTT.
                      Das Steuergerät publiziert auf <code>&lt;Topic&gt;/state</code> und
                      <code>&lt;Topic&gt;/temp</code>; FLUX steuert per <code>&lt;Topic&gt;/set</code>.
                      Standardmäßig wird der eingebaute lokale Broker (Port 1883) genutzt.
                    </div>
                    <label>Basis-Topic</label>
                    <input type="text" value={src.geraeteMqttTopic ?? ""} placeholder="z.B. vallox"
                      onChange={(e) => update(src.id, { geraeteMqttTopic: e.target.value })} />
                    <label className="mqtt-extern-toggle">
                      <input type="checkbox" checked={!!src.geraeteMqttExtern}
                        onChange={(e) => update(src.id, { geraeteMqttExtern: e.target.checked })} />
                      <span>Externen MQTT-Broker verwenden (statt des eingebauten lokalen)</span>
                    </label>
                    {src.geraeteMqttExtern && (
                      <>
                        <label>Broker-Host</label>
                        <input type="text" value={src.geraeteMqttHost ?? ""} placeholder="z.B. 192.168.178.10"
                          onChange={(e) => update(src.id, { geraeteMqttHost: e.target.value })} />
                        <label>Broker-Port</label>
                        <input type="number" value={src.geraeteMqttPort ?? 1883}
                          onChange={(e) => update(src.id, { geraeteMqttPort: Number(e.target.value) })} />
                      </>
                    )}
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={!!src.powerSourceId} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "securitySpy" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>SecuritySpy:</b> Bindet die Überwachungssoftware ein und liest die
                      Kameraliste über die Web-API. Sobald eine solche Quelle existiert, erscheint
                      im Menü eine Kameraseite mit den Live-Bildern. Voraussetzung: In SecuritySpy
                      unter Einstellungen → Web den HTTP-Webserver aktivieren und Port notieren.
                    </div>
                    <label>Host/IP</label>
                    <input type="text" value={src.ssHost ?? ""} placeholder="z.B. 192.168.178.85"
                      onChange={(e) => update(src.id, { ssHost: e.target.value })} />
                    <label>Port</label>
                    <input type="number" value={src.ssPort ?? 8000}
                      onChange={(e) => update(src.id, { ssPort: Number(e.target.value) })} />
                    <label>Benutzer</label>
                    <input type="text" value={src.ssUser ?? ""} autoComplete="off"
                      onChange={(e) => update(src.id, { ssUser: e.target.value })} />
                    <label>Passwort</label>
                    <input type="password" value={src.ssPass ?? ""} autoComplete="new-password"
                      onChange={(e) => update(src.id, { ssPass: e.target.value })} />
                  </>
                )}

                {src.role === "ccuHub" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Homematic-Hub:</b> Bindet eine Homematic-Zentrale als eine Quelle ein und
                      führt alle Geräte/Kanäle als Untergeräte. Zwei Zentralen-Typen werden
                      unterschieden.
                    </div>
                    <label>Zentralen-Typ</label>
                    <select value={src.hubTyp ?? "ccu3"} onChange={(e) => update(src.id, { hubTyp: e.target.value as "ccu3" | "hcu" })}>
                      <option value="ccu3">CCU3 (XML-API)</option>
                      <option value="hcu">HCU (Home Control Unit)</option>
                    </select>
                    {(src.hubTyp ?? "ccu3") === "ccu3" && (
                      <div style={{ gridColumn: "1 / -1" }} className="hint">
                        Voraussetzung: Das XML-API-Addon (jens-maus/XML-API) muss auf der CCU3
                        installiert sein (siehe Hilfe). FLUX bleibt vollständig lokal, ohne Cloud.
                      </div>
                    )}
                    {src.hubTyp === "hcu" && (
                      <>
                        <div style={{ gridColumn: "1 / -1" }} className="hint">
                          HCU-Anbindung über die lokale API. <b>Hinweis:</b> Diese ist gegen die
                          dokumentierte Homematic-IP-Struktur gebaut, aber noch nicht an echter
                          Hardware getestet – beim ersten Einsatz sind eventuell Anpassungen nötig.
                          Auth-Token und SGTIN erzeugst du per Knopfdruck an der HCU (siehe Hilfe).
                        </div>
                        <label>Auth-Token</label>
                        <input type="text" value={src.hcuAuthToken ?? ""} placeholder="per Knopfdruck erzeugt"
                          onChange={(e) => update(src.id, { hcuAuthToken: e.target.value })} />
                        <label>SGTIN (Geräte-ID)</label>
                        <input type="text" value={src.hcuSgtin ?? ""} placeholder="3014-xxxx-xxxx-... (ohne Bindestriche)"
                          onChange={(e) => update(src.id, { hcuSgtin: e.target.value })} />
                      </>
                    )}
                    <label>Host/IP</label>
                    <input type="text" value={src.ccuHost ?? ""} placeholder="z.B. 192.168.178.50"
                      onChange={(e) => update(src.id, { ccuHost: e.target.value })} />
                    <label>Port (Standard 80)</label>
                    <input type="number" value={src.ccuPort ?? 80}
                      onChange={(e) => update(src.id, { ccuPort: Number(e.target.value) })} />
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={!!src.powerSourceId} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "hueBridge" && (
                  <>
                    <div style={{ gridColumn: "1 / -1" }} className="hint">
                      <b>Philips Hue Bridge:</b> Ein Poll liest alle Leuchten und Sensoren der Bridge ein
                      und führt sie als Untergeräte. Die Verwaltung der Geräte bleibt in der Hue-App;
                      FLUX hält die Liste synchron. Der Application-Key wird einmalig durch Knopfdruck an
                      der Bridge erzeugt (siehe Hilfe).
                    </div>
                    <label>Bridge-Host/IP</label>
                    <input type="text" value={src.hueBridgeHost ?? ""} placeholder="z.B. 192.168.178.40"
                      onChange={(e) => update(src.id, { hueBridgeHost: e.target.value })} />
                    <label>Application-Key</label>
                    <input type="text" value={src.hueAppKey ?? ""} placeholder="hue-application-key"
                      onChange={(e) => update(src.id, { hueAppKey: e.target.value })} />
                    <PersistAuswahl sourceId={src.id} selected={src.persistLabels ?? []} onChange={(labels) => update(src.id, { persistLabels: labels })} hatLeistung={!!src.powerSourceId} persistPower={!!src.persistPower} onPowerChange={(on) => update(src.id, { persistPower: on })} />
                  </>
                )}

                {src.role === "batteryOut" && (
                  <div style={{ gridColumn: "1 / -1" }} className="hint">
                    <b>Batterie-Einspeisung (Entladung):</b> Diese Rolle unterstützt zwei Arten von Zählern.
                    {" "}<b>(1) Rein einspeisend</b> – ein älterer Shelly, der die Leistung immer positiv
                    liefert und nur einen Energiezähler hat (Feld <code>power</code> und ein Feld
                    {" "}<code>energyTotal</code>). Die gesamte gemessene Energie gilt als Einspeisung ins Haus/Netz.
                    {" "}<b>(2) Bidirektional</b> – ein neuerer Shelly mit vorzeichenbehafteter Leistung
                    (<code>power</code> negativ = Einspeisung, positiv = Standby-Eigenverbrauch des Speichers)
                    und zwei Zählern: <code>energyTotal</code> (aenergy = Gesamtenergie beider Richtungen)
                    und <code>energyReturnTotal</code> (ret_aenergy = nur Einspeisung). In diesem Fall wird
                    nur die Rückrichtung als Einspeisung gewertet; der Standby-Eigenverbrauch zählt als
                    normaler Hausverbrauch. Die richtige Variante wird automatisch daran erkannt, ob ein
                    Feld <code>energyReturnTotal</code> konfiguriert ist.
                  </div>
                )}

                {!isEmuRole(src.role) && src.role !== "dcBattery" && src.role !== "hueBridge" && src.role !== "ccuHub" && src.role !== "securitySpy" && src.role !== "mitsubishiAc" && src.role !== "vallox" && src.role !== "prusa" && src.role !== "airSensor" && src.role !== "accessReader" && src.role !== "evcc" && src.role !== "entsoe" && (
                  <>
                    {(() => {
                      // Effektive Anbindung bestimmen. Abwärtskompatibel: ältere
                      // acBattery-Marstek-Quellen ohne connection-Feld gelten als "udp".
                      const isAcBat = src.role === "acBattery";
                      const conn = src.connection ?? (isAcBat && (src.acModel ?? "marstek-venus") === "marstek-venus" ? "udp" : "rest");
                      return (
                        <>
                          <label>Anbindung</label>
                          <select
                            value={conn}
                            onChange={(e) => update(src.id, { connection: e.target.value as any })}
                          >
                            <option value="rest">REST-API (HTTP, JSON)</option>
                            <option value="mqtt">MQTT</option>
                            <option value="udp">UDP (lokale API)</option>
                            <option value="modbus">Modbus TCP</option>
                          </select>

                          {conn === "udp" && (
                            <>
                              <label>Speichermodell</label>
                              <select
                                value={src.acModel ?? "marstek-venus"}
                                onChange={(e) => update(src.id, { acModel: e.target.value })}
                              >
                                <option value="marstek-venus">Marstek Venus C/D/E via Lokale API</option>
                              </select>
                              <label>IP-Adresse des Speichers</label>
                              <input
                                value={src.url}
                                onChange={(e) => update(src.id, { url: e.target.value })}
                                placeholder="192.168.x.x"
                              />
                              <label>UDP-Port</label>
                              <input
                                type="number"
                                value={src.acUdpPort ?? 30000}
                                onChange={(e) => update(src.id, { acUdpPort: Number(e.target.value) })}
                              />
                            </>
                          )}

                          {conn === "modbus" && (
                            <>
                              <label>Speichermodell</label>
                              <select
                                value={src.modbusModel ?? "venus-v3"}
                                onChange={(e) => update(src.id, { modbusModel: e.target.value })}
                              >
                                <option value="venus-v3">Marstek Venus A / D / E (Gen 3)</option>
                                <option value="venus-e-v12">Marstek Venus E (Gen 1/2)</option>
                                <option value="anker-m1">Anker Solix (Max AC / Solarbank 4)</option>
                              </select>
                              <label>IP-Adresse / Host</label>
                              <input
                                value={src.url}
                                onChange={(e) => update(src.id, { url: e.target.value })}
                                placeholder="192.168.x.x"
                              />
                              <label>Modbus-Port</label>
                              <input
                                type="number"
                                value={src.modbusPort ?? 502}
                                onChange={(e) => update(src.id, { modbusPort: Number(e.target.value) })}
                              />
                              <label>Unit-/Slave-ID</label>
                              <input
                                type="number"
                                value={src.modbusUnitId ?? 1}
                                onChange={(e) => update(src.id, { modbusUnitId: Number(e.target.value) })}
                              />
                              <p className="src-hint">
                                Marstek stellt Modbus TCP je nach Modell/Firmware
                                nativ (Port 502) oder über einen RS485-zu-WLAN-Adapter
                                bereit. Es werden Leistung, Ladezustand, Spannung,
                                Strom, Temperatur und Energiezähler gelesen. Für
                                Venus E gelten die Register der Generation 3.
                              </p>
                            </>
                          )}

                          {conn === "rest" && (
                          <>
                            <label>URL</label>
                            <input
                              value={src.url}
                              onChange={(e) => update(src.id, { url: e.target.value })}
                              placeholder="http://192.168.x.x/status"
                            />
                            <label>Authentifizierung</label>
                            <select
                              value={src.authType ?? "none"}
                              onChange={(e) => update(src.id, { authType: e.target.value as "none" | "bearer" })}
                            >
                              <option value="none">Keine (lokales Netz)</option>
                              <option value="bearer">Bearer-Token</option>
                            </select>
                            {(src.authType ?? "none") === "bearer" && (
                              <>
                                <label>Bearer-Token</label>
                                <input
                                  type="password"
                                  value={src.bearerToken ?? ""}
                                  onChange={(e) => update(src.id, { bearerToken: e.target.value })}
                                  placeholder="Token"
                                  autoComplete="off"
                                />
                              </>
                            )}
                          </>
                        )}
                        {conn === "mqtt" && (
                          <>
                            <label>Broker-URL</label>
                            <input
                              value={src.mqttUrl ?? ""}
                              onChange={(e) => update(src.id, { mqttUrl: e.target.value })}
                              placeholder="mqtt://192.168.x.x:1883  (oder mqtts://)"
                            />
                            <label>Topic</label>
                            <input
                              value={src.mqttTopic ?? ""}
                              onChange={(e) => update(src.id, { mqttTopic: e.target.value })}
                              placeholder="z. B. tele/gerät/SENSOR"
                            />
                            <label>Authentifizierung</label>
                            <select
                              value={src.mqttAuthType ?? "none"}
                              onChange={(e) => update(src.id, { mqttAuthType: e.target.value as "none" | "userpass" | "clientcert" })}
                            >
                              <option value="none">Keine (anonym)</option>
                              <option value="userpass">Benutzername + Passwort</option>
                              <option value="clientcert">TLS-Client-Zertifikat</option>
                            </select>
                            {(src.mqttAuthType ?? "none") === "userpass" && (
                              <>
                                <label>Benutzername</label>
                                <input
                                  value={src.mqttUsername ?? ""}
                                  onChange={(e) => update(src.id, { mqttUsername: e.target.value })}
                                  autoComplete="off"
                                />
                                <label>Passwort</label>
                                <input
                                  type="password"
                                  value={src.mqttPassword ?? ""}
                                  onChange={(e) => update(src.id, { mqttPassword: e.target.value })}
                                  autoComplete="off"
                                />
                              </>
                            )}
                            {(src.mqttAuthType ?? "none") === "clientcert" && (
                              <>
                                <label className="src-label-full">Client-Zertifikat (PEM)</label>
                                <textarea
                                  className="src-cert"
                                  value={src.mqttClientCert ?? ""}
                                  onChange={(e) => update(src.id, { mqttClientCert: e.target.value })}
                                  placeholder="-----BEGIN CERTIFICATE-----"
                                  rows={3}
                                />
                                <label className="src-label-full">Privater Schlüssel (PEM)</label>
                                <textarea
                                  className="src-cert"
                                  value={src.mqttClientKey ?? ""}
                                  onChange={(e) => update(src.id, { mqttClientKey: e.target.value })}
                                  placeholder="-----BEGIN PRIVATE KEY-----"
                                  rows={3}
                                />
                              </>
                            )}
                            {(src.mqttAuthType ?? "none") !== "none" && (
                              <>
                                <label className="src-label-full">CA-Zertifikat (PEM, optional)</label>
                                <textarea
                                  className="src-cert"
                                  value={src.mqttCaCert ?? ""}
                                  onChange={(e) => update(src.id, { mqttCaCert: e.target.value })}
                                  placeholder="Nur bei selbstsigniertem Broker nötig"
                                  rows={2}
                                />
                                <label className="src-check-full">
                                  <input
                                    type="checkbox"
                                    checked={src.mqttRejectUnauthorized !== false}
                                    onChange={(e) => update(src.id, { mqttRejectUnauthorized: e.target.checked })}
                                  />
                                  <span>TLS-Zertifikat des Brokers prüfen</span>
                                </label>
                              </>
                            )}
                            <p className="src-hint">
                              Bei MQTT wird die zuletzt empfangene JSON-Nachricht
                              ausgewertet. Die Feld-Pfade unten beziehen sich auf
                              diese Nachricht (wie bei REST). Werte nur mit einer
                              Zahl im Topic sind über den Pfad <code>value</code>
                              erreichbar.
                            </p>
                            {isAcBat && (
                              <>
                                <label>Speicher-Steuerung</label>
                                <select
                                  value={src.acModel === "zendure" ? "zendure" : "none"}
                                  onChange={(e) => update(src.id, { acModel: e.target.value === "zendure" ? "zendure" : "" })}
                                >
                                  <option value="none">Nur Monitoring (keine Steuerung)</option>
                                  <option value="zendure">Zendure SolarFlow (Steuerung per MQTT)</option>
                                </select>
                                {src.acModel === "zendure" && (
                                  <>
                                    <label>Zendure App-Key</label>
                                    <input
                                      value={src.zendureAppKey ?? ""}
                                      onChange={(e) => update(src.id, { zendureAppKey: e.target.value })}
                                      placeholder="aus der Zendure-App / Developer-Portal"
                                      autoComplete="off"
                                    />
                                    <label>Seriennummer</label>
                                    <input
                                      value={src.zendureSerial ?? ""}
                                      onChange={(e) => update(src.id, { zendureSerial: e.target.value })}
                                      placeholder="Geräte-Seriennummer"
                                      autoComplete="off"
                                    />
                                    <label>Max. Ladeleistung (W)</label>
                                    <input
                                      type="number"
                                      value={src.zendureMaxChargeW ?? 800}
                                      onChange={(e) => update(src.id, { zendureMaxChargeW: Number(e.target.value) })}
                                    />
                                    <label>Max. Entladeleistung (W)</label>
                                    <input
                                      type="number"
                                      value={src.zendureMaxDischargeW ?? 800}
                                      onChange={(e) => update(src.id, { zendureMaxDischargeW: Number(e.target.value) })}
                                    />
                                    <p className="src-hint">
                                      Die Steuerung sendet MQTT-Properties
                                      (acMode/outputLimit/inputLimit) an das Topic
                                      <code>iot/&lt;AppKey&gt;/&lt;Serial&gt;/properties/write</code>.
                                      Voraussetzung ist, dass der Zendure-Speicher
                                      mit demselben lokalen Broker verbunden ist.
                                    </p>
                                  </>
                                )}
                              </>
                            )}
                          </>
                        )}
                        </>
                      );
                    })()}
                  </>
                )}

                {src.role === "grid42cEmu" && (
                  <>
                    <label>Lastprofil</label>
                    <select
                      value={src.emuProfile ?? "H25"}
                      onChange={(e) => update(src.id, { emuProfile: e.target.value })}
                    >
                      {profileNames.map((name) => (
                        <option key={name} value={name}>
                          {profileLabel(name)}
                        </option>
                      ))}
                    </select>

                    <label>Jahresverbrauch (kWh/a)</label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={src.jahresverbrauch ?? 3500}
                      onChange={(e) =>
                        update(src.id, { jahresverbrauch: Number(e.target.value) })
                      }
                    />
                  </>
                )}

                {src.role === "gridEmu" && (
                  <>
                    <label>Lastprofil</label>
                    <select
                      value={src.emuProfile ?? "H25"}
                      onChange={(e) => update(src.id, { emuProfile: e.target.value })}
                    >
                      {profileNames.map((name) => (
                        <option key={name} value={name}>
                          {profileLabel(name)}
                        </option>
                      ))}
                    </select>

                    <label>Jahresverbrauch (kWh/a)</label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={src.jahresverbrauch ?? 3500}
                      onChange={(e) =>
                        update(src.id, { jahresverbrauch: Number(e.target.value) })
                      }
                    />

                    <label>Erzeugungsprofil</label>
                    <select
                      value={src.erzeugungsProfile ?? ""}
                      onChange={(e) =>
                        update(src.id, { erzeugungsProfile: e.target.value || undefined })
                      }
                    >
                      <option value="">— kein Erzeugungsprofil —</option>
                      {genProfileNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    <label>PV-Anlagengröße (kWp)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={src.kwp ?? 0}
                      onChange={(e) => update(src.id, { kwp: Number(e.target.value) })}
                    />
                  </>
                )}

                {src.role === "pv" && (
                  <>
                    <label>PV-Ziel</label>
                    <select
                      value={src.pvTarget ?? "ac"}
                      onChange={(e) =>
                        update(src.id, { pvTarget: e.target.value as "ac" | "dc" })
                      }
                    >
                      <option value="ac">ins Hausnetz (AC)</option>
                      <option value="dc">in die Batterie (DC)</option>
                    </select>
                    <label>Energie-Ermittlung</label>
                    <select
                      value={src.energySource ?? "counter"}
                      onChange={(e) =>
                        update(src.id, { energySource: e.target.value as "counter" | "integrated" })
                      }
                    >
                      <option value="counter">Zählerstände (exakt, Standard)</option>
                      <option value="integrated">Leistung integrieren (glättet grobe Zähler)</option>
                    </select>
                    <p className="hint" style={{ gridColumn: "1 / -1", margin: "2px 0 6px" }}>
                      Standard sind die Zählerstände. Bei Wechselrichtern mit grober
                      Energieauflösung (z.&nbsp;B. Growatt in 0,1-kWh-Schritten) entstehen
                      dadurch einzelne Viertelstunden ohne Beitrag. „Leistung integrieren"
                      bildet den Viertelstundenwert stattdessen aus der (feinen)
                      Momentanleistung – gleichmäßiger, aber abhängig vom Abfragetakt.
                    </p>
                  </>
                )}

                {src.role === "consumer" && (
                  <>
                    <label>Gerätetyp</label>
                    <select
                      value={src.deviceType ?? "generic"}
                      onChange={(e) =>
                        update(src.id, { deviceType: e.target.value })
                      }
                    >
                      {DEVICE_TYPES.map((d) => (
                        <option key={d.v} value={d.v}>{d.l}</option>
                      ))}
                    </select>

                    <label>Raum</label>
                    <select
                      value={src.room ?? ""}
                      onChange={(e) => chooseRoom(src.id, e.target.value)}
                    >
                      <option value="">— Ohne Raum —</option>
                      {rooms.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      {/* aktueller Raum, falls (noch) nicht in der Liste */}
                      {src.room && !rooms.includes(src.room) && (
                        <option value={src.room}>{src.room}</option>
                      )}
                      <option value="__new__">+ neuer Raum…</option>
                    </select>
                  </>
                )}
                {src.role === "batteryIn" && (
                  <>
                    <label>Raum</label>
                    <select
                      value={src.room ?? ""}
                      onChange={(e) => chooseRoom(src.id, e.target.value)}
                    >
                      <option value="">— Ohne Raum —</option>
                      {rooms.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      {src.room && !rooms.includes(src.room) && (
                        <option value={src.room}>{src.room}</option>
                      )}
                      <option value="__new__">+ neuer Raum…</option>
                    </select>
                  </>
                )}
                {src.role === "acBattery" && (
                  <>
                    <label>Raum</label>
                    <select
                      value={src.room ?? ""}
                      onChange={(e) => chooseRoom(src.id, e.target.value)}
                    >
                      <option value="">— Ohne Raum —</option>
                      {rooms.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      {src.room && !rooms.includes(src.room) && (
                        <option value={src.room}>{src.room}</option>
                      )}
                      <option value="__new__">+ neuer Raum…</option>
                    </select>
                  </>
                )}
                {src.role === "batteryOut" && (
                  <>
                    <label>Raum</label>
                    <select
                      value={src.room ?? ""}
                      onChange={(e) => chooseRoom(src.id, e.target.value)}
                    >
                      <option value="">— Ohne Raum —</option>
                      {rooms.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      {src.room && !rooms.includes(src.room) && (
                        <option value={src.room}>{src.room}</option>
                      )}
                      <option value="__new__">+ neuer Raum…</option>
                    </select>
                  </>
                )}
              </div>

              {/* Einheitlich über alle Rollen: Icon (volle Breite, einzeilig)
                  sowie Intervall/Timeout in fester Anordnung. */}
              <div className="src-fixed">
                <div className="src-fixed-row">
                  <label>Icon</label>
                  <IconPicker
                    value={src.icon ?? ""}
                    onChange={(icon) => update(src.id, { icon })}
                    defaultIcon={effectiveIcon({
                      role: src.role,
                      deviceType: src.deviceType,
                    })}
                  />
                </div>
                {src.role !== "dcBattery" && src.role !== "entsoe" && (
                <div className="src-fixed-times">
                  <div className="src-time-field">
                    <label>Intervall (s)</label>
                    <input
                      type="number"
                      min={2}
                      value={src.intervalSec}
                      onChange={(e) =>
                        update(src.id, { intervalSec: Number(e.target.value) })
                      }
                    />
                  </div>
                  {!isEmuRole(src.role) && (
                    <div className="src-time-field">
                      <label>Timeout (ms)</label>
                      <input
                        type="number"
                        min={200}
                        step={100}
                        value={src.timeoutMs}
                        onChange={(e) =>
                          update(src.id, { timeoutMs: Number(e.target.value) })
                        }
                      />
                    </div>
                  )}
                </div>
                )}
              </div>

              {src.role === "grid42cEmu" && (
                <div className="src-hint-h25">
                  <strong>Simulator angebunden:</strong> Für diese Rolle werden
                  keine URL und keine Felder abgefragt. Stattdessen speist ein
                  Simulator das oben gewählte BDEW-Standardlastprofil
                  (H25/G25/L25/P25/S25) ein – abhängig vom aktuellen Tagestyp
                  (Werktag / Samstag / Sonn- und Feiertag) und Monat. Das Profil
                  wird auf den eingegebenen Jahresverbrauch skaliert und liefert
                  den durchschnittlichen Bezug je Viertelstunde.
                </div>
              )}

              {src.role === "acBattery" && (src.connection ?? ((src.acModel ?? "marstek-venus") === "marstek-venus" ? "udp" : "rest")) === "udp" && (
                <div className="src-fields">
                  <div className="src-fields-head">Datenfelder</div>
                  <p className="hint" style={{ margin: "4px 0 0" }}>
                    Für Marstek-Speicher werden alle verfügbaren Werte (SoC,
                    Temperatur, Leistung, Kapazität, Betriebsmodus, Geräteinfo …)
                    automatisch über die lokale API des Speichers abgefragt und
                    auf der Statusseite angezeigt. Es müssen keine JSON-Pfade
                    konfiguriert werden.
                  </p>
                </div>
              )}
              {src.role === "acBattery" && src.connection === "modbus" && (
                <div className="src-fields">
                  <div className="src-fields-head">Datenfelder</div>
                  <p className="hint" style={{ margin: "4px 0 0" }}>
                    Über Modbus TCP werden Leistung, Ladezustand, Spannung, Strom,
                    Temperatur und die Energiezähler automatisch aus den bekannten
                    Registern des gewählten Modells gelesen. Es müssen keine
                    JSON-Pfade konfiguriert werden.
                  </p>
                </div>
              )}
              {src.role === "acBattery" && (src.connection === "rest" || src.connection === "mqtt") && (
                <p className="hint" style={{ margin: "4px 0 8px" }}>
                  Generischer AC-Speicher: Die Leistung wird wie bei einem
                  Verbraucher über die unten konfigurierten Felder ausgelesen
                  (Feld „Leistung"). <strong>Konvention:</strong> negative Werte =
                  Einspeisung ins Haus/Netz, positive Werte = Netzladung des
                  Speichers. Beide Energiemengen werden getrennt erfasst.
                </p>
              )}

              {src.role === "waterTank" && (
                <p className="hint" style={{ margin: "4px 0 8px" }}>
                  Warmwasserspeicher: Trage unten genau zwei Temperatur-Felder
                  ein – das erste ist die <strong>obere</strong>, das zweite die{" "}
                  <strong>untere</strong> Speichertemperatur (jeweils Einheit
                  „°C"). Diese beiden Werte werden auf der Übersichtsseite am
                  Warmwasserspeicher angezeigt. Ohne eine Quelle dieser Rolle
                  erscheinen dort keine Speichertemperaturen.
                </p>
              )}

              {src.role === "dcBattery" && (
                <div className="src-fields">
                  <div className="src-fields-head">DC-Speicher: verknüpfte Quellen</div>
                  <p className="hint" style={{ margin: "4px 0 10px" }}>
                    Ein DC-Speicher hat keine eigene Messung – die Werte stammen aus
                    den verknüpften Quellen. Wähle optional die PV-Quelle
                    (Ladung/DC-PV), die Batterie-Einspeisung (Entladung) und ein
                    zugehöriges AC-Ladegerät. Ist eine dieser Quellen schaltbar,
                    erscheint ihr Schalter automatisch auf der Speicher-Seite.
                  </p>
                  <label className="src-inline-label">PV-Quelle (Ladung):
                    <select value={src.dcLinkedPv ?? ""} onChange={(e) => update(src.id, { dcLinkedPv: e.target.value || undefined })}>
                      <option value="">– keine –</option>
                      {sources.filter((s) => s.role === "pv").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="src-inline-label">Batterie-Einspeisung (Entladung):
                    <select value={src.dcLinkedBatteryOut ?? ""} onChange={(e) => update(src.id, { dcLinkedBatteryOut: e.target.value || undefined })}>
                      <option value="">– keine –</option>
                      {sources.filter((s) => s.role === "batteryOut").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="src-inline-label">AC-Ladegerät:
                    <select value={src.dcLinkedCharger ?? ""} onChange={(e) => update(src.id, { dcLinkedCharger: e.target.value || undefined })}>
                      <option value="">– keins –</option>
                      {sources.filter((s) => s.role === "batteryIn").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {!isEmuRole(src.role) && src.role !== "dcBattery" && src.role !== "hueBridge" && src.role !== "ccuHub" && src.role !== "securitySpy" && src.role !== "mitsubishiAc" && src.role !== "vallox" && src.role !== "prusa" && src.role !== "airSensor" && src.role !== "accessReader" && src.role !== "evcc" && src.role !== "entsoe" && !(src.role === "acBattery" && ((src.connection ?? ((src.acModel ?? "marstek-venus") === "marstek-venus" ? "udp" : "rest")) === "udp" || src.connection === "modbus")) && (
              <div className="src-fields">
                <div className="src-fields-head">Felder (JSON-Pfade)</div>
                <div className="table-scroll">
                <table className="src-field-table">
                  <colgroup>
                    <col className="c-metric" />
                    <col className="c-path" />
                    <col className="c-label" />
                    <col className="c-unit" />
                    <col className="c-type" />
                    <col className="c-factor" />
                    <col className="c-act" />
                  </colgroup>
                  <tbody>
                    <tr>
                      <th>Größe</th>
                      <th>JSON-Pfad</th>
                      <th>Label</th>
                      <th>Einh.</th>
                      <th>Typ</th>
                      <th>Faktor</th>
                      <th></th>
                    </tr>
                    {src.fields.map((f, idx) => {
                      const tv = test?.display?.find((d) => d.label === f.label);
                      return (
                        <tr key={idx}>
                          <td>
                            <select
                              value={f.metric}
                              onChange={(e) =>
                                updateField(src.id, idx, {
                                  metric: e.target.value as Metric,
                                })
                              }
                            >
                              {METRICS.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={f.jsonPath}
                              onChange={(e) =>
                                updateField(src.id, idx, { jsonPath: e.target.value })
                              }
                              placeholder="z.B. total.Power.v"
                            />
                          </td>
                          <td>
                            <input
                              value={f.label}
                              onChange={(e) =>
                                updateField(src.id, idx, { label: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={f.unit}
                              onChange={(e) =>
                                updateField(src.id, idx, { unit: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <select
                              value={f.valueType ?? "number"}
                              onChange={(e) =>
                                updateField(src.id, idx, {
                                  valueType: e.target.value as
                                    | "number" | "bool" | "string",
                                })
                              }
                            >
                              {VALUE_TYPES.map((t) => (
                                <option key={t.v} value={t.v}>{t.l}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={f.scale ?? ""}
                              onChange={(e) =>
                                updateField(src.id, idx, {
                                  scale: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                              placeholder="1"
                            />
                          </td>
                          <td>
                            {tv && (
                              <span className="src-testval">= {tv.value} {tv.unit}</span>
                            )}
                            <button
                              className="src-fdel"
                              onClick={() => removeField(src.id, idx)}
                              title="Feld löschen"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <div className="src-field-actions">
                  <button onClick={() => addField(src.id)}>+ Feld</button>
                  <button onClick={() => testSource(src)}>Testen</button>
                  {test && !test.ok && (
                    <span className="src-testerr">Fehler: {test.error}</span>
                  )}
                  {test && test.ok && (
                    <span className="src-testok">✓ erreichbar</span>
                  )}
                </div>

                {src.role === "consumer" && (
                  <div className="src-corrections">
                    <div className="src-fields-head">
                      Leistungs-Korrekturen (virtueller Verbraucher)
                    </div>
                    {(src.powerCorrections ?? []).length === 0 && (
                      <div className="src-corr-empty">
                        keine – echte Leistung = gemessene Leistung
                      </div>
                    )}
                    {(src.powerCorrections ?? []).map((c, idx) => (
                      <div key={idx} className="src-corr-row">
                        <select
                          value={c.sign}
                          onChange={(e) =>
                            updateCorrection(src.id, idx, {
                              sign: e.target.value as "+" | "-",
                            })
                          }
                        >
                          <option value="+">+ addiere</option>
                          <option value="-">− subtrahiere</option>
                        </select>
                        <select
                          value={c.sourceId}
                          onChange={(e) =>
                            updateCorrection(src.id, idx, {
                              sourceId: e.target.value,
                            })
                          }
                        >
                          <option value="">— Quelle wählen —</option>
                          {sources
                            .filter((o) => o.id !== src.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                        </select>
                        <button
                          className="src-fdel"
                          onClick={() => removeCorrection(src.id, idx)}
                          title="Korrektur entfernen"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addCorrection(src.id)}>
                      + Korrektur
                    </button>
                  </div>
                )}
              </div>
              )}

              {/* Geräte-Verknüpfung: Leistung von separater Quelle beziehen */}
              {!isEmuRole(src.role) && !src.subordinateOf && src.role !== "entsoe" && (
                <div className="src-fields">
                  <div className="src-fields-head">Leistung von separater Quelle</div>
                  <p className="hint" style={{ margin: "2px 0 6px" }}>
                    Gehören zu einem Gerät zwei Quellen (z.&nbsp;B. eine Wärmepumpe
                    mit Betriebsdaten per HeishaMon und Leistungsaufnahme über einen
                    separaten Shelly), kann diese Quelle ihre <strong>Leistung</strong>{" "}
                    von einer anderen Quelle beziehen. Diese Quelle liefert dann die
                    Betriebsdaten, die verknüpfte die Leistung. Die verknüpfte Quelle
                    wird nicht mehr als eigenes Gerät gewertet.
                  </p>
                  <select
                    value={src.powerSourceId ?? ""}
                    onChange={(e) => update(src.id, { powerSourceId: e.target.value || undefined })}
                  >
                    <option value="">— eigene Leistung verwenden —</option>
                    {sources
                      .filter((o) => o.id !== src.id && !o.powerSourceId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              {src.subordinateOf && (
                <div className="src-fields">
                  <p className="hint" style={{ margin: 0 }}>
                    Diese Quelle liefert die Leistungsaufnahme für „
                    {sources.find((o) => o.id === src.subordinateOf)?.label ?? src.subordinateOf}
                    " und wird daher nicht als eigenes Gerät gewertet.
                  </p>
                </div>
              )}

              {/* Weitere benannte Links (z.B. Weboberfläche des Geräts) */}
              <div className="src-fields">
                <div className="src-fields-head">Weitere Links</div>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  Optionale zusätzliche URLs mit Beschreibung (z.&nbsp;B. Link zur
                  Weboberfläche). Werden nicht abgefragt, sondern nur als Links
                  angezeigt – je nach Rolle der Quelle auf der passenden Seite:
                  Verbraucher in der Übersichtstabelle, PV-Erzeuger auf der
                  Stromerzeugungsseite, AC- und DC-Speicher auf der Speicher-Seite,
                  Wärmepumpe auf der Seite „Wärmepumpe", Warmwasserspeicher und
                  Heizstab auf der Seite „Warmwasser".
                </p>
                {(src.extraLinks ?? []).map((lnk, idx) => (
                  <div key={idx} className="src-link-row">
                    <input
                      className="src-link-label"
                      value={lnk.label}
                      placeholder="Beschreibung"
                      onChange={(e) => updateExtraLink(src.id, idx, { label: e.target.value })}
                    />
                    <input
                      className="src-link-url"
                      value={lnk.url}
                      placeholder="http://192.168.x.x/"
                      onChange={(e) => updateExtraLink(src.id, idx, { url: e.target.value })}
                    />
                    <button
                      className="src-fdel"
                      onClick={() => removeExtraLink(src.id, idx)}
                      title="Link entfernen"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button onClick={() => addExtraLink(src.id)}>+ Link</button>
              </div>

              {src.role !== "hueBridge" && src.role !== "ccuHub" && src.role !== "securitySpy" && src.role !== "mitsubishiAc" && src.role !== "vallox" && src.role !== "prusa" && src.role !== "airSensor" && src.role !== "accessReader" && src.role !== "evcc" && src.role !== "entsoe" && (
                <div className="src-switchable">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!src.switchable}
                      onChange={(e) => update(src.id, { switchable: e.target.checked })}
                    />
                    Schaltbarer Ausgang (für Automatisierungsregeln)
                  </label>
                  {/^https?:\/\/[^/]+\/status\/?$/i.test(src.url ?? "") && (
                    <p className="hint" style={{ margin: "4px 0 0", fontSize: 12, color: "#1a7f37" }}>
                      Alter Shelly (Gen1) erkannt (URL endet auf „/status"). Häkchen setzen, um
                      ihn schaltbar zu machen – FLUX schaltet ihn dann über <code>/relay/0?turn=on</code>.
                    </p>
                  )}
                  <p className="hint" style={{ margin: "4px 0 0", fontSize: 12 }}>
                    Aktivieren für schaltbare Shelly-Geräte (Plug, Pro, 2PM, auch alte Gen1 …).
                    Reine Messgeräte (Shelly PM / PM Mini) sind nicht schaltbar. Der zu
                    schaltende Kanal wird automatisch aus dem JSON-Pfad erkannt
                    (z.&nbsp;B. schaltet „switch:1.apower" den Kanal 2).
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="src-actions">
        <button onClick={addSource}>+ Quelle hinzufügen</button>
        <button onClick={saveAll} className="src-save">
          Alles speichern
        </button>
        {saved && <span className="src-testok">✓ gespeichert</span>}
      </div>
      {gridConflict && (
        <p className="src-save-error">
          ⚠ Der Netz-Kernwert „{gridConflict}" wird von mehr als einer aktiven
          Netz-Quelle geliefert. Jeder Kernwert (Leistung, Bezugszähler,
          Einspeisezähler) darf nur von genau einer aktiven Quelle kommen – sonst
          summiert er sich in der Bilanz doppelt. Mehrere Netz-Quellen sind
          erlaubt, solange sie sich die Kernwerte nicht überschneiden (z. B. eine
          mit den Zählerständen, eine mit der schnellen Leistung). Bitte bei den
          übrigen das betreffende Feld auf „info" stellen; sonst lässt sich nicht
          speichern.
        </p>
      )}
      {saveError && <p className="src-save-error">⚠ {saveError}</p>}
    </div>
  );
}
