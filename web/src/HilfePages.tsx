// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Hilfe-Seiten von FLUX: Gesamtkonzept, Konfiguration und Auswertung.
// Reine Erklärseiten ohne eigene Daten – sie beschreiben Idee, Aufbau und
// Nutzung des Tools, damit es auch von Personen bedient werden kann, die nicht
// an der Entwicklung beteiligt waren.

export function HilfeKonzeptPage() {
  return (
    <div className="page hilfe-page">
      <h2>Gesamtkonzept</h2>

      <section className="card">
        <h3>Worum es geht</h3>
        <p>
          Dieses Werkzeug ist ein Heimenergiemanagement-System (FLUX) mit
          Schwerpunkt auf der <strong>Auswertung sämtlicher Energieflüsse</strong>{" "}
          eines Haushalts und der Möglichkeit zur <strong>aktiven Steuerung</strong>{" "}
          angeschlossener Geräte. Es erfasst laufend, wie viel Strom erzeugt,
          verbraucht, gespeichert, aus dem Netz bezogen und ins Netz eingespeist
          wird, und macht diese Flüsse zeitlich aufgelöst sichtbar. Ziel ist nicht
          nur die Momentanüberwachung, sondern vor allem das Verständnis: Wo kommt
          die Energie her, wohin fließt sie, und was bedeutet das wirtschaftlich?
        </p>
        <p>
          Über die reine Auswertung hinaus bietet das Tool mehrere, sich
          ergänzende <strong>Steuerungsmechanismen</strong>:
        </p>
        <ul className="hilfe-list">
          <li>
            <strong>Automatisierungsregeln</strong> sind das Herzstück der
            Steuerung. Nach dem Wenn-dann-Prinzip verknüpfen sie frei definierbare
            Bedingungen (Messwerte wie PV-Überschuss, Börsenstrompreis, Batterie-
            Ladezustand oder Speichertemperatur, Zeitfenster, der Zustand einer
            Quelle, das Tarifmodell oder ein täglicher Auslöser) mit Aktionen –
            entweder einen schaltbaren Ausgang ein-/ausschalten (z.&nbsp;B. einen
            Heizstab bei PV-Überschuss) oder eine Push-Benachrichtigung senden
            (z.&nbsp;B. bei negativem Börsenpreis oder einer ausgefallenen Quelle).
            Ein- und Ausschaltbedingungen lassen sich mit UND/ODER kombinieren und
            mit einer Mindestdauer versehen.
          </li>
          <li>
            <strong>Direkte Speicheransteuerung.</strong> AC-Batteriespeicher
            lassen sich – je nach Anbindungsprotokoll – unmittelbar steuern: etwa
            Betriebsmodi umschalten oder erzwungenes Laden/Entladen mit Leistungs-
            und Ziel-Ladezustandsvorgabe auslösen. Das geschieht auf der
            Speicher-Seite oder lässt sich mit Regeln verbinden.
          </li>
          <li>
            <strong>Senken</strong> sind der umgekehrte Weg zu den Quellen: Sie
            definieren, welche Informationen FLUX <strong>nach außen</strong> an
            externe Geräte oder Akteure bereitstellt. Je nach gewählter Rolle
            bildet eine Senke etwa ein reales Messgerät nach und liefert einem
            Speicher ein Regelsignal – so kann das Tool z.&nbsp;B. einen
            Batteriespeicher gezielt so regeln, dass er neben dem eigenen
            Hausverbrauch auch den Bedarf von §42c-Abnehmern deckt.
          </li>
        </ul>
        <p>
          Auswertung und Steuerung greifen dabei ineinander – die erfassten Flüsse
          sind zugleich die Grundlage der Regelung.
        </p>
      </section>

      <section className="card">
        <h3>Quellen und Senken – das flexible Grundprinzip</h3>
        <p>
          Der Kern des Tools ist ein bewusst allgemein gehaltenes Konzept aus{" "}
          <strong>Quellen</strong> und <strong>Senken</strong>. Eine Quelle ist
          ein beliebiges Gerät, das Messwerte liefert – ein PV-Wechselrichter, ein
          Batteriespeicher, ein Verbraucher, ein Stromzähler und vieles mehr. Für
          jede Quelle wird hinterlegt, von welcher Adresse (URL) ihre Daten
          abgerufen werden und über welchen Pfad die einzelnen Messwerte aus der
          Antwort gelesen werden. Dadurch lassen sich nahezu{" "}
          <strong>beliebig viele Geräte unterschiedlichster Hersteller</strong>{" "}
          einbinden, ohne dass für jedes Modell eine feste Vorlage nötig wäre.
        </p>
        <p>
          Über die Rolle einer Quelle (z.&nbsp;B. PV-Erzeugung, Batterie,
          Verbraucher, Netzanschluss) wird festgelegt, wie ihre Werte in die
          Gesamtbilanz einfließen. Eine <strong>Senke</strong> ist der umgekehrte
          Weg: Sie legt fest, welche Informationen FLUX nach außen bereitstellt.
          Auch eine Senke hat dazu eine <strong>Rolle</strong> –{" "}
          <em>Zähleremulation</em> (ein Messgerät nachbilden und einem Speicher
          ein Regelsignal liefern) oder <em>Datenbereitstellung für ein externes
          HEMS</em> (ausgewählte Größen per MQTT an ein anderes System liefern).
          So entsteht ein offenes System, das sich an die jeweilige Anlage
          anpasst statt umgekehrt.
        </p>
      </section>

      <section className="card">
        <h3>Wirtschaftliche Auswertung</h3>
        <p>
          Über die reine Energiebilanz hinaus bewertet das Tool die{" "}
          <strong>ökonomischen Effekte</strong>. Dabei werden verschiedene
          rechtliche und tarifliche Rahmenbedingungen berücksichtigt, die im
          Folgenden kurz erklärt sind:
        </p>
        <p>
          <strong>EEG-Modelle (Einspeisevergütung):</strong> Das
          Erneuerbare-Energien-Gesetz regelt, welche Vergütung man für ins Netz
          eingespeisten PV-Strom erhält. Das Tool kennt sowohl die Regelung vor dem
          25.&nbsp;Februar 2025 (feste Vergütung je kWh) als auch die neuere
          Regelung ab diesem Datum, bei der für Anlagen über 2&nbsp;kWp keine
          Vergütung gezahlt wird, solange der Börsenstrompreis negativ ist.
        </p>
        <p>
          <strong>Stromtarife:</strong> Sowohl feste Arbeitspreise als auch
          dynamische, börsenpreisabhängige Tarife werden unterstützt. Bei
          dynamischen Tarifen wird für jede Viertelstunde der tatsächliche
          Börsenpreis zuzüglich der festen Preisbestandteile herangezogen.
        </p>
        <p>
          <strong>§14a EnWG:</strong> Dieser Paragraph betrifft steuerbare
          Verbrauchseinrichtungen (z.&nbsp;B. Wärmepumpen, Wallboxen,
          Batteriespeicher). Als Gegenleistung dafür, dass der Netzbetreiber diese
          Anlagen bei einem Netzengpass drosseln darf, gewährt er ein reduziertes
          Netzentgelt – wahlweise als pauschale jährliche Reduktion
          (Modul&nbsp;1) oder – zusätzlich zu Modul&nbsp;1 – als zeitvariable
          Netzentgelte (Modul&nbsp;3).
        </p>
        <div className="hilfe-subblock">
          <p className="hilfe-subblock-title">
            §14a Modul&nbsp;3 – zeitvariable Netzentgelte im Detail
          </p>
          <p>
            Statt eines konstanten Netzentgelts gelten hier über den Tag verteilt{" "}
            <strong>drei Preisstufen</strong>: eine günstige{" "}
            <em>Niedriglaststufe</em>, die reguläre <em>Standardstufe</em> und eine
            teurere <em>Hochlaststufe</em>. Die Höhe des Netzentgelts hängt also von
            der Uhrzeit ab: In der Hochlastzeit (typischerweise am frühen Abend,
            wenn das Netz stark belastet ist) ist das Entgelt am höchsten, nachts in
            der Niedriglastzeit am niedrigsten. Wer seinen flexiblen Verbrauch
            (Laden, Heizen) in günstige Fenster verschiebt, spart entsprechend.
          </p>
          <p>
            Welche Zeitfenster für Hoch- und Niedriglast gelten und wie hoch die
            jeweiligen Entgelte sind, legt jeder Netzbetreiber selbst in seinem
            Preisblatt fest – die Werte unterscheiden sich daher regional deutlich.
            Zudem können sich die Fenster je Quartal unterscheiden: Das zeitvariable
            Netzentgelt muss in mindestens zwei Quartalen eines Jahres greifen; seit
            2026 fahren allerdings fast alle Netzbetreiber einen ganzjährigen Ansatz
            mit allen drei Stufen in jedem Quartal. Das Tool bildet die Zeitfenster
            deshalb quartalsweise konfigurierbar ab und wählt für jede Viertelstunde
            automatisch die passende Stufe.
          </p>
          <p>
            Die im Auslieferungszustand eingetragenen Beispielwerte entsprechen der
            Umsetzung der <strong>EWE&nbsp;NETZ GmbH für 2026</strong>: Hochlaststufe
            5,62&nbsp;ct/kWh (täglich 16:30–20:30&nbsp;Uhr), Standardstufe
            3,20&nbsp;ct/kWh, Niedriglaststufe 0,32&nbsp;ct/kWh (nachts
            23:00–05:00&nbsp;Uhr), ganzjährig in allen Quartalen. Sie sind im eigenen
            Betrieb an das Preisblatt des eigenen Netzbetreibers anzupassen und unter{" "}
            <a
              href="https://www.ewe-netz.de/-/media/ewe-netz/downloads/2026_02_24_ewe_netz_nne_strom_2026.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              ewe-netz.de (Netzentgelte Strom 2026, PDF)
            </a>{" "}
            abrufbar.
          </p>
        </div>
        <p>
          <strong>§42c EnWG (Energy Sharing):</strong> Dieser Paragraph ermöglicht
          es, selbst erzeugten Überschussstrom nicht nur klassisch ins Netz
          einzuspeisen, sondern direkt mit anderen Haushalten in der Nachbarschaft
          zu teilen. Für diesen geteilten Strom kann eine andere – im günstigen
          Fall höhere – Vergütung vereinbart werden als die klassische
          Einspeisevergütung. Das Tool bildet dieses Teilen ab, verteilt den
          Überschuss je Zeitfenster auf die Abnehmer und weist aus, welchen
          finanziellen Vorteil das gegenüber der klassischen Einspeisung bringt.
        </p>
      </section>

      <section className="card">
        <h3>Integrierte Simulation</h3>
        <p>
          Nicht immer sind schon alle Geräte real angebunden. Für diesen Fall ist
          in Teilen eine <strong>Simulation</strong> integriert: Über
          Lastprofile (typische Verbrauchsverläufe) und Erzeugerprofile (typische
          PV-Erzeugungsverläufe) lassen sich Geräte nachbilden, die physisch noch
          nicht vorhanden oder noch nicht eingebunden sind. Das erlaubt{" "}
          <strong>Betrachtungen zukünftiger Szenarien</strong> und
          „Was-wäre-wenn"-Analysen – etwa die Frage, wie sich ein zusätzlicher
          Verbraucher, eine größere PV-Anlage oder ein weiterer Sharing-Abnehmer
          auf Bilanz und Wirtschaftlichkeit auswirken würde, bevor man
          tatsächlich investiert.
        </p>
      </section>

      <section className="card">
        <h3>Zeitliche Auflösung</h3>
        <p>
          Die Energiebilanzen werden <strong>viertelstundengenau</strong> geführt
          – dieselbe Auflösung, die auch im Energiemarkt und bei dynamischen
          Tarifen maßgeblich ist. Daraus ergeben sich Tages-, Monats- und
          Jahresauswertungen. Für Geräte mit besonders schnellen Vorgängen, etwa
          die Wärmepumpe, werden die Messwerte zusätzlich im deutlich feineren
          Abfrageintervall (im Sekundenbereich) aufgezeichnet, sodass sich auch
          kurzzeitige Details wie Abtauzyklen nachvollziehen lassen. Die
          Live-Übersicht aktualisiert sich fortlaufend und zeigt den aktuellen
          Zustand der gesamten Anlage.
        </p>
      </section>
    </div>
  );
}

export function HilfeKonfigurationPage() {
  return (
    <div className="page hilfe-page">
      <h2>Konfiguration</h2>
      <p className="hint">
        Alle Einstellungen finden sich im Menübereich „Einstellungen". Dieser
        Abschnitt erklärt, welche Konfigurationsmöglichkeiten es gibt und wann man
        sie einsetzt.
      </p>

      <section className="card">
        <h3>Quellen</h3>
        <p>
          Unter <strong>Quellen</strong> definierst du jedes Gerät, das Daten
          liefert. Je Quelle wählst du zunächst die <strong>Anbindung</strong>:
          Bei <strong>REST-API</strong> gibst du die URL an, unter der die Daten
          als JSON abgerufen werden; ist der Endpunkt geschützt, kann optional ein
          <strong> Bearer-Token</strong> als Authentifizierung mitgesendet werden.
          Bei <strong>MQTT</strong> gibst du Broker-URL und Topic an – die zuletzt
          empfangene Nachricht wird ausgewertet; als Authentifizierung stehen
          anonym, Benutzername/Passwort oder ein TLS-Client-Zertifikat zur
          Auswahl. In beiden Fällen definierst du je Messwert einen JSON-Pfad, der
          bestimmt, welcher Wert aus der Geräteantwort gelesen wird, samt Einheit
          und Umrechnungsfaktor. Liefert ein MQTT-Topic nur eine einzelne Zahl,
          erreichst du sie über den Pfad <code>value</code>. Für AC-Speicher gibt
          es zusätzlich zwei protokollspezifische Anbindungen (UDP und Modbus
          TCP), die im Anschluss an die Rollenübersicht im Detail beschrieben
          sind. Mit der Testfunktion prüfst du, ob Anbindung und Pfade
          zusammenpassen.
        </p>
        <p className="hint">
          Jede Quelle lässt sich über das Dreieck links in der Kopfzeile{" "}
          <strong>ein- und ausklappen</strong>; standardmäßig sind alle Quellen
          eingeklappt, damit die Liste übersichtlich bleibt. Über die{" "}
          <strong>Schnellauswahl</strong> oben springst du direkt zu einer Quelle –
          sie wird dabei automatisch aufgeklappt und kurz hervorgehoben. Dasselbe
          Ein-/Ausklappen gibt es auch auf der Senkenseite.
        </p>

        <p>
          Entscheidend ist die <strong>Rolle</strong> einer Quelle – sie legt
          fest, wie ihre Werte in Bilanz und Auswertung eingehen:
        </p>
        <ul className="hilfe-list">
          <li>
            <strong>Netz (Bezug/Einspeisung):</strong> der Zweirichtungszähler am
            Netzanschluss. Er liefert die Grundlage für Netzbezug, Einspeisung,
            Kosten und Autarkie. Drei Kernwerte werden dafür benötigt: die
            Momentanleistung (Metrik <code>power</code>), der Bezugszähler
            (<code>gridInTotal</code>, kumulierte kWh) und der Einspeisezähler
            (<code>gridOutTotal</code>, kumulierte kWh). Aus den beiden
            Zählerständen werden per Differenzbildung die Tages-, Monats- und
            Jahreswerte gebildet; die Leistung liefert den Live-Wert auf der
            Übersicht.
            <br /><br />
            Diese drei Kernwerte <strong>müssen vorhanden</strong> sein, dürfen
            aber auf <strong>mehrere aktive Netz-Quellen verteilt</strong> sein.
            Es ist also nicht mehr auf genau eine Netz-Quelle beschränkt –
            entscheidend ist nur, dass jeder einzelne Kernwert von{" "}
            <strong>genau einer</strong> aktiven Quelle kommt (sonst würde er sich
            in der Bilanz doppelt aufsummieren). So kann z.&nbsp;B. ein Zähler die
            genauen Zählerstände liefern und ein zweites, schnelleres Messgerät
            die Momentanleistung – beide mit der Rolle „Netz". Liefert eine Quelle
            einen Kernwert nicht (oder soll ihn nicht beisteuern), stellt man das
            betreffende Feld auf die Metrik <code>info</code>; es wird dann nur
            angezeigt, aber nicht in die Bilanz übernommen.
            <br /><br />
            Alternativ lassen sich zwei Netz-Quellen auch{" "}
            <strong>verlinken</strong>: Über „Leistung von separater Quelle" kann
            eine Zähler-Quelle die Momentanleistung von einer anderen (z.&nbsp;B.
            einem schnellen Leistungsmesser) übernehmen. Die verknüpfte Quelle
            wird dann nicht separat gezählt, und ihre Werte erscheinen auf der
            Statusseite integriert bei der Hauptquelle. Beide Wege führen zum
            selben Ziel – die Verteilung über zwei gleichwertige Netz-Quellen ist
            meist die einfachere Variante.
          </li>
          <li>
            <strong>PV-Erzeugung:</strong> ein Wechselrichter bzw. PV-Strang.
            Liefert die erzeugte Leistung und den Gesamtertrag; mehrere
            PV-Quellen werden zur Gesamterzeugung summiert.
          </li>
          <li>
            <strong>Batterie-Einspeisung (Entladung):</strong> die Leistung, die
            der Speicher ins Haus abgibt – zählt als Eigenverbrauch aus dem
            Speicher.
          </li>
          <li>
            <strong>Batterie-Netzladung:</strong> Strom, mit dem der Speicher
            gezielt aus dem Netz geladen wird (z.&nbsp;B. zu günstigen
            Börsenzeiten) – wird gesondert berücksichtigt.
          </li>
          <li>
            <strong>AC-Batterie (AC-Speicher):</strong> ein wechselstromseitig
            angebundener Batteriespeicher, der je nach Betrieb lädt oder entlädt.
            Anders als die beiden Batterie-Rollen oben, die jeweils nur eine
            Flussrichtung abbilden, deckt diese Rolle beide Richtungen über eine
            einzige Quelle ab (positive Leistung = Netzladung, negative =
            Einspeisung ins Haus); beide Energiemengen werden getrennt erfasst.
            Für AC-Speicher gibt es zusätzlich zu REST/MQTT zwei
            protokollspezifische Anbindungen (UDP&nbsp;/&nbsp;Modbus&nbsp;TCP) mit
            automatischer Werteauslesung und – je nach Protokoll – Ansteuerung.
            Details siehe eigene Seite <strong>Speicher</strong> im Menü.
          </li>
          <li>
            <strong>DC-Batterie (DC-Speicher):</strong> ein gleichstromseitig
            gekoppelter Speicher (z. B. Laderegler + Wechselrichter in
            Eigenbau), der selbst keine eigene Messschnittstelle hat. Statt
            eigener Abfrage verweist diese Rolle auf bereits vorhandene Quellen:
            eine <em>PV-Quelle</em> für die Ladung (optional – etwa wenn der
            Laderegler nicht auslesbar ist), eine <em>Batterie-Einspeisung</em>
            für die Entladung und optional ein <em>AC-Ladegerät</em>. Anbindung,
            URL, Authentifizierung sowie Intervall/Timeout entfallen, da keine
            eigenen Daten abgefragt werden – alle Werte stammen aus den
            verknüpften Quellen. Ist eine der verknüpften Quellen schaltbar,
            erscheint ihr Ein/Aus-Schalter automatisch auf der Speicher-Seite.
            Der DC-Speicher zählt nicht doppelt in die Energiebilanz, da die
            verknüpften Quellen bereits erfasst werden. Details siehe eigene
            Seite <strong>Speicher</strong> im Menü.
          </li>
          <li>
            <strong>Verbraucher:</strong> ein einzelnes Gerät (Wärmepumpe, E-Auto,
            Klimaanlage, Haushaltsgeräte …). Erscheint auf der Verbraucherseite
            mit Momentanleistung und Tagesverbrauch.
          </li>
          <li>
            <strong>Netz §42c:</strong> der Zähler eines externen Haushalts
            (Nachbarn), der am Energy Sharing teilnimmt. Aus diesen Quellen leitet
            das Tool automatisch die §42c-Abnehmer ab.
          </li>
          <li>
            <strong>Emulation (Netz / §42c-Netz):</strong> wie die jeweilige
            Netzrolle, aber ohne reales Gerät – die Werte kommen aus einem
            Last-/Erzeugerprofil des Simulators. Für noch nicht angebundene oder
            hypothetische Anschlüsse.
          </li>
          <li>
            <strong>Hilfswert / Info:</strong> ein Wert ohne direkte
            Bilanzwirkung – nutzbar in Formeln/Berechnungen und als reiner
            Anzeigewert (z. B. Temperaturen, Ladezustände, Referenzleistungen).
            (Früher zwei getrennte Rollen „Hilfswert" und „Info"; jetzt vereint.)
          </li>
          <li>
            <strong>Warmwasserspeicher-Temperaturen:</strong> genau zwei
            Temperatur-Werte (oben und unten), die auf der Übersichtsseite am
            Warmwasserspeicher angezeigt werden. Nur wenn eine Quelle dieser Rolle
            existiert, erscheinen dort Speichertemperaturen – andernfalls bleiben
            sie ausgeblendet.
          </li>
        </ul>

        <div className="hilfe-subblock">
          <h4>Schaltbare Ausgänge: automatische Erkennung</h4>
          <p>
            Quellen, die einen schaltbaren Ausgang haben (Shelly-Steckdosen und
            -Relais, Tasmota-Geräte), lassen sich in der Quellen-Konfiguration
            als <strong>schaltbar</strong> markieren und mit einer Kanalzahl
            versehen. Dieses Häkchen legt fest, <em>ob</em> eine Quelle geschaltet
            werden kann – etwa als Schaltziel einer Automatisierungsregel oder als
            Schalter auf der Speicher-Seite. <em>Wie</em> geschaltet wird, erkennt
            das Tool selbstständig anhand der hinterlegten Adresse:
          </p>
          <ul className="hilfe-list">
            <li>
              <strong>Shelly:</strong> Beim Schalten werden automatisch beide
              Protokoll-Generationen versucht – zuerst die neuere RPC-Schnittstelle
              (Gen&nbsp;2/3, <code>/rpc/Switch.Set</code>), dann als Rückfall die
              ältere Gen&nbsp;1-Schnittstelle (<code>/relay/&lt;kanal&gt;</code>).
              Dadurch funktionieren Shelly-Geräte aller Generationen ohne weitere
              Einstellung; der aktuelle Ein/Aus-Zustand wird über dieselben Wege
              ausgelesen.
            </li>
            <li>
              <strong>Tasmota:</strong> Tasmota-Geräte werden am typischen
              Kommando-Endpoint in der Abfrage-Adresse erkannt
              (<code>/cm?cmnd=…</code>). Geschaltet wird dann mit dem
              Tasmota-Befehl <code>Power&nbsp;On</code> bzw. <code>Power&nbsp;Off</code>
              (bei mehreren Kanälen <code>Power1</code>, <code>Power2</code> …),
              der Zustand wird über <code>Power</code> abgefragt
              (Antwort <code>ON</code>/<code>OFF</code>).
            </li>
          </ul>
          <p>
            Die Basis-Adresse zum Schalten wird aus der Abfrage-URL der Quelle
            abgeleitet; alternativ kann in der Quellen-Konfiguration eine
            abweichende Schalt-URL hinterlegt werden. Damit ein Tasmota-Gerät
            automatisch als solches erkannt wird, sollte seine Abfrage-Adresse das
            Muster <code>/cm?cmnd=…</code> enthalten (z.&nbsp;B.
            <code>status&nbsp;10</code>). Wird eine schaltbare Quelle nicht als
            Tasmota erkannt, behandelt das Tool sie als Shelly.
          </p>
        </div>

        <div className="hilfe-subblock">
          <h4>AC-Speicher: unterstützte Protokolle und Modelle</h4>
          <p>
            Batteriespeicher mit der Rolle <strong>AC-Batterie</strong> (siehe
            oben) können auf vier Wegen angebunden werden. Welcher Weg möglich ist,
            hängt vom Speicher und seiner Firmware ab:
          </p>
          <ul className="hilfe-list">
            <li>
              <strong>UDP (lokale API)</strong> – die herstellereigene lokale
              Schnittstelle von <strong>Marstek Venus C, D und E</strong>. Es
              werden alle vom Gerät gelieferten Werte automatisch ausgelesen
              (Ladezustand, Batterie-, Netz- und PV-Leistung, Temperatur,
              momentane und nominale Kapazität, Betriebsmodus, Energiezähler,
              Geräteinfos). <strong>Ansteuerung:</strong> ja – Umschalten der
              Betriebsmodi Auto, KI, Manuell und Passiv sowie Vorgabe von
              Leistung und Dauer (je nach Firmware).
            </li>
            <li>
              <strong>Modbus TCP</strong> – offener Feldbus-Standard (Port 502),
              den Marstek je nach Modell/Firmware nativ oder über einen
              RS485-zu-WLAN-Adapter bereitstellt. Unterstützte Speichermodelle:
              <ul className="hilfe-list">
                <li>
                  <strong>Marstek Venus A / D / E (Generation 3)</strong> – diese
                  drei teilen sich dieselbe Registerbelegung und sind daher als
                  eine Auswahl zusammengefasst.
                </li>
                <li>
                  <strong>Marstek Venus E (Generation 1/2)</strong> – ältere
                  Registerbelegung, als eigenes Modell wählbar.
                </li>
                <li>
                  <strong>Anker Solix (Max AC / Solarbank 4 E5000 Pro)</strong> –
                  nutzt denselben „M1"-Registersatz wie Marstek und wird darüber
                  gelesen und gesteuert. In der Anker-App unter Einstellungen →
                  Drittanbieter-Steuerung „Modbus TCP" aktivieren (Port 502).
                </li>
              </ul>
              Ausgelesen werden Batterieleistung, Ladezustand, Spannung, Strom,
              Temperatur, AC-Leistung und die Energiezähler (geladen/entladen
              gesamt). <strong>Ansteuerung:</strong> ja – erzwungenes Laden oder
              Entladen mit einstellbarer Leistung und Ziel-Ladezustand, Rückgabe
              an die Automatik sowie Schalten der Backup-/Notstromfunktion. Für
              Schreibzugriffe wird der Speicher automatisch in den
              RS485-Steuermodus versetzt.
            </li>
            <li>
              <strong>MQTT mit Zendure-Steuerung</strong> – für{" "}
              <strong>Zendure SolarFlow</strong>. Das Monitoring läuft wie bei jeder
              MQTT-Quelle über die empfangenen Telemetrie-Werte (Feld-Pfade selbst
              definieren). Zusätzlich lässt sich – wenn App-Key und Seriennummer
              hinterlegt sind – die <strong>Lade-/Entladeleistung steuern</strong>:
              FLUX sendet MQTT-Properties (acMode, outputLimit, inputLimit) an
              das Zendure-Write-Topic. Voraussetzung ist, dass der Speicher mit
              demselben lokalen Broker verbunden ist (Zendure lokal betreiben, z.&nbsp;B.
              via DNS-Umleitung oder zenSDK). <strong>Ansteuerung:</strong> ja –
              Laden/Entladen mit Leistung, Ruhe.
            </li>
            <li>
              <strong>REST-API</strong> und <strong>MQTT (generisch)</strong> –
              Anbindung eines beliebigen AC-Speichers, dessen Leistung z.&nbsp;B.
              über einen zwischengeschalteten Shelly oder ein eigenes MQTT-Topic
              gemessen wird. Hier definierst du die Datenfelder per JSON-Pfad
              selbst. <strong>Ansteuerung:</strong> nein – reines Monitoring.
            </li>
          </ul>
          <p>
            Sobald mindestens ein AC-Speicher aktiv ist, erscheint im Menü unter{" "}
            <em>Details</em> die Seite <strong>Speicher</strong>. Dort werden
            alle aktiven Speicher mit ihren passend ausgelesenen Werten angezeigt
            und – soweit das Protokoll es zulässt – direkt angesteuert.
          </p>
          <p>
            <strong>Wirkungsgrad &amp; Speicherverluste.</strong> Am unteren Ende
            der Speicher-Seite stellt eine Auswertung je Speicher die{" "}
            <em>eingespeicherte</em> der <em>zurückgewonnenen</em> Energie
            gegenüber – wählbar ab einem Stichtag und wahlweise je Tag oder je
            Monat. Daraus werden <strong>Wirkungsgrad</strong> (Anteil der
            zurückgewonnenen Energie) und <strong>Verlust</strong> ausgewiesen, als
            Summe über den Zeitraum und je Periode. Grundlage sind die
            viertelstündlich erfassten Energiemengen. Voraussetzung ist, dass beim
            jeweiligen Speicher sowohl Ladung als auch Entladung messbar sind; bei
            einem DC-Speicher etwa muss dazu auch die Solar-Einspeicherung
            verknüpft sein – fehlt sie, wird der Speicher als „nicht auswertbar"
            gekennzeichnet. Da die dafür nötigen Verläufe erst ab der Einrichtung
            gesammelt werden, wählt man den Stichtag am besten auf einen Tag, ab dem
            durchgängig aufgezeichnet wurde.
          </p>
          <p className="hilfe-hinweis">
            Hinweis zu Modbus: Die Registeradressen beruhen auf einer
            Community-Referenz und sind nicht offiziell von Marstek bestätigt.
            Besonders bei Venus&nbsp;E kann sich die Belegung zwischen den
            Generationen unterscheiden. Schreibzugriffe greifen direkt in den
            Speicherbetrieb ein – am realen Gerät zunächst vorsichtig mit kleinen
            Werten testen.
          </p>
        </div>
        <p>
          <strong>Zwei Quellen für ein Gerät.</strong> Manchmal liefern zwei
          Geräte Daten zum selben Verbraucher – etwa eine Wärmepumpe, deren
          Betriebsdaten über HeishaMon kommen, deren Leistungsaufnahme aber ein
          separater Shelly misst. Da eine Quelle immer genau einer Datenquelle
          entspricht, legt man dafür <strong>zwei Quellen</strong> an: eine für die
          Betriebsdaten (mit der eigentlichen Geräterolle, z.&nbsp;B. Verbraucher/
          Wärmepumpe) und eine für die Leistung (der Shelly). In der
          Konfiguration der Hauptquelle wählt man dann unter „Leistung von
          separater Quelle" die Shelly-Quelle aus. Die Hauptquelle übernimmt damit
          deren Leistungswert, und die Shelly-Quelle wird nicht mehr als eigenes
          Gerät gewertet (keine Doppelzählung). So bleibt die klare Bedeutung
          „eine Quelle = eine Datenquelle" erhalten, und die Zusammengehörigkeit
          ist eindeutig hinterlegt.
        </p>
      </section>

      <section className="card">
        <h3>PV-Anlagendaten</h3>
        <p>
          Unter <strong>Einstellungen → PV Anlagendaten</strong> hinterlegst du
          die technischen Stammdaten deiner PV-Anlagen und erhältst daraus eine
          Ertragsprognose für heute und morgen. Die Seite ist unabhängig von der
          Bilanz – sie dient der Planung und Vorschau, nicht der Abrechnung.
        </p>
        <p>
          Da alle PV-Anlagen am selben Ort stehen, wird der{" "}
          <strong>Standort</strong> nur einmal zentral im Block{" "}
          <strong>Standortinformationen</strong> gepflegt (nicht mehr je Anlage).
          Dort lässt sich der Standort auf einer{" "}
          <strong>OpenStreetMap-Karte</strong> festlegen: entweder über die{" "}
          <strong>Adresssuche</strong> (Straße, PLZ, Ort) oder indem du die{" "}
          <strong>Stecknadel</strong> direkt auf der Karte setzt bzw. verschiebst.
          Daraus werden Breiten- und Längengrad ermittelt und für die
          Ertragsprognose verwendet.
        </p>
        <p>
          Du legst beliebig viele <strong>Anlagen</strong> an und ordnest per{" "}
          <strong>Drag&amp;Drop</strong> die Quellen mit der Rolle
          „PV-Erzeugung" zu, die zu dieser Anlage gehören. Eine Quelle gehört zu
          genau einer Anlage; nicht zugeordnete Quellen liegen im Pool oben zum
          Hineinziehen.
        </p>
        <p>
          Jede Anlage besteht aus einem oder mehreren <strong>Strings</strong>
          (durchnummeriert, einzeln hinzufüg- und löschbar). Je String erfasst du
          die <strong>Anzahl der Module</strong> und die{" "}
          <strong>Modulleistung</strong> in Wp – daraus wird die
          String-Leistung in kWp automatisch berechnet und über alle Strings zur
          Anlagenleistung summiert. Dazu kommen die{" "}
          <strong>Ausrichtung</strong> als Gradzahl (−90 = Ost, 0 = Süd, 90 =
          West, ±180 = Nord; die Himmelsrichtung wird als Hilfe eingeblendet) und
          der <strong>Aufstellwinkel/die Neigung</strong> gegenüber der
          Horizontalen (0 = flach, 90 = senkrecht).
        </p>
        <p>
          Mit <strong>Prognose abrufen</strong> wird über den Dienst{" "}
          <strong>forecast.solar</strong> je String eine Vorhersage geholt und
          serverseitig zur Anlagen- bzw. Gesamtsumme zusammengefasst. Angezeigt
          werden der prognostizierte <strong>Tagesertrag heute</strong>, der{" "}
          <strong>verbleibende Ertrag heute</strong> und der{" "}
          <strong>Ertrag morgen</strong> – jeweils gesamt und je Anlage – sowie
          ein <strong>gestapeltes Balkendiagramm</strong> des Leistungsverlaufs
          über beide Tage. Voraussetzung ist ein hinterlegter Standort und
          mindestens ein String mit Leistung; ist forecast.solar nicht
          erreichbar, wird der Grund je Anlage angezeigt.
        </p>
        <p>
          Die Prognose wird <strong>stündlich automatisch</strong> vom Server
          abgerufen und gespeichert; der Knopf <strong>Prognose abrufen</strong>
          erzwingt eine sofortige Aktualisierung samt Aufschlüsselung je Anlage.
          Jeder inhaltlich veränderte Abruf wird als <strong>eigener Stand</strong>{" "}
          gespeichert, sodass innerhalb eines Tages eine Historie der eingegangenen
          Prognosen entsteht. Weil die Prognose persistiert wird, bleibt sie nach
          einem Seiten- oder Serverneustart erhalten.
        </p>
        <p>
          Die Prognose wird <strong>je Anlage</strong> gespeichert. Das Diagramm
          auf der PV-Anlagenseite zeigt stets <strong>zwei Tage</strong>
          nebeneinander (gewählter Tag und Folgetag), gestapelt je Anlage; die
          Datumsnavigation blättert tageweise auch in zurückliegende Prognosen.
          Über den Schalter lässt sich zwischen <strong>kWh</strong> und
          <strong> mittlerer Leistung (W)</strong> umschalten; beide Achsen sind
          beschriftet.
        </p>
        <p>
          <strong>Prognose-Verlauf (Schieberegler).</strong> Unter dem Diagramm
          erscheint – sobald für einen Tag mehrere Stände vorliegen – ein
          Schieberegler, mit dem sich der <strong>Verlauf des ersten Tages</strong>{" "}
          durchblättern lässt: So sieht man, wie sich die Prognose im Lauf des Tages
          verändert hat. Der Regler rastet an den <strong>tatsächlichen
          Uhrzeiten</strong> der eingegangenen Prognosen ein. Gezeigt werden dabei
          nur die <strong>am jeweiligen Tag selbst</strong> eingegangenen Stände –
          für „heute" also nicht die bereits am Vortag für heute abgerufene
          Prognose. Die y-Achse bleibt beim Durchblättern fest auf dem Tagesmaximum,
          damit sich der Maßstab nicht ständig ändert.
        </p>
        <p>
          <strong>Datenquelle.</strong> Die Prognosewerte stammen vom kostenlosen
          Dienst <strong>forecast.solar</strong>. Dieser liefert je Ausrichtung
          eine Vorhersage der Momentanleistung an Stundenstützstellen sowie den
          erwarteten Tagesertrag. FLUX interpoliert die Stundenwerte linear auf das
          Viertelstundenraster und summiert alle Strings bzw. Anlagen. forecast.solar
          basiert auf Wettermodellen und trifft daher nicht immer exakt zu.
        </p>
        <p>
          <strong>„Prognose an reale Produktion anpassen".</strong> Diese
          Einstellung findet sich im Block <strong>Ertragsprognose</strong> auf der
          PV-Anlagenseite. Sie ist <strong>standardmäßig aktiv</strong> und wird
          gespeichert. Ist sie aktiv, wird die Prognose fortlaufend an die
          tatsächlich gemessene Erzeugung angepasst: Aus dem Verhältnis von realem
          zu prognostiziertem Ertrag – gebildet über den bisherigen Tagesverlauf und
          den Vortag, und <strong>nur über Viertelstunden mit tatsächlich erfasster
          Erzeugung</strong> (damit fehlende Messwerte, etwa nach einem Neustart,
          nicht verfälschen) – ergibt sich ein Faktor, der auf den restlichen Tag
          angewandt wird. Der Faktor ist auf <strong>−70 % bis +300 %</strong>
          begrenzt. Der Anpassungsgrad wird kompakt angezeigt (z. B. „+48 %", grün
          bei Mehr-, rot bei Mindererzeugung).
        </p>
        <p>
          Die Anpassung wirkt auf die Rest-Prognose – auch auf der Kachel
          „verbleibend heute" und auf der <strong>Übersichtsseite</strong> – sowie
          auf die gestrichelte Prognoselinie im PV-Tagesverlauf der Seite{" "}
          <strong>Stromerzeugung</strong>. Dort erscheint der aktuelle
          Anpassungsgrad als kurzer Hinweis („… wird die Prognose um xx % skaliert")
          und im Mouseover der prognostizierte Gesamtwert je Viertelstunde. Die
          gestrichelte Linie erstreckt sich über den gesamten Tag.
        </p>
        <p className="hint">
          Hinweis: forecast.solar wird ohne Zugangsschlüssel genutzt. Der
          kostenlose Zugang erlaubt nur eine Ausrichtung pro Abfrage, daher wird
          jeder String einzeln abgefragt und die Ergebnisse werden summiert.
          Abfragen werden kurz zwischengespeichert, um das Anfragelimit zu
          schonen. Schlägt ein Abruf fehl, wird der Grund je Anlage angezeigt und im
          Log (Debugging) vermerkt.
        </p>
      </section>

      <section className="card">
        <h3>Senken</h3>
        <p>
          Eine <strong>Senke</strong> definiert, welche Informationen FLUX{" "}
          <strong>nach außen</strong> an externe Geräte oder Akteure bereitstellt.
          Als ersten Punkt wählst du je Senke eine <strong>Rolle</strong>:
        </p>
        <ul className="hilfe-list">
          <li>
            <strong>Zähleremulation</strong> – FLUX bildet ein reales Messgerät
            nach und liefert einem Speicher ein Regelsignal (die unten
            beschriebene, vollständig ausgebaute Rolle). Typischer Einsatzzweck:
            Die Senke meldet dem Speicher genau den Leistungswert, den er
            ausregeln soll, damit er gezielt so viel entlädt, dass sowohl der
            eigene Hausverbrauch als auch der Bedarf der §42c-Abnehmer gedeckt
            wird.
          </li>
          <li>
            <strong>Datenbereitstellung für externes HEMS</strong> – FLUX
            veröffentlicht ausgewählte Live-Größen per MQTT an einen Broker,
            damit ein anderes Energiemanagementsystem (z. B. das eines
            §42c-Abnehmers) darauf reagieren kann. Du trägst den Broker samt
            Authentifizierung ein (ohne, Benutzer/Passwort oder Client-Zertifikat,
            jeweils mit optionalem CA-Zertifikat), legst beliebig viele{" "}
            <strong>Publish-Topics</strong> an und ordnest jedem Topic per
            Drag&amp;Drop eine oder mehrere Größen zu. Zur Auswahl stehen
            kuratierte Größen (verfügbarer Überschuss, abgebbares Leistungslimit,
            Speicherstand, Batterie-/PV-/Netzleistung, Hausverbrauch, bereitgestellte
            Sharing-Leistung, prognostizierter Rest-PV-Ertrag) sowie eigene
            Formel-Größen, die du aus diesen berechnest. Veröffentlicht wird je
            Topic ein JSON-Objekt (mit Zeitstempel), und zwar nur bei
            Wertänderung; eine einstellbare Schwelle unterdrückt Rauschen. Auf
            Knopfdruck erzeugt FLUX eine verständliche{" "}
            <strong>Schnittstellenbeschreibung</strong>, die du dem Betreiber des
            externen HEMS weitergeben kannst. Mehrere Senken können an
            unterschiedliche Broker liefern.
          </li>
        </ul>
        <p>
          Senken brauchst du also dann, wenn die Anlage nicht nur auswerten,
          sondern ihre Werte auch aktiv nach außen bereitstellen soll – sei es als
          Regelsignal für ein Gerät oder als Datenlieferant für ein externes
          System. Die folgende Beschreibung bezieht sich auf die Rolle{" "}
          <strong>Zähleremulation</strong>.
        </p>
        <p>
          In der Rolle Zähleremulation bildet eine Senke einen{" "}
          <strong>Stromzähler</strong> nach – wahlweise
          einen <strong>Shelly Pro 3EM</strong> (dreiphasig), einen{" "}
          <strong>Shelly Pro EM-50</strong> (einphasig) oder einen{" "}
          <strong>Marstek CT002/CT003</strong>. Viele Batteriespeicher lassen sich
          auf einen solchen Zähler als Messquelle für ihre Nulleinspeise-Regelung
          einbinden; das gilt insbesondere für zahlreiche{" "}
          <strong>Marstek-Speicher</strong>. Der Speicher „sieht" dann den von der
          Senke ausgegebenen Wert wie einen echten Zähler und regelt seine
          Lade-/Entladeleistung danach aus. Die Shelly-Varianten werden lokal per
          Broadcast gefunden (einfachster Weg); die CT-Varianten sprechen Marsteks
          eigenes Protokoll und eignen sich besonders für die Koordination
          mehrerer Speicher (Einrichtung siehe unten).
        </p>
        <p>
          <em>Hinweis:</em> Die weiteren von Marstek unterstützten Zähler (etwa
          HomeWizard&nbsp;P1 oder Eco&nbsp;Tracker) werden bei der Einrichtung per
          Bluetooth gekoppelt bzw. laufen über deren eigene Cloud und lassen sich
          daher nicht sinnvoll emulieren.
        </p>
        <p>
          <strong>Shelly-Erkennung.</strong>{" "}
          Marstek-Speicher finden den Shelly nicht über eine fest eingetragene
          Adresse, sondern per <strong>UDP-Broadcast</strong> im lokalen Netz
          (Port&nbsp;1010, teils 2220). Ist bei einer Senke die{" "}
          <strong>automatische Erkennung</strong> aktiviert, antwortet die Anlage
          auf diese Suchanfragen – im Speicher genügt es dann, den passenden
          Zählertyp auszuwählen und suchen zu lassen. Alternativ steht die direkte
          URL bereit, falls ein Gerät eine feste Adresse erlaubt.
        </p>
        <p className="hilfe-hinweis">
          <strong>Physischen und emulierten Zähler trennen.</strong> Betreibst du
          gleichzeitig einen echten Shelly und diese Emulation am selben Speicher,
          entsteht ein Problem: Beide antworten auf denselben Suchruf, und die
          Marstek-App übernimmt einfach den ersten Treffer, ohne Auswahl. Abhilfe
          schafft der einstellbare <strong>emulierte Zählertyp</strong>: Marstek
          fragt den Pro 3EM und den Pro EM-50 mit unterschiedlichen Methoden ab
          (dreiphasig bzw. einphasig), und die Emulation antwortet nur auf die zum
          eingestellten Typ passende Anfrage. Wählst du für die Emulation den{" "}
          <em>anderen</em> Typ als beim physischen Zähler und in der App genau
          diesen Typ, reagiert jeweils nur ein Zähler – beide sind damit sauber
          getrennt.
        </p>

        <div className="hilfe-subblock">
          <h4>CT002/CT003 emulieren (für Fortgeschrittene)</h4>
          <p>
            Neben den Shelly-Typen kann eine Senke auch einen{" "}
            <strong>Marstek CT002</strong> (dreiphasig) oder{" "}
            <strong>CT003/P1</strong> (einphasig) nachbilden – Marsteks eigenen
            Zähler. Das ist vor allem dann interessant, wenn du{" "}
            <strong>mehrere Speicher koordinieren</strong> willst, denn über das
            CT-Protokoll teilt sich die Anlage ein gemeinsames Regelziel.
          </p>
          <p>
            Wichtiger Unterschied zum Shelly: Der CT wird <strong>nicht</strong>{" "}
            per Broadcast gefunden, sondern über eine feste Geräte-Identität
            (CT-MAC), die einmalig in der Marstek-Cloud{" "}
            <strong>registriert</strong> sein muss. Diese Registrierung nimmt das
            FLUX jetzt direkt vor – du brauchst kein externes Werkzeug mehr. Sie
            läuft so ab:
          </p>
          <ol className="hilfe-list">
            <li>
              Bei der Senke den Zählertyp auf <strong>CT002</strong> (HME-4) oder{" "}
              <strong>CT003</strong> (HME-3) stellen. Es erscheint der Block{" "}
              <em>„CT in Marstek-Cloud registrieren"</em>.
            </li>
            <li>
              Dort einmalig deine <strong>Marstek-Zugangsdaten</strong> (E-Mail +
              Passwort) eintragen und auf <em>Registrieren</em> klicken. FLUX
              legt daraufhin ein „verwaltetes" Fake-CT-Gerät in deinem
              Marstek-Konto an und erzeugt dafür selbst eine{" "}
              <strong>CT-MAC</strong> – du musst nichts eingeben. Nach dem Vorgang
              werden die Zugangsdaten sofort verworfen und{" "}
              <strong>nicht gespeichert</strong>.
            </li>
            <li>
              Nach erfolgreicher Registrierung prüft FLUX automatisch, ob das
              Gerät in der Cloud angekommen ist, und übernimmt die CT-MAC in die
              Senke. Existiert bereits ein passendes CT, wird es erkannt und kein
              zweites angelegt.
            </li>
            <li>
              In der Marstek-App die CT-Geräteliste aktualisieren (ggf. ab- und
              wieder anmelden). Das neue CT erscheint – als „offline", das ist
              normal. Optional die <strong>MAC deines Speichers</strong> aus der
              App-Geräteverwaltung bei der Senke eintragen (für Sonderdaten in
              Mehrspeicher-Setups).
            </li>
            <li>
              Im Speicher (App) den neuen CT als Zähler auswählen und den
              Betriebsmodus auf automatisch stellen. FLUX beantwortet ab jetzt
              die Abfragen des Speichers lokal auf UDP-Port&nbsp;12345 mit dem
              berechneten Sollwert.
            </li>
          </ol>
          <p className="hilfe-hinweis">
            Deine Marstek-Cloud-Zugangsdaten werden nur für den einmaligen
            Registrierungsschritt verwendet und <strong>nicht</strong> gespeichert
            (weder in der Senke noch in einem Log). Danach betreibt FLUX
            ausschließlich die lokale Zähler-Emulation. Das CT-Protokoll und die
            Cloud-Registrierung beruhen auf Community-Reverse-Engineering und sind
            nicht offiziell von Marstek dokumentiert; bei Firmware- oder
            Cloud-Änderungen kann eine Anpassung nötig werden.
          </p>
        </div>

        <div className="hilfe-subblock">
          <h4>Mehrere Speicher: Lastverteilung &amp; Grenzen</h4>
          <p>
            Sind über eine CT-Senke <strong>mehrere AC-Speicher</strong>{" "}
            gekoppelt, teilt FLUX das gemeinsame Regelziel gewichtet auf sie
            auf, sodass sie zusammen die Netzabweichung ausregeln, statt sich
            gegenseitig hochzuschaukeln. Bei gleicher Gewichtung übernimmt zunächst
            jeder Speicher den gleichen Anteil.
          </p>
          <p>
            Erreicht ein Speicher seine <strong>technische Leistungsgrenze</strong>{" "}
            (er folgt einem höheren Ziel nicht mehr, weil z.&nbsp;B. sein Maximum
            bei 1200&nbsp;W liegt), erkennt FLUX diese{" "}
            <strong>Sättigung</strong> und gibt die frei werdende Leistung an die
            übrigen, noch nicht ausgelasteten Speicher weiter. Ein Speicher mit
            mehr Reserve übernimmt dann den größeren Anteil, damit ein vorhandener
            Überschuss möglichst vollständig gespeichert und nicht ins Netz
            eingespeist wird. Lässt die Aufnahme eines Speichers gegen Ende des
            Ladens nach (Speicher wird voll), wird die erkannte Grenze automatisch
            angepasst; sinkt der Überschuss so weit, dass keine Grenze mehr im Weg
            ist, teilen die Speicher wieder gleichmäßig. Das geschieht selbsttätig –
            es ist keine Einstellung nötig.
          </p>
          <p>
            Die <strong>Gewichtung ist ein Richtwert, kein hartes Limit</strong>.
            Kann ein Speicher seinen Anteil nicht liefern – etwa weil er{" "}
            <strong>leer</strong> ist oder in der Leistung begrenzt –, übernimmt ein
            anderer, dazu fähiger Speicher den Rest, auch über seinen eigenen
            „fairen" Anteil hinaus. Ist die benötigte Gesamtleistung höher als das,
            was ein Speicher bisher als Grenze kannte, während der andere gerade
            nichts beitragen kann, <strong>tastet</strong> FLUX die Grenze
            schrittweise nach oben, bis der Bedarf gedeckt ist oder der Speicher
            wirklich an seine physische Grenze stößt. So bleibt ein einzelner leerer
            Speicher nicht fälschlich der Flaschenhals für den anderen.
          </p>
          <p>
            <strong>Ruhiges Regeln um den Nullpunkt.</strong> Damit die Speicher
            nicht ständig um die Nulleinspeisung pendeln, gibt es mehrere
            Dämpfungen (auf der Senkenseite einstellbar): <em>Max. Schritt / Poll</em>{" "}
            begrenzt die Änderung je Abfrage, das <em>Totband um 0</em> beruhigt den
            Nullpunkt, und die <em>Umverteilung zwischen Speichern</em>{" "}
            (Umverteilungs-Schritt + Toleranzband) sorgt dafür, dass das Angleichen
            ins gewünschte Verhältnis langsam und ohne Gegeneinander-Schaukeln
            geschieht, während echte Laständerungen weiterhin zügig ausgeregelt
            werden. Zusätzlich unterdrückt eine <em>Frische-Prüfung</em> ein
            erneutes Nachregeln, solange der Netzzähler noch keinen neuen Messwert
            geliefert hat – der Speicher überschwingt so nicht auf einem veralteten
            Wert.
          </p>
          <p className="hilfe-hinweis">
            <strong>Sicherheit bei fehlender Netzmessung.</strong> Die CT-Regelung
            braucht den aktuellen Wert des Netzzählers. Fehlt kurzzeitig eine{" "}
            <strong>frische</strong> Messung (Netzzähler nicht erreichbar), regelt
            FLUX <em>nicht</em> auf dem veralteten Wert weiter, sondern fährt
            die AC-Speicher sicherheitshalber sanft auf 0&nbsp;W und protokolliert
            das. Sobald wieder frische Messwerte vorliegen, läuft die normale
            Regelung von selbst weiter. So wird verhindert, dass die Speicher bei
            einem Zählerausfall blind einspeisen.
          </p>
          <p className="hilfe-hinweis">
            <strong>Anzeige.</strong> Der Live-Block des Multi-Speicher-Balancers
            erscheint direkt <strong>innerhalb der zugehörigen CT-Senke</strong>,
            zusammen mit den Gewichts- und Dämpfungseinstellungen – denn diese
            gehören logisch zu genau dieser Senke.
          </p>
        </div>
        <p>
          Der <strong>Sollwert</strong> einer Senke ist frei konfigurierbar. Er
          setzt sich zusammen aus der Basis-Quelle (eigener Hauszähler),
          multipliziert mit einem <strong>Faktor</strong>, optional dem Bedarf
          aller §42c-Abnehmer und beliebigen weiteren gewichteten Offset-Quellen.
          Für §42c-Sharing wählt man Faktor&nbsp;1 und aktiviert den §42c-Bedarf.
          Sollen dagegen zwei lokale Speicher gemeinsam nur den Hausverbrauch
          decken (ohne §42c), gibt man jeder Senke den Faktor&nbsp;0,5 – dann
          übernimmt jeder Speicher die Hälfte.
        </p>
        <p>
          Für komplexere Fälle lässt sich der Sollwert einer Senke auch per{" "}
          <strong>erweiterter Formel</strong> festlegen (Feld „Erweiterte Formel"
          im ausklappbaren Bereich <em>„Erweiterte Einstellungen (Offsets &amp;
          Formel)"</em> der Senken-Konfiguration). Ist eine Formel eingetragen,
          ersetzt sie die einfache Basis-/Offset-/§42c-Berechnung. Erlaubt sind die
          Grundrechenarten <code>+ − * / %</code>, Klammern und die Funktionen{" "}
          <code>min</code>, <code>max</code>, <code>abs</code>,{" "}
          <code>clamp(x,&nbsp;lo,&nbsp;hi)</code> und <code>round</code>. Als
          Variablen stehen die Leistung jeder Quelle (unter ihrer Quellen-ID),{" "}
          <code>haus</code> (Basis-Quelle der Senke), <code>abnehmer42c</code>{" "}
          (Summe des §42c-Bedarfs) sowie je Senke <code>&lt;id&gt;_leistung</code>{" "}
          (aktuelle Ausspeisung) und <code>&lt;id&gt;_max</code> (Maximalleistung)
          zur Verfügung. Die genaue Namensliste zeigt der aufklappbare Bereich
          „Verfügbare Variablen" direkt am Eingabefeld.
        </p>
        <p>
          Ein typischer Anwendungsfall ist die <strong>Priorisierung mehrerer
          Speicher</strong>: Regeln zwei lokale Speicher unabhängig auf 0&nbsp;W
          am Hauszähler, kann es passieren, dass einer lädt, während der andere
          entlädt. Um stattdessen den zweiten Speicher erst dann zuzuschalten,
          wenn der erste seine Maximalleistung ausspeist, verwendet man für die
          Senke des zweiten Speichers z.&nbsp;B. die Formel{" "}
          <code>max(0, hichi + speicher1_leistung - speicher1_max)</code>. Der
          zweite Speicher deckt so nur den Restbezug, der nach voller Ausspeisung
          des ersten noch übrig bleibt. Unter dem Eingabefeld wird die Formel
          live geprüft und der aktuelle Ergebniswert angezeigt, sodass sich die
          Wirkung direkt kontrollieren lässt.
        </p>
      </section>

      <section className="card">
        <h3>EEBUS – Netzsteuerung (§14a / §9)</h3>
        <p>
          Netzbetreiber dürfen in angespannten Netzsituationen den{" "}
          <strong>Netzbezug</strong> steuerbarer Verbrauchseinrichtungen (§14a
          EnWG) sowie die <strong>Einspeisung</strong> von Erzeugungsanlagen (§9
          EEG) vorübergehend begrenzen. Das Signal kommt über eine{" "}
          <strong>Steuerbox</strong>, die am intelligenten Messsystem (SMGW)
          angebunden ist und die Grenzwerte per <strong>EEBUS</strong> ins
          Hausnetz meldet. FLUX kann diese Befehle über die eigene
          EEBUS-Seite entgegennehmen.
        </p>
        <p>
          Fachlich empfängt FLUX die beiden EEBUS-Anwendungsfälle{" "}
          <strong>LPC</strong> (Limitation of Power Consumption – Bezugsgrenze,
          §14a) und <strong>LPP</strong> (Limitation of Power Production –
          Einspeisegrenze, §9). Die Seite zeigt den Verbindungszustand zur
          Steuerbox, die aktuell gültigen Grenzwerte je Paragraf (mit Dauer und
          Gültigkeit), den Heartbeat sowie einen Failsafe-Status sichtbar an, und
          protokolliert jeden empfangenen Befehl mit Zeitstempel in einem
          Ereignisprotokoll.
        </p>
        <p>
          <strong>Wichtig zum aktuellen Stand:</strong> FLUX{" "}
          <em>empfängt, zeigt und protokolliert</em> die Steuerbefehle – über den
          EEBUS-Transport (Sidecar, siehe unten) auch von einer echten Steuerbox.
          Die <strong>§9-Einspeisebegrenzung (LPP)</strong> wird zusätzlich real
          umgesetzt: FLUX drosselt bei einem aktiven Einspeiselimit die
          Wechselrichter (siehe Abschnitt unten). Die{" "}
          <strong>§14a-Bezugsbegrenzung (LPC)</strong> wird empfangen, angezeigt und
          per Überwachung gegen den Bezug der steuerbaren Einrichtungen geprüft –
          ein aktiver Eingriff findet dabei bewusst nicht statt (Details weiter
          unten). Damit du Anzeige und Protokoll auch ohne
          Steuerbox ausprobieren kannst, gibt es einen <strong>Simulator</strong>,
          der Steuerbefehle über genau denselben internen Empfangsweg einspielt,
          den auch der echte Transport nutzt.
        </p>
        <p>
          <strong>§9-Umsetzung als Live-Regelung:</strong> §9 begrenzt die
          Einspeiseleistung am Netzverknüpfungspunkt, nicht die Wechselrichter
          selbst – der Eigenverbrauch bleibt also erlaubt. FLUX drosselt deshalb
          nicht stur auf den Grenzwert, sondern regelt fortlaufend: Nur wenn die
          tatsächliche Netzeinspeisung die Grenze (abzüglich einer einstellbaren
          Reserve) übersteigt, werden Wechselrichter zurückgefahren. Weil der
          Eigenverbrauch laufend in die gemessene Einspeisung eingeht, ist die
          Regelung automatisch eigenverbrauchskorrigiert – steigt der
          Eigenverbrauch, dürfen die Wechselrichter wieder hochlaufen.
        </p>
        <p>
          Die Drosselung folgt einer <strong>Reihenfolge</strong>, die du selbst
          festlegst: Der oberste Wechselrichter wird zuerst heruntergeregelt;
          reicht das nicht aus (er ist bereits bei 0 % und es wird immer noch zu
          viel eingespeist), kommt der nächste dran. Sinkt die Einspeisung wieder,
          werden die Wechselrichter in umgekehrter Reihenfolge wieder hochgeregelt.
          Die steuerbaren Wechselrichter werden <strong>automatisch aus den
          Quellen erkannt</strong> – alle PV-Erzeugungsquellen, die auf Growatt
          oder Hoymiles (über OpenDTU, je Seriennummer) passen. Der Vorschlag lässt
          sich manuell anpassen. Für die Regelung nutzt FLUX die real gemessene
          <strong> Ist-Leistung jedes Wechselrichters</strong> aus seiner Quelle
          und die einmalig hinterlegte Nennleistung: Muss z. B. ein WR, der gerade
          5 kW liefert, um 3 kW reduziert werden, ergibt das bei 10 kW Nennleistung
          ein Sollwert von 2 kW = 20 %. So trifft die Regelung den Zielwert direkt,
          statt sich langsam heranzutasten.
          Unterstützt werden beide <strong>Growatt</strong>-Wechselrichter (über
          einen Stick mit der freien Firmware „OpenInverterGateway", per HTTP oder
          MQTT, prozentual oder meterbasiert) und die <strong>Hoymiles</strong>-
          Mikrowechselrichter (über OpenDTU, per HTTP oder MQTT, je Seriennummer).
          Standardmäßig werden nicht-persistente Limits gesetzt, die den Speicher
          der Wechselrichter schonen. Aus Sicherheit ist der <strong>Dry-Run</strong>{" "}
          voreingestellt: FLUX berechnet und protokolliert die Sollwerte, sendet
          sie aber nicht. Erst nach bewusstem <strong>Scharfschalten</strong> gehen
          echte Schreibbefehle an die Wechselrichter; ein Testknopf je Gerät erlaubt
          gezieltes, gefahrloses Ausprobieren.
        </p>
        <p>
          <strong>§14a-Bezugsbegrenzung – Überwachung:</strong> Anders als bei der
          Einspeisung, wo Wechselrichter gedrosselt werden, betrifft die
          Bezugsbegrenzung die <em>steuerbaren Verbrauchseinrichtungen</em> (SteuVE)
          im Haus – typischerweise Wallbox und Wärmepumpe, sofern sie beim
          Netzbetreiber angemeldet sind. Der über EEBUS empfangene Befehl enthält
          einen konkreten <strong>Bezugs-Sollwert in Watt</strong>, in den der
          Netzbetreiber bereits alle Berechnungen (auch den Gleichzeitigkeitsfaktor
          bei mehreren Einrichtungen) eingerechnet hat. FLUX muss also nur die
          Summe der Momentanleistungen seiner SteuVE gegen diesen einen Wattwert
          vergleichen.
        </p>
        <p>
          Genau das leistet die <strong>§14a-Überwachung</strong> auf der
          EEBUS-Seite: Du definierst deine SteuVE als Liste und ordnest jeder die
          Quelle zu, aus der die Momentanleistung gelesen wird. FLUX zeigt dann live
          per Ampel und Balken, wie der aktuelle Summenbezug zum empfangenen Limit
          steht, warnt ab einer einstellbaren Schwelle und protokolliert jeden
          Statuswechsel (im Rahmen / nahe am Limit / Überschreitung). Ein{" "}
          <em>realer Eingriff</em> – das aktive Zurückfahren von Lasten – findet
          bewusst nicht statt: In vielen Anlagen liegen die angemeldeten SteuVE
          schon von sich aus unter dem garantierten Mindestbezug (z. B. eine
          einphasig auf 3,7 kW begrenzte Wallbox plus eine Wärmepumpe mit rund
          1 kW), sodass eine Drosselung praktisch nie nötig wird. Die Überwachung
          macht sichtbar, ob überhaupt jemals ein Eingriff erforderlich wäre. Sollte
          eine aktive Regelung nötig werden, ließe sie sich später ergänzen – sie
          würde die regelbaren Lasten entlang einer Prioritätenkette zurückfahren
          und den Speicher zur Eigenversorgung heranziehen, wobei §14a nur eine{" "}
          <em>Reduzierung auf</em> einen Mindestwert verlangt, keine Abschaltung.
        </p>
        <p>
          In der <strong>Konfiguration</strong> aktivierst du die Anbindung,
          hinterlegst den SKI der Steuerbox (die eindeutige Kennung, die dir der
          Netzbetreiber bzw. Messstellenbetreiber nennt) und optional die
          Failsafe-Grenzwerte, die bei einem Kommunikationsausfall gelten sollen.
          Der eigene SKI von FLUX wird vom EEBUS-Transport erzeugt und auf der
          Seite angezeigt – ihn brauchst du für die Registrierung beim
          Netzbetreiber.
        </p>
        <p>
          <strong>EEBUS-Transport (Sidecar):</strong> Die eigentliche
          EEBUS-Kommunikation (die Protokollschichten SHIP und SPINE mit
          Zertifikats-Kopplung) übernimmt ein eigenständiger Hilfsprozess, der
          „Sidecar". Er nutzt die etablierte EEBUS-Bibliothek und meldet empfangene
          Steuerbefehle an FLUX. Der Grund für diese Trennung: Für EEBUS gibt es
          keine ausgereifte Umsetzung in der Sprache von FLUX; der bewährte Weg
          ist ein separater Prozess, der die Protokollarbeit übernimmt. Der
          Sidecar wird getrennt gestartet (eine Anleitung liegt dem Programm bei);
          er erzeugt beim ersten Start die Identität (Zertifikat und SKI) und
          verbindet sich mit der Steuerbox. Auf der EEBUS-Seite siehst du, ob der
          Sidecar läuft und ob die Steuerbox gekoppelt ist, und kannst die
          Steuerbox-SKI an ihn übertragen. Solange kein Sidecar läuft, kannst du
          über den Simulator dennoch Anzeige und Protokoll ausprobieren.
        </p>
        <p>
          <strong>Realistisch testen mit virtueller Steuerbox:</strong> Um den
          kompletten Weg mit echter EEBUS-Kommunikation zu prüfen – ohne auf eine
          echte Steuerbox zu warten – lässt sich eine virtuelle Steuerbox koppeln,
          die per EEBUS reale LPC- und LPP-Befehle sendet. Sie wird wie eine echte
          Steuerbox per SKI mit FLUX gepaart. Eine Schritt-für-Schritt-Anleitung
          (welches Werkzeug, wie beide SKIs eingetragen werden, wie man Limits
          auslöst) liegt dem Programm bei unter{" "}
          <em>eebus-sidecar/TESTEN-MIT-SIMULATOR.md</em>. Damit lässt sich auch die
          §9-Wechselrichterregelung gefahrlos im Dry-Run mit realistischen
          Steuerbefehlen durchspielen, bevor man scharf schaltet.
        </p>
      </section>

      <section className="card">
        <h3>Lastprofile und Erzeugerprofile</h3>
        <p>
          Profile dienen der <strong>Simulation noch nicht angebundener
          Geräte</strong>. Ein <strong>Lastprofil</strong> beschreibt den
          typischen Tagesverlauf eines Verbrauchs (normiert), ein{" "}
          <strong>Erzeugerprofil</strong> den typischen Verlauf einer PV-Erzeugung
          (normiert auf 1&nbsp;kWp). Beide setzt du ein, wenn ein Gerät physisch
          noch nicht vorhanden oder noch nicht eingebunden ist, du seinen Einfluss
          aber trotzdem betrachten möchtest.
        </p>
        <p>
          Verwendet werden die Profile über die Emulations-Rollen in der
          Quellen-Konfiguration: Eine Quelle mit Emulations-Rolle greift auf ein
          hinterlegtes Profil zu, anstatt ein reales Gerät abzufragen. Lastprofile
          werden dabei mit einem Jahresverbrauch skaliert, Erzeugerprofile mit der
          Anlagengröße (kWp). So lassen sich zukünftige Szenarien und
          „Was-wäre-wenn"-Fragen durchspielen. Eigene Profile lassen sich als
          CSV-Datei hochladen.
        </p>
        <p>
          Für Lastprofile stehen zusätzlich die eingebauten, ab 2025 gültigen{" "}
          <strong>repräsentativen BDEW-Standardlastprofile</strong> bereit. Sie
          bilden typische Verbrauchsgruppen ab und unterscheiden sich wie folgt:
        </p>
        <ul className="hilfe-list">
          <li><strong>H25</strong> – Haushalte (Nachfolger des früheren H0); der Standardfall für einen Privathaushalt.</li>
          <li><strong>G25</strong> – Gewerbe allgemein (Nachfolger von G0); Tagesgang mit Schwerpunkt auf den Geschäftszeiten.</li>
          <li><strong>L25</strong> – Landwirtschaft (Nachfolger von L0).</li>
          <li><strong>P25</strong> – Kombinationsprofil für Haushalte <em>mit PV-Anlage</em>: die Eigenerzeugung senkt den Netzbezug mittags spürbar.</li>
          <li><strong>S25</strong> – Kombinationsprofil für Haushalte <em>mit PV-Anlage und Batteriespeicher</em>: zusätzlich zur Mittagsdelle wird auch der Abendbezug durch den Speicher reduziert.</li>
        </ul>
        <p>
          Der wesentliche Unterschied liegt also in der abgebildeten Kundengruppe
          und darin, ob und wie Eigenerzeugung/Speicher berücksichtigt sind. Die
          Profile sind je Kalendermonat und Tagestyp (Werktag, Samstag,
          Sonn-/Feiertag) in Viertelstundenwerten hinterlegt. Details und die
          offiziellen Daten veröffentlicht der BDEW unter{" "}
          <a
            href="https://www.bdew.de/energie/standardlastprofile-strom/"
            target="_blank"
            rel="noopener noreferrer"
          >
            bdew.de – Standardlastprofile Strom
          </a>.
        </p>
      </section>

      <section className="card">
        <h3>Stromtarif &amp; -anschluss (Kostenparameter)</h3>
        <p>
          Unter <strong>Stromtarif &amp; -anschluss</strong> (früher „Kosten")
          hinterlegst du alle Parameter des
          echten Betriebs, aus denen die wirtschaftliche Auswertung entsteht: die
          Einspeisevergütung und die zugrunde liegende EEG-Regelung, das
          das Stromtarifmodell samt <strong>Anbietername</strong>,
          <strong>monatlicher Grundgebühr</strong>, etwaigen{" "}
          <strong>Boni</strong> (Sofort-/Neukundenbonus, anteilig über das erste
          Belieferungsjahr gutgeschrieben) und
          etwaigen <strong>jährlichen Messstellen-Mehrkosten</strong> (beide
          fließen anteilig je Tag in die Bezugskosten ein), die §14a-Optionen zu
          reduzierten bzw. dynamischen Netzentgelten sowie die Wasserkosten. Diese
          Angaben sollten möglichst genau deinen realen Vertragsbedingungen
          entsprechen, damit die Kostenauswertung belastbar ist.
        </p>
        <p>
          <em>Umgezogen:</em> Die <strong>§42c-Abnehmer</strong> mit ihren – ggf.
          je Abnehmer unterschiedlichen – Vergütungssätzen und dem
          Verteilungsschlüssel findest du jetzt auf der Seite{" "}
          <strong>Energy Sharing</strong>, wo auch der Verbrauchsverlauf und die
          Wirtschaftlichkeitsanalyse des Sharings dargestellt werden.
        </p>
        <p>
          <strong>Zeitlich versionierte Kosten.</strong> Kostensätze ändern sich
          über die Zeit – etwa ein neuer Stromtarif ab einem bestimmten Datum oder
          angepasste Wasserpreise. Damit sowohl korrekt gerechnet als auch
          nachvollzogen werden kann, ab wann welche Werte galten, sind die Blöcke{" "}
          <strong>Stromtarif</strong>, <strong>§14a Modul 1</strong>,{" "}
          <strong>§14a Modul 3</strong> und <strong>Wasserkosten</strong> jeweils
          in <strong>Perioden</strong> unterteilt. Über der jeweiligen Eingabe
          findest du eine Leiste „gültig ab … bis …" mit Pfeilen zum Blättern
          zwischen den Zeiträumen. Eine Periode gilt ab ihrem Startdatum, bis eine
          nachfolgende beginnt; die jeweils jüngste gilt offen in die Zukunft.
        </p>
        <p>
          Mit <strong>„+ Folgeperiode"</strong> legst du einen anschließenden
          Zeitraum an – die Werte der aktuellen Periode werden dabei kopiert und
          können dann angepasst werden. So lassen sich künftige Preise (z.&nbsp;B.
          ein bereits abgeschlossener Tarif ab dem nächsten Jahr) schon heute
          eintragen: Bis zum Stichtag rechnet das Tool mit den bisherigen Werten,
          ab dem Stichtag automatisch mit den neuen. Jeder Block wird dabei
          getrennt versioniert, sodass eine Wasserpreisänderung unabhängig von
          einer Strompreisänderung bleibt. Bereits gespeicherte, in der Vergangenheit
          berechnete Tageswerte bleiben unverändert; die Perioden wirken auf die
          laufende und künftige Berechnung. Die <strong>Einspeisevergütung</strong>{" "}
          und die <strong>EEG-Regelung</strong> sind bewusst <em>nicht</em>{" "}
          zeitversioniert – sie gelten dauerhaft und werden separat im Block
          „Einspeisung" gepflegt.
        </p>
        <p>
          <strong>Fester vs. dynamischer Tarif.</strong> Beim festen Tarif rechnet
          das Tool mit einem einzigen Arbeitspreis je kWh. Beim{" "}
          <strong>dynamischen Tarif</strong> wird der Bezugspreis dagegen für{" "}
          <strong>jede Viertelstunde einzeln</strong> aus dem tatsächlichen
          Börsenstrompreis dieser Viertelstunde gebildet – so, wie es
          börsenpreisgekoppelte Tarife (z.&nbsp;B. dynamische Stromtarife nach
          §&nbsp;41a EnWG) tun.
        </p>
        <p>
          Wichtig: Der Börsenpreis ist <strong>nicht</strong> der Endpreis. Zum
          reinen Börsenpreis (EPEX-Spot, Day-Ahead) kommen zahlreiche weitere,
          feste Preisbestandteile hinzu, die das Tool alle berücksichtigt:
        </p>
        <ul className="hilfe-list">
          <li>der <strong>Börsenpreis</strong> der jeweiligen Viertelstunde (kann auch negativ sein),</li>
          <li>der <strong>Anbieteraufschlag</strong> für Beschaffung und Vertrieb,</li>
          <li>die <strong>Stromsteuer</strong>,</li>
          <li>die <strong>Konzessionsabgabe</strong>,</li>
          <li>der <strong>Aufschlag auf die Netznutzung</strong>,</li>
          <li>die <strong>Offshore-Netzumlage</strong> und die <strong>KWKG-Umlage</strong>,</li>
          <li>das <strong>Netzentgelt</strong> (bei §14a Modul 3 zeitlich gestaffelt),</li>
          <li>abschließend die <strong>Umsatzsteuer</strong> auf die Summe.</li>
        </ul>
        <p>
          Erst die Summe dieser Bestandteile ergibt den tatsächlichen Arbeitspreis
          je Viertelstunde. Die <strong>Börsenpreise</strong> selbst werden je
          Liefertag als Viertelstunden-Reihe vorgehalten (Tabelle{" "}
          <code>spotpreise</code>); im realen Betrieb stammen sie vom Day-Ahead-
          Markt. Alle festen Bestandteile trägst du gemäß deinem Vertrag bzw.
          deinem Netzgebiet ein.
        </p>
      </section>

      <section className="card">
        <h3>Visualisierung</h3>
        <p>
          Unter <strong>Visualisierung</strong> legst du die einheitlichen Farben
          fest, mit denen die einzelnen Energiearten in allen Charts dargestellt
          werden. Gleiche Energiearten erscheinen so überall in derselben Farbe,
          was das seitenübergreifende Lesen der Auswertungen erleichtert.
        </p>
      </section>

      <section className="card">
        <h3>Import / Export</h3>
        <p>
          Über <strong>Einstellungen → Import / Export</strong> lässt sich die
          gesamte Konfiguration als JSON-Datei sichern und auf einer anderen
          Installation wiederherstellen. Exportiert werden die Quellen (Geräte,
          Rollen, URLs, Felder), die tariflichen Angaben (Energiekosten, §14a),
          die Chart-Farben, der Energy-Sharing-Modus samt Abnehmerliste, die
          Senken, die Raumliste sowie die selbst angelegten Last- und
          Erzeugerprofile. Bewusst <strong>nicht</strong> enthalten sind die im
          Betrieb aufgelaufenen Messwerte (Historie, Viertelstunden,
          Zählerstände, Logs) – diese entstehen zur Laufzeit aus den Quellen und
          werden nicht mitgesichert.
        </p>
        <p>
          Beim <strong>Export</strong> wählst du per Häkchen, welche Bereiche in
          die Datei geschrieben werden (Vorauswahl: alle). Beim{" "}
          <strong>Import</strong> wird die Datei zunächst eingelesen und
          angezeigt, welche Bereiche sie enthält; du wählst dann, welche davon
          übernommen werden. Zusätzlich legst du fest, wie mit vorhandenen Daten
          umgegangen wird: <strong>Zusammenführen</strong> ergänzt den Bestand und
          überschreibt nur gleiche Einträge (per ID/Schlüssel), während{" "}
          <strong>Ersetzen</strong> den bestehenden Bestand der gewählten Bereiche
          zuvor löscht und vollständig durch die Datei ersetzt. Beim Ersetzen
          erscheint zur Sicherheit eine Rückfrage, da dabei Daten gelöscht werden.
          Energiekosten und Visualisierung bestehen aus einzelnen Werten und
          werden immer feldweise übernommen.
        </p>
      </section>

      <section className="card">
        <h3>Automatisierungsregeln</h3>
        <p>
          Unter <strong>Einstellungen → Automatisierungsregeln</strong> legst du
          Regeln an, die Ausgänge schalten, Nachrichten senden, einen Timer
          starten oder einen AC-Speicher steuern. Jede Regel besteht aus vier
          Bereichen: <strong>Einschalten wenn</strong> (Bedingungen),{" "}
          <strong>Aktionen beim Einschalten</strong>,{" "}
          <strong>Ausschalten wenn</strong> (Bedingungen) und{" "}
          <strong>Aktionen beim Ausschalten</strong>. Bedingungen sind je Bereich
          mit UND/ODER verknüpft; der farbige Punkt davor zeigt live, ob eine
          Bedingung gerade erfüllt (grün) oder nicht erfüllt (rot) ist.
        </p>

        <h4>Bedingungen</h4>
        <p>
          Als Bedingung stehen Messwerte (PV-Überschuss, PV-Erzeugung, Netz,
          Hausverbrauch, Batterie-SoC, Speichertemperatur oben/unten,{" "}
          <strong>Börsenstrompreis</strong>, dynamischer Bezugspreis brutto, der{" "}
          <strong>Vorteil einer PV-Drosselung</strong> und die Leistung einer
          Quelle), Zeitfenster (Wochentage + Uhrzeit), der Zustand einer Quelle
          (aktiv, inaktiv oder <strong>offline</strong>), ein{" "}
          <strong>täglicher Auslöser</strong> (einmal pro Tageswechsel), ein{" "}
          <strong>täglicher Auslöser zu fester Uhrzeit</strong> (einmal pro Tag,
          sobald eine gewählte Uhrzeit erreicht ist – z.&nbsp;B. 23:59 für einen
          Bericht über den heutigen, abgeschlossenen Tag), das
          aktuell geltende <strong>Tarifmodell</strong> (Festpreis oder dynamisch)
          sowie <strong>„Timer abgelaufen"</strong> (siehe unten) zur Verfügung.
          Messwert- und Inaktiv-Bedingungen können eine Mindestdauer verlangen
          („… für ≥ 3 min").
        </p>

        <h4>Aktionen</h4>
        <p>
          In beiden Aktionsbereichen lassen sich beliebig viele Aktionen
          untereinander hinzufügen. Zur Wahl stehen:
        </p>
        <ul className="hilfe-list">
          <li>
            <strong>Ausgang schalten:</strong> einen schaltbaren Ausgang{" "}
            <em>einschalten</em>, <em>ausschalten</em> oder <em>umschalten</em>.
            Beim Umschalten liest die Regel den aktuellen Zustand des Ausgangs aus
            und kehrt ihn um. Damit eine Quelle als Schaltziel erscheint, muss sie
            in der Quellen-Konfiguration als schaltbar markiert sein.
          </li>
          <li>
            <strong>Push-Nachricht:</strong> eine Nachricht per ntfy senden. Der
            Text darf Platzhalter enthalten, die beim Senden durch aktuelle Werte
            ersetzt werden: <code>{"{verbrauch}"}</code>,{" "}
            <code>{"{einspeisung}"}</code>, <code>{"{kosten}"}</code>,{" "}
            <code>{"{netzbezug}"}</code>, <code>{"{pv}"}</code>,{" "}
            <code>{"{soc}"}</code>, <code>{"{spotpreis}"}</code> (Börsenpreis
            netto), <code>{"{endpreis}"}</code> (Endnutzerpreis brutto) und{" "}
            <code>{"{datum}"}</code>. Das Info-Symbol neben dem Nachrichtenfeld
            zeigt die verfügbaren Platzhalter beim Überfahren mit der Maus.
          </li>
          <li>
            <strong>Timer starten:</strong> startet beim Einschalten einen Timer
            mit einstellbarer Dauer. In den Ausschaltbedingungen lässt sich per{" "}
            <strong>„Timer abgelaufen"</strong> prüfen, ob die Zeit seit dem
            Einschalten verstrichen ist. So baust du eine feste Laufzeit: „Ausgang
            einschalten + Timer 180 min" bei den Einschalt-Aktionen und „Timer
            abgelaufen nach 180 min" als Ausschaltbedingung, dazu „Ausgang
            ausschalten" bei den Ausschalt-Aktionen. Der Einschaltzeitpunkt wird
            dauerhaft gespeichert, sodass der Timer auch nach einem Neustart
            korrekt ausläuft.
          </li>
          <li>
            <strong>AC-Speicher steuern:</strong> gibt einem per Modbus TCP
            angebundenen Speicher direkt vor, zu laden oder zu entladen (mit
            Leistung und optionalem Ziel-Ladezustand) oder zu stoppen; über „Danach
            umschalten auf" wird beim Ausschalten ein Betriebsmodus (Manuell,
            Eigenverbrauch, Trade) gesetzt.
          </li>
        </ul>
        <p>
          Es wird ausschließlich ausgeführt, was du hinterlegst – es gibt kein
          implizites Zurückschalten. Soll ein Ausgang beim Ausschalten wieder
          abgeschaltet werden, füge dafür bewusst eine „Ausgang schalten"-Aktion
          mit Richtung „ausschalten" hinzu.
        </p>

        <h4>Scharf, Start/Stopp und Ablauf</h4>
        <p>
          Eine Regel wirkt über die Automatik nur, wenn sie{" "}
          <strong>scharf</strong> geschaltet ist. Unabhängig davon lässt sich jede
          Regel über den <strong>Start-Knopf</strong> (▶) neben dem
          Scharf-Häkchen auch <strong>manuell starten</strong> – dann führt sie
          ihre Einschalt-Aktionen sofort aus, ohne dass die Einschaltbedingungen
          erfüllt sein müssen. Läuft eine Regel gerade, wird daraus ein{" "}
          <strong>Stopp-Knopf</strong> (⏹), der die Ausschalt-Aktionen auslöst;
          die Karte ist währenddessen farblich hervorgehoben. Optional lässt sich
          ein <strong>Ablaufzeitpunkt</strong> setzen, ab dem die Regel sich selbst
          scharf-aus schaltet.
        </p>
        <p>
          Die Automatik – jedes selbsttätige Auslösen und auch die
          Laufend-Erkennung bedingungsloser Schalt-Regeln (siehe unten) – greift{" "}
          <strong>ausschließlich bei scharfen Regeln</strong>. Eine{" "}
          <em>nicht</em> scharfe Regel wird nie von selbst aktiviert oder als
          laufend geführt, selbst wenn ihr Zielzustand von außen erreicht ist; sie
          lässt sich nur manuell starten. Auf der Startseite sind die Kacheln
          entsprechend gekennzeichnet: <strong>scharfe</strong> Regeln haben eine
          kräftige Umrandung, <strong>nicht scharfe</strong> eine dezent
          gestrichelte – so ist sofort erkennbar, welche Regeln selbsttätig wirken
          können.
        </p>

        <h4>Regeln ohne Ausschaltbedingung</h4>
        <p>
          Hat eine Regel keine Ausschaltbedingung, wirkt sie als{" "}
          <strong>Feuer-und-vergiss</strong>: Sie führt ihre Einschalt-Aktionen
          einmal aus und gilt danach sofort wieder als beendet – sie bleibt nicht
          als „laufend" hängen und zeigt keinen Stopp-Knopf. Damit sie nicht in
          jedem Prüfzyklus erneut auslöst, ist sie gesperrt, solange die
          Einschaltbedingung erfüllt bleibt, und löst erst wieder aus, nachdem die
          Bedingung zwischenzeitlich einmal nicht mehr erfüllt war. Typisches
          Beispiel ist die tägliche Tagesstatistik, die zum Tageswechsel genau
          einmal eine Push-Nachricht sendet.
        </p>

        <h4>Gruppen und Anzeige auf der Startseite</h4>
        <p>
          Regeln lassen sich zu <strong>Gruppen</strong> zusammenfassen (z.&nbsp;B.
          Informationen, Warnungen, PV-Überschussnutzung) und per{" "}
          <strong>Ziehen&nbsp;&amp;&nbsp;Ablegen</strong> sortieren sowie zwischen
          Gruppen verschieben. Gruppen lassen sich anlegen, umbenennen und löschen.
          Mit dem Häkchen <strong>„Übersicht"</strong> erscheint eine Regel als
          kleine <strong>Kachel auf der Startseite</strong> (unter dem
          Anlagenbild). Die Kachel zeigt den Namen und einen Start-Knopf; läuft die
          Regel gerade, ist die Kachel farblich hervorgehoben, zeigt die
          Startuhrzeit und statt des Start- einen Stopp-Knopf. So lassen sich
          häufig gebrauchte Regeln direkt von der Startseite aus auslösen.
        </p>

        <h4>Protokoll und Beispielregeln</h4>
        <p>
          Jede Auslösung wird im <strong>Protokoll</strong> festgehalten – beim
          Ausschalten inklusive Ergebnis, etwa wie lange die Regel aktiv war,
          wieviel Energie das Zielgerät aufgenommen hat und wie sich die
          Speichertemperatur verändert hat. Ab Werk sind bereits mehrere{" "}
          <strong>Beispielregeln</strong> angelegt, die die verschiedenen
          Bedingungs- und Aktionstypen zeigen: ein per PV-Überschuss geschalteter
          Heizstab, Ausfallwarnungen für Gefrier- und Kühlschrank, eine Meldung bei
          negativem Börsenstrompreis, eine tägliche Tagesstatistik sowie Regeln,
          die ein AC-Ladegerät über einen Timer für eine feste Zeit einschalten.
          Die potenziell in den Anlagenbetrieb eingreifenden Regeln (Heizstab,
          PV-Drosselung) sind zunächst <em>nicht</em> scharf geschaltet, damit du
          sie in Ruhe prüfen kannst. Alle Regeln lassen sich frei ändern,
          deaktivieren oder löschen.
        </p>
      </section>

      <section className="card">
        <h3>Benachrichtigungen (ntfy)</h3>
        <p>
          Unter <strong>Einstellungen → Benachrichtigungen</strong> kann FLUX
          Push-Meldungen über den kostenlosen Dienst <strong>ntfy</strong>{" "}
          versenden – ohne Konto. Du installierst die ntfy-App (Android/iOS) oder
          öffnest die Weboberfläche, abonnierst dort ein frei wählbares Topic
          (z.&nbsp;B. „flux-mein-haus") und trägst denselben Topic-Namen in FLUX ein.
          FLUX sendet die Meldungen dann per HTTP an{" "}
          <code>&lt;server&gt;/&lt;topic&gt;</code>.
        </p>
        <p>
          Wähle einen möglichst eindeutigen, schwer zu erratenden Topic-Namen:
          Jeder, der den Namen kennt, kann die Meldungen abonnieren. <strong>Was</strong>{" "}
          eine Benachrichtigung auslöst, wird ausschließlich über die{" "}
          <strong>Automatisierungsregeln</strong> festgelegt (Aktion
          „Push-Nachricht") – so bleiben alle Auslöser an einem Ort. Beispiele:
          negativer Börsenpreis, eine offline gegangene Quelle, niedriger
          Batterie-Ladezustand oder ein Gerät ohne Verbrauch. Ein Mindestabstand
          verhindert, dass dieselbe Meldung mehrfach in kurzer Folge kommt. Über
          „Testbenachrichtigung senden" lässt sich die Einrichtung prüfen.
        </p>
      </section>
    </div>
  );
}

export function HilfeAuswertungPage() {
  return (
    <div className="page hilfe-page">
      <h2>Auswertung</h2>
      <p className="hint">
        Die Auswertungen verteilen sich auf die Live-Übersicht und die Seiten im
        Menübereich „Details". Dieser Abschnitt gibt einen Überblick, welche
        Ansicht wofür gedacht ist.
      </p>

      <section className="card">
        <h3>Live-Ansicht (Gesamtansicht)</h3>
        <p>
          Die <strong>Gesamtansicht</strong> ist die fortlaufend aktualisierte
          Live-Darstellung der gesamten Anlage. Im Anlagenschema wird gezeigt, wie
          die Energie im aktuellen Moment fließt – von der Erzeugung über Speicher
          und Hausverbrauch bis zu Netzbezug und Einspeisung. Die Werte werden
          laufend im Abfrageintervall aktualisiert.
        </p>
        <p>
          Neben den Momentanwerten zeigt die Ansicht auch die{" "}
          <strong>aggregierten Kennzahlen des bisherigen Tages</strong>: Erzeugung,
          Hausverbrauch, Netzbezug, Einspeisung, den daraus errechneten Eigenverbrauch
          und die Autarkie – jeweils als Summe seit Mitternacht. So verbindet die
          Seite den aktuellen Zustand mit dem Tagesverlauf, ohne dass man auf eine
          Detailseite wechseln muss.
        </p>
        <p>
          Ist eine Quelle mit der Rolle <strong>Warmwasserspeicher</strong> aktiv,
          werden zusätzlich dessen <strong>Temperaturen</strong> (oben/unten)
          eingeblendet – praktisch, um den Ladezustand des Warmwasserspeichers im
          Blick zu behalten.
        </p>
        <p>
          Außerdem erscheinen auf der Gesamtansicht <strong>Kacheln für die
          Automatisierungsregeln</strong>. Damit lässt sich unmittelbar erkennen,{" "}
          <strong>welche Regel gerade aktiv ist</strong> (sie schaltet also aktuell
          ihren Verbraucher), und eine Regel lässt sich per Klick auch{" "}
          <strong>manuell auslösen</strong>, ohne den Umweg über die
          Automatisierungsseite. Welche Regeln hier auftauchen, steuerst du je Regel
          über die Option „auf der Übersicht anzeigen".
        </p>
        <p>
          Viele Kachel-Bereiche lassen sich in ihrer <strong>Reihenfolge
          anpassen</strong>: die Regel-Kacheln auf der Übersicht, die
          Kennzahlen-Kacheln der Wärmepumpe und der Warmwasser-Seite, die
          Kacheln der AC-Speicher sowie die Kennzahlen der Sharing-Analyse. Über
          den Knopf <strong>„⇅ Anordnen"</strong> wechselst du in den
          Sortiermodus; dann ziehst du die Kacheln per Drag&amp;Drop an die
          gewünschte Stelle im vorhandenen Raster. Bei der Wärmepumpe lassen sich
          zusätzlich die ganzen Cluster (Heizen, Warmwasser, Kühlen, Gesamt)
          untereinander verschieben. Die Anordnung wird gespeichert und gilt auf
          allen Geräten. Mit <strong>„✓ Fertig"</strong> verlässt du den
          Sortiermodus wieder – erst dann reagieren klickbare Kacheln (etwa zum
          Umschalten der Diagramme) wieder normal.
        </p>
      </section>

      <section className="card">
        <h3>Status aller Quellen und Senken</h3>
        <p>
          Die <strong>Status</strong>-Seite zeigt für jede konfigurierte Quelle
          und Senke, ob sie aktuell erreichbar ist und zuletzt erfolgreich gelesen
          wurde, samt Zeitpunkt der letzten Antwort und den zuletzt gelesenen
          Messwerten. So erkennst du auf einen Blick, ob alle Geräte liefern oder
          ob eine Quelle ausgefallen bzw. deaktiviert ist – die Grundlage dafür,
          dass die Auswertungen vollständig sind.
        </p>
        <p>
          Besonderheit bei <strong>verlinkten Quellen</strong>: Ist einer
          Hauptquelle eine andere Quelle untergeordnet (etwa ein schneller
          Leistungsmesser, der die Momentanleistung eines Zählers liefert, oder
          eine Quelle, deren Werte inhaltlich zur Hauptquelle gehören), wird die
          untergeordnete Quelle <strong>nicht separat</strong> aufgeführt. Ihre
          Messwerte erscheinen stattdessen <strong>zusammengefasst bei der
          Hauptquelle</strong>, jeweils mit einer Herkunftsangabe wie „Netz (Shelly
          Pro 3EM): Leistung". Dadurch stehen alle zusammengehörigen Werte an einer
          Stelle, statt über mehrere Einträge verstreut zu sein. Das gilt sowohl
          für die Verlinkung über eine separate Leistungsquelle als auch für
          allgemein untergeordnete Quellen.
        </p>
      </section>

      <section className="card">
        <h3>Detailansichten: Verbraucher, Wärmepumpe und Warmwasser</h3>
        <p>
          Die <strong>Verbraucher</strong>-Seite listet alle Verbraucher – nach
          Räumen gruppiert – mit aktueller Leistung und Tagesverbrauch. Über eine{" "}
          <strong>Tagesauswahl</strong> lassen sich auch vergangene Tage einsehen;
          für diese zeigt die Tabelle die historischen Tagesverbräuche, während
          die Spalte mit der Momentanleistung (die es nur für den heutigen Tag
          gibt) ausgegraut wird. Ein Gerät wird nur dann ausgegraut, wenn an dem
          Tag noch keine Energie bezogen (oder – bei Speichern – eingespeist)
          wurde. Per Klick auf ein Gerät öffnet sich seine Detailansicht mit
          umschaltbarer Granularität <strong>Tag/Monat/Jahr</strong>: Der Tag
          zeigt den Viertelstunden-Verlauf samt Tagesenergiemenge, Monat und Jahr
          zeigen Balkendiagramme mit den jeweiligen Summen. In den Balkencharts
          führt ein Klick in die feinere Ebene (Jahr → Monat → Tag). Ein Klick auf
          eine Raumzeile öffnet ein gestapeltes Diagramm der Geräte dieses Raums,
          die <strong>Gesamtzeile</strong> eines über <em>alle</em> Verbraucher.
        </p>
        <p>
          Die <strong>Wärmepumpe</strong> erhält zwei Auswertungen. Oben steht die{" "}
          <strong>Kennzahlen-Auswertung</strong> für einen frei wählbaren Zeitraum
          (Heizsaison Oktober–April, Tag, Woche, Monat oder beliebiger Zeitraum).
          Sie zeigt Kacheln für Kompressor-Laufzeit, Laufzeit-Anteil von Heiz- und
          Warmwasserbetrieb, Energiebedarf gesamt und Standby-Anteil, Energiebedarf
          getrennt nach Heizen/Warmwasser/Kühlen, abgegebene Wärmemenge, die
          Arbeitszahl (COP) als Verhältnis von Wärme zu Strom, Kompressortakte,
          Abtauungen und die Abdeckung durch PV-Strom. Die Kacheln sind nach{" "}
          <strong>Energie</strong> (geclustert nach Heizen, Warmwasser, Kühlen)
          und <strong>Kompressor</strong> gruppiert. Ein Klick auf eine der
          klickbaren Kacheln blendet darunter ein passendes{" "}
          <strong>Monatsdiagramm</strong> ein (Monat frei wählbar): der
          Energieverbrauch je Tag als gestapelte Balken nach Betriebsart, die
          abgegebene Wärme/Kälte, die Kompressortakte, die Abtauungen, die
          Kompressor-Laufzeit in Stunden je Tag oder die PV-Deckung je Tag (Anteil
          des Energiebedarfs, der aus PV gedeckt wurde).
          Es ist stets nur ein Diagramm sichtbar; beim Laden erscheint das
          gestapelte Energiediagramm. Die Tageswerte werden beim
          Tagesabschluss berechnet und gespeichert; der laufende Tag wird live
          ergänzt. Takte und Abtauungen werden über den Tageswechsel hinweg korrekt
          gezählt. Darunter folgt der <strong>Messwert-Verlauf</strong>: Tages­auswahl,
          Zeitausschnitt, Diagramm und die Auswahl der Datenreihen sind in einem
          Block zusammengefasst. Die Messreihen (Heizleistung, Vor- und
          Rücklauftemperatur, Kompressorfrequenz, Betriebsmodus und weitere) werden
          im kurzen Abfrageintervall über HeishaMon aufgezeichnet und lassen sich
          einzeln ein- und ausblenden, zwei Achsen zuordnen und zeitlich
          hineinzoomen, um Details wie Abtauzyklen zu erkennen.
        </p>
        <p>
          Der Energiebedarf je Betriebsart wird nicht geschätzt, sondern direkt
          gemessen: Die elektrische Leistungsaufnahme der Wärmepumpe (vom mit ihr
          verknüpften Mess-Shelly) wird zusammen mit dem jeweils aktiven
          Betriebsmodus feingranular aufgezeichnet und beim Integrieren nach Heizen,
          Warmwasser und Kühlen getrennt. So verzerrt ein leistungsintensiver, aber
          kurzer Warmwasserzyklus die Aufteilung nicht. Die Betriebsart-Trennung
          steht für Daten zur Verfügung, die ab der Einführung dieser Funktion
          aufgezeichnet wurden.
        </p>
        <p>
          Die Seite <strong>Warmwasser</strong> bündelt alles rund um die
          Warmwasserbereitung. Auch sie beginnt mit einer{" "}
          <strong>Kennzahlen-Auswertung</strong> (Tag, Monat, Jahr oder beliebiger
          Zeitraum): Sie zeigt, an wie vielen Tagen und in welchem Verhältnis
          Warmwasser über <strong>Wärmepumpe</strong>, <strong>Heizstab</strong>
          {" "}oder <strong>Solarthermie</strong> erzeugt wurde (mehrere Arten pro
          Tag möglich), sowie die eingesetzte Energie von Wärmepumpe, Heizstab und
          Solarthermie. Bei der Solarthermie wird dabei der Stromverbrauch der
          Solarkreis-Pumpe ausgewiesen – die thermisch eingebrachte Solarenergie
          ist ohne Wärmemengenzähler nicht messbar. Eine weitere Kachel zeigt die{" "}
          <strong>aktuell im Speicher gebundene thermische Energie</strong>{" "}
          gegenüber einer Referenz von 20 °C, berechnet aus den zuletzt gemessenen
          Temperaturen oben und unten. Die zugrunde liegende Formel lässt sich über
          das Stift-Symbol bearbeiten (Variablen <code>T_u</code> für die untere und{" "}
          <code>T_o</code> für die obere Temperatur); das Info-Symbol blendet die
          Herleitung ein. Der Standard geht von einer linearen Temperaturschichtung
          über die Speicherhöhe aus: Aus den Fühlerpositionen (unten 581 mm, oben
          1546 mm) wird auf den Speichermittelpunkt (887,5 mm) interpoliert, woraus
          sich mit dem Speichervolumen (289 l) und der Wärmekapazität von Wasser
          die Näherung <code>E [kWh] = 0,2295·T_u + 0,1068·T_o − 6,724</code>{" "}
          ergibt. Da sich die tatsächliche Schichtung aus nur zwei Messwerten nicht
          bestimmen lässt, ist der Wert eine Näherung. Darunter folgt der{" "}
          <strong>Warmwasserspeicher-Temperaturverlauf</strong> (zuvor auf der
          WP-Seite): Sobald eine Quelle mit der Rolle „Warmwasserspeicher" aktiv
          ist, zeichnet FLUX deren beide Temperaturen (oben/unten) im
          Abfrageintervall auf. Das Diagramm bietet umschaltbare Zeiträume und
          lässt sich vor- und zurückblättern; beide Kurven sind einzeln ein- und
          ausblendbar, ein Fadenkreuz zeigt die Werte zum jeweiligen Zeitpunkt –
          neben den beiden Temperaturen auch die daraus berechnete, zu diesem
          Zeitpunkt im Speicher gebundene thermische Energie (nach derselben,
          editierbaren Formel wie die zugehörige Kennzahl-Kachel).
          Zusätzlich hinterlegt das Diagramm farbig und transparent, wann welcher
          Erzeuger aktiv war – Wärmepumpe, Heizstab und Solarthermie, ermittelt aus
          deren Leistungsaufnahme (die Solarthermie-Pumpe etwa ab rund 8 W über
          ihrem Standby). So ist auf einen Blick erkennbar, welcher Erzeuger einen
          Temperaturanstieg verursacht hat. Jeder Erzeuger lässt sich über die
          Legende einzeln ein- und ausblenden.
        </p>
      </section>

      <section className="card">
        <h3>Speicher</h3>
        <p>
          Sobald ein Batteriespeicher mit der Rolle <strong>AC-Batterie</strong>
          {" "}oder <strong>DC-Batterie</strong> aktiv ist, erscheint die Seite
          {" "}<strong>Speicher</strong>. Sie ist in zwei Bereiche gegliedert:
          {" "}<strong>AC-Speicher</strong> und <strong>DC-Speicher</strong>.
        </p>
        <p>
          Bei den <strong>AC-Speichern</strong> zeigt sie je Speicher die passend
          ausgelesenen Werte – bei der lokalen Marstek-API die strukturierten
          Gerätewerte (Ladezustand, Leistungen, Temperatur, Kapazität,
          Betriebsmodus), bei Modbus TCP die ausgelesenen Register (Leistung,
          Ladezustand, Spannung, Strom, Temperatur, Energiezähler) und bei
          generischer REST-/MQTT-Anbindung die zuletzt gemessenen Werte. Je nach
          Protokoll lässt sich der Speicher hier auch direkt{" "}
          <strong>ansteuern</strong>: Betriebsmodi bei der lokalen API,
          erzwungenes Laden/Entladen mit Leistungs- und Ziel-Ladezustandsvorgabe
          sowie die Backup-Funktion bei Modbus.
        </p>
        <p>
          Bei den <strong>DC-Speichern</strong> werden die Momentanwerte aus den
          verknüpften Quellen zusammengeführt: Ladeleistung aus der PV-Quelle,
          Entladeleistung aus der Batterie-Einspeisung, dazu – falls vorhanden –
          Ladezustand sowie alle Messwerte der verknüpften Quellen (PV,
          Batterie-Einspeisung und AC-Ladegerät) mit Herkunftsangabe. Für jede
          verknüpfte Quelle, die schaltbar ist, steht ein <strong>Ein/Aus-Schalter
          </strong> bereit. Die Weboberflächen-Links aller verknüpften Quellen
          erscheinen im Link-Kasten am Seitenkopf. Ein DC-Speicher fragt selbst
          keine Daten ab und zählt nicht doppelt in die Bilanz.
        </p>
      </section>

      <section className="card">
        <h3>Stromverbrauch – die zentrale Auswertungsseite</h3>
        <p>
          Die Seite <strong>Stromverbrauch</strong> ist die umfangreichste
          Auswertung des Tools. Sie betrachtet Verbrauch und wirtschaftliche
          Auswirkungen aus mehreren Blickwinkeln und führt dazu vier Bausteine
          untereinander zusammen: die viertelstundengenauen{" "}
          <strong>Tagesverläufe</strong>, die <strong>Monatsübersicht</strong>,
          die <strong>Stromabrechnung</strong> und den{" "}
          <strong>Tarifvergleich</strong>. Alle vier lassen sich über eigene
          Datums- bzw. Zeitraumauswahlen unabhängig einstellen.
        </p>
        <p>
          <strong>1. Tagesverläufe (zwei gestapelte Tagescharts).</strong> Für den
          gewählten Tag zeigt das erste Diagramm den <em>Hausverbrauch</em> je
          Viertelstunde, aufgeteilt nach Herkunft – direkt aus der PV, aus dem
          Batteriespeicher und aus dem Netzbezug –, sodass sichtbar wird, welcher
          Anteil des Verbrauchs jeweils gedeckt wurde. Das zweite Diagramm stellt{" "}
          <em>Netzbezug</em> (nach oben) und <em>Einspeisung</em> (nach unten)
          gegenüber; die Einspeisung ist zusätzlich zerlegt in die klassische
          Netzeinspeisung und die im Rahmen von §42c gelieferten Anteile aus PV
          und Speicher. Über den Diagrammen stehen jeweils die Tagessummen der
          einzelnen Anteile.
        </p>
        <p>
          <strong>2. Monatsübersicht (gestapeltes Balkendiagramm + Tabelle).</strong>{" "}
          Darunter folgt für jeden Tag eines Monats ein gestapelter Balken mit der
          Tagesbilanz – nach oben der Verbrauch nach Herkunft, nach unten
          Einspeisung und Netzbezug –, der laufende Tag mit den bisher
          aufgelaufenen Werten eingeschlossen. Die zugehörige Tabelle listet je Tag
          Verbrauch, Erzeugung, Netzbezug, Einspeisung, Autarkiegrad, Kosten und
          Einsparung samt Monatssumme.
        </p>
        <p>
          <strong>3. Stromabrechnung (virtuelle Abrechnung über Tarifperioden).</strong>{" "}
          Für einen frei wählbaren Zeitraum erzeugt das Tool eine vollständige,
          mitlaufende Stromabrechnung – im Prinzip eine jederzeit aktuelle
          Jahresabrechnung. Sie schlüsselt alle Kostenbestandteile getrennt auf:
          Arbeitspreis (Bezugskosten mit ausgewiesener bezogener Energiemenge und
          mittlerem Arbeitspreis), anteilige Grund- und Messstellengebühr, Sofort-
          und Neukundenbonus, die §14a-Modul-1-Reduktion, Einspeisevergütung (mit
          eingespeister Menge und mittlerer Vergütung) und §42c-Vergütung, und
          bildet daraus den Saldo. Weil die Fixkosten und Boni über ihre
          Tagesanteile summiert werden, ergibt sich für jeden Zeitraum automatisch
          der korrekte Betrag (etwa Grundgebühr × Monate). Ist <strong>§14a
          Modul&nbsp;3</strong> (zeitvariables Netzentgelt) aktiv, wird dessen
          Effekt separat gezeigt – als Einsparung in Niedriglast- und Aufschlag in
          Hochlastfenstern, aufgeschlüsselt nach den in Hoch-, Niedrig- und
          Standardlast bezogenen Kilowattstunden. Erstreckt sich der Zeitraum über
          mehrere <strong>Tarifperioden</strong> (z.&nbsp;B. nach einem
          Anbieterwechsel), werden Energiemengen, Preise und Kostenpositionen{" "}
          <em>je Periode getrennt</em> ausgewiesen. Zusätzlich ist die{" "}
          <strong>Einsparung durch Eigenverbrauch</strong> nach Herkunft
          aufgeschlüsselt – wie viele Kilowattstunden aus PV-Direktverbrauch bzw.
          Speicherentladung stammten und welche Netzbezugskosten dadurch jeweils
          vermieden wurden (abzüglich der dafür entgangenen Einspeisevergütung).
        </p>
        <p>
          <strong>4. Vergleich Fixtarif vs. dynamischer Tarif.</strong> Der letzte
          Block stellt für einen wählbaren Zeitraum die reinen Netzbezugskosten
          beider Tarifmodelle gegenüber – je Tag und als Summe, jeweils auf den
          tatsächlichen Lastgang angewandt. So lässt sich abschätzen, welches
          Tarifmodell für den eigenen Verbrauch günstiger gewesen wäre, unabhängig
          vom aktuell eingestellten Tarif; die je Tag günstigere Variante ist
          farblich hervorgehoben.
        </p>
      </section>

      <section className="card">
        <h3>Stromerzeugung</h3>
        <p>
          Die Seite <strong>Stromerzeugung</strong> zeigt den Ertrag der
          einzelnen PV-Anlagen getrennt – oben als <strong>Tagesverlauf</strong>,
          darunter als <strong>Tagesbilanz im Monatsverlauf</strong>.
        </p>
        <p>
          Der <strong>Tagesverlauf</strong> stellt den Viertelstunden-Ertrag jeder
          Anlage gestapelt dar (kWh je Viertelstunde). Der Tag ist über die
          Pfeile wählbar, und einzelne Anlagen lassen sich über die Legende aus-
          und einblenden – genau wie beim gestapelten Verbraucher-Tagesverlauf.
          Die <strong>Monatsübersicht</strong> zeigt für jeden Tag den Gesamtertrag
          als gestapelte Balken (ein Segment je Anlage) plus eine Tabelle mit den
          Tageswerten und Monatssummen je Anlage. Ein Klick auf einen Tag – im
          Diagramm oder in der Tabelle – lädt ihn oben in den Tagesverlauf.
        </p>
        <p>
          Grundlage ist der je Anlage aufgezeichnete Ertrag: FLUX integriert
          die momentane Erzeugungsleistung jeder Anlage über die Zeit und schreibt
          sie je Viertelstunde fort. Berücksichtigt werden daher nur PV-Quellen,
          die einen <strong>Leistungswert</strong> liefern (ein Feld mit der Größe
          „Leistung" oder eine verknüpfte Leistungsquelle). Quellen, die
          ausschließlich einen <strong>Zählerstand</strong> melden, erscheinen hier
          nicht – für sie fehlt der momentane Leistungswert, den die Integration
          benötigt. Als Anlagen gelten Quellen mit der Rolle „PV-Erzeuger".
        </p>
      </section>

      <section className="card">
        <h3>Börsenstrompreis</h3>
        <p>
          Die <strong>Börsenstrompreis</strong>-Seite wertet den dynamischen
          Day-Ahead-Preis aus, mit besonderem Fokus auf negative Preise. Sie zeigt
          den Tagespreisverlauf sowie Kennzahlen und Statistiken: Anzahl negativer
          Stunden und Nullstunden, Tiefst- und Höchstpreis, durchschnittlicher
          Tagesspread, die Verteilung über Tagesstunden und Wochentage, eine
          Kalender-Heatmap sowie den täglichen Preisspread. Alle Kennzahlen werden
          selbstständig aus den gespeicherten Preisen berechnet. Im
          Tagespreisverlauf lässt sich mit den Pfeiltasten durch die Tage
          navigieren – sobald die Day-Ahead-Preise für den Folgetag abgerufen
          wurden (am Nachmittag), auch auf den morgigen Tag.
        </p>
        <p>
          Die Börsenpreise selbst ruft das Tool automatisch vom{" "}
          <strong>Day-Ahead-Markt der Strombörse</strong> ab, und zwar über die
          öffentliche API von <strong>Energy-Charts</strong> (Fraunhofer ISE) für
          die deutsch-luxemburgische Preiszone (DE-LU). Die Preisverläufe vom
          1.&nbsp;Januar&nbsp;2020 bis zum 1.&nbsp;August&nbsp;2026 sind bereits
          fest enthalten; nur darüber hinaus (neue Liefertage ab dem
          2.&nbsp;August&nbsp;2026) werden die Preise dynamisch nachgeladen –
          beim Start und danach stündlich. Über die <strong>Jahresauswahl</strong>
          oben auf der
          Seite lässt sich das Auswertungsjahr umschalten; die{" "}
          <strong>Vergleichstabelle</strong> ganz unten stellt die Kernkennzahlen
          aller Jahre unabhängig davon gegenüber – darunter der Anteil der Stunden
          mit negativem Preis sowie der Anteil mit Preis ≤ 0 (negativ oder null).
          Die maßgebliche Quelle ist{" "}
          <a
            href="https://www.energy-charts.info"
            target="_blank"
            rel="noopener noreferrer"
          >
            energy-charts.info
          </a>. Hinweis zur Zeitauflösung: Der deutsche Day-Ahead-Markt
          lieferte bis September 2025 <strong>stündliche</strong> Preise, seit
          Oktober 2025 <strong>viertelstündliche</strong>. Für einen fairen
          Jahresvergleich rechnet die Anlage ältere Stundenpreise intern auf
          Viertelstunden um (jeder Stundenwert gilt für seine vier
          Viertelstunden), sodass alle Jahre einheitlich ausgewertet werden. Auch
          die Tage der <strong>Zeitumstellung</strong> (Ende März und Ende
          Oktober) sind korrekt berücksichtigt: Sie haben je nach Umstellung eine
          Stunde weniger oder mehr (23 bzw. 25 Stunden, entsprechend weniger oder
          mehr Viertelstunden), was bei der Zählung negativer Stunden und den
          übrigen Kennzahlen sauber einfließt.
        </p>
      </section>

      <section className="card">
        <h3>Energy Sharing und Wirtschaftlichkeit</h3>
        <p>
          Die <strong>Energy-Sharing</strong>-Seite zeigt, wie der eigene
          Überschuss auf die §42c-Abnehmer verteilt wird und wie deren Verbrauch
          gedeckt wurde. Der Wirtschaftlichkeitsblock stellt den Energy-Sharing-
          Erlös der klassischen Einspeisung gegenüber und weist den finanziellen
          Mehrerlös je Tag, Monat und Jahr aus – so wird der Nutzen des Teilens
          unmittelbar in Euro sichtbar.
        </p>
      </section>

      <section className="card">
        <h3>Wasserverbrauch</h3>
        <p>
          Ist ein <strong>Wasserzähler</strong> als Quelle eingebunden, zeigt die
          Seite <strong>Details → Wasserverbrauch</strong> zwei Auswertungen: den{" "}
          <strong>Hausverbrauch im 15-Minuten-Takt</strong> für einen wählbaren Tag
          (in Litern) sowie die <strong>Tagesbilanz im Monatsverlauf</strong> mit
          den Tagesverbräuchen, einer Kostentabelle und dem Monatssummen. Die
          Tageskosten ergeben sich aus den unter „Stromtarif &amp; -anschluss"
          hinterlegten Wasserpreisen
          (Frischwasser und Abwasser je m³) zuzüglich des anteiligen monatlichen
          Grundpreises. Die Verbräuche werden aus den Zählerstandsdifferenzen
          berechnet; unplausible Sprünge (z. B. Zählerwechsel) werden dabei
          ausgefiltert.
        </p>
      </section>
    </div>
  );
}
