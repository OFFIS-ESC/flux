// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";

// Minimaler Hash-Router: liest window.location.hash und aktualisiert bei
// Änderung. Routen sind einfache Strings wie "", "status", "settings".
export function useRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState<string>(
    () => window.location.hash.replace(/^#\/?/, "") || ""
  );

  useEffect(() => {
    const onHash = () =>
      setRoute(window.location.hash.replace(/^#\/?/, "") || "");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (r: string) => {
    window.location.hash = r ? `/${r}` : "/";
  };

  return [route, navigate];
}
