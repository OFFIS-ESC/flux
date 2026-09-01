// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Monatsauswahl mit Schnell-Navigation (Vor-/Folgemonat), analog zu DateNav.
// Wert ist ein "YYYY-MM"-String. Optional lassen sich Ober-/Untergrenze setzen.
//
// Die Anzeige nutzt bewusst NICHT das native Format des <input type="month">
// (das je nach Plattform "08.2026" statt "August 2026" zeigt), sondern einen
// ausgeschriebenen Monatsnamen. Das native Input bleibt als Picker erhalten,
// wird aber optisch ueberlagert - so ist die Darstellung ueberall gleich.

import { useRef } from "react";

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function label(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}

export function MonthNav({
  value,
  onChange,
  min,
  max = currentYm(),
  label: prefix = "",
  disabled = false,
}: {
  value: string;
  onChange: (ym: string) => void;
  min?: string;
  max?: string;
  label?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const prevYm = shiftYm(value, -1);
  const nextYm = shiftYm(value, 1);
  const prevDisabled = disabled || (min != null && prevYm < min);
  const nextDisabled = disabled || (max != null && nextYm > max);

  // Oeffnet den nativen Monats-Picker (Fallback: Fokus setzen).
  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  };

  return (
    <span className="datenav">
      {prefix ? `${prefix} ` : null}
      <button
        type="button"
        className="datenav-arrow"
        onClick={() => onChange(prevYm)}
        disabled={prevDisabled}
        aria-label="Vormonat"
        title="Vormonat"
      >
        &#8249;
      </button>
      <span className="monthnav-display">
        <button
          type="button"
          className="monthnav-label"
          onClick={openPicker}
          disabled={disabled}
          title="Monat wählen"
        >
          {label(value)}
        </button>
        <input
          ref={inputRef}
          type="month"
          className="monthnav-input"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
        />
      </span>
      <button
        type="button"
        className="datenav-arrow"
        onClick={() => onChange(nextYm)}
        disabled={nextDisabled}
        aria-label="Folgemonat"
        title="Folgemonat"
      >
        &#8250;
      </button>
    </span>
  );
}
