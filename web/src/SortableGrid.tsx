// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Wiederverwendbare Drag&Drop-Sortierung für Kachel-Raster.
//
// - Die Reihenfolge wird serverseitig je "bereich" gespeichert (/api/tileorder).
// - Die Position ist an das bestehende CSS-Grid gebunden (kein freies Platzieren);
//   nur die Reihenfolge der Elemente ändert sich. Eine Zeile muss nicht voll sein.
// - Neue, noch unbekannte Kachel-IDs werden robust ans Ende gehängt; entfallene
//   IDs aus einer gespeicherten Reihenfolge werden ignoriert.
//
// Verwendung:
//   const items = [{ id: "a", node: <Kachel/> }, ...];
//   <SortableGrid bereich="wpkpi" className="wpkpi-grid" items={items} />

export interface SortableItem {
  id: string;
  node: ReactNode;
}

// Ordnet die Items nach der gespeicherten Reihenfolge; Unbekanntes ans Ende.
export function applyOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const pa = pos.has(a.id) ? (pos.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const pb = pos.has(b.id) ? (pos.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return 0; // stabile Reihenfolge für gleich (unbekannte) Positionen
  });
}

// Lädt/merkt die gespeicherte Reihenfolge eines Bereichs und bietet ein
// Speichern an. Mehrere Grids desselben Bereichs sind möglich (selten nötig).
export function useTileOrder(bereich: string): {
  order: string[] | undefined;
  save: (ids: string[]) => void;
  reset: () => void;
} {
  const [order, setOrder] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    let ok = true;
    fetch("/api/tileorder")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (ok && d?.order && Array.isArray(d.order[bereich])) setOrder(d.order[bereich]); })
      .catch(() => {});
    return () => { ok = false; };
  }, [bereich]);

  const save = useCallback((ids: string[]) => {
    setOrder(ids);
    fetch("/api/tileorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bereich, ids }),
    }).catch(() => {});
  }, [bereich]);

  const reset = useCallback(() => {
    setOrder(undefined);
    fetch(`/api/tileorder?bereich=${encodeURIComponent(bereich)}`, { method: "DELETE" }).catch(() => {});
  }, [bereich]);

  return { order, save, reset };
}

export function SortableGrid({
  bereich, className, items, disabled, sortMode,
}: {
  bereich: string;
  className?: string;
  items: SortableItem[];
  disabled?: boolean;
  sortMode?: boolean;
}) {
  const { order, save } = useTileOrder(bereich);
  const aktiv = !!sortMode && !disabled;
  // Lokale Reihenfolge der IDs (für flüssiges Ziehen ohne Server-Roundtrip).
  const [ids, setIds] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Items nach gespeicherter Reihenfolge sortieren; neue IDs ans Ende.
  useEffect(() => {
    const sorted = applyOrder(items, order).map((i) => i.id);
    setIds(sorted);
  }, [items, order]);

  const byId = new Map(items.map((i) => [i.id, i.node]));
  const geordnet = ids.filter((id) => byId.has(id));
  // Falls neue Items hinzugekommen sind, die noch nicht in ids stehen:
  for (const it of items) if (!geordnet.includes(it.id)) geordnet.push(it.id);

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    if (!aktiv) return;
    dragId.current = id;
    e.dataTransfer.effectAllowed = "move";
    // Firefox verlangt gesetzte Daten, damit das Ziehen startet.
    try { e.dataTransfer.setData("text/plain", id); } catch { /* ignore */ }
  };
  const onDragOver = (id: string) => (e: React.DragEvent) => {
    if (!aktiv || dragId.current == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== overId) setOverId(id);
  };
  const onDrop = (targetId: string) => (e: React.DragEvent) => {
    if (!aktiv) return;
    e.preventDefault();
    const src = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!src || src === targetId) return;
    const cur = [...geordnet];
    const from = cur.indexOf(src);
    const to = cur.indexOf(targetId);
    if (from < 0 || to < 0) return;
    cur.splice(from, 1);
    cur.splice(to, 0, src);
    setIds(cur);
    save(cur);
  };
  const onDragEnd = () => { dragId.current = null; setOverId(null); };

  return (
    <div className={className}>
      {geordnet.map((id) => {
        const node = byId.get(id);
        if (node == null) return null;
        return (
          <div
            key={id}
            className={`sortable-cell${overId === id ? " drop-target" : ""}${aktiv ? " draggable" : ""}`}
            draggable={aktiv}
            onDragStart={onDragStart(id)}
            onDragOver={onDragOver(id)}
            onDrop={onDrop(id)}
            onDragEnd={onDragEnd}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}

// Kleiner Umschalter, den Seiten neben ihre Kachel-Überschrift setzen. Das Label
// im inaktiven Zustand ist konfigurierbar (Default "Anordnen"); die Übersicht
// nutzt "Anpassen", weil dort auch Ordner/Kacheln verwaltet werden.
export function SortToggle({ aktiv, onToggle, label }: { aktiv: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      className={`tile-sort-toggle${aktiv ? " active" : ""}`}
      onClick={onToggle}
      title="Kacheln, Ordner und Anordnung anpassen"
    >
      {aktiv ? "✓ Fertig" : `⚙ ${label ?? "Anordnen"}`}
    </button>
  );
}
