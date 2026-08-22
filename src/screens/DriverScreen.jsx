/* Vector — Sofőr nézet — nagy betűs napi útvonal
   Kiemelve a vector.jsx-ből; a viselkedés változatlan. */

import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DAYS, byId } from "../domain/constants.js";
import { mondayOf, toISO, addDays, weekdayIdx, timeToMin, minToTime, fmtDate } from "../domain/datetime.js";
import { weekOccurrences, seatSum, venueDepartMin } from "../domain/logic.js";
import { PlateChip, TeamDot, EmptyState, InfoDot } from "../ui/base.jsx";
import { parseISO } from "../domain/datetime.js";
import { rideWindow } from "../domain/logic.js";

/* ---------- 4.5 SOFŐR NÉZET ---------- */

/* A belépett felhasználóhoz tartozó sofőr: az Adatok fülön a sofőrhöz megadott
   e-mail-cím köti össze a fiókkal. Egyezés híján az első sofőr — így a nézet
   e-mail nélkül (adminként böngészve, tesztben) pontosan úgy indul, mint eddig. */
export function defaultDriverId(drivers, myEmail) {
  const em = (myEmail || "").trim().toLowerCase();
  const mine = em && drivers.find((d) => (d.email || "").trim().toLowerCase() === em);
  return (mine || drivers[0])?.id || "";
}

export function DriverScreen({ state, myEmail }) {
  const [selDriverId, setDriverId] = useState(() => defaultDriverId(state.drivers, myEmail));
  const driverId = byId(state.drivers, selDriverId) ? selDriverId : (state.drivers[0]?.id || "");
  const [dateISO, setDateISO] = useState(() => toISO(new Date()));
  const todayISO = toISO(new Date());
  /* Percenként újrarenderelünk: e nélkül a "KÖVETKEZŐ" jelölés és a múltbeli
     megállók halványítása a képernyő megnyitásának percén ragadt, vagyis a
     nézet fő funkciója egy letett telefonon sosem lépett tovább. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const rides = useMemo(() => {
    const wd = weekdayIdx(dateISO);
    return state.rides
      .filter((r) => r.driverId === driverId)
      .map((r) => ({ ride: r, training: byId(state.trainings, r.trainingId) }))
      .filter(({ ride, training }) => training && (training.type === "weekly" ? ride.day === wd : training.date === dateISO))
      .sort((a, b) => rideWindow(state, a.ride, a.training)[0] - rideWindow(state, b.ride, b.training)[0]);
  }, [state, driverId, dateISO]);

  const driver = byId(state.drivers, driverId);

  return (
    <div className="px-4 pb-4">
      <div className="py-3 flex items-center gap-1"><h2 className="disp text-xl">Sofőr nézet</h2><InfoDot align="l" text="Egy sofőr napi fuvarjai, nyomtatható formában. Fent válts sofőrt és napot." /></div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        {state.drivers.map((d) => (
          <button key={d.id} className={`chip ${d.id === driverId ? "on" : ""}`} onClick={() => setDriverId(d.id)} style={{ whiteSpace: "nowrap" }}>{d.name}</button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <button className="iconbtn" onClick={() => setDateISO(toISO(addDays(parseISO(dateISO), -1)))} aria-label="Előző nap"><ChevronLeft size={18} /></button>
        <button className="disp text-lg" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => setDateISO(todayISO)}>
          {DAYS[weekdayIdx(dateISO)]} · {fmtDate(dateISO)} {dateISO === todayISO && <span className="pill pill-miss disp" style={{ verticalAlign: "middle" }}>MA</span>}
        </button>
        <button className="iconbtn" onClick={() => setDateISO(toISO(addDays(parseISO(dateISO), 1)))} aria-label="Következő nap"><ChevronRight size={18} /></button>
      </div>

      {!driver && <EmptyState>Nincs sofőr felvéve. Az Adatok fülön adhatsz hozzá.</EmptyState>}
      {driver && rides.length === 0 && <EmptyState><b>{driver.name}</b> részére erre a napra nincs fuvar.</EmptyState>}

      <div className="flex flex-col gap-4">
        {rides.map(({ ride, training }) => {
          const team = byId(state.teams, training.teamId);
          const venue = byId(state.venues, training.venueId);
          const vehicle = byId(state.vehicles, ride.vehicleId);
          const isToday = dateISO === todayISO;
          const dir = ride.dir || "oda";
          const nextIdx = isToday ? ride.stops.findIndex((s) => (timeToMin(s.time) ?? 0) >= nowMin) : -1;
          const pax = seatSum(ride.stops);
          const stopRows = ride.stops.map((s, i) => {
            const st = byId(state.stations, s.stationId);
            const past = isToday && (timeToMin(s.time) ?? 0) < nowMin && i !== nextIdx;
            const isNext = i === nextIdx;
            return (
              <div key={s.id} className="rail-row" style={past ? { opacity: 0.45 } : {}}>
                <span className={`rail-dot ${isNext ? "next" : ""}`} aria-hidden />
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="tnum" style={{ fontSize: 28, lineHeight: 1 }}>{s.time || "–:–"}</span>
                  <span className="font-semibold" style={{ fontSize: 19 }}>{st?.name || "?"}</span>
                  {Number(s.count) > 0 && <span className="text-base" style={{ color: "var(--ink2)" }}>{s.count} fő</span>}
                  {isNext && <span className="pill pill-miss disp">KÖVETKEZŐ</span>}
                </div>
                {st?.address && <div className="text-sm mt-1" style={{ color: "var(--ink2)" }}>{st.address}</div>}
              </div>
            );
          });
          const venueRow = (
            <div className="rail-row" key="__venue">
              <span className="rail-dot dest" aria-hidden />
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="tnum" style={{ fontSize: 28, lineHeight: 1, color: "var(--ok)" }}>
                  {dir === "vissza" ? minToTime(venueDepartMin(state, training)) : training.start}
                </span>
                <span className="font-semibold" style={{ fontSize: 19 }}>{venue?.name}</span>
              </div>
              <div className="text-sm mt-1" style={{ color: "var(--ink2)" }}>
                {venue?.address ? `${venue.address} · ` : ""}
                {dir === "vissza" ? "innen indul a hazaszállítás" : "eddigre kell a helyszínen lenni"}
              </div>
            </div>
          );
          return (
            <div key={ride.id} className="card overflow-hidden">
              <div className="p-3 flex items-center gap-3" style={{ background: "var(--surface-inv)", color: "var(--on-inv)" }}>
                <TeamDot color={team?.color || "#999"} size={14} />
                <div className="flex-1 min-w-0">
                  <div className="disp text-lg truncate flex items-center gap-2">
                    <span className={`dirpill ${dir === "vissza" ? "v" : ""}`} style={dir === "vissza" ? { borderColor: "var(--on-inv)", background: "var(--on-inv)", color: "var(--surface-inv)" } : { borderColor: "var(--on-inv)", color: "var(--on-inv)" }}>{dir === "oda" ? "ODA" : "VISSZA"}</span>
                    <span className="truncate">{team?.name}</span>
                  </div>
                  <div className="text-sm" style={{ color: "var(--on-inv)", opacity: .7 }}>edzés {training.start}–{training.end}</div>
                </div>
                {vehicle && <div className="text-right">
                  <PlateChip plate={vehicle.plate} />
                  <div className="text-xs mt-1" style={{ color: "var(--on-inv)", opacity: .7 }}>{vehicle.name}{pax ? ` · ${pax} fő` : ""}</div>
                </div>}
              </div>
              <div className="rail p-4 flex flex-col" style={{ gap: 18 }}>
                {dir === "vissza" ? [venueRow, ...stopRows] : [...stopRows, venueRow]}
                {ride.stops.length === 0 && <div className="text-sm" style={{ color: "var(--ink2)" }}>Ehhez a fuvarhoz még nincsenek megállók megadva.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
