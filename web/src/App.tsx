// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useState, useEffect } from "react";
import { useLiveState } from "./useLiveState";
import { applyFontSizes } from "./fontSizes";
import { useRoute } from "./useRoute";
import { Menu } from "./Menu";
import { Diagram } from "./Diagram";
import { RunningRuleTiles } from "./RunningRuleTiles";
import { VerbraucherPage } from "./VerbraucherPage";
import { WaermepumpePage } from "./WaermepumpePage";
import { WarmwasserPage } from "./WarmwasserPage";
import { AcSpeicherPage } from "./AcSpeicherPage";
import { KameraPage } from "./KameraPage";
import { StatusPage } from "./StatusPage";
import { SettingsPage } from "./SettingsPage";
import { QuellenPage } from "./QuellenPage";
import { PvAnlagenPage } from "./PvAnlagenPage";
import { SenkenPage } from "./SenkenPage";
import { EebusPage } from "./EebusPage";
import { AnomaliePage } from "./AnomaliePage";
import { LastprofilePage } from "./LastprofilePage";
import { ErzeugerprofilePage } from "./ErzeugerprofilePage";
import { DebugPage } from "./DebugPage";
import { VisualisierungPage } from "./VisualisierungPage";
import { ImportExportPage } from "./ImportExportPage";
import { DatenverwaltungPage } from "./DatenverwaltungPage";
import { BenachrichtigungenPage } from "./BenachrichtigungenPage";
import { AutomatisierungPage } from "./AutomatisierungPage";
import { WasserverbrauchPage } from "./WasserverbrauchPage";
import { StromverbrauchPage } from "./StromverbrauchPage";
import { StromerzeugungPage } from "./StromerzeugungPage";
import { EnergySharingPage } from "./EnergySharingPage";
import { HilfeKonzeptPage, HilfeKonfigurationPage, HilfeAuswertungPage } from "./HilfePages";
import { HilfeApiPage } from "./HilfeApiPage";
import { BoersenstrompreisPage } from "./BoersenstrompreisPage";
import { WetterPage } from "./WetterPage";
import { ZugangskontrollePage } from "./ZugangskontrollePage";
import { ElektroautoPage } from "./ElektroautoPage";
import { RueckblickPage } from "./RueckblickPage";
import "./app.css";

export default function App() {
  const { state, connected, attempts } = useLiveState();
  const [route, navigate] = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  // Bei jedem Seitenwechsel an den Seitenanfang springen – sonst übernimmt die
  // neue Seite die Scroll-Position der vorherigen (fällt v.a. bei langen Seiten
  // wie den Hilfeseiten auf, die dann scheinbar „unten" beginnen).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  // Konfigurierte Schriftgrößen als CSS-Variablen anwenden, sobald die Settings
  // vorliegen oder sich ändern (Desktop auf :root, Mobil via Media-Query).
  useEffect(() => {
    if (state?.settings?.fontSizes) applyFontSizes(state.settings.fontSizes);
  }, [state?.settings?.fontSizes]);

  if (!state) {
    if (attempts >= 2) {
      return (
        <div className="loading">
          <p style={{ color: "#c0392b" }}>Backend nicht erreichbar.</p>
          <p style={{ fontSize: 15, color: "#555" }}>
            Läuft der Server? In einem zweiten Terminal:
            <br />
            <code>cd server &amp;&amp; npm run dev</code>
            <br />
            Erwartet: „FLUX läuft auf http://localhost:3000"
          </p>
          <p style={{ fontSize: 13, color: "#888" }}>
            Verbindungsversuche: {attempts}
          </p>
        </div>
      );
    }
    return <div className="loading">Verbinde mit FLUX…</div>;
  }

  return (
    <div className="app">
      <Menu
        route={route}
        navigate={navigate}
        connected={connected}
        open={menuOpen}
        setOpen={setMenuOpen}
        hasMarstek={(state.sources ?? []).some((s) => (s.role === "acBattery" || s.role === "dcBattery") && s.enabled)}
        hasSecuritySpy={(state.sources ?? []).some((s) => s.role === "securitySpy" && s.enabled)}
        hasAccessReader={(state.sources ?? []).some((s) => s.role === "accessReader" && s.enabled)}
        hasEvcc={(state.sources ?? []).some((s) => s.role === "evcc" && s.enabled)}
      />

      <main className="content">
        {route === "" && <><Diagram state={state} /><RunningRuleTiles /></>}
        {route === "verbraucher" && <VerbraucherPage state={state} />}
        {route === "waermepumpe" && <WaermepumpePage />}
        {route === "warmwasser" && <WarmwasserPage />}
        {route === "marstek" && <AcSpeicherPage />}
        {route === "kameras" && <KameraPage />}
        {route === "status" && <StatusPage state={state} />}
        {route === "energiekosten" && <SettingsPage state={state} />}
        {route === "quellen" && <QuellenPage />}
        {route === "pvanlagen" && <PvAnlagenPage />}
        {route === "senken" && <SenkenPage />}
        {route === "eebus" && <EebusPage />}
        {route === "anomalie" && <AnomaliePage />}
        {route === "lastprofile" && <LastprofilePage state={state} />}
        {route === "erzeugerprofile" && <ErzeugerprofilePage state={state} />}
        {route === "debug" && <DebugPage />}
        {route === "visualisierung" && <VisualisierungPage state={state} />}
        {route === "importexport" && <ImportExportPage />}
        {route === "datenverwaltung" && <DatenverwaltungPage />}
        {route === "benachrichtigungen" && <BenachrichtigungenPage />}
        {route === "automatisierung" && <AutomatisierungPage />}
        {route === "wasserverbrauch" && <WasserverbrauchPage />}
        {route === "stromverbrauch" && <StromverbrauchPage state={state} />}
        {route === "stromerzeugung" && <StromerzeugungPage />}
        {route === "boersenstrompreis" && <BoersenstrompreisPage state={state} />}
        {route === "wetter" && <WetterPage />}
        {route === "zugangskontrolle" && <ZugangskontrollePage state={state} />}
        {route === "elektroauto" && <ElektroautoPage />}
        {route === "rueckblick" && <RueckblickPage />}
        {route === "energysharing" && <EnergySharingPage state={state} />}
        {route === "hilfe-konzept" && <HilfeKonzeptPage />}
        {route === "hilfe-konfiguration" && <HilfeKonfigurationPage />}
        {route === "hilfe-auswertung" && <HilfeAuswertungPage />}
        {route === "hilfe-api" && <HilfeApiPage />}
      </main>
    </div>
  );
}
