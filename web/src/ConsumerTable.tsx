// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

import { useEffect, useState } from "react";
import { nf } from "./chartUtils";
import type { FullState, ConsumerEntry } from "./types";
import { effectiveIcon } from "./iconDefaults";
import { ConsumerDayChart } from "./ConsumerDayChart";
import { RoomDayChart } from "./RoomDayChart";
import { AllConsumersDayChart } from "./AllConsumersDayChart";
import { DateNav } from "./DateNav";

const i0 = (n: number | null | undefined) =>
  Math.round(Number.isFinite(n as number) ? (n as number) : 0);

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Historischer Tageseintrag je Verbraucher (vom /api/consumers/day-Endpoint).
interface DayConsumer {
  id: string;
  label: string;
  room: string;
  icon: string | null;
  deviceType: string | null;
  role?: string | null;
  summe: number;
  disabled?: boolean;
}

export function ConsumerTable({ state }: { state: FullState }) {
  const liveConsumers = state.live.consumers ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  // Ist die Gesamt-Zeile ausgeklappt (gestapeltes Diagramm aller Verbraucher)?
  const [totalOpen, setTotalOpen] = useState(false);
  // Gewählter Tag. Heute = Live-Ansicht mit Momentanleistung; sonst historische
  // Tagesverbräuche, Leistungsspalte ausgegraut.
  const [date, setDate] = useState<string>(isoToday());
  const heute = date === isoToday();
  const [dayData, setDayData] = useState<DayConsumer[] | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  useEffect(() => {
    if (heute) { setDayData(null); return; }
    let cancelled = false;
    setLoadingDay(true);
    fetch(`/api/consumers/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setDayData((d?.series ?? []) as DayConsumer[]); })
      .catch(() => { if (!cancelled) setDayData([]); })
      .finally(() => { if (!cancelled) setLoadingDay(false); });
    return () => { cancelled = true; };
  }, [date, heute]);

  if (liveConsumers.length === 0) return null;

  const OHNE = "Ohne Raum";

  // Einheitliche Verbraucherliste je nach Modus: heute = live, sonst historisch.
  // Bei historischen Tagen wird power auf 0 gesetzt (Spalte zeigt "—").
  const consumers: ConsumerEntry[] = heute
    ? liveConsumers
    : (dayData ?? []).map((d) => {
        // Stammdaten (bidirectional, extraLinks) aus der Live-Liste übernehmen.
        const live = liveConsumers.find((c) => c.id === d.id);
        return {
          ...(live ?? ({} as ConsumerEntry)),
          id: d.id,
          label: d.label,
          room: d.room === OHNE ? "" : d.room,
          icon: d.icon ?? live?.icon,
          deviceType: d.deviceType ?? live?.deviceType,
          role: d.role ?? live?.role,
          power: 0,
          energyDay: d.summe,
          disabled: d.disabled,
        } as ConsumerEntry;
      });

  // Nach Raum gruppieren.
  const groups = new Map<string, ConsumerEntry[]>();
  for (const c of consumers) {
    const room = c.room?.trim() || OHNE;
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room)!.push(c);
  }
  const rooms = [...groups.keys()].sort((a, b) => {
    if (a === OHNE) return 1;
    if (b === OHNE) return -1;
    return a.localeCompare(b, "de");
  });

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const toggleRoom = (r: string) => setOpenRoom((cur) => (cur === r ? null : r));

  return (
    <div className="consumer-table">
      <div className="lp-controls" style={{ marginBottom: 8 }}>
        <DateNav value={date} onChange={setDate} />
        {!heute && <span className="hint" style={{ marginLeft: 8 }}>
          Historische Tagesverbräuche – die Momentanleistung gilt nur für heute.
        </span>}
      </div>
      {loadingDay && !dayData && <p className="hint">Lade Tagesdaten…</p>}
      <div className="table-scroll">
      <table>
        <colgroup>
          <col className="ct-col-name" />
          {heute && <col className="ct-col-power" />}
          <col className="ct-col-energy" />
        </colgroup>
        <tbody>
          <tr>
            <th>Verbraucher</th>
            {heute && <th>Leistung</th>}
            <th>Tagesverbrauch</th>
          </tr>
          {rooms.map((room) => {
            const items = groups.get(room)!;
            const roomSum = items.reduce((s, c) => s + (c.power > 0 ? c.power : 0), 0);
            const roomEnergy = items.reduce((s, c) => s + (c.energyDay ?? 0), 0);
            return (
              <RoomGroup
                key={room}
                room={room}
                items={items}
                sum={roomSum}
                energySum={roomEnergy}
                heute={heute}
                date={date}
                openId={openId}
                toggle={toggle}
                roomOpen={openRoom === room}
                toggleRoom={toggleRoom}
                color={state.settings.vizColorVerbrauchGesamt}
              />
            );
          })}
          {(() => {
            const totalPower = consumers.reduce((s, c) => s + (c.power > 0 ? c.power : 0), 0);
            const totalEnergy = consumers.reduce((s, c) => s + (c.energyDay ?? 0), 0);
            return (
              <>
                <tr
                  className={`consumer-total-row consumer-total-click${totalOpen ? " consumer-open" : ""}`}
                  onClick={() => setTotalOpen((v) => !v)}
                  style={{ cursor: "pointer" }}
                  title={totalOpen ? "Gesamt-Tagesverlauf ausblenden" : "Gesamt-Tagesverlauf anzeigen"}
                >
                  <td style={{ textAlign: "left", fontWeight: "bold" }}>
                    <span className={`consumer-caret${totalOpen ? " open" : ""}`}>▸</span> Gesamt (alle Räume)
                  </td>
                  {heute && (
                    <td style={{ textAlign: "right", fontWeight: "bold" }}>
                      {totalPower > 0 ? `${i0(totalPower)} W` : "—"}
                    </td>
                  )}
                  <td style={{ textAlign: "right", fontWeight: "bold" }}>
                    {totalEnergy > 0 ? `${nf(totalEnergy, 2)} kWh` : "—"}
                  </td>
                </tr>
                {totalOpen && (
                  <tr className="consumer-detail-row">
                    <td colSpan={heute ? 3 : 2}>
                      <AllConsumersDayChart date={date} />
                    </td>
                  </tr>
                )}
              </>
            );
          })()}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function RoomGroup({
  room,
  items,
  sum,
  energySum,
  heute,
  date,
  openId,
  toggle,
  roomOpen,
  toggleRoom,
  color,
}: {
  room: string;
  items: ConsumerEntry[];
  sum: number;
  energySum: number;
  heute: boolean;
  date: string;
  openId: string | null;
  toggle: (id: string) => void;
  roomOpen: boolean;
  toggleRoom: (r: string) => void;
  color: string;
}) {
  return (
    <>
      <tr
        className={`room-header room-header-click${roomOpen ? " room-open" : ""}`}
        onClick={() => toggleRoom(room)}
        style={{ cursor: "pointer" }}
        title={roomOpen ? "Raum-Tagesverlauf ausblenden" : "Raum-Tagesverlauf anzeigen"}
      >
        <td style={{ textAlign: "left", fontWeight: "bold" }}>
          <span className={`consumer-caret${roomOpen ? " open" : ""}`}>▸</span> {room}
        </td>
        {heute && (
          <td style={{ textAlign: "right", fontWeight: "bold" }}>
            {sum > 0 ? `${i0(sum)} W` : "—"}
          </td>
        )}
        <td style={{ textAlign: "right", fontWeight: "bold" }}>
          {energySum > 0 ? `${nf(energySum, 2)} kWh` : "—"}
        </td>
      </tr>
      {roomOpen && (
        <tr className="consumer-detail-row">
          <td colSpan={heute ? 3 : 2}>
            <RoomDayChart room={room} initialDate={date} />
          </td>
        </tr>
      )}
      {items.map((c) => {
        // Ausgrauen nur, wenn am gewählten Tag noch KEINE Energie bezogen wurde
        // (Tagesverbrauch = 0) – unabhängig von der Momentanleistung. Ein Gerät,
        // das heute schon verbraucht hat, aber gerade auf 0 W steht, bleibt normal.
        // Ausgrauen nur, wenn am gewählten Tag WEDER Bezug/Verbrauch NOCH
        // Einspeisung/Entladung stattfand. Bidirektionale Speicher, die heute
        // nur eingespeist (entladen) haben, bleiben normal angezeigt.
        const off = ((c.energyDay ?? 0) + (c.energyDayFeedin ?? 0)) <= 0;
        const open = openId === c.id;
        return (
          <ConsumerRow
            key={c.id}
            c={c}
            off={off}
            heute={heute}
            date={date}
            open={open}
            toggle={toggle}
            color={color}
          />
        );
      })}
    </>
  );
}

function ConsumerRow({
  c,
  off,
  heute,
  date,
  open,
  toggle,
  color,
}: {
  c: ConsumerEntry;
  off: boolean;
  heute: boolean;
  date: string;
  open: boolean;
  toggle: (id: string) => void;
  color: string;
}) {
  return (
    <>
      <tr
        className={`consumer-row${off ? " consumer-off" : ""}${open ? " consumer-open" : ""}`}
        onClick={() => toggle(c.id)}
        style={{ cursor: "pointer" }}
        title={open ? "Tagesverlauf ausblenden" : "Tagesverlauf anzeigen"}
      >
        <td style={{ textAlign: "left", paddingLeft: 20 }}>
          <span className={`consumer-caret${open ? " open" : ""}`}>▸</span>{" "}
          <span className="consumer-icon">
            {effectiveIcon({ icon: c.icon, deviceType: c.deviceType, role: c.role ?? "consumer" })}
          </span>{" "}
          {c.label}
          {c.disabled && <span className="consumer-disabled-tag"> (deaktiviert)</span>}
        </td>
        {heute && (
          <td style={{ textAlign: "right" }}>
            {(c.bidirectional ? Math.abs(c.power) < 1 : c.power <= 0)
              ? "—"
              : c.bidirectional ? `${c.power > 0 ? "+" : ""}${i0(c.power)} W` : `${i0(c.power)} W`}
          </td>
        )}
        <td style={{ textAlign: "right" }}>
          {c.bidirectional
            ? (((c.energyDay ?? 0) + (c.energyDayFeedin ?? 0)) > 0
                ? `${nf(c.energyDay ?? 0, 2)} / ${nf(c.energyDayFeedin ?? 0, 2)} kWh`
                : "—")
            : ((c.energyDay ?? 0) > 0 ? `${nf(c.energyDay ?? 0, 2)} kWh` : "—")}
        </td>
      </tr>
      {open && (
        <tr className="consumer-detail-row">
          <td colSpan={heute ? 3 : 2}>
            <ConsumerDayChart consumerId={c.id} color={color} extraLinks={c.extraLinks} initialDate={date} />
          </td>
        </tr>
      )}
    </>
  );
}
