// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { FullState } from "./types";
import { TagesverlaeufePage } from "./TagesverlaeufePage";
import { StatistikenPage } from "./StatistikenPage";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface AbrPeriode {
  gueltigAb: string;
  anbieter: string;
  tarifMode: string;
  strompreis: number;
  tage: number;
  ersterTag: string | null;
  letzterTag: string | null;
  bezogenKwh: number;
  eingespeistKwh: number;
  arbeitskosten: number;
  arbeitspreisMittelCt: number;
  einspeiseMittelCt: number;
  modul3Effekt: number;
  modul3EffektHoch: number;
  modul3EffektNiedrig: number;
  modul3KwhHoch: number;
  modul3KwhNiedrig: number;
  modul3KwhStandard: number;
  grundgebuehr: number;
  messstelle: number;
  sofortbonus: number;
  neukundenbonus: number;
  modul1: number;
  einspeiseverguetung: number;
  sharingVerguetung: number;
  saldo: number;
  einsparung: number;
}

interface Abrechnung {
  von: string;
  bis: string;
  tageMitDaten: number;
  ersterTag: string | null;
  letzterTag: string | null;
  arbeitskosten: number;
  bezogenKwh: number;
  arbeitspreisMittelCt: number;
  eingespeistKwh: number;
  einspeiseMittelCt: number;
  modul3Effekt: number;
  modul3EffektHoch: number;
  modul3EffektNiedrig: number;
  modul3KwhHoch: number;
  modul3KwhNiedrig: number;
  modul3KwhStandard: number;
  grundgebuehr: number;
  messstelle: number;
  sofortbonus: number;
  neukundenbonus: number;
  modul1: number;
  einspeiseverguetung: number;
  sharingVerguetung: number;
  saldo: number;
  einsparung: number;
  einsparungPv: number;
  einsparungSpeicher: number;
  eigenKwhPv: number;
  eigenKwhSpeicher: number;
  perioden: AbrPeriode[];
  mehrperiodig: boolean;
}

const eur = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const kwh = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " kWh";
const ct = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ct/kWh";

// Eine Zeile der Abrechnung. "credit" = Gutschrift (grün, mit −). "signed" =
// Wert kann in beide Richtungen gehen (grün bei <0, rot bei >0) – für den
// Modul-3-Effekt. "detail" = optionale eingerückte Unterzeile(n).
function Zeile({ label, value, credit, signed, strong, hint, detail }: {
  label: string; value: number; credit?: boolean; signed?: boolean;
  strong?: boolean; hint?: string; detail?: ReactNode;
}) {
  if (value === 0 && !strong && !detail) return null;
  let color: string | undefined;
  if (signed && value !== 0) color = value < 0 ? "#2e7d32" : "#c0392b";
  else if (credit && value !== 0) color = "#2e7d32";
  return (
    <>
      <tr className={strong ? "abr-sum-row" : undefined}>
        <td className="abr-label">
          {label}
          {hint && <span className="abr-hint">{hint}</span>}
        </td>
        <td className="abr-value" style={{ color }}>{eur(value)}</td>
      </tr>
      {detail && (
        <tr className="abr-detail-row">
          <td className="abr-detail" colSpan={2}>{detail}</td>
        </tr>
      )}
    </>
  );
}

// Liefert für eine Position (Schlüssel eines €-Feldes) die periodenweise
// Aufschlüsselung als Detailinhalt – aber nur, wenn der Zeitraum mehrere
// Tarifperioden umfasst und die Position in mindestens einer Periode ≠ 0 ist.
type EurKey = "grundgebuehr" | "messstelle" | "modul1" | "sofortbonus" | "neukundenbonus";
function splitDetail(data: Abrechnung, key: EurKey): ReactNode {
  if (!data.mehrperiodig) return undefined;
  const rel = data.perioden.filter((p) => p[key] !== 0);
  if (rel.length < 2) return undefined; // nur eine Periode betroffen → kein Split nötig
  return (
    <div className="abr-split">
      {rel.map((p) => (
        <div key={p.gueltigAb} className="abr-split-row">
          <span className="abr-split-label">
            ab {p.gueltigAb}{p.anbieter ? ` · ${p.anbieter}` : ""}
          </span>
          <span className="abr-split-val">{eur(p[key])}</span>
        </div>
      ))}
    </div>
  );
}

function AbrechnungBlock() {
  const jahr = new Date().getFullYear();
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(isoToday());
  const [data, setData] = useState<Abrechnung | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (von > bis) { setError("Das Startdatum liegt nach dem Enddatum."); setData(null); return; }
    setError(null);
    setLoading(true);
    fetch(`/api/abrechnung?von=${von}&bis=${bis}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d.error ? null : d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [von, bis]);

  return (
    <div className="page">
      <div className="card">
        <h3>Stromabrechnung (Zeitraum wählbar)</h3>
        <p className="hint">
          Aufstellung aller Kostenbestandteile für den gewählten Zeitraum – wie eine
          mitlaufende Jahresabrechnung. Alle Beträge werden aus den
          viertelstundengenauen Tageskosten summiert; Grundgebühr, Messstelle,
          Boni und §14a-Reduktion sind über ihre Tagesanteile automatisch korrekt
          über den Zeitraum verteilt. Unter den Bezugskosten steht die bezogene
          Energiemenge und der mittlere Arbeitspreis; ist §14a Modul 3 aktiv, wird
          der darin enthaltene Effekt des zeitvariablen Netzentgelts (Einsparung
          in Niedriglast, Aufschlag in Hochlast) separat ausgewiesen. Umfasst der
          Zeitraum mehrere Tarifperioden, werden die betroffenen Positionen je
          Periode aufgeschlüsselt. Gutschriften erscheinen grün mit Minuszeichen.
        </p>

        <div className="abr-range">
          <label>von <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
          <label>bis <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
        </div>

        {error && <p className="hint" style={{ color: "#c0392b" }}>{error}</p>}
        {loading && <p className="hint">lädt…</p>}

        {data && !loading && (
          data.tageMitDaten === 0 ? (
            <p className="hint">Für diesen Zeitraum liegen keine Daten vor.</p>
          ) : (
            <>
              <div className="table-scroll">
              <table className="data-table abr-table">
                <tbody>
                  <Zeile
                    label="Bezugskosten (Arbeitspreis)"
                    value={data.arbeitskosten}
                    strong
                    detail={
                      data.mehrperiodig ? (
                        <div className="abr-split">
                          <div className="abr-split-head">
                            Aufgeteilt nach Tarifperiode:
                          </div>
                          {data.perioden.map((p) => (
                            <div key={p.gueltigAb} className="abr-split-row">
                              <span className="abr-split-label">
                                ab {p.gueltigAb}
                                {p.anbieter ? ` · ${p.anbieter}` : ""} ·{" "}
                                {kwh(p.bezogenKwh)} × Ø {ct(p.arbeitspreisMittelCt)}
                              </span>
                              <span className="abr-split-val">{eur(p.arbeitskosten)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span>
                          {kwh(data.bezogenKwh)} bezogen · Ø-Arbeitspreis{" "}
                          {ct(data.arbeitspreisMittelCt)}
                        </span>
                      )
                    }
                  />
                  {data.modul3Effekt !== 0 && (
                    <Zeile
                      label="davon §14a Modul 3 (zeitvar. Netzentgelt)"
                      value={data.modul3Effekt}
                      signed
                      hint="ggü. Standard-Netzentgelt; − Einsparung / + Hochlast"
                      detail={
                        <div className="abr-split">
                          {data.modul3KwhHoch > 0 && (
                            <div className="abr-split-row">
                              <span className="abr-split-label">
                                Hochlast · {kwh(data.modul3KwhHoch)}
                              </span>
                              <span className="abr-split-val" style={{ color: "#c0392b" }}>
                                {eur(data.modul3EffektHoch)}
                              </span>
                            </div>
                          )}
                          {data.modul3KwhNiedrig > 0 && (
                            <div className="abr-split-row">
                              <span className="abr-split-label">
                                Niedriglast · {kwh(data.modul3KwhNiedrig)}
                              </span>
                              <span className="abr-split-val" style={{ color: "#2e7d32" }}>
                                {eur(data.modul3EffektNiedrig)}
                              </span>
                            </div>
                          )}
                          {data.modul3KwhStandard > 0 && (
                            <div className="abr-split-row">
                              <span className="abr-split-label">
                                Standardlast · {kwh(data.modul3KwhStandard)}
                              </span>
                              <span className="abr-split-val">kein Effekt</span>
                            </div>
                          )}
                          {data.mehrperiodig && (
                            <>
                              <div className="abr-split-head" style={{ marginTop: 4 }}>
                                nach Tarifperiode:
                              </div>
                              {data.perioden.filter((p) => p.modul3Effekt !== 0).map((p) => (
                                <div key={p.gueltigAb} className="abr-split-row">
                                  <span className="abr-split-label">
                                    ab {p.gueltigAb}{p.anbieter ? ` · ${p.anbieter}` : ""}
                                  </span>
                                  <span className="abr-split-val" style={{ color: p.modul3Effekt < 0 ? "#2e7d32" : "#c0392b" }}>
                                    {eur(p.modul3Effekt)}
                                  </span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      }
                    />
                  )}
                  <Zeile label="Monatliche Grundgebühr (anteilig)" value={data.grundgebuehr}
                    detail={splitDetail(data, "grundgebuehr")} />
                  <Zeile label="Messstellenbetrieb (anteilig)" value={data.messstelle}
                    detail={splitDetail(data, "messstelle")} />
                  <Zeile label="§14a Modul 1 – Netzentgeltreduktion" value={data.modul1} credit
                    detail={splitDetail(data, "modul1")} />
                  <Zeile label="Sofortbonus (anteilig)" value={data.sofortbonus} credit
                    detail={splitDetail(data, "sofortbonus")} />
                  <Zeile label="Neukundenbonus (anteilig)" value={data.neukundenbonus} credit
                    detail={splitDetail(data, "neukundenbonus")} />
                  <Zeile label="Einspeisevergütung" value={-data.einspeiseverguetung} credit
                    detail={
                      data.eingespeistKwh > 0 ? (
                        data.mehrperiodig ? (
                          <div className="abr-split">
                            <div className="abr-split-head">Aufgeteilt nach Tarifperiode:</div>
                            {data.perioden.filter((p) => p.eingespeistKwh > 0).map((p) => (
                              <div key={p.gueltigAb} className="abr-split-row">
                                <span className="abr-split-label">
                                  ab {p.gueltigAb}
                                  {p.anbieter ? ` · ${p.anbieter}` : ""} ·{" "}
                                  {kwh(p.eingespeistKwh)} × Ø {ct(p.einspeiseMittelCt)}
                                </span>
                                <span className="abr-split-val" style={{ color: "#2e7d32" }}>
                                  {eur(-p.einspeiseverguetung)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span>
                            {kwh(data.eingespeistKwh)} eingespeist · Ø-Vergütung{" "}
                            {ct(data.einspeiseMittelCt)}
                          </span>
                        )
                      ) : undefined
                    }
                  />
                  <Zeile label="§42c-Vergütung (Energy Sharing)" value={-data.sharingVerguetung} credit />
                </tbody>
                <tfoot>
                  <tr className="abr-total">
                    <td className="abr-label">Saldo für den Zeitraum</td>
                    <td className="abr-value">{eur(data.saldo)}</td>
                  </tr>
                </tfoot>
              </table>
              </div>

              <p className="abr-meta">
                {data.tageMitDaten} Tag(e) mit Daten
                {data.ersterTag && data.letzterTag &&
                  ` (${data.ersterTag} bis ${data.letzterTag})`}
                . Ein positiver Saldo sind Netto-Stromkosten, ein negativer ein
                Guthaben.
              </p>

              <div className="abr-einsparung">
                <div>
                  Zusätzlich vermiedene Bezugskosten durch Eigenverbrauch:{" "}
                  <strong>{eur(data.einsparung)}</strong>
                </div>
                {(data.eigenKwhPv > 0 || data.eigenKwhSpeicher > 0) && (
                  <div className="abr-es-split">
                    <div className="abr-es-row">
                      <span>PV-Direktverbrauch · {kwh(data.eigenKwhPv)}</span>
                      <span>{eur(data.einsparungPv)}</span>
                    </div>
                    <div className="abr-es-row">
                      <span>Speicher-Entladung · {kwh(data.eigenKwhSpeicher)}</span>
                      <span>{eur(data.einsparungSpeicher)}</span>
                    </div>
                  </div>
                )}
                <div className="abr-es-hint">
                  Vermiedene Netzbezugskosten für selbst verbrauchte Energie,
                  jeweils abzüglich der dafür entgangenen Einspeisevergütung.
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

interface VglTag {
  date: string;
  bezogenKwh: number;
  fix: number;
  dyn: number;
}
interface Tarifvergleich {
  von: string;
  bis: string;
  tageMitDaten: number;
  rows: VglTag[];
  summe: { bezogenKwh: number; fix: number; dyn: number };
}

function TarifvergleichBlock() {
  const jahr = new Date().getFullYear();
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(isoToday());
  const [data, setData] = useState<Tarifvergleich | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (von > bis) { setError("Das Startdatum liegt nach dem Enddatum."); setData(null); return; }
    setError(null);
    setLoading(true);
    fetch(`/api/tarifvergleich?von=${von}&bis=${bis}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d.error ? null : d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [von, bis]);

  // Zelle für die güntigere Variante grün hervorheben.
  const cell = (val: number, other: number) => (
    <td className="vgl-num" style={{ color: val < other ? "#2e7d32" : undefined, fontWeight: val < other ? 600 : undefined }}>
      {eur(val)}
    </td>
  );

  return (
    <div className="page">
      <div className="card">
        <h3>Vergleich Fixtarif vs. dynamischer Tarif</h3>
        <p className="hint">
          Gegenüberstellung der reinen Netzbezugskosten je Tag (ohne
          Einspeisevergütung) für beide Tarifmodelle – jeweils auf denselben
          tatsächlichen Verbrauch angewandt. So wird sichtbar, welches Modell für
          den eigenen Lastgang günstiger gewesen wäre, unabhängig vom aktuell
          eingestellten Tarif. Der jeweils günstigere Wert ist grün.
        </p>

        <div className="abr-range">
          <label>von <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
          <label>bis <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
        </div>

        {error && <p className="hint" style={{ color: "#c0392b" }}>{error}</p>}
        {loading && <p className="hint">lädt…</p>}

        {data && !loading && (
          data.tageMitDaten === 0 ? (
            <p className="hint">Für diesen Zeitraum liegen keine Daten vor.</p>
          ) : (
            <div className="table-scroll">
            <table className="data-table vgl-table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Bezug</th>
                  <th>Fixtarif</th>
                  <th>Dyn. Tarif</th>
                  <th>Differenz</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const diff = r.dyn - r.fix;
                  return (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td className="vgl-num">{r.bezogenKwh.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      {cell(r.fix, r.dyn)}
                      {cell(r.dyn, r.fix)}
                      <td className="vgl-num" style={{ color: diff === 0 ? undefined : diff < 0 ? "#2e7d32" : "#c0392b" }}>
                        {diff > 0 ? "+" : ""}{eur(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="vgl-sum">
                  <td>Σ</td>
                  <td className="vgl-num">{data.summe.bezogenKwh.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  {cell(data.summe.fix, data.summe.dyn)}
                  {cell(data.summe.dyn, data.summe.fix)}
                  <td className="vgl-num" style={{ color: (data.summe.dyn - data.summe.fix) === 0 ? undefined : (data.summe.dyn - data.summe.fix) < 0 ? "#2e7d32" : "#c0392b" }}>
                    {data.summe.dyn - data.summe.fix > 0 ? "+" : ""}{eur(data.summe.dyn - data.summe.fix)}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          )
        )}
        <p className="abr-meta">
          Differenz = dynamischer Tarif − Fixtarif. Ein negativer Wert (grün)
          bedeutet, der dynamische Tarif wäre günstiger gewesen.
        </p>
      </div>
    </div>
  );
}

export function StromverbrauchPage({ state }: { state: FullState }) {
  return (
    <div className="stromverbrauch-page">
      <h2 className="page-maintitle">Stromverbrauch</h2>
      <TagesverlaeufePage state={state} />
      <StatistikenPage state={state} />
      <AbrechnungBlock />
      <TarifvergleichBlock />
    </div>
  );
}
