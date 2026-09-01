# FLUX EEBUS-Sidecar

Dieser eigenständige Go-Prozess übernimmt die EEBUS-Kommunikation mit einer
Steuerbox (Rolle **Controllable System**, CS) und reicht die empfangenen
§14a-/§9-Steuerbefehle (LPC/LPP) per HTTP an den FLUX-Server weiter.

FLUX selbst bleibt Node/TypeScript. Die komplette EEBUS-Protokollarbeit
(SHIP/SPINE/TLS/mDNS, Zertifikats-Pairing) erledigt dieser Sidecar über die
etablierte Bibliothek [`github.com/enbility/eebus-go`](https://github.com/enbility/eebus-go)
— dieselbe, die u. a. evcc und der ioBroker-EEBUS-Adapter nutzen.

## Warum ein separater Prozess?

Es gibt keine produktionsreife EEBUS-Implementierung für Node/TypeScript. Alle
reifen Stacks sind Go oder Java. Der bewährte Weg (auch von ioBroker so genutzt)
ist daher ein separater Go-Prozess, der die EEBUS-Seite macht und über eine
schmale HTTP-Schnittstelle mit dem Hauptsystem spricht.

## Bauen

Voraussetzung: Go >= 1.22 mit uneingeschränktem Internetzugang (die Abhängigkeiten
liegen u. a. auf `golang.org/x/*` und `gitlab.com`).

```bash
cd eebus-sidecar
go mod tidy      # zieht alle Abhängigkeiten
go build -o flux-eebus-sidecar .
```

Ergebnis ist eine einzelne Binärdatei `flux-eebus-sidecar`.

## Starten

```bash
./flux-eebus-sidecar \
  -port 4720 \
  -http 127.0.0.1:4721 \
  -fluxurl http://127.0.0.1:3000 \
  -certpath eebus-cert.pem \
  -keypath  eebus-key.pem \
  [-remoteski <SKI-der-Steuerbox>]
```

- **-port**: EEBUS-Serverport (SHIP), an dem die Steuerbox andockt.
- **-http**: lokale HTTP-Steuerschnittstelle, über die FLUX den Sidecar
  konfiguriert und Status abfragt.
- **-fluxurl**: Basis-URL des FLUX-Servers, an den empfangene Befehle gemeldet
  werden (Ingest-Endpunkt `/api/eebus/ingest`).
- **-certpath / -keypath**: Zertifikat + privater Schlüssel. Beim ersten Start
  werden sie erzeugt und gespeichert; danach wiederverwendet. Der aus dem
  Zertifikat abgeleitete **eigene SKI** wird an FLUX gemeldet und dort angezeigt
  — diesen SKI brauchst du für die Registrierung beim Netzbetreiber.
- **-remoteski**: SKI der Steuerbox. Kann auch später über FLUX gesetzt werden.

## Schnittstelle zu FLUX

Sidecar → FLUX (HTTP POST `/api/eebus/ingest`), JSON:

```json
{ "kind": "limit", "useCase": "lpc", "aktiv": true, "wert": 4200, "dauerSek": 3600 }
{ "kind": "heartbeat", "useCase": "lpc" }
{ "kind": "connect",  "ski": "<remote-ski>" }
{ "kind": "disconnect" }
{ "kind": "own", "ownSki": "<eigener-ski>" }
```

FLUX → Sidecar:

- `GET  /status` → `{ "ownSki", "remoteSki", "connected" }`
- `POST /config` mit `{ "remoteSki": "<ski>" }` → setzt/aktualisiert die Steuerbox-SKI.

## Pairing mit der Steuerbox

1. Sidecar starten; er erzeugt beim ersten Start das Zertifikat und meldet den
   eigenen SKI an FLUX (dort auf der EEBUS-Seite sichtbar).
2. Diesen SKI beim Netzbetreiber / Messstellenbetreiber für die §14a-Kopplung
   hinterlegen (bzw. beim Pairing-Vorgang der Steuerbox angeben).
3. Die SKI der Steuerbox in FLUX eintragen (wird an den Sidecar weitergereicht).
4. Steuerbox und Sidecar müssen im selben Heimnetz erreichbar sein (mDNS/SHIP).

## Hinweis zum Reifegrad

Der Sidecar folgt exakt der offiziellen `cmd/hems/main.go`-Referenz von
eebus-go (CS-Rolle, LPC/LPP, WriteApproval, Failsafe, Heartbeat). Die echte
Kopplung mit einer realen Steuerbox sollte auf der Zielhardware verifiziert
werden — insbesondere Pairing, Zertifikatsvertrauen und das konkrete
Verhalten des vom Netzbetreiber eingesetzten Steuerbox-Modells.

## Lizenz

Teil von FLUX, MIT-Lizenz (Copyright © 2026 siehe `../LICENSE`).
Der Sidecar baut auf den EEBUS-Bibliotheken von enbility (eebus-go, ship-go,
spine-go) auf, die ebenfalls unter MIT stehen; deren transitive Go-Abhängigkeiten
werden beim Build über `go mod` aufgelöst (Lizenzen überwiegend BSD/MIT, siehe
`../THIRD-PARTY-LICENSES.md`). Wie das gesamte Projekt ist auch dieser Teil
teilweise KI-generiert und wird ohne Gewährleistung und ohne Haftung
bereitgestellt (siehe `../NOTICE.md`).
