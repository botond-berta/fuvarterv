import { describe, test, expect } from "vitest";
import { genDayTasks, mondayOf } from "../fuvarterv.jsx";

/*
 * A 0 fős megálló kimarad az útvonalból — de csak a KIFEJEZETT nulla.
 * Az üresen hagyott mező mást jelent: "még nincs megadva". Egy félig kitöltött
 * bontásnál (az edző csak két megállóhoz írt létszámot) a többit kihagyni annyi
 * lenne, mint ottfelejteni a gyerekeket, ezért azokhoz a busz továbbra is elmegy.
 * A szerkesztő a kiürített mezőt ""-ként, a beírt nullát számként tárolja, így a
 * két eset megkülönböztethető.
 */

const WEEKDAY = 2;
const WEEK_MON = mondayOf(new Date(2025, 0, 6));

const stations = [
  { id: "sA", name: "A", lat: 46.10, lon: 19.80 },
  { id: "sB", name: "B", lat: 46.20, lon: 19.85 },
  { id: "sC", name: "C", lat: 46.30, lon: 19.90 },
];
const venues = [{ id: "v0", name: "V", lat: 46.25, lon: 19.88 }];
const settings = { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500,
  dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 0 };

function makeState(stationCounts, extra = {}) {
  return {
    stations, venues, drivers: [], rides: [], assignments: {}, matrix: null, settings,
    vehicles: [{ id: "veh1", name: "v", plate: "AB-1", seats: 20 }],
    teams: [{
      id: "tm", name: "TM", color: "#000", stationIds: ["sA", "sB", "sC"], venueIds: ["v0"],
      passengerCount: null, stationCounts, routeMode: "manual", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, ...extra,
    }],
    trainings: [{ id: "tr", teamId: "tm", venueId: "v0", type: "weekly",
      days: [WEEKDAY], date: null, start: "16:00", end: "17:30", stops: null }],
  };
}
const run = (state) => genDayTasks(state, WEEKDAY, WEEK_MON);
const stopsOf = (tasks, dir) => tasks.find((t) => t.dir === dir).plan.map((p) => p.stationId);

describe("a kifejezett 0 kihagyja a megállót", () => {
  test("odaúton kimarad az útvonalból", () => {
    const { tasks } = run(makeState({ sA: 2, sB: 0, sC: 3 }));
    expect(stopsOf(tasks, "oda")).toEqual(["sA", "sC"]);
  });

  test("visszaúton is kimarad", () => {
    const { tasks } = run(makeState({ sA: 2, sB: 0, sC: 3 }));
    expect(stopsOf(tasks, "vissza")).toEqual(["sC", "sA"]);
  });

  test("a \"0\" szöveg is kifejezett nulla", () => {
    const { tasks } = run(makeState({ sA: 2, sB: "0", sC: 3 }));
    expect(stopsOf(tasks, "oda")).toEqual(["sA", "sC"]);
  });

  test("a pax és a kiírt bontás sem tartalmazza", () => {
    const { tasks } = run(makeState({ sA: 2, sB: 0, sC: 3 }));
    const oda = tasks.find((t) => t.dir === "oda");
    expect(oda.pax).toBe(5);
    expect(oda.breakdown.map((b) => b.stationId)).toEqual(["sA", "sC"]);
  });
});

describe("az üres mező NEM nulla — oda a busz elmegy", () => {
  test("kiürített mező mellett a megálló megmarad", () => {
    const { tasks } = run(makeState({ sA: 2, sB: "", sC: 3 }));
    expect(stopsOf(tasks, "oda")).toEqual(["sA", "sB", "sC"]);
  });

  test("meg nem adott létszám mellett is megmarad", () => {
    const { tasks } = run(makeState({ sA: 2, sC: 3 }));
    expect(stopsOf(tasks, "oda")).toEqual(["sA", "sB", "sC"]);
  });

  test("bontás nélkül minden megálló megmarad", () => {
    const { tasks } = run(makeState({}, { passengerCount: 8 }));
    expect(stopsOf(tasks, "oda")).toEqual(["sA", "sB", "sC"]);
    expect(tasks.find((t) => t.dir === "oda").pax).toBe(8);
  });
});

describe("ha minden megálló 0", () => {
  test("nem készül feladat, és megmondjuk, miért", () => {
    const { tasks, skipped } = run(makeState({ sA: 0, sB: 0, sC: 0 }));
    expect(tasks).toHaveLength(0);
    expect(skipped.filter((m) => /minden megállónál 0 fő/.test(m))).toHaveLength(2); // ODA + VISSZA
  });

  test("a csapat összlétszáma sem írja felül a kifejezett nullákat", () => {
    const { tasks } = run(makeState({ sA: 0, sB: 0, sC: 0 }, { passengerCount: 12 }));
    expect(tasks).toHaveLength(0);
  });
});
