// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useRef, useState } from "react";
import { nf } from "./chartUtils";
import diagramUrl from "./diagram.svg";
import { pos } from "./positions";
import type { FullState } from "./types";

const DIAGRAM_WIDTH = 800; // intrinsische Breite des Diagramms

// Zahl mit fester Nachkommastelle wie Arduinos String(float) (2 Stellen).
// Robust gegen null/undefined/NaN, damit ein einzelner fehlender Wert
// nie das gesamte Rendering abbricht.
const f2 = (n: number | null | undefined) =>
  nf(Number.isFinite(n as number) ? (n as number) : 0, 2);
const i0 = (n: number | null | undefined) =>
  Math.trunc(Number.isFinite(n as number) ? (n as number) : 0).toString();

export function Diagram({ state }: { state: FullState }) {
  const { live: l, day: d, time } = state;

  // Responsive Skalierung: Diagramm bleibt intern 800px (Overlays sitzen
  // pixelgenau), wird aber per transform:scale auf die Containerbreite
  // heruntergerechnet. ResizeObserver ist zuverlässiger als CSS-vw-Einheiten.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setScale(Math.min(1, w / DIAGRAM_WIDTH));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Prognostizierter Rest-PV-Ertrag des heutigen Tages (aus gespeicherter
  // Prognose). Wird für die Anzeige unter dem Strompreis genutzt, alle 5 min
  // aktualisiert.
  const [restPvKwh, setRestPvKwh] = useState<number | null>(null);
  useEffect(() => {
    let ab = false;
    const load = () => {
      fetch("/api/pvanlagen/prognose")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (ab) return;
          if (!j?.ok || !j.vorhanden) { setRestPvKwh(null); return; }
          // Skalierte Rest-Prognose nutzen, wenn die Einstellung aktiv ist und ein
          // Faktor vorliegt; sonst die unskalierte.
          const rest = (j.skalierungAktiv && typeof j.remainingKwhSkaliert === "number")
            ? j.remainingKwhSkaliert : j.remainingKwh;
          setRestPvKwh(rest ?? null);
        })
        .catch(() => { if (!ab) setRestPvKwh(null); });
    };
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => { ab = true; clearInterval(iv); };
  }, []);

  // Aggregierte Werte kommen jetzt fertig aus dem Backend (rollenbasiert).
  // gridPower: negativ = Einspeisung, positiv = Bezug.
  // pvDcPower (PV-Erzeuger mit Ziel DC-Batterieladung) wird abgezogen, da diese
  // Leistung in die Batterie geht und nicht im Haus verbraucht wird.
  const consumeNow =
    l.pvPower - l.pvDcPower + l.gridPower + l.batteryOutPower; // - l.batteryInPower;

  // Direkt im Haus verbrauchter PV-Anteil: AC-Erzeugung (ohne DC-Ladung)
  // abzüglich der Netzeinspeisung UND der AC-Batterieladung. Der DC-Ladeanteil
  // ist bereits ausgenommen (pvAc); die AC-Batterieladung (batteryInPower) geht
  // ebenfalls in den Speicher und zählt nicht als direkter Hausverbrauch.
  //
  // WICHTIG (§42c-Sharing): Der am Netzzähler gemessene Einspeiseanteil enthält
  // auch die Batterieleistung, die für externe §42c-Abnehmer ins Netz gespeist
  // wird (batteryTo42cPower). Diese stammt NICHT aus der PV und darf den
  // PV-Direktverbrauch nicht schmälern – sonst verschwindet der gelbe Pfeil,
  // sobald der Speicher fürs Sharing einspeist. Daher wird die abzuziehende
  // Einspeisung um den batteriebasierten Sharing-Anteil bereinigt.
  const pvAc = l.pvPower - l.pvDcPower;
  const battTo42c = Math.max(0, l.batteryTo42cPower ?? 0);
  const einspeisungNow = l.gridPower < 0 ? -l.gridPower : 0;
  const pvEinspeisung = Math.max(0, einspeisungNow - battTo42c);
  const pvConsumePower = Math.max(0, pvAc - pvEinspeisung - Math.max(0, l.batteryInPower));


  const pvGenNow = l.pvPower;
  const pvGenDay = d.pvDay;
  // Direkt im Haus verbrauchter PV-Tagesertrag: AC-Erzeugung (ohne DC-Ladung)
  // abzüglich der Tageseinspeisung ins Netz.
  const pvConsumedDay = d.pvConsumedDayMonoton;

  // aktuelle Drosselung = jüngster Eintrag, falls < 100
  const lastDros = state.drosselungen[0]?.value ?? 101;

  return (
    <div
      ref={wrapRef}
      className="diagram-scaler"
    >
      <div
        className="diagram-inner"
        style={{
          position: "relative",
          width: DIAGRAM_WIDTH,
          color: "black",
          textAlign: "center",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <img src={diagramUrl} alt="" style={{ width: "100%" }} />

      {/* Alle Speicher mit SoC + vorzeichenbehafteter Leistung untereinander
          (AC1, AC2, DC1, …), ab der bisherigen SoC-Position, aber 10 px tiefer.
          SoC ohne Nachkommastellen; Leistung mit „/" angehängt (>0 laden, <0
          entladen). Fehlender Wert wird mit „—" markiert. */}
      {l.batterySocs && l.batterySocs.length > 0 && (
        <div style={{ ...pos("batterySoC"), top: 438, textAlign: "right" }}>
          {l.batterySocs.map((b) => {
            const socTxt = b.soc != null ? `${Math.round(b.soc)}%` : "\u2014";
            const pwrTxt = b.power != null ? `${Math.round(b.power)}W` : "\u2014";
            return (
              <div key={b.label} style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                {b.label}: {socTxt} / {pwrTxt}
              </div>
            );
          })}
        </div>
      )}

      {/* PV->Batterie (DC-Ladung, z.B. EPEver): hellgrüner Pfeil PV -> Batterie.
          Ladeleistung waagerecht im Pfeil nahe der Spitze (Batterie),
          Tagesenergie hochkant im vertikalen Pfeilstück am oberen Ende.
          Weiße Schrift, damit sie auf dem grünen Pfeil lesbar ist. */}
      {l.pvDcPower > 1 && (
        <div
          style={{
            ...pos("batteryCharging"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {i0(l.pvDcPower)} W
        </div>
      )}
      {d.pvDcDay >= 0.01 && (
        <div
          style={{
            ...pos("batteryChargedDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
        >
          {f2(d.pvDcDay)} kWh
        </div>
      )}
      {l.batteryOutPower > 1 && (
        <div
          style={{
            ...pos("batteryFeedin"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          >
          {i0(l.batteryOutPower-l.batteryTo42cPower)} W
        </div>
      )}
      {d.batteryOutDay >= 0.01 && (
        <div
          style={{
            ...pos("batteryFeedinDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          >{f2(d.batteryOutDay - d.batteryTo42cEnergy)} kWh</div>
      )}

      {/* Batterie-Netzladung (batteryIn): grauer Pfeil Netz -> Batterie.
          Momentanleistung waagerecht im Pfeil nahe der Spitze (Batterie),
          Tagesenergie hochkant im vertikalen Pfeilstück am anderen Ende.
          Weiße Schrift, damit sie auf dem grauen Pfeil lesbar ist. */}
      {l.batteryInPower > 1 && (
        <div
          style={{
            ...pos("batteryInPower"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {i0(l.batteryInPower)} W
        </div>
      )}
      {d.batteryInDay >= 0.01 && (
        <div
          style={{
            ...pos("batteryInDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
        >
          {f2(d.batteryInDay)} kWh
        </div>
      )}

      {/* Verbrauch */}
      {consumeNow > 0 && (
        <div style={pos("consume")}>{i0(consumeNow)} W</div>
      )}
      {d.hausverbrauchDayMonoton > 0.01 && (
        <div style={pos("consumedDay")}>
          {f2(d.hausverbrauchDayMonoton)} kWh
        </div>
      )}

      {/* PV */}
      {lastDros < 100 && (
        <div style={pos("pvDrosselt")}>&#9888; {f2(lastDros)} %</div>
      )}
      {l.pvPower > 0 && (
        <div style={{ ...pos("pvGenerating"), textAlign: "right", whiteSpace: "nowrap" }}>{i0(pvGenNow)} W</div>
      )}
      {pvGenDay > 0 && (
        <div style={pos("pvGeneratedDay")}>{f2(pvGenDay)} kWh</div>
      )}
      {pvConsumePower > 0 && (
        <div style={{
            ...pos("pvConsume"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          >{i0(pvConsumePower)} W</div>
      )}
      {pvConsumedDay >= 0.01 && (
        <div style={{
            ...pos("pvConsumedDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{f2(pvConsumedDay)} kWh</div>
      )}
      {l.gridPower + l.sharing42cPowerNow < 0 && (
        <div style={{
            ...pos("pvFeedin"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{i0(l.gridPower * -1 - l.sharing42cPowerNow)} W</div>
      )}
      {d.gridDayEingespeist - l.sharing42cEnergyDay >= 0.01 && (
        <div style={{
            ...pos("pvFeedinDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{f2(d.gridDayEingespeist - l.sharing42cEnergyDay)} kWh</div>
      )}
      {/* Einspeisevergütung (pvEarnedDay) ausgeblendet – §42c separat unten:
      {d.tagesEinspeiseverguetung >= 0.01 && (
        <div style={{ ...pos("pvEarnedDay"), textAlign: "left", whiteSpace: "nowrap" }}>
          {f2(d.tagesEinspeiseverguetung)} €
        </div>
      )} */}

      {/* Netz */}
      {l.gridPower > 0 &&
      <div style={{
            ...pos("grid"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          >{i0(l.gridPower)} W</div>}
      {d.gridDayBezug >= 0.01 && (
        <div style={{
            ...pos("gridDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{f2(d.gridDayBezug)} kWh</div>
      )}
      {/* Netzbezugskosten am Pfeil ausgeblendet – Kostenaufstellung rechts:
      {d.gridDayBezug > 0.01 && (
        <div style={pos("gridCostsDay")}>
          {f2(d.tagesBezugskosten)} €
        </div>
      )} */}
      {l.gridInTotal >= 0.01 && (
        <div style={pos("gridTotalIn")}>
          <span className="grid-arrow bezug">⬆️</span> {f2(l.gridInTotal)} kWh
        </div>
      )}
      {l.gridOutTotal >= 0.01 && (
        <div style={pos("gridTotalOut")}>
          <span className="grid-arrow einspeisung">⬇️</span> {f2(l.gridOutTotal)} kWh
        </div>
      )}
      {d.energyAutarkie > 0 && (
        <div style={{ ...pos("gridAutarkieDay"), textAlign: "right", whiteSpace: "nowrap" }}>
          Autarkie: {f2(d.energyAutarkie)} %
        </div>
      )}
      <div style={{ ...pos("gridCostsPerkWh"), textAlign: "right", whiteSpace: "nowrap" }}>
        Strompreis: {f2(state.effektiverStrompreis * 100)} ct/kWh
      </div>
      {restPvKwh != null && restPvKwh >= 0.05 && (
        <div style={{ ...pos("gridCostsPerkWh"), top: 752, textAlign: "right", whiteSpace: "nowrap" }}>
          <span className="sun-icon">☀️</span> Rest-Prognose: {f2(restPvKwh)} kWh
        </div>
      )}

      {/* Kostenaufstellung rechts neben dem Netzsymbol: Bezugskosten,
          Einspeisevergütung und §42c-Vergütung (beide senken die Kosten, daher
          negativ) sowie die resultierenden Tageskosten. Rechtsbündig. */}
      {d.tagesBezugskosten >= 0.01 && (
        <div style={{ ...pos("gridBezugskosten"), textAlign: "right", whiteSpace: "nowrap" }}>
          Bezugskosten: {f2(d.tagesBezugskosten)} &#8364;
        </div>
      )}
      {d.tagesEinspeiseverguetung >= 0.01 && (
        <div style={{ ...pos("gridEinspeiseverg"), textAlign: "right", whiteSpace: "nowrap" }}>
          Einspeisevergütung: -{f2(d.tagesEinspeiseverguetung)} &#8364;
        </div>
      )}
      {d.tagesSharingVerguetung >= 0.01 && (
        <div style={{ ...pos("gridSharingVerg"), textAlign: "right", whiteSpace: "nowrap" }}>
          §42c Vergütung: -{f2(d.tagesSharingVerguetung)} &#8364;
        </div>
      )}
      {Math.abs(
        d.tagesBezugskosten -
          d.tagesEinspeiseverguetung -
          d.tagesSharingVerguetung,
      ) >= 0.01 && (
        <div style={{ ...pos("gridCostsDaySum"), textAlign: "right", whiteSpace: "nowrap" }}>
          Tageskosten:{" "}
          {f2(
            d.tagesBezugskosten -
              d.tagesEinspeiseverguetung -
              d.tagesSharingVerguetung,
          )}{" "}
          &#8364;
        </div>
      )}

      {/* §42c Energy Sharing (orangener Pfeil Netz -> §42c-Haus):
          sharing42cPowerNow = durch eigene Einspeisung gedeckter Anteil,
          sharing42cPowerNowOther = vom Reststromlieferanten gedeckter Rest. */}
      {l.sharing42cPowerNow > 0 && (
        <div style={{
            ...pos("sharing42cPower"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{i0(l.sharing42cPowerNow)} W
        </div>
      )}
      {l.sharing42cPowerNowOther > 0 && (
        <div style={{
            ...pos("sharing42cPowerOther"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{i0(l.sharing42cPowerNowOther)} W
        </div>
      )}
      {l.sharing42cEnergyDay > 0.01 && (
        <div style={{
            ...pos("sharing42cEnergyDay"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{f2(l.sharing42cEnergyDay)} kWh
        </div>
      )}

      {d.pvTo42cEnergy >= 0.01 && (
        <div
          style={{
            ...pos("pvTo42cEnergy"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{f2(d.pvTo42cEnergy)} kWh</div>
      )}
      {l.pvTo42cPower > 0 && (
        <div
          style={{
            ...pos("pvTo42cPower"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            writingMode: "vertical-rl",
          }}
          >{i0(l.pvTo42cPower)} W</div>
      )}
      {d.batteryTo42cEnergy >= 0.01 && (
        <div
          style={{
            ...pos("batteryTo42cEnergy"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          >{f2(d.batteryTo42cEnergy)}  kWh</div>
      )}
      {l.batteryTo42cPower > 0 && (
        <div
          style={{
            ...pos("batteryTo42cPower"),
            color: "#fff",
            fontSize: "var(--fs-diagram-value)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          >{i0(l.batteryTo42cPower)} W</div>
      )}

      {/* §42c-Vergütung ausgeblendet:
      {d.tagesSharingVerguetung >= 0.01 && (
        <div style={{ ...pos("sharing42cVerguetung"), textAlign: "left", whiteSpace: "nowrap" }}>
          {f2(d.tagesSharingVerguetung)} €
        </div>
      )} */}

      {/* Wasser / Zeit */}
      {l.tankUpTemp > 1 && (
        <div style={pos("waterUp")}>
          &#128167; {f2(l.tankUpTemp)} &#8451;
        </div>
      )}
      {l.tankDownTemp > 1 && (
        <div style={pos("waterDown")}>
          &#x1F321; {f2(l.tankDownTemp)} &#8451;
        </div>
      )}
      <div style={pos("time")}>{time}</div>
      </div>
    </div>
  );
}
