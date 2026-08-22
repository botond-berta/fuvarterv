import { describe, test, expect } from "vitest";
import {
  legMin, teamPax, deleteGuard, ensureShape,
  planOda, planVissza, venueDepartMin, timeToMin, minToTime, bestStationOrder,
} from "../vector.jsx";

/*
 * Regression tests for the defects fixed in this branch. Each test states the
 * wrong behaviour it locks out, so a future change that reintroduces it fails
 * here with an explanation rather than a bare assertion.
 */

const baseSettings = {
  arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500,
  dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 1000,
};

describe("legMin requires both coordinates", () => {
  // A station with lat but no lon used to reach haversine, which returns NaN;
  // Math.max(1, NaN) is NaN, not 1, so the NaN spread through every timetable.
  const state = {
    settings: baseSettings, matrix: null,
    stations: [{ id: "a", lat: 46.2, lon: 19.8 }, { id: "half", lat: 46.3, lon: null }],
    venues: [],
  };

  test("falls back instead of returning NaN when lon is missing", () => {
    const m = legMin(state, "a", "half");
    expect(Number.isNaN(m)).toBe(false);
    expect(m).toBe(baseSettings.fallbackLegMin);
  });

  test("still uses the estimate when both coordinates are present", () => {
    const full = { ...state, stations: [{ id: "a", lat: 46.2, lon: 19.8 }, { id: "b", lat: 46.4, lon: 20.1 }] };
    expect(legMin(full, "a", "b")).toBeGreaterThan(baseSettings.fallbackLegMin);
  });
});

describe("teamPax never undercounts a stated total", () => {
  // A partial per-stop breakdown used to override passengerCount, so a 12-child
  // team whose coach had filled in two stops planned as 5 and got a 6-seat bus.
  test("takes the larger of the breakdown sum and the stated total", () => {
    const team = { stationIds: ["s1", "s2", "s3"], stationCounts: { s1: 3, s2: 2 }, passengerCount: 12 };
    expect(teamPax(team)).toBe(12);
  });

  test("uses the breakdown when it exceeds the stated total", () => {
    const team = { stationIds: ["s1", "s2"], stationCounts: { s1: 7, s2: 6 }, passengerCount: 10 };
    expect(teamPax(team)).toBe(13);
  });

  test("falls back to the total when there is no breakdown", () => {
    expect(teamPax({ stationIds: ["s1"], stationCounts: {}, passengerCount: 9 })).toBe(9);
  });
});

describe("deleteGuard covers the saved schedule and preferred vehicles", () => {
  const state = {
    teams: [], trainings: [], rides: [],
    drivers: [{ id: "d1", preferredVehicleId: "v9" }],
    assignments: { 2: { chains: [{ id: "c1", driverId: "d2", vehicleId: "v1", taskIds: [] }] } },
  };

  test("blocks deleting a driver that only a schedule chain references", () => {
    // No ride references d2 — only a chain. This used to delete cleanly and
    // leave the chain priced at 0 Ft with no warning anywhere.
    expect(deleteGuard(state, "drivers", "d2")).toBeTruthy();
  });

  test("blocks deleting a vehicle that only a schedule chain references", () => {
    expect(deleteGuard(state, "vehicles", "v1")).toBeTruthy();
  });

  test("blocks deleting a vehicle that is a driver's preferred bus", () => {
    // A dangling preferredVehicleId leaves offPreferred permanently true, so the
    // preferredBias quietly hides that driver from the optimizer forever.
    expect(deleteGuard(state, "vehicles", "v9")).toBeTruthy();
  });

  test("allows deleting an unreferenced entity", () => {
    expect(deleteGuard(state, "vehicles", "v-unused")).toBeNull();
  });
});

describe("ensureShape normalises every collection", () => {
  test("an almost-empty blob gains all arrays and safe defaults", () => {
    const s = ensureShape({});
    for (const k of ["stations", "venues", "vehicles", "drivers", "teams", "trainings", "rides"]) {
      expect(Array.isArray(s[k])).toBe(true);
    }
    expect(s.assignments).toEqual({});
  });

  test("a vehicle without seats becomes 0, not unlimited capacity", () => {
    // `undefined < pax` is false, so a seatless bus used to pass every capacity
    // check and could be assigned to any chain.
    const s = ensureShape({ vehicles: [{ id: "v1" }] });
    expect(s.vehicles[0].seats).toBe(0);
  });

  test("legacy records gain the fields the render path dereferences", () => {
    const s = ensureShape({ teams: [{ id: "t" }], rides: [{ id: "r" }], trainings: [{ id: "x" }] });
    expect(s.teams[0].stationIds).toEqual([]);
    expect(s.teams[0].venueIds).toEqual([]);
    expect(s.rides[0].stops).toEqual([]);
    expect(s.rides[0].dir).toBe("oda");
    expect(s.trainings[0].days).toEqual([]);
  });
});

describe("return-direction ride planning", () => {
  /* The ride editor used to run planOda for both directions, so opening a
     generated VISSZA ride and pressing "Idők számítása" rewrote its stop times
     to a morning-style plan ending at the training START — hours wrong, and
     shown to drivers. These assert the two directions are anchored differently. */
  const state = {
    settings: baseSettings, matrix: null,
    stations: [{ id: "s1", lat: 46.20, lon: 19.80 }, { id: "s2", lat: 46.30, lon: 19.90 }],
    venues: [{ id: "v0", lat: 46.25, lon: 19.85 }],
  };
  const training = { id: "tr", venueId: "v0", start: "17:00", end: "18:30", type: "weekly" };
  const order = ["s1", "s2"];

  test("outbound is anchored to arriving before the training starts", () => {
    const arriveBy = timeToMin(training.start) - state.settings.arriveEarlyMin;
    const p = planOda(state, order, "v0", arriveBy, state.settings.dwellMin);
    expect(p.end).toBe(arriveBy);
    expect(p.stops.every((s) => s.arr < arriveBy)).toBe(true);
  });

  test("return is anchored to departing after the training ends", () => {
    const departAt = venueDepartMin(state, training);
    expect(departAt).toBe(timeToMin(training.end) + state.settings.departAfterMin);
    const p = planVissza(state, order, "v0", departAt, state.settings.dwellMin);
    expect(p.start).toBe(departAt);
    // Every drop-off happens after the bus leaves the venue, not before the
    // training starts — this is the assertion planOda would fail for a return.
    expect(p.stops.every((s) => s.arr > departAt)).toBe(true);
    expect(p.stops.every((s) => s.arr > timeToMin(training.start))).toBe(true);
  });

  test("the two directions produce genuinely different timetables", () => {
    const arriveBy = timeToMin(training.start) - state.settings.arriveEarlyMin;
    const oda = planOda(state, order, "v0", arriveBy, state.settings.dwellMin);
    const vissza = planVissza(state, order, "v0", venueDepartMin(state, training), state.settings.dwellMin);
    expect(minToTime(oda.stops[0].arr)).not.toBe(minToTime(vissza.stops[0].arr));
  });

  test("the venue anchors the opposite end of the route per direction", () => {
    // teamRouteOrder uses { post } for oda and { pre } for vissza; the ride
    // editor must follow the same convention or the optimised order is reversed.
    const odaOrder = bestStationOrder(state, order, { post: "v0" });
    const visszaOrder = bestStationOrder(state, order, { pre: "v0" });
    expect(odaOrder).toHaveLength(2);
    expect(visszaOrder).toHaveLength(2);
  });
});
