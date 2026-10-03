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
- AC-Speicher: Marstek Venus (C/D/E), Anker Solix, Zendure SolarFlow
- DC-Speicher: EPEver-basierte DIY-Speicher (24 V/12 V), Soyosource-Einspeiseregler
- Batterie-Ladegeräte (AC-Lader) als steuerbare Ladequellen
- Wärmepumpe: Panasonic Aquarea über HeishaMon
- Wallbox/E-Auto: über evcc (vollständige Rolle mit eigener Seite, Live-Steuerung
  und Ladehistorie – siehe unten)
- Schaltbare Verbraucher: Shelly (diverse Serien), Tasmota
- Klimaanlagen: Mitsubishi über mitsubishi2MQTT (Zustand + Steuerung per MQTT)
- Lüftungsanlage: Vallox über valloxesp (Zustand + Steuerung per MQTT)
- 3D-Drucker: Prusa über PrusaLink (Druckauftrag, Telemetrie, Steckdosen-Schalter)
- Luftsensor: Feinstaub (PM2.5/PM10), Temperatur, Luftdruck über lokale HTTP-API
- Kameras: SecuritySpy (Live-Bilder, Aufnahmen, Bewegungs-/KI-Ereignisse)
- Zugangskontrolle: Wiegand-RFID/PIN-Reader über MQTT (Whitelist, Aktionen, Feedback)
- Sensorik: Warmwasserspeicher-Temperaturen (Shelly Uni), Wasserzähler
- Philips Hue: Bridge als eine Quelle, die alle Leuchten und Sensoren
  (Bewegungsmelder, Temperatur, Lichtstärke, Batterie) automatisch als
  Untergeräte einliest und synchron hält
- Homematic: CCU3 (XML-API-Addon) und HCU1 (lokale Homematic-IP-API) – Geräte,
  Kanäle, Alarmzonen und Sirene
- §42c-Sharing-Partner (Nachbar-Einspeisung/-bezug)

## Kommunikationswege & Protokolle

- HTTP/REST-Polling (Shelly, Growatt, OpenDTU, EPEver, Tasmota, evcc, HeishaMon,
  PrusaLink, Luftsensor)
- MQTT (Publish und Subscribe, u. a. für §42c-Zähler, externe HEMS, Klimaanlage,
  Lüftung, Zugangskontrolle)
- Eingebauter MQTT-Broker (Aedes, Port 1883, lokal) – startet mit FLUX; Topics
  sind auf der Statusseite einsehbar
- Modbus/TCP (u. a. Marstek, Anker Solix)
- UDP (Marstek-JSON-RPC, Shelly-Discovery)
- EEBUS/SHIP/SPINE über Go-Sidecar
- Philips Hue CLIP-v2-API (lokale HTTPS-Anbindung an die Bridge)
- Homematic-IP lokale API (HCU1) und XML-API (CCU3)
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
- Hue-Zustände als Regel-Bedingung (Licht an/aus, Bewegung erkannt) und
  Hue-Leuchten als Schaltaktion
- Gerätezustände als Bedingung: Klimaanlage, Lüftung, Luftsensor, Homematic,
  3D-Drucker (Druckfortschritt, Restzeit, druckt), Elektroauto (Ladestand,
  Verbindung, Ladeaktivität, Lademodus)
- Geräte als Schaltaktion: Shelly/Tasmota, Hue, Homematic, Klima, Lüftung,
  Alarm-Modus, Elektroauto (Lademodus/Ladelimit setzen)
- Push-Benachrichtigungen über mehrere frei konfigurierbare ntfy-Kanäle;
  jeder Auslöser (einzelne Regel, Anomalie-Typ, Zustandsübergang) wird per
  Drag&Drop den gewünschten Kanälen zugeordnet
- Push-Benachrichtigungen (ntfy) für konfigurierbare Ereignisse
- Anti-Spam-Entprellung

## Anomalie-Erkennung

- Eigenständiges Überwachungs-Subsystem mit kategorienbasierten Detektoren
  (kein Anlegen pro Gerät nötig)
- Detektoren: Quellen-Ausfall, PV-Strang-Einbruch, Netzbezug trotz Speicher,
  Verbrauchs-Baseline (lernt üblichen Tagesverbrauch je Verbraucher),
  Urlaubs-Überwachung
- Urlaubs-Detektor mit planbarem Zeitraum: erkennt Abwesenheits-Auffälligkeiten
  über ausgewählte Verbraucher, Wasserabgabe sowie Hue-Leuchten und
  -Bewegungsmelder (präzise Anwesenheitserkennung)
- Transparenz: einsehbarer gelernter Normalzustand je Gerät mit Verlaufsgrafik
- Nachvollziehbare, zum Auslösezeitpunkt eingefrorene Begründung je Anomalie
- Dreistufiges Feedback (richtig / richtig aber unwichtig / Fehlalarm) mit
  Persistenz
- Regelbasierte Verbesserungsvorschläge aus dem Feedback (Ein-Klick-Übernahme),
  transparent statt Black-Box
- Lebenszyklus mit Quittieren, Unterdrückung andauernder Anomalien und Hysterese

## Smart-Home-Steuerung (Philips Hue)

- Bridge als eine Quelle mit automatisch gepflegter Untergeräte-Liste
- Anzeige aller Leuchten und Sensoren nach Räumen auf der Statusseite
- Direktes Schalten der Leuchten (an/aus, Helligkeit, Farbe) über die Bridge
- Nutzung in Automatisierungsregeln (Bedingung und Aktion) und in der
  Anomalie-/Abwesenheitserkennung

## Smart-Home-Steuerung (Homematic IP)

- Homematic-Zentrale (CCU3 über XML-API oder HCU über lokale API) als eine
  Quelle mit automatisch eingelesenen Geräten und Kanälen
- Anzeige aller Geräte (Schalter, Kontakte, Bewegungsmelder, Temperatur,
  Feuchte) auf der Statusseite
- Schalten von Aktoren, Rollläden (Hoch/Runter/Stopp/Position) und
  Funktionsgruppen (z. B. etagenweise Rollladen-Bedienung)
- Alarm-/Sicherheitssystem: Modi (unscharf/Anwesenheit/Vollschutz) anzeigen und
  setzen, Sirene auslösen (mit Sicherheitsabfrage), Automatisierungen anzeigen
- Nutzung in Automatisierungsregeln (Zustände als Bedingung, Schalten/Rollladen/
  Alarm als Aktion)
- Generisches Hub-Konzept: CCU3 und HCU als austauschbare Backends

## Weitere Geräteintegrationen

- Klimaanlage (Mitsubishi): Zustand (Modus, Ziel-/Raumtemperatur, Lüfter,
  Lamellen) über MQTT lesen und steuern; auf Statusseite, in Regeln und als Kachel
- Lüftungsanlage (Vallox): An/Aus und Lüfterstufe über MQTT lesen und steuern;
  auf Statusseite, in Regeln und als Kachel
- 3D-Drucker (Prusa): Druckauftrag (Fortschritt, Restzeit), Telemetrie
  (Temperaturen, Achsen, Flow, Speed), Ein/Aus über verlinkte Steckdose; als Kachel
- Luftsensor: PM2.5, PM10, Temperatur, Luftdruck auf Statusseite und als Kachel;
  Tagesverlauf-Diagramm auf der Wetterseite; nutzbar in Regel-Bedingungen
- Wetter-Dashboard: DWD-Vorhersage (über Bright Sky) für den PV-Standort,
  stündlich für heute/morgen, danach in Tagesabschnitten (Sonne, Bewölkung, Regen,
  Temperatur)

## Elektroauto (evcc)

- Eigene Quellenrolle "Elektroauto (evcc)" mit eigener Menüseite
- Live-Status: Lademodus (Aus/PV/Min+PV/Schnell) anzeigen und umschalten,
  Fahrzeug-Ladestand, Verbindungs-/Ladezustand, Ladeleistung, Phasenzahl
- Ladelimit (Ziel-SoC), Ladestrom-Grenzen (min/max Ampere) mit kW-Anzeige,
  Phasen-Umschaltung (auto/1-/3-phasig), prognostizierte Restdauer
- Aktuelle Ladesitzung: geladene kWh, Dauer, Restzeit
- Ladehistorie über evccs /api/sessions (inkl. Sonnenanteil je Sitzung):
  - Umschaltbar Monat / Jahr / Gesamt
  - Gestapeltes Balkendiagramm Sonne vs. Netz (pro Tag/Monat/Jahr)
  - Monatsansicht: Detailtabelle aller Ladevorgänge (Beginn, kWh, Sonne, Kosten,
    Dauer, Ø Leistung) mit Summenzeile
  - Jahresansicht: Spinnendiagramm des Sonnenanteils je Monat
  - Diagramm-Download als JPG

## Energie-Rückblick ("Wrapped")

- Eigene Seite mit Umschalter Jahr/Monat
- Emotionales Dashboard: Hero (Jahres-Erzeugung + Autarkie-Ring), farbige
  Highlight-Karten (ertragreichster Tag/Monat, bester Autarkie-Tag, E-Auto mit
  Sonnen-Kilometern, CO₂-Ersparnis, §42c-Sharing)
- Kombi-Chart (Erzeugung/Verbrauch als Balken, Autarkie als Linie) mit Tooltip
  und Bild-Download; sachliche Detailkennzahlen darunter
- Eigene Quellenrolle "ENTSO-E REST API" für den CO₂-Netzintensitäts-Token
- CO₂-Bilanz mit echtem Netzmix über ENTSO-E: laufende Aufzeichnung der
  Netz-CO₂-Intensität (g/kWh) und viertelstündliche Verrechnung mit dem Netzbezug;
  Vergangenheit aus ENTSO-E-Historie nachladbar (bis 1 Jahr); im Export/Import und
  bei der DB-Übernahme berücksichtigt

## Zugangskontrolle

- RFID/PIN-Reader (Wiegand) über MQTT als eigene Quellenrolle
- Whitelist gültiger Tags/PINs mit Gültigkeitszeiten (Wochentage, Tageszeit-
  Fenster, Ablaufdatum)
- Frei zuordenbare Aktionen je Tag/PIN (Regel auslösen, Aktor schalten,
  Alarm-Modus, Nachricht) – dieselben Aktionstypen wie in Regeln
- Automatisches LED/Buzzer-Feedback an den Reader (ok/denied)
- Protokoll aller Ereignisse mit Ergebnis; Übernahme gelesener Werte in die
  Whitelist per Klick

## Datenpersistierung (je Gerät wählbar)

- Für Geräte-Quellen (Luftsensor, Lüftung, Drucker, Klimaanlage, Homematic, Hue)
  einzeln wählbar, welche Datenpunkte mit Zeitstempel aufgezeichnet werden
- Optionale hochaufgelöste Energiemessung je Gerät (entkoppelt, wie bei der
  Wärmepumpe)
- Generische device_data/device_power-Struktur; die Wärmepumpe nutzt denselben
  Mechanismus
- Auswahl als Obermenge aus aktuell eingehenden und bereits gespeicherten
  Datenpunkten

## Schnellstart-Kacheln (Übersichtsseite)

- Frei konfigurierbare Kacheln auf der Übersicht: Automatisierungsregeln,
  Schalter (Shelly/Tasmota, auch Gen1), Hue-Leuchten, Homematic-Geräte/-Gruppen,
  Alarm-Modus, Klimaanlage, Lüftung, 3D-Drucker, Luftsensor
- Szenen-Kacheln: mehrere Aktionen als Sammelaktion mit einem Klick
- Ordner zum Bündeln von Kacheln, per „Eintauchen" navigierbar
- Drag-and-drop-Anordnung, serverseitig gespeichert

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
