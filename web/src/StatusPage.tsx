// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useRef } from "react";
import { nf } from "./chartUtils";
import type { FullState, SourceStatus } from "./types";
import { effectiveIcon } from "./iconDefaults";

// "vor X s/min" + Stale-Status. Schwelle = 4 × Poll-Intervall der Quelle.
function ago(
  lastSuccess: number | null,
  intervalSec: number
): { text: string; stale: boolean } {
  if (lastSuccess == null) return { text: "noch nie", stale: true };
  const diff = Date.now() - lastSuccess;
  const thresholdMs = intervalSec * 4 * 1000; // 4-faches Intervall
  const stale = diff > thresholdMs;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return { text: `vor ${sec} s`, stale };
  const min = Math.round(sec / 60);
  return { text: `vor ${min} min`, stale };
}

function clock(ms: number | null): string {
  if (ms == null) return "–";
  return new Date(ms).toLocaleTimeString("de-DE");
}

// Wert formatieren (Zahl mit sinnvoller Genauigkeit, ja/nein bei bool, Text bei string)
function fmt(value: number | boolean | string): string {
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (typeof value === "string") return value || "–";
  if (!Number.isFinite(value)) return "–";
  // ganze Zahlen ohne Nachkommastelle, sonst 2 Stellen
  return Number.isInteger(value) ? String(value) : nf(value, 2);
}

function SourceRow({ s }: { s: SourceStatus }) {
  const a = ago(s.lastSuccess, s.intervalSec);
  // Deaktivierte Quellen ausgrauen; Ampel dann neutral (grau). Über verlinkten
  // Schalter ausgeschaltete Geräte ebenfalls neutral (grau) statt rot – das ist
  // kein Fehler, sondern gewollt stromlos.
  const disabled = !s.enabled;
  const ausgeschaltet = s.ausgeschaltet === true;
  const dotClass = disabled ? "gray" : ausgeschaltet ? "gray" : a.stale ? "red" : "green";
  const istHue = s.role === "hueBridge";
  const istKlima = s.role === "mitsubishiAc";
  const istVallox = s.role === "vallox";
  const istCcu = s.role === "ccuHub";

  return (
    <div className={`source-card ${disabled ? "disabled" : ""}`}>
      <div className="source-head">
        <span className={`dot ${dotClass}`} />
        {(() => {
          const ic = effectiveIcon({ icon: s.icon, deviceType: s.deviceType, role: s.role });
          return ic ? <span className="source-icon">{ic}</span> : null;
        })()}
        <a href={s.url} target="_blank" rel="noreferrer" className="source-name">
          {s.label}
        </a>
        {s.switchable && (
          <button
            className={`source-switch-badge ${s.switchState === true ? "an" : s.switchState === false ? "aus" : "unbekannt"}`}
            title="Klicken zum Umschalten"
            onClick={async (e) => {
              e.preventDefault();
              const neu = !(s.switchState === true);
              try {
                await fetch("/api/switch/test", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sourceId: s.switchVia ?? s.key, on: neu }),
                });
              } catch { /* ignore */ }
            }}>
            {s.switchState === true ? "AN" : s.switchState === false ? "AUS" : "?"}
          </button>
        )}
        <span className="source-meta">
          {disabled ? (
            "deaktiviert – wird nicht abgefragt"
          ) : ausgeschaltet ? (
            "ausgeschaltet (über verlinkten Schalter)"
          ) : (
            <>
              {a.text} ({clock(s.lastSuccess)}) · alle {s.intervalSec}s
            </>
          )}
        </span>
      </div>

      {s.lastError && !disabled && (
        <div className="source-error">Fehler: {s.lastError}</div>
      )}

      {!disabled && istHue && <HueWerte sourceId={s.key} />}
      {!disabled && istKlima && <KlimaWerte sourceId={s.key} />}
      {!disabled && istVallox && <ValloxWerte sourceId={s.key} />}
      {!disabled && istCcu && <CcuWerte sourceId={s.key} werte={s.values} />}
      {!disabled && !istHue && !istKlima && !istVallox && !istCcu && (
        <div className="source-values">
          {s.values.map((v, i) => (
            <span key={i} className="source-value">
              {v.label}: <b>{fmt(v.value)}</b>
              {v.unit ? ` ${v.unit}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const ROLE_GROUPS: Array<{ roles: string[]; title: string }> = [
  { roles: ["grid"], title: "Netz" },
  { roles: ["grid42c", "grid42cEmu"], title: "Netz §42c" },
  { roles: ["pv"], title: "PV-Erzeugung" },
  { roles: ["batteryOut"], title: "Batterie-Einspeisung" },
  { roles: ["batteryIn"], title: "Batterie-Netzladung" },
  { roles: ["acBattery"], title: "AC-Speicher" },
  { roles: ["dcBattery"], title: "DC-Speicher" },
  { roles: ["consumer"], title: "Verbraucher" },
  { roles: ["info"], title: "Sensoren / Info" },
  { roles: ["waterTank"], title: "Warmwasserspeicher" },
  { roles: ["hueBridge"], title: "Philips Hue" },
  { roles: ["ccuHub"], title: "Homematic" },
  { roles: ["mitsubishiAc"], title: "Klimaanlagen" },
  { roles: ["vallox"], title: "Lüftung" },
  { roles: ["prusa"], title: "3D-Drucker" },
  { roles: ["airSensor"], title: "Luftsensoren" },
  { roles: ["helper"], title: "Hilfswerte" },
];

export function StatusPage({ state }: { state: FullState }) {
  // Sekündliches Re-Render, damit "vor X s" und Ampel aktuell bleiben.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page">
      <h2>Status</h2>
      <p className="hint">
        Grün = innerhalb des 4-fachen Abfrage-Intervalls erfolgreich gelesen,
        Rot = länger her oder Fehler. Grau = Quelle ist deaktiviert und wird
        nicht abgefragt.
      </p>
      {ROLE_GROUPS.map((g) => {
        const items = state.sources.filter((s) => g.roles.includes(s.role));
        if (items.length === 0) return null;
        const istHue = g.roles.includes("hueBridge");
        const istCcu = g.roles.includes("ccuHub");
        return (
          <div key={g.title} className="card">
            <h3>{g.title}</h3>
            <div className="source-list">
              {items.map((s) => (
                <SourceRow key={s.key} s={s} />
              ))}
            </div>
          </div>
        );
      })}

      <MqttBroker />

      {state.sinks && state.sinks.length > 0 && (
        <div className="card">
          <h3>Senken (emulierte Zähler)</h3>
          <p className="hint">
            Senken geben von der Anlage berechnete Werte nach außen weiter, indem
            sie einen Stromzähler emulieren – z.&nbsp;B. um einer Wallbox oder
            einem anderen Gerät einen Messwert bereitzustellen. Je nach Senke
            können unterschiedliche Zählertypen nachgebildet werden (etwa ein
            Shelly Pro&nbsp;3EM oder ein anderer unterstützter Zähler). Angezeigt
            wird, ob die jeweilige Senke aktiv ist und welche Leistung sie gerade
            ausgibt.
          </p>
          <div className="source-list">
            {state.sinks.map((s) => (
              <div key={s.id} className={`source-card ${s.enabled ? "" : "disabled"}`}>
                <div className="source-head">
                  <span className={`dot ${s.enabled ? "green" : "gray"}`} />
                  <span className="source-name">{s.name}</span>
                  <span className="source-meta">
                    Basis: {s.baseSourceLabel}
                    {s.enabled ? "" : " · inaktiv"}
                  </span>
                </div>
                <div className="source-values">
                  <span className="source-value">
                    geliefert: <strong>{nf(s.outputPowerW, 0)} W</strong>
                  </span>
                  <span className="source-value">
                    eigener Netzbezug: <strong>{nf(s.eigenBezugW, 0)} W</strong>
                  </span>
                  <span className="source-value">
                    Abnehmer-Bezug: <strong>{nf(s.abnehmerBezugW, 0)} W</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Hue-Leuchten-Steuerung ---
interface HueDev {
  serviceId: string; deviceId: string; name: string; kind: string; room?: string; sourceId: string;
  on?: boolean; brightness?: number; hatDimmen?: boolean; hatFarbe?: boolean; colorX?: number; colorY?: number;
  motion?: boolean | null; temperature?: number; lightLevel?: number; batteryLevel?: number; reachable?: boolean; unreachable?: boolean;
}

// CIE-xy <-> RGB-Umrechnung (vereinfacht, für Hue-Farbwahl ausreichend).
function xyToHex(x: number, y: number): string {
  if (y <= 0) return "#ffffff";
  const z = 1 - x - y;
  const Y = 1; const X = (Y / y) * x; const Z = (Y / y) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530;
  const gamma = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  r = gamma(r); g = gamma(g); b = gamma(b);
  const m = Math.max(r, g, b, 1); r /= m; g /= m; b /= m;
  const h = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function hexToXy(hex: string): { x: number; y: number } {
  const r0 = parseInt(hex.slice(1, 3), 16) / 255, g0 = parseInt(hex.slice(3, 5), 16) / 255, b0 = parseInt(hex.slice(5, 7), 16) / 255;
  const inv = (c: number) => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  const r = inv(r0), g = inv(g0), b = inv(b0);
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;
  const s = X + Y + Z;
  if (s <= 0) return { x: 0.3127, y: 0.3290 };
  return { x: +(X / s).toFixed(4), y: +(Y / s).toFixed(4) };
}

function HueWerte({ sourceId }: { sourceId: string }) {
  const [devices, setDevices] = useState<HueDev[]>([]);
  const [dimPopup, setDimPopup] = useState<string | null>(null);
  const pendingRef = useRef<Record<string, { on: boolean; bis: number }>>({});
  const laden = () => {
    fetch("/api/hue/devices").then((r) => r.json()).then((j) => {
      if (!j.ok) return;
      const now = Date.now();
      const pend = pendingRef.current;
      const merged = (j.devices ?? [])
        .filter((d: HueDev) => d.sourceId === sourceId)
        .map((d: HueDev) => {
          const p = pend[d.serviceId];
          if (p && now < p.bis) {
            if (d.on === p.on) { delete pend[d.serviceId]; return d; }
            return { ...d, on: p.on };
          }
          if (p) delete pend[d.serviceId];
          return d;
        });
      setDevices(merged);
    }).catch(() => {});
  };
  useEffect(() => { laden(); const t = setInterval(laden, 10000); return () => clearInterval(t); }, [sourceId]);

  async function senden(d: HueDev, patch: { on?: boolean; brightness?: number; colorX?: number; colorY?: number }) {
    const on = patch.on ?? d.on ?? true;
    pendingRef.current[d.serviceId] = { on, bis: Date.now() + 6000 };
    setDevices((ds) => ds.map((x) => x.serviceId === d.serviceId ? { ...x, ...patch, on } : x));
    try {
      await fetch("/api/hue/switch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: d.sourceId, serviceId: d.serviceId, on, ...patch }),
      });
      setTimeout(laden, 1500); setTimeout(laden, 4000);
    } catch { /* ignore */ }
  }

  if (devices.length === 0) return null;
  const sensorWert = (d: HueDev): string => {
    if (d.kind === "motion") return d.motion == null ? "–" : (d.motion ? "Bewegung" : "keine Bewegung");
    if (d.kind === "temperature") return d.temperature != null ? `${d.temperature.toFixed(1)} °C` : "–";
    if (d.kind === "light_level") return d.lightLevel != null ? String(d.lightLevel) : "–";
    if (d.kind === "device_power") return d.batteryLevel != null ? `${d.batteryLevel} %` : "–";
    return "–";
  };

  // Gleiches Layout wie die normalen Werte (source-values, Textzeilen nebeneinander).
  // Lampen: klickbares An/Aus-Badge + klickbarer Prozentwert (Popup-Slider) + Farbsymbol.
  return (
    <div className="source-values">
      {[...devices].sort((a, b) => `${a.room ?? ""}${a.name}`.localeCompare(`${b.room ?? ""}${b.name}`, "de")).map((d) => {
        const praefix = d.room ? `${d.room}: ` : "";
        if (d.kind !== "light") {
          return (
            <span key={d.serviceId} className="source-value">
              {praefix}{d.name}: <b>{sensorWert(d)}</b>
            </span>
          );
        }
        return (
          <span key={d.serviceId} className="source-value hue-value">
            {praefix}{d.name}:{" "}
            <button className={`source-switch-badge ${d.on ? "an" : "aus"}`} title={d.unreachable ? "Nicht erreichbar (z.B. Stromschalter aus) – als AUS gewertet" : "Klicken zum Umschalten"}
              onClick={() => senden(d, { on: !d.on })}>{d.on ? "AN" : "AUS"}</button>
            {d.unreachable && <span className="hue-unreachable" title="Lampe ist nicht erreichbar">⚠</span>}
            {d.on && d.hatDimmen && (
              <span className="hue-inline-dim">
                <button className="hue-dim-wert" title="Helligkeit einstellen"
                  onClick={() => setDimPopup(dimPopup === d.serviceId ? null : d.serviceId)}>({d.brightness ?? 100}%)</button>
                {dimPopup === d.serviceId && (
                  <span className="hue-dim-popup">
                    <input type="range" min={1} max={100} value={d.brightness ?? 100}
                      onChange={(e) => setDevices((ds) => ds.map((x) => x.serviceId === d.serviceId ? { ...x, brightness: Number(e.target.value) } : x))}
                      onMouseUp={(e) => senden(d, { brightness: Number((e.target as HTMLInputElement).value) })}
                      onTouchEnd={(e) => senden(d, { brightness: Number((e.target as HTMLInputElement).value) })} />
                  </span>
                )}
              </span>
            )}
            {d.on && d.hatFarbe && (
              <label className="hue-inline-farbe" title="Farbe wählen">🎨
                <input type="color" value={d.colorX != null && d.colorY != null ? xyToHex(d.colorX, d.colorY) : "#ffffff"}
                  onChange={(e) => { const { x, y } = hexToXy(e.target.value); senden(d, { colorX: x, colorY: y }); }} />
              </label>
            )}
          </span>
        );
      })}
    </div>
  );
}

// --- Mitsubishi-Klimaanlage-Bedienung ---
interface AcDev {
  sourceId: string; ok: boolean; power?: boolean; mode?: string; temp?: number;
  roomTemp?: number; fan?: string; vane?: string; wideVane?: string; action?: string; compressorFrequency?: number; label?: string;
}
const AC_MODES = ["AUTO", "HEAT", "COOL", "DRY", "FAN_ONLY"];
const AC_FAN = ["AUTO", "QUIET", "1", "2", "3", "4"];
const AC_VANE = ["AUTO", "SWING", "1", "2", "3", "4", "5"];
function KlimaWerte({ sourceId }: { sourceId: string }) {
  const [dev, setDev] = useState<AcDev | null>(null);
  const [popup, setPopup] = useState(false);
  const laden = () => {
    fetch("/api/klima/devices").then((r) => r.json()).then((j) => {
      if (j.ok) setDev((j.devices ?? []).find((d: AcDev) => d.sourceId === sourceId) ?? null);
    }).catch(() => {});
  };
  useEffect(() => { laden(); const t = setInterval(laden, 10000); return () => clearInterval(t); }, [sourceId]);

  async function setze(feld: string, wert: unknown) {
    // optimistisch aktualisieren
    setDev((d) => d ? { ...d, [feld === "power" ? "power" : feld]: feld === "power" ? !!wert : wert } : d);
    try {
      await fetch("/api/klima/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, feld, wert }) });
      setTimeout(laden, 1500);
    } catch { /* ignore */ }
  }
  if (!dev || !dev.ok) return <div className="source-values"><span className="source-value">Klimaanlage nicht erreichbar</span></div>;
  const an = dev.power === true;
  return (
    <div className="source-values klima-werte">
      <span className="source-value">
        <button className={`source-switch-badge ${an ? "an" : "aus"}`} title="Klicken zum Umschalten"
          onClick={() => setze("power", !an)}>{an ? "AN" : "AUS"}</button>
      </span>
      {dev.roomTemp != null && <span className="source-value">Raum: <b>{dev.roomTemp.toFixed(1)} °C</b></span>}
      {an && dev.temp != null && (
        <span className="source-value klima-temp">
          Ziel:{" "}
          <button className="klima-temp-btn" onClick={() => setze("temp", Math.max(16, (dev.temp ?? 22) - 1))} title="kälter">−</button>
          <b>{dev.temp.toFixed(0)} °C</b>
          <button className="klima-temp-btn" onClick={() => setze("temp", Math.min(31, (dev.temp ?? 22) + 1))} title="wärmer">+</button>
        </span>
      )}
      {an && dev.mode && <span className="source-value">Modus: <b>{dev.mode}</b></span>}
      {an && dev.action && <span className="source-value">Aktivität: <b>{dev.action}</b></span>}
      {an && dev.compressorFrequency != null && dev.compressorFrequency > 0 && <span className="source-value">Kompressor: <b>{dev.compressorFrequency} Hz</b></span>}
      {an && (
        <span className="source-value klima-mehr">
          <button className="klima-mehr-btn" onClick={() => setPopup(!popup)} title="Weitere Einstellungen">⚙</button>
          {popup && (
            <span className="klima-popup" onClick={(e) => e.stopPropagation()}>
              <label>Modus
                <select value={dev.mode ?? "COOL"} onChange={(e) => setze("mode", e.target.value)}>
                  {AC_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label>Lüfter
                <select value={dev.fan ?? "AUTO"} onChange={(e) => setze("fan", e.target.value)}>
                  {AC_FAN.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label>Lamelle
                <select value={dev.vane ?? "AUTO"} onChange={(e) => setze("vane", e.target.value)}>
                  {AC_VANE.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>Seitl. Lamelle
                <select value={dev.wideVane ?? "|"} onChange={(e) => setze("wideVane", e.target.value)}>
                  {["<<", "<", "|", ">", ">>", "SWING"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// --- Vallox-Lüftungsanlage-Bedienung ---
interface ValloxDev {
  sourceId: string; ok: boolean; on?: boolean; speed?: number; heating?: boolean;
  fault?: boolean; serviceNeeded?: boolean; tempInside?: number; tempOutside?: number;
  tempIncoming?: number; tempExhaust?: number; label?: string;
}
function ValloxWerte({ sourceId }: { sourceId: string }) {
  const [dev, setDev] = useState<ValloxDev | null>(null);
  const laden = () => {
    fetch("/api/vallox/devices").then((r) => r.json()).then((j) => {
      if (j.ok) setDev((j.devices ?? []).find((d: ValloxDev) => d.sourceId === sourceId) ?? null);
    }).catch(() => {});
  };
  useEffect(() => { laden(); const t = setInterval(laden, 10000); return () => clearInterval(t); }, [sourceId]);

  async function setze(feld: string, wert: unknown) {
    if (feld === "power") setDev((d) => d ? { ...d, on: !!wert } : d);
    if (feld === "speed") setDev((d) => d ? { ...d, speed: Number(wert) } : d);
    try {
      await fetch("/api/vallox/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, feld, wert }) });
      setTimeout(laden, 1500);
    } catch { /* ignore */ }
  }
  if (!dev || !dev.ok) return <div className="source-values"><span className="source-value">Lüftung nicht erreichbar</span></div>;
  const an = dev.on === true;
  return (
    <div className="source-values vallox-werte">
      <span className="source-value">
        <button className={`source-switch-badge ${an ? "an" : "aus"}`} title="Klicken zum Umschalten"
          onClick={() => setze("power", !an)}>{an ? "AN" : "AUS"}</button>
      </span>
      {an && dev.speed != null && (
        <span className="source-value vallox-speed">
          Stufe:{" "}
          <button className="vallox-speed-btn" onClick={() => setze("speed", Math.max(1, (dev.speed ?? 1) - 1))} title="langsamer">−</button>
          <b>{dev.speed}</b>
          <button className="vallox-speed-btn" onClick={() => setze("speed", Math.min(8, (dev.speed ?? 1) + 1))} title="schneller">+</button>
        </span>
      )}
      {dev.tempInside != null && <span className="source-value">Innen: <b>{dev.tempInside.toFixed(1)} °C</b></span>}
      {dev.tempOutside != null && <span className="source-value">Außen: <b>{dev.tempOutside.toFixed(1)} °C</b></span>}
      {dev.tempIncoming != null && <span className="source-value">Zuluft: <b>{dev.tempIncoming.toFixed(1)} °C</b></span>}
      {dev.tempExhaust != null && <span className="source-value">Abluft: <b>{dev.tempExhaust.toFixed(1)} °C</b></span>}
      {dev.heating && <span className="source-value">Heizung: <b>aktiv</b></span>}
      {dev.fault && <span className="source-value klima-warn">⚠ Störung</span>}
      {dev.serviceNeeded && <span className="source-value klima-warn">⚠ Wartung fällig</span>}
    </div>
  );
}

// --- Homematic-CCU-Steuerung ---
interface CcuDev {
  id: string; channelId: string; name: string; room?: string; kind: string;
  datapoint: string; wert: number | boolean | string | null; einheit?: string;
  schaltbar?: boolean; sourceId: string; istGruppe?: boolean; gruppenId?: string;
}
function CcuWerte({ sourceId, werte }: { sourceId: string; werte: Array<{ label: string; value: number | boolean | string; unit: string }> }) {
  const [devices, setDevices] = useState<CcuDev[]>([]);
  const [alarm, setAlarm] = useState<Record<string, { internal: boolean; external: boolean; modus: string; ausgeloest?: boolean }>>({});
  const [autos, setAutos] = useState<Record<string, Array<{ id: string; name: string; aktiv: boolean; typ: string; zuletzt?: number }>>>({});
  const pendingRef = useRef<Record<string, { on: boolean; bis: number }>>({});
  const laden = () => {
    fetch("/api/ccu/devices").then((r) => r.json()).then((j) => {
      if (!j.ok) return;
      const now = Date.now();
      const pend = pendingRef.current;
      const merged = (j.devices ?? []).map((d: CcuDev) => {
        const p = pend[d.id];
        if (p && now < p.bis) {
          if (d.wert === p.on) { delete pend[d.id]; return d; }
          return { ...d, wert: p.on };
        }
        if (p) delete pend[d.id];
        return d;
      });
      setDevices(merged);
      if (j.alarm) setAlarm(j.alarm);
      if (j.automatisierungen) setAutos(j.automatisierungen);
    }).catch(() => {});
  };
  useEffect(() => { laden(); const t = setInterval(laden, 10000); return () => clearInterval(t); }, []);

  async function alarmSetzen(sid: string, modus: string) {
    try {
      await fetch("/api/ccu/alarm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: sid, modus }) });
      setTimeout(laden, 1500);
    } catch { /* ignore */ }
  }
  async function sireneAusloesen(sid: string) {
    if (!window.confirm("Sirene wirklich auslösen? Dies löst einen akustischen Alarm aus.")) return;
    try { await fetch("/api/ccu/sirene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: sid, ausloesen: true }) }); } catch { /* ignore */ }
  }
  async function sireneStoppen(sid: string) {
    try { await fetch("/api/ccu/sirene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: sid, ausloesen: false }) }); } catch { /* ignore */ }
  }

  async function senden(d: CcuDev, wert: boolean | number | "stop") {
    if (wert !== "stop") setDevices((ds) => ds.map((x) => x.id === d.id ? { ...x, wert } : x));
    try {
      await fetch("/api/ccu/switch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: d.sourceId, iseId: d.id, wert }),
      });
      setTimeout(laden, 1500); setTimeout(laden, 4000);
    } catch { /* ignore */ }
  }

  // Rollladen-Steuerung (schlank, inline): ▲■▼ + Slider + %.
  function ShutterInline({ d }: { d: CcuDev }) {
    const pos = typeof d.wert === "number" ? d.wert : 0;
    const [slider, setSlider] = useState(pos);
    useEffect(() => { setSlider(pos); }, [pos]);
    return (
      <span className="ccu-inline-shutter">
        <button onClick={() => senden(d, 0)} title="Hoch">▲</button>
        <button onClick={() => senden(d, "stop")} title="Stopp">■</button>
        <button onClick={() => senden(d, 100)} title="Runter">▼</button>
        <input type="range" min={0} max={100} value={slider}
          onChange={(e) => setSlider(Number(e.target.value))}
          onMouseUp={(e) => senden(d, Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => senden(d, Number((e.target as HTMLInputElement).value))} />
        <b>{pos}%</b>
      </span>
    );
  }
  // Schalter-Steuerung (schlank, inline): AN/AUS-Badge.
  function SwitchInline({ d }: { d: CcuDev }) {
    const an = d.wert === true;
    return (
      <button className={`source-switch-badge ${an ? "an" : "aus"}`} title="Klicken zum Umschalten"
        onClick={() => senden(d, !an)}>{an ? "AN" : "AUS"}</button>
    );
  }

  // Steuerbares Gerät zu einem Anzeigenamen finden (für die Integration in die
  // Datenpunkt-Liste). Zuordnung über das Gerät-Label (aus dem Datenpunkt-Label).
  const schaltbareByName = new Map<string, CcuDev>();
  for (const d of devices) if (d.schaltbar) schaltbareByName.set(`${d.room ? d.room + ": " : ""}${d.name}`, d);

  // --- Datenpunkte nach Gerät clustern ---
  // Labels haben das Schema "Raum: Gerätename [datapoint]". Wir gruppieren nach
  // "Raum: Gerätename" und sammeln je Gerät alle Datenpunkte.
  interface Cluster { key: string; geraet: string; punkte: Array<{ dp: string; value: any; unit: string }>; steuerung?: CcuDev; kategorie: string; }
  const cluster = new Map<string, Cluster>();
  for (const w of werte) {
    if (w.label === "Geräte") continue; // die Gesamtzahl-Zeile überspringen
    const m = w.label.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const geraet = m ? m[1].trim() : w.label;
    const dp = m ? m[2] : "";
    if (!cluster.has(geraet)) cluster.set(geraet, { key: geraet, geraet, punkte: [], kategorie: "sonstiges" });
    cluster.get(geraet)!.punkte.push({ dp, value: w.value, unit: w.unit });
  }
  const clusterAll = [...cluster.values()];
  // Steuerung zuordnen (nur ECHTE Schalter/Rollläden – setPointTemperature macht
  // einen Sensor NICHT zum Schalter).
  for (const c of clusterAll) {
    const dev = schaltbareByName.get(c.geraet);
    if (dev && (dev.kind === "shutter" || dev.kind === "switch")) c.steuerung = dev;
    // Kategorie bestimmen.
    const dps = c.punkte.map((p) => p.dp);
    const istRollladen = dps.includes("shutterLevel") || (c.steuerung?.kind === "shutter");
    const istSensor = dps.includes("actualTemperature") || dps.includes("humidity");
    const istKontakt = dps.includes("windowState");
    if (istRollladen) c.kategorie = c.steuerung?.istGruppe ? "rollladenGruppe" : "rollladen";
    else if (istKontakt) c.kategorie = "kontakt";
    else if (istSensor) c.kategorie = "sensor";
    else c.kategorie = "sonstiges";
  }
  // Auch schaltbare Gruppen ohne eigene Datenpunkte als Rollladen-Gruppen zeigen.
  for (const d of devices) {
    if (d.schaltbar && d.istGruppe && d.kind === "shutter") {
      const name = `${d.room ? d.room + ": " : ""}${d.name}`;
      if (!cluster.has(name)) clusterAll.push({ key: name, geraet: name, punkte: [], steuerung: d, kategorie: "rollladenGruppe" });
    }
  }



  // Datenpunkt-Wert lesbar machen (bekannte Datenpunkte übersetzen).
  const dpLabel = (dp: string): string => {
    const map: Record<string, string> = {
      actualTemperature: "Ist-Temp.", setPointTemperature: "Soll-Temp.", humidity: "Feuchte",
      windowState: "Fenster", motion: "Bewegung", presence: "Anwesenheit", on: "Zustand", shutterLevel: "Position",
      illumination: "Helligkeit", valveActualTemperature: "Ventil-Temp.", dimLevel: "Helligkeit",
    };
    return map[dp] ?? dp;
  };
  const dpValue = (dp: string, value: any, unit: string): string => {
    // WICHTIG: value ist bereits der vom Backend (fetcher) fertig formatierte
    // Wert – z. B. "geschlossen"/"offen", "an"/"aus", "23.4 °C". NICHT erneut als
    // Boolean interpretieren (ein nicht-leerer String wäre immer truthy und ergäbe
    // z. B. fälschlich "offen"). Zahlen mit Einheit versehen, sonst durchreichen.
    if (typeof value === "boolean") return value ? "ja" : "nein";
    if (typeof value === "number") return `${value}${unit ? " " + unit : ""}`;
    return value != null ? String(value) : "–";
  };

  const fmtZuletzt = (ms?: number) => {
    if (!ms) return null;
    try {
      const d = new Date(ms);
      const diff = Date.now() - ms;
      const min = Math.round(diff / 60000);
      if (min < 60) return `vor ${min} min`;
      if (min < 1440) return `vor ${Math.round(min / 60)} h`;
      return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return null; }
  };

  // Eine Geräte-Zeile rendern: Datenpunkte + ggf. Steuerung (Rollladen/Schalter).
  const geraetZeile = (c: Cluster) => {
    // Bei Sensoren nur den Raum (Teil vor dem ersten ":") zeigen – der genaue
    // Gerätename ("Temperatur- und Luftfeuchtigkeitssensor mit Display") ist
    // uninteressant und macht die Zeile unnötig lang.
    const anzeigeName = c.kategorie === "sensor" && c.geraet.includes(":")
      ? c.geraet.split(":")[0].trim()
      : c.geraet;
    return (
      <span key={c.key} className="source-value ccu-geraet-zeile">
        <span className="ccu-geraet-name">{anzeigeName}:</span>{" "}
        {c.punkte.filter((p) => p.dp !== "shutterLevel" || !c.steuerung).map((p, i, arr) => (
          <span key={i} className="ccu-dp">
            {p.dp ? `${dpLabel(p.dp)}: ` : ""}<b>{dpValue(p.dp, p.value, p.unit)}</b>{i < arr.length - 1 ? " · " : ""}
          </span>
        ))}
        {c.steuerung && c.steuerung.kind === "shutter" && <ShutterInline d={c.steuerung} />}
        {c.steuerung && c.steuerung.kind === "switch" && <SwitchInline d={c.steuerung} />}
      </span>
    );
  };

  const alarmQuellen = Object.keys(alarm);
  const autoQuellen = Object.keys(autos);

  const kategorien: Array<{ id: string; titel: string }> = [
    { id: "rollladenGruppe", titel: "Gruppen von Rollläden" },
    { id: "rollladen", titel: "Einzelrollläden" },
    { id: "kontakt", titel: "Tür- und Fensterkontakte" },
    { id: "sensor", titel: "Temperatur- und Luftfeuchtigkeitssensoren" },
    { id: "sonstiges", titel: "Sonstiges" },
  ];

  return (
    <div className="source-values ccu-werte">
      {/* Datenpunkte, kategorisiert und alphabetisch */}
      {kategorien.map((kat) => {
        const inKat = clusterAll.filter((c) => c.kategorie === kat.id).sort((a, b) => a.geraet.localeCompare(b.geraet, "de"));
        if (inKat.length === 0) return null;
        return (
          <div key={kat.id} className="ccu-kategorie">
            <div className="ccu-kategorie-titel">{kat.titel}</div>
            {inKat.map((c) => geraetZeile(c))}
          </div>
        );
      })}

      {/* Alarmanlage – im selben Kasten */}
      {alarmQuellen.map((sid) => {
        const a = alarm[sid];
        return (
          <div key={sid} className={`ccu-alarm ccu-alarm-${a.modus}${a.ausgeloest ? " ausgeloest" : ""}`}>
            <div className="ccu-alarm-kopf">
              <span className="ccu-alarm-titel">Alarmanlage</span>
              <span className="ccu-alarm-status">
                {a.ausgeloest ? "⚠ ALARM AUSGELÖST" : a.modus === "vollschutz" ? "scharf (Vollschutz)" : a.modus === "anwesenheit" ? "scharf (Anwesenheit)" : "unscharf"}
              </span>
            </div>
            <div className="ccu-alarm-btns">
              <button className={a.modus === "unscharf" ? "aktiv" : ""} onClick={() => alarmSetzen(sid, "unscharf")}>Unscharf</button>
              <button className={a.modus === "anwesenheit" ? "aktiv" : ""} onClick={() => alarmSetzen(sid, "anwesenheit")}>Anwesenheit</button>
              <button className={a.modus === "vollschutz" ? "aktiv" : ""} onClick={() => alarmSetzen(sid, "vollschutz")}>Vollschutz</button>
            </div>
            <div className="ccu-alarm-sirene">
              <button className="ccu-sirene-btn" onClick={() => sireneAusloesen(sid)}>🔔 Sirene auslösen</button>
              {a.ausgeloest && <button onClick={() => sireneStoppen(sid)}>Sirene stoppen</button>}
            </div>
          </div>
        );
      })}

      {/* Automatisierungen – im selben Kasten, mit letztem Auslösezeitpunkt falls vorhanden */}
      {autoQuellen.map((sid) => autos[sid].length > 0 && (
        <div key={sid} className="ccu-autos">
          <div className="ccu-autos-titel">Automatisierungen</div>
          <ul className="ccu-auto-liste">
            {autos[sid].map((a) => {
              const zt = fmtZuletzt(a.zuletzt);
              return (
                <li key={a.id}>
                  {a.aktiv ? "●" : "○"} {a.name}
                  {zt && <span className="ccu-auto-zeit"> · zuletzt {zt}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- MQTT-Broker-Anzeige ---
interface MqttTopic { topic: string; count: number; lastTs: number; lastPayload: string; }
function MqttBroker() {
  const [status, setStatus] = useState<{ laeuft: boolean; port: number; fehler: string | null } | null>(null);
  const [topics, setTopics] = useState<MqttTopic[]>([]);
  const [popup, setPopup] = useState<MqttTopic | null>(null);
  const laden = () => {
    fetch("/api/mqtt/status").then((r) => r.json()).then((j) => { if (j.ok) setStatus(j); }).catch(() => {});
    fetch("/api/mqtt/topics").then((r) => r.json()).then((j) => { if (j.ok) setTopics(j.topics ?? []); }).catch(() => {});
  };
  useEffect(() => { laden(); const t = setInterval(laden, 5000); return () => clearInterval(t); }, []);
  if (!status) return null;

  const fmtZeit = (ms: number) => { try { return new Date(ms).toLocaleTimeString("de-DE"); } catch { return ""; } };
  const vorText = (ms: number) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `vor ${s} s`;
    if (s < 3600) return `vor ${Math.round(s / 60)} min`;
    return `vor ${Math.round(s / 3600)} h`;
  };
  // Hübsche Payload-Anzeige (JSON eingerückt, sonst roh).
  const formatPayload = (p: string) => { try { return JSON.stringify(JSON.parse(p), null, 2); } catch { return p; } };

  return (
    <div className="card">
      <h3>MQTT-Broker</h3>
      <p className="hint">
        {status.laeuft
          ? `Eingebauter MQTT-Broker läuft auf Port ${status.port} (lokal, ohne Anmeldung). Geräte können hierhin publizieren; die empfangenen Topics erscheinen unten.`
          : `MQTT-Broker nicht aktiv${status.fehler ? ": " + status.fehler : ""}.`}
      </p>
      {status.laeuft && (
        topics.length === 0 ? (
          <p className="hint">Noch keine Nachrichten empfangen. Sobald ein Gerät auf den Broker publiziert, erscheinen die Topics hier.</p>
        ) : (
          <div className="table-scroll">
            <table className="rule-log">
              <thead><tr><th>Topic</th><th>Nachrichten</th><th>Letzte</th></tr></thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.topic} className="mqtt-topic-row" onClick={() => setPopup(t)} title="Letzte Daten anzeigen">
                    <td className="mqtt-topic-name">{t.topic}</td>
                    <td>{t.count}</td>
                    <td>{vorText(t.lastTs)} ({fmtZeit(t.lastTs)})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {popup && (
        <div className="kachel-add-overlay" onClick={() => setPopup(null)}>
          <div className="kachel-add-dialog mqtt-popup" onClick={(e) => e.stopPropagation()}>
            <h4>{popup.topic}</h4>
            <div className="mqtt-popup-meta">{popup.count} Nachrichten · zuletzt {vorText(popup.lastTs)} ({fmtZeit(popup.lastTs)})</div>
            <pre className="mqtt-payload">{formatPayload(popup.lastPayload)}</pre>
            <div className="kachel-add-btns"><button onClick={() => setPopup(null)}>Schließen</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
