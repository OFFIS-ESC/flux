// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { buildItems, applyMenuConfig, type Item, type MenuConfig } from "./Menu";

// Editor für die Menüstruktur: Reihenfolge der Hauptpunkte und der Unterpunkte
// (innerhalb ihrer Gruppe) per Drag&Drop anpassen. Gespeichert wird nur die
// Struktur (IDs) – die Beschriftungen stammen weiter aus dem Programm. Nach dem
// Speichern aktualisiert sich das Menü automatisch (Event "menuconfigchanged").

export function MenuEditor({ hasMarstek }: { hasMarstek?: boolean }) {
  const defaults = buildItems(!!hasMarstek);
  const [items, setItems] = useState<Item[]>(defaults);
  const [saved, setSaved] = useState<string>("");
  const [dragTop, setDragTop] = useState<number | null>(null);
  const [dragChild, setDragChild] = useState<{ top: number; child: number } | null>(null);

  // Aktuelle Konfiguration laden und auf die Defaults anwenden.
  useEffect(() => {
    fetch("/api/menu").then((r) => r.json()).then((j) => {
      if (j?.ok) setItems(applyMenuConfig(defaults, j.config ?? null));
    }).catch(() => { /* Default bleibt */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMarstek]);

  // --- Hauptpunkte umsortieren ---
  function moveTop(from: number, to: number) {
    if (from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  }

  // --- Unterpunkte innerhalb einer Gruppe umsortieren ---
  function moveChild(topIdx: number, from: number, to: number) {
    if (from === to) return;
    setItems((prev) => {
      const next = prev.map((it) => ({ ...it, children: it.children ? [...it.children] : undefined }));
      const kids = next[topIdx].children;
      if (!kids) return prev;
      const [x] = kids.splice(from, 1);
      kids.splice(to, 0, x);
      return next;
    });
  }

  function toConfig(list: Item[]): MenuConfig {
    return list.map((it) => ({
      id: it.id,
      children: it.children ? it.children.map((c) => ({ id: c.id })) : undefined,
    }));
  }

  function speichern() {
    fetch("/api/menu", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: toConfig(items) }),
    }).then((r) => r.json()).then((j) => {
      if (j?.ok) {
        setSaved("Menü gespeichert");
        window.dispatchEvent(new Event("menuconfigchanged"));
        setTimeout(() => setSaved(""), 1800);
      } else {
        setSaved("Speichern fehlgeschlagen");
        setTimeout(() => setSaved(""), 1800);
      }
    }).catch(() => { setSaved("Speichern fehlgeschlagen"); setTimeout(() => setSaved(""), 1800); });
  }

  function zuruecksetzen() {
    fetch("/api/menu", { method: "DELETE" }).then((r) => r.json()).then(() => {
      setItems(defaults);
      window.dispatchEvent(new Event("menuconfigchanged"));
      setSaved("Auf Standard zurückgesetzt");
      setTimeout(() => setSaved(""), 1800);
    }).catch(() => { /* ignore */ });
  }

  return (
    <div className="card menu-editor">
      <h3>Menüstruktur anpassen</h3>
      <p className="hint">
        Ziehe die Haupt- und Unterpunkte mit dem Griff&nbsp;⠿ in die gewünschte
        Reihenfolge. Unterpunkte lassen sich innerhalb ihrer Gruppe verschieben.
        Nach dem Speichern übernimmt das Menü die neue Reihenfolge. Die Beschriftungen
        werden vom Programm vorgegeben und ändern sich nicht.
      </p>

      <ul className="menu-editor-list">
        {items.map((it, ti) => (
          <li
            key={it.id || "home"}
            className={`menu-editor-item${dragTop === ti ? " dragging" : ""}`}
            draggable
            onDragStart={() => setDragTop(ti)}
            onDragEnd={() => setDragTop(null)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragTop != null) moveTop(dragTop, ti); setDragTop(null); }}
          >
            <div className="menu-editor-row">
              <span className="menu-drag-handle" title="Ziehen zum Verschieben">⠿</span>
              <span className="menu-editor-label">{it.label || "Gesamtansicht"}</span>
              {it.children && <span className="menu-editor-group-tag">Gruppe</span>}
            </div>

            {it.children && (
              <ul className="menu-editor-children">
                {it.children.map((c, ci) => (
                  <li
                    key={c.id}
                    className={`menu-editor-child${dragChild && dragChild.top === ti && dragChild.child === ci ? " dragging" : ""}`}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDragChild({ top: ti, child: ci }); }}
                    onDragEnd={(e) => { e.stopPropagation(); setDragChild(null); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (dragChild && dragChild.top === ti) moveChild(ti, dragChild.child, ci);
                      setDragChild(null);
                    }}
                  >
                    <span className="menu-drag-handle" title="Ziehen zum Verschieben">⠿</span>
                    <span className="menu-editor-label">{c.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="menu-editor-actions">
        <button className="btn-primary" onClick={speichern}>Menü speichern</button>
        <button className="btn-secondary" onClick={zuruecksetzen}>Auf Standard zurücksetzen</button>
        {saved && <span className="pv-save-msg">{saved}</span>}
      </div>
    </div>
  );
}
