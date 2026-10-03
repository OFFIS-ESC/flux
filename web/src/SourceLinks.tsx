// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

// Zeigt die in der Quellendefinition hinterlegten Links (extraLinks) aller
// Quellen mit den angegebenen Rollen. Wird auf den kontextbezogenen Seiten
// genutzt (PV → Stromerzeugung, acBattery → AC-Speicher, heatpump/waterTank →
// Wärmepumpe bzw. Warmwasser).
interface LinkSource { id: string; label: string; links: Array<{ url: string; label: string }> }

export function SourceLinks({ roles, title }: { roles: string; title?: string }) {
  const [sources, setSources] = useState<LinkSource[]>([]);

  useEffect(() => {
    fetch(`/api/source-links?roles=${encodeURIComponent(roles)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSources(d?.sources ?? []))
      .catch(() => setSources([]));
  }, [roles]);

  if (sources.length === 0) return null;

  return (
    <div className="source-links-block">
      {title && <div className="source-links-title">{title}</div>}
      <div className="source-links-list">
        {sources.map((s) =>
          s.links.map((l, i) => (
            <a
              key={`${s.id}-${i}`}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="consumer-link"
              title={`${s.label}: ${l.url}`}
            >
              🔗 {s.label}: {l.label}
            </a>
          ))
        )}
      </div>
    </div>
  );
}
