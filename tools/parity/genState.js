/* Fuvarterv — the state generator for the parity fixtures (ADR-29, ACTION_PLAN P3-1).
 *
 * This is TEST DATA generation, not a domain rule, so it is deliberately a separate
 * generator from the one in test/optimizer.test.js rather than a shared one. That test
 * checks invariants and wants states it can reason about; the parity fixtures want the
 * opposite — every awkward corner of the data model at once, because a corner nobody
 * generates is a corner the Java port can get wrong unnoticed.
 *
 * What it deliberately produces that the property test never does:
 *   - depots (bases) and settings.defaultBaseId, so spanOf's depot-to-depot path runs
 *   - vignette venues and vignette-carrying vehicles (ADR-15's one hard constraint)
 *   - preferredVehicleId with a non-zero preferredBias (the one SOFT constraint)
 *   - a precomputed matrix, so legMin's lookup path runs as well as the haversine one
 *   - trainings with their own `stops` override, and one-off (`once`) trainings
 *   - EMPTY-STRING headcounts next to explicit zeros (ADR-23 — the expensive one)
 *   - manual routeMode with a routeAnchorId
 *   - more than ten stations, to hit bestStationOrder's bail-out (ADR-13)
 *   - saved assignments with locked tasks, so optimizeDay builds skeleton chains
 *   - drivers with several availability windows, including touching ones
 */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = (n) => String(n).padStart(2, "0");
const minToTime = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

/* `scenario` switches whole families of state on, so the fixture set covers the paths
   rather than only the average case. */
export function genState(rng, weekday, scenario = {}) {
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const chance = (p) => rng() < p;

  const {
    manyStations = false,   // > 10 stops on a leg: Held-Karp bails out
    withBases = true,
    withVignette = false,
    withMatrix = false,
    withPreferred = false,
    withOwnStops = false,
    withOnceTraining = false,
    withEmptyCounts = false,
    withLocked = false,
    multiLocked = false,    // SEVERAL locked chains, ids deliberately out of sort order
    noCounts = false,       // no per-stop breakdown at all, only passengerCount
  } = scenario;

  const nS = manyStations ? ri(11, 13) : ri(2, 6);
  const stations = Array.from({ length: nS }, (_, i) => ({
    id: `s${i}`, name: `s${i}`, lat: 46 + rng(), lon: 19 + rng(),
  }));
  const venues = Array.from({ length: ri(1, 2) }, (_, i) => ({
    id: `v${i}`, name: `v${i}`, lat: 46 + rng(), lon: 19 + rng(),
    ...(withVignette ? { needsVignette: chance(0.5) } : {}),
  }));
  const bases = withBases
    ? Array.from({ length: ri(1, 2) }, (_, i) => ({ id: `b${i}`, name: `b${i}`, lat: 46 + rng(), lon: 19 + rng() }))
    : [];

  const vehicles = Array.from({ length: ri(1, 4) }, (_, i) => ({
    id: `veh${i}`, name: `veh${i}`, plate: `AB-${i}`, seats: ri(6, 9), note: "",
    ...(withVignette ? { hasVignette: chance(0.5) } : {}),
    ...(withBases && chance(0.6) ? { baseId: pick(bases).id } : {}),
  }));

  const drivers = Array.from({ length: ri(1, 4) }, (_, i) => {
    /* Three shapes: no windows at all (always available), one window that may not
       cover the day, and two TOUCHING windows that must merge into one. */
    const mode = ri(0, 2);
    let availability = [];
    if (mode === 1) availability = [{ days: [weekday], start: "15:00", end: `${ri(18, 21)}:00` }];
    if (mode === 2) availability = [
      { days: [weekday], start: "14:00", end: "17:00" },
      { days: [weekday], start: "17:00", end: "22:00" },
    ];
    return {
      id: `d${i}`, name: `d${i}`, phone: "", note: "",
      wage: ri(20, 40) * 100, minShiftMin: ri(1, 3) * 60, availability,
      preferredVehicleId: withPreferred && chance(0.6) ? pick(vehicles).id : null,
    };
  });

  const teams = [], trainings = [];
  for (let i = 0; i < ri(1, 4); i++) {
    const k = ri(1, nS);
    const subset = [...stations].sort(() => rng() - 0.5).slice(0, k).map((s) => s.id);
    const stationCounts = {};
    if (!noCounts) {
      for (const sid of subset) {
        if (withEmptyCounts && chance(0.25)) stationCounts[sid] = "";      // not entered yet
        else if (withEmptyCounts && chance(0.2)) stationCounts[sid] = 0;   // explicitly nobody
        else stationCounts[sid] = ri(1, 4);
      }
    }
    const venueId = pick(venues).id;

    let returnStationIds = null, returnStationCounts = {};
    if (chance(0.35)) {
      const rk = ri(1, nS);
      returnStationIds = [...stations].sort(() => rng() - 0.5).slice(0, rk).map((s) => s.id);
      for (const sid of returnStationIds) returnStationCounts[sid] = ri(1, 4);
    }

    const manual = chance(0.25);
    teams.push({
      id: `tm${i}`, name: `tm${i}`, age: "U12", gender: "vegyes", color: "#000",
      stationIds: subset, venueIds: [venueId],
      passengerCount: noCounts ? ri(4, 14) : (chance(0.3) ? ri(4, 14) : null),
      stationCounts,
      routeMode: manual ? "manual" : "auto",
      routeAnchorId: !manual && chance(0.4) ? pick(subset) : null,
      returnStationIds, returnStationCounts, returnRouteAnchorId: null,
    });

    const startMin = ri(15, 18) * 60;
    const endMin = startMin + pick([60, 90, 120]);
    const once = withOnceTraining && chance(0.4);
    const tr = {
      id: `tr${i}`, teamId: `tm${i}`, venueId,
      type: once ? "once" : "weekly",
      days: once ? [] : [weekday],
      date: null,
      start: minToTime(startMin), end: minToTime(endMin),
    };
    if (once) {
      /* A one-off lands on the same weekday of the fixture week, so it still produces
         tasks for the day under test. 2026-08-05 is the Wednesday of that week. */
      const mon = new Date(2026, 7, 3);
      const d = new Date(mon); d.setDate(d.getDate() + weekday);
      tr.date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
    /* A training's own stop list is a COMPLETE override (I2), so it carries the same
       field names one level down. */
    if (withOwnStops && chance(0.4)) {
      const ok = ri(1, nS);
      const own = [...stations].sort(() => rng() - 0.5).slice(0, ok).map((s) => s.id);
      const ownCounts = {};
      for (const sid of own) ownCounts[sid] = ri(1, 3);
      tr.stops = {
        stationIds: own, stationCounts: ownCounts, routeMode: "auto", routeAnchorId: null,
        passengerCount: chance(0.5) ? ri(3, 10) : null,
        returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null,
      };
    }
    trainings.push(tr);
  }

  let matrix = null;
  if (withMatrix) {
    /* A real matrix is asymmetric and does not agree with the haversine estimate, which
       is the point: it proves legMin prefers the lookup. Some pairs are left out so the
       fallback runs in the same fixture. */
    const pts = [...stations, ...venues, ...bases];
    const durations = {};
    for (const a of pts) for (const b of pts) {
      if (a.id === b.id || chance(0.15)) continue;
      durations[`${a.id}|${b.id}`] = ri(3, 40);
    }
    matrix = { key: "fixture", source: "osrm", durations, computedAt: "2026-08-01T00:00:00.000Z", n: pts.length };
  }

  const settings = {
    arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500, dwellMin: 2,
    estSpeedKmh: 50, fallbackLegMin: 12,
    preferredBias: withPreferred ? 1000 : 0,
    defaultBaseId: withBases && bases.length ? bases[0].id : null,
  };

  const state = {
    teams, stations, venues, bases, vehicles, drivers, trainings,
    rides: [], assignments: {}, matrix, settings,
  };

  /* A saved schedule with a locked task, so optimizeDay has a skeleton chain to respect
     and resolveDay has something to resolve (and possibly to drop — R1). */
  if ((withLocked || multiLocked) && trainings.length) {
    /* The ids are deliberately NOT in sorted order. optimizeDay groups locked tasks into a
       Map keyed by chain id and then iterates it, so a port that reaches for a plain HashMap
       would visit them in a different order — and the order reaches the output through the
       skeleton list, the improvement loop's first accepted merge, and the stable sort's ties.
       Inserting z, m, a is what makes that difference observable instead of theoretical. */
    const ids = ["ch-z", "ch-m", "ch-a", "ch-q"];
    const howMany = multiLocked ? Math.min(trainings.length, 3) : 1;
    const chains = [];
    for (let i = 0; i < howMany; i++) {
      const t = trainings[i];
      const suffix = t.type === "weekly" ? weekday : "x";
      chains.push({
        id: ids[i],
        driverId: drivers[i % drivers.length].id,
        vehicleId: vehicles[i % vehicles.length].id,
        taskIds: [{ id: `${t.id}:${suffix}:oda`, locked: true }],
      });
    }
    state.assignments = { [weekday]: { chains } };
  }

  return state;
}
