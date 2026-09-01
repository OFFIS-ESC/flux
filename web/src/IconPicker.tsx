// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useRef, useState } from "react";
import emojiData from "./emoji_data.json";

type EmojiItem = { e: string; n: string };
const ALL = emojiData as EmojiItem[];

// Kleine Schnellauswahl der gängigsten Geräte-Icons (immer sichtbar).
const QUICK = ["🔌", "🚗", "🔥", "❄️", "💡", "🖥️", "☀️", "🔋", "⚡", "🏠"];

export function IconPicker({
  value,
  onChange,
  defaultIcon,
}: {
  value: string;
  onChange: (icon: string) => void;
  // Effektives Icon, das bei leerem value ("Standard") tatsächlich verwendet
  // wird – wird in der Standard-Schaltfläche als Vorschau angezeigt, damit die
  // automatische Zuordnung sichtbar ist.
  defaultIcon?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Außerhalb klicken schließt das Popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL.slice(0, 240); // ohne Suche: erste 240 zeigen
    const terms = q.split(/\s+/);
    const hits: EmojiItem[] = [];
    for (const it of ALL) {
      if (terms.every((t) => it.n.includes(t))) {
        hits.push(it);
        if (hits.length >= 300) break;
      }
    }
    return hits;
  }, [query]);

  return (
    <div className="icon-picker" ref={ref}>
      {/* Schnellauswahl + aktueller Wert + Öffner */}
      <div className="icon-quick">
        <button
          type="button"
          className={`src-icon-opt ${value === "" ? "sel" : ""}`}
          title="Standard (automatisch nach Rolle/Typ)"
          onClick={() => onChange("")}
        >
          {defaultIcon ? (
            <span className="icon-default-preview">{defaultIcon}</span>
          ) : (
            "—"
          )}
        </button>
        {QUICK.map((ic) => (
          <button
            key={ic}
            type="button"
            className={`src-icon-opt ${value === ic ? "sel" : ""}`}
            title={ic}
            onClick={() => onChange(ic)}
          >
            {ic}
          </button>
        ))}
        <button
          type="button"
          className="icon-more"
          onClick={() => setOpen((o) => !o)}
        >
          {value && !QUICK.includes(value) ? value : "🔍"} mehr…
        </button>
      </div>

      {open && (
        <div className="icon-popover">
          <input
            autoFocus
            type="text"
            placeholder="Suchen (z. B. lampe, fridge, sun, washing)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="icon-search"
          />
          <div className="icon-grid">
            {results.map((it) => (
              <button
                key={it.e}
                type="button"
                className={`src-icon-opt ${value === it.e ? "sel" : ""}`}
                title={it.n}
                onClick={() => {
                  onChange(it.e);
                  setOpen(false);
                }}
              >
                {it.e}
              </button>
            ))}
            {results.length === 0 && (
              <div className="icon-empty">Keine Treffer für „{query}“.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
