# FLUX – Home Energy Intelligence: Funktionsübersicht

Diese Liste beschreibt den Funktionsumfang von FLUX. Sie spiegelt den Stand der
Software wider; wie ausgereift oder hardware-getestet ein einzelnes Feature in
einer konkreten Installation ist, kann davon abweichen. Insbesondere reale
Steuereingriffe (§9-Wechselrichteransteuerung, EEBUS-Steuerbox-Kopplung) sind mit
Dry-Run- und Testfunktionen versehen und sollten vor dem Scharfschalten an echter
Hardware verifiziert werden.

## Unterstützte Geräte & Hardware

- Netz-Smartmeter: Hichi/Tasmota (SML), Shelly Pro 3EM
- PV-Wechselrichter: Growatt (MOD, MIC), Hoymiles über OpenDTU, EPEver-Laderegler
- AC-Speicher: Marstek Venus (C und weitere), Zendure
- DC-Speicher: EPEver-basierte DIY-Speicher (24 V/12 V), Soyosource-Einspeiseregler
- Batterie-Ladegeräte (AC-Lader) als steuerbare Ladequellen
- Wärmepumpe: Panasonic Aquarea über HeishaMon
- Wallbox/E-Auto: über evcc
- Schaltbare Verbraucher: Shelly (diverse Serien), Tasmota
- Sensorik: Warmwasserspeicher-Temperaturen (Shelly Uni), Wasserzähler
- §42c-Sharing-Partner (Nachbar-Einspeisung/-bezug)

## Kommunikationswege & Protokolle

- HTTP/REST-Polling (Shelly, Growatt, OpenDTU, EPEver, Tasmota, evcc, HeishaMon)
- MQTT (Publish und Subscribe, u. a. für §42c-Zähler und externe HEMS)
- Modbus/TCP (u. a. Marstek)
- UDP (Marstek-JSON-RPC, Shelly-Discovery)
- EEBUS/SHIP/SPINE über Go-Sidecar
- Automatische Geräteerkennung im Netzwerk (Shelly-Broadcast)

## Speicher-Unterstützung

- Gleichzeitige Verwaltung von DC- und AC-Speichern
- Multi-Speicher-Balancer mit CT002/CT003-Emulation (mehrere AC-Speicher an einem
  virtuellen Zähler)
- Parallele Entladung (gewichtsproportional) und alternierende Entladung
  (nacheinander nach Ladestand, zur Verlustminimierung)
- Selbstlernende Lade-/Entladegrenzen mit Sättigungserkennung
- Konfigurierbarer Netz-Zielwert (z. B. leichte Einspeisung statt Nulleinspeisung)
- SoC-Anzeige und -Berücksichtigung je Speicher
- Schutz gegen AC-Laden, Fadeout/Slew-Rate-Begrenzung für schwache Geräte

## Wärmepumpe

- Elektrische und thermische Leistungserfassung
- Wärmemengen-Integration, getrennt nach Betriebsmodus (Heizen/Warmwasser/Kühlen)
- COP-/Effizienz-Kennzahlen
- Erkennung von Kompressorbetrieb und Abtauphasen
- Entkoppelte, rausch-robuste Erfassung der Leistungsaufnahme
- Datensparsame Speicherung mit Änderungserkennung

## Warmwasser

- Speichertemperatur oben/unten (Schichtung)
- Berechnung der gespeicherten Wärmemenge
- Einbindung von Solarthermie und Heizstab
- Warmwasser-Betriebserkennung der Wärmepumpe

## EEBUS-Fähigkeit (§14a / §9)

- §14a-Bezugsüberwachung (LPC): empfangenes Limit gegen realen SteuVE-Bezug
- Berechnung der erwarteten §14a-Mindestleistung (BNetzA-Formel mit
  Gleichzeitigkeitsfaktor) zum Abgleich mit dem empfangenen Limit
- §9-Einspeisebegrenzung (LPP): reale Ansteuerung mehrerer Wechselrichter mit
  Prioritätsreihenfolge (Growatt, OpenDTU/Hoymiles)
- Automatische Erkennung steuerbarer Wechselrichter aus den Quellen
- Dry-Run- und Scharf-Modus, Testfunktionen
- Failsafe-Werte, Heartbeat-Überwachung
- Push-Benachrichtigung bei Netzeingriff (ein/aus)
- Go-Sidecar für echte Steuerbox-Kopplung, Simulator-Unterstützung zum Testen
- Persistente Ansteuerungs- und Ereignisprotokolle

## Visualisierung & Analyse

- Anlagen-Übersichtsdiagramm mit Live-Energieflüssen
- Stromerzeugung, Stromverbrauch, Wasserverbrauch je eigene Ansicht
- Tagesverläufe, Monats- und Jahresstatistiken
- Verbraucher-Einzelaufschlüsselung mit Tagesenergie
- Autarkie- und Eigenverbrauchsquote
- Konfigurierbare Diagrammfarben, anpassbare Schriftgrößen (Desktop/Mobil)
- Drag-and-drop-anpassbare Kacheln

## Kosten, Tarife & Prognosen

- Dynamischer Börsenstromtarif (Spotpreise) und Fixtarif
- Vollständige Strompreiskalkulation (Beschaffung, Netzentgelt, Steuern, Umlagen,
  Grundgebühr)
- §14a-Netzentgeltreduzierung (Modul 1 und Modul 3 mit Hoch-/Niedriglast-Zeitfenstern)
- Einspeisevergütung und Tageskostenberechnung
- PV-Ertragsprognose (forecast.solar), Rest-PV-Ertrag des Tages
- Börsenpreis-Statistiken

## Automatisierung & Benachrichtigung

- Regelsystem mit Auslösern (Spotpreis, Schwellwerte, Zeitfenster, Gerätezustand)
- Schaltaktionen mit Erkennung externer Rückschaltung
- Vordefinierte Überwachungsregeln (z. B. Urlaub, Leckage)
- Push-Benachrichtigungen (ntfy) für konfigurierbare Ereignisse
- Anti-Spam-Entprellung

## Energy Sharing (§42c)

- Erfassung und Bilanzierung von geteilter Energie mit Sharing-Partnern
- Dynamischer und statischer Sharing-Modus
- Bereitstellung von Daten an externe HEMS (extHems) per MQTT

## Datenverwaltung & Betrieb

- Lokale SQLite-Datenbank, datensparsame Speicherung (Änderungserkennung,
  Ringpuffer)
- Automatische DB-Migration aus Vorversionen
- Vollständiger Konfigurations-Export/-Import
- Datenexport für externe Auswertung
- Automatische Start-/Update-Skripte (inkl. Sidecar-Start und SKI-Übernahme)
- Läuft lokal, ohne Cloud-Zwang

## Dokumentation & Hilfestellungen

- Ausführliche README mit Installations- und Betriebsanleitung
- Kontextbezogene Hilfeseiten in der Oberfläche
- Vollständige API-Dokumentation (alle Endpunkte)
- Schritt-für-Schritt-Anleitung für EEBUS-Simulatortests
- Open Source unter MIT-Lizenz, mit Drittanbieter-Lizenzübersicht und
  transparentem KI-/Haftungshinweis
