// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

interface SectionInfo {
  key: string;
  label: string;
  count: number | null;
}

export function ImportExportPage() {
  const [sections, setSections] = useState<SectionInfo[]>([]);
  // Export-Auswahl (Default: alles)
  const [expSel, setExpSel] = useState<Set<string>>(new Set());
  // Import-Zustand
  const [importObj, setImportObj] = useState<any>(null);
  const [importInfo, setImportInfo] = useState<{ version: number; sections: SectionInfo[] } | null>(null);
  const [impSel, setImpSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fileName, setFileName] = useState<string>("");

  // --- Daten-Export/Import über Zeitspanne (getrennt von den Einstellungen) ---
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [dVon, setDVon] = useState<string>(monthAgo);
  const [dBis, setDBis] = useState<string>(today);
  const [dMsg, setDMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dImportObj, setDImportObj] = useState<any>(null);
  const [dImportInfo, setDImportInfo] = useState<any>(null);
  const [dFileName, setDFileName] = useState<string>("");
  const [dMode, setDMode] = useState<"skip" | "overwrite">("skip");
  const [dConfirmOpen, setDConfirmOpen] = useState(false);
  // Vorschau: Datensätze je Tabelle für den gewählten Zeitraum (wie beim
  // Einstellungs-Export). Wird bei Zeitraumänderung nachgeladen.
  const [dPreview, setDPreview] = useState<{ counts: Record<string, number>; labels: Record<string, string>; total: number } | null>(null);
  const [dPreviewLoading, setDPreviewLoading] = useState(false);
  useEffect(() => {
    if (dVon > dBis) { setDPreview(null); return; }
    let ab = false;
    setDPreviewLoading(true);
    fetch(`/api/data/export/preview?von=${dVon}&bis=${dBis}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (ab) return;
        if (j?.ok) setDPreview({ counts: j.counts ?? {}, labels: j.labels ?? {}, total: j.total ?? 0 });
        else setDPreview(null);
      })
      .catch(() => { if (!ab) setDPreview(null); })
      .finally(() => { if (!ab) setDPreviewLoading(false); });
    return () => { ab = true; };
  }, [dVon, dBis]);

  async function doDataExport() {
    setDMsg(null);
    if (dVon > dBis) { setDMsg({ ok: false, text: "Startdatum liegt nach Enddatum." }); return; }
    try {
      const res = await fetch(`/api/data/export?von=${dVon}&bis=${dBis}`);
      const data = await res.json();
      if (!res.ok || data.ok === false) { setDMsg({ ok: false, text: data.error ?? "Export fehlgeschlagen." }); return; }
      const total = Object.values(data.counts ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hems-daten-${dVon}_bis_${dBis}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDMsg({ ok: true, text: `Datenexport heruntergeladen (${total} Datensätze).` });
    } catch (e: any) {
      setDMsg({ ok: false, text: e?.message ?? "Export fehlgeschlagen." });
    }
  }

  async function onDataFile(e: React.ChangeEvent<HTMLInputElement>) {
    setDMsg(null); setDImportInfo(null); setDImportObj(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setDFileName(file.name);
    try {
      const obj = JSON.parse(await file.text());
      const res = await fetch("/api/data/import/inspect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: obj }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) { setDMsg({ ok: false, text: d.error ?? "Datei nicht lesbar." }); return; }
      setDImportObj(obj);
      setDImportInfo(d);
    } catch {
      setDMsg({ ok: false, text: "Die Datei ist kein gültiges JSON." });
    }
  }

  function requestDataImport() {
    if (dMode === "overwrite" && (dImportInfo?.totalExisting ?? 0) > 0) setDConfirmOpen(true);
    else doDataImport();
  }

  async function doDataImport() {
    setDConfirmOpen(false);
    if (!dImportObj) return;
    setDMsg(null);
    try {
      const res = await fetch("/api/data/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dImportObj, mode: dMode }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) { setDMsg({ ok: false, text: d.error ?? "Import fehlgeschlagen." }); return; }
      const total = Object.values(d.written ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
      setDMsg({ ok: true, text: `Datenimport abgeschlossen: ${total} Datensätze geschrieben.` });
      setDImportObj(null); setDImportInfo(null); setDFileName("");
    } catch (e: any) {
      setDMsg({ ok: false, text: e?.message ?? "Import fehlgeschlagen." });
    }
  }

  useEffect(() => {
    fetch("/api/settings/sections")
      .then((r) => r.json())
      .then((d: SectionInfo[]) => {
        setSections(d);
        setExpSel(new Set(d.map((s) => s.key))); // Vorauswahl: alles
      })
      .catch(() => setSections([]));
  }, []);

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setFn(n);
  };

  async function doExport() {
    setMsg(null);
    try {
      const res = await fetch("/api/settings/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: [...expSel] }),
      });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `hems-einstellungen-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Export heruntergeladen." });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Export fehlgeschlagen." });
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg(null);
    setImportInfo(null);
    setImportObj(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const res = await fetch("/api/settings/import/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: obj }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ ok: false, text: d.error ?? "Datei nicht lesbar." });
        return;
      }
      setImportObj(obj);
      setImportInfo({ version: d.version, sections: d.sections });
      setImpSel(new Set(d.sections.map((s: SectionInfo) => s.key))); // Vorauswahl: alles Erkannte
    } catch {
      setMsg({ ok: false, text: "Die Datei ist kein gültiges JSON." });
    }
  }

  function requestImport() {
    if (mode === "replace") setConfirmOpen(true);
    else doImport();
  }

  async function doImport() {
    setConfirmOpen(false);
    if (!importObj) return;
    setMsg(null);
    try {
      const res = await fetch("/api/settings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: importObj, sections: [...impSel], mode }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ ok: false, text: d.error ?? "Import fehlgeschlagen." });
        return;
      }
      setMsg({
        ok: true,
        text: `Import abgeschlossen: ${d.applied?.length ? d.applied.join(", ") : "nichts angewandt"}. Die Seite lädt Daten beim nächsten Öffnen neu.`,
      });
      setImportObj(null);
      setImportInfo(null);
      setFileName("");
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Import fehlgeschlagen." });
    }
  }

  return (
    <div className="page">
      <h2>Import / Export</h2>
      <p className="hint">
        Sichere deine Konfiguration als JSON-Datei oder übertrage sie auf eine
        andere Installation. Enthalten sind alle Einstellungen inklusive der
        Quellen-Konfiguration (Geräte, Rollen, URLs, Felder) sowie Tarif, Farben,
        Senken und Emulationsprofile. <strong>Nicht</strong> enthalten sind die im
        Betrieb aufgelaufenen Messwerte (Historie, Viertelstunden, Zählerstände) –
        diese entstehen zur Laufzeit aus den Quellen.
      </p>

      {msg && (
        <p className={msg.ok ? "ie-msg-ok" : "ie-msg-err"}>
          {msg.ok ? "✓ " : "⚠ "}{msg.text}
        </p>
      )}

      {/* EXPORT */}
      <section className="card">
        <h3>Export Einstellungen</h3>
        <p className="hint">Wähle aus, welche Bereiche exportiert werden sollen.</p>
        <div className="ie-list">
          {sections.map((s) => (
            <label key={s.key} className="ie-item">
              <input
                type="checkbox"
                checked={expSel.has(s.key)}
                onChange={() => toggle(expSel, setExpSel, s.key)}
              />
              <span className="ie-item-label">{s.label}</span>
              {s.count != null && <span className="ie-item-count">{s.count}</span>}
            </label>
          ))}
        </div>
        <div className="ie-actions">
          <button onClick={() => setExpSel(new Set(sections.map((s) => s.key)))} className="ie-link">
            alle
          </button>
          <button onClick={() => setExpSel(new Set())} className="ie-link">
            keine
          </button>
          <button onClick={doExport} className="ie-primary" disabled={expSel.size === 0}>
            Export herunterladen
          </button>
        </div>
      </section>

      {/* IMPORT */}
      <section className="card">
        <h3>Import Einstellungen</h3>
        <p className="hint">
          Wähle eine zuvor exportierte JSON-Datei. Anschließend siehst du, welche
          Bereiche enthalten sind, und wählst, was übernommen werden soll.
        </p>
        <label className="ie-file">
          <input type="file" accept="application/json,.json" onChange={onFile} />
        </label>

        {importInfo && (
          <div className="ie-import-detail">
            <p className="hint" style={{ marginTop: 8 }}>
              Datei <strong>{fileName}</strong> (Format-Version {importInfo.version})
              enthält folgende Bereiche – wähle die zu importierenden:
            </p>
            <div className="ie-list">
              {importInfo.sections.map((s) => (
                <label key={s.key} className="ie-item">
                  <input
                    type="checkbox"
                    checked={impSel.has(s.key)}
                    onChange={() => toggle(impSel, setImpSel, s.key)}
                  />
                  <span className="ie-item-label">{s.label}</span>
                  {s.count != null && <span className="ie-item-count">{s.count}</span>}
                </label>
              ))}
            </div>

            <div className="ie-mode">
              <div className="ie-mode-title">Umgang mit vorhandenen Daten:</div>
              <label className="ie-radio">
                <input type="radio" name="impmode" checked={mode === "merge"} onChange={() => setMode("merge")} />
                <span>
                  <strong>Zusammenführen</strong> – vorhandene Einträge bleiben
                  erhalten; gleiche Einträge (per ID/Schlüssel) werden durch die
                  importierten überschrieben, neue kommen hinzu.
                </span>
              </label>
              <label className="ie-radio">
                <input type="radio" name="impmode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span>
                  <strong>Ersetzen</strong> – der bestehende Bestand der gewählten
                  Bereiche (z.&nbsp;B. alle Senken, alle Räume, alle Abnehmer) wird
                  vor dem Import gelöscht und komplett durch die Datei ersetzt.
                </span>
              </label>
              <p className="hint" style={{ marginTop: 4, fontSize: 12 }}>
                Hinweis: Energiekosten und Visualisierung sind einzelne
                Wertesätze – diese werden immer feldweise übernommen.
              </p>
            </div>

            <div className="ie-actions">
              <button onClick={requestImport} className="ie-primary" disabled={impSel.size === 0}>
                Import ausführen
              </button>
            </div>

            {confirmOpen && (
              <div className="ie-confirm-overlay" onClick={() => setConfirmOpen(false)}>
                <div className="ie-confirm" onClick={(e) => e.stopPropagation()}>
                  <div className="ie-confirm-title">⚠ Daten ersetzen?</div>
                  <p>
                    Du hast den Modus <strong>Ersetzen</strong> gewählt. Für die
                    ausgewählten Bereiche (
                    {importInfo.sections.filter((s) => impSel.has(s.key)).map((s) => s.label).join(", ")}
                    ) wird der <strong>bestehende Bestand vollständig gelöscht</strong>{" "}
                    und durch die Datei ersetzt. Das kann nicht rückgängig gemacht
                    werden.
                  </p>
                  <p className="hint" style={{ fontSize: 13 }}>
                    Tipp: Erstelle vorher über den Export oben eine Sicherung deines
                    aktuellen Standes.
                  </p>
                  <div className="ie-confirm-actions">
                    <button className="ie-cancel" onClick={() => setConfirmOpen(false)}>
                      Abbrechen
                    </button>
                    <button className="ie-danger" onClick={doImport}>
                      Ja, ersetzen
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ==== Sichtbare Trennung: Einstellungen oben, MESSDATEN unten ==== */}
      <div style={{
        margin: "36px 0 20px", borderTop: "3px solid #76b900", paddingTop: 20,
      }}>
        <h2 style={{ margin: 0 }}>Messdaten (Zeitspanne)</h2>
        <p className="hint" style={{ marginTop: 4 }}>
          Getrennt von den Einstellungen oben: Hier exportierst und importierst du
          die gesammelten Verläufe (Viertelstundenwerte, Temperaturen, Tagesbilanzen,
          Börsenpreise, Wärmepumpe …) für einen Zeitraum.
        </p>
      </div>

      <section className="card">
        <h3>Export Daten</h3>
        <p className="hint">Alle im Zeitraum erfassten Messdaten als Datei sichern.</p>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <label className="hint">Startdatum
            <input type="date" value={dVon} max={dBis} onChange={(e) => setDVon(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: "4px 6px" }} />
          </label>
          <label className="hint">Enddatum
            <input type="date" value={dBis} min={dVon} onChange={(e) => setDBis(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: "4px 6px" }} />
          </label>
          <button className="btn-primary" onClick={doDataExport}>Datenexport herunterladen</button>
        </div>

        {/* Vorschau: enthaltene Datensätze je Bereich (wie beim Einstellungs-Export) */}
        {dPreviewLoading && <p className="hint" style={{ marginTop: 10 }}>Ermittle enthaltene Datensätze…</p>}
        {dPreview && !dPreviewLoading && (
          <div className="ie-list" style={{ marginTop: 10 }}>
            {Object.keys(dPreview.counts).map((tbl) => (
              <div key={tbl} className="ie-item" style={{ cursor: "default" }}>
                <span className="ie-item-label">{dPreview.labels[tbl] ?? tbl}</span>
                <span className="ie-item-count">{dPreview.counts[tbl].toLocaleString("de-DE")}</span>
              </div>
            ))}
            <div className="ie-item" style={{ cursor: "default", fontWeight: 700, borderTop: "1px solid #e0e0e0", marginTop: 4, paddingTop: 6 }}>
              <span className="ie-item-label">Gesamt</span>
              <span className="ie-item-count">{dPreview.total.toLocaleString("de-DE")}</span>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Import Daten</h3>
        <p className="hint">
          Eine Datenexport-Datei einlesen. Der enthaltene Zeitraum und die Anzahl
          Datensätze werden vor dem Import angezeigt.
        </p>
        <input type="file" accept="application/json,.json" onChange={onDataFile} />
        {dFileName && <span className="hint" style={{ marginLeft: 8 }}>{dFileName}</span>}

        {dImportInfo && (
          <div style={{ marginTop: 16 }}>
            <p className="hint">
              Datei enthält Daten von <strong>{dImportInfo.von}</strong> bis{" "}
              <strong>{dImportInfo.bis}</strong> — insgesamt{" "}
              <strong>{dImportInfo.totalIncoming}</strong> Datensätze.
              {dImportInfo.totalExisting > 0 && (
                <> Im Zielzeitraum liegen bereits <strong>{dImportInfo.totalExisting}</strong> Datensätze vor.</>
              )}
            </p>

            <div className="table-scroll">
              <table className="data-table">
                <tbody>
                  <tr><th>Datenart</th><th>in Datei</th><th>bereits vorhanden</th></tr>
                  {Object.entries(dImportInfo.counts ?? {}).map(([t, c]: [string, any]) => (
                    c > 0 ? (
                      <tr key={t}>
                        <td>{dImportInfo.labels?.[t] ?? t}</td>
                        <td>{c}</td>
                        <td>{dImportInfo.existing?.[t] ?? 0}</td>
                      </tr>
                    ) : null
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="hint" style={{ marginBottom: 6 }}>Wie mit vorhandenen Daten im Zeitraum umgehen?</div>
              <label style={{ display: "block", marginBottom: 4 }}>
                <input type="radio" checked={dMode === "skip"} onChange={() => setDMode("skip")} />{" "}
                Vorhandene behalten, nur fehlende ergänzen
              </label>
              <label style={{ display: "block" }}>
                <input type="radio" checked={dMode === "overwrite"} onChange={() => setDMode("overwrite")} />{" "}
                Vorhandene im Zeitraum überschreiben
              </label>
            </div>

            <button className="btn-primary" style={{ marginTop: 14 }} onClick={requestDataImport}>
              Datenimport starten
            </button>
          </div>
        )}

        {dMsg && (
          <p style={{ marginTop: 12, color: dMsg.ok ? "#2d6a00" : "#b3261e" }}>{dMsg.text}</p>
        )}

        {dConfirmOpen && (
          <div className="ie-confirm-overlay">
            <div className="ie-confirm">
              <div className="ie-confirm-title">⚠ Vorhandene Daten überschreiben?</div>
              <p>
                Du hast <strong>Überschreiben</strong> gewählt. Für den Zeitraum{" "}
                <strong>{dImportInfo?.von}</strong> bis <strong>{dImportInfo?.bis}</strong>{" "}
                werden die bereits vorhandenen <strong>{dImportInfo?.totalExisting}</strong>{" "}
                Datensätze gelöscht und durch die Datei ersetzt. Das kann nicht
                rückgängig gemacht werden.
              </p>
              <p className="hint" style={{ fontSize: 13 }}>
                Tipp: Exportiere vorher denselben Zeitraum als Sicherung.
              </p>
              <div className="ie-confirm-actions">
                <button className="ie-cancel" onClick={() => setDConfirmOpen(false)}>Abbrechen</button>
                <button className="ie-danger" onClick={doDataImport}>Ja, überschreiben</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
