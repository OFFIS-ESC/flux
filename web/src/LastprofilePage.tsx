// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useRef, useState } from "react";
import { nf } from "./chartUtils";
import { DateNav } from "./DateNav";
import { ChartHoverLayer } from "./ChartHoverLayer";
import { profileLabel } from "./profileLabels";
import type { FullState } from "./types";

interface ProfileInfo {
  name: string;
  builtin: boolean;
}
interface DayData {
  name: string;
  date: string;
  jahresverbrauch: number;
  tagestyp: "WT" | "SA" | "FT";
  values: number[];
}

const TAGESTYP_LABEL: Record<string, string> = {
  WT: "Werktag",
  SA: "Samstag",
  FT: "Sonn-/Feiertag",
};

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Einfarbiges Lastgang-Bar-Chart (96 Viertelstunden, kWh).
function LastgangChart({ values, unit, color }: { values: number[]; unit: string; color: string }) {
  const W = 760;
  const H = 276;
  const padL = 48;
  const padR = 12;
  const padT = 14;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  // Bidirektional: Profile können negative Werte enthalten (Eigeneinspeisung).
  const maxPos = Math.max(0, ...values);
  const maxNeg = Math.max(0, ...values.map((v) => -v));
  const span = Math.max(0.0001, maxPos + maxNeg);
  const zeroY = padT + (maxPos / span) * plotH; // Nulllinie
  const yOf = (v: number) => zeroY - (v / span) * plotH;
  const barW = plotW / 96;
  const ticks = maxNeg > 0 ? [maxPos, 0, -maxNeg] : [0, maxPos / 2, maxPos];
  const hourLabels = [0, 6, 12, 18, 24];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="tv-svg" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#bbb" : "#eee"} />
            <text x={padL - 6} y={yOf(t) + 4} className="tv-axis" textAnchor="end">
              {nf(t, 3)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const yv = yOf(v);
          const top = v >= 0 ? yv : zeroY;
          const h = Math.abs(yv - zeroY);
          return (
            <rect
              key={i}
              x={padL + i * barW + 0.5}
              y={top}
              width={Math.max(barW - 1, 0.5)}
              height={Math.max(h, 0)}
              fill={color}
            />
          );
        })}
        {hourLabels.map((h) => (
          <text
            key={h}
            x={padL + (h / 24) * plotW}
            y={padT + plotH + 16}
            className="tv-axis"
            textAnchor="middle"
          >
            {String(h).padStart(2, "0")}
          </text>
        ))}
        <text x={padL + plotW / 2} y={H - 4} className="tv-axis-title" textAnchor="middle">
          Uhrzeit
        </text>
        <text x={padL + 2} y={padT + 10} className="tv-dir" fill={color}>
          ▲ Bezug ({unit})
        </text>
      </svg>
      <ChartHoverLayer
        svgW={W}
        plotL={padL}
        plotW={plotW}
        rowsForSlot={(i) => [
          { label: "Bezug", value: `${nf(values[i], 3)} ${unit}`, color },
        ]}
      />
    </div>
  );
}

export function LastprofilePage({ state }: { state: FullState }) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selected, setSelected] = useState<string>("H25");
  const [date, setDate] = useState<string>(isoToday());
  const [jv, setJv] = useState<number>(4000);
  const [day, setDay] = useState<DayData | null>(null);

  const [uploadName, setUploadName] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function loadProfiles() {
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => {});
  }
  useEffect(loadProfiles, []);

  // Lastgang neu laden bei Auswahländerung
  useEffect(() => {
    if (!selected) return;
    fetch(`/api/profiles/${encodeURIComponent(selected)}/day?date=${date}&jv=${jv}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDay(d))
      .catch(() => setDay(null));
  }, [selected, date, jv]);

  const tagessumme = day ? day.values.reduce((a, b) => a + b, 0) : 0;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadText(String(reader.result ?? ""));
      if (!uploadName) setUploadName(f.name.replace(/\.csv$/i, ""));
    };
    reader.readAsText(f);
  }

  async function doUpload() {
    setUploadMsg(null);
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: uploadName, csv: uploadText }),
    });
    const j = await res.json();
    if (j.ok) {
      setUploadMsg({ ok: true, text: `Profil „${uploadName}“ gespeichert.` });
      setProfiles(j.profiles ?? []);
      setSelected(uploadName);
      setUploadText("");
      setUploadName("");
      if (fileRef.current) fileRef.current.value = "";
    } else {
      setUploadMsg({ ok: false, text: j.error ?? "Upload fehlgeschlagen." });
    }
  }

  async function deleteProfile(name: string) {
    const res = await fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
    const j = await res.json();
    if (j.ok) {
      setProfiles(j.profiles ?? []);
      if (selected === name) setSelected("H25");
    }
  }

  return (
    <div className="page">
      <h2>Lastprofile</h2>
      <p className="hint">
        Der Emulations-Simulator (Rolle „Netz §42c Emulation“) kann auf diese
        Lastprofile zugreifen. Eingebaute Profile stammen aus den
        repräsentativen BDEW-Standardlastprofilen; eigene Profile lassen sich
        hochladen und werden danach in der Quellen-Konfiguration auswählbar.
      </p>

      {/* Profilliste */}
      <section className="card">
        <h3>Verfügbare Profile</h3>
        <p className="hint">
          Liste aller nutzbaren Lastprofile – eingebaute BDEW-Standardlastprofile
          und selbst hochgeladene. Ein Profil beschreibt den typischen
          Tagesverlauf des Verbrauchs (normiert), der später mit einem
          Jahresverbrauch skaliert wird. Über „CSV" lässt sich ein Profil
          herunterladen.
        </p>
        <div className="table-scroll">
        <table className="data-table lp-table">
          <tbody>
            <tr>
              <th>Profil</th>
              <th>Typ</th>
              <th>Download</th>
              <th></th>
            </tr>
            {profiles.map((p) => (
              <tr key={p.name} className={selected === p.name ? "lp-active" : ""}>
                <td>
                  <button className="lp-link" onClick={() => setSelected(p.name)}>
                    {profileLabel(p.name)}
                  </button>
                </td>
                <td>{p.builtin ? "eingebaut" : "eigenes"}</td>
                <td>
                  <a href={`/api/profiles/${encodeURIComponent(p.name)}/download`}>CSV</a>
                </td>
                <td>
                  {!p.builtin && (
                    <button className="src-del" onClick={() => deleteProfile(p.name)}>
                      löschen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* Visualisierung */}
      <section className="card">
        <h3>Lastgang-Visualisierung</h3>
        <p className="hint">
          Vorschau des gewählten Profils für den ausgewählten Tag, skaliert auf
          den eingegebenen Jahresverbrauch. Das Profil erkennt automatisch den
          Tagestyp (Werktag, Samstag, Sonntag) und zeigt den resultierenden
          Verbrauch je Viertelstunde – so lässt sich prüfen, wie sich ein Profil
          im Simulator verhalten wird.
        </p>
        <div className="lp-controls">
          <label>
            Profil{" "}
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {profileLabel(p.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <DateNav value={date} onChange={setDate} />
          </label>
          <label>
            Jahresverbrauch (kWh/a){" "}
            <input
              type="number"
              min={0}
              step={100}
              value={jv}
              onChange={(e) => setJv(Number(e.target.value))}
              style={{ width: 100 }}
            />
          </label>
        </div>
        {day && (
          <>
            <div className="lp-daymeta">
              {profileLabel(selected)} · {day.date} · Tagestyp:{" "}
              <strong>{TAGESTYP_LABEL[day.tagestyp]}</strong> · Tagessumme:{" "}
              <strong>{nf(tagessumme, 2)} kWh</strong>
            </div>
            <LastgangChart values={day.values} unit="kWh" color={state.settings.vizColorVerbrauchGesamt} />
          </>
        )}
      </section>

      {/* Upload */}
      <section className="card">
        <h3>Eigenes Profil hochladen</h3>
        <div className="lp-spec">
          <strong>Dateiformat (CSV, Semikolon-getrennt):</strong>
          <ul>
            <li>
              Zeilen mit <code>#</code> sind Kommentare. Trennzeichen{" "}
              <code>;</code>, Dezimaltrenner <code>.</code> (Punkt).
            </li>
            <li>
              Erste Spalte = Zeitfenster (nur zur Lesbarkeit, wird ignoriert),
              danach die Wertespalten. Genau 96 Datenzeilen (00:00–00:15 …
              23:45–00:00).
            </li>
            <li>
              <strong>Einfaches Format:</strong> Kopfzeile <code>zeit;wert</code>{" "}
              – ein Tagesgang, der für alle Monate und Tagestypen gilt.
            </li>
            <li>
              <strong>Erweitertes Format:</strong> Kopfzeile{" "}
              <code>zeit;WT;SA;FT</code> (3 Wertespalten) – je ein Tagesgang für
              Werktag (WT), Samstag (SA) und Sonn-/Feiertag (FT); für alle Monate
              gleich.
            </li>
            <li>
              <strong>Vollständiges Format:</strong> Kopfzeile{" "}
              <code>zeit;1_WT;1_SA;1_FT;…;12_WT;12_SA;12_FT</code> (36
              Wertespalten) – getrennt nach Monat (1–12) und Tagestyp
              (WT=Werktag, SA=Samstag, FT=Sonn-/Feiertag).
            </li>
            <li>
              Die Höhe der Werte ist beliebig – intern wird auf den je Quelle
              eingestellten Jahresverbrauch skaliert. Es zählt nur die{" "}
              <em>Form</em> des Verlaufs.
            </li>
          </ul>
          <div className="lp-templates">
            <span>Vorlagen:</span>
            <a href="/api/profiles-template?format=einfach" className="lp-template-link">
              einfaches Format
            </a>
            <a href="/api/profiles-template?format=erweitert" className="lp-template-link">
              erweitertes Format
            </a>
            <a href="/api/profiles-template?format=vollstaendig" className="lp-template-link">
              vollständiges Format
            </a>
          </div>
        </div>

        <div className="lp-upload">
          <label>
            Name{" "}
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="z. B. MeinHaushalt"
              style={{ width: 200 }}
            />
          </label>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} />
          <button
            onClick={doUpload}
            disabled={!uploadName || !uploadText}
            className="src-save"
          >
            Hochladen
          </button>
        </div>
        {uploadMsg && (
          <div className={uploadMsg.ok ? "lp-msg-ok" : "lp-msg-err"}>{uploadMsg.text}</div>
        )}
      </section>
    </div>
  );
}
