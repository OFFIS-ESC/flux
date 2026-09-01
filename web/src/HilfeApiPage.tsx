// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Hilfeseite: Übersicht aller im Browser aufrufbaren API-Endpunkte, nach
// Themen gruppiert und mit erweiterter Erklärung. Jeder Endpunkt ist klickbar
// und öffnet sich in einem neuen Tab (relativer Link auf denselben Host/Port).

type Ep = {
  path: string;          // relativer Pfad, z.B. "/api/state"
  desc: string;          // Erklärung
  params?: string;       // optionale Query-Parameter (Anzeige)
  sample?: string;       // aufrufbarer Beispielpfad (falls Parameter nötig)
};

function heute(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function monat(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function jahr(): string {
  return String(new Date().getFullYear());
}

function ApiLink({ ep }: { ep: Ep }) {
  const href = ep.sample ?? ep.path;
  return (
    <li className="api-ep">
      <a href={href} target="_blank" rel="noopener noreferrer" className="api-ep-link">
        <code>{ep.path}</code>
      </a>
      {ep.params && <span className="api-ep-params">?{ep.params}</span>}
      <div className="api-ep-desc">{ep.desc}</div>
    </li>
  );
}

function ApiGroup({ title, note, eps }: { title: string; note?: string; eps: Ep[] }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {note && <p className="hint">{note}</p>}
      <ul className="api-ep-list">
        {eps.map((ep) => <ApiLink key={ep.path} ep={ep} />)}
      </ul>
    </section>
  );
}

// Schreibende Endpunkte werden NICHT verlinkt (ein versehentlicher Aufruf per
// Klick könnte Daten verändern). Sie werden nur informativ mit Methode und
// Kurzbeschreibung aufgeführt.
type WriteEp = { method: "POST" | "PUT" | "DELETE"; path: string; desc: string };

function WriteEndpoint({ ep }: { ep: WriteEp }) {
  return (
    <li className="api-ep api-ep-write">
      <span className={`api-ep-method api-ep-method-${ep.method.toLowerCase()}`}>{ep.method}</span>
      <code className="api-ep-wpath">{ep.path}</code>
      <div className="api-ep-desc">{ep.desc}</div>
    </li>
  );
}

function WriteGroup({ title, eps }: { title: string; eps: WriteEp[] }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      <ul className="api-ep-list">
        {eps.map((ep) => <WriteEndpoint key={ep.method + ep.path} ep={ep} />)}
      </ul>
    </section>
  );
}

export function HilfeApiPage() {
  const d = heute();
  const m = monat();
  const j = jahr();

  return (
    <div className="page hilfe-page">
      <h2>API-Endpunkte</h2>
      <p className="hint">
        Alle hier gelisteten Endpunkte lassen sich direkt im Browser aufrufen und
        liefern JSON zurück. Ein Klick öffnet den Endpunkt in einem neuen Tab –
        bei Endpunkten mit Parametern wird ein Beispiel mit dem heutigen Datum bzw.
        dem aktuellen Zeitraum vorbelegt. Die Parameter sind jeweils als{" "}
        <code>?name=…</code> angegeben und können in der Adresszeile angepasst
        werden. Endpunkte, die Daten speichern oder ändern (POST/PUT/DELETE),
        sind hier nicht enthalten – sie werden von den jeweiligen Programmseiten
        genutzt.
      </p>

      <ApiGroup
        title="Live-Zustand & System"
        note="Der aktuelle Zustand der Anlage und allgemeine Systeminformationen."
        eps={[
          { path: "/api/state", desc: "Kompletter aktueller Zustand: Live-Werte, Tageswerte, alle Speicher und Verbraucher. Speist die Gesamtübersicht." },
          { path: "/api/version", desc: "Aktuelle Programmversion." },
          { path: "/api/diag", desc: "Diagnose- und Debug-Informationen zum internen Systemzustand (Anker, Akkumulatoren, Zählerstände)." },
          { path: "/api/logs", desc: "Protokolleinträge (Meldungen, Warnungen, Fehler) des Systems." },
          { path: "/api/stream", desc: "Fortlaufender Ereignisstrom (Server-Sent Events). Liefert keine einmalige Antwort, sondern kontinuierliche Aktualisierungen – im Browser als Dauerverbindung sichtbar." },
        ]}
      />

      <ApiGroup
        title="Verbrauch & Räume"
        note="Tagesverbräuche einzelner Geräte, Räume und der Gesamtanlage."
        eps={[
          { path: "/api/consumers/day", params: "date=YYYY-MM-DD", sample: `/api/consumers/day?date=${d}`, desc: "Tagesverbräuche aller Verbraucher und Speicher (inkl. deaktivierter). Ohne date der heutige Tag." },
          { path: "/api/consumer/<id>/day", params: "date=YYYY-MM-DD", desc: "Viertelstunden-Tagesverlauf eines einzelnen Verbrauchers (id einsetzen)." },
          { path: "/api/consumer/<id>/range", params: "gran=monat|jahr&date=YYYY-MM-DD", desc: "Aggregierter Verbrauch eines Geräts über Monat (Tagesbalken) oder Jahr (Monatsbalken), inkl. Summe; bei Speichern getrennt Bezug/Einspeisung." },
          { path: "/api/room/day", params: "room=<name>&date=YYYY-MM-DD", desc: "Tagesverlauf aller Geräte eines Raums." },
          { path: "/api/rooms", desc: "Liste aller konfigurierten Räume." },
          { path: "/api/switchable", desc: "Schaltbare Verbraucher (für Automatisierung/Steuerung)." },
        ]}
      />

      <ApiGroup
        title="Erzeugung & PV-Prognose"
        note="PV-Ertrag der Anlagen sowie die Ertragsprognose über forecast.solar."
        eps={[
          { path: "/api/pv/day", params: "date=YYYY-MM-DD", sample: `/api/pv/day?date=${d}`, desc: "PV-Ertrag im Viertelstunden-Tagesverlauf, je Anlage aufgeschlüsselt." },
          { path: "/api/pv/month", params: "month=YYYY-MM", sample: `/api/pv/month?month=${m}`, desc: "PV-Ertrag je Tag über den Monat (Tagesbilanz im Monatsverlauf)." },
          { path: "/api/pvanlagen", desc: "Konfigurierte PV-Anlagen mit Strings (Leistung, Ausrichtung, Neigung)." },
          { path: "/api/pvanlagen/forecast", desc: "Rohprognose direkt von forecast.solar (je Anlage/String)." },
          { path: "/api/pvanlagen/prognose", desc: "Aufbereitete Ertragsprognose: heute, morgen und Rest des heutigen Tages." },
          { path: "/api/pvanlagen/prognose/historie", desc: "Gespeicherte, zurückliegende Prognosen." },
          { path: "/api/pvanlagen/prognose/verlauf", params: "date=YYYY-MM-DD", desc: "Prognostizierter Ertragsverlauf eines Tages (Slots)." },
          { path: "/api/pvanlagen/prognose/skalierung", desc: "Aktueller Skalierungsfaktor (Anpassung der Prognose an die reale Produktion)." },
          { path: "/api/pvanlagen/prognose/skalierung/einstellung", desc: "Ob die Skalierung aktiv ist (Ein-/Aus-Einstellung)." },
          { path: "/api/pvanlagen/standort", desc: "Gemeinsamer Standort aller PV-Anlagen (Breiten-/Längengrad)." },
        ]}
      />

      <ApiGroup
        title="Speicher"
        note="Status und Auswertung der AC- und DC-Speicher."
        eps={[
          { path: "/api/acspeicher/status", desc: "Status aller AC-Speicher inkl. Marstek-Batteriemodul-Status (Ladestand, Zellspannungen)." },
          { path: "/api/dcspeicher/status", desc: "Status der DC-Speicher." },
          { path: "/api/marstek/status", desc: "Marstek-spezifischer Detailstatus." },
          { path: "/api/acspeicher/modbus-list", desc: "Liste der per Modbus angebundenen AC-Speicher." },
          { path: "/api/acspeicher/modbus/control-status", desc: "Steuerungsstatus (Lade-/Entlademodus) der Modbus-Speicher." },
          { path: "/api/speicherverluste", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD&granularitaet=monat|tag", sample: `/api/speicherverluste?von=${j}-01-01&bis=${d}&granularitaet=monat`, desc: "Wirkungsgrad und Speicherverluste je Speicher über einen Zeitraum (erst AC-, dann DC-Speicher)." },
        ]}
      />

      <ApiGroup
        title="Netz, Kosten & Börse"
        note="Tagesbilanzen, Stromabrechnung und Börsenstrompreise."
        eps={[
          { path: "/api/history/all", desc: "Komplette Tages-History inkl. laufendem Tag: Verbrauch, Eigenverbrauch, Netzbezug, Einspeisung, Autarkie und Kosten." },
          { path: "/api/abrechnung", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", sample: `/api/abrechnung?von=${m}-01&bis=${d}`, desc: "Stromabrechnung (Bezugskosten, Vergütung, Fixkostenanteile) für einen Zeitraum." },
          { path: "/api/tarifvergleich", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", sample: `/api/tarifvergleich?von=${m}-01&bis=${d}`, desc: "Vergleich Fixtarif gegen dynamischen Tarif über den Zeitraum." },
          { path: "/api/spotpreise", params: "date=YYYY-MM-DD", sample: `/api/spotpreise?date=${d}`, desc: "Day-Ahead-Spotpreise eines Tages (Viertelstunden)." },
          { path: "/api/spotpreise/latest", desc: "Der zuletzt bekannte Spotpreis-Tag." },
          { path: "/api/spotpreise/dates", desc: "Alle Tage, für die Spotpreise vorliegen." },
          { path: "/api/boerse/statistik", params: "jahr=YYYY", sample: `/api/boerse/statistik?jahr=${j}`, desc: "Börsenpreis-Statistik: Durchschnitt (netto/brutto), Spread, negative Preise, Verteilungen." },
        ]}
      />

      <ApiGroup
        title="Wärmepumpe & Wasser"
        eps={[
          { path: "/api/waermepumpe/day", params: "date=YYYY-MM-DD", sample: `/api/waermepumpe/day?date=${d}`, desc: "Tagesverlauf der Wärmepumpen-Messreihen." },
          { path: "/api/waermepumpe/kpi", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", sample: `/api/waermepumpe/kpi?von=${m}-01&bis=${d}`, desc: "Kennzahlen der Wärmepumpe über den Zeitraum: Kompressor-Laufzeit, Heiz-/WW-/Kühl-Anteile, Energiebedarf (gesamt/Standby/je Betriebsart), Wärme (gesamt/Heizen/Warmwasser) und Kälte, COP, Takte, Abtauungen, PV-Abdeckung." },
          { path: "/api/waermepumpe/kpi/monat", params: "month=YYYY-MM", sample: `/api/waermepumpe/kpi/monat?month=${m}`, desc: "Wärmepumpen-Kennzahlen je Tag über einen Monat (Energie/Wärme je Betriebsart, Takte, Abtauungen, Kompressor-Laufzeit, PV-Deckung) – für die Monats-Diagramme der Kennzahlen-Auswertung." },
          { path: "/api/waermepumpe/prefs", desc: "Einstellungen/Präferenzen der Wärmepumpen-Auswertung." },
          { path: "/api/warmwasser/kpi", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", sample: `/api/warmwasser/kpi?von=${m}-01&bis=${d}`, desc: "Warmwasser-Kennzahlen über den Zeitraum: Tage und Anteile je Erzeugungsart (Wärmepumpe/Heizstab/Solarthermie), Energie von Heizstab, WP-Warmwasser und Solarthermie sowie die aktuell gespeicherte thermische Energie (speicherWaerme)." },
          { path: "/api/warmwasser/waermeformel", desc: "Aktuelle Formel für die gespeicherte thermische Energie (mit Default)." },
          { path: "/api/warmwasser/verlauf", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", sample: `/api/warmwasser/verlauf?von=${m}-01&bis=${d}`, desc: "Temperaturverlauf des Warmwasserspeichers (oben/unten) samt Aktivitätsintervallen der Erzeuger (Wärmepumpe/Heizstab/Solarthermie) für die farbigen Overlays." },
          { path: "/api/wasser/tag", params: "date=YYYY-MM-DD", sample: `/api/wasser/tag?date=${d}`, desc: "Wasserverbrauch im Tagesverlauf." },
          { path: "/api/wasser/monat", params: "month=YYYY-MM", sample: `/api/wasser/monat?month=${m}`, desc: "Wasserverbrauch je Tag über den Monat." },
          { path: "/api/wasser/stand", desc: "Aktueller Zählerstand des Wasserzählers." },
        ]}
      />

      <ApiGroup
        title="Energy Sharing"
        note="Gemeinschaftliche Energienutzung nach §42c."
        eps={[
          { path: "/api/sharing", desc: "Aktuelle Energy-Sharing-Daten." },
          { path: "/api/sharing/analysis", params: "jahr=YYYY", sample: `/api/sharing/analysis?jahr=${j}`, desc: "Jahresauswertung des Energy Sharings." },
          { path: "/api/abnehmer", desc: "Konfigurierte §42c-Abnehmer." },
        ]}
      />

      <ApiGroup
        title="Konfiguration & Quellen"
        note="Konfigurierte Geräte, Regeln und Programmstruktur (nur lesend)."
        eps={[
          { path: "/api/sources", desc: "Alle konfigurierten Quellen (Zähler, Wechselrichter, Speicher, Verbraucher)." },
          { path: "/api/source-links", desc: "Verknüpfungen zwischen Quellen (z.B. Leistungsquelle einer Anlage)." },
          { path: "/api/sinks", desc: "Konfigurierte Senken (emulierte Zähler nach außen)." },
          { path: "/api/exthems/groessen", desc: "Kuratierte Liste der an externe HEMS bereitstellbaren Größen + erlaubte Formel-Variablen." },
          { path: "/api/eebus/state", desc: "Aktueller Zustand der EEBUS-Anbindung (Verbindung, Limits §14a/§9, Failsafe, Heartbeat)." },
          { path: "/api/eebus/log", params: "limit", sample: "/api/eebus/log?limit=200", desc: "Ereignis-Protokoll der empfangenen EEBUS-Steuerbefehle." },
          { path: "/api/eebus/sidecar/status", desc: "Status des EEBUS-Sidecars (eigener SKI, Verbindung zur Steuerbox)." },
          { path: "/api/lppcontrol/config", desc: "Konfiguration, Regelstatus und Protokoll der §9-Einspeisedrosselung (Live-Regelung mehrerer Wechselrichter)." },
          { path: "/api/lppcontrol/erkennen", desc: "Steuerbare Wechselrichter automatisch aus den Quellen erkennen (Growatt/Hoymiles)." },
          { path: "/api/lpcmonitor/config", desc: "§14a-Überwachung: SteuVE-Liste, Live-Status (Summenbezug gegen Limit) und Protokoll." },
          { path: "/api/settings/sections", desc: "Verfügbare Einstellungsbereiche." },
          { path: "/api/menu", desc: "Gespeicherte Menüstruktur (Reihenfolge/Gruppierung)." },
          { path: "/api/tileorder", desc: "Gespeicherte Reihenfolge der sortierbaren Kachel-Bereiche (Drag&Drop)." },
          { path: "/api/rules", desc: "Automatisierungsregeln." },
          { path: "/api/rule-groups", desc: "Gruppen von Automatisierungsregeln." },
          { path: "/api/rules/running", desc: "Aktuell laufende bzw. scharfe Regeln." },
          { path: "/api/rules/log", desc: "Protokoll der ausgelösten Regeln." },
          { path: "/api/push-variables", desc: "Verfügbare Platzhalter/Variablen für Benachrichtigungen." },
        ]}
      />

      <ApiGroup
        title="Lastprofile, Erzeugerprofile & Daten"
        note="Referenzprofile und Rohdaten-/Exportfunktionen."
        eps={[
          { path: "/api/profiles", desc: "Verfügbare Lastprofile." },
          { path: "/api/profiles/<name>/day", params: "date=YYYY-MM-DD&jv=<Jahresverbrauch>", desc: "Tagesverlauf eines Lastprofils, skaliert auf einen Jahresverbrauch." },
          { path: "/api/genprofiles", desc: "Verfügbare Erzeugerprofile." },
          { path: "/api/genprofiles/<name>/day", params: "date=YYYY-MM-DD&kwp=<kWp>", desc: "Tagesverlauf eines Erzeugerprofils, skaliert auf eine Anlagenleistung." },
          { path: "/api/viertelstunden", params: "date=YYYY-MM-DD", sample: `/api/viertelstunden?date=${d}`, desc: "Rohe Viertelstundenwerte (Bezug, Einspeisung, Eigenverbrauch) eines Tages." },
          { path: "/api/data/calendar", desc: "Kalenderübersicht der Tage mit gespeicherten Daten." },
          { path: "/api/data/day", params: "date=YYYY-MM-DD", desc: "Alle gespeicherten Rohdaten eines einzelnen Tages." },
          { path: "/api/data/export", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", desc: "Datenexport der Anlage über einen Zeitraum (alle Zeitreihen-Tabellen inkl. Wärmepumpen-Kennzahlen)." },
          { path: "/api/data/export/preview", params: "von=YYYY-MM-DD&bis=YYYY-MM-DD", desc: "Vorschau des Datenexports: Anzahl der Datensätze je Tabelle im Zeitraum, ohne die Daten selbst zu übertragen." },
          { path: "/api/data/sql/schema", desc: "Schema der internen Datenbank (Tabellen/Spalten)." },
        ]}
      />

      <ApiGroup
        title="Perioden & Tarife"
        note="Zeitlich gültige Tarif-/Zählerperioden."
        eps={[
          { path: "/api/perioden/stromtarif", desc: "Stromtarif-Perioden (z.B. bei Anbieter-/Preiswechsel)." },
          { path: "/api/perioden/wasser", desc: "Wassertarif-Perioden." },
          { path: "/api/perioden/modul1", desc: "§14a-Modul-1-Perioden." },
          { path: "/api/perioden/modul3", desc: "§14a-Modul-3-Perioden (zeitvariables Netzentgelt)." },
        ]}
      />
      <div className="api-write-divider">
        <h2>Schreibende Aktionen (POST / PUT / DELETE)</h2>
        <p className="hint">
          Die folgenden Endpunkte verändern Daten oder lösen Aktionen aus und sind
          daher bewusst <strong>nicht anklickbar</strong> – sie werden von den
          jeweiligen Programmseiten mit den passenden Daten aufgerufen. Diese
          Übersicht dient nur der Dokumentation. Ein direkter Aufruf ohne die
          erwarteten Daten kann fehlschlagen oder ungewollte Änderungen bewirken.
        </p>
      </div>

      <WriteGroup
        title="Quellen, Senken & Konfiguration"
        eps={[
          { method: "POST", path: "/api/sources", desc: "Quellenliste speichern (anlegen/ändern/löschen über die komplette Liste)." },
          { method: "POST", path: "/api/sources/test", desc: "Eine Quelle testweise abfragen (Verbindungsprüfung)." },
          { method: "POST", path: "/api/switch/test", desc: "Einen schaltbaren Verbraucher testweise ein-/ausschalten." },
          { method: "POST", path: "/api/sinks", desc: "Senken (emulierte Zähler) speichern." },
          { method: "POST", path: "/api/exthems/formel/check", desc: "Formel-Größe fürs externe HEMS gegen erlaubte Variablen prüfen." },
          { method: "POST", path: "/api/exthems/beschreibung", desc: "Verständliche Schnittstellenbeschreibung für eine extHems-Senke erzeugen." },
          { method: "POST", path: "/api/eebus/config", desc: "EEBUS-Anbindung konfigurieren (aktivieren, SKI, Failsafe-Werte)." },
          { method: "POST", path: "/api/eebus/simulate", desc: "Steuerbefehl simulieren (Test ohne echte Steuerbox)." },
          { method: "POST", path: "/api/eebus/log/clear", desc: "EEBUS-Ereignisprotokoll leeren." },
          { method: "POST", path: "/api/eebus/ingest", desc: "Empfangsschnittstelle für den EEBUS-Sidecar (meldet Limits/Heartbeat/Verbindung)." },
          { method: "POST", path: "/api/eebus/sidecar/config", desc: "Steuerbox-SKI an den EEBUS-Sidecar weiterreichen." },
          { method: "POST", path: "/api/lppcontrol/config", desc: "§9-Umsetzung konfigurieren (Wechselrichter-Liste in Drosselreihenfolge, Dry-Run/Scharf, Limit-Typ)." },
          { method: "POST", path: "/api/lppcontrol/test", desc: "Test-Schreibvorgang für einen Wechselrichter (invId + prozent, respektiert Dry-Run)." },
          { method: "POST", path: "/api/lpcmonitor/config", desc: "§14a-Überwachung konfigurieren (SteuVE-Liste, Warnschwelle, aktiv)." },
          { method: "POST", path: "/api/sinks/formula/check", desc: "Senken-Formel auf Gültigkeit prüfen." },
          { method: "POST", path: "/api/sinks/register-ct", desc: "Einen CT-Zähler bei der Emulation registrieren." },
          { method: "POST", path: "/api/sinks/ctfade", desc: "Fadeout (kontrolliertes Herunterfahren) einer CT-Senke schalten." },
          { method: "POST", path: "/api/sinks/ctnoac", desc: "Modus 'kein AC-Laden' einer CT-Senke schalten." },
          { method: "POST", path: "/api/speicher/reorder", desc: "Reihenfolge der Speicher ändern." },
          { method: "POST", path: "/api/rooms", desc: "Räume speichern." },
          { method: "POST", path: "/api/menu", desc: "Menüstruktur speichern." },
          { method: "DELETE", path: "/api/menu", desc: "Menüstruktur auf Standard zurücksetzen." },
          { method: "POST", path: "/api/tileorder", desc: "Reihenfolge eines Kachel-Bereichs speichern (bereich + ids)." },
          { method: "DELETE", path: "/api/tileorder", desc: "Kachel-Reihenfolge zurücksetzen (optional ?bereich=…, sonst alle)." },
        ]}
      />

      <WriteGroup
        title="Kosten, Tarife & Perioden"
        eps={[
          { method: "POST", path: "/api/setCosts", desc: "Kosten-/Tarifeinstellungen speichern." },
          { method: "POST", path: "/api/energySettings", desc: "Energiebezogene Einstellungen speichern." },
          { method: "POST", path: "/api/perioden/stromtarif", desc: "Stromtarif-Perioden speichern." },
          { method: "POST", path: "/api/perioden/wasser", desc: "Wassertarif-Perioden speichern." },
          { method: "POST", path: "/api/perioden/modul1", desc: "§14a-Modul-1-Perioden speichern." },
          { method: "POST", path: "/api/perioden/modul3", desc: "§14a-Modul-3-Perioden speichern." },
        ]}
      />

      <WriteGroup
        title="PV-Anlagen & Prognose"
        eps={[
          { method: "POST", path: "/api/pvanlagen", desc: "PV-Anlagenkonfiguration speichern." },
          { method: "POST", path: "/api/pvanlagen/standort", desc: "Gemeinsamen Standort speichern." },
          { method: "POST", path: "/api/pvanlagen/prognose/skalierung/einstellung", desc: "Prognose-Skalierung ein-/ausschalten." },
        ]}
      />

      <WriteGroup
        title="Speicher-Steuerung"
        eps={[
          { method: "POST", path: "/api/marstek/mode", desc: "Betriebsmodus eines Marstek-Speichers setzen." },
          { method: "POST", path: "/api/acspeicher/zendure/mode", desc: "Betriebsmodus eines Zendure-Speichers setzen." },
          { method: "POST", path: "/api/acspeicher/modbus/force", desc: "Modbus-Steuerwert erzwingen (Diagnose)." },
          { method: "POST", path: "/api/acspeicher/modbus/backup", desc: "Modbus-Registerabbild sichern." },
        ]}
      />

      <WriteGroup
        title="Automatisierung & Benachrichtigung"
        eps={[
          { method: "POST", path: "/api/rules", desc: "Automatisierungsregeln speichern." },
          { method: "POST", path: "/api/rule-groups", desc: "Regelgruppen speichern." },
          { method: "POST", path: "/api/rules/<id>/trigger", desc: "Eine Regel manuell auslösen." },
          { method: "POST", path: "/api/rules/trigger-daily-test", desc: "Täglichen Auslöser testweise anstoßen." },
          { method: "POST", path: "/api/notify", desc: "Benachrichtigungseinstellungen speichern." },
          { method: "POST", path: "/api/notify/test", desc: "Test-Benachrichtigung senden." },
        ]}
      />

      <WriteGroup
        title="Profile & Wärmepumpe"
        eps={[
          { method: "POST", path: "/api/profiles", desc: "Lastprofil hochladen/speichern." },
          { method: "DELETE", path: "/api/profiles/<name>", desc: "Lastprofil löschen." },
          { method: "POST", path: "/api/genprofiles", desc: "Erzeugerprofil hochladen/speichern." },
          { method: "DELETE", path: "/api/genprofiles/<name>", desc: "Erzeugerprofil löschen." },
          { method: "POST", path: "/api/waermepumpe/prefs", desc: "Wärmepumpen-Einstellungen speichern." },
          { method: "POST", path: "/api/warmwasser/waermeformel", desc: "Formel für die gespeicherte thermische Energie speichern (Variablen T_u, T_o; wird syntaktisch geprüft)." },
        ]}
      />

      <WriteGroup
        title="Daten, Import/Export & Wartung"
        eps={[
          { method: "POST", path: "/api/data/import", desc: "Daten importieren." },
          { method: "POST", path: "/api/data/import/inspect", desc: "Import-Datei vorab prüfen (ohne zu schreiben)." },
          { method: "POST", path: "/api/data/delete", desc: "Datenbereich löschen." },
          { method: "POST", path: "/api/data/sql", desc: "SQL-Abfrage ausführen (Datenverwaltung)." },
          { method: "POST", path: "/api/deleteMonth", desc: "Einen Monat an Daten löschen." },
          { method: "POST", path: "/api/settings/export", desc: "Einstellungen exportieren." },
          { method: "POST", path: "/api/settings/import", desc: "Einstellungen importieren." },
          { method: "POST", path: "/api/settings/import/inspect", desc: "Einstellungs-Import vorab prüfen." },
          { method: "POST", path: "/api/spotpreise/reload", desc: "Spotpreise neu laden." },
          { method: "POST", path: "/api/sharing/config", desc: "Energy-Sharing-Konfiguration speichern." },
          { method: "POST", path: "/api/abnehmer", desc: "§42c-Abnehmer speichern." },
          { method: "POST", path: "/api/newDay", desc: "Tageswechsel manuell auslösen (Wartung)." },
          { method: "POST", path: "/api/resetTagesstatistiken", desc: "Tagesstatistiken zurücksetzen." },
          { method: "POST", path: "/api/resetDrosselungen", desc: "Drosselungs-Tracking zurücksetzen." },
          { method: "POST", path: "/api/logs/level", desc: "Log-Level setzen." },
          { method: "DELETE", path: "/api/logs", desc: "Protokoll löschen." },
        ]}
      />
    </div>
  );
}
