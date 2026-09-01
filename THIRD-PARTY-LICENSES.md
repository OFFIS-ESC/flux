# Drittanbieter-Lizenzen / Third-Party Licenses

FLUX nutzt die unten aufgeführten Open-Source-Komponenten. Alle stehen unter
permissiven Lizenzen (MIT, BSD, Apache 2.0). Die jeweiligen Copyright- und
Lizenzhinweise der Projekte gelten fort; die vollständigen Lizenztexte liegen
den jeweiligen Paketen bei (im Verzeichnis `node_modules` bzw. im Go-Modul-Cache
nach der Installation) und sind über die verlinkten Projektseiten abrufbar.

Diese Übersicht erfüllt die Weitergabepflicht der permissiven Lizenzen. Sie ist
nach bestem Wissen erstellt; maßgeblich sind die Lizenzdateien der jeweiligen
Projekte in der tatsächlich installierten Version.

## Backend (Node.js / TypeScript)

| Komponente | Lizenz | Projekt |
| --- | --- | --- |
| express | MIT | https://github.com/expressjs/express |
| mqtt | MIT | https://github.com/mqttjs/MQTT.js |
| jsmodbus | MIT | https://github.com/Cloud-Automation/node-modbus |
| typescript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| tsx | MIT | https://github.com/privatenumber/tsx |
| @types/node, @types/express | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Frontend (React / Vite / TypeScript)

| Komponente | Lizenz | Projekt |
| --- | --- | --- |
| react | MIT | https://github.com/facebook/react |
| react-dom | MIT | https://github.com/facebook/react |
| leaflet | BSD-2-Clause | https://github.com/Leaflet/Leaflet |
| vite | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | MIT | https://github.com/vitejs/vite-plugin-react |
| typescript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @types/react, @types/react-dom, @types/leaflet | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## EEBUS-Sidecar (Go)

| Komponente | Lizenz | Projekt |
| --- | --- | --- |
| github.com/enbility/eebus-go | MIT | https://github.com/enbility/eebus-go |
| github.com/enbility/ship-go | MIT | https://github.com/enbility/ship-go |
| github.com/enbility/spine-go | MIT | https://github.com/enbility/spine-go |

Die eebus-go-Bibliotheken ziehen weitere transitive Go-Abhängigkeiten nach
(u. a. aus dem `golang.org/x`-Bereich sowie mDNS-/WebSocket-Bibliotheken).
Deren Lizenzen (überwiegend BSD/MIT) werden beim Bauen des Sidecars über
`go mod` aufgelöst; die vollständige, versionsgenaue Liste ergibt sich aus der
`go.sum` und lässt sich mit `go-licenses` oder `go mod download` samt der
beiliegenden LICENSE-Dateien im Modul-Cache einsehen.

## Lizenztexte

- **MIT**: siehe die Datei `LICENSE` dieses Projekts (identischer Lizenztyp) bzw.
  die LICENSE-Datei im jeweiligen Paket.
- **BSD-2-Clause** (Leaflet): https://github.com/Leaflet/Leaflet/blob/main/LICENSE
- **Apache-2.0** (TypeScript): https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt
