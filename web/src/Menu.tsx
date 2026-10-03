// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useState, useEffect } from "react";
import { OffisLogo } from "./OffisLogo";
import { FluxLogo } from "./FluxLogo";
import { useVersion } from "./useVersion";

export type Child = { id: string; label: string; hidden?: boolean };
export type Item = { id: string; label: string; hidden?: boolean; children?: Child[] };
export type MenuConfig = Array<{ id: string; hidden?: boolean; children?: Array<{ id: string; hidden?: boolean }> }>;

export function buildItems(hasMarstek: boolean, hasSecuritySpy = false, hasAccessReader = false, hasEvcc = false, alle = false): Item[] {
  const detailsChildren: Child[] = [
    { id: "status", label: "Status" },
    { id: "anomalie", label: "Anomalie-Erkennung" },
    { id: "verbraucher", label: "Verbraucher" },
    { id: "waermepumpe", label: "Wärmepumpe" },
    { id: "warmwasser", label: "Warmwasser" },
    { id: "stromverbrauch", label: "Stromverbrauch" },
    { id: "stromerzeugung", label: "Stromerzeugung" },
    { id: "boersenstrompreis", label: "Börsenstrompreis" },
    { id: "wetter", label: "Wetter" },
    { id: "energysharing", label: "Energy Sharing" },
    { id: "wasserverbrauch", label: "Wasserverbrauch" },
    { id: "rueckblick", label: "Energie-Rückblick" },
  ];
  // Optionale (geräteabhängige) Seiten. Im "alle"-Modus (Menü-Editor) werden sie
  // immer aufgeführt, damit die Reihenfolge-Konfiguration IMMER vollständig ist –
  // unabhängig davon, ob die jeweilige Hardware gerade erkannt wird. Neue optionale
  // Seiten hier eintragen; sie erscheinen dann automatisch auch im Editor.
  const optionale: Array<{ id: string; label: string; aktiv: boolean }> = [
    { id: "marstek", label: "Speicher", aktiv: hasMarstek },
    { id: "kameras", label: "Kameras", aktiv: hasSecuritySpy },
    { id: "zugangskontrolle", label: "Zugangskontrolle", aktiv: hasAccessReader },
    { id: "elektroauto", label: "Elektroauto", aktiv: hasEvcc },
  ];
  for (const o of optionale) {
    if (alle || o.aktiv) detailsChildren.push({ id: o.id, label: o.label });
  }

  return [
    { id: "", label: "Gesamtansicht" },
    { id: "details", label: "Details", children: detailsChildren },
    {
      id: "einstellungen",
      label: "Einstellungen",
      children: [
        { id: "energiekosten", label: "Stromtarif & -anschluss" },
        { id: "quellen", label: "Quellen" },
        { id: "pvanlagen", label: "PV-Anlagendaten und Prognosen" },
        { id: "senken", label: "Senken" },
        { id: "eebus", label: "EEBUS-Netzsteuerung" },
        { id: "lastprofile", label: "Lastprofile" },
        { id: "erzeugerprofile", label: "Erzeugerprofile" },
        { id: "visualisierung", label: "Visualisierung" },
        { id: "importexport", label: "Import / Export" },
        { id: "datenverwaltung", label: "Daten verwalten" },
        { id: "automatisierung", label: "Automatisierungsregeln" },
        { id: "benachrichtigungen", label: "Benachrichtigungen" },
      ],
    },
    {
      id: "hilfe",
      label: "Hilfe",
      children: [
        { id: "hilfe-konzept", label: "Gesamtkonzept" },
        { id: "hilfe-konfiguration", label: "Konfiguration" },
        { id: "hilfe-auswertung", label: "Auswertung" },
        { id: "debug", label: "Debugging" },
        { id: "hilfe-api", label: "API-Endpunkte" },
      ],
    },
  ];
}

// Wendet eine gespeicherte Menü-Konfiguration (nur Reihenfolge/Gruppierung, per
// IDs) auf die Default-Items an. Labels stammen weiter aus dem Default, damit
// Umbenennungen in Updates automatisch greifen. Items/Children, die in der
// Config fehlen (z.B. neu hinzugekommen), werden hinten angehängt, sodass nie
// ein Menüpunkt verschwindet.
export function applyMenuConfig(defaults: Item[], config: MenuConfig | null, imEditor = false): Item[] {
  if (!config || config.length === 0) return defaults;
  // Nachschlage-Index über alle bekannten Items und Children (mit Labels).
  const topById = new Map<string, Item>();
  const childById = new Map<string, Child>();
  for (const it of defaults) {
    topById.set(it.id, it);
    for (const c of it.children ?? []) childById.set(c.id, c);
  }
  const usedTop = new Set<string>();
  const usedChild = new Set<string>();
  const result: Item[] = [];
  for (const cfgItem of config) {
    const def = topById.get(cfgItem.id);
    if (!def) continue; // unbekannte ID ignorieren
    usedTop.add(def.id);
    // Sichtbarkeit: im aktiven Menü versteckte Top-Punkte auslassen; im Editor
    // bleiben sie (mit hidden-Flag) erhalten, damit die Checkbox sie zeigt.
    const topHidden = cfgItem.hidden === true;
    let children: Child[] | undefined;
    if (def.children) {
      children = [];
      for (const cc of cfgItem.children ?? []) {
        const cdef = childById.get(cc.id);
        if (cdef && (def.children.some((x) => x.id === cc.id))) {
          if (imEditor) children.push({ ...cdef, hidden: cc.hidden === true } as any);
          else if (cc.hidden !== true) children.push(cdef);
          // WICHTIG: auch ausgeblendete Kinder als verarbeitet markieren, sonst
          // werden sie unten als "fehlend" wieder angehängt und die Ausblendung
          // ginge verloren.
          usedChild.add(cc.id);
        }
      }
      // Fehlende (neue) Kinder dieses Items hinten anhängen (sichtbar).
      for (const cdef of def.children) {
        // Nur WIRKLICH neue Kinder anhängen: solche, die noch nicht in der
        // gespeicherten Config vorkamen (usedChild). Ein ausgeblendetes Kind wurde
        // bereits verarbeitet (usedChild) und darf NICHT wieder auftauchen.
        if (!usedChild.has(cdef.id) && !children.some((x) => x.id === cdef.id)) { children.push(cdef); usedChild.add(cdef.id); }
      }
    }
    if (imEditor) result.push({ ...def, hidden: topHidden, children } as any);
    else if (!topHidden) result.push({ ...def, children });
  }
  // Fehlende (neue) Top-Items hinten anhängen.
  for (const def of defaults) {
    if (!usedTop.has(def.id)) result.push(def);
  }
  return result;
}

export function Menu({
  route,
  navigate,
  connected,
  open,
  setOpen,
  hasMarstek = false,
  hasSecuritySpy = false,
  hasAccessReader = false,
  hasEvcc = false,
}: {
  route: string;
  navigate: (r: string) => void;
  connected: boolean;
  open: boolean;
  setOpen: (o: boolean) => void;
  hasMarstek?: boolean;
  hasSecuritySpy?: boolean;
  hasAccessReader?: boolean;
  hasEvcc?: boolean;
}) {
  const version = useVersion();
  const defaults = buildItems(hasMarstek, hasSecuritySpy, hasAccessReader, hasEvcc);
  // Gespeicherte Menü-Konfiguration laden (Reihenfolge/Gruppierung). Bis sie da
  // ist, gilt der Default. Änderungen im Editor lösen ein "menuconfigchanged"-
  // Event aus, auf das wir hier neu laden.
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  useEffect(() => {
    const load = () => {
      fetch("/api/menu").then((r) => r.json()).then((j) => {
        if (j?.ok) setMenuConfig(j.config ?? null);
      }).catch(() => { /* Default bleibt */ });
    };
    load();
    window.addEventListener("menuconfigchanged", load);
    return () => window.removeEventListener("menuconfigchanged", load);
  }, []);
  const ITEMS = applyMenuConfig(defaults, menuConfig);
  // Welche Gruppen sind ausgeklappt? Standardmäßig alle – AUSSER "hilfe", das
  // spart Platz im mittlerweile langen Menü. Die Hilfe-Gruppe klappt automatisch
  // auf, sobald man eine Hilfe-Seite ansteuert (siehe useEffect unten).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ITEMS.filter((it) => it.children && it.id !== "hilfe").map((it) => it.id))
  );
  // Gespeicherten Klappzustand vom Server laden (geräteübergreifend). Nur wenn
  // bereits ein Zustand gespeichert wurde – sonst bleiben die Standard-Defaults.
  useEffect(() => {
    fetch("/api/menu/expanded").then((r) => r.json()).then((j) => {
      if (j?.ok && j.gesetzt && Array.isArray(j.expanded)) setExpanded(new Set(j.expanded));
    }).catch(() => {});
  }, []);

  // Beim Navigieren zu einer Seite die zugehörige Gruppe offen halten.
  useEffect(() => {
    setExpanded((prev) => {
      const s = new Set(prev);
      for (const it of ITEMS) {
        if (it.children?.some((c) => c.id === route)) s.add(it.id);
      }
      return s;
    });
  }, [route]);

  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      // Neuen Zustand serverseitig merken (geräteübergreifend).
      fetch("/api/menu/expanded", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expanded: [...s] }) }).catch(() => {});
      return s;
    });

  const go = (id: string) => {
    navigate(id);
    setOpen(false); // auf Mobile das Overlay schließen
  };

  return (
    <>
      {/* Top-Bar (immer sichtbar): Hamburger + Live-Anzeige */}
      <div className="topbar">
        <button
          className="hamburger"
          aria-label="Menü"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
          <span />
        </button>
        <button
          className="flux-logo-btn topbar-flux-btn"
          onClick={() => navigate("")}
          title="Zur Gesamtübersicht"
          aria-label="Zur Gesamtübersicht"
        >
          <FluxLogo className="topbar-flux-logo" />
        </button>
      </div>

      {/* Overlay-Hintergrund (nur mobil, wenn offen) */}
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}

      <nav className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-head">
          <button
            className="flux-logo-btn sidebar-flux-btn"
            onClick={() => { navigate(""); setOpen(false); }}
            title="Zur Gesamtübersicht"
            aria-label="Zur Gesamtübersicht"
          >
            <FluxLogo className="sidebar-flux-logo" />
          </button>
          <button
            className="sidebar-close"
            aria-label="Menü schließen"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="sidebar-items">
          {ITEMS.map((it) => {
            if (!it.children) {
              return (
                <a
                  key={it.id}
                  href={`#/${it.id}`}
                  className={`sidebar-link${route === it.id ? " active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(it.id);
                  }}
                >
                  {it.label}
                </a>
              );
            }
            const isExpanded = expanded.has(it.id);
            const groupActive = it.children.some((c) => c.id === route);
            return (
              <div key={it.id} className="sidebar-group">
                <button
                  className={`sidebar-group-label${groupActive ? " active" : ""}`}
                  onClick={() => toggleGroup(it.id)}
                  aria-expanded={isExpanded}
                >
                  <span>{it.label}</span>
                  <span className={`caret${isExpanded ? " up" : ""}`}>▾</span>
                </button>
                {isExpanded && (
                  <div className="sidebar-sub">
                    {it.children.map((c) => (
                      <a
                        key={c.id}
                        href={`#/${c.id}`}
                        className={`sidebar-link sub${route === c.id ? " active" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          go(c.id);
                        }}
                      >
                        {c.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <a href="http://www.offis.de" target="_blank" rel="noopener noreferrer" className="sidebar-footer-logo" title="OFFIS – www.offis.de">
            <OffisLogo />
          </a>
          <span
            className={`conn footer-conn ${connected ? "ok" : "lost"}`}
            onClick={() => { navigate(""); setOpen(false); }}
            role="button"
            tabIndex={0}
            title="Zur Gesamtansicht"
            style={{ cursor: "pointer" }}
          >
            {connected ? "live" : "connecting…"}
          </span>
          {version && <span className="sidebar-footer-version">{version}</span>}
        </div>
      </nav>
    </>
  );
}
