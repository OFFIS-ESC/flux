// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import type { Abnehmer } from "./types";

type Quelle = {
  id: string;
  label: string;
  enabled: boolean;
  role: "grid42c" | "grid42cEmu";
};

const ROLE42C_LABEL: Record<string, string> = {
  grid42c: "Netz §42c (echter Zähler)",
  grid42cEmu: "Netz §42c Emulation",
};

type SharingConfig = {
  mode: "dynamisch" | "statisch";
  abnehmer: Abnehmer[];
  quellen: Quelle[];
};

// Konfiguration des §42c-Energy-Sharings: Abnehmer (externe Haushalte) und
// Verteilungsschlüssel. Lädt die Daten selbst über /api/sharing und speichert
// über /api/abnehmer bzw. /api/sharing/config. Wird auf der Energiekosten-Seite
// eingebunden (die Visualisierung der Tagesverläufe bleibt unter Energy Sharing).
export function Sharing42cConfig() {
  const [abnehmer, setAbnehmer] = useState<Abnehmer[]>([]);
  const [quellen, setQuellen] = useState<Quelle[]>([]);
  const [mode, setMode] = useState<"dynamisch" | "statisch">("dynamisch");

  function load() {
    fetch("/api/sharing")
      .then((r) => r.json())
      .then((d: SharingConfig) => {
        setAbnehmer(d.abnehmer ?? []);
        setQuellen(d.quellen ?? []);
        setMode(d.mode ?? "dynamisch");
      })
      .catch(() => {
        /* ignore */
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function saveMode(m: "dynamisch" | "statisch") {
    setMode(m);
    await fetch("/api/sharing/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: m }),
    });
    load();
  }

  async function saveAbnehmer(list: Abnehmer[]) {
    setAbnehmer(list);
    const res = await fetch("/api/abnehmer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ abnehmer: list }),
    });
    const j = await res.json();
    if (j.abnehmer) setAbnehmer(j.abnehmer); // gedeckelte Quoten übernehmen
    load();
  }

  function updateAbn(idx: number, patch: Partial<Abnehmer>) {
    setAbnehmer(abnehmer.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  const quotenSumme = abnehmer.reduce((a, x) => a + (x.quote || 0), 0);

  return (
    <>
      {/* §42c Abnehmer-Verwaltung: pro §42c-Quelle genau ein Abnehmer (1:1). */}
      <section className="ek-section">
        <h3>§42c Abnehmer (externe Haushalte)</h3>
        <p className="hint">
          Die §42c-Abnehmer werden automatisch aus den Quellen mit einer
          §42c-Netzrolle abgeleitet. Je Abnehmer legst du die vereinbarte
          Vergütung (€/kWh) fest, die du für den an ihn gelieferten Überschussstrom
          erhältst – diese kann je Abnehmer unterschiedlich sein und fließt so in
          die Wirtschaftlichkeitsanalyse ein.
        </p>
        <div className="table-scroll">
        <table className="es-haushalte">
          <tbody>
            <tr>
              <th>Abnehmer</th>
              <th>Rolle</th>
              <th>§42c Vergütung</th>
              {mode === "statisch" && <th>Quote %</th>}
            </tr>
            {abnehmer.map((a, idx) => {
              const q = quellen.find((x) => x.id === a.sourceId);
              const aktiv = q?.enabled ?? false;
              return (
                <tr key={a.id} className={aktiv ? "" : "es-inactive"}>
                  <td>
                    {a.name}
                    {q && !q.enabled ? " (inaktiv)" : ""}
                  </td>
                  <td>{q ? ROLE42C_LABEL[q.role] ?? q.role : "—"}</td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      className="ek-input es-input-sm"
                      value={Math.round(a.verguetung * 100 * 100) / 100}
                      onChange={(e) =>
                        updateAbn(idx, { verguetung: Number(e.target.value) / 100 })
                      }
                      onBlur={() => saveAbnehmer(abnehmer)}
                    />{" "}
                    ct/kWh
                  </td>
                  {mode === "statisch" && (
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="ek-input es-input-sm"
                        value={a.quote}
                        onChange={(e) => updateAbn(idx, { quote: Number(e.target.value) })}
                        onBlur={() => saveAbnehmer(abnehmer)}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {mode === "statisch" && abnehmer.length > 0 && (
          <div className="es-add">
            <span className={`es-quotsum ${quotenSumme > 100 ? "over" : ""}`}>
              Summe Quoten: {quotenSumme} %{" "}
              {quotenSumme > 100 ? "(wird auf 100 % gedeckelt)" : ""}
            </span>
          </div>
        )}
        {quellen.length === 0 && (
          <p className="hint">
            Keine §42c-Quellen vorhanden. Jede Quelle mit einer §42c-Rolle
            (echter Zähler oder Lastprofil-Emulation) ergibt automatisch genau einen
            Abnehmer. Solche Quellen werden auf der Quellen-Seite angelegt und
            aktiviert.
          </p>
        )}
      </section>

      {/* §42c Verteilungsschlüssel */}
      <section className="ek-section">
        <h3>§42c Verteilungsschlüssel</h3>
        <div className="ek-switch">
          <button className={mode === "dynamisch" ? "active" : ""} onClick={() => saveMode("dynamisch")}>
            Dynamischer Verbrauchsschlüssel
          </button>
          <button className={mode === "statisch" ? "active" : ""} onClick={() => saveMode("statisch")}>
            Statischer Schlüssel
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          {mode === "dynamisch"
            ? "Aufteilung anteilig am tatsächlichen Verbrauch der Abnehmer im jeweiligen 15-Minuten-Fenster."
            : "Aufteilung nach festen Quoten (oben je Abnehmer einstellbar)."}
        </p>
      </section>
    </>
  );
}
