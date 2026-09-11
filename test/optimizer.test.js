import { describe, test, expect } from "vitest";
import { mondayOf, minToTime } from "../src/domain/datetime.js";
import { legMin } from "../src/domain/geo.js";
import { optimizeDay, genDayTasks, driverAvailableFor } from "../src/domain/optimizer.js";

/*
 * Property tests for optimizeDay over randomly generated states, checking the
 * invariants a correct schedule must satisfy. A single seeded PRNG keeps the
 * run reproducible.
 */

const WEEKDAY = 2; // Wednesday (Monday-first index)
const WEEK_MON = mondayOf("2026-08-05");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genState(rng) {
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const nS = ri(2, 6);
  const stations = Array.from({ length: nS }, (_, i) => ({ id: `s${i}`, name: `s${i}`, lat: 46 + rng(), lon: 19 + rng() }));
  const venues = Array.from({ length: ri(1, 2) }, (_, i) => ({ id: `v${i}`, name: `v${i}`, lat: 46 + rng(), lon: 19 + rng() }));
  const vehicles = Array.from({ length: ri(1, 4) }, (_, i) => ({ id: `veh${i}`, name: `veh${i}`, plate: `AB-${i}`, seats: ri(6, 9), note: "" }));
  const drivers = Array.from({ length: ri(1, 4) }, (_, i) => {
    // Occasionally give a driver a window that may not cover every training.
    const windowed = rng() < 0.3;
    const availability = windowed ? [{ days: [WEEKDAY], start: "15:00", end: `${ri(18, 21)}:00` }] : [];
    return { id: `d${i}`, name: `d${i}`, phone: "", note: "", wage: ri(20, 40) * 100, minShiftMin: ri(1, 3) * 60, availability, preferredVehicleId: null };
  });

  const teams = [], trainings = [];
  for (let i = 0; i < ri(1, 4); i++) {
    const k = ri(1, nS);
    const subset = [...stations].sort(() => rng() - 0.5).slice(0, k).map((s) => s.id);
    const stationCounts = {};
    for (const sid of subset) stationCounts[sid] = ri(1, 4);
    const venueId = pick(venues).id;
    /* Some teams get their own return list, so the invariants also run against
       direction-specific stops and direction-specific bus splits, not just the
       mirrored case. */
    let returnStationIds = null, returnStationCounts = {};
    if (rng() < 0.35) {
      const rk = ri(1, nS);
      returnStationIds = [...stations].sort(() => rng() - 0.5).slice(0, rk).map((s) => s.id);
      for (const sid of returnStationIds) returnStationCounts[sid] = ri(1, 4);
    }
    teams.push({ id: `tm${i}`, name: `tm${i}`, age: "U12", gender: "vegyes", color: "#000",
      stationIds: subset, venueIds: [venueId], passengerCount: null, stationCounts, routeMode: "auto", routeAnchorId: null,
      returnStationIds, returnStationCounts, returnRouteAnchorId: null });
    const startMin = ri(15, 18) * 60;
    const endMin = startMin + pick([60, 90, 120]);
    trainings.push({ id: `tr${i}`, teamId: `tm${i}`, venueId, type: "weekly", days: [WEEKDAY], date: null, start: minToTime(startMin), end: minToTime(endMin) });
  }

  return {
    teams, stations, venues, vehicles, drivers, trainings,
    rides: [], assignments: {}, matrix: null,
    // preferredBias 0 so the optimizer's objective is pure monetary cost.
    settings: { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500, dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 0 },
  };
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

describe("optimizeDay invariants (property test over generated states)", () => {
  test("100 random states all satisfy the scheduling invariants", () => {
    const rng = mulberry32(12345);
    let checkedNonEmpty = 0;

    for (let n = 0; n < 100; n++) {
      const state = genState(rng);
      const out = optimizeDay(state, WEEKDAY, WEEK_MON);
      if (out.empty) continue;
      checkedNonEmpty++;

      const vehById = Object.fromEntries(state.vehicles.map((v) => [v.id, v]));
      const drvById = Object.fromEntries(state.drivers.map((d) => [d.id, d]));

      // (1) Conservation: every generated task appears exactly once across
      // chains + uncovered (as a multiset — no duplicates, none missing).
      const allTaskIds = genDayTasks(state, WEEKDAY, WEEK_MON).tasks.map((t) => t.id);
      const covered = out.chains.flatMap((c) => c.tasks.map((t) => t.id));
      const uncovered = out.uncovered.map((u) => u.task.id);
      expect([...covered, ...uncovered].sort()).toEqual([...allTaskIds].sort());

      for (let i = 0; i < out.chains.length; i++) {
        const c = out.chains[i];
        const veh = vehById[c.vehicleId];
        const drv = drvById[c.driverId];

        // (3) Capacity: the vehicle seats at least the chain's peak headcount.
        expect(veh).toBeTruthy();
        expect(veh.seats).toBeGreaterThanOrEqual(c.maxPax);

        // (4) Availability: the driver can cover the whole chain window.
        expect(drv).toBeTruthy();
        expect(driverAvailableFor(drv, WEEKDAY, c.start, c.end)).toBe(true);

        // (2) A shared driver/vehicle must be physically able to do both chains:
        // no time overlap AND enough room for the deadhead between them. Checking
        // only the overlap (as this invariant used to) accepts a roster where the
        // same bus finishes in one village and starts in another at the same
        // minute — which is exactly the bug this now guards against.
        for (let j = i + 1; j < out.chains.length; j++) {
          const o = out.chains[j];
          const shared = c.driverId === o.driverId || c.vehicleId === o.vehicleId;
          if (!shared) continue;
          expect(overlaps(c, o)).toBe(false);
          const [first, second] = c.start <= o.start ? [c, o] : [o, c];
          const dead = legMin(state, first.tasks[first.tasks.length - 1].to, second.tasks[0].from);
          expect(first.end + dead).toBeLessThanOrEqual(second.start);
        }
      }

      // (6) Every uncovered task carries a non-empty reason.
      for (const u of out.uncovered) {
        expect(Array.isArray(u.reasons)).toBe(true);
        expect(u.reasons.length).toBeGreaterThan(0);
        expect(u.reasons.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
      }

      // (5) Local improvement never increases the optimizer's objective.
      expect(out.improve.after).toBeLessThanOrEqual(out.improve.before + 1e-6);
    }

    expect(checkedNonEmpty).toBeGreaterThan(50); // sanity: we actually exercised it
  });
});

describe("locked tasks keep their driver + vehicle (invariant 7)", () => {
  test("a locked task's chain is untouched by the optimizer", () => {
    const state = {
      teams: [{ id: "tm", name: "tm", stationIds: ["s0"], venueIds: ["v0"], passengerCount: null, stationCounts: { s0: 3 }, routeMode: "auto", routeAnchorId: null }],
      stations: [{ id: "s0", name: "s0", lat: 46.1, lon: 19.1 }],
      venues: [{ id: "v0", name: "v0", lat: 46.2, lon: 19.2 }],
      vehicles: [{ id: "V", name: "V", plate: "AB-1", seats: 8, note: "" }, { id: "V2", name: "V2", plate: "AB-2", seats: 8, note: "" }],
      drivers: [
        { id: "D", name: "D", phone: "", note: "", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: null },
        { id: "D2", name: "D2", phone: "", note: "", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: null },
      ],
      trainings: [{ id: "tr", teamId: "tm", venueId: "v0", type: "weekly", days: [WEEKDAY], date: null, start: "16:00", end: "17:30" }],
      rides: [],
      assignments: { [WEEKDAY]: { chains: [{ id: "ch1", driverId: "D", vehicleId: "V", taskIds: [{ id: "tr:2:oda", locked: true }] }] } },
      matrix: null,
      settings: { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500, dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 0 },
    };

    const out = optimizeDay(state, WEEKDAY, WEEK_MON);
    const lockedChain = out.chains.find((c) => c.tasks.some((t) => t.id === "tr:2:oda"));
    expect(lockedChain).toBeTruthy();
    expect(lockedChain.driverId).toBe("D");
    expect(lockedChain.vehicleId).toBe("V");
    // and the locked task is covered, not dropped to uncovered
    expect(out.uncovered.some((u) => u.task.id === "tr:2:oda")).toBe(false);
  });
});
