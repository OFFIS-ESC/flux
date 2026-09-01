// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// FLUX-Logo ("Home Energy Intelligence") – Produktlogo der Anwendung.
// Das Bild liegt als Asset im Projekt und wird von Vite gebundlet. Höhe wird
// per CSS-Klasse gesteuert.
import fluxLogoUrl from "./flux-logo.png";

export function FluxLogo({ className }: { className?: string }) {
  return <img className={className} src={fluxLogoUrl} alt="FLUX – Home Energy Intelligence" />;
}
