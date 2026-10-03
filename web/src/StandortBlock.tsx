// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useRef, useState } from "react";
import { nf } from "./chartUtils";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Standort aller PV-Anlagen (gemeinsam). Karte auf OpenStreetMap-Basis: per Klick
// eine Stecknadel setzen oder per Adresssuche (Nominatim) einen Ort finden; daraus
// werden Breiten-/Längengrad abgeleitet. Der Standort wird zentral gespeichert und
// von der Ertragsprognose (forecast.solar) genutzt.

interface Standort { lat: number; lon: number; label?: string }

// Leaflet-Marker-Icons via CDN (die gebundelten PNG-Pfade funktionieren mit Vite
// nicht ohne Weiteres; die offiziellen CDN-Assets sind stabil).
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

export function StandortBlock() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [standort, setStandort] = useState<Standort | null>(null);
  const [suche, setSuche] = useState("");
  const [suchBusy, setSuchBusy] = useState(false);
  const [suchErr, setSuchErr] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  // Standort laden.
  useEffect(() => {
    fetch("/api/pvanlagen/standort")
      .then((r) => r.json())
      .then((j) => { if (j?.ok && j.standort) setStandort(j.standort); })
      .catch(() => { /* ignore */ });
  }, []);

  // Karte initialisieren (einmal).
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const start: [number, number] = standort ? [standort.lat, standort.lon] : [51.163, 10.448]; // Mitte DE
    const map = L.map(mapEl.current).setView(start, standort ? 15 : 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap-Mitwirkende",
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      setPin(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    if (standort) setPin(standort.lat, standort.lon, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEl.current]);

  // Wenn Standort später geladen wird, Karte nachziehen.
  useEffect(() => {
    if (standort && mapRef.current) {
      mapRef.current.setView([standort.lat, standort.lon], 15);
      setPin(standort.lat, standort.lon, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standort?.lat, standort?.lon]);

  function setPin(lat: number, lon: number, updateState = true) {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lon]);
    } else {
      markerRef.current = L.marker([lat, lon], { icon: markerIcon, draggable: true }).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current!.getLatLng();
        setStandort((s) => ({ lat: p.lat, lon: p.lng, label: s?.label }));
      });
    }
    if (updateState) setStandort((s) => ({ lat, lon, label: s?.label }));
  }

  async function adresseSuchen() {
    const q = suche.trim();
    if (!q) return;
    setSuchBusy(true); setSuchErr("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { "Accept-Language": "de" } });
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const lat = Number(arr[0].lat), lon = Number(arr[0].lon);
        const label = String(arr[0].display_name ?? q);
        mapRef.current?.setView([lat, lon], 15);
        setPin(lat, lon, false);
        setStandort({ lat, lon, label });
      } else {
        setSuchErr("Keine Treffer für diese Adresse.");
      }
    } catch {
      setSuchErr("Adresssuche fehlgeschlagen (keine Verbindung?).");
    } finally {
      setSuchBusy(false);
    }
  }

  function speichern() {
    if (!standort) return;
    fetch("/api/pvanlagen/standort", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: standort.lat, lon: standort.lon, label: standort.label ?? "" }),
    })
      .then((r) => r.json())
      .then((j) => {
        setSaveMsg(j?.ok ? "Standort gespeichert" : "Speichern fehlgeschlagen");
        setTimeout(() => setSaveMsg(""), 1800);
      })
      .catch(() => { setSaveMsg("Speichern fehlgeschlagen"); setTimeout(() => setSaveMsg(""), 1800); });
  }

  return (
    <section className="card pv-standort-block">
      <h3>Standortinformationen</h3>
      <p className="hint">
        Alle PV-Anlagen stehen am selben Standort. Suche unten nach einer Adresse
        oder setze die Stecknadel direkt auf der Karte – daraus werden Breiten- und
        Längengrad ermittelt. Der Standort wird für die Ertragsprognose
        (forecast.solar) verwendet.
      </p>

      <div className="pv-standort-suche">
        <input
          type="text"
          value={suche}
          placeholder="Adresse suchen (z. B. Straße, PLZ, Ort)"
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") adresseSuchen(); }}
        />
        <button onClick={adresseSuchen} disabled={suchBusy}>{suchBusy ? "Suche …" : "Suchen"}</button>
      </div>
      {suchErr && <p className="pv-err">{suchErr}</p>}

      <div ref={mapEl} className="pv-standort-karte" />

      <div className="pv-standort-koords">
        {standort ? (
          <>
            <span>Breitengrad: <strong>{nf(standort.lat, 5)}</strong></span>
            <span>Längengrad: <strong>{nf(standort.lon, 5)}</strong></span>
            {standort.label && <span className="pv-standort-label">{standort.label}</span>}
          </>
        ) : (
          <span className="hint">Noch kein Standort gesetzt – Karte anklicken oder Adresse suchen.</span>
        )}
        <button className="pv-standort-save" onClick={speichern} disabled={!standort}>Standort speichern</button>
        {saveMsg && <span className="pv-save-msg">{saveMsg}</span>}
      </div>
    </section>
  );
}
