# EEBUS realistisch testen: virtuelle Steuerbox an FLUX koppeln

Diese Anleitung beschreibt, wie du FLUX ohne echte Steuerbox testest, aber mit
**echter EEBUS-Kommunikation** – eine virtuelle Steuerbox (Energy Guard) schickt
per EEBUS über SHIP/SPINE reale LPC- (§14a) und LPP-Steuerbefehle (§9) an FLUX.
So testest du den kompletten Weg genau so, wie ihn später der Netzbetreiber nutzt.

## Überblick der Rollen

- **FLUX** ist das „Controllable System" (CS) – es empfängt Limits. Die
  EEBUS-Protokollarbeit macht der **FLUX-Sidecar** (dieses Verzeichnis).
- Die **virtuelle Steuerbox** ist der „Energy Guard" (EG) – sie sendet Limits.

Beide Seiten koppeln sich per **SKI** (dem Fingerabdruck des jeweiligen
Zertifikats). Das Pairing ist symmetrisch: jede Seite muss den SKI der anderen
kennen.

## Empfohlenes Werkzeug: Controlbox-Simulator mit Web-UI

Der **eebus-go controlbox simulator app** von heinemannj sendet LPC- UND
LPP-Limits und bietet eine Web-Oberfläche, um Verbrauchs- und
Erzeugungsbegrenzungen manuell auszulösen:

  https://github.com/heinemannj/eebus-go-controlbox-simulator-app

(Alternativen: das offizielle `examples/controlbox` in
https://github.com/enbility/eebus-go – nur Kommandozeile; oder der
`eebus-device-tester` von FernetMenta.)

## Voraussetzungen

- Go >= 1.22 und Node.js/npm auf dem Testrechner
- FLUX-Sidecar gebaut (siehe README.md in diesem Verzeichnis)
- Sidecar und Simulator müssen sich im Netz erreichen können. Am einfachsten:
  beide auf demselben Rechner. mDNS/SHIP nutzt lokale Discovery.

## Schritt für Schritt

### 1. FLUX-Sidecar starten und dessen SKI notieren

```bash
cd eebus-sidecar
./flux-eebus-sidecar -port 4720 -http 127.0.0.1:4721 \
    -fluxurl http://127.0.0.1:3000 \
    -certpath eebus-cert.pem -keypath eebus-key.pem
```

Beim ersten Start erzeugt der Sidecar sein Zertifikat und gibt im Log seinen
**eigenen SKI** aus (`Eigener SKI: ...`). Dieser SKI wird auch in FLUX auf der
EEBUS-Seite unter „EEBUS-Transport (Sidecar)" angezeigt. Notiere ihn – die
Steuerbox braucht ihn.

### 2. Controlbox-Simulator holen und einmal starten

Der eigentliche Go-Code liegt in einem Unterordner (`apps/controlbox`), nicht im
Wurzelverzeichnis. Von dort aus wird `go run` aufgerufen. Ein `npm install` im
Wurzelverzeichnis schlägt fehl (dort liegt keine `package.json`) und ist für den
Grundtest auch nicht nötig – die Web-UI ist optional (siehe Schritt 4).

```bash
git clone https://github.com/heinemannj/eebus-go-controlbox-simulator-app
cd eebus-go-controlbox-simulator-app/apps/controlbox

# Erststart nur zum Erzeugen von Zertifikat/Key/SKI:
go run main.go 4713
```

Der Simulator gibt Zertifikat, privaten Schlüssel und seinen **Local SKI** aus.
Speichere Zertifikat und Key in Dateien (z. B. `eebus.crt` und `eebus.key`) und
notiere den **SKI des Simulators**.

> Hinweis: Falls `go run` meldet, dass Abhängigkeiten fehlen, hole sie einmalig
> mit `go mod download` (im selben Ordner). Die genaue Ordnerstruktur und
> etwaige zusätzliche Schritte stehen in der `README.md` des Simulators und im
> `install/`-Ordner des Projekts.

### 3. Beide SKIs gegenseitig eintragen

- **In FLUX** (EEBUS-Seite → Konfiguration): Trage den **SKI des Simulators** als
  „Steuerbox-SKI" ein und übertrage ihn mit „SKI an Sidecar übertragen" an den
  Sidecar. Aktiviere die EEBUS-Anbindung.
- **Im Simulator** (weiterhin im Ordner `apps/controlbox`): Starte ihn jetzt mit
  dem **SKI des FLUX-Sidecars** als `remoteski`:

```bash
go run main.go 4713 <FLUX-SIDECAR-SKI> eebus.crt eebus.key
```

### 4. Optional: Web-UI des Simulators öffnen

Der Grundtest (LPC-/LPP-Limits senden) funktioniert bereits über den Go-Teil aus
Schritt 3. Wer zusätzlich die grafische Oberfläche nutzen möchte, findet sie im
Web-App-Teil des Projekts (Unterordner mit eigener `package.json`, z. B. unter
`apps/`). Dort – und nur dort, wo tatsächlich eine `package.json` liegt – gilt:

```bash
npm install
npx vite dev
```

Die Oberfläche ist üblicherweise unter `http://localhost:7051/` erreichbar. Dort
kannst du manuell Verbrauchs- (LPC/§14a) und Erzeugungslimits (LPP/§9) setzen und
wieder aufheben. Die konkreten Pfade und Ports können je nach Version des
Simulators abweichen – maßgeblich ist dessen `README.md`.

### 5. Verbindung prüfen und testen

- In FLUX zeigt die EEBUS-Seite jetzt „verbunden" und „Steuerbox gekoppelt".
- Sende aus der Web-UI ein **LPP-Limit** (Einspeisegrenze). In FLUX erscheint es
  im Ereignis-Protokoll, und – wenn die §9-Umsetzung aktiv ist – berechnet die
  Wechselrichter-Regelung die Sollwerte (im Dry-Run zunächst nur im Protokoll).
- Sende ein **LPC-Limit** (Bezugsgrenze). Es wird empfangen und angezeigt; die
  reale §14a-Umsetzung ist konzeptionell (siehe Hilfe), wird also protokolliert,
  aber nicht auf Geräte angewendet.

## Sinnvoller Testablauf für §9 (Einspeisedrosselung)

1. §9-Umsetzung auf der EEBUS-Seite aktivieren, Wechselrichter automatisch
   erkennen lassen, Nennleistungen eintragen. **Dry-Run zunächst anlassen.**
2. Aus dem Simulator ein LPP-Limit setzen (z. B. 60 % bzw. den entsprechenden
   Wattwert). Im Ansteuerungs-Protokoll siehst du die berechneten Sollwerte je
   Wechselrichter, ohne dass real geschrieben wird.
3. Werte prüfen: Passen die Prozentwerte zur aktuellen Einspeisung und
   Reihenfolge? Erst dann – bewusst – scharfschalten und mit einem einzelnen
   Wechselrichter beginnen.

## Fehlersuche

- **Keine Verbindung:** Stehen beide SKIs korrekt gegenseitig eingetragen?
  Groß-/Kleinschreibung und Vollständigkeit prüfen. Sind beide Prozesse im
  selben Netz? Blockiert eine Firewall die SHIP-Ports (4720/4713)?
- **Kein Empfang in FLUX:** Läuft der Sidecar und zeigt FLUX ihn als „läuft"?
  Zeigt das Sidecar-Log Verbindungsereignisse?
- **mDNS-Probleme unter Linux:** Ggf. avahi installieren/aktivieren.
