// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useMemo, useState } from "react";
import { nf } from "./chartUtils";
import { SortableGrid, SortToggle, type SortableItem } from "./SortableGrid";

// Kennzahlen-Auswertung der Warmwassererzeugung über einen wählbaren Zeitraum.
// Erzeugungsarten: Wärmepumpe, Heizstab, Solarthermie (mehrere pro Tag möglich).

interface SpeicherWaerme { kwh: number | null; tankUp: number | null; tankDown: number | null; formel: string }
interface WwKpi {
  von: string; bis: string;
  tageGesamt: number;
  kalendertage: number;
  tageWp: number; tageHeizstab: number; tageSolar: number;
  anteilWp: number; anteilHeizstab: number; anteilSolar: number;
  energieHeizstabKwh: number; energieWpKwh: number; energieSolarKwh: number;
  speicherWaerme?: SpeicherWaerme;
}

type Modus = "tag" | "monat" | "jahr" | "frei";

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function heute(): string { return iso(new Date()); }

export function WwKpiBlock() {
  const [modus, setModus] = useState<Modus>("monat");
  const [tag, setTag] = useState<string>(heute());
  const [monat, setMonat] = useState<string>(heute().slice(0, 7));
  const [jahr, setJahr] = useState<number>(Number(heute().slice(0, 4)));
  const [freiVon, setFreiVon] = useState<string>(heute());
  const [freiBis, setFreiBis] = useState<string>(heute());
  const [kpi, setKpi] = useState<WwKpi | null>(null);
  const [loading, setLoading] = useState(false);
  // Formel-Bearbeitung für die gespeicherte thermische Energie.
  const [formelEdit, setFormelEdit] = useState(false);
  const [formelText, setFormelText] = useState("");
  const [formelFehler, setFormelFehler] = useState<string | null>(null);
  const [formelDefault, setFormelDefault] = useState("");
  const [sortMode, setSortMode] = useState(false);

  const { von, bis } = useMemo<{ von: string; bis: string }>(() => {
    if (modus === "tag") return { von: tag, bis: tag };
    if (modus === "monat") {
      const y = Number(monat.slice(0, 4)); const m = Number(monat.slice(5, 7));
      const last = new Date(y, m, 0).getDate();
      return { von: `${monat}-01`, bis: `${monat}-${String(last).padStart(2, "0")}` };
    }
    if (modus === "jahr") return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
    return { von: freiVon <= freiBis ? freiVon : freiBis, bis: freiBis >= freiVon ? freiBis : freiVon };
  }, [modus, tag, monat, jahr, freiVon, freiBis]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/warmwasser/kpi?von=${von}&bis=${bis}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKpi(d))
      .catch(() => setKpi(null))
      .finally(() => setLoading(false));
  }, [von, bis]);

  // Default-Formel einmalig laden (für den Zurücksetzen-Knopf).
  useEffect(() => {
    fetch("/api/warmwasser/waermeformel")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.default) setFormelDefault(d.default); })
      .catch(() => {});
  }, []);

  const oeffneFormel = () => {
    setFormelText(kpi?.speicherWaerme?.formel ?? "");
    setFormelFehler(null);
    setFormelEdit(true);
  };
  const speichereFormel = () => {
    setFormelFehler(null);
    fetch("/api/warmwasser/waermeformel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formel: formelText }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.ok) { setFormelFehler(d?.error ?? "Formel ungültig"); return; }
        setFormelEdit(false);
        // KPI neu laden, damit der Wert aktualisiert wird.
        const rr = await fetch(`/api/warmwasser/kpi?von=${von}&bis=${bis}`);
        if (rr.ok) setKpi(await rr.json());
      })
      .catch(() => setFormelFehler("Speichern fehlgeschlagen"));
  };

  const fmtRange = (v: string, b: string) => {
    const f = (s: string) => s.split("-").reverse().join(".");
    return v === b ? f(v) : `${f(v)} – ${f(b)}`;
  };

  // Erläuterung der Speicherwärme-Formel (Info-Tooltip).
  const formelInfo = `Berechnung des Wärmeinhalts des Speichers (Näherung).

Angenommen wird eine lineare Temperaturverteilung über die Speicherhöhe. Der Vaillant VIH S 300 hat ca. 289 l bei 1775 mm Höhe. Die Fühler sitzen bei z_u = 581 mm (unten, T_u) und z_o = 1546 mm (oben, T_o).

Speichermittelpunkt: z_m = 887,5 mm. Interpolierte Mitteltemperatur:
T_m = 0,6824·T_u + 0,3176·T_o

Gespeicherte Energie gegenüber 20 °C (c_p = 4,186 kJ/kg·K):
E = (289·4,186/3600)·(T_m − 20)
E [kWh] = 0,2295·T_u + 0,1068·T_o − 6,724

Näherung: Die tatsächliche Schichtung ist aus nur zwei Messwerten nicht bestimmbar; es wird eine lineare Verteilung angenommen.`;

  return (
    <div className="card">
      <h3>Kennzahlen-Auswertung</h3>
      <p className="hint">
        Auswertung der Warmwassererzeugung für einen wählbaren Zeitraum. Erfasst
        wird, an wie vielen Tagen Warmwasser über die Wärmepumpe, den Heizstab
        oder die Solarthermie erzeugt wurde (Mehrfachnennung pro Tag möglich),
        sowie die eingesetzte elektrische Energie von Heizstab und Wärmepumpe.
      </p>

      <div className="wpkpi-controls">
        <div className="wpkpi-modus">
          {(["tag", "monat", "jahr", "frei"] as Modus[]).map((m) => (
            <button key={m} className={modus === m ? "active" : ""} onClick={() => setModus(m)}>
              {m === "tag" ? "Tag" : m === "monat" ? "Monat" : m === "jahr" ? "Jahr" : "frei"}
            </button>
          ))}
        </div>
        <div className="wpkpi-range">
          {modus === "tag" && <input type="date" value={tag} onChange={(e) => setTag(e.target.value)} />}
          {modus === "monat" && <input type="month" value={monat} onChange={(e) => setMonat(e.target.value)} />}
          {modus === "jahr" && (
            <span className="wpkpi-frei">
              <button onClick={() => setJahr((j) => j - 1)}>◀</button>
              <strong>{jahr}</strong>
              <button onClick={() => setJahr((j) => j + 1)} disabled={jahr >= new Date().getFullYear()}>▶</button>
            </span>
          )}
          {modus === "frei" && (
            <span className="wpkpi-frei">
              <input type="date" value={freiVon} onChange={(e) => setFreiVon(e.target.value)} />
              <span>–</span>
              <input type="date" value={freiBis} onChange={(e) => setFreiBis(e.target.value)} />
            </span>
          )}
        </div>
      </div>

      <p className="wpkpi-zeitraum">Zeitraum: <strong>{fmtRange(von, bis)}</strong>{kpi ? ` · ${kpi.kalendertage} Tage im Zeitraum, davon ${kpi.tageGesamt} mit Warmwassererzeugung` : ""}</p>

      {loading && !kpi && <p className="hint">Berechne Kennzahlen…</p>}
      {kpi && (() => {
        const items: SortableItem[] = [
          { id: "anteilWp", node: <Kachel label="Erzeugung Wärmepumpe" wert={nf(kpi.anteilWp, 0)} einheit="%" sub={`${kpi.tageWp} Tage`} /> },
          { id: "anteilHeizstab", node: <Kachel label="Erzeugung Heizstab" wert={nf(kpi.anteilHeizstab, 0)} einheit="%" sub={`${kpi.tageHeizstab} Tage`} /> },
          { id: "anteilSolar", node: <Kachel label="Erzeugung Solarthermie" wert={nf(kpi.anteilSolar, 0)} einheit="%" sub={`${kpi.tageSolar} Tage`} /> },
          { id: "energieWp", node: <Kachel label="Energie WP (Warmwasser)" wert={nf(kpi.energieWpKwh, 1)} einheit="kWh" /> },
          { id: "energieHeizstab", node: <Kachel label="Energie Heizstab" wert={nf(kpi.energieHeizstabKwh, 1)} einheit="kWh" /> },
          { id: "energieSolar", node: <Kachel label="Energie Solarthermie" wert={nf(kpi.energieSolarKwh, 1)} einheit="kWh" info="Erfasster Stromverbrauch der Solarkreis-Pumpe. Die thermisch eingebrachte Solarenergie ist ohne Wärmemengenzähler nicht messbar." /> },
          { id: "speicherWaerme", node: (
            <Kachel
              label="Thermisch gespeicherte Energie"
              wert={kpi.speicherWaerme?.kwh != null ? nf(kpi.speicherWaerme.kwh, 1) : "–"}
              einheit="kWh"
              sub={kpi.speicherWaerme?.tankUp != null && kpi.speicherWaerme?.tankDown != null
                ? `oben ${nf(kpi.speicherWaerme.tankUp, 1)} °C · unten ${nf(kpi.speicherWaerme.tankDown, 1)} °C`
                : "keine aktuellen Temperaturen"}
              info={formelInfo}
              onEdit={oeffneFormel}
            />
          ) },
        ];
        return (
          <>
            <div className="tile-sort-bar">
              <SortToggle aktiv={sortMode} onToggle={() => setSortMode((v) => !v)} />
            </div>
            {sortMode && <p className="tile-sort-hint">Kacheln ziehen, um die Reihenfolge zu ändern. Die Anordnung wird gespeichert.</p>}
            <SortableGrid bereich="wwkpi" className="wpkpi-grid" items={items} sortMode={sortMode} />
          </>
        );
      })()}

      {formelEdit && (
        <div className="ww-formel-editor">
          <label>Formel für die gespeicherte thermische Energie (Variablen: <code>T_u</code> = untere, <code>T_o</code> = obere Temperatur):</label>
          <input
            type="text"
            value={formelText}
            onChange={(e) => setFormelText(e.target.value)}
            spellCheck={false}
          />
          {formelFehler && <p className="ww-formel-fehler">{formelFehler}</p>}
          <div className="ww-formel-btns">
            <button className="btn-primary" onClick={speichereFormel}>Speichern</button>
            <button onClick={() => setFormelEdit(false)}>Abbrechen</button>
            {formelDefault && (
              <button onClick={() => setFormelText(formelDefault)} title="Standardformel einsetzen">Zurücksetzen</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kachel({ label, wert, einheit, sub, info, onEdit }: {
  label: string; wert: string; einheit: string; sub?: string;
  info?: string; onEdit?: () => void;
}) {
  return (
    <div className="wpkpi-kachel">
      <div className="wpkpi-kachel-label">
        {label}
        {info && <span className="ww-info" tabIndex={0}>&#9432;<span className="ww-info-box">{info}</span></span>}
        {onEdit && <button className="ww-formel-edit-btn" onClick={onEdit} title="Formel bearbeiten">&#9998;</button>}
      </div>
      <div className="wpkpi-kachel-wert">{wert}{einheit && <span className="wpkpi-kachel-einheit"> {einheit}</span>}</div>
      {sub && <div className="wpkpi-kachel-sub">{sub}</div>}
    </div>
  );
}
