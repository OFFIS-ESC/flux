// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { ActionListEditor } from "./AutomatisierungPage";
import type { FullState } from "./types";

interface AccessEntry {
  id: string; art: "card" | "pin"; wert: string; name: string; aktiv: boolean;
  wochentage?: number[]; vonUhr?: string; bisUhr?: string; ablauf?: string;
  aktionen: any[]; ausloeseRegeln?: string[];
}
interface LogEintrag {
  id: number; source_id: string; ts: string; art: string; wert: string;
  bits: number | null; ergebnis: string | null; name: string | null;
}
interface ReaderStatus {
  sourceId: string; label: string; online: boolean | null; topicBasis?: string; nachrichtenEmpfangen?: boolean;
  letztesEreignis?: { art: string; wert: string; ts: string };
}

const WOCHENTAGE = [
  { n: 1, l: "Mo" }, { n: 2, l: "Di" }, { n: 3, l: "Mi" }, { n: 4, l: "Do" },
  { n: 5, l: "Fr" }, { n: 6, l: "Sa" }, { n: 0, l: "So" },
];

export function ZugangskontrollePage({ state }: { state: FullState }) {
  const [log, setLog] = useState<LogEintrag[]>([]);
  const [reader, setReader] = useState<ReaderStatus[]>([]);
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [rules, setRules] = useState<Array<{ id: string; name: string }>>([]);
  const [gespeichert, setGespeichert] = useState(false);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    fetch("/api/access/entries").then((r) => r.json()).then((j) => { if (j.ok) setEntries(j.entries ?? []); }).catch(() => {});
    fetch("/api/rules").then((r) => r.json()).then((j) => {
      const list = Array.isArray(j) ? j : (j.rules ?? []);
      setRules(list.map((r: any) => ({ id: r.id, name: r.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetch("/api/access/log?limit=200").then((r) => r.json()).catch(() => null),
        fetch("/api/access/status").then((r) => r.json()).catch(() => null),
      ]).then(([l, s]) => {
        if (l?.ok) setLog(l.eintraege ?? []);
        if (s?.ok) setReader(s.reader ?? []);
        setLaden(false);
      });
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  // Schaltbare/steuerbare Quellen für den Aktions-Editor (wie in den Regeln).
  const switchables = (state.sources ?? []).map((s: any) => ({
    id: s.key, label: s.label, role: s.role, switchable: s.switchable, deviceType: s.deviceType,
  }));
  const acSpeicher = (state.sources ?? []).filter((s: any) => s.role === "acBattery").map((s: any) => ({ id: s.key, label: s.label }));

  const speichern = (next: AccessEntry[]) => {
    setEntries(next);
    fetch("/api/access/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: next }) })
      .then((r) => r.json()).then((j) => { if (j.ok) { setEntries(j.entries); setGespeichert(true); setTimeout(() => setGespeichert(false), 1500); } }).catch(() => {});
  };
  const neuerEintrag = () => speichern([...entries, {
    id: String(Date.now()), art: "card", wert: "", name: "", aktiv: true, aktionen: [],
  }]);
  const setAt = (i: number, e: AccessEntry) => speichern(entries.map((x, j) => j === i ? e : x));
  const removeAt = (i: number) => speichern(entries.filter((_, j) => j !== i));

  const fmtZeit = (iso: string) => {
    try { return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch { return iso; }
  };
  // Wert eines Log-Eintrags per Klick als neuen Whitelist-Eintrag übernehmen.
  const uebernehmen = (e: LogEintrag) => {
    if (entries.some((x) => x.wert === e.wert && x.art === e.art)) return;
    speichern([...entries, { id: String(Date.now()), art: e.art === "pin" ? "pin" : "card", wert: e.wert, name: "", aktiv: true, aktionen: [] }]);
  };

  return (
    <div className="page">
      <h2 className="page-maintitle">Zugangskontrolle</h2>
      <p className="hint">
        Verwalte gültige Karten/PINs und die Aktionen, die sie auslösen (Regeln,
        Aktoren, Alarm, Nachricht). Ein gültiger Zutritt bestätigt der Reader mit
        LED/Buzzer; unbekannte oder abgelaufene Kennungen werden abgewiesen.
      </p>

      {reader.length > 0 && (
        <div className="card">
          <h3>Reader-Status</h3>
          <div className="access-reader-liste">
            {reader.map((r) => (
              <div key={r.sourceId} className="access-reader">
                <span className={`dot ${r.online === true ? "green" : r.online === false ? "red" : "gray"}`} />
                <span className="access-reader-name">{r.label}</span>
                <span className="access-reader-status">
                  {r.online === true ? "online" : r.online === false ? "offline" : "unbekannt"}
                  {r.letztesEreignis && ` · zuletzt ${r.letztesEreignis.art === "pin" ? "PIN" : "Karte"} ${fmtZeit(r.letztesEreignis.ts)}`}
                </span>
                {r.nachrichtenEmpfangen === false && (
                  <div className="access-reader-warnung">
                    ⚠ Noch keine Nachrichten auf <code>{r.topicBasis}/…</code> empfangen.
                    Prüfe, ob der Reader an dieses Basis-Topic sendet (erwartet werden{" "}
                    <code>{r.topicBasis}/status</code>, <code>/card</code>, <code>/pin</code>).
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Gültige Tags & PINs</h3>
          <div>{gespeichert && <span className="src-testok" style={{ marginRight: 8 }}>✓ gespeichert</span>}<button className="ie-primary" onClick={neuerEintrag}>+ Eintrag</button></div>
        </div>
        <p className="hint" style={{ fontSize: 12 }}>
          Lege fest, welche Karten/PINs gültig sind und was sie auslösen. Tipp: Halte
          zuerst den Tag an den Reader – er erscheint dann unten im Protokoll und lässt
          sich per „Übernehmen" direkt eintragen.
        </p>
        {entries.length === 0 ? (
          <p className="hint">Noch keine Einträge. Lege einen an oder übernimm einen aus dem Protokoll.</p>
        ) : (
          <div className="access-entries">
            {entries.map((e, i) => (
              <div key={e.id} className="access-entry card">
                <div className="access-entry-kopf">
                  <label className="access-aktiv"><input type="checkbox" checked={e.aktiv} onChange={(ev) => setAt(i, { ...e, aktiv: ev.target.checked })} /> aktiv</label>
                  <select value={e.art} onChange={(ev) => setAt(i, { ...e, art: ev.target.value as "card" | "pin" })}>
                    <option value="card">Karte/Tag</option>
                    <option value="pin">PIN</option>
                  </select>
                  <input type="text" placeholder={e.art === "pin" ? "PIN" : "Karten-ID (dezimal)"} value={e.wert} onChange={(ev) => setAt(i, { ...e, wert: ev.target.value })} />
                  <input type="text" placeholder="Name (z.B. Sven Fob)" value={e.name} onChange={(ev) => setAt(i, { ...e, name: ev.target.value })} style={{ flex: 1 }} />
                  <button className="rule-del-cond" title="Eintrag löschen" onClick={() => removeAt(i)}>✕</button>
                </div>

                <div className="access-gueltig">
                  <span className="access-gueltig-label">Gültig an:</span>
                  {WOCHENTAGE.map((w) => {
                    const gesetzt = e.wochentage && e.wochentage.length > 0;
                    const an = !gesetzt || e.wochentage!.includes(w.n);
                    return (
                      <button key={w.n} className={`access-tag-btn${an ? " an" : ""}`}
                        onClick={() => {
                          const cur = new Set(e.wochentage && e.wochentage.length ? e.wochentage : WOCHENTAGE.map((x) => x.n));
                          cur.has(w.n) ? cur.delete(w.n) : cur.add(w.n);
                          setAt(i, { ...e, wochentage: [...cur] });
                        }}>{w.l}</button>
                    );
                  })}
                  <span className="access-gueltig-label" style={{ marginLeft: 10 }}>von</span>
                  <input type="time" value={e.vonUhr ?? ""} onChange={(ev) => setAt(i, { ...e, vonUhr: ev.target.value || undefined })} />
                  <span className="access-gueltig-label">bis</span>
                  <input type="time" value={e.bisUhr ?? ""} onChange={(ev) => setAt(i, { ...e, bisUhr: ev.target.value || undefined })} />
                  <span className="access-gueltig-label" style={{ marginLeft: 10 }}>Ablauf</span>
                  <input type="date" value={e.ablauf ?? ""} onChange={(ev) => setAt(i, { ...e, ablauf: ev.target.value || undefined })} />
                </div>

                {rules.length > 0 && (
                  <div className="access-regeln">
                    <span className="access-gueltig-label">Regeln auslösen:</span>
                    {rules.map((r) => (
                      <label key={r.id} className="access-regel-chk">
                        <input type="checkbox" checked={(e.ausloeseRegeln ?? []).includes(r.id)}
                          onChange={(ev) => {
                            const cur = new Set(e.ausloeseRegeln ?? []);
                            ev.target.checked ? cur.add(r.id) : cur.delete(r.id);
                            setAt(i, { ...e, ausloeseRegeln: [...cur] });
                          }} />
                        {r.name}
                      </label>
                    ))}
                  </div>
                )}

                <ActionListEditor
                  title="Aktionen bei gültigem Zutritt"
                  phase="on"
                  actions={e.aktionen ?? []}
                  sources={switchables as any}
                  acSpeicher={acSpeicher}
                  onChange={(list) => setAt(i, { ...e, aktionen: list })}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Protokoll</h3>
        {laden ? (
          <p className="hint">lädt …</p>
        ) : log.length === 0 ? (
          <p className="hint">Noch keine Ereignisse empfangen. Sobald ein Reader eine Karte liest oder eine PIN eingegeben wird, erscheint es hier.</p>
        ) : (
          <div className="table-scroll">
            <table className="rule-log">
              <thead><tr><th>Zeitpunkt</th><th>Art</th><th>Wert</th><th>Bits</th><th>Ergebnis</th><th></th></tr></thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtZeit(e.ts)}</td>
                    <td>{e.art === "pin" ? "PIN" : "Karte"}</td>
                    <td className="access-wert">{e.wert}</td>
                    <td>{e.bits ?? ""}</td>
                    <td>{e.name ? `${e.name} (${e.ergebnis})` : (e.ergebnis ?? "–")}</td>
                    <td>{!entries.some((x) => x.wert === e.wert) && <button className="access-uebernehmen" onClick={() => uebernehmen(e)} title="Als gültigen Eintrag übernehmen">＋</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
