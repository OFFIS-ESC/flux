// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { FONT_TYPES, FONT_SIZE_DEFAULTS, applyFontSizes } from "./fontSizes";
import type { FullState, Settings } from "./types";
import { MenuEditor } from "./MenuEditor";

// Default-Farben (müssen mit ENERGY_DEFAULTS im Backend übereinstimmen).
const VIZ_DEFAULTS = {
  vizColorSpotPositiv: "#2d6a00",
  vizColorSpotNegativ: "#c0152f",
  vizColorVerbrauchGesamt: "#2563eb",
  vizColorVerbrauchPv: "#f2c200",
  vizColorVerbrauchSpeicher: "#1f6b3b",
  vizColorNetzbezug: "#595959",
  vizColorEinspeisungGesamt: "#111111",
  vizColorEinspeisungPv: "#b8b8b8",
  vizColorEinspeisungSpeicher: "#d2691e",
} as const;

type VizKey = keyof typeof VIZ_DEFAULTS;

type Field = { key: VizKey; label: string; hint: string };

const KOSTEN_FIELDS: Field[] = [
  {
    key: "vizColorSpotPositiv",
    label: "Tagespreisverlauf: positiver Preis",
    hint: "Balken im Spotpreis-Chart bei Preis ≥ 0.",
  },
  {
    key: "vizColorSpotNegativ",
    label: "Tagespreisverlauf: negativer Preis",
    hint: "Balken im Spotpreis-Chart bei Preis < 0.",
  },
];

const ENERGIE_FIELDS: Field[] = [
  {
    key: "vizColorVerbrauchGesamt",
    label: "Verbrauch gesamt",
    hint: "Gesamter Hausverbrauch in allen Charts.",
  },
  {
    key: "vizColorVerbrauchPv",
    label: "Verbrauch aus PV",
    hint: "Im Haus verbrauchter Anteil, der unmittelbar aus der PV-Anlage stammt.",
  },
  {
    key: "vizColorVerbrauchSpeicher",
    label: "Verbrauch aus Speicher",
    hint: "Im Haus verbrauchter Anteil, der aus dem Batteriespeicher stammt.",
  },
  {
    key: "vizColorNetzbezug",
    label: "Netzbezug",
    hint: "Bezug aus dem Netz. Auch für die Reststromlieferung an Abnehmer (Energy Sharing).",
  },
  {
    key: "vizColorEinspeisungGesamt",
    label: "Einspeisung gesamt",
    hint: "Gesamte das Haus verlassende Netzeinspeisung.",
  },
  {
    key: "vizColorEinspeisungPv",
    label: "Einspeisung aus PV",
    hint: "Eingespeister Anteil aus PV-Überschuss. Auch für den an Abnehmer gelieferten PV-Anteil (§42c).",
  },
  {
    key: "vizColorEinspeisungSpeicher",
    label: "Einspeisung aus Speicher",
    hint: "Eingespeister Anteil aus gezielter Speicher-Einspeisung. Auch für den an Abnehmer gelieferten Speicher-Anteil (§42c).",
  },
];

export function VisualisierungPage({ state }: { state: FullState }) {
  const [s, setS] = useState<Settings>(state.settings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setS(state.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.settings.vizColorSpotPositiv,
    state.settings.vizColorSpotNegativ,
    state.settings.vizColorVerbrauchGesamt,
    state.settings.vizColorVerbrauchPv,
    state.settings.vizColorVerbrauchSpeicher,
    state.settings.vizColorNetzbezug,
    state.settings.vizColorEinspeisungGesamt,
    state.settings.vizColorEinspeisungPv,
    state.settings.vizColorEinspeisungSpeicher,
  ]);

  async function save(next: Settings) {
    setS(next);
    try {
      await fetch("/api/energySettings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch {
      /* ignore */
    }
  }

  const setColor = (key: VizKey, value: string) => save({ ...s, [key]: value });
  const resetAll = () => save({ ...s, ...VIZ_DEFAULTS });

  // Schriftgrößen: aktueller Stand aus Settings, mit Defaults aufgefüllt.
  const fs: Record<string, { desktop: number; mobile: number }> = (() => {
    const base: Record<string, { desktop: number; mobile: number }> = {};
    for (const t of FONT_TYPES) {
      const cur = s.fontSizes?.[t.key];
      base[t.key] = {
        desktop: cur && Number.isFinite(cur.desktop) ? cur.desktop : FONT_SIZE_DEFAULTS[t.key].desktop,
        mobile: cur && Number.isFinite(cur.mobile) ? cur.mobile : FONT_SIZE_DEFAULTS[t.key].mobile,
      };
    }
    return base;
  })();

  function saveFonts(nextFs: Record<string, { desktop: number; mobile: number }>) {
    applyFontSizes(nextFs); // sofort sichtbar
    save({ ...s, fontSizes: nextFs });
  }
  function setFontSize(key: string, which: "desktop" | "mobile", value: number) {
    if (!Number.isFinite(value)) return;
    const v = Math.max(8, Math.min(48, value));
    saveFonts({ ...fs, [key]: { ...fs[key], [which]: v } });
  }
  function resetFontType(key: string) {
    saveFonts({ ...fs, [key]: { ...FONT_SIZE_DEFAULTS[key] } });
  }
  function resetAllFonts() {
    const def: Record<string, { desktop: number; mobile: number }> = {};
    for (const t of FONT_TYPES) def[t.key] = { ...FONT_SIZE_DEFAULTS[t.key] };
    saveFonts(def);
  }

  const renderRows = (fields: Field[]) => (
    <div className="viz-list">
      {fields.map((f) => (
        <div key={f.key} className="viz-row">
          <input
            type="color"
            className="viz-color"
            value={s[f.key] as string}
            onChange={(e) => setColor(f.key, e.target.value)}
          />
          <div className="viz-text">
            <div className="viz-label">{f.label}</div>
            <div className="viz-hint">{f.hint}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="page">
      <h2>Visualisierung</h2>
      <p className="hint">
        Einheitliche Farben für die Charts auf allen Seiten. Gleiche Energiearten
        werden überall in derselben Farbe dargestellt.
      </p>

      <div className="card">
        <h3>Farben</h3>
        <p className="hint">
          Einheitliche Farben für die Charts auf allen Seiten.
        </p>

        <h4 style={{ textAlign: "left" }}>Kosten</h4>
        <p className="hint">
          Farben für die kostenbezogenen Darstellungen, insbesondere die Balken im
          Spotpreis-Chart (positiver bzw. negativer Börsenpreis).
        </p>
        {renderRows(KOSTEN_FIELDS)}

        <h4 style={{ textAlign: "left" }}>Energie</h4>
        <p className="hint">
          Farben für die Energieflüsse (Verbrauch, Netzbezug, Einspeisung, PV,
          Speicher, §42c-Anteile), die in den gestapelten Charts auf den
          Tagesverlaufs-, Monats- und Energy-Sharing-Seiten verwendet werden.
        </p>
        {renderRows(ENERGIE_FIELDS)}

        <div className="viz-actions">
          <button onClick={resetAll}>Auf Standardfarben zurücksetzen</button>
          {saved && <span className="viz-saved">gespeichert ✓</span>}
        </div>
      </div>

      <div className="card">
        <h3>Schriftgrößen</h3>
        <p className="hint">
          Schriftgröße je Text-Typ, getrennt für Desktop und Mobil (in Pixel).
          Die Werte gelten sofort im gesamten Tool. „Standard" setzt einen
          einzelnen Typ zurück.
        </p>
        <div className="table-scroll">
          <table className="data-table fs-config-table">
            <thead>
              <tr>
                <th>Text-Typ</th>
                <th>Verwendung</th>
                <th>Desktop</th>
                <th>Mobil</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {FONT_TYPES.map((t) => {
                const cur = fs[t.key] ?? FONT_SIZE_DEFAULTS[t.key];
                return (
                  <tr key={t.key}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>{t.label}</td>
                    <td style={{ textAlign: "left", color: "#777" }}>{t.wo}</td>
                    <td>
                      <input
                        type="number"
                        className="fs-num"
                        min={8}
                        max={48}
                        value={cur.desktop}
                        onChange={(e) => setFontSize(t.key, "desktop", Number(e.target.value))}
                      /> px
                    </td>
                    <td>
                      <input
                        type="number"
                        className="fs-num"
                        min={8}
                        max={48}
                        value={cur.mobile}
                        onChange={(e) => setFontSize(t.key, "mobile", Number(e.target.value))}
                      /> px
                    </td>
                    <td>
                      <button className="fs-reset-btn" onClick={() => resetFontType(t.key)}>Standard</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="viz-actions">
          <button onClick={resetAllFonts}>Alle Schriftgrößen zurücksetzen</button>
          {saved && <span className="viz-saved">gespeichert ✓</span>}
        </div>
      </div>

      <MenuEditor hasMarstek={(state.sources ?? []).some((s) => (s.role === "acBattery" || s.role === "dcBattery") && s.enabled)} />
    </div>
  );
}
