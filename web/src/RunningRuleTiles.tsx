// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useCallback, useRef } from "react";
import { SortableGrid, SortToggle, type SortableItem } from "./SortableGrid";
import { buildItems } from "./Menu";

// Liste aller FLUX-Seiten (route + Label) für die Link-Kachel-Auswahl. Nutzt den
// zentralen Menü-Aufbau im "alle"-Modus, damit auch geräteabhängige Seiten dabei
// sind – so ist die Auswahl automatisch vollständig, wenn neue Seiten hinzukommen.
function menuSeitenListe(): Array<{ route: string; label: string }> {
  const out: Array<{ route: string; label: string }> = [{ route: "", label: "Übersicht" }];
  for (const it of buildItems(true, true, true, true, true)) {
    if (it.children && it.children.length) {
      for (const c of it.children) out.push({ route: c.id, label: `${it.label}: ${c.label}` });
    } else if (it.id) {
      out.push({ route: it.id, label: it.label });
    }
  }
  return out;
}

// Generisches Kachel-System der Übersicht. Eine Kachel hat einen Typ und ein Ziel.
// Typen: "rule" (Automatisierungsregel), "shelly" (schaltbare Quelle). Weitere
// folgen (hue, homematic, alarm, szene, info).
interface OverviewTile {
  id: string;
  typ: "rule" | "shelly" | "hue" | "hmGroup" | "alarm" | "scene" | "klima" | "vallox" | "prusa" | "airSensor" | "link";
  ruleId?: string;
  sourceId?: string;
  channel?: number;
  // link: Sprungziel – interne Menüseite (linkRoute) ODER externe URL (linkUrl).
  linkRoute?: string;
  linkUrl?: string;
  linkLabel?: string;
  linkIcon?: string;
  // hue: serviceId der Leuchte; hmGroup: iseId (group:...) ; alarm: sourceId
  serviceId?: string;
  iseId?: string;
  // scene: Liste von Aktionen
  actions?: SceneAction[];
  name?: string;
}
// Eine Szenen-Aktion (Sammelaktion). Wiederverwendung der vorhandenen Schalt-APIs.
interface SceneAction {
  art: "shelly" | "hue" | "hmGroup" | "alarm";
  sourceId?: string; channel?: number; serviceId?: string; iseId?: string;
  on?: boolean; shutter?: "up" | "down" | "stop"; alarmModus?: string;
}
interface TileFolder { id: string; name: string; tiles: string[]; }
interface RunningRule { id: string; name: string; enabled: boolean; startedAt: number | null; }
interface SwitchableSrc { id: string; label: string; channels: number; }

const BEREICH = "rules";

// RGB(hex) -> CIE xy für Hue-Farbwahl (vereinfacht).
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

// CIE xy -> RGB(hex) für die Anzeige der aktuellen Lampenfarbe im Farbwähler.
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

export function RunningRuleTiles() {
  const [tiles, setTiles] = useState<OverviewTile[]>([]);
  const [rules, setRules] = useState<Map<string, RunningRule>>(new Map());
  const [switchables, setSwitchables] = useState<SwitchableSrc[]>([]);
  const [switchStates, setSwitchStates] = useState<Map<string, boolean | null>>(new Map());
  const [hueDevs, setHueDevs] = useState<any[]>([]);
  const [ccuDevs, setCcuDevs] = useState<any[]>([]);
  const [alarmQuellen, setAlarmQuellen] = useState<Array<{ id: string; modus: string }>>([]);
  const [klimaDevs, setKlimaDevs] = useState<any[]>([]);
  const [valloxDevs, setValloxDevs] = useState<any[]>([]);
  const [prusaDevs, setPrusaDevs] = useState<any[]>([]);
  const [airDevs, setAirDevs] = useState<any[]>([]);
  const [sortMode, setSortMode] = useState(false);
  const [folders, setFolders] = useState<TileFolder[]>([]);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sceneEdit, setSceneEdit] = useState<string | null>(null);
  const [dimPopup, setDimPopup] = useState<string | null>(null);
  const dragTileRef = useRef<string | null>(null);

  // Kacheln laden.
  const loadTiles = useCallback(() => {
    fetch("/api/overviewtiles").then((r) => r.json())
      .then((d) => { if (d?.ok && Array.isArray(d.tiles)) setTiles(d.tiles); }).catch(() => {});
  }, []);
  const saveTiles = useCallback((next: OverviewTile[]) => {
    setTiles(next);
    fetch("/api/overviewtiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tiles: next }) }).catch(() => {});
  }, []);

  // Regel-Status + schaltbare Quellen + deren Zustände laden.
  const loadData = useCallback(() => {
    Promise.all([
      fetch("/api/rules").then((r) => r.json()).catch(() => []),
      fetch("/api/rules/running").then((r) => r.json()).catch(() => []),
      fetch("/api/switchable").then((r) => r.json()).catch(() => []),
      fetch("/api/state").then((r) => r.json()).catch(() => null),
      fetch("/api/hue/devices").then((r) => r.json()).catch(() => null),
      fetch("/api/ccu/devices").then((r) => r.json()).catch(() => null),
      fetch("/api/klima/devices").then((r) => r.json()).catch(() => null),
      fetch("/api/vallox/devices").then((r) => r.json()).catch(() => null),
      fetch("/api/prusa/devices").then((r) => r.json()).catch(() => null),
      fetch("/api/air/devices").then((r) => r.json()).catch(() => null),
    ]).then(([all, running, sw, state, hue, ccu, klima, vallox, prusa, air]: any[]) => {
      const runById = new Map((running ?? []).map((r: any) => [r.id, r]));
      const rm = new Map<string, RunningRule>();
      for (const r of all ?? []) {
        const run: any = runById.get(r.id);
        rm.set(r.id, { id: r.id, name: r.name, enabled: r.enabled === true, startedAt: run ? run.startedAt : null });
      }
      setRules(rm);
      setSwitchables(sw ?? []);
      const ss = new Map<string, boolean | null>();
      for (const s of state?.sources ?? []) {
        if (s.switchState != null || s.switchable) ss.set(s.key ?? s.id, s.switchState ?? null);
      }
      setSwitchStates(ss);
      if (hue?.ok) setHueDevs(hue.devices ?? []);
      if (ccu?.ok) {
        setCcuDevs(ccu.devices ?? []);
        if (ccu.alarm) setAlarmQuellen(Object.keys(ccu.alarm).map((id) => ({ id, modus: ccu.alarm[id].modus })));
      }
      if (klima?.ok) setKlimaDevs(klima.devices ?? []);
      if (vallox?.ok) setValloxDevs(vallox.devices ?? []);
      if (prusa?.ok) setPrusaDevs(prusa.devices ?? []);
      if (air?.ok) setAirDevs(air.devices ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/tilefolders").then((r) => r.json())
      .then((d) => { if (d?.ok && Array.isArray(d.folders?.[BEREICH])) setFolders(d.folders[BEREICH]); }).catch(() => {});
  }, []);
  useEffect(() => { loadTiles(); }, [loadTiles]);
  useEffect(() => { loadData(); const t = setInterval(loadData, 5000); return () => clearInterval(t); }, [loadData]);
  useEffect(() => {
    const handler = () => setOpenFolder(null);
    window.addEventListener("flux-close-folder", handler);
    return () => window.removeEventListener("flux-close-folder", handler);
  }, []);

  const saveFolders = useCallback((next: TileFolder[]) => {
    setFolders(next);
    fetch("/api/tilefolders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bereich: BEREICH, folders: next }) }).catch(() => {});
  }, []);

  function triggerRule(id: string, start: boolean) {
    fetch(`/api/rules/${id}/trigger`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start }) }).then(() => loadData()).catch(() => {});
  }
  function schalteShelly(sourceId: string, on: boolean, channel?: number) {
    fetch("/api/switch/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, channel, on }) })
      .then((r) => r.json())
      .then((j) => { if (!j.ok && j.error) window.alert(`Schalten nicht möglich: ${j.error}`); setTimeout(loadData, 800); })
      .catch(() => {});
  }
  function schalteHue(sourceId: string, serviceId: string, on: boolean) {
    setHueDevs((prev) => prev.map((d: any) => d.serviceId === serviceId ? { ...d, on } : d));
    fetch("/api/hue/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, serviceId, on }) }).then(() => setTimeout(loadData, 1200)).catch(() => {});
  }
  function faerbeHue(sourceId: string, serviceId: string, colorX: number, colorY: number) {
    fetch("/api/hue/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, serviceId, on: true, colorX, colorY }) }).then(() => setTimeout(loadData, 800)).catch(() => {});
  }
  function dimmeHue(sourceId: string, serviceId: string, brightness: number) {
    fetch("/api/hue/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, serviceId, on: true, brightness }) }).then(() => setTimeout(loadData, 800)).catch(() => {});
  }
  function schalteHm(sourceId: string, iseId: string, wert: boolean | number | "stop") {
    fetch("/api/ccu/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, iseId, wert }) }).then(() => setTimeout(loadData, 800)).catch(() => {});
  }
  function setzeAlarm(sourceId: string, modus: string) {
    fetch("/api/ccu/alarm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, modus }) }).then(() => setTimeout(loadData, 1500)).catch(() => {});
  }
  function setzeKlima(sourceId: string, feld: string, wert: unknown) {
    fetch("/api/klima/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, feld, wert }) }).then(() => setTimeout(loadData, 1500)).catch(() => {});
  }
  function setzeVallox(sourceId: string, feld: string, wert: unknown) {
    fetch("/api/vallox/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, feld, wert }) }).then(() => setTimeout(loadData, 1500)).catch(() => {});
  }
  function fuehreSzeneAus(actions: SceneAction[]) {
    for (const a of actions) {
      if (a.art === "shelly" && a.sourceId) schalteShelly(a.sourceId, a.on === true, a.channel);
      else if (a.art === "hue" && a.sourceId && a.serviceId) schalteHue(a.sourceId, a.serviceId, a.on === true);
      else if (a.art === "hmGroup" && a.sourceId && a.iseId) schalteHm(a.sourceId, a.iseId, a.shutter === "up" ? 0 : a.shutter === "down" ? 100 : a.shutter === "stop" ? "stop" : (a.on === true));
      else if (a.art === "alarm" && a.sourceId && a.alarmModus) setzeAlarm(a.sourceId, a.alarmModus);
    }
  }

  // Kachel-Verwaltung
  function kachelHinzufuegen(t: OverviewTile) { saveTiles([...tiles, t]); setAddOpen(false); }
  // Kachel anlegen UND direkt in einen Ordner legen (aus der Ordner-Ansicht).
  function kachelHinzufuegenInOrdner(t: OverviewTile, fid: string) {
    saveTiles([...tiles, t]);
    saveFolders(folders.map((f) => f.id === fid ? { ...f, tiles: [...f.tiles, t.id] } : f));
    setAddOpen(false);
  }
  function kachelEntfernen(id: string) { saveTiles(tiles.filter((t) => t.id !== id)); saveFolders(folders.map((f) => ({ ...f, tiles: f.tiles.filter((x) => x !== id) }))); }

  // Ordner
  function ordnerErstellen() { const name = window.prompt("Name des neuen Ordners:", "Neuer Ordner"); if (!name) return; saveFolders([...folders, { id: `folder_${Date.now()}`, name: name.slice(0, 60), tiles: [] }]); }
  function ordnerUmbenennen(fid: string) { const f = folders.find((x) => x.id === fid); if (!f) return; const name = window.prompt("Ordner umbenennen:", f.name); if (!name) return; saveFolders(folders.map((x) => x.id === fid ? { ...x, name: name.slice(0, 60) } : x)); }
  function ordnerLoeschen(fid: string) { if (!window.confirm("Ordner löschen? Die Kacheln erscheinen wieder auf der obersten Ebene.")) return; saveFolders(folders.filter((x) => x.id !== fid)); if (openFolder === fid) setOpenFolder(null); }
  function kachelInOrdner(tileId: string, fid: string) { saveFolders(folders.map((f) => { const ohne = { ...f, tiles: f.tiles.filter((t) => t !== tileId) }; if (f.id === fid) ohne.tiles = [...ohne.tiles, tileId]; return ohne; })); }
  function kachelAusOrdner(tileId: string) { saveFolders(folders.map((f) => ({ ...f, tiles: f.tiles.filter((t) => t !== tileId) }))); }

  if (tiles.length === 0 && folders.length === 0 && !sortMode) {
    // Nichts angelegt: nur den Anordnen-Knopf zeigen (zum Hinzufügen).
    return (
      <div className="tile-sort-bar tile-sort-bar-zentriert">
        <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} label="Anpassen" />
      </div>
    );
  }

  const fmtTime = (ms: number | null) => { if (ms == null) return null; const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  // Eine Kachel als Node bauen (je nach Typ).
  // Fehler-/Platzhalter-Kachel, die IMMER löschbar bleibt (im Sortier-Modus).
  const fehlerKachel = (t: OverviewTile, text: string) => (
    <div className="rrt-tile rrt-missing">
      <div className="rrt-name">{text}</div>
      {sortMode && <div className="rrt-row"><button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button></div>}
    </div>
  );

  const tileNode = (t: OverviewTile) => {
    if (t.typ === "link") {
      const istExtern = !!t.linkUrl;
      const oeffnen = () => {
        if (istExtern) window.open(t.linkUrl, "_blank", "noopener");
        else if (t.linkRoute != null) window.location.hash = t.linkRoute ? `/${t.linkRoute}` : "/";
      };
      return (
        <div className="rrt-tile rrt-link" title={istExtern ? t.linkUrl : t.linkLabel} onClick={oeffnen} style={{ cursor: "pointer" }}>
          <div className="rrt-name">{t.linkIcon ? `${t.linkIcon} ` : (istExtern ? "🔗 " : "↗ ")}{t.linkLabel || t.name || (istExtern ? "Link" : "Seite")}</div>
          <div className="rrt-row">
            <span className="rrt-link-sub">{istExtern ? "externer Link" : "Seite öffnen"}</span>
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={(e) => { e.stopPropagation(); kachelEntfernen(t.id); }}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "rule" && t.ruleId) {
      const r = rules.get(t.ruleId);
      if (!r) return fehlerKachel(t, "Regel entfernt");
      const running = r.startedAt != null;
      return (
        <div className={`rrt-tile${running ? " rrt-running" : ""}${r.enabled ? " rrt-armed" : ""}`} title={r.enabled ? "Regel ist scharf" : "Regel ist nicht scharf"}>
          <div className="rrt-name" title={r.name}>{t.name || r.name}</div>
          <div className="rrt-row">
            <button className={`rrt-btn${running ? " rrt-stop" : ""}`} onClick={() => triggerRule(r.id, !running)} title={running ? "stoppen" : "starten"}>{running ? "⏹" : "▶"}</button>
            {running && <span className="rrt-since">seit {fmtTime(r.startedAt)}</span>}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
            {sortMode && openFolder != null && <button className="rrt-folder-remove" title="Aus Ordner nehmen" onClick={() => kachelAusOrdner(t.id)}>↑</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "shelly" && t.sourceId) {
      const sw = switchables.find((s) => s.id === t.sourceId);
      const zustand = switchStates.get(t.sourceId);
      const an = zustand === true;
      return (
        <div className={`rrt-tile rrt-shelly${an ? " rrt-on" : ""}`} title={t.name || sw?.label}>
          <div className="rrt-name">{t.name || sw?.label || "Schalter"}</div>
          <div className="rrt-row">
            <button className={`rrt-btn${an ? " rrt-stop" : ""}`} onClick={() => schalteShelly(t.sourceId!, !an, t.channel)} title={an ? "ausschalten" : "einschalten"}>{an ? "An" : "Aus"}</button>
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
            {sortMode && openFolder != null && <button className="rrt-folder-remove" title="Aus Ordner nehmen" onClick={() => kachelAusOrdner(t.id)}>↑</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "hue" && t.sourceId && t.serviceId) {
      const d = hueDevs.find((x) => x.serviceId === t.serviceId);
      const an = d?.on === true;
      return (
        <div className={`rrt-tile rrt-hue${an ? " rrt-on" : ""}`} title={t.name || d?.name}>
          <div className="rrt-name">{t.name || d?.name || "Hue"}</div>
          <div className="rrt-row">
            <button className={`rrt-btn${an ? " rrt-stop" : ""}`} onClick={() => schalteHue(t.sourceId!, t.serviceId!, !an)}>{an ? "An" : "Aus"}</button>
            {an && d?.hatDimmen && (
              <span className="rrt-dim-wrap">
                <button className="rrt-dim-btn" title="Helligkeit" onClick={() => setDimPopup(dimPopup === t.id ? null : t.id)}>
                  ☀ {d?.brightness ?? 100}%
                </button>
                {dimPopup === t.id && (
                  <span className="rrt-dim-popup">
                    <input type="range" min={1} max={100} defaultValue={d?.brightness ?? 100}
                      onMouseUp={(e) => dimmeHue(t.sourceId!, t.serviceId!, Number((e.target as HTMLInputElement).value))}
                      onTouchEnd={(e) => dimmeHue(t.sourceId!, t.serviceId!, Number((e.target as HTMLInputElement).value))} />
                  </span>
                )}
              </span>
            )}
            {an && d?.hatFarbe && (
              <input type="color" className="rrt-color" title="Farbe"
                value={d?.colorX != null && d?.colorY != null ? xyToHex(d.colorX, d.colorY) : "#ffffff"}
                onChange={(e) => { const { x, y } = hexToXy(e.target.value); faerbeHue(t.sourceId!, t.serviceId!, x, y); }} />
            )}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "hmGroup" && t.sourceId && t.iseId) {
      const d = ccuDevs.find((x) => x.id === t.iseId);
      const istShutter = d?.kind === "shutter";
      // Sensor-Gerät (Temperatur/Feuchte)? Dann Messwerte statt Schalter zeigen.
      const istSensor = d && !istShutter && (d.kind === "temperature" || d.kind === "humidity"
        || d.datapoint === "actualTemperature" || d.datapoint === "humidity" || d.datapoint === "setPointTemperature");
      if (istSensor) {
        // Alle Datenpunkte desselben Geräts sammeln (gleiche deviceId = id vor ":").
        const devId = String(t.iseId).split(":")[0];
        const punkte = ccuDevs.filter((x) => String(x.id).split(":")[0] === devId);
        const val = (dp: string) => punkte.find((p) => p.datapoint === dp)?.wert;
        const temp = val("actualTemperature");
        const feuchte = val("humidity");
        const raum = d?.room || t.name || "Sensor";
        return (
          <div className="rrt-tile rrt-hm rrt-sensor" title={raum}>
            <div className="rrt-name">{raum}</div>
            <div className="rrt-sensor-werte">
              {temp != null && <span>🌡️ {typeof temp === "number" ? temp.toFixed(1) : temp} °C</span>}
              {feuchte != null && <span>💧 {feuchte} %</span>}
            </div>
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        );
      }
      const pos = typeof d?.wert === "number" ? d.wert : null;
      return (
        <div className="rrt-tile rrt-hm" title={t.name || d?.name}>
          <div className="rrt-name">{t.name || d?.name || "Homematic"}{pos != null && istShutter ? ` (${pos}%)` : ""}</div>
          <div className="rrt-row">
            {istShutter ? (
              <>
                <button className="rrt-btn" onClick={() => schalteHm(t.sourceId!, t.iseId!, 0)} title="hoch">▲</button>
                <button className="rrt-btn" onClick={() => schalteHm(t.sourceId!, t.iseId!, "stop")} title="stopp">■</button>
                <button className="rrt-btn" onClick={() => schalteHm(t.sourceId!, t.iseId!, 100)} title="runter">▼</button>
              </>
            ) : (
              <button className={`rrt-btn${d?.wert === true ? " rrt-stop" : ""}`} onClick={() => schalteHm(t.sourceId!, t.iseId!, !(d?.wert === true))}>{d?.wert === true ? "An" : "Aus"}</button>
            )}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "alarm" && t.sourceId) {
      const a = alarmQuellen.find((x) => x.id === t.sourceId);
      const modus = a?.modus ?? "?";
      return (
        <div className={`rrt-tile rrt-alarm rrt-alarm-${modus}`} title="Alarmanlage">
          <div className="rrt-name">Alarm: {modus === "vollschutz" ? "Vollschutz" : modus === "anwesenheit" ? "Anwesenheit" : modus === "unscharf" ? "Unscharf" : modus}</div>
          <div className="rrt-row rrt-alarm-btns">
            <button className={modus === "unscharf" ? "aktiv" : ""} onClick={() => setzeAlarm(t.sourceId!, "unscharf")} title="Unscharf">U</button>
            <button className={modus === "anwesenheit" ? "aktiv" : ""} onClick={() => setzeAlarm(t.sourceId!, "anwesenheit")} title="Anwesenheit">A</button>
            <button className={modus === "vollschutz" ? "aktiv" : ""} onClick={() => setzeAlarm(t.sourceId!, "vollschutz")} title="Vollschutz">V</button>
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "scene") {
      return (
        <div className="rrt-tile rrt-scene" title={t.name}>
          <div className="rrt-name">{t.name || "Szene"}</div>
          <div className="rrt-row">
            <button className="rrt-btn" onClick={() => fuehreSzeneAus(t.actions ?? [])} title="Szene ausführen">▶ Start</button>
            {sortMode && <button className="rrt-scene-edit" title="Szene bearbeiten" onClick={() => setSceneEdit(t.id)}>✎</button>}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "klima" && t.sourceId) {
      const d = klimaDevs.find((x) => x.sourceId === t.sourceId);
      const an = d?.power === true;
      return (
        <div className={`rrt-tile rrt-klima${an ? " an" : ""}`} title={t.name || d?.label}>
          <div className="rrt-name">{t.name || d?.label || "Klima"}{an && d?.mode ? ` · ${d.mode}` : ""}{d?.roomTemp != null ? ` · ${d.roomTemp.toFixed(1)}°` : ""}</div>
          <div className="rrt-row">
            <button className={`rrt-btn${an ? " rrt-stop" : ""}`} onClick={() => setzeKlima(t.sourceId!, "power", !an)}>{an ? "An" : "Aus"}</button>
            {an && d?.temp != null && (
              <span className="rrt-klima-temp">
                <button className="rrt-klima-tempbtn" onClick={() => setzeKlima(t.sourceId!, "temp", Math.max(16, (d.temp) - 1))}>−</button>
                <b>{d.temp.toFixed(0)}°</b>
                <button className="rrt-klima-tempbtn" onClick={() => setzeKlima(t.sourceId!, "temp", Math.min(31, (d.temp) + 1))}>+</button>
              </span>
            )}
            {an && (
              <span className="rrt-dim-wrap">
                <button className="rrt-dim-btn" title="Mehr" onClick={() => setDimPopup(dimPopup === t.id ? null : t.id)}>⚙</button>
                {dimPopup === t.id && (
                  <span className="rrt-dim-popup rrt-klima-popup" onClick={(e) => e.stopPropagation()}>
                    <label>Modus <select value={d?.mode ?? "COOL"} onChange={(e) => setzeKlima(t.sourceId!, "mode", e.target.value)}>{["AUTO", "HEAT", "COOL", "DRY", "FAN_ONLY"].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                    <label>Lüfter <select value={d?.fan ?? "AUTO"} onChange={(e) => setzeKlima(t.sourceId!, "fan", e.target.value)}>{["AUTO", "QUIET", "1", "2", "3", "4"].map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
                    <label>Lamelle <select value={d?.vane ?? "AUTO"} onChange={(e) => setzeKlima(t.sourceId!, "vane", e.target.value)}>{["AUTO", "SWING", "1", "2", "3", "4", "5"].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
                  </span>
                )}
              </span>
            )}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "vallox" && t.sourceId) {
      const d = valloxDevs.find((x) => x.sourceId === t.sourceId);
      const an = d?.on === true;
      return (
        <div className={`rrt-tile rrt-vallox${an ? " an" : ""}`} title={t.name || d?.label}>
          <div className="rrt-name">{t.name || d?.label || "Lüftung"}{an && d?.mode ? ` · ${d.mode}` : ""}{d?.tempInside != null ? ` · innen ${d.tempInside.toFixed(0)}°` : ""}</div>
          <div className="rrt-row">
            <button className={`rrt-btn${an ? " rrt-stop" : ""}`} onClick={() => setzeVallox(t.sourceId!, "power", !an)}>{an ? "An" : "Aus"}</button>
            {an && d?.speed != null && (
              <span className="rrt-klima-temp">
                <span className="rrt-vallox-lbl">Stufe</span>
                <button className="rrt-klima-tempbtn" onClick={() => setzeVallox(t.sourceId!, "speed", Math.max(1, (d.speed) - 1))}>−</button>
                <b>{d.speed}</b>
                <button className="rrt-klima-tempbtn" onClick={() => setzeVallox(t.sourceId!, "speed", Math.min(8, (d.speed) + 1))}>+</button>
              </span>
            )}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "prusa" && t.sourceId) {
      const d = prusaDevs.find((x) => x.sourceId === t.sourceId);
      const druckt = d?.jobAktiv === true;
      const restMin = d?.jobRestzeitSek != null ? Math.round(d.jobRestzeitSek / 60) : null;
      const restText = restMin != null ? (restMin >= 60 ? `${Math.floor(restMin / 60)}h ${restMin % 60}min` : `${restMin} min`) : null;
      const an = d?.switchState === true;
      const schaltbar = !!d?.switchSourceId;
      return (
        <div className={`rrt-tile rrt-prusa${druckt ? " rrt-running" : ""}`} title={t.name || d?.label}>
          <div className="rrt-name">{t.name || d?.label || "3D-Drucker"}{d?.jobFortschritt != null ? ` · ${d.jobFortschritt}%` : ""}</div>
          <div className="rrt-row">
            {schaltbar && (
              <button className={`rrt-btn${an ? " rrt-stop" : ""}`}
                onClick={() => schalteShelly(d.switchSourceId, !an)}
                title={an ? "Steckdose ausschalten" : "Steckdose einschalten"}>{an ? "An" : "Aus"}</button>
            )}
            {druckt && restText && <span className="rrt-prusa-rest" title="Restdruckzeit">⏱ {restText}</span>}
            {!druckt && d?.state && <span className="rrt-prusa-state">{d.state}</span>}
            {sortMode && <button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button>}
          </div>
        </div>
      );
    }
    if (t.typ === "airSensor" && t.sourceId) {
      const d = airDevs.find((x) => x.sourceId === t.sourceId);
      return (
        <div className="rrt-tile rrt-air" title={t.name || d?.label}>
          <div className="rrt-name">{t.name || d?.label || "Luftsensor"}</div>
          <div className="rrt-air-werte">
            {d?.pm25 != null && <span className="rrt-air-wert"><b>{d.pm25}</b><span className="rrt-air-lbl">PM2.5</span></span>}
            {d?.pm10 != null && <span className="rrt-air-wert"><b>{d.pm10}</b><span className="rrt-air-lbl">PM10</span></span>}
            {d?.temperature != null && <span className="rrt-air-wert"><b>{d.temperature.toFixed(1)}°</b><span className="rrt-air-lbl">Temp</span></span>}
          </div>
          {sortMode && <div className="rrt-row"><button className="rrt-folder-remove" title="Kachel entfernen" onClick={() => kachelEntfernen(t.id)}>✕</button></div>}
        </div>
      );
    }
    return fehlerKachel(t, "Unbekannt");
  };

  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const inOrdner = new Set(folders.flatMap((f) => f.tiles));

  // === Innerhalb eines Ordners ===
  if (openFolder != null) {
    const f = folders.find((x) => x.id === openFolder);
    if (!f) { setOpenFolder(null); return null; }
    const inhalt: SortableItem[] = f.tiles.map((tid) => tileById.get(tid)).filter((t): t is OverviewTile => !!t).map((t) => ({ id: t.id, node: tileNode(t) }));
    return (
      <div>
        <div className="rrt-folder-bar">
          <button className="rrt-folder-back" onClick={() => setOpenFolder(null)} title="Zurück">←</button>
          <span className="rrt-folder-titel">{f.name}</span>
          {sortMode && (<><button className="tile-sort-toggle" onClick={() => setAddOpen(true)}>+ Kachel</button><button className="rrt-folder-act" onClick={() => ordnerUmbenennen(f.id)}>Umbenennen</button><button className="rrt-folder-act" onClick={() => ordnerLoeschen(f.id)}>Löschen</button></>)}
          <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} label="Anpassen" />
        </div>
        <p className="tile-sort-hint">Im Ordner „{f.name}". Klick oben in den Energiefluss-Bereich oder auf ← zum Zurückkehren.</p>
        {inhalt.length === 0 ? <p className="tile-sort-hint">Leerer Ordner. „+ Kachel" fügt direkt hier hinzu, oder ziehe Kacheln von der obersten Ebene herein.</p> : <SortableGrid bereich={`folder_${f.id}`} className="rrt-wrap" items={inhalt} sortMode={sortMode} />}
        {addOpen && <KachelHinzufuegen rules={[...rules.values()]} switchables={switchables} hueDevs={hueDevs} ccuDevs={ccuDevs} alarmQuellen={alarmQuellen} klimaDevs={klimaDevs} valloxDevs={valloxDevs} prusaDevs={prusaDevs} airDevs={airDevs} onAdd={(t) => kachelHinzufuegenInOrdner(t, f.id)} onClose={() => setAddOpen(false)} />}
      </div>
    );
  }

  // === Oberste Ebene ===
  const freie: SortableItem[] = tiles.filter((t) => !inOrdner.has(t.id)).map((t) => ({ id: t.id, node: tileNode(t) }));
  const ordnerKacheln: SortableItem[] = folders.map((f) => ({
    id: `F:${f.id}`,
    node: (
      <div className="rrt-folder-tile" onClick={() => { if (!sortMode) setOpenFolder(f.id); }}
        onDragOver={sortMode ? (e) => { e.preventDefault(); } : undefined}
        onDrop={sortMode ? (e) => { e.preventDefault(); const tid = (() => { try { return e.dataTransfer.getData("text/plain"); } catch { return ""; } })() || dragTileRef.current; dragTileRef.current = null; if (tid && !tid.startsWith("F:")) kachelInOrdner(tid, f.id); } : undefined}
        title={sortMode ? "Kacheln hierher ziehen" : `Ordner „${f.name}" öffnen`}>
        <div className="rrt-folder-icon">▤</div>
        <div className="rrt-folder-name">{f.name}</div>
        <div className="rrt-folder-count">{f.tiles.length} {f.tiles.length === 1 ? "Kachel" : "Kacheln"}</div>
        {sortMode && <button className="rrt-folder-open-edit" onClick={(e) => { e.stopPropagation(); setOpenFolder(f.id); }} title="öffnen">▸</button>}
      </div>
    ),
  }));
  const alle = [...ordnerKacheln, ...freie];

  return (
    <div onDragStartCapture={(e) => { try { const id = (e as any).dataTransfer?.getData?.("text/plain"); if (id) dragTileRef.current = id; } catch { /* ignore */ } }}>
      <div className="tile-sort-bar tile-sort-bar-zentriert">
        {sortMode && <button className="tile-sort-toggle" onClick={() => setAddOpen(true)}>+ Kachel</button>}
        {sortMode && <button className="tile-sort-toggle" onClick={ordnerErstellen}>+ Ordner</button>}
        <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} label="Anpassen" />
      </div>
      {sortMode && <p className="tile-sort-hint">Kacheln ziehen zum Anordnen. Auf einen Ordner ziehen, um sie hineinzulegen. „+ Kachel" fügt eine neue hinzu.</p>}
      <SortableGrid bereich={BEREICH} className="rrt-wrap" items={alle} sortMode={sortMode} />
      {addOpen && <KachelHinzufuegen rules={[...rules.values()]} switchables={switchables} hueDevs={hueDevs} ccuDevs={ccuDevs} alarmQuellen={alarmQuellen} klimaDevs={klimaDevs} valloxDevs={valloxDevs} prusaDevs={prusaDevs} airDevs={airDevs} onAdd={kachelHinzufuegen} onClose={() => setAddOpen(false)} />}
      {sceneEdit && (() => {
        const t = tiles.find((x) => x.id === sceneEdit);
        if (!t) return null;
        return <SzenenEditor tile={t} switchables={switchables} hueDevs={hueDevs} ccuDevs={ccuDevs} alarmQuellen={alarmQuellen}
          onSave={(actions, name) => { saveTiles(tiles.map((x) => x.id === t.id ? { ...x, actions, name } : x)); setSceneEdit(null); }}
          onClose={() => setSceneEdit(null)} />;
      })()}
    </div>
  );
}

// Dialog zum Hinzufügen einer Kachel. Typen erscheinen nur, wenn passende Ziele
// existieren (z. B. Hue nur bei vorhandenen Hue-Leuchten).
function KachelHinzufuegen({ rules, switchables, hueDevs, ccuDevs, alarmQuellen, klimaDevs, valloxDevs, prusaDevs, airDevs, onAdd, onClose }: {
  rules: RunningRule[]; switchables: SwitchableSrc[]; hueDevs: any[]; ccuDevs: any[]; alarmQuellen: Array<{ id: string; modus: string }>; klimaDevs: any[]; valloxDevs: any[]; prusaDevs: any[]; airDevs: any[];
  onAdd: (t: OverviewTile) => void; onClose: () => void;
}) {
  const hueLampen = hueDevs.filter((d) => d.kind === "light");
  const hmSchaltbar = ccuDevs.filter((d) => d.schaltbar);
  // Sensor-Geräte (Temperatur/Feuchte) einmalig je Gerät für die Kachelauswahl.
  const hmSensoren = (() => {
    const proGeraet = new Map<string, any>();
    for (const d of ccuDevs) {
      if (d.datapoint === "actualTemperature" || d.datapoint === "humidity") {
        const devId = String(d.id).split(":")[0];
        // Den actualTemperature-Datenpunkt bevorzugen (stabile iseId für die Kachel).
        if (!proGeraet.has(devId) || d.datapoint === "actualTemperature") proGeraet.set(devId, d);
      }
    }
    return [...proGeraet.values()];
  })();
  const typen: Array<{ v: string; l: string }> = [];
  if (rules.length) typen.push({ v: "rule", l: "Automatisierungsregel" });
  if (switchables.length) typen.push({ v: "shelly", l: "Schalter (Shelly/Tasmota)" });
  if (hueLampen.length) typen.push({ v: "hue", l: "Hue-Leuchte" });
  if (hmSchaltbar.length || hmSensoren.length) typen.push({ v: "hmGroup", l: "Homematic (Schalter/Rollladen/Sensor/Gruppe)" });
  if (alarmQuellen.length) typen.push({ v: "alarm", l: "Homematic Alarm-Modus" });
  if (klimaDevs.length) typen.push({ v: "klima", l: "Klimaanlage" });
  if (valloxDevs.length) typen.push({ v: "vallox", l: "Lüftungsanlage" });
  if (prusaDevs.length) typen.push({ v: "prusa", l: "3D-Drucker (Prusa)" });
  if (airDevs.length) typen.push({ v: "airSensor", l: "Luftsensor" });
  typen.push({ v: "scene", l: "Szene (Sammelaktion)" });
  typen.push({ v: "link", l: "Link (Seite oder URL)" });

  const [typ, setTyp] = useState<string>(typen[0]?.v ?? "rule");
  const [ziel, setZiel] = useState("");
  const [sceneName, setSceneName] = useState("Neue Szene");
  const [linkZielart, setLinkZielart] = useState<"route" | "url">("route");
  const [linkRoute, setLinkRoute] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  // Interne Seiten für die Link-Auswahl (aus dem Menü-Aufbau).
  const menuSeiten = menuSeitenListe();

  function add() {
    const id = `tile_${typ}_${Date.now()}`;
    if (typ === "rule" && ziel) onAdd({ id, typ: "rule", ruleId: ziel });
    else if (typ === "shelly" && ziel) onAdd({ id, typ: "shelly", sourceId: ziel });
    else if (typ === "hue" && ziel) { const d = hueLampen.find((x) => x.serviceId === ziel); onAdd({ id, typ: "hue", sourceId: d?.sourceId, serviceId: ziel }); }
    else if (typ === "hmGroup" && ziel) { const d = hmSchaltbar.find((x) => x.id === ziel) || hmSensoren.find((x) => x.id === ziel); onAdd({ id, typ: "hmGroup", sourceId: d?.sourceId, iseId: ziel }); }
    else if (typ === "alarm" && ziel) onAdd({ id, typ: "alarm", sourceId: ziel });
    else if (typ === "klima" && ziel) onAdd({ id, typ: "klima", sourceId: ziel });
    else if (typ === "vallox" && ziel) onAdd({ id, typ: "vallox", sourceId: ziel });
    else if (typ === "prusa" && ziel) onAdd({ id, typ: "prusa", sourceId: ziel });
    else if (typ === "airSensor" && ziel) onAdd({ id, typ: "airSensor", sourceId: ziel });
    else if (typ === "scene") onAdd({ id, typ: "scene", name: sceneName.slice(0, 60), actions: [] });
    else if (typ === "link") {
      if (linkZielart === "url" && linkUrl.trim()) {
        const label = linkLabel.trim() || linkUrl.trim();
        onAdd({ id, typ: "link", linkUrl: linkUrl.trim(), linkLabel: label });
      } else if (linkZielart === "route") {
        const seite = menuSeiten.find((s) => s.route === linkRoute);
        const label = linkLabel.trim() || seite?.label || "Seite";
        onAdd({ id, typ: "link", linkRoute, linkLabel: label });
      }
    }
  }
  const zielPflicht = typ !== "scene" && typ !== "link";
  const linkGueltig = typ === "link" && (linkZielart === "url" ? linkUrl.trim() !== "" : linkRoute !== "" || linkLabel.trim() !== "");
  return (
    <div className="kachel-add-overlay" onClick={onClose}>
      <div className="kachel-add-dialog" onClick={(e) => e.stopPropagation()}>
        <h4>Kachel hinzufügen</h4>
        <label>Typ</label>
        <select value={typ} onChange={(e) => { setTyp(e.target.value); setZiel(""); }}>
          {typen.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        {typ === "rule" && (<><label>Regel</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></>)}
        {typ === "shelly" && (<><label>Schalter</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{switchables.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></>)}
        {typ === "hue" && (<><label>Leuchte</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{hueLampen.map((d) => <option key={d.serviceId} value={d.serviceId}>{d.room ? d.room + ": " : ""}{d.name}</option>)}</select></>)}
        {typ === "hmGroup" && (<><label>Gerät/Gruppe</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{hmSchaltbar.map((d) => <option key={d.id} value={d.id}>{d.istGruppe ? "▤ " : ""}{d.room ? d.room + ": " : ""}{d.name}</option>)}{hmSensoren.map((d) => <option key={d.id} value={d.id}>🌡️ {d.room || d.name}</option>)}</select></>)}
        {typ === "alarm" && (<><label>Alarmanlage</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{alarmQuellen.map((a) => <option key={a.id} value={a.id}>Alarmanlage ({a.modus})</option>)}</select></>)}
        {typ === "klima" && (<><label>Klimaanlage</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{klimaDevs.map((d) => <option key={d.sourceId} value={d.sourceId}>{d.label}</option>)}</select></>)}
        {typ === "vallox" && (<><label>Lüftungsanlage</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{valloxDevs.map((d) => <option key={d.sourceId} value={d.sourceId}>{d.label}</option>)}</select></>)}
        {typ === "prusa" && (<><label>3D-Drucker</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{prusaDevs.map((d) => <option key={d.sourceId} value={d.sourceId}>{d.label}</option>)}</select></>)}
        {typ === "airSensor" && (<><label>Luftsensor</label><select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– wählen –</option>{airDevs.map((d) => <option key={d.sourceId} value={d.sourceId}>{d.label}</option>)}</select></>)}
        {typ === "scene" && (<><label>Name der Szene</label><input type="text" value={sceneName} onChange={(e) => setSceneName(e.target.value)} /><p className="hint">Die Aktionen der Szene können nach dem Anlegen bearbeitet werden.</p></>)}
        {typ === "link" && (
          <>
            <label>Ziel</label>
            <select value={linkZielart} onChange={(e) => setLinkZielart(e.target.value as "route" | "url")}>
              <option value="route">Seite in FLUX</option>
              <option value="url">Externe URL</option>
            </select>
            {linkZielart === "route" ? (
              <><label>Seite</label>
                <select value={linkRoute} onChange={(e) => setLinkRoute(e.target.value)}>
                  <option value="">– wählen –</option>
                  {menuSeiten.map((s) => <option key={s.route} value={s.route}>{s.label}</option>)}
                </select></>
            ) : (
              <><label>URL</label>
                <input type="text" value={linkUrl} placeholder="https://…" onChange={(e) => setLinkUrl(e.target.value)} /></>
            )}
            <label>Beschriftung (optional)</label>
            <input type="text" value={linkLabel} placeholder="Anzeigename der Kachel" onChange={(e) => setLinkLabel(e.target.value)} />
          </>
        )}
        <div className="kachel-add-btns">
          <button onClick={onClose}>Abbrechen</button>
          <button className="src-add-btn" onClick={add} disabled={(zielPflicht && !ziel) || (typ === "link" && !linkGueltig)}>Hinzufügen</button>
        </div>
      </div>
    </div>
  );
}

// Editor zum Zusammenstellen der Aktionen einer Szene.
function SzenenEditor({ tile, switchables, hueDevs, ccuDevs, alarmQuellen, onSave, onClose }: {
  tile: OverviewTile; switchables: SwitchableSrc[]; hueDevs: any[]; ccuDevs: any[]; alarmQuellen: Array<{ id: string; modus: string }>;
  onSave: (actions: SceneAction[], name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(tile.name || "Szene");
  const [actions, setActions] = useState<SceneAction[]>(tile.actions ?? []);
  // Neue-Aktion-Formular
  const [art, setArt] = useState<"shelly" | "hue" | "hmGroup" | "alarm">("shelly");
  const [ziel, setZiel] = useState("");
  const [zustand, setZustand] = useState("on");

  const hueLampen = hueDevs.filter((d) => d.kind === "light");
  const hmSchaltbar = ccuDevs.filter((d) => d.schaltbar);

  const verfuegbareArten: Array<{ v: string; l: string }> = [];
  if (switchables.length) verfuegbareArten.push({ v: "shelly", l: "Schalter" });
  if (hueLampen.length) verfuegbareArten.push({ v: "hue", l: "Hue-Leuchte" });
  if (hmSchaltbar.length) verfuegbareArten.push({ v: "hmGroup", l: "Homematic" });
  if (alarmQuellen.length) verfuegbareArten.push({ v: "alarm", l: "Alarm-Modus" });

  function aktionHinzufuegen() {
    if (art !== "alarm" && !ziel) return;
    let a: SceneAction;
    if (art === "shelly") a = { art, sourceId: ziel, on: zustand === "on" };
    else if (art === "hue") { const d = hueLampen.find((x) => x.serviceId === ziel); a = { art, sourceId: d?.sourceId, serviceId: ziel, on: zustand === "on" }; }
    else if (art === "hmGroup") { const d = hmSchaltbar.find((x) => x.id === ziel); const istShutter = d?.kind === "shutter"; a = { art, sourceId: d?.sourceId, iseId: ziel, ...(istShutter ? { shutter: zustand as any } : { on: zustand === "on" }) }; }
    else a = { art: "alarm", sourceId: alarmQuellen[0]?.id, alarmModus: zustand };
    setActions([...actions, a]);
    setZiel("");
  }
  function aktionEntfernen(i: number) { setActions(actions.filter((_, idx) => idx !== i)); }

  // Klartext einer Aktion für die Liste.
  function beschr(a: SceneAction): string {
    if (a.art === "shelly") { const s = switchables.find((x) => x.id === a.sourceId); return `Schalter ${s?.label ?? a.sourceId}: ${a.on ? "an" : "aus"}`; }
    if (a.art === "hue") { const d = hueLampen.find((x) => x.serviceId === a.serviceId); return `Hue ${d?.name ?? ""}: ${a.on ? "an" : "aus"}`; }
    if (a.art === "hmGroup") { const d = hmSchaltbar.find((x) => x.id === a.iseId); const z = a.shutter ? (a.shutter === "up" ? "hoch" : a.shutter === "down" ? "runter" : "stopp") : (a.on ? "an" : "aus"); return `HM ${d?.name ?? ""}: ${z}`; }
    if (a.art === "alarm") return `Alarm: ${a.alarmModus}`;
    return "?";
  }

  // Zustands-Optionen je Art/Ziel.
  const istShutterZiel = art === "hmGroup" && hmSchaltbar.find((x) => x.id === ziel)?.kind === "shutter";

  return (
    <div className="kachel-add-overlay" onClick={onClose}>
      <div className="kachel-add-dialog szenen-editor" onClick={(e) => e.stopPropagation()}>
        <h4>Szene bearbeiten</h4>
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="szene-aktionen">
          <div className="szene-aktionen-titel">Aktionen ({actions.length})</div>
          {actions.length === 0 && <p className="hint">Noch keine Aktionen. Unten hinzufügen.</p>}
          {actions.map((a, i) => (
            <div key={i} className="szene-aktion-zeile">
              <span>{beschr(a)}</span>
              <button onClick={() => aktionEntfernen(i)} title="entfernen">✕</button>
            </div>
          ))}
        </div>

        <div className="szene-neu">
          <div className="szene-aktionen-titel">Aktion hinzufügen</div>
          <div className="szene-neu-row">
            <select value={art} onChange={(e) => { setArt(e.target.value as any); setZiel(""); setZustand("on"); }}>
              {verfuegbareArten.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
            </select>
            {art === "shelly" && <select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– Ziel –</option>{switchables.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}
            {art === "hue" && <select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– Ziel –</option>{hueLampen.map((d) => <option key={d.serviceId} value={d.serviceId}>{d.room ? d.room + ": " : ""}{d.name}</option>)}</select>}
            {art === "hmGroup" && <select value={ziel} onChange={(e) => setZiel(e.target.value)}><option value="">– Ziel –</option>{hmSchaltbar.map((d) => <option key={d.id} value={d.id}>{d.istGruppe ? "▤ " : ""}{d.name}</option>)}</select>}
            {/* Zustandswahl */}
            {art === "alarm" ? (
              <select value={zustand} onChange={(e) => setZustand(e.target.value)}>
                <option value="unscharf">unscharf</option><option value="anwesenheit">Anwesenheit</option><option value="vollschutz">Vollschutz</option>
              </select>
            ) : istShutterZiel ? (
              <select value={zustand} onChange={(e) => setZustand(e.target.value)}>
                <option value="up">hoch</option><option value="down">runter</option><option value="stop">stopp</option>
              </select>
            ) : (
              <select value={zustand} onChange={(e) => setZustand(e.target.value)}>
                <option value="on">an</option><option value="off">aus</option>
              </select>
            )}
            <button className="src-add-btn" onClick={aktionHinzufuegen}>+ Aktion</button>
          </div>
        </div>

        <div className="kachel-add-btns">
          <button onClick={onClose}>Abbrechen</button>
          <button className="src-add-btn" onClick={() => onSave(actions, name.slice(0, 60))}>Speichern</button>
        </div>
      </div>
    </div>
  );
}
