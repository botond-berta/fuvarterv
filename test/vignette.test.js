import { describe, test, expect } from "vitest";
import {
  ensureShape, seedState, venueNeedsVignette, taskNeedsVignette, chainNeedsVignette,
  genDayTasks, optimizeDay, resolveDay, mondayOf,
} from "../fuvarterv.jsx";

/*
 * Országos autópálya-matrica. A jelölés a HELYSZÍNEN van, a tény a JÁRMŰVÖN, és
 * a matrica ugyanolyan kemény feltétel, mint a férőhely: az optimalizáló eleve
 * nem javasol matrica nélküli autót matricás helyszínre, tehát nincs mit kézzel
 * visszajavítani. A kézi zárolás továbbra is felülbírál mindent.
 */

const WEEKDAY = 2;
const WEEK_MON = mondayOf(new Date(2025, 0, 6));

const settings = { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500,
  dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 0 };

function makeState({ vehicles, needsVignette = true }) {
  return {
    stations: [{ id: "sA", name: "A", lat: 46.10, lon: 19.80 }],
    venues: [{ id: "v0", name: "Algyő", lat: 46.25, lon: 19.88, needsVignette }],
    vehicles,
    drivers: [{ id: "d1", name: "Anna", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: null },
      { id: "d2", name: "Béla", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: null }],
    rides: [], assignments: {}, matrix: null, settings,
    teams: [{ id: "tm", name: "TM", color: "#000", stationIds: ["sA"], venueIds: ["v0"],
      passengerCount: null, stationCounts: { sA: 4 }, routeMode: "auto", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null }],
    trainings: [{ id: "tr", teamId: "tm", venueId: "v0", type: "weekly",
      days: [WEEKDAY], date: null, start: "16:00", end: "17:30", stops: null }],
  };
}
const bus = (id, hasVignette, seats = 20) => ({ id, name: id, plate: id, seats, hasVignette });
/* Melyik járművek kerültek beosztásra — a láncok SZÁMA az optimalizáló
   döntése (egy busz két feladatot is elvihet egymás után), a szabály viszont
   arról szól, hogy melyik jármű kerülhet oda egyáltalán. */
const vehiclesOf = (out) => [...new Set(out.chains.map((c) => c.vehicleId))].sort();

describe("adatmodell", () => {
  test("ensureShape mindkét mezőt logikaira tölti", () => {
    const s = ensureShape({ vehicles: [{ id: "v" }], venues: [{ id: "x" }] });
    expect(s.vehicles[0].hasVignette).toBe(false);
    expect(s.venues[0].needsVignette).toBe(false);
  });

  test("a meglévő igaz értéket megtartja", () => {
    const s = ensureShape({ vehicles: [{ id: "v", hasVignette: true }], venues: [{ id: "x", needsVignette: true }] });
    expect(s.vehicles[0].hasVignette).toBe(true);
    expect(s.venues[0].needsVignette).toBe(true);
  });

  test("a mintaadat matricái követik a járművek jegyzetét", () => {
    const s = seedState();
    for (const v of s.vehicles) expect(v.hasVignette).toBe(/Országos/.test(v.note));
  });
});

describe("a szabály: a helyszín dönt, iránytól függetlenül", () => {
  const state = makeState({ vehicles: [bus("mat", true)] });
  const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);

  test("a helyszín jelölése látszik mindkét irány feladatán", () => {
    expect(venueNeedsVignette(state, "v0")).toBe(true);
    expect(tasks.map((t) => taskNeedsVignette(state, t))).toEqual([true, true]);
  });

  test("megálló nem jelölhető: az állomás sosem kényszerít matricát", () => {
    expect(venueNeedsVignette(state, "sA")).toBe(false);
  });

  test("jelöletlen helyszínnél egyik feladat sem igényel matricát", () => {
    const plain = makeState({ vehicles: [bus("mat", true)], needsVignette: false });
    const out = genDayTasks(plain, WEEKDAY, WEEK_MON);
    expect(out.tasks.some((t) => taskNeedsVignette(plain, t))).toBe(false);
    expect(chainNeedsVignette(plain, { tasks: out.tasks })).toBe(false);
  });
});

describe("az optimalizáló nem oszt be matrica nélküli autót", () => {
  test("a matricás buszt választja, pedig a másik is elférne", () => {
    const out = optimizeDay(makeState({ vehicles: [bus("nincs", false), bus("van", true)] }), WEEKDAY, WEEK_MON);
    expect(out.uncovered).toHaveLength(0);
    expect(vehiclesOf(out)).toEqual(["van"]);
  });

  test("matrica nélküli flottánál a feladat fedetlen, indoklással", () => {
    const out = optimizeDay(makeState({ vehicles: [bus("nincs", false)] }), WEEKDAY, WEEK_MON);
    expect(out.chains).toHaveLength(0);
    expect(out.uncovered).toHaveLength(2);
    expect(out.uncovered[0].reasons.join(" ")).toContain("Nincs országos matricás jármű");
    expect(out.uncovered[0].reasons.join(" ")).toContain("Algyő");
  });

  test("jelöletlen helyszínnél a matrica nélküli busz is jó", () => {
    const out = optimizeDay(makeState({ vehicles: [bus("nincs", false)], needsVignette: false }), WEEKDAY, WEEK_MON);
    expect(out.uncovered).toHaveLength(0);
    expect(vehiclesOf(out)).toEqual(["nincs"]);
  });

  test("a férőhely és a matrica együtt szűr", () => {
    const out = optimizeDay(makeState({ vehicles: [bus("kicsi", true, 2), bus("nagy", false, 20)] }), WEEKDAY, WEEK_MON);
    expect(out.chains).toHaveLength(0);
    expect(out.uncovered[0].reasons.join(" ")).toContain("Nincs országos matricás jármű");
  });
});

describe("a kézi döntés marad, de a hibát megmondjuk", () => {
  const chainWith = (state, vehicleId) => {
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    return { ...state, assignments: { [WEEKDAY]: { chains: [
      { id: "c1", driverId: "d1", vehicleId, taskIds: tasks.map((t) => ({ id: t.id, locked: true })) },
    ] } } };
  };

  test("a zárolt, matrica nélküli hozzárendelést az optimalizálás nem írja át", () => {
    const state = chainWith(makeState({ vehicles: [bus("nincs", false), bus("van", true)] }), "nincs");
    const out = optimizeDay(state, WEEKDAY, WEEK_MON);
    expect(vehiclesOf(out)).toEqual(["nincs"]);
  });

  test("de a beosztás élőben jelzi, hogy hiányzik a matrica", () => {
    const state = chainWith(makeState({ vehicles: [bus("nincs", false)] }), "nincs");
    const issues = resolveDay(state, WEEKDAY, WEEK_MON).chains[0].issues.join(" ");
    expect(issues).toContain("nincs országos matricával");
    expect(issues).toContain("Algyő");
  });

  test("matricás járműnél nincs figyelmeztetés", () => {
    const state = chainWith(makeState({ vehicles: [bus("van", true)] }), "van");
    expect(resolveDay(state, WEEKDAY, WEEK_MON).chains[0].issues).toEqual([]);
  });
});
