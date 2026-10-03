// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useState } from "react";

// Perioden-Leiste für zeitversionierte Kostenblöcke. Zeigt die aktuell
// ausgewählte Periode (gültig ab / bis) mit Pfeilen zum Blättern, einem
// Datumsfeld für "gültig ab", einem "+ Folgeperiode"-Button (kopiert die Werte
// der aktuellen Periode und schließt nahtlos an) und Löschen.
//
// Die Komponente ist generisch: der Aufrufer hält die Perioden-Liste und den
// Index selbst und rendert die Wert-Eingabefelder für die aktuelle Periode.

export interface Periode<T> {
  gueltigAb: string; // YYYY-MM-DD
  werte: T;
}

function bisOf<T>(perioden: Periode<T>[], index: number): string | null {
  const sorted = [...perioden].sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
  const next = sorted[index + 1];
  if (!next) return null;
  const d = new Date(next.gueltigAb + "T00:00:00");
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDE(iso: string | null): string {
  if (!iso) return "offen";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function PeriodeNav<T>({
  perioden,
  index,
  onIndexChange,
  onChange,
  makeDefaultWerte,
}: {
  perioden: Periode<T>[];
  index: number;
  onIndexChange: (i: number) => void;
  onChange: (perioden: Periode<T>[], newIndex: number) => void;
  // Werte für eine neue Folgeperiode (Default: Kopie der aktuellen).
  makeDefaultWerte?: (current: T) => T;
}) {
  const [error, setError] = useState<string | null>(null);
  // Immer sortiert arbeiten, damit Index und Anzeige konsistent sind.
  const sorted = [...perioden].sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
  const cur = sorted[index];
  if (!cur) return null;
  const bis = bisOf(sorted, index);

  function setGueltigAb(iso: string) {
    setError(null);
    // Erste Periode darf nicht "verschoben" werden über die zweite hinaus;
    // wir erlauben freie Eingabe, sortieren aber neu und behalten die Auswahl.
    const next = sorted.map((p, i) => (i === index ? { ...p, gueltigAb: iso } : p));
    // Doppelte gueltigAb vermeiden.
    const seen = new Set<string>();
    for (const p of next) {
      if (seen.has(p.gueltigAb)) { setError("Zwei Perioden mit gleichem Startdatum."); return; }
      seen.add(p.gueltigAb);
    }
    const resorted = [...next].sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
    const newIndex = resorted.findIndex((p) => p === next[index]);
    onChange(resorted, newIndex < 0 ? 0 : newIndex);
  }

  function addFolge() {
    setError(null);
    // Neue Periode: einen Monat nach der aktuellen, Werte kopiert.
    const d = new Date(cur.gueltigAb + "T00:00:00");
    d.setMonth(d.getMonth() + 1);
    const p = (n: number) => String(n).padStart(2, "0");
    let ab = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    // Falls dieses Datum schon existiert, einen Tag weiterschieben.
    const existing = new Set(sorted.map((x) => x.gueltigAb));
    while (existing.has(ab)) {
      d.setDate(d.getDate() + 1);
      ab = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    const werte = makeDefaultWerte ? makeDefaultWerte(cur.werte) : JSON.parse(JSON.stringify(cur.werte));
    const next = [...sorted, { gueltigAb: ab, werte }].sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
    const newIndex = next.findIndex((x) => x.gueltigAb === ab);
    onChange(next, newIndex);
  }

  function del() {
    if (sorted.length <= 1) { setError("Die einzige Periode kann nicht gelöscht werden."); return; }
    setError(null);
    const next = sorted.filter((_, i) => i !== index);
    onChange(next, Math.max(0, index - 1));
  }

  return (
    <div className="periode-nav">
      <div className="periode-row">
        <button type="button" className="datenav-arrow" disabled={index <= 0}
          onClick={() => onIndexChange(index - 1)} title="frühere Periode">‹</button>
        <span className="periode-label">
          gültig ab{" "}
          <input type="date" value={cur.gueltigAb} onChange={(e) => e.target.value && setGueltigAb(e.target.value)} />
          <span className="periode-bis">bis {fmtDE(bis)}</span>
        </span>
        <button type="button" className="datenav-arrow" disabled={index >= sorted.length - 1}
          onClick={() => onIndexChange(index + 1)} title="spätere Periode">›</button>
        <span className="periode-count">{index + 1}/{sorted.length}</span>
        <button type="button" className="periode-add" onClick={addFolge} title="Folgeperiode anlegen">+ Folgeperiode</button>
        {sorted.length > 1 && (
          <button type="button" className="periode-del" onClick={del} title="Periode löschen">🗑</button>
        )}
      </div>
      {error && <div className="periode-err">{error}</div>}
    </div>
  );
}
