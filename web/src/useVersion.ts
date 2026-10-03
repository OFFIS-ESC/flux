// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

// Lädt die Anwendungsversion einmal vom Server (/api/version) und cached sie
// modulweit, damit mehrere Aufrufer nicht mehrfach anfragen.
let cached: string | null = null;
const listeners = new Set<(v: string) => void>();

export function useVersion(): string {
  const [version, setVersion] = useState<string>(cached ?? "");
  useEffect(() => {
    if (cached) { setVersion(cached); return; }
    const onVal = (v: string) => setVersion(v);
    listeners.add(onVal);
    if (listeners.size === 1) {
      fetch("/api/version")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          cached = j?.version ?? "";
          for (const l of listeners) l(cached as string);
        })
        .catch(() => { /* ignore */ });
    }
    return () => { listeners.delete(onVal); };
  }, []);
  return version;
}
