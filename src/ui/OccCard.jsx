/* Vector — egy edzés-előfordulás kártyája (a Hét és a Fuvar képernyő is használja)
   Kiemelve a vector.jsx-ből; a viselkedés változatlan. */

import { AlertTriangle, MapPin, Clock, ChevronsRight } from "lucide-react";
import { byId } from "../domain/constants.js";
import { minToTime } from "../domain/datetime.js";
import { findRides, findConflicts, venueDepartMin } from "../domain/logic.js";
import { PlateChip } from "./base.jsx";
import { timeToMin } from "../domain/datetime.js";
import { seatSum } from "../domain/logic.js";

export function OccCard({ state, occ, onOpen }) {
  const { training } = occ;
  const team = byId(state.teams, training.teamId);
  const venue = byId(state.venues, training.venueId);
  const rides = findRides(state, training, occ.dayIdx);

  return (
    <button onClick={onOpen} className="card w-full text-left p-0 overflow-hidden flex" style={{ cursor: "pointer" }}>
      <div style={{ width: 6, background: team?.color || "#999", flexShrink: 0 }} aria-hidden />
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="tnum text-lg">{training.start}–{training.end}</span>
          <span className="font-semibold truncate">{team?.name || "?"}</span>
          {training.type === "once" && <span className="text-xs pill" style={{ background: "var(--paper2)", color: "var(--ink2)" }}>egyszeri</span>}
        </div>
        <div className="flex items-center gap-1 text-sm mt-1" style={{ color: "var(--ink2)" }}>
          <MapPin size={14} /> <span className="truncate">{venue?.name || "nincs helyszín"}</span>
        </div>
        {rides.length > 0 ? rides.map((ride) => {
          const vehicle = byId(state.vehicles, ride.vehicleId);
          const driver = byId(state.drivers, ride.driverId);
          const conflicts = findConflicts(state, ride);
          const dir = ride.dir || "oda";
          const firstStop = ride.stops.length
            ? ride.stops.reduce((a, b) => ((timeToMin(a.time) ?? 9999) <= (timeToMin(b.time) ?? 9999) ? a : b))
            : null;
          const depTime = dir === "vissza" ? minToTime(venueDepartMin(state, training)) : (firstStop?.time || null);
          const pax = seatSum(ride.stops);
          const over = vehicle && pax > vehicle.seats;
          return (
            <div key={ride.id} className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`dirpill ${dir === "vissza" ? "v" : ""}`}>{dir === "oda" ? "ODA" : "VISSZA"}</span>
              {vehicle && <PlateChip plate={vehicle.plate} />}
              <span className="text-sm font-medium truncate">{driver?.name || "?"}</span>
              {depTime && (
                <span className="text-sm tnum flex items-center gap-1" style={{ color: "var(--ink2)" }}>
                  <Clock size={14} /> {dir === "vissza" ? "indulás a helyszínről" : "indulás"} {depTime}
                </span>
              )}
              {conflicts.length > 0 && <span className="pill pill-conf disp"><AlertTriangle size={12} /> ÜTKÖZÉS</span>}
              {over && <span className="pill pill-conf disp">{pax}/{vehicle.seats} FŐ</span>}
            </div>
          );
        }) : (
          <div className="mt-2">
            <span className="pill pill-miss disp"><AlertTriangle size={12} /> NINCS FUVAR</span>
          </div>
        )}
      </div>
      <div className="flex items-center pr-2" style={{ color: "var(--ink2)" }}><ChevronsRight size={18} /></div>
    </button>
  );
}
