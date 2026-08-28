import { describe, test, expect } from "vitest";
import {
  ensureShape, seedState, baseOf, spanOf, mergeShifts, driverPay, onSiteWait,
  chainUse, mkChain, genDayTasks, optimizeDay, dayStats, deleteGuard, mondayOf, legMin,
} from "../fuvarterv.jsx";

/*
 * Telephely és fizetett idő. A sofőr akkor lép munkába, amikor elindul a
 * telephelyről, és akkor végez, amikor visszaért — a láncok telephely–telephely
 * sávjai pedig összeolvadnak, ha nincs köztük idő hazamenni. Ebből következik a
 * javított viselkedés: távoli helyszínnél a köztes idő fizetett várakozás, egy
 * kiszállási díjjal, nem pedig két külön műszak.
 */

const WEEKDAY = 2;
const WEEK_MON = mondayOf(new Date(2025, 0, 6));
const settings = { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500, dwellMin: 2,
  estSpeedKmh: 60, fallbackLegMin: 12, preferredBias: 0, defaultBaseId: "hZAK" };

/* Zákányszék a telephely; a helyszín távolsága paraméterezhető. */
function makeState({ venue, base = "hZAK", vehicleBase = null } = {}) {
  return {
    stations: [{ id: "sZAK", name: "Zákányszék", lat: 46.2745, lon: 19.889 }],
    bases: [
      { id: "hZAK", name: "Klub", address: "", note: "", lat: 46.2745, lon: 19.889 },
      { id: "hTAVOL", name: "Sofőr lakcíme", address: "", note: "", lat: 47.5, lon: 20.0 },
    ],
    venues: [venue],
    vehicles: [{ id: "b1", name: "Busz", plate: "AB-1", seats: 20, hasVignette: true, baseId: vehicleBase }],
    drivers: [{ id: "d1", name: "Anna", wage: 3000, minShiftMin: 0, availability: [], preferredVehicleId: null },
      { id: "d2", name: "Béla", wage: 3000, minShiftMin: 0, availability: [], preferredVehicleId: null }],
    teams: [{ id: "tm", name: "TM", color: "#000", stationIds: ["sZAK"], venueIds: [venue.id],
      passengerCount: 10, stationCounts: { sZAK: 10 }, routeMode: "auto", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null }],
    trainings: [{ id: "tr", teamId: "tm", venueId: venue.id, type: "weekly", days: [WEEKDAY],
      date: null, start: "14:00", end: "16:00", stops: null }],
    rides: [], assignments: {}, matrix: null,
    settings: { ...settings, defaultBaseId: base },
  };
}
const EGER = { id: "vEGER", name: "Eger", lat: 47.9026, lon: 20.3772, needsVignette: false };
const KOZELI = { id: "vKOZ", name: "Mórahalom", lat: 46.2172, lon: 19.883, needsVignette: false };

describe("melyik telephelyről indul a busz", () => {
  test("a jármű saját telephelye erősebb a klubénál", () => {
    expect(baseOf(makeState({ venue: EGER }), "b1")).toBe("hZAK");
    expect(baseOf(makeState({ venue: EGER, vehicleBase: "hTAVOL" }), "b1")).toBe("hTAVOL");
  });

  test("telephely nélkül null — ilyenkor marad a régi számítás", () => {
    const s = makeState({ venue: EGER, base: null });
    expect(baseOf(s, "b1")).toBe(null);
    expect(spanOf(s, { vehicleId: "b1", start: 600, end: 700, from: "sZAK", to: "vEGER" }))
      .toEqual({ start: 600, end: 700 });
  });

  test("a sáv a telephelytől a visszaérkezésig tart", () => {
    const s = makeState({ venue: EGER });
    const span = spanOf(s, { vehicleId: "b1", start: 600, end: 700, from: "sZAK", to: "vEGER" });
    expect(span.start).toBe(600 - legMin(s, "hZAK", "sZAK"));
    expect(span.end).toBe(700 + legMin(s, "vEGER", "hZAK"));
  });
});

describe("műszakok összeolvadása", () => {
  test("az egymásba érő sávok egy műszak", () => {
    expect(mergeShifts([{ start: 100, end: 200 }, { start: 150, end: 300 }])).toEqual([{ start: 100, end: 300 }]);
    expect(mergeShifts([{ start: 100, end: 200 }, { start: 200, end: 300 }])).toEqual([{ start: 100, end: 300 }]);
  });

  test("a különálló sávok külön műszakok", () => {
    expect(mergeShifts([{ start: 100, end: 200 }, { start: 260, end: 300 }]))
      .toEqual([{ start: 100, end: 200 }, { start: 260, end: 300 }]);
  });

  test("műszakonként egy kiszállási díj, nem lánconként", () => {
    const s = makeState({ venue: EGER });
    const d = s.drivers[0];
    const one = driverPay(s, d, [{ driverId: "d1", vehicleId: "b1", start: 600, end: 700, from: "sZAK", to: "vEGER" }]);
    const two = driverPay(s, d, [
      { driverId: "d1", vehicleId: "b1", start: 600, end: 700, from: "sZAK", to: "vEGER" },
      { driverId: "d1", vehicleId: "b1", start: 800, end: 900, from: "vEGER", to: "sZAK" },
    ]);
    expect(one.shifts).toHaveLength(1);
    expect(two.shifts).toHaveLength(1);                       // nem tud hazamenni Egerből
    expect(two.cost - one.cost).toBeLessThan(one.cost);        // nincs második kiszállás
  });
});

describe("az egri eset", () => {
  const state = makeState({ venue: EGER });
  const out = optimizeDay(state, WEEKDAY, WEEK_MON);

  test("a két feladat EGY láncba kerül", () => {
    expect(out.chains).toHaveLength(1);
    expect(out.chains[0].tasks).toHaveLength(2);
  });

  test("a helyszíni várakozás megjelenik és fizetett", () => {
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    const [oda, vissza] = [tasks.find((t) => t.dir === "oda"), tasks.find((t) => t.dir === "vissza")];
    const wait = vissza.start - oda.end;
    expect(wait).toBeGreaterThan(60);

    const st = dayStats(state, out.chains);
    expect(st.idle).toBe(wait);
    expect(st.paidMin).toBeGreaterThanOrEqual(vissza.end - oda.start);
  });

  test("egy sofőr, egy kiszállási díj", () => {
    const st = dayStats(state, out.chains);
    expect(st.drivers).toBe(1);
    const d = state.drivers[0];
    expect(st.cost).toBe(Math.round(1500 + (st.paidMin / 60) * d.wage));
  });

  test("telephely nélkül a régi (hibás) viselkedés jön vissza — a szabálynak adat kell", () => {
    const noBase = makeState({ venue: EGER, base: null });
    const o = optimizeDay(noBase, WEEKDAY, WEEK_MON);
    expect(o.chains.length).toBe(2);
    expect(dayStats(noBase, o.chains).idle).toBe(0);
  });
});

describe("közeli helyszínnél marad a mai elszámolás", () => {
  test("ha van idő hazamenni, a rés nem fizetett", () => {
    const state = makeState({ venue: KOZELI });
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    const oda = tasks.find((t) => t.dir === "oda"), vissza = tasks.find((t) => t.dir === "vissza");
    const uses = [chainUse(mkChain(state, [oda]), "d1", "b1"), chainUse(mkChain(state, [vissza]), "d1", "b1")];
    const home = legMin(state, "vKOZ", "hZAK");
    expect(vissza.start - oda.end).toBeGreaterThan(2 * home);   // tényleg hazaérne
    expect(driverPay(state, state.drivers[0], uses).shifts).toHaveLength(2);
    expect(onSiteWait(state, uses)).toBe(0);
  });
});

describe("törlésvédelem és mintaadat", () => {
  test("használatban lévő telephely nem törölhető", () => {
    const s = makeState({ venue: EGER, vehicleBase: "hTAVOL" });
    expect(deleteGuard(s, "bases", "hTAVOL")).toMatch(/Használatban/);
    expect(deleteGuard(s, "bases", "hZAK")).toMatch(/Használatban/);   // a klub telephelye
  });

  test("a mintaadat klubtelephellyel indul", () => {
    const s = ensureShape(seedState());
    expect(s.bases.length).toBeGreaterThan(0);
    expect(baseOf(s, s.vehicles[0].id)).toBe(s.settings.defaultBaseId);
  });

  test("ensureShape a régi adatnak üres telephelylistát és null baseId-t ad", () => {
    const s = ensureShape({ vehicles: [{ id: "v" }] });
    expect(s.bases).toEqual([]);
    expect(s.vehicles[0].baseId).toBe(null);
  });
});
