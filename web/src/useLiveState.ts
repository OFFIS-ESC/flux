// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useRef, useState } from "react";
import type { FullState } from "./types";

// Verbindet sich per Server-Sent Events mit dem Backend und liefert
// den jeweils aktuellen State live. Reconnectet automatisch.
export function useLiveState(): {
  state: FullState | null;
  connected: boolean;
  attempts: number; // Anzahl fehlgeschlagener Verbindungsversuche
} {
  const [state, setState] = useState<FullState | null>(null);
  const [connected, setConnected] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let closed = false;

    function connect() {
      const es = new EventSource("/api/stream");
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setAttempts(0);
      };
      es.onmessage = (ev) => {
        try {
          setState(JSON.parse(ev.data));
        } catch {
          /* ignorieren */
        }
      };
      es.onerror = () => {
        setConnected(false);
        setAttempts((n) => n + 1);
        es.close();
        if (!closed) setTimeout(connect, 2000); // Reconnect
      };
    }

    connect();
    return () => {
      closed = true;
      esRef.current?.close();
    };
  }, []);

  return { state, connected, attempts };
}

// Hilfsfunktion: POST an eine Aktions-Route
export async function action(path: string): Promise<void> {
  await fetch(`/api/${path}`, { method: "POST" });
}
