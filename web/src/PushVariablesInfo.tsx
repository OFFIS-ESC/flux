// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

// Zeigt die in Push-Nachrichten verwendbaren Platzhalter als aufklappbares
// Infofeld. Die Liste kommt vom Server (/api/push-variables), damit sie immer
// mit der tatsächlich unterstützten Ersetzung übereinstimmt.
interface PushVar { key: string; beschreibung: string }

let cache: PushVar[] | null = null;

export function PushVariablesInfo() {
  const [vars, setVars] = useState<PushVar[]>(cache ?? []);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (cache) return;
    fetch("/api/push-variables")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { cache = d?.variables ?? []; setVars(cache!); })
      .catch(() => {});
  }, []);

  if (vars.length === 0) return null;

  return (
    <div className="push-vars-info">
      <button type="button" className="push-vars-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Verfügbare Platzhalter
      </button>
      {open && (
        <ul className="push-vars-list">
          {vars.map((v) => (
            <li key={v.key}>
              <code>{`{${v.key}}`}</code> – {v.beschreibung}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Kompakte Variante: nur ein Info-Icon, das die Platzhalter-Liste in einem
// größeren Mouseover-Tooltip zeigt (nicht ausklappbar, nimmt keinen Platz weg).
export function PushVariablesInfoIcon() {
  const [vars, setVars] = useState<PushVar[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    fetch("/api/push-variables")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { cache = d?.variables ?? []; setVars(cache!); })
      .catch(() => {});
  }, []);
  if (vars.length === 0) return null;
  return (
    <span className="push-vars-icon" tabIndex={0} aria-label="Verfügbare Platzhalter">
      <span className="push-vars-icon-badge">i</span>
      <span className="push-vars-tooltip">
        <strong>Verfügbare Platzhalter</strong>
        {vars.map((v) => (
          <span key={v.key} className="push-vars-tip-row">
            <code>{`{${v.key}}`}</code> {v.beschreibung}
          </span>
        ))}
      </span>
    </span>
  );
}
