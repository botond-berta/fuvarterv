import { describe, test, expect } from "vitest";
import { ensureShape } from "../src/data/seed.js";
import { mondayOf, minToTime } from "../src/domain/datetime.js";
import { teamLeg, deleteGuard } from "../src/domain/logic.js";
import { teamPax, teamRouteOrder, genDayTasks } from "../src/domain/optimizer.js";

/*
 * The return leg may have a stop list of its own, independent of the outbound.
 * The governing rule is that absence means "mirror the outbound" — every team
 * that existed before this feature must keep behaving exactly as it did.
 */

const WEEKDAY = 2;
const WEEK_MON = mondayOf(new Date(2025, 0, 6));

const stations = [
  { id: "sA", name: "A", lat: 46.10, lon: 19.80 },
  { id: "sB", name: "B", lat: 46.20, lon: 19.85 },
  { id: "sC", name: "C", lat: 46.30, lon: 19.90 },
  { id: "sD", name: "D", lat: 46.40, lon: 19.95 },
];
const venues = [{ id: "v0", name: "V", lat: 46.25, lon: 19.88 }];
const settings = { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500,
  dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12, preferredBias: 0 };

function makeState(team, vehicles = [{ id: "veh1", name: "v", plate: "AB-1", seats: 20 }]) {
  return {
    stations, venues, vehicles, drivers: [], rides: [], assignments: {}, matrix: null, settings,
    teams: [team],
    trainings: [{ id: "tr", teamId: team.id, venueId: "v0", type: "weekly",
      days: [WEEKDAY], date: null, start: "16:00", end: "17:30" }],
  };
}
const baseTeam = (extra = {}) => ({
  id: "tm", name: "TM", age: "U12", gender: "vegyes", color: "#000",
  stationIds: ["sA", "sB"], venueIds: ["v0"], passengerCount: null,
  stationCounts: { sA: 2, sB: 3 }, routeMode: "auto", routeAnchorId: null,
  returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, ...extra,
});
const stopsOf = (task) => task.plan.map((p) => p.stationId);

describe("teamLeg decides where each direction's stops come from", () => {
  test("without an override both directions use the outbound fields", () => {
    const t = baseTeam();
    expect(teamLeg(t, "oda").stationIds).toEqual(["sA", "sB"]);
    expect(teamLeg(t, "vissza").stationIds).toEqual(["sA", "sB"]);
    expect(teamLeg(t, "vissza").isOverride).toBe(false);
  });

  test("an override gives the return its own stops and counts", () => {
    const t = baseTeam({ returnStationIds: ["sC"], returnStationCounts: { sC: 5 } });
    expect(teamLeg(t, "oda").stationIds).toEqual(["sA", "sB"]);
    expect(teamLeg(t, "vissza").stationIds).toEqual(["sC"]);
    expect(teamLeg(t, "vissza").stationCounts).toEqual({ sC: 5 });
    expect(teamLeg(t, "vissza").isOverride).toBe(true);
  });

  test("an empty array is an override, not a fallback", () => {
    // [] means "deliberately no return stops", which must not silently mirror.
    expect(teamLeg(baseTeam({ returnStationIds: [] }), "vissza").stationIds).toEqual([]);
  });
});

describe("teamPax is direction aware but unchanged by default", () => {
  test("without a dir argument the result is the outbound total", () => {
    expect(teamPax(baseTeam())).toBe(5);
  });

  test("the return sums its own counts", () => {
    const t = baseTeam({ returnStationIds: ["sC", "sD"], returnStationCounts: { sC: 4, sD: 4 } });
    expect(teamPax(t, "oda")).toBe(5);
    expect(teamPax(t, "vissza")).toBe(8);
  });

  test("the stated total still acts as a floor on the return", () => {
    const t = baseTeam({ passengerCount: 12, returnStationIds: ["sC"], returnStationCounts: { sC: 3 } });
    expect(teamPax(t, "vissza")).toBe(12);
  });
});

describe("teamRouteOrder in manual mode", () => {
  test("a mirrored return is reversed, as before", () => {
    const t = baseTeam({ routeMode: "manual" });
    expect(teamRouteOrder(makeState(t), t, "v0", "oda")).toEqual(["sA", "sB"]);
    expect(teamRouteOrder(makeState(t), t, "v0", "vissza")).toEqual(["sB", "sA"]);
  });

  test("an authored return list keeps its own order", () => {
    // Reversing a hand-built return list would undo what the user just arranged.
    const t = baseTeam({ routeMode: "manual", returnStationIds: ["sC", "sD"] });
    expect(teamRouteOrder(makeState(t), t, "v0", "vissza")).toEqual(["sC", "sD"]);
  });
});

describe("genDayTasks builds each direction from its own list", () => {
  test("the return visits the return stops and the outbound is untouched", () => {
    const t = baseTeam({ returnStationIds: ["sC", "sD"], returnStationCounts: { sC: 2, sD: 2 } });
    const { tasks } = genDayTasks(makeState(t), WEEKDAY, WEEK_MON);
    const oda = tasks.find((x) => x.dir === "oda");
    const vissza = tasks.find((x) => x.dir === "vissza");

    expect(stopsOf(oda).sort()).toEqual(["sA", "sB"]);
    expect(stopsOf(vissza).sort()).toEqual(["sC", "sD"]);
    expect(oda.pax).toBe(5);
    expect(vissza.pax).toBe(4);
  });

  test("outbound task ids are unchanged, so saved schedules keep resolving", () => {
    const t = baseTeam({ returnStationIds: ["sC"], returnStationCounts: { sC: 1 } });
    const { tasks } = genDayTasks(makeState(t), WEEKDAY, WEEK_MON);
    expect(tasks.map((x) => x.id)).toContain(`tr:${WEEKDAY}:oda`);
  });

  test("with no override both directions still share the stop list", () => {
    const { tasks } = genDayTasks(makeState(baseTeam()), WEEKDAY, WEEK_MON);
    const oda = tasks.find((x) => x.dir === "oda");
    const vissza = tasks.find((x) => x.dir === "vissza");
    expect(stopsOf(oda).sort()).toEqual(stopsOf(vissza).sort());
  });

  test("the directions split across buses independently", () => {
    // Outbound 5 people fits one 6-seater; the return's 12 need two.
    const t = baseTeam({
      returnStationIds: ["sC", "sD"], returnStationCounts: { sC: 6, sD: 6 },
    });
    const state = makeState(t, [{ id: "veh1", name: "v", plate: "AB-1", seats: 6 }]);
    const { tasks } = genDayTasks(state, WEEKDAY, WEEK_MON);
    const oda = tasks.filter((x) => x.dir === "oda");
    const vissza = tasks.filter((x) => x.dir === "vissza");

    expect(oda).toHaveLength(1);
    expect(vissza).toHaveLength(2);
    expect(vissza.every((x) => x.pax <= 6)).toBe(true);
    expect(vissza.reduce((a, x) => a + x.pax, 0)).toBe(12);
  });

  test("a team with return stops but none outbound still gets a return task", () => {
    const t = baseTeam({ stationIds: [], stationCounts: {}, returnStationIds: ["sC"], returnStationCounts: { sC: 3 } });
    const { tasks, skipped } = genDayTasks(makeState(t), WEEKDAY, WEEK_MON);
    expect(tasks.map((x) => x.dir)).toEqual(["vissza"]);
    // The skipped note must name the direction, or an outbound gap reads as a return one.
    expect(skipped.join(" ")).toMatch(/ODA/);
  });
});

describe("supporting changes", () => {
  test("a station used only on the return cannot be deleted", () => {
    const t = baseTeam({ returnStationIds: ["sC"] });
    const state = makeState(t);
    expect(deleteGuard(state, "stations", "sC")).toBeTruthy();
    expect(deleteGuard(state, "stations", "sD")).toBeNull();
  });

  test("ensureShape defaults the new fields on a legacy blob", () => {
    const s = ensureShape({ teams: [{ id: "t" }] });
    expect(s.teams[0].returnStationIds).toBeNull();
    expect(s.teams[0].returnStationCounts).toEqual({});
    expect(s.teams[0].returnRouteAnchorId).toBeNull();
  });
});

describe("the return timetable stays anchored to the venue departure", () => {
  test("return stops are served after the training ends, not before it starts", () => {
    const t = baseTeam({ returnStationIds: ["sC", "sD"], returnStationCounts: { sC: 2, sD: 2 } });
    const { tasks } = genDayTasks(makeState(t), WEEKDAY, WEEK_MON);
    const vissza = tasks.find((x) => x.dir === "vissza");
    const departAt = 17 * 60 + 30 + settings.departAfterMin;
    expect(vissza.start).toBe(departAt);
    expect(vissza.plan.every((p) => p.arr > departAt)).toBe(true);
    expect(minToTime(vissza.start)).toBe("17:40");
  });
});
