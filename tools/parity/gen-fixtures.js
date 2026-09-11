/* Fuvarterv — generate the parity fixtures for the Java port (ADR-29, ACTION_PLAN P3-1).
 *
 * The JavaScript implementation is the SPECIFICATION. This script runs it over generated
 * states and writes what it returned; the Java port is correct when it reproduces these
 * files exactly. Output goes to server/src/test/resources/parity/.
 *
 * Per function, not one blob: when the port breaks, the failing file name says which layer.
 *
 * Run: npm run parity:fixtures
 */

import { writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { parseISO } from "../../src/domain/datetime.js";
import { legMin, matrixKey, allPoints } from "../../src/domain/geo.js";
import { weekOccurrences, legFor, baseOf, venueNeedsVignette } from "../../src/domain/logic.js";
import {
  bestStationOrder, splitStationsByCapacity, driverAvailableFor, mergeShifts, driverPay,
  spanOf, onSiteWait, legPax, genDayTasks, resolveDay, dayStats, optimizeDay,
  ridesFromChains, legRouteOrder, planOda, planVissza,
} from "../../src/domain/optimizer.js";
import { genState, mulberry32 } from "./genState.js";

const OUT = new URL("../../server/src/test/resources/parity/", import.meta.url);
const WEEKDAY = 2;                  // Wednesday, Monday-first
const WEEK_MON_ISO = "2026-08-03";
const weekMon = parseISO(WEEK_MON_ISO);

/* uid() is Math.random(), so a skeleton chain's id and a generated ride's id are not
   reproducible. Null them on both sides rather than pattern-matching ids, which would
   also catch the real, stable ones. ADR-29 records this. */
const nullChainIds = (chains) => (chains || []).map((c) => ({ ...c, id: null }));
const nullRideIds = (rides) => (rides || []).map((r) => ({
  ...r, id: null, stops: (r.stops || []).map((s) => ({ ...s, id: null })),
}));

/* The scenario matrix. Each row is one family of state the port has to get right; the
   names end up as the fixture file names, so a failure reads as a sentence. */
const SCENARIOS = [
  ["plain",            {}],
  ["no-bases",         { withBases: false }],
  ["vignette",         { withVignette: true }],
  ["matrix",           { withMatrix: true }],
  ["preferred",        { withPreferred: true }],
  ["own-stops",        { withOwnStops: true }],
  ["once-training",    { withOnceTraining: true }],
  ["empty-counts",     { withEmptyCounts: true }],
  ["no-counts",        { noCounts: true }],
  ["locked",           { withLocked: true }],
  ["multi-locked",     { multiLocked: true }],
  ["multi-locked-vig", { multiLocked: true, withVignette: true, withPreferred: true }],
  ["many-stations",    { manyStations: true }],
  ["everything",       { withVignette: true, withMatrix: true, withPreferred: true,
                         withOwnStops: true, withEmptyCounts: true, withLocked: true }],
];

const REPS = 4;   // states per scenario

function expectationsFor(state) {
  const pts = allPoints(state);
  const ids = pts.map((p) => p.id);

  /* legMin over every ordered pair, plus the guard cases: same id, unknown id, null.
     legMin is the bottom of the graph — if it is off by a minute, everything above it is
     off and the reason is invisible. */
  const legMinPairs = {};
  for (const a of ids) for (const b of ids) legMinPairs[`${a}|${b}`] = legMin(state, a, b);
  for (const a of ids.slice(0, 2)) {
    legMinPairs[`${a}|__missing__`] = legMin(state, a, "__missing__");
    legMinPairs[`__missing__|${a}`] = legMin(state, "__missing__", a);
  }

  /* bestStationOrder in each of its four shapes: bare, venue as suffix (outbound),
     venue as prefix (return), and with a pinned first or last stop. */
  const bso = [];
  for (const team of state.teams) {
    const leg = legFor(team, null, "oda");
    const sids = (leg.stationIds || []).filter((id) => state.stations.some((s) => s.id === id));
    if (!sids.length) continue;
    const venueId = (team.venueIds || [])[0] || null;
    const variants = [
      { label: "bare", opts: {} },
      { label: "post-venue", opts: { post: venueId } },
      { label: "pre-venue", opts: { pre: venueId } },
      { label: "fixed-first", opts: { post: venueId, fixedFirst: sids[0] } },
      { label: "fixed-last", opts: { pre: venueId, fixedLast: sids[sids.length - 1] } },
      { label: "fixed-first-absent", opts: { post: venueId, fixedFirst: "__missing__" } },
    ];
    for (const v of variants)
      bso.push({ teamId: team.id, label: v.label, ids: sids, opts: v.opts,
        out: bestStationOrder(state, sids, v.opts) });
  }

  /* legRouteOrder and the two timetable planners, so a difference in ORDER is told apart
     from a difference in the times computed over that order. */
  const routeOrders = [], plans = [];
  for (const t of state.trainings) {
    const team = state.teams.find((x) => x.id === t.teamId);
    if (!team) continue;
    for (const dir of ["oda", "vissza"]) {
      const order = legRouteOrder(state, team, t, t.venueId, dir, null);
      routeOrders.push({ trainingId: t.id, dir, out: order });
      if (!order.length) continue;
      plans.push({ trainingId: t.id, dir, order,
        out: dir === "oda"
          ? planOda(state, order, t.venueId, 900, state.settings.dwellMin)
          : planVissza(state, order, t.venueId, 1100, state.settings.dwellMin) });
    }
  }

  /* splitStationsByCapacity, including its two null cases: no per-stop counts at all,
     and one stop that alone exceeds a bus. */
  const splits = [];
  for (const team of state.teams) {
    const leg = legFor(team, null, "oda");
    const sc = leg.stationCounts || {};
    const cnt = (sid) => Number(sc[sid]) || 0;
    const sids = leg.stationIds || [];
    for (const cap of [3, 8, 100]) {
      const counts = {};
      for (const sid of sids) counts[sid] = cnt(sid);
      splits.push({ teamId: team.id, ids: sids, counts, cap,
        out: splitStationsByCapacity(sids, cnt, cap) });
    }
  }

  /* driverAvailableFor over windows that straddle the merge boundary. */
  const avail = [];
  for (const d of state.drivers)
    for (const [s, e] of [[900, 1000], [840, 1320], [1020, 1080], [0, 1439], [1000, 1000]])
      avail.push({ driverId: d.id, startMin: s, endMin: e,
        out: driverAvailableFor(d, WEEKDAY, s, e) });

  /* legPax at both levels, and per direction: the maximum rule (I3) is the one that keeps
     children from being left behind. */
  const pax = [];
  for (const team of state.teams) {
    for (const dir of ["oda", "vissza"]) {
      pax.push({ teamId: team.id, trainingId: null, dir, out: legPax(team, null, dir) });
      for (const t of state.trainings.filter((x) => x.teamId === team.id))
        pax.push({ teamId: team.id, trainingId: t.id, dir, out: legPax(team, t, dir) });
    }
  }

  /* mergeShifts and driverPay on synthetic spans: touching, overlapping, disjoint, and
     nested, which is where the per-shift call-out fee (I7) is decided. */
  const spanSets = [
    [{ start: 900, end: 1000 }],
    [{ start: 900, end: 1000 }, { start: 1000, end: 1100 }],
    [{ start: 900, end: 1000 }, { start: 1001, end: 1100 }],
    [{ start: 900, end: 1200 }, { start: 950, end: 1000 }],
    [{ start: 1100, end: 1200 }, { start: 900, end: 1000 }],
  ];
  const shifts = spanSets.map((s, i) => ({ idx: i, in: s, out: mergeShifts(s) }));

  const tasksNow = genDayTasks(state, WEEKDAY, weekMon).tasks;
  const synthUses = [];
  if (tasksNow.length) {
    const v = state.vehicles[0];
    for (const d of state.drivers) {
      const uses = tasksNow.slice(0, 3).map((t) => ({
        driverId: d.id, vehicleId: v ? v.id : null,
        start: t.start, end: t.end, from: t.from, to: t.to,
      }));
      synthUses.push({ driverId: d.id, uses,
        pay: driverPay(state, d, uses),
        onSiteWait: onSiteWait(state, uses),
        spans: uses.map((u) => spanOf(state, u)) });
    }
  }

  const gdt = genDayTasks(state, WEEKDAY, weekMon);
  const rd = resolveDay(state, WEEKDAY, weekMon);
  const od = optimizeDay(state, WEEKDAY, weekMon);

  return {
    matrixKey: matrixKey(state),
    allPointIds: ids,
    baseOf: Object.fromEntries(state.vehicles.map((v) => [v.id, baseOf(state, v.id)])),
    venueNeedsVignette: Object.fromEntries(state.venues.map((v) => [v.id, venueNeedsVignette(state, v.id)])),
    legMin: legMinPairs,
    weekOccurrences: weekOccurrences(state, weekMon)
      .map((o) => ({ trainingId: o.training.id, dayIdx: o.dayIdx, dateISO: o.dateISO })),
    bestStationOrder: bso,
    legRouteOrder: routeOrders,
    plans,
    splitStationsByCapacity: splits,
    driverAvailableFor: avail,
    legPax: pax,
    mergeShifts: shifts,
    driverPay: synthUses,
    genDayTasks: gdt,
    resolveDay: { ...rd, chains: nullChainIds(rd.chains) },
    dayStats: dayStats(state, rd.chains),
    optimizeDay: od.empty ? od : { ...od, chains: nullChainIds(od.chains) },
    ridesFromChains: nullRideIds(ridesFromChains(state, WEEKDAY, rd.chains)),
  };
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(new URL(f, OUT));

let n = 0, withTasks = 0;
for (const [name, scenario] of SCENARIOS) {
  /* One PRNG per scenario, seeded from the scenario's position, so adding a scenario
     cannot shift the states of the ones before it. Regenerating is then a no-op diff. */
  const rng = mulberry32(0x5eed + SCENARIOS.findIndex(([s]) => s === name) * 101);
  for (let r = 0; r < REPS; r++) {
    const state = genState(rng, WEEKDAY, scenario);
    const expect = expectationsFor(state);
    if (expect.genDayTasks.tasks.length) withTasks++;
    const fixture = {
      name: `${String(n).padStart(2, "0")}-${name}-${r}`,
      weekday: WEEKDAY,
      weekMonISO: WEEK_MON_ISO,
      state,
      expect,
    };
    writeFileSync(new URL(`${fixture.name}.json`, OUT), JSON.stringify(fixture, null, 1) + "\n");
    n++;
  }
}
console.log(`wrote ${n} fixtures to server/src/test/resources/parity/ (${withTasks} with tasks)`);
