// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useState, useEffect } from "react";
import { OffisLogo } from "./OffisLogo";
import { FluxLogo } from "./FluxLogo";
import { useVersion } from "./useVersion";

export type Child = { id: string; label: string };
export type Item = { id: string; label: string; children?: Child[] };
export type MenuConfig = Array<{ id: string; children?: Array<{ id: string }> }>;

export function buildItems(hasMarstek: boolean): Item[] {
  const detailsChildren: Child[] = [
    { id: "status", label: "Status" },
    { id: "verbraucher", label: "Verbraucher" },
    { id: "waermepumpe", label: "Wärmepumpe" },
    { id: "warmwasser", label: "Warmwasser" },
    { id: "stromverbrauch", label: "Stromverbrauch" },
    { id: "stromerzeugung", label: "Stromerzeugung" },
    { id: "boersenstrompreis", label: "Börsenstrompreis" },
    { id: "energysharing", label: "Energy Sharing" },
    { id: "wasserverbrauch", label: "Wasserverbrauch" },
  ];
  if (hasMarstek) detailsChildren.push({ id: "marstek", label: "Speicher" });
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
export function applyMenuConfig(defaults: Item[], config: MenuConfig | null): Item[] {
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
    let children: Child[] | undefined;
    if (def.children) {
      children = [];
      for (const cc of cfgItem.children ?? []) {
        const cdef = childById.get(cc.id);
        // Kind nur übernehmen, wenn es im Default DIESES Items vorkommt.
        if (cdef && (def.children.some((x) => x.id === cc.id))) {
          children.push(cdef);
          usedChild.add(cc.id);
        }
      }
      // Fehlende (neue) Kinder dieses Items hinten anhängen.
      for (const cdef of def.children) {
        if (!children.some((x) => x.id === cdef.id)) { children.push(cdef); usedChild.add(cdef.id); }
      }
    }
    result.push({ ...def, children });
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
}: {
  route: string;
  navigate: (r: string) => void;
  connected: boolean;
  open: boolean;
  setOpen: (o: boolean) => void;
  hasMarstek?: boolean;
}) {
  const version = useVersion();
  const defaults = buildItems(hasMarstek);
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
  // Welche Gruppen sind ausgeklappt? Standardmäßig die Gruppe der aktiven Seite.
  // Standardmäßig alle Gruppen ausgeklappt (Desktop zeigt so die volle Struktur).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ITEMS.filter((it) => it.children).map((it) => it.id))
  );

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
