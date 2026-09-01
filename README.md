# FLUX – Home Energy Intelligence

**FLUX** ist ein Heimenergiemanagement-System mit Schwerpunkt auf der
**Auswertung sämtlicher Energieflüsse** eines Haushalts. Das Tool erfasst laufend,
wie viel Strom erzeugt, verbraucht, gespeichert, aus dem Netz bezogen und ins Netz
eingespeist wird, und macht diese Flüsse zeitlich aufgelöst sichtbar – von der
Live-Übersicht über Tagesverläufe bis zu Monats- und Jahresauswertungen samt
wirtschaftlicher Bewertung.

Ein Node-Backend fragt die Geräte im Hintergrund ab, aggregiert und persistiert
die Daten in SQLite und schickt den aktuellen Zustand per **Server-Sent Events**
live an den Browser. Das React-Frontend rendert ein Anlagenschema mit
Live-Overlays sowie zahlreiche Auswertungsseiten.

## Gesamtkonzept & Funktionsumfang

**Quellen und Senken – das flexible Grundprinzip.** Der Kern ist ein bewusst
allgemein gehaltenes Konzept aus *Quellen* und *Senken*. Eine Quelle ist ein
beliebiges Gerät, das Messwerte liefert (PV-Wechselrichter, Batteriespeicher,
Verbraucher, Stromzähler u. v. m.). Pro Quelle wird hinterlegt, von welcher URL
die Daten abgerufen werden und über welchen JSON-Pfad die einzelnen Messwerte
gelesen werden. Dadurch lassen sich nahezu **beliebig viele Geräte
unterschiedlichster Hersteller** einbinden, ohne feste Gerätevorlagen. Über die
Rolle einer Quelle (PV-Erzeugung, Batterie, Verbraucher, Netz, §42c-Netz …) wird
festgelegt, wie ihre Werte in die Gesamtbilanz einfließen.

Eine **Senke** ist der umgekehrte Weg: Sie definiert, **welche Informationen
FLUX nach außen an externe Geräte oder Akteure bereitstellt**. Jede Senke hat
dazu eine **Rolle**:

- **Zähleremulation** – FLUX bildet ein reales Messgerät nach (Shelly Pro 3EM /
  Pro EM-50 oder Marsteks CT002/CT003) und stellt einen berechneten Netzwert als
  Regelsignal bereit, typischerweise für die Nulleinspeisungs-Regelung eines
  AC-Speichers. Der auszugebende Wert wird flexibel aus einer Basis-Quelle,
  gewichteten Offsets weiterer Quellen und optional dem §42c-Abnehmerbedarf
  zusammengesetzt. Mehrere Speicher an einem emulierten CT werden über einen
  gemeinsamen Balancer aufgeteilt (siehe unten).
- **Datenbereitstellung für externes HEMS** – Platzhalter für eine künftige
  Ausbaustufe, in der FLUX ausgewählte Messwerte für ein übergeordnetes,
  externes Energiemanagementsystem bereitstellt. Die konkrete Ausgestaltung
  (Auswahl der Messwerte, Protokoll/Endpunkt) folgt in einer späteren Version.

So verstanden ist eine Senke also nicht auf die Zähler-Nachbildung beschränkt,
sondern allgemein die nach außen gerichtete Schnittstelle der Anlage; die
Zähleremulation ist die erste, vollständig ausgebaute Rolle.

**Wirtschaftliche Auswertung.** Über die reine Energiebilanz hinaus bewertet das
Tool die ökonomischen Effekte unter Berücksichtigung verschiedener
Rahmenbedingungen:

- **EEG-Modelle** – feste Einspeisevergütung (vor 25.02.2025) oder die neuere
  Regelung (ab 25.02.2025), bei der für Anlagen über 2 kWp keine Vergütung bei
  negativem Börsenpreis gezahlt wird.
- **Stromtarife** – fester Arbeitspreis oder dynamischer, viertelstundengenau
  börsenpreisabhängiger Tarif, jeweils mit optionaler monatlicher Grundgebühr
  und optionalen jährlichen Messstellen-Mehrkosten (mME/iMSys), beide anteilig
  je Tag in den Bezugskosten. Gilt ein Fixtarif, zeichnet das
  Strompreisdiagramm (in der Ansicht „Gesamtpreis brutto") zusätzlich eine
  waagerechte Referenzlinie auf Höhe des festen Preises ein – so ist auf einen
  Blick erkennbar, wann ein dynamischer Preis darunter- oder darüberläge.
- **§14a EnWG** – reduziertes Netzentgelt für steuerbare Verbrauchseinrichtungen,
  wahlweise als pauschale Reduktion (Modul 1) oder als dynamische Netzentgelte
  (Modul 3).
- **§42c EnWG (Energy Sharing)** – Teilen von Überschussstrom mit Haushalten in
  der Nachbarschaft zu einer eigenen Vergütung; das Tool verteilt den Überschuss
  je Zeitfenster und weist den finanziellen Vorteil gegenüber der klassischen
  Einspeisung aus.

**Zeitlich versionierte Kosten.** Kostensätze ändern sich über die Zeit. Die
Blöcke Stromtarif, §14a Modul 1, §14a Modul 3 und Wasserkosten sind daher in
**Perioden** unterteilt: Jede Periode gilt ab einem Datum, bis die nächste
beginnt. So lassen sich künftige Preise (z. B. ein neuer Tarif ab dem nächsten
Jahr) vorab eintragen – bis zum Stichtag wird mit den alten, danach automatisch
mit den neuen Werten gerechnet, und es bleibt nachvollziehbar, was wann galt.
Jeder Block wird getrennt versioniert.

**Integrierte Simulation.** Sind noch nicht alle Geräte real angebunden, lassen
sich über **Lastprofile** (typische Verbrauchsverläufe) und **Erzeugerprofile**
(typische PV-Erzeugung) Geräte nachbilden. Das erlaubt Betrachtungen zukünftiger
Szenarien und „Was-wäre-wenn"-Analysen, bevor tatsächlich investiert wird.

**Steuern und Automatisieren.** Über die Auswertung hinaus kann das Tool aktiv
eingreifen und benachrichtigen:

- **Automatisierungsregeln** – frei konfigurierbare Regeln mit Ein- und
  Ausschaltbedingungen (Messwerte, Zeitfenster, Quellen-Zustände, jeweils mit
  UND/ODER und optionaler Mindestdauer). Als Aktion können schaltbare Ausgänge
  (Shelly Plug/Pro/2PM) geschaltet oder Push-Nachrichten gesendet werden. Jede
  Bedingung zeigt live ihren Erfüllt-Status; Auslösungen werden protokolliert.
- **Push-Benachrichtigungen** – über den kostenlosen Dienst *ntfy* (Server/Topic
  frei wählbar). Wann benachrichtigt wird, legen die Automatisierungsregeln fest
  (Aktion „Push-Nachricht").
- **AC-Speicher** – AC-gekoppelte Batteriespeicher werden unterstützt, entweder
  über die lokale API (Marstek Venus C/D/E) oder generisch (z. B. per Shelly
  gemessen). Bezug und Einspeisung werden getrennt erfasst.
- **DC-Speicher** – gleichstromseitig gekoppelte Eigenbau-Speicher (Laderegler +
  Wechselrichter) lassen sich abbilden, indem ihre PV-Ladung, ihre Netzladung und
  ihre Entladung mit den jeweils messenden Quellen verknüpft werden. Der Speicher
  zählt dabei nicht doppelt in die Energiebilanz.
- **Speicher-Wirkungsgrad** – für auswertbare Speicher stellt das Tool je Zeitraum
  (Tag oder Monat) die eingespeicherte der zurückgewonnenen Energie gegenüber und
  weist Wirkungsgrad und Verlust aus. So werden Speicherverluste über die Zeit
  sichtbar.
- **Warmwasserspeicher** – eine eigene Rolle erfasst die Speichertemperaturen
  (oben/unten) und zeigt sie auf der Übersicht.

**Wasserverbrauch.** Neben Strom kann der **Hauswasserzähler** eingebunden werden
(Rolle „Wasserzähler", z. B. per AI-on-the-Edge über dessen JSON-Schnittstelle).
Aus den Zählerständen werden viertelstundengenaue Verbräuche und Tagesbilanzen
berechnet; die Wasserkosten (Frischwasser, Abwasser, Grundpreis) sind einstellbar.

**PV-Ertragsprognose.** Auf der Seite **PV Anlagendaten** (unter Einstellungen)
lassen sich Anlagen mit ihren technischen Daten hinterlegen – Standort und je
Anlage beliebig viele Strings mit Modulzahl, Modulleistung, Ausrichtung und
Neigung; Quellen mit der Rolle „PV-Erzeugung" werden per Drag&Drop zugeordnet.
Daraus wird über den Dienst *forecast.solar* eine Ertragsprognose für heute und
morgen abgerufen und als gestapeltes Balkendiagramm über alle Anlagen dargestellt,
inklusive Tagesertrag heute/morgen und verbleibendem Ertrag des laufenden Tages.
Jede inhaltlich veränderte Prognose wird als eigener Stand gespeichert; ein
Schieberegler unter dem Diagramm blendet den **Prognose-Verlauf des ersten Tages**
ein und lässt durch die im Tagesverlauf eingegangenen Stände blättern. Der Regler
rastet dabei an den tatsächlichen Uhrzeiten der Prognosen ein, und es werden nur
die **am jeweiligen Tag selbst** eingegangenen Stände gezeigt (für „heute" also
nicht die bereits gestern für heute abgerufene Prognose). Die y-Achse bleibt beim
Durchblättern fest auf dem Tagesmaximum, damit sich der Maßstab nicht ständig
ändert.

**Sichern und Übertragen.** Über **Import/Export** lässt sich die gesamte
Konfiguration (Quellen, PV-Anlagendaten, Tarif- und Anschlussdaten, §42c-Abnehmer,
Farben, Senken, Profile, Regeln, Benachrichtigungen u. a.) als JSON-Datei sichern
und wiederherstellen – die aufgelaufenen Messwerte bleiben dabei außen vor.

**Zeitliche Auflösung.** Die Energiebilanzen werden **viertelstundengenau**
geführt – dieselbe Auflösung wie im Energiemarkt und bei dynamischen Tarifen.
Daraus ergeben sich Tages-, Monats- und Jahresauswertungen. Schnell veränderliche
Geräte wie die Wärmepumpe werden zusätzlich im feinen Abfrageintervall
(Sekundenbereich) aufgezeichnet, sodass sich auch kurze Vorgänge wie Abtauzyklen
nachvollziehen lassen. Die Live-Übersicht aktualisiert sich fortlaufend.

Eine ausführliche Beschreibung findet sich auch direkt in der Anwendung im
Menübereich **Hilfe** (Gesamtkonzept, Konfiguration, Auswertung).

## Architektur

```
Geräte (LAN)  ──HTTP──▶  Backend-Poller (Node)  ──SSE──▶  Browser (React)
                              │
                              └── SQLite (Historie, Viertelstunden,
                                  Sharing, Wärmepumpe, Resets, Settings …)
```

- **Backend** (`server/`): fragt die konfigurierten Quellen in ihren jeweiligen
  Intervallen ab, aggregiert die Werte, bildet Tages- und Viertelstundenbilanzen,
  berechnet Kosten/Autarkie und stellt REST-Endpunkte sowie einen SSE-Stream
  bereit.
- **Frontend** (`web/`): Anlagenschema mit Live-Overlays, Detail-, Tagesverlaufs-,
  Monats-, Energy-Sharing- und Konfigurationsseiten.

## Voraussetzungen

- **Node.js 22.13+** (nutzt das eingebaute `node:sqlite`-Modul – **kein Compiler,
  kein node-gyp, keine nativen Module nötig**). Node 24+ empfohlen. Verfügbar für
  Windows, macOS und Linux.
- Der Rechner, auf dem das Tool läuft, muss im selben lokalen Netzwerk (LAN)
  hängen wie die abzufragenden Geräte.

## Auslieferungszustand

FLUX wird **ohne Datenbank** ausgeliefert. Beim ersten Start legt es
automatisch eine frische, leere Datenbank (`server/hems.db`) mit sinnvollen
Standardeinstellungen an. Es sind also keine persönlichen Daten, keine Messwerte
und keine vorkonfigurierten Geräte enthalten – der Start erfolgt „auf der grünen
Wiese".

Die gesamte Einrichtung geschieht über die Oberfläche unter **Einstellungen**:

- **Quellen** und **Senken** für die eigenen Geräte anlegen (IP-Adressen, URLs,
  JSON-Pfade). Mit der Testfunktion lässt sich pro Quelle prüfen, ob die Angaben
  zusammenpassen; die **Status**-Seite zeigt, welche Geräte erreichbar sind.
- **Tarif**, **PV-Anlagenstammdaten**, **Standort** und die übrigen Parameter
  hinterlegen.

Solange noch keine realen Geräte angebunden sind, lassen sich über Last- und
Erzeugerprofile Geräte simulieren (siehe Gesamtkonzept), um das Tool bereits
auszuprobieren.

**Börsenstrompreise:** FLUX bezieht die Day-Ahead-Preise (Zeitreihe DE-LU der
Energy-Charts-API von Fraunhofer ISE) automatisch. Beim ersten Start und danach
laufend werden die benötigten Tage geladen und in der Datenbank zwischengespeichert.

## Schnellstart mit den Skripten (macOS/Linux, empfohlen)

Für den Alltag gibt es zwei Skripte, die den kompletten Ablauf automatisieren.
Sie müssen im jeweiligen Versionsordner ausgeführt werden.

**Neue Version einspielen** – `update.sh`:

```bash
bash update.sh
```

Das Skript liest die Version aus dem Code, benennt seinen Ordner in
`hems v<Version>` um, sucht daneben automatisch die neueste vorhandene
Vorgängerversion (auch wenn Versionen übersprungen wurden) und übernimmt von dort:

- die **Datenbank** (als `hems_old.db`, wird beim ersten Start migriert),
- den **EEBUS-Sidecar** (kompilierte Binary + Zertifikate/Keys), falls dort eine
  fertige Binary liegt.

Danach baut es Frontend und Backend und startet den Server. Nichts muss von Hand
umbenannt oder kopiert werden. Optionen: `--no-start` (nur migrieren und bauen),
`--from "hems v400"` (Vorgänger explizit vorgeben).

**Laufende Version neu starten** – `start.sh`:

```bash
bash start.sh
```

Startet eine bereits eingerichtete Version, ohne zu migrieren, umzubenennen oder
neu zu bauen. (Fehlt ausnahmsweise ein Build, wird er einmalig nachgeholt.)

**Wichtig:** Für einen reinen Neustart immer `start.sh` verwenden, **nicht**
erneut `update.sh` – letzteres würde wieder einen Vorgänger suchen und umbenennen.

Nach dem Start ist die Oberfläche unter **http://localhost:3000** erreichbar. Der
Server liefert das Frontend selbst aus; ein separater Frontend-Start ist im
Normalbetrieb nicht nötig.

### EEBUS-Sidecar (automatisch, optional)

Beide Skripte starten den EEBUS-Sidecar automatisch mit, sofern er nutzbar ist:

- Liegt eine kompilierte Binary (`eebus-sidecar/flux-eebus-sidecar`) vor, wird sie
  genutzt; fehlt sie und ist Go installiert, wird sie einmalig gebaut.
- Zertifikat und Schlüssel werden im Sidecar-Ordner gesucht (`.pem`-Paar bevorzugt,
  `.crt`/`.key` als Alternative). Fehlen sie beim allerersten Start, erzeugt der
  Sidecar sie selbst.
- Der **Steuerbox-SKI** wird, falls vorhanden, automatisch aus der Datenbank
  (`eebusConfig`) gelesen und übergeben; er kann alternativ in FLUX gesetzt werden.

Fehlt Binary **und** Go, wird der Sidecar übersprungen – der FLUX-Server läuft
dann normal weiter, nur ohne EEBUS. Beim Beenden des Servers (Strg+C) wird ein von
den Skripten gestarteter Sidecar automatisch mitgestoppt. Ein bereits laufender,
manuell gestarteter Sidecar wird erkannt und nicht doppelt gestartet.

---

## Installation (manuell, plattformübergreifend)

In beiden Ordnern werden die Abhängigkeiten installiert (nur `express` +
Dev-Werkzeuge, kein nativer Build):

```bash
cd server
npm install

cd ../web
npm install
```

> Hinweis: Die Persistenz nutzt das in Node 22+ integrierte SQLite
> (`node:sqlite`). Beim Start erscheint je nach Node-Version evtl. eine
> `ExperimentalWarning` – sie wird in den npm-Scripts bereits unterdrückt und ist
> unbedenklich.

## Start je nach Plattform

Das Tool ist plattformneutral geschrieben (alle Pfade über `path.join`, keine
betriebssystemspezifischen Aufrufe) und läuft mit demselben Code unter **macOS**,
**Windows** und **Linux**. Nur Installation/Start unterscheiden sich minimal.

### Produktion (ein Prozess, empfohlen)

Zuerst das Frontend bauen, dann das Backend bauen und starten – das Backend
liefert das gebaute Frontend gleich mit aus.

**macOS / Linux:**

```bash
cd web && npm run build
cd ../server && npm run build && npm start
```

**Windows (PowerShell oder Eingabeaufforderung):**

```powershell
cd web
npm run build
cd ..\server
npm run build
npm start
```

Anschließend im Browser öffnen: **http://localhost:3000**

> **Windows-Hinweis zum Build-Skript.** Das `build`-Skript des Backends kopiert
> nach dem Kompilieren eine Datei (`emu_profiles.json`) ins `dist`-Verzeichnis.
> Sollte der dort verwendete Kopierbefehl unter Windows nicht durchlaufen, genügt
> es, die Datei `server/src/emu_profiles.json` einmalig von Hand nach
> `server/dist/emu_profiles.json` zu kopieren. Der laufende Betrieb ist davon
> nicht betroffen.

> **Firewall (Windows).** Beim ersten Start fragt Windows, ob Node.js
> Netzwerkzugriff erhalten darf. Da das Backend an alle Netzwerk-Schnittstellen
> bindet (damit es im LAN erreichbar ist), muss diese Freigabe einmal bestätigt
> werden.

### Entwicklung (zwei Terminals)

Für die Entwicklung mit automatischem Neuladen laufen Backend und Frontend
getrennt; Vite reicht `/api`-Anfragen ans Backend durch.

```bash
# Terminal 1 – Backend (Port 3000)
cd server && npm run dev

# Terminal 2 – Frontend (Port 5173)
cd web && npm run dev
```

Dann **http://localhost:5173** öffnen. (Unter Windows dieselben Befehle in zwei
PowerShell-Fenstern.)

## Dauerbetrieb

Damit das Tool dauerhaft im Hintergrund läuft, empfiehlt sich ein
Autostart-Mechanismus des jeweiligen Betriebssystems.

> Hinweis: Die folgenden Autostart-Beispiele starten nur den FLUX-Server direkt
> (`node dist/index.js`) und **nicht** den EEBUS-Sidecar. Wer EEBUS im Autostart
> braucht, startet den Sidecar über einen eigenen Dienst mit – oder nutzt für den
> laufenden Betrieb `start.sh` (siehe „Schnellstart mit den Skripten"), das den
> Sidecar automatisch mitnimmt.

### macOS (launchd)

Datei `~/Library/LaunchAgents/de.hems.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>de.hems</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/node</string>
      <string>/PFAD/zu/hems/server/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>/PFAD/zu/hems/server</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/hems.log</string>
    <key>StandardErrorPath</key><string>/tmp/hems.err</string>
  </dict>
</plist>
```

Laden: `launchctl load ~/Library/LaunchAgents/de.hems.plist`

### Windows (Aufgabenplanung / Dienst)

Zwei einfache Wege:

1. **Aufgabenplanung** – eine Aufgabe anlegen, die „Bei Anmeldung" bzw. „Beim
   Start des Computers" `node C:\PFAD\zu\hems\server\dist\index.js` im
   Arbeitsverzeichnis `C:\PFAD\zu\hems\server` ausführt. Zur Bequemlichkeit kann
   man den Startbefehl auch in eine kleine `start-hems.bat` legen und diese von
   der Aufgabe ausführen lassen.
2. **Als Windows-Dienst** – mit einem Hilfsprogramm wie
   [NSSM](https://nssm.cc/) lässt sich `node dist/index.js` als echter Dienst
   registrieren, der automatisch startet und bei Absturz neu anläuft.

### Linux (systemd)

Analog per `systemd`-Service-Unit, die `node /PFAD/zu/hems/server/dist/index.js`
mit `Restart=always` startet.

## Konfiguration

Die eigentliche Gerätekonfiguration ist **datengetrieben** und erfolgt vollständig
über die Oberfläche – nicht über Dateien:

- **Einstellungen → Quellen / Senken:** Geräte, Rollen, URLs, JSON-Pfade,
  Intervalle; Test- und Statusfunktion. Quellen und Senken lassen sich je Eintrag
  **ein- und ausklappen** (standardmäßig eingeklappt, um die Übersicht zu wahren);
  ein Klick in der Schnellauswahl der Quellenseite klappt die betreffende Quelle
  gleich auf und springt zu ihr. Bei Senken wird zuerst die **Rolle** gewählt
  (Zähleremulation oder Datenbereitstellung für externes HEMS); die weitere
  Konfiguration richtet sich danach.
- **Einstellungen → Stromtarif & -anschluss:** Einspeisevergütung, EEG-Regelung,
  Stromtarif (inkl. monatlicher Grundgebühr), §14a-Optionen und Wasserkosten. Die
  zeitabhängigen Blöcke lassen sich in Perioden mit Gültigkeitsdatum pflegen.
  (Früher „Kosten"; die §42c-Abnehmer und der Verteilungsschlüssel sind auf die
  Energy-Sharing-Seite umgezogen.)
- **Energy Sharing:** §42c-Abnehmer mit ihren (ggf. individuellen)
  Vergütungssätzen und dem Verteilungsschlüssel; zudem Verbrauchsverlauf,
  Sharing-Anteil und Wirtschaftlichkeitsanalyse.
- **Einstellungen → Lastprofile / Erzeugerprofile:** Profile für die Simulation
  hochladen und den Emulations-Quellen zuordnen.
- **Einstellungen → Visualisierung:** einheitliche Farben der Charts.

Nur wenige technische Grundwerte stehen in `server/src/config.ts` (Server-Port,
Mindest-Pollintervall, Standard-Strompreis). Geräte-IPs gehören **nicht** hierher,
sondern in die Quellen-Konfiguration.

## Automatisierung, Speicher-Steuerung & Betrieb

**Regeln mit Bedingungen und Aktionen.** Unter *Automatisierung* lassen sich
Regeln anlegen, die bei erfüllten Einschaltbedingungen Aktionen ausführen und bei
Ausschaltbedingungen wieder zurücknehmen. Bedingungen (z. B. Überschuss,
Metrik-Schwellen, Uhrzeit, Tarifmodus, Timer) zeigen links einen farbigen Punkt:
grün = erfüllt, rot = nicht erfüllt. Aktionen mit prüfbarem Zielzustand
(Ausgang ein/aus, CT-Ausfaden) zeigen denselben Punkt und geben damit an, ob der
Zielzustand aktuell eingenommen ist.

**Bedingungslose Regeln als Schalter.** Eine Regel ohne Einschaltbedingung, deren
Aktionen einen aktiven Zielzustand herstellen (Ausgang ein oder Ausfaden an),
gilt als *laufend*, sobald ihr gesamter Zielzustand erreicht ist – auch wenn er
von außen (Hersteller-App, Taster) hergestellt wurde. Sie erscheint dann in der
Startseiten-Kachel als laufend und kann dort gestoppt werden. Wichtig: Beim
Stoppen werden **ausschließlich** die explizit hinterlegten Ausschalt-Aktionen
ausgeführt – es gibt kein implizites Zurückschalten. Ein Ausgang wird ohne Timer,
externe Schaltung oder ausdrückliche Aus-Aktion nie von selbst abgeschaltet.

**Scharf vs. nicht scharf – wann die Automatik greift.** Diese automatische
Laufend-Erkennung – wie überhaupt jedes selbsttätige Auslösen einer Regel – wirkt
**nur bei scharf geschalteten Regeln**. Eine nicht scharfe Regel wird von der
Automatik niemals aktiviert oder als laufend geführt, auch dann nicht, wenn ihr
Zielzustand von außen erreicht ist; sie lässt sich lediglich **manuell** über den
Start-Knopf auslösen. So kann man Regeln in Ruhe vorbereiten, ohne dass sie
unbeabsichtigt anspringen. Auf der Startseite sind die Kacheln entsprechend
markiert: scharfe Regeln haben eine kräftige Umrandung, nicht scharfe eine dezent
gestrichelte – so ist auf einen Blick erkennbar, welche Regeln selbsttätig wirken
können.

**CT-Ausfaden (AC-Speicher sanft auf 0).** Für per CT002/CT003 gesteuerte
AC-Speicher gibt es auf der Senkenseite einen Ausfade-Schalter. Ist er aktiv,
fährt der Balancer die AC-Speicher schrittweise auf 0 W Batterieleistung und hält
sie dort – unabhängig von der Netzbilanz und ohne harte Shelly-Abschaltung. Das
dient dazu, AC-Speicher „herunterzufahren", bevor DC-Speicher übernehmen, damit
beide nicht gegeneinander arbeiten. Das Ausfaden ist auch als Regel-Aktion
(*AC-Speicher ausfaden*) verfügbar sowie als Regel-Bedingung (*AC-Ausfaden
Zustand*), etwa um einen DC-Ausgang erst nach dem Ausfaden zuzuschalten.

**CT „kein AC-Laden".** Ein zweiter CT-Modus (ebenfalls auf der Senkenseite und
als Regel-Aktion *AC-Speicher kein AC-Laden* verfügbar) begrenzt den an die
AC-Speicher gelieferten CT-Wert auf **≥ 0**: positive Werte (Entladung bzw.
Bezugsausgleich) werden normal durchgereicht, negative Werte – die die Speicher
zum Laden bewegen würden – auf 0 gekappt. Damit laden sich die AC-Speicher nicht
über den CT auf, z. B. während ein DC-Speicher einspeist. Ausfaden und „kein
AC-Laden" schließen sich gegenseitig aus; es kann auch keiner der beiden Modi
aktiv sein (Normalbetrieb).

**Mehrere AC-Speicher: Lastverteilung mit Sättigungserkennung.** Sind mehrere
AC-Speicher über dieselbe CT-Regelung gekoppelt, teilt das Tool die
auszuregelnde Leistung gewichtet auf sie auf, sodass sie gemeinsam die
Netzabweichung ausregeln, statt sich gegenseitig aufzuschaukeln. Erreicht ein
Speicher seine **technische Leistungsgrenze** (er folgt einem höheren Ziel nicht
mehr, z. B. weil sein Maximum bei 1200 W liegt), erkennt der Balancer diese
Sättigung und verteilt die frei werdende Leistung auf die übrigen, noch nicht
ausgelasteten Speicher. Ein Speicher mit mehr Reserve übernimmt dann den größeren
Anteil, sodass ein vorhandener Überschuss möglichst vollständig gespeichert statt
ins Netz eingespeist wird. Fällt die Aufnahme eines Speichers gegen Ende des
Ladevorgangs ab (Speicher wird voll), wird die erkannte Grenze automatisch
nachgeführt und der andere Speicher übernimmt bis zu seinem eigenen Maximum. Sinkt
der Überschuss so weit, dass keine Grenze mehr im Weg ist, teilen die Speicher
wieder gleichmäßig.

Die **Gewichtung ist dabei ein Richtwert, kein hartes Limit**: Kann ein Speicher
seinen gewichtsproportionalen Anteil nicht liefern (er ist leer oder
leistungsbegrenzt), übernimmt ein anderer, dazu fähiger Speicher den Rest – auch
über seinen eigenen „fairen" Anteil hinaus. Ist die benötigte Gesamtleistung
höher als das, was ein Speicher bisher als Grenze gelernt hat, während der andere
nichts beitragen kann, hebt der Balancer die gelernte Grenze schrittweise an
(probeweises Antesten), bis der Bedarf gedeckt ist oder der Speicher real an seine
physische Grenze stößt – dann wird die Grenze wieder auf den echten Wert gelernt.

**Ruhiges Regeln um den Nullpunkt.** Damit die Speicher nicht ständig um die
Nulleinspeisung pendeln, sind mehrere Dämpfungen eingebaut, alle auf der
Senkenseite einstellbar:

- **Max. Schritt / Poll** (Slew-Rate) begrenzt, um wie viel Watt ein Speicher je
  Abfrage höchstens nachgeführt wird; **Totband um 0** unterdrückt Nachregeln bei
  sehr kleiner Netzabweichung.
- **Umverteilung zwischen Speichern** (Umverteilungs-Schritt + Balance-Toleranz):
  Ist das Netz bereits grob ausgeregelt und geht es nur noch darum, die Speicher
  ins gewünschte Verhältnis zu bringen, geschieht dieses Angleichen bewusst
  langsam und mit einem Toleranzband – so schaukeln sich zwei Speicher nicht
  gegeneinander auf. Echte Laständerungen werden davon nicht verlangsamt.
- **Frische-Prüfung des Netzwerts:** Der Speicher fragt den emulierten Zähler
  oft schneller ab, als der zugrunde liegende Netzzähler (Shelly) neue Werte
  liefert. Solange der Netzwert seit der letzten Abfrage unverändert (also noch
  nicht frisch gemessen) ist, unterdrückt der Balancer ein erneutes Delta, damit
  der Speicher seine bereits eingeleitete Änderung erst real wirksam werden lässt,
  statt auf einen veralteten Wert zu überschwingen. Ein echt konstanter Bedarf
  wird nach wenigen Abfragen trotzdem weiter ausgeregelt.

**Anzeige.** Der Live-Block des Multi-Speicher-Balancers wird direkt **innerhalb
der zugehörigen CT-Senke** angezeigt (Zähleremulation mit ct002/ct003), samt der
Gewichts- und Dämpfungseinstellungen, da diese logisch zur Senke gehören.

**Sicherheit der CT-Regelung bei fehlender Netzmessung.** Die CT-Regelung stützt
sich auf die aktuelle Messung des Netzzählers. Fehlt für kurze Zeit ein **frischer**
Messwert (Netzzähler nicht erreichbar), regelt das Tool **nicht** auf dem letzten,
veralteten Wert weiter – das könnte die Speicher blind konstant einspeisen lassen.
Stattdessen fährt es die AC-Speicher sicherheitshalber kontrolliert auf 0 W
(sanftes Ausfaden) und protokolliert das. Sobald wieder frische Messwerte
vorliegen, nimmt die normale Regelung selbsttätig den Betrieb auf.

**Geräteschonende Abfragen.** Geräte-Abfragen schließen ihre Verbindung nach jeder
Antwort (kein Keep-Alive), und identische Abfragen im selben kurzen Zeitfenster
werden zusammengefasst. Der Schaltzustand eines Aktors wird aus dem ohnehin
laufenden Status-Poll abgeleitet, statt zusätzliche Anfragen zu senden. Das
verhindert, dass schwache Geräte (z. B. Shelly Pro 2PM, 2.5, Plug M, 1PM Mini
Gen3) durch zu viele gleichzeitige Verbindungen ihre Netzwerkverbindung verlieren.
Erwartbare Ausfälle – etwa ein Wechselrichter, der nachts nicht erreichbar ist –
werden dabei nur einmal je Offline-Phase vermerkt und fluten das Protokoll nicht.

## Import / Export

Auf der Seite *Import / Export* sind **zwei getrennte Bereiche** klar voneinander
abgesetzt:

- **Einstellungen** (oben): Konfiguration wie Quellen, PV-Anlagendaten, Senken,
  Kosten, Profile, Regeln und Regelgruppen – abschnittsweise aus-/einwählbar,
  Import wahlweise zusammenführend (*merge*) oder ersetzend (*replace*).
- **Messdaten (Zeitspanne)** (unten, sichtbar abgetrennt): der gesammelte
  Datenbestand eines Zeitraums. Über Start- und Enddatum wird ein Export erzeugt,
  der alle in dieser Zeit erfassten Verläufe enthält (Energie-, Verbraucher-, PV-,
  Sharing- und Wasser-Viertelstundenwerte, Wärmepumpen- und Warmwasserdaten,
  Tagesbilanzen, Börsenpreise, Drosselungen). Beim Import wird der enthaltene
  Zeitraum samt Datensatzzahlen angezeigt; vorhandene Daten im Zielzeitraum können
  wahlweise beibehalten (nur Fehlendes ergänzen) oder nach Rückfrage überschrieben
  werden. So lässt sich ein Datenbestand auf eine neue Version übertragen.

**Daten verwalten (Jahreskalender).** Die Seite *Daten verwalten* (unter Import /
Export) zeigt einen kompakten Jahreskalender, Jahr vor- und zurückschaltbar. Jeder
Tag ist nach Datenfülle eingefärbt: kräftig grün = vollständiger Tag, hellgrün =
teilweise Daten, blassgrün = nur Tages-/Preisdaten, grau = keine Daten. Der
Slot-Anteil berücksichtigt die Zeitumstellung (92 bzw. 100 statt 96 Slots). Ein
Klick auf einen Tag öffnet ein Overlay mit den Datenmengen je Datenart und
erlaubt, diesen Tag zu löschen; zusätzlich lässt sich ein ganzer Datumsbereich
löschen. Löschungen erfolgen erst nach ausdrücklicher Bestätigung. Beim Löschen
eines Zeitraums werden auch die **Log-Meldungen und das Regel-Protokoll** desselben
Zeitraums entfernt. **Börsenstrompreise werden dabei nie gelöscht** – sie sind
externe Marktdaten und bleiben erhalten, während alle eigenen Messdaten des
Tages/Zeitraums entfernt werden.

## Persistenz

Alle Daten liegen in `server/hems.db` (SQLite via eingebautem `node:sqlite`).
Wichtige Tabellen:

- `settings` – alle Einstellungen (Preise, Tarif, §14a/§42c, Quellen- und
  Senken-Konfiguration, PV-Anlagendaten unter dem Schlüssel `pvAnlagen`,
  Zustandsflags).
- `history` – abgeschlossene Tagesbilanzen (Verbrauch, Erzeugung, Netzbezug,
  Einspeisung inkl. §42c-Anteile, Autarkie).
- `viertelstunden` – viertelstundengenaue Energiewerte je Tag.
- `sharing_viertelstunden` – §42c-Sharing-Werte je Viertelstunde und Abnehmer.
- `consumer_viertelstunden` – viertelstundengenauer Verbrauch je Gerät.
- `pv_viertelstunden` – viertelstundengenauer PV-Ertrag je Erzeuger.
- `wasser_viertelstunden` – viertelstundengenauer Wasserverbrauch.
- `warmwasser_data` – Warmwasser-Temperaturen (oben/unten).
- `wp_data` – hochaufgelöste Wärmepumpen-Messreihen.
- `spotpreise` – Börsenstrompreise je Tag (für dynamische Tarife/Vergütung).
- `pv_prognose` – Ertragsprognose je Anlage und Tag (96-Slot-Profil + Tagessumme;
  stündlich vom Server aktualisiert, der letzte Abruf ersetzt den vorherigen
  Tageswert je Anlage).
- `resets` – Zähler-Anker (Zählerstände zu Tages-/Viertelstundenbeginn).
- `rule_log` – Protokoll der Automatisierungsregeln (Ein-/Ausschaltereignisse).
- `logs` – Protokollmeldungen (siehe Hilfe → Debugging).

**Neustart-Robustheit der Energiezähler.** Die Tagesenergie (Netzbezug/-einspeisung,
PV-Ertrag) wird nach einem Neustart des Tools aus den bereits heute persistierten
Viertelstundenwerten rekonstruiert: Der Zähler-Anker wird auf den Stand zu
Tagesbeginn gesetzt (aktueller Zählerstand minus die heute schon gespeicherte
Tagessumme). Dadurch zeigt die Oberfläche direkt nach dem Start wieder die volle
Tagesenergie; verloren geht höchstens der gerade laufende, noch nicht
weggeschriebene Viertelstunden-Slot (bei einem Neustart genau zum Slot-Beginn
sogar nichts).

So überleben Historie und laufende Tageswerte einen Neustart des Programms.

**Datenübernahme aus einer Vorversion (`hems_old.db`).** Beim Umstieg auf eine
neue Programmversion mit frischer Datenbank lassen sich die Daten und
Einstellungen der Vorversion übernehmen: Dazu die alte `hems.db` als
**`hems_old.db`** in den `server/`-Ordner der neuen Version legen. Beim nächsten
Start wird sie automatisch eingelesen – nicht durch Kopieren der ganzen Datei
(neue Versionen können zusätzliche Spalten/Tabellen enthalten), sondern je
Tabelle nur über die gemeinsame Spalten-Schnittmenge, sodass das neue Schema
unangetastet bleibt. Nach erfolgreicher Übernahme wird die Datei in
`hems_old.imported.<Zeitstempel>.db` umbenannt, damit die Übernahme nicht bei
jedem Start erneut läuft. Ob und was übernommen wurde, steht als kurze Meldung
im Log (Hilfe → Debugging) und in der Server-Konsole. Ist keine `hems_old.db`
vorhanden, startet das Tool normal.

**Schonender Schreibbetrieb.** Die Datenbank läuft im WAL-Modus mit gebündelter
Synchronisation, und die häufig aktualisierten Zähler-Anker werden nur bei
tatsächlicher Wertänderung geschrieben. Dadurch bleibt die Schreiblast auf den
Datenträger (SSD) im Dauerbetrieb gering, ohne dass Messwerte verloren gehen.

> Hinweis: Drosselungen werden nicht mehr in einer eigenen Verlaufstabelle
> historisiert; die Tabelle `drosselungen` besteht nur noch aus
> Kompatibilitätsgründen und wird nicht mehr befüllt.

## Lizenz, Haftung und Entstehung

FLUX steht unter der **MIT-Lizenz** – frei nutzbar, veränderbar und
weiterverteilbar, ohne Einschränkung. Der vollständige Lizenztext liegt in der
Datei [`LICENSE`](./LICENSE). Copyright © 2026 OFFIS e.V. (http://www.offis.de).

> **Wichtiger Hinweis (Vibe Coding / KI-generiert, keine Haftung).**
> FLUX ist zu wesentlichen Teilen im Dialog mit einer KI entstanden
> („Vibe Coding"); ein großer Teil des Quelltexts wurde KI-generiert und nicht
> Zeile für Zeile manuell auditiert. Die Software steuert und überwacht reale
> elektrische Anlagen. Sie wird **„wie besehen", ohne jede Gewährleistung** und
> **ohne jegliche Haftung** bereitgestellt; die Nutzung erfolgt vollständig auf
> eigenes Risiko. Die vollständigen Hinweise – auch zur Verantwortung der
> Nutzerin/des Nutzers und zum sicheren Umgang mit realen Steuereingriffen –
> stehen in [`NOTICE.md`](./NOTICE.md). **Bitte vor dem Einsatz lesen.**

FLUX nutzt Open-Source-Bibliotheken unter permissiven Lizenzen (MIT, BSD,
Apache 2.0). Die Übersicht und die Weitergabe der Lizenzhinweise findet sich in
[`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md).
