// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Datumsauswahl mit Schnell-Navigation (Vortag / Folgetag) für Tagescharts.
// Der "Folgetag"-Pfeil ist deaktiviert, sobald der nächste Tag über die
// erlaubte Obergrenze (Default: heute) hinausginge. Optional lässt sich eine
// Untergrenze (min) setzen; dann ist auch der "Vortag"-Pfeil begrenzt.

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Tag verschieben (deltaDays) auf Basis eines YYYY-MM-DD-Strings.
function shiftIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export function DateNav({
  value,
  onChange,
  min,
  max = isoToday(),
  label = "Tag",
  disabled = false,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  label?: string;
  disabled?: boolean;
}) {
  const prevIso = shiftIso(value, -1);
  const nextIso = shiftIso(value, 1);
  const prevDisabled = disabled || (min != null && prevIso < min);
  const nextDisabled = disabled || (max != null && nextIso > max);

  return (
    <span className="datenav">
      {label ? <span className="datenav-label">{label} </span> : null}
      <button
        type="button"
        className="datenav-arrow"
        onClick={() => onChange(prevIso)}
        disabled={prevDisabled}
        aria-label="Vortag"
        title="Vortag"
      >
        ‹
      </button>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
      <button
        type="button"
        className="datenav-arrow"
        onClick={() => onChange(nextIso)}
        disabled={nextDisabled}
        aria-label="Folgetag"
        title="Folgetag"
      >
        ›
      </button>
    </span>
  );
}
