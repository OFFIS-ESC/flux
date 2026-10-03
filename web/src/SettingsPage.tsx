// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState, useRef } from "react";
import { nf } from "./chartUtils";
import type { FullState, Settings, LoadWindow } from "./types";
import { SpotChart } from "./SpotChart";
import { NetzentgeltChart } from "./NetzentgeltChart";
import { PeriodeNav, type Periode } from "./PeriodeNav";

// Minuten <-> "HH:MM"
const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromHHMM = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

const QUARTERS = [1, 2, 3, 4];

// Welche Settings-Felder gehören zu welchem versionierten Block? Änderungen an
// diesen Feldern werden in die aktuell gewählte Periode des Blocks geschrieben.
// Einspeisevergütung und EEG-Regelung sind NICHT versioniert (gelten dauerhaft)
// und daher hier bewusst nicht enthalten.
const STROMTARIF_KEYS: (keyof Settings)[] = [
  "strompreis", "tarifMode", "anbieterName", "grundgebuehrMonat", "messstelleEuroJahr", "sofortbonus", "neukundenbonus", "beschaffung", "stromsteuer", "konzessionsabgabe",
  "aufschlagNetznutzung", "offshoreUmlage", "kwkgUmlage", "umsatzsteuer",
];
const MODUL1_KEYS: (keyof Settings)[] = ["paragraf14aModul1Aktiv", "modul1PauschaleNetto"];
const MODUL3_KEYS: (keyof Settings)[] = [
  "paragraf14aAktiv", "netzentgeltStandard", "netzentgeltHoch", "netzentgeltNiedrig", "lastWindows",
];
const WASSER_KEYS: (keyof Settings)[] = [
  "wasserFrischEuroM3", "wasserAbwasserEuroM3", "wasserGrundpreisMonat",
];

type Block = "stromtarif" | "modul1" | "modul3" | "wasser";
const KEY_BLOCK: Record<string, Block> = {};
for (const k of STROMTARIF_KEYS) KEY_BLOCK[k as string] = "stromtarif";
for (const k of MODUL1_KEYS) KEY_BLOCK[k as string] = "modul1";
for (const k of MODUL3_KEYS) KEY_BLOCK[k as string] = "modul3";
for (const k of WASSER_KEYS) KEY_BLOCK[k as string] = "wasser";

export function SettingsPage({ state }: { state: FullState }) {
  // Lokale Arbeitskopie der Einstellungen; wird beim Speichern persistiert.
  const [s, setS] = useState<Settings>(state.settings);
  const [saved, setSaved] = useState(false);

  // Zeitversionierte Kostenperioden je Block + aktuell gewählter Index.
  const [perioden, setPerioden] = useState<Record<Block, Periode<any>[]>>({
    stromtarif: [], modul1: [], modul3: [], wasser: [],
  });
  const [pIdx, setPIdx] = useState<Record<Block, number>>({
    stromtarif: 0, modul1: 0, modul3: 0, wasser: 0,
  });

  // Refs, die stets den aktuellen Wert halten – damit save()/commitField() nicht
  // von veralteten Render-Closures abhängen (Ursache dafür, dass Periodenwerte
  // nicht gespeichert wurden).
  const sRef = useRef(s);
  const periodenRef = useRef(perioden);
  const pIdxRef = useRef(pIdx);
  useEffect(() => { sRef.current = s; }, [s]);
  useEffect(() => { periodenRef.current = perioden; }, [perioden]);
  useEffect(() => { pIdxRef.current = pIdx; }, [pIdx]);

  // Perioden laden.
  useEffect(() => {
    (async () => {
      const blocks: Block[] = ["stromtarif", "modul1", "modul3", "wasser"];
      const next: Record<Block, Periode<any>[]> = { stromtarif: [], modul1: [], modul3: [], wasser: [] };
      for (const b of blocks) {
        try {
          const r = await fetch(`/api/perioden/${b}`);
          const arr = await r.json();
          next[b] = Array.isArray(arr) ? arr.sort((a: any, c: any) => (a.gueltigAb < c.gueltigAb ? -1 : 1)) : [];
        } catch { /* ignore */ }
      }
      setPerioden(next);
      // Default-Auswahl je Block: die zum HEUTIGEN Tag gültige Periode
      // (größtes gueltigAb <= heute; liegt heute vor der ersten, die erste).
      const d = new Date();
      const heute = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const idxFuerHeute = (list: Periode<any>[]) => {
        if (!list || list.length === 0) return 0;
        let chosen = 0;
        for (let i = 0; i < list.length; i++) {
          if (list[i].gueltigAb <= heute) chosen = i;
          else break;
        }
        return chosen;
      };
      setPIdx({
        stromtarif: idxFuerHeute(next.stromtarif),
        modul1: idxFuerHeute(next.modul1),
        modul3: idxFuerHeute(next.modul3),
        wasser: idxFuerHeute(next.wasser),
      });
    })();
  }, []);

  // Den angezeigten Settings-State mit den Werten der GEWÄHLTEN Periode je Block
  // Den angezeigten Settings-State mit den Werten der GEWÄHLTEN Periode je Block
  // überlagern – aber NUR wenn tatsächlich die Periode gewechselt wurde (anderer
  // Index oder andere Periodenmenge). Sonst würde ein Wert-Update aus save()
  // (das setPerioden aufruft) den gerade getippten Wert zurücksetzen.
  const lastSelSig = useRef<string>("");
  useEffect(() => {
    const blocks: Block[] = ["stromtarif", "modul1", "modul3", "wasser"];
    const sig = blocks.map((b) => `${b}:${pIdx[b]}:${perioden[b]?.[pIdx[b]]?.gueltigAb ?? ""}:${perioden[b]?.length ?? 0}`).join("|");
    if (sig === lastSelSig.current) return; // nur Werteänderung -> nicht überlagern
    lastSelSig.current = sig;
    setS((prev) => {
      const merged: any = { ...prev };
      for (const b of blocks) {
        const p = perioden[b]?.[pIdx[b]];
        if (p) Object.assign(merged, p.werte);
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perioden, pIdx]);

  // Bei externen Änderungen (SSE) nur nicht-versionierte Felder übernehmen.
  useEffect(() => {
    setS((prev) => ({ ...state.settings, ...pickVersioned(prev) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings.sharingMode]);

  // Extrahiert die versionierten Felder aus einem Settings-Objekt (um sie bei
  // SSE-Updates zu behalten).
  function pickVersioned(x: Settings): Partial<Settings> {
    const out: any = {};
    for (const k of Object.keys(KEY_BLOCK)) out[k] = (x as any)[k];
    return out;
  }

  async function persistPerioden(b: Block, list: Periode<any>[]) {
    try {
      await fetch(`/api/perioden/${b}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perioden: list }),
      });
    } catch { /* ignore */ }
  }

  async function save(next: Settings) {
    setS(next);
    sRef.current = next;
    const curPerioden = periodenRef.current;
    const curPIdx = pIdxRef.current;

    // Versionierte Felder IMMER in die aktuell gewählte Periode je Block
    // schreiben (kein Diff-Vergleich – der war fragil, weil der onChange den
    // Ref bereits aktualisiert hatte und dann keine Änderung erkannt wurde).
    const updated = { ...curPerioden };
    const blocks: Block[] = ["stromtarif", "modul1", "modul3", "wasser"];
    for (const b of blocks) {
      const list = [...(curPerioden[b] ?? [])];
      const idx = curPIdx[b];
      if (!list[idx]) continue;
      const keys = b === "stromtarif" ? STROMTARIF_KEYS : b === "modul1" ? MODUL1_KEYS : b === "modul3" ? MODUL3_KEYS : WASSER_KEYS;
      const werte: any = { ...list[idx].werte };
      let changed = false;
      for (const k of keys) {
        if (werte[k] !== (next as any)[k]) { werte[k] = (next as any)[k]; changed = true; }
      }
      if (changed) {
        list[idx] = { ...list[idx], werte };
        updated[b] = list;
        await persistPerioden(b, list);
      }
    }
    periodenRef.current = updated;
    setPerioden(updated);

    // Nicht-versionierte Felder in die globalen Settings (versionierte ausgespart).
    const globalPayload: any = {};
    for (const k of Object.keys(next as any)) {
      if (!(k in KEY_BLOCK)) globalPayload[k] = (next as any)[k];
    }
    try {
      await fetch("/api/energySettings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(globalPayload),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch { /* ignore */ }
  }

  // Perioden-Wechsel eines Blocks: Liste/Index setzen und persistieren.
  function onPeriodenChange(b: Block, list: Periode<any>[], newIndex: number) {
    const nextPerioden = { ...periodenRef.current, [b]: list };
    const nextPIdx = { ...pIdxRef.current, [b]: newIndex };
    periodenRef.current = nextPerioden;
    pIdxRef.current = nextPIdx;
    setPerioden(nextPerioden);
    setPIdx(nextPIdx);
    void persistPerioden(b, list);
  }

  // Helfer: ein numerisches Feld (ct/kWh oder €/kWh oder %)
  // Commit eines einzelnen Feldes: speichert den aktuellen State-Stand. Nutzt
  // die funktionale Form von setS NICHT zum Speichern (async), sondern baut den
  // nächsten Zustand explizit und übergibt ihn an save().
  const commitField = (key: keyof Settings, rawValue: string) => {
    const v = parseFloat(rawValue.replace(",", "."));
    const next = { ...sRef.current, [key]: Number.isFinite(v) ? v : 0 };
    void save(next);
  };

  const numField = (
    key: keyof Settings,
    label: string,
    unit: string,
    disabled = false
  ) => (
    <div className="ek-row">
      <label>{label}</label>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={String(s[key] ?? "")}
        onChange={(e) => {
          const v = parseFloat(e.target.value.replace(",", "."));
          setS({ ...s, [key]: Number.isFinite(v) ? v : 0 });
        }}
        onBlur={(e) => commitField(key, e.target.value)}
      />
      <span className="ek-unit">{unit}</span>
    </div>
  );

  // Brutto-Gesamtpreis-Bestandteile für den dyn. Tarif (ohne Börsenpreis).
  // "Beschaffung/Vertrieb" ist der Aufschlag (Marge) des Anbieters auf den
  // Börsenpreis und gilt NUR beim dynamischen Tarif. Der Brutto-Gesamtpreis
  // bei einem Day-Ahead-Preis von 0 ct/kWh entspricht daher dieser Summe
  // (Beschaffung + feste Bestandteile + Standard-Netzentgelt) * (1 + USt);
  // der tatsächliche Preis ergibt sich je VS zzgl. des Börsenpreises.
  const dynNetto =
    s.beschaffung +
    s.stromsteuer +
    s.konzessionsabgabe +
    s.aufschlagNetznutzung +
    s.offshoreUmlage +
    s.kwkgUmlage +
    s.netzentgeltStandard;
  const dynBrutto = dynNetto * (1 + s.umsatzsteuer / 100);

  // §14a Zeitfenster bearbeiten
  function updateWindow(idx: number, patch: Partial<LoadWindow>) {
    const lw = s.lastWindows.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    save({ ...s, lastWindows: lw });
  }
  function addWindow(kind: "hoch" | "niedrig") {
    save({
      ...s,
      lastWindows: [
        ...s.lastWindows,
        { kind, startMin: 0, endMin: 0, quarters: [1, 2, 3, 4] },
      ],
    });
  }
  function removeWindow(idx: number) {
    save({ ...s, lastWindows: s.lastWindows.filter((_, i) => i !== idx) });
  }
  function toggleQuarter(idx: number, q: number) {
    const w = s.lastWindows[idx];
    const quarters = w.quarters.includes(q)
      ? w.quarters.filter((x) => x !== q)
      : [...w.quarters, q].sort();
    updateWindow(idx, { quarters });
  }

  const off = !s.paragraf14aAktiv; // §14a-Felder ausgegraut?

  return (
    <div className="page ek-page">
      <h2>
        Stromtarif & -anschluss{" "}
        {saved && <span className="ek-saved">gespeichert ✓</span>}
      </h2>
      <p className="hint">
        Hier hinterlegst du alle Preisparameter, aus denen die Anlage die
        Bezugskosten und Vergütungen berechnet: Einspeisevergütung und
        EEG-Regelung, das Stromtarifmodell (fest oder dynamisch nach Börsenpreis)
        sowie die §14a-Optionen zu reduzierten bzw. dynamischen Netzentgelten.
        Diese Werte fließen in die Kostenberechnung auf der Monatsübersicht und in
        die Wirtschaftlichkeitsanalyse ein.
      </p>

      {/* ---------- Stromtarif ---------- */}
      <section className="ek-section">
        <h3>Stromtarif</h3>
        {perioden.stromtarif.length > 0 && (
          <PeriodeNav perioden={perioden.stromtarif} index={pIdx.stromtarif}
            onIndexChange={(i) => setPIdx((p) => ({ ...p, stromtarif: i }))}
            onChange={(list, i) => onPeriodenChange("stromtarif", list, i)} />
        )}
        <div className="ek-row">
          <label>Tarifmodell</label>
          <div className="ek-switch">
            <button
              className={s.tarifMode === "fix" ? "active" : ""}
              onClick={() => save({ ...s, tarifMode: "fix" })}
            >
              Fixtarif
            </button>
            <button
              className={s.tarifMode === "dyn" ? "active" : ""}
              onClick={() => save({ ...s, tarifMode: "dyn" })}
            >
              Dynamischer Tarif
            </button>
          </div>
        </div>

        <div className="ek-row">
          <label>Stromanbieter</label>
          <input
            type="text"
            className="ek-anbieter"
            value={s.anbieterName ?? ""}
            onChange={(e) => setS({ ...sRef.current, anbieterName: e.target.value })}
            onBlur={(e) => void save({ ...sRef.current, anbieterName: e.target.value })}
            placeholder="z. B. Stadtwerke"
          />
        </div>

        {numField("grundgebuehrMonat", "Monatliche Grundgebühr", "€/Monat")}
        <p className="ek-hint" style={{ marginTop: 0 }}>
          Fixer monatlicher Grundpreis des Stromtarifs. Wird anteilig je Tag in
          die Bezugskosten eingerechnet.
        </p>

        {numField("sofortbonus", "Sofortbonus", "€")}
        <p className="ek-hint" style={{ marginTop: 0 }}>
          Einmalbetrag, der nach Lieferbeginn ausgezahlt wird. Wird anteilig über
          das erste Belieferungsjahr (ab „gültig ab" der Periode) als Gutschrift
          auf die Tageskosten verteilt.
        </p>

        {numField("neukundenbonus", "Neukundenbonus", "€")}
        <p className="ek-hint" style={{ marginTop: 0 }}>
          Bonus, der nach einem vollen Belieferungsjahr mit der ersten
          Jahresabrechnung verrechnet wird. Wird ebenfalls anteilig über das erste
          Jahr als Gutschrift berücksichtigt.
        </p>

        {numField("messstelleEuroJahr", "Extrakosten für Messstelle", "€/Jahr")}
        <p className="ek-hint" style={{ marginTop: 0 }}>
          Jährliche Mehrkosten, falls der Messstellenbetrieb (moderne
          Messeinrichtung oder intelligentes Messsystem) separat vom
          Messstellenbetreiber abgerechnet wird und nicht im Tarif enthalten ist.
          Wird anteilig je Tag in die Bezugskosten eingerechnet.
        </p>

        {s.tarifMode === "fix" ? (
          <>
            {numField("strompreis", "Strompreis", "€/kWh")}
            <p className="ek-hint">
              Gesamtpreis inkl. Netzentgelte, Steuern, Umlagen.
            </p>
          </>
        ) : (
          <p className="ek-hint">
            Dynamischer Tarif: Arbeitspreis aus dem Börsen-/Beschaffungspreis
            (siehe unten) plus Steuern und Abgaben.
          </p>
        )}

        {/* gemeinsame Preisbestandteile (netto) */}
        <div className="ek-subhead">Preisbestandteile (netto)</div>
        {numField(
          "beschaffung",
          "Beschaffung/Vertrieb (Anbieter-Aufschlag, nur dyn.)",
          "ct/kWh",
          s.tarifMode === "fix"
        )}
        {numField("stromsteuer", "Stromsteuer", "ct/kWh")}
        {numField("konzessionsabgabe", "Konzessionsabgabe", "ct/kWh")}
        {numField("aufschlagNetznutzung", "Aufschlag besondere Netznutzung", "ct/kWh")}
        {numField("offshoreUmlage", "Offshore-Netzumlage", "ct/kWh")}
        {numField("kwkgUmlage", "KWKG-Umlage", "ct/kWh")}
        {numField("netzentgeltStandard", "Netzentgelt (Standardlast)", "ct/kWh")}
        {numField("umsatzsteuer", "Umsatzsteuer", "%")}

        {s.tarifMode === "dyn" && (
          <div className="ek-sum">
            Steuern und Abgaben gesamt (brutto, inkl. Standard-Netzentgelt):{" "}
            <strong>{nf(dynBrutto, 2)} ct/kWh</strong>
            <div className="ek-hint" style={{ marginTop: 4 }}>
              Entspricht dem Brutto-Gesamtpreis bei einem Day-Ahead-Preis von
              0 ct/kWh. Der tatsächliche Gesamtpreis ergibt sich je Viertelstunde
              aus diesem Wert plus dem Börsenpreis (mal Umsatzsteuer).
            </div>
          </div>
        )}

        {/* Tagespreis-Chart: bei Fixtarif ausgegraut */}
        <SpotChart disabled={s.tarifMode === "fix"} settings={s} />
      </section>

      {/* ---------- Einspeisung (gehört zur Stromtarif-Periode) ---------- */}
      <section className="ek-section">
        <h3>Einspeisung</h3>
        <div className="ek-row">
          <label>EEG-Regelung</label>
          <select
            className="ek-select"
            value={s.eegRegelung}
            onChange={(e) => save({ ...s, eegRegelung: e.target.value as typeof s.eegRegelung })}
          >
            <option value="vor2502">EEG vor 25.02.2025</option>
            <option value="ab2502">EEG ab 25.02.2025</option>
          </select>
        </div>
        <p className="ek-hint">
          Seit dem 25. Februar 2025 erhalten neue PV-Anlagen größer 2 kWp die
          EEG-Vergütung für eingespeisten Strom nur noch während Börsenstrompreise
          0 Cent oder höher sind. Weitere Regelungen kommen hier künftig hinzu.
        </p>
        <div className="ek-row">
          <label>Einspeisevergütung</label>
          <input
            type="text"
            inputMode="decimal"
            value={String(
              Number.isFinite(s.einspeiseverguetung)
                ? Math.round(s.einspeiseverguetung * 100 * 1000) / 1000
                : ""
            )}
            onChange={(e) => {
              const v = parseFloat(e.target.value.replace(",", "."));
              // Eingabe in ct/kWh -> intern als €/kWh speichern.
              setS({ ...s, einspeiseverguetung: Number.isFinite(v) ? v / 100 : 0 });
            }}
            onBlur={(e) => {
              const v = parseFloat(e.target.value.replace(",", "."));
              void save({ ...s, einspeiseverguetung: Number.isFinite(v) ? v / 100 : 0 });
            }}
          />
          <span className="ek-unit">ct/kWh</span>
        </div>
        <p className="ek-hint">
          Diese Werte gelten <strong>dauerhaft</strong> und sind nicht
          zeitversioniert. Hier sind bewusst keine festen EEG-Einspeisesätze
          hinterlegt: Bei mehreren PV-Anlagen mit unterschiedlichen
          Inbetriebnahme-Daten ergibt sich ein individueller, nach Anlagengröße
          gewichteter Mischsatz. Diesen trägst du hier direkt ein – das ist
          flexibler als eine feste Tabelle.
        </p>
      </section>

      {/* ---------- §14a Modul 1 (pauschale Reduktion) ---------- */}
      <section className="ek-section">
        <h3>
          §14a Modul 1: Pauschale Reduktion Netzentgelte{" "}
          <label className="ek-toggle">
            <input
              type="checkbox"
              checked={s.paragraf14aModul1Aktiv}
              onChange={(e) => {
                const on = e.target.checked;
                // Modul 3 hängt von Modul 1 ab: wird Modul 1 deaktiviert, muss
                // Modul 3 zwingend mit ausgehen.
                save({ ...s, paragraf14aModul1Aktiv: on, ...(on ? {} : { paragraf14aAktiv: false }) });
              }}
            />
            aktiv
          </label>
        </h3>
        {perioden.modul1.length > 0 && (
          <PeriodeNav perioden={perioden.modul1} index={pIdx.modul1}
            onIndexChange={(i) => setPIdx((p) => ({ ...p, modul1: i }))}
            onChange={(list, i) => onPeriodenChange("modul1", list, i)} />
        )}
        <div className={s.paragraf14aModul1Aktiv ? "" : "ek-disabled"}>
          {numField(
            "modul1PauschaleNetto",
            "Pauschale jährliche Reduktion (netto)",
            "€/Jahr",
            !s.paragraf14aModul1Aktiv
          )}
          <div className="ek-sum">
            Bruttobetrag:{" "}
            <strong>
              {nf(s.modul1PauschaleNetto * (1 + s.umsatzsteuer / 100), 2)} €/Jahr
            </strong>
          </div>
        </div>
      </section>

      {/* ---------- §14a Modul 3 ---------- */}
      <section className="ek-section">
        <h3>
          §14a Modul 3: Dynamische Netzentgelte{" "}
          <label className="ek-toggle" title={!s.paragraf14aModul1Aktiv ? "Nur zusammen mit Modul 1 möglich" : undefined}>
            <input
              type="checkbox"
              checked={s.paragraf14aAktiv}
              disabled={!s.paragraf14aModul1Aktiv}
              onChange={(e) =>
                save({ ...s, paragraf14aAktiv: e.target.checked })
              }
            />
            aktiv
          </label>
        </h3>
        {!s.paragraf14aModul1Aktiv && (
          <p className="ek-hint" style={{ marginTop: 0 }}>
            Modul 3 setzt eine aktive Teilnahme an Modul 1 voraus und kann nur
            zusammen mit Modul 1 aktiviert werden.
          </p>
        )}
        {perioden.modul3.length > 0 && (
          <PeriodeNav perioden={perioden.modul3} index={pIdx.modul3}
            onIndexChange={(i) => setPIdx((p) => ({ ...p, modul3: i }))}
            onChange={(list, i) => onPeriodenChange("modul3", list, i)} />
        )}

        <div className={off ? "ek-disabled" : ""}>
          <div className="ek-row">
            <label>Standardlasttarif</label>
            <span className="ek-readonly">{nf(s.netzentgeltStandard, 3)}</span>
            <span className="ek-unit">ct/kWh</span>
          </div>
          <p className="ek-hint" style={{ marginTop: 0 }}>
            Wird automatisch aus dem Netzentgelt (Standardlast) bei den
            Preisbestandteilen übernommen.
          </p>
          {numField("netzentgeltHoch", "Hochlasttarif", "ct/kWh", off)}
          {numField("netzentgeltNiedrig", "Niedriglasttarif", "ct/kWh", off)}

          <div className="ek-subhead">Zeitfenster</div>
          <p className="ek-hint">
            Es gilt immer der Standardlasttarif, außer ein Fenster für Hoch-
            oder Niedriglast trifft auf die aktuelle Uhrzeit (und Quartal) zu.
          </p>

          {s.lastWindows.map((w, idx) => (
            <div className="ek-window" key={idx}>
              <select
                disabled={off}
                value={w.kind}
                onChange={(e) =>
                  updateWindow(idx, { kind: e.target.value as "hoch" | "niedrig" })
                }
              >
                <option value="hoch">Hochlast</option>
                <option value="niedrig">Niedriglast</option>
              </select>
              <input
                type="time"
                disabled={off}
                value={toHHMM(w.startMin)}
                onChange={(e) =>
                  updateWindow(idx, { startMin: fromHHMM(e.target.value) })
                }
              />
              <span>–</span>
              <input
                type="time"
                disabled={off}
                value={toHHMM(w.endMin)}
                onChange={(e) =>
                  updateWindow(idx, { endMin: fromHHMM(e.target.value) })
                }
              />
              <span className="ek-quarters">
                {QUARTERS.map((q) => (
                  <label key={q}>
                    <input
                      type="checkbox"
                      disabled={off}
                      checked={w.quarters.includes(q)}
                      onChange={() => toggleQuarter(idx, q)}
                    />
                    Q{q}
                  </label>
                ))}
              </span>
              <button
                className="ek-del"
                disabled={off}
                onClick={() => removeWindow(idx)}
              >
                ✕
              </button>
            </div>
          ))}

          {!off && (
            <div className="ek-addwin">
              <button onClick={() => addWindow("hoch")}>+ Hochlast</button>
              <button onClick={() => addWindow("niedrig")}>
                + Niedriglast
              </button>
            </div>
          )}

          <NetzentgeltChart settings={s} />
        </div>
      </section>

      {/* ---------- Wasserkosten ---------- */}
      <section className="ek-section">
        <h3>Wasserkosten</h3>
        {perioden.wasser.length > 0 && (
          <PeriodeNav perioden={perioden.wasser} index={pIdx.wasser}
            onIndexChange={(i) => setPIdx((p) => ({ ...p, wasser: i }))}
            onChange={(list, i) => onPeriodenChange("wasser", list, i)} />
        )}
        <p className="hint">
          Preise für die Berechnung der Wasserkosten auf der Seite
          Details&nbsp;→&nbsp;Wasserverbrauch. Frisch- und Abwasser werden je
          verbrauchtem Kubikmeter berechnet, der Grundpreis anteilig je Tag.
        </p>
        {numField("wasserFrischEuroM3", "Frischwasser", "€/m³")}
        {numField("wasserAbwasserEuroM3", "Abwasser", "€/m³")}
        {numField("wasserGrundpreisMonat", "Grundpreis", "€/Monat")}
      </section>

      <div className="src-actions">
        <button onClick={() => void save(s)} className="src-save">
          Speichern
        </button>
        {saved && <span className="src-testok">✓ gespeichert</span>}
      </div>
    </div>
  );
}
