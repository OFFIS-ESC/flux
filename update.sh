#!/usr/bin/env bash
#
# FLUX – Update-/Migrationsskript
# --------------------------------
# Zweck: Nach dem Entpacken einer neuen Version genügt EIN Aufruf dieses Skripts.
# Es übernimmt automatisch aus der zuletzt installierten Version:
#   - die Datenbank  (als hems_old.db -> wird beim ersten Start migriert)
#   - den EEBUS-Sidecar-Ordner (kompilierte Binary + Zertifikate/Keys),
#     sofern dort bereits eine kompilierte Binary vorliegt
# und baut anschließend Frontend + Backend und startet den Server.
#
# Aufruf (im entpackten Ordner der NEUEN Version):
#   bash update.sh
#
# Optionen:
#   --no-start     nur migrieren und bauen, NICHT starten
#   --from "NAME"  Vorgängerordner explizit angeben (überspringt die Auto-Suche)
#
# Das Skript benennt seinen eigenen Ordner in "hems v<VERSION>" um (Version aus
# dem Code gelesen), sucht die neueste vorhandene Vorgängerversion daneben und
# übernimmt von dort. Es muss NICHTS von Hand umbenannt werden.

set -euo pipefail

# --- Argumente ---
DO_START=1
FROM_DIR_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-start) DO_START=0; shift ;;
    --from) FROM_DIR_OVERRIDE="${2:-}"; shift 2 ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac
done

# --- In das Verzeichnis dieses Skripts wechseln (= neuer Versionsordner) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Version aus dem Code lesen (APP_VERSION = "vNNN") ---
VERSION="$(grep -oE 'APP_VERSION *= *"v[0-9]+"' server/src/index.ts | grep -oE 'v[0-9]+' | head -1)"
if [ -z "$VERSION" ]; then
  echo "FEHLER: Konnte APP_VERSION nicht aus server/src/index.ts lesen."
  exit 1
fi
echo "==> Neue Version: $VERSION"

PARENT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_NAME="hems $VERSION"
TARGET_DIR="$PARENT_DIR/$TARGET_NAME"

# --- Eigenen Ordner in "hems v<VERSION>" umbenennen (falls noch nicht so) ---
CURRENT_NAME="$(basename "$SCRIPT_DIR")"
if [ "$CURRENT_NAME" != "$TARGET_NAME" ]; then
  if [ -e "$TARGET_DIR" ]; then
    echo "FEHLER: Zielordner '$TARGET_NAME' existiert bereits. Bitte zuerst entfernen/umbenennen."
    exit 1
  fi
  echo "==> Benenne Ordner um: '$CURRENT_NAME' -> '$TARGET_NAME'"
  cd "$PARENT_DIR"
  mv "$SCRIPT_DIR" "$TARGET_DIR"
  cd "$TARGET_DIR"
  SCRIPT_DIR="$TARGET_DIR"
fi

# --- Vorgängerversion bestimmen ---
# Sucht neben dem neuen Ordner nach "hems v<N>"-Ordnern mit KLEINERER Nummer und
# nimmt die höchste davon. Fällt zurück auf einen schlichten "hems"- oder
# "hems2"-Ordner, falls keine versionierten Vorgänger existieren.
NEW_NUM="$(echo "$VERSION" | grep -oE '[0-9]+')"
FROM_DIR=""

if [ -n "$FROM_DIR_OVERRIDE" ]; then
  FROM_DIR="$PARENT_DIR/$FROM_DIR_OVERRIDE"
  if [ ! -d "$FROM_DIR" ]; then
    echo "FEHLER: Angegebener --from-Ordner existiert nicht: $FROM_DIR"
    exit 1
  fi
else
  best_num=-1
  # Versionierte Vorgänger "hems v<N>"
  while IFS= read -r d; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    num="$(echo "$base" | grep -oE 'v[0-9]+' | grep -oE '[0-9]+' || true)"
    [ -n "$num" ] || continue
    if [ "$num" -lt "$NEW_NUM" ] && [ "$num" -gt "$best_num" ]; then
      best_num="$num"
      FROM_DIR="$d"
    fi
  done < <(find "$PARENT_DIR" -maxdepth 1 -type d -name 'hems v*' 2>/dev/null)

  # Fallback: schlichter "hems"- oder "hems2"-Ordner (alter Namensschema)
  if [ -z "$FROM_DIR" ]; then
    for cand in "hems2" "hems"; do
      if [ -d "$PARENT_DIR/$cand" ] && [ "$PARENT_DIR/$cand" != "$SCRIPT_DIR" ]; then
        FROM_DIR="$PARENT_DIR/$cand"
        break
      fi
    done
  fi
fi

if [ -z "$FROM_DIR" ]; then
  echo "==> Keine Vorgängerversion gefunden. Erstinstallation – überspringe DB-/Sidecar-Übernahme."
else
  echo "==> Übernehme aus Vorgängerversion: $(basename "$FROM_DIR")"

  # --- 1) Datenbank als hems_old.db übernehmen ---
  OLD_DB=""
  for cand in "$FROM_DIR/server/hems.db" "$FROM_DIR/hems.db"; do
    if [ -f "$cand" ]; then OLD_DB="$cand"; break; fi
  done
  if [ -n "$OLD_DB" ]; then
    echo "    - Datenbank: $(basename "$(dirname "$OLD_DB")")/$(basename "$OLD_DB") -> server/hems_old.db"
    cp -f "$OLD_DB" "$SCRIPT_DIR/server/hems_old.db"
    # Etwaige WAL-/SHM-Reste der Kopie entfernen (saubere Ausgangslage)
    rm -f "$SCRIPT_DIR/server/hems_old.db-wal" "$SCRIPT_DIR/server/hems_old.db-shm"
  else
    echo "    ! Keine hems.db in der Vorversion gefunden – DB-Übernahme übersprungen."
  fi

  # --- 2) EEBUS-Sidecar übernehmen, WENN dort eine kompilierte Binary liegt ---
  OLD_SIDE="$FROM_DIR/eebus-sidecar"
  if [ -d "$OLD_SIDE" ] && [ -x "$OLD_SIDE/flux-eebus-sidecar" ]; then
    echo "    - EEBUS-Sidecar: kompilierte Binary vorhanden -> übernehme Binary + Zertifikate/Keys"
    # Binary
    cp -f "$OLD_SIDE/flux-eebus-sidecar" "$SCRIPT_DIR/eebus-sidecar/flux-eebus-sidecar"
    chmod +x "$SCRIPT_DIR/eebus-sidecar/flux-eebus-sidecar"
    # Alle Zertifikate/Keys (crt/key/pem) übernehmen, falls vorhanden
    shopt -s nullglob
    for f in "$OLD_SIDE"/*.crt "$OLD_SIDE"/*.key "$OLD_SIDE"/*.pem; do
      cp -f "$f" "$SCRIPT_DIR/eebus-sidecar/"
      echo "        · $(basename "$f")"
    done
    shopt -u nullglob
    # go.sum (falls die Vorversion sie schon aufgelöst hatte) mitnehmen – schadet nicht
    [ -f "$OLD_SIDE/go.sum" ] && cp -f "$OLD_SIDE/go.sum" "$SCRIPT_DIR/eebus-sidecar/go.sum" || true
  else
    echo "    ! Keine kompilierte Sidecar-Binary in der Vorversion gefunden."
    echo "      -> Der Sidecar bleibt als Quellcode; bitte bei Bedarf neu bauen"
    echo "         (cd eebus-sidecar && go build -o flux-eebus-sidecar .)."
  fi
fi

# --- 3) Bauen: Frontend zuerst, dann Backend ---
echo "==> Installiere & baue Frontend (web) ..."
( cd "$SCRIPT_DIR/web" && npm install && npm run build )

echo "==> Installiere & baue Backend (server) ..."
( cd "$SCRIPT_DIR/server" && npm install && npm run build )

echo ""
echo "============================================================"
echo " FLUX $VERSION bereit."
echo "   Ordner:        $TARGET_NAME"
if [ -n "${FROM_DIR:-}" ]; then
  echo "   Übernommen aus: $(basename "$FROM_DIR")"
fi
echo "============================================================"

# --- 4) Optional starten ---
if [ "$DO_START" -eq 1 ]; then
  # EEBUS-Sidecar (optional) vor dem Server im Hintergrund starten.
  if [ -f "$SCRIPT_DIR/sidecar-lib.sh" ]; then
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/sidecar-lib.sh"
    start_sidecar_if_possible "$SCRIPT_DIR"
    # Beim Beenden (Strg+C / Skript-Ende) einen selbst gestarteten Sidecar stoppen.
    trap 'stop_sidecar_if_started "$SCRIPT_DIR"' EXIT INT TERM
  fi
  echo "==> Starte Server (Strg+C beendet)."
  echo "    (Beim ersten Start wird hems_old.db automatisch migriert.)"
  ( cd "$SCRIPT_DIR/server" && npm start )
else
  echo "==> --no-start gesetzt: Server NICHT gestartet."
  echo "    Manuell starten:  cd \"$TARGET_NAME/server\" && npm start"
fi
