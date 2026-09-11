/* Fuvarterv — plates, occurrences, ride windows, clashes, delete guards.

   Pure domain: no window, no network, no Math.random on any decision path. */

import { byId } from "./constants.js";
import { toISO, parseISO, weekdayIdx, addDays, timeToMin } from "./datetime.js";
import { legMin } from "./geo.js";

/* Plate: upper-cased, hyphen at the letter/digit boundary (ABC-123, AABB-123). */
export function normalizePlate(raw) {
  const s = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if (m) return `${m[1]}-${m[2]}`;
  return s;
}
export function plateExists(state, plate, exceptId) {
  const p = normalizePlate(plate);
  return state.vehicles.some((v) => v.id !== exceptId && normalizePlate(v.plate) === p);
}

/* Every occurrence of every training inside one week. */
export function weekOccurrences(state, mon) {
  const out = [];
  for (const t of state.trainings) {
    if (t.type === "weekly") {
      for (const di of t.days) out.push({ training: t, dayIdx: di, dateISO: toISO(addDays(mon, di)) });
    } else if (t.date) {
      const diff = Math.round((parseISO(t.date) - mon) / 86400000);
      if (diff >= 0 && diff < 7) out.push({ training: t, dayIdx: weekdayIdx(t.date), dateISO: t.date });
    }
  }
  return out.sort((a, b) => a.dayIdx - b.dayIdx || (timeToMin(a.training.start) ?? 0) - (timeToMin(b.training.start) ?? 0));
}



/* One training session can have several rides: more than one bus carrying the team. */
export function findRides(state, training, dayIdx) {
  return state.rides.filter((r) => r.trainingId === training.id && (training.type !== "weekly" || r.day === dayIdx));
}

/* Departure time from the venue on a return leg: training end plus the margin. */
export function venueDepartMin(state, training) {
  return (timeToMin(training.end) ?? 0) + (state.settings?.departAfterMin ?? 0);
}

/* The window in which a ride occupies its driver and vehicle.

   Outbound: first stop's departure until the last stop plus the run to the venue,
   so one driver or bus can make several trips for the SAME training without
   showing a false clash. Return: departure from the venue until the last stop's
   arrival. */
export function rideWindow(state, ride, training) {
  const stops = (ride.stops || []).filter((s) => timeToMin(s.time) != null);
  if ((ride.dir || "oda") === "vissza") {
    const dep = venueDepartMin(state, training);
    if (!stops.length) return [dep, dep + 1];
    const last = Math.max(...stops.map((s) => timeToMin(s.time)));
    return [dep, Math.max(dep + 1, last)];
  }
  const startCap = timeToMin(training.start) ?? 0;
  if (!stops.length) return [startCap, startCap];
  const first = Math.min(...stops.map((s) => timeToMin(s.time)));
  const last = stops.reduce((a, b) => (timeToMin(a.time) >= timeToMin(b.time) ? a : b));
  const end = timeToMin(last.time) + legMin(state, last.stationId, training.venueId);
  return [first, Math.max(first + 1, end)];
}

export function occursOnSameDay(rA, tA, rB, tB) {
  if (tA.type === "once" && tB.type === "once") return tA.date === tB.date;
  // A one-off training with no date cannot be placed in the week at all.
  // weekdayIdx(null) used to throw a TypeError from here, mid-render on the week
  // screen, taking the whole page down.
  const dayOf = (t, r) => (t.type === "weekly" ? r.day : (t.date ? weekdayIdx(t.date) : null));
  const dayA = dayOf(tA, rA), dayB = dayOf(tB, rB);
  if (dayA == null || dayB == null) return false;
  return dayA === dayB;
}

/* Vehicle and driver clashes against a candidate (possibly unsaved) ride. */
export function findConflicts(state, cand) {
  const tA = byId(state.trainings, cand.trainingId);
  if (!tA) return [];
  const out = [];
  for (const r of state.rides) {
    if (r.id === cand.id) continue;
    const tB = byId(state.trainings, r.trainingId);
    if (!tB) continue;
    if (!occursOnSameDay(cand, tA, r, tB)) continue;
    const [a1, a2] = rideWindow(state, cand, tA);
    const [b1, b2] = rideWindow(state, r, tB);
    if (!(a1 < b2 && b1 < a2)) continue;
    if (cand.vehicleId && cand.vehicleId === r.vehicleId) out.push({ type: "vehicle", ride: r, training: tB });
    if (cand.driverId && cand.driverId === r.driverId) out.push({ type: "driver", ride: r, training: tB });
  }
  return out;
}

export const seatSum = (stops) => stops.reduce((a, s) => a + (Number(s.count) > 0 ? Number(s.count) : 0), 0);

/* Delete guards for the master data. */
/* How many saved schedule chains reference this driver or vehicle.

   Counting rides alone is not enough: a chain can exist in the schedule without
   having been generated into rides yet. Delete the driver and resolveDay silently
   resolves to `undefined`, so the chain renders with no warning and a wage of
   zero. */
export function chainRefs(state, field, id) {
  let c = 0;
  for (const day of Object.values(state.assignments || {}))
    for (const ch of day?.chains || []) if (ch[field] === id) c++;
  return c;
}

/* Where the stops come from: the training's own list, or the team's.

   A team can have several trainings, possibly at different venues, and the stops,
   headcounts and order may differ per training. A training's `stops` field is
   therefore a COMPLETE override: either null (the team's list applies, which is
   the original behaviour) or a full list of its own using the same field names.

   The matching field names are not an accident. They let one resolver and one
   editor component serve both levels with no adapter in between.

   Inheriting by direction (outbound from the training, return from the team) is
   deliberately impossible: that would produce an unreadable matrix of cases. A
   training either uses the team's list or has a complete one of its own. */
export function legSource(team, training) {
  return training?.stops || team || {};
}
export const hasOwnStops = (training) => !!training?.stops;

/* One direction's "leg" of a stop list: which stops it touches, with how many
   people, and which stop is pinned to the end of the line.

   This is the ONLY place that decides whether the return leg uses its own list or
   mirrors the outbound one. With no `returnStationIds`, both directions get the
   outbound fields, so the original behaviour is unchanged and existing teams need
   no migration. The rule lives inside the source, so a training with its own list
   mirrors ITS outbound leg, not the team's.

   `isOverride` matters because ordering differs: a mirrored return leg must be
   reversed, but a hand-built return list must NOT be — its order is already the
   intended one. */
export function legFor(team, training, dir) {
  const src = legSource(team, training);
  const own = dir === "vissza" && Array.isArray(src.returnStationIds);
  const routeMode = src.routeMode || "auto";
  if (!own) {
    return {
      stationIds: src.stationIds || [],
      stationCounts: src.stationCounts || {},
      routeAnchorId: src.routeAnchorId ?? null,
      routeMode,
      isOverride: false,
    };
  }
  return {
    stationIds: src.returnStationIds,
    stationCounts: src.returnStationCounts || {},
    routeAnchorId: src.returnRouteAnchorId ?? null,
    routeMode,
    isOverride: true,
  };
}

/* The team-level call. This wrapper states the invariant the return-leg tests
   check: with no override, nothing changes. */
export const teamLeg = (team, dir) => legFor(team, null, dir);

/* The national motorway vignette. The REQUIREMENT is marked on the venue
   (`needsVignette`); the FACT is on the vehicle (`hasVignette`).

   One of a task's two endpoints is always the venue (outbound: `to`, return:
   `from`), so checking both covers either direction with no special case. Stops
   deliberately cannot be marked: the destination is what forces the vignette, and
   this way there is one field to maintain rather than dozens. */
export const venueNeedsVignette = (state, id) => !!byId(state.venues, id)?.needsVignette;
export const taskNeedsVignette = (state, task) =>
  venueNeedsVignette(state, task.from) || venueNeedsVignette(state, task.to);
export const chainNeedsVignette = (state, chain) =>
  (chain?.tasks || []).some((t) => taskNeedsVignette(state, t));
/* Which vignette-requiring venues this chain visits. Used by the explanations,
   so we say WHICH venue caused the problem rather than only that there is one. */
export const vignetteVenues = (state, chain) => [...new Set((chain?.tasks || [])
  .flatMap((t) => [t.from, t.to])
  .filter((id) => venueNeedsVignette(state, id))
  .map((id) => byId(state.venues, id).name))];

/* Which depot this vehicle leaves from and returns to. A vehicle's own depot
   beats the club's. With neither, null: paid time is then measured from the tasks
   themselves, exactly as it was before depots existed. */
export function baseOf(state, vehicleId) {
  const v = byId(state.vehicles, vehicleId);
  return (v && v.baseId) || state.settings?.defaultBaseId || null;
}

export function deleteGuard(state, kind, id) {
  const n = (c, w) => (c > 0 ? `Használatban: ${c} ${w}.` : null);
  if (kind === "stations") {
    // The return-leg list has to be counted too. A station used only on the way
    // home would otherwise look unreferenced, become deletable, and afterwards
    // teamRouteOrder's filter would silently skip it — nobody would take those
    // children home. The same applies to a training's own list: a station used
    // only there would look unreferenced as well.
    const inSource = (src) => (src.stationIds || []).includes(id) || (src.returnStationIds || []).includes(id);
    const c = state.teams.filter(inSource).length
      + state.trainings.filter((t) => t.stops && inSource(t.stops)).length
      + state.rides.filter((r) => (r.stops || []).some((s) => s.stationId === id)).length;
    return n(c, "csapat/edzés/fuvar");
  }
  if (kind === "venues") {
    const c = state.teams.filter((t) => (t.venueIds || []).includes(id)).length
      + state.trainings.filter((t) => t.venueId === id).length;
    return n(c, "csapat/edzés");
  }
  if (kind === "vehicles") {
    const c = state.rides.filter((r) => r.vehicleId === id).length
      + chainRefs(state, "vehicleId", id)
      // A deleted preferred vehicle penalises its driver forever: offPreferred
      // stays true for every bus, so preferredBias hides that driver for good.
      + state.drivers.filter((d) => d.preferredVehicleId === id).length;
    return n(c, "fuvar/beosztás/sofőr");
  }
  if (kind === "bases") {
    // settings.defaultBaseId has to be counted too. Delete the club depot and
    // every vehicle is left without one, and paid time silently falls back to
    // being measured from the tasks.
    const c = state.vehicles.filter((v) => v.baseId === id).length
      + (state.settings?.defaultBaseId === id ? 1 : 0);
    return n(c, "jármű/beállítás");
  }
  if (kind === "drivers") {
    const c = state.rides.filter((r) => r.driverId === id).length + chainRefs(state, "driverId", id);
    return n(c, "fuvar/beosztás");
  }
  return null;
}
