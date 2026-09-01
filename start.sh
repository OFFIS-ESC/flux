#!/usr/bin/env bash
#
# FLUX – Start (ohne Migration/Build)
# -----------------------------------
# Startet eine BEREITS eingerichtete Version neu – z. B. nachdem der Server
# zwischendurch gestoppt wurde. Es wird NICHT migriert, NICHT umbenannt und
# NICHT neu gebaut; es startet nur den Server.
#
# Der Server liefert das Web-Interface selbst aus (web/dist), daher gibt es kein
# separates Frontend zu starten – nach dem Start ist die Oberfläche unter
#   http://localhost:3000
# erreichbar. (Strg+C beendet den Server.)
#
# Aufruf (im Versionsordner, z. B. "hems v401"):
#   bash start.sh
#
# Falls einmal noch nichts gebaut wurde (kein server/dist), baut das Skript
# einmalig nach; sonst startet es sofort.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Sicherstellen, dass Abhängigkeiten/Builds vorhanden sind. Im Normalfall (nach
# update.sh) sind sie das – dann wird dieser Block übersprungen und der Start ist
# sofort.
if [ ! -d "server/node_modules" ]; then
  echo "==> server/node_modules fehlt – installiere einmalig ..."
  ( cd server && npm install )
fi
if [ ! -f "server/dist/index.js" ]; then
  echo "==> server/dist fehlt – baue Backend einmalig ..."
  ( cd server && npm run build )
fi
if [ ! -f "web/dist/index.html" ]; then
  echo "==> web/dist fehlt – installiere & baue Frontend einmalig ..."
  ( cd web && npm install && npm run build )
fi

echo "==> Starte FLUX-Server (Oberfläche danach unter http://localhost:3000)."
echo "    Strg+C beendet den Server."

# EEBUS-Sidecar (optional) vor dem Server im Hintergrund starten.
if [ -f "$SCRIPT_DIR/sidecar-lib.sh" ]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/sidecar-lib.sh"
  start_sidecar_if_possible "$SCRIPT_DIR"
  # Beim Beenden (Strg+C / Skript-Ende) einen selbst gestarteten Sidecar stoppen.
  trap 'stop_sidecar_if_started "$SCRIPT_DIR"' EXIT INT TERM
fi

( cd "$SCRIPT_DIR/server" && npm start )
