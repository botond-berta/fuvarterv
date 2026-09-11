import { describe, test, expect } from "vitest";
import { ensureShape } from "../src/data/seed.js";
import { mondayOf } from "../src/domain/datetime.js";
import { teamLeg, legFor, legSource, hasOwnStops, deleteGuard } from "../src/domain/logic.js";
import { legPax, teamPax, legRouteOrder, genDayTasks } from "../src/domain/optimizer.js";

/*
 * A team can have several trainings, possibly at different venues, but the stop list
 * lived on the team, so every session got the same route and the same headcount. A
 * training's `stops` field overrides that.
 *
 * The governing rule is the same one the return leg uses: ABSENCE (null) means the
 * original behaviour, so every training without an override must work exactly as it
 * did before.
 */

const WEEKDAY = 2;
const WEEK_MON = mondayOf(new Date(2025, 0, 6));

const stations = [
  { id: "sA", name: "A", lat: 46.10, lon: 19.80 },
  { id: "sB", name: "B", lat: 46.20, lon: 19.85 },
  { id: "sC", name: "C", lat: 46.30, lon: 19.90 },
  { id: "sD", name: "D", lat: 46.40, lon: 19.95 },
];
const venues = [
  { id: "v0", name: "V0", lat: 46.25, lon: 19.88 },
  { id: "v1", name: "V1", lat: 46.05, lon: 19.75 },
];
const settings = { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500,
  dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 0 };

const team = (extra = {}) => ({
  id: "tm", name: "TM", age: "U12", gender: "vegyes", color: "#000",
  stationIds: ["sA", "sB"], venueIds: ["v0", "v1"], passengerCount: null,
  stationCounts: { sA: 2, sB: 3 }, routeMode: "auto", routeAnchorId: null,
  returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, ...extra,
});
const training = (id, venueId, stops = null) => ({
  id, teamId: "tm", venueId, type: "weekly", days: [WEEKDAY], date: null,
  start: "16:00", end: "17:30", stops,
});
const ownStops = (extra = {}) => ({
  stationIds: ["sC"], stationCounts: { sC: 4 }, routeMode: "auto", routeAnchorId: null,
  returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null,
  passengerCount: null, ...extra,
});
const makeState = (t, trainings) => ({
  stations, venues, drivers: [], rides: [], assignments: {}, matrix: null, settings,
  vehicles: [{ id: "veh1", name: "v", plate: "AB-1", seats: 20 }],
  teams: [t], trainings,
});
const stopsOf = (task) => task.plan.map((p) => p.stationId);

describe("felülírás nélkül minden marad a régiben", () => {
  test("stops: null esetén a legFor a csapat lábát adja", () => {
    const t = team();
    for (const dir of ["oda", "vissza"]) {
      expect(legFor(t, training("tr", "v0"), dir)).toEqual(teamLeg(t, dir));
    }
  });

  test("legSource null edzésnél és felülírás nélküli edzésnél is a csapat", () => {
    const t = team();
    expect(legSource(t, null)).toBe(t);
    expect(legSource(t, training("tr", "v0"))).toBe(t);
    expect(hasOwnStops(training("tr", "v0"))).toBe(false);
    expect(hasOwnStops(training("tr", "v0", ownStops()))).toBe(true);
  });

  test("ensureShape a régi edzéseknek null stops-ot ad", () => {
    const shaped = ensureShape({ trainings: [{ id: "tr", teamId: "tm", venueId: "v0" }] });
    expect(shaped.trainings[0].stops).toBe(null);
  });

  test("a meglévő stops értéket nem írja felül", () => {
    const shaped = ensureShape({ trainings: [{ id: "tr", stops: ownStops() }] });
    expect(shaped.trainings[0].stops.stationIds).toEqual(["sC"]);
  });
});

describe("az edzés saját listája felülírja a csapatét", () => {
  test("egy csapat két edzése egy napon, két helyszínen, két útvonallal", () => {
    const state = makeState(team(), [
      training("trA", "v0"),
      training("trB", "v1", ownStops()),
    ]);
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    const byTraining = (id, dir) => tasks.find((x) => x.trainingId === id && x.dir === dir);

    expect(stopsOf(byTraining("trA", "oda")).sort()).toEqual(["sA", "sB"]);
    expect(stopsOf(byTraining("trB", "oda"))).toEqual(["sC"]);
    expect(byTraining("trA", "oda").pax).toBe(5);
    expect(byTraining("trB", "oda").pax).toBe(4);
  });

  test("a saját listás edzés visszaútja a SAJÁT odaútját tükrözi, nem a csapatét", () => {
    const t = team({ returnStationIds: ["sD"], returnStationCounts: { sD: 5 } });
    const tr = training("trB", "v1", ownStops({ stationIds: ["sC", "sA"], stationCounts: { sC: 4, sA: 1 } }));
    const leg = legFor(t, tr, "vissza");
    expect(leg.stationIds).toEqual(["sC", "sA"]);
    expect(leg.isOverride).toBe(false);
    // the team's own return list stays in force at the team level only
    expect(teamLeg(t, "vissza").stationIds).toEqual(["sD"]);
  });

  test("a felülíráson belül is lehet saját visszaút-lista", () => {
    const tr = training("trB", "v1", ownStops({ returnStationIds: ["sD"], returnStationCounts: { sD: 4 } }));
    const leg = legFor(team(), tr, "vissza");
    expect(leg.stationIds).toEqual(["sD"]);
    expect(leg.stationCounts).toEqual({ sD: 4 });
    expect(leg.isOverride).toBe(true);
  });

  test("a felülírás saját útvonal-módot visz: kézi sorrend a csapat automatikusa mellett", () => {
    const t = team({ routeMode: "auto" });
    const tr = training("trB", "v1", ownStops({ stationIds: ["sD", "sA", "sC"], routeMode: "manual", stationCounts: {} }));
    expect(legRouteOrder(makeState(t, [tr]), t, tr, "v1", "oda")).toEqual(["sD", "sA", "sC"]);
  });
});

describe("létszám: a tartalék abból a forrásból jön, amelyik a megállókat is adja", () => {
  test("a csapat kerete nem szivárog át a saját listás edzésre", () => {
    const t = team({ passengerCount: 30 });
    const tr = training("trB", "v1", ownStops({ stationCounts: {} }));
    expect(teamPax(t)).toBe(30);
    expect(legPax(t, tr, "oda")).toBe(0);
  });

  test("a felülírás saját összlétszáma érvényesül", () => {
    const t = team({ passengerCount: 30 });
    const tr = training("trB", "v1", ownStops({ stationCounts: {}, passengerCount: 6 }));
    expect(legPax(t, tr, "oda")).toBe(6);
  });

  test("a megállónkénti bontás akkor is nyer, ha nagyobb az összlétszámnál", () => {
    const tr = training("trB", "v1", ownStops({ stationCounts: { sC: 9 }, passengerCount: 4 }));
    expect(legPax(team(), tr, "oda")).toBe(9);
  });
});

describe("törlésvédelem és címkék", () => {
  test("a csak edzés-felülírásban használt állomás nem törölhető", () => {
    const state = makeState(team(), [training("trB", "v1", ownStops())]);
    expect(deleteGuard(state, "stations", "sC")).toMatch(/Használatban/);
    expect(deleteGuard(state, "stations", "sD")).toBe(null);
  });

  test("a visszaút-felülírásban használt állomás sem törölhető", () => {
    const state = makeState(team(), [training("trB", "v1", ownStops({ returnStationIds: ["sD"] }))]);
    expect(deleteGuard(state, "stations", "sD")).toMatch(/Használatban/);
  });

  test("egy napon két edzésnél a feladatnév megnevezi a helyszínt", () => {
    const state = makeState(team(), [training("trA", "v0"), training("trB", "v1", ownStops())]);
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    const labels = tasks.filter((x) => x.dir === "oda").map((x) => x.label).sort();
    expect(labels).toEqual(["TM · V0 · ODA", "TM · V1 · ODA"]);
  });

  test("egyetlen edzésnél a címke marad rövid", () => {
    const state = makeState(team(), [training("trA", "v0")]);
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    expect(tasks.find((x) => x.dir === "oda").label).toBe("TM · ODA");
  });
});
