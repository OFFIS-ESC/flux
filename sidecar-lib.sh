#!/usr/bin/env bash
#
# FLUX – gemeinsame Sidecar-Start-Logik (wird von update.sh und start.sh genutzt)
# ------------------------------------------------------------------------------
# Startet den EEBUS-Sidecar im Hintergrund, WENN alles Nötige vorliegt:
#   - eine kompilierte Binary (sonst wird EINMALIG versucht, sie zu bauen)
#   - Zertifikat + privater Schlüssel (.pem bevorzugt, .crt/.key als Fallback)
# Fehlt etwas und lässt es sich nicht herstellen, wird der Sidecar übersprungen
# (der FLUX-Server läuft trotzdem – EEBUS ist optional).
#
# Diese Datei wird per `source` eingebunden und stellt die Funktion
# start_sidecar_if_possible <VERSIONSORDNER> bereit.

# Ermittelt den Steuerbox-SKI aus der Datenbank (Settings-Key eebusConfig),
# sofern vorhanden. Gibt den SKI auf stdout aus oder nichts.
_flux_read_steuerbox_ski() {
  local dbfile="$1"
  [ -f "$dbfile" ] || return 0
  # node ist ohnehin vorhanden (Server läuft darauf). node:sqlite ist eingebaut.
  node --disable-warning=ExperimentalWarning -e "
    try {
      const {DatabaseSync}=require('node:sqlite');
      const d=new DatabaseSync(process.argv[1]);
      const row=d.prepare(\"SELECT value FROM settings WHERE key='eebusConfig'\").get();
      d.close();
      if(row){const c=JSON.parse(row.value); if(c && c.steuerboxSki){process.stdout.write(String(c.steuerboxSki));}}
    } catch(e){ /* still: kein SKI */ }
  " "$dbfile" 2>/dev/null || true
}

# Findet Zertifikat- und Key-Datei im Sidecar-Ordner. Setzt globale Variablen
# _SIDE_CERT und _SIDE_KEY (leer, wenn nicht gefunden). Bevorzugt .pem-Paare,
# fällt auf .crt/.key zurück.
_flux_find_certs() {
  local side="$1"
  _SIDE_CERT=""; _SIDE_KEY=""
  # 1) klassische Namen aus der README
  if [ -f "$side/eebus-cert.pem" ] && [ -f "$side/eebus-key.pem" ]; then
    _SIDE_CERT="$side/eebus-cert.pem"; _SIDE_KEY="$side/eebus-key.pem"; return 0
  fi
  # 2) irgendein .pem-Paar (erst *cert*/*key*, dann beliebig)
  local c k
  c="$(ls "$side"/*cert*.pem 2>/dev/null | head -1 || true)"
  k="$(ls "$side"/*key*.pem 2>/dev/null | head -1 || true)"
  if [ -n "$c" ] && [ -n "$k" ]; then _SIDE_CERT="$c"; _SIDE_KEY="$k"; return 0; fi
  # 3) .crt/.key-Fallback
  c="$(ls "$side"/*.crt 2>/dev/null | head -1 || true)"
  k="$(ls "$side"/*.key 2>/dev/null | head -1 || true)"
  if [ -n "$c" ] && [ -n "$k" ]; then _SIDE_CERT="$c"; _SIDE_KEY="$k"; return 0; fi
  return 1
}

# Stoppt einen zuvor gestarteten Sidecar (per PID-Datei). Wird beim Beenden des
# Servers aufgerufen, damit kein verwaister Prozess zurückbleibt.
stop_sidecar_if_started() {
  local root="$1"
  local pidf="$root/eebus-sidecar/sidecar.pid"
  [ -f "$pidf" ] || return 0
  local pid
  pid="$(cat "$pidf" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo ""
    echo "==> Stoppe EEBUS-Sidecar (PID $pid) ..."
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$pidf"
}
start_sidecar_if_possible() {
  local root="$1"
  local side="$root/eebus-sidecar"
  local bin="$side/flux-eebus-sidecar"

  if [ ! -d "$side" ]; then
    return 0  # kein Sidecar-Ordner -> nichts zu tun
  fi

  # 1) Binary vorhanden? Sonst versuchen zu bauen (nur wenn Go verfügbar).
  if [ ! -x "$bin" ]; then
    if command -v go >/dev/null 2>&1; then
      echo "==> EEBUS-Sidecar: keine Binary vorhanden – versuche zu bauen ..."
      if ( cd "$side" && go build -o flux-eebus-sidecar . ) 2>/tmp/flux_sidecar_build.log; then
        echo "    Sidecar erfolgreich gebaut."
      else
        echo "    ! Sidecar-Build fehlgeschlagen – EEBUS wird übersprungen."
        echo "      (Details: /tmp/flux_sidecar_build.log)"
        echo "      Der FLUX-Server startet normal weiter; EEBUS bleibt inaktiv."
        return 0
      fi
    else
      echo "==> EEBUS-Sidecar: keine Binary und kein 'go' im PATH – EEBUS wird übersprungen."
      echo "    (Sidecar bei Bedarf manuell bauen: cd eebus-sidecar && go build -o flux-eebus-sidecar .)"
      return 0
    fi
  fi

  # 2) Zertifikate suchen. Beim ALLERERSTEN Start dürfen sie fehlen – der Sidecar
  #    erzeugt sie dann selbst. Wir übergeben daher immer Pfade (Default .pem);
  #    liegen andere vor, nutzen wir die.
  _flux_find_certs "$side"
  local certArg keyArg
  if [ -n "$_SIDE_CERT" ] && [ -n "$_SIDE_KEY" ]; then
    certArg="$_SIDE_CERT"; keyArg="$_SIDE_KEY"
    echo "==> EEBUS-Sidecar: nutze Zertifikat $(basename "$certArg") / Key $(basename "$keyArg")."
  else
    certArg="$side/eebus-cert.pem"; keyArg="$side/eebus-key.pem"
    echo "==> EEBUS-Sidecar: keine Zertifikate gefunden – der Sidecar erzeugt sie beim ersten Start."
  fi

  # 3) Steuerbox-SKI aus der DB lesen (optional; kann auch später über FLUX
  #    gesetzt werden). Bei einem frischen Update liegt der SKI noch in der
  #    Vorgänger-DB (hems_old.db), weil die Migration in die neue hems.db erst
  #    beim Serverstart passiert – daher beide Quellen prüfen.
  local ski=""
  for dbc in "$root/server/hems.db" "$root/server/hems_old.db"; do
    if [ -f "$dbc" ]; then
      ski="$(_flux_read_steuerbox_ski "$dbc")"
      [ -n "$ski" ] && break
    fi
  done
  if [ -n "$ski" ]; then
    echo "==> EEBUS-Sidecar: Steuerbox-SKI aus DB übernommen (${ski:0:12}…)."
  else
    echo "==> EEBUS-Sidecar: kein Steuerbox-SKI in der DB – kann später in FLUX gesetzt werden."
  fi

  # 4) Läuft schon ein Sidecar auf dem HTTP-Port? Dann nicht doppelt starten.
  if curl -s "http://127.0.0.1:4721/status" >/dev/null 2>&1; then
    echo "==> EEBUS-Sidecar: läuft bereits (Port 4721) – kein Neustart."
    return 0
  fi

  # 5) Im Hintergrund starten. Log in den Sidecar-Ordner.
  #    Hinweis: Der -remoteski-Parameter wird nur angehängt, wenn ein SKI vorliegt.
  #    Die Übergabe erfolgt Bash-3.2-sicher (macOS-Standard-Bash) – ein leeres
  #    Array darf unter `set -u` nicht direkt expandiert werden.
  echo "==> Starte EEBUS-Sidecar (Port 4720 SHIP, HTTP 4721) ..."
  if [ -n "$ski" ]; then
    ( cd "$side" && nohup ./flux-eebus-sidecar \
        -port 4720 \
        -http 127.0.0.1:4721 \
        -fluxurl http://127.0.0.1:3000 \
        -certpath "$(basename "$certArg")" \
        -keypath  "$(basename "$keyArg")" \
        -remoteski "$ski" \
        >"$side/sidecar.log" 2>&1 &
      echo $! > "$side/sidecar.pid" )
  else
    ( cd "$side" && nohup ./flux-eebus-sidecar \
        -port 4720 \
        -http 127.0.0.1:4721 \
        -fluxurl http://127.0.0.1:3000 \
        -certpath "$(basename "$certArg")" \
        -keypath  "$(basename "$keyArg")" \
        >"$side/sidecar.log" 2>&1 &
      echo $! > "$side/sidecar.pid" )
  fi
  # Bis zu ~5 s auf die HTTP-Schnittstelle warten (der Sidecar braucht beim ersten
  # Start etwas länger, u. a. wenn er Zertifikate erzeugt).
  local pid; pid="$(cat "$side/sidecar.pid" 2>/dev/null || true)"
  local ok=0 i=0
  while [ "$i" -lt 10 ]; do
    if curl -s "http://127.0.0.1:4721/status" >/dev/null 2>&1; then ok=1; break; fi
    # Prozess vorzeitig gestorben? Dann nicht weiter warten.
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.5
    i=$((i + 1))
  done
  if [ "$ok" -eq 1 ]; then
    echo "    Sidecar läuft (PID $pid)."
  elif [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "    Sidecar-Prozess läuft (PID $pid), meldet sich aber noch nicht auf Port 4721."
    echo "    Das kann beim allerersten Start (Zertifikatserzeugung) kurz dauern."
    echo "    Bei Problemen: eebus-sidecar/sidecar.log prüfen."
  else
    echo "    ! Sidecar konnte nicht gestartet werden (Prozess beendet)."
    echo "    Bitte eebus-sidecar/sidecar.log prüfen. FLUX läuft ohne EEBUS weiter."
    rm -f "$side/sidecar.pid"
  fi
}
