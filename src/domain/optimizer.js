/* Fuvarterv — tasks, routing, chaining, resource assignment.

   The scheduling core. Three phases, in order:
     1. genDayTasks   turn the day's trainings into outbound/return tasks
     2. minCostChains link tasks into chains one bus can actually run
     3. assignResources pick the cheapest (driver, vehicle) for each chain

   Pure domain: no window, no network, and no Math.random on any decision path.
   The optimizer must be deterministic, or the same day would produce a different
   schedule on every click. */

import { DAYS, byId, uid } from "./constants.js";
import { timeToMin, minToTime } from "./datetime.js";
import { legMin, locName } from "./geo.js";
import { weekOccurrences, legFor, legSource, taskNeedsVignette, chainNeedsVignette, vignetteVenues, baseOf } from "./logic.js";

/* Held-Karp: the shortest order that visits every station.
   pre/post pin a point before/after the chain (typically the venue);
   fixedFirst/fixedLast force a first/last station. Exact up to n = 10; above that
   the original order is kept, because the table is 2^n by n. */
export function bestStationOrder(state, ids, { pre = null, post = null, fixedFirst = null, fixedLast = null } = {}) {
  const n = ids.length;
  if (n <= 1 || n > 10) return ids.slice();
  const d = (a, b) => legMin(state, a, b);
  const FULL = (1 << n) - 1;
  const dp = Array.from({ length: 1 << n }, () => Array(n).fill(Infinity));
  const par = Array.from({ length: 1 << n }, () => Array(n).fill(-1));
  for (let i = 0; i < n; i++) {
    if (fixedFirst != null && ids[i] !== fixedFirst) continue;
    dp[1 << i][i] = pre ? d(pre, ids[i]) : 0;
  }
  for (let m = 1; m <= FULL; m++)
    for (let i = 0; i < n; i++) {
      const cur = dp[m][i];
      if (!isFinite(cur)) continue;
      for (let j = 0; j < n; j++) {
        if (m & (1 << j)) continue;
        const nm = m | (1 << j), nc = cur + d(ids[i], ids[j]);
        if (nc < dp[nm][j]) { dp[nm][j] = nc; par[nm][j] = i; }
      }
    }
  let best = Infinity, bi = -1;
  for (let i = 0; i < n; i++) {
    if (fixedLast != null && ids[i] !== fixedLast) continue;
    const c = dp[FULL][i] + (post ? d(ids[i], post) : 0);
    if (c < best) { best = c; bi = i; }
  }
  if (bi < 0) return ids.slice();
  const order = [];
  let m = FULL, i = bi;
  while (i !== -1) { order.push(ids[i]); const pi = par[m][i]; m &= ~(1 << i); i = pi; }
  return order.reverse();
}

/* Outbound timetable, computed BACKWARDS from the arrival time at the venue.
   arr = when the bus must be at the stop; dep = arr + dwell. */
export function planOda(state, order, venueId, arriveBy, dwell) {
  let t = arriveBy;
  const stops = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const next = i === order.length - 1 ? venueId : order[i + 1];
    const dep = t - legMin(state, order[i], next);
    const arr = dep - dwell;
    stops.unshift({ stationId: order[i], arr, dep });
    t = arr;
  }
  return { stops, venueArr: arriveBy, start: stops.length ? stops[0].arr : arriveBy, end: arriveBy };
}

/* Return timetable, computed forwards from the departure at the venue. */
export function planVissza(state, order, venueId, departAt, dwell) {
  let t = departAt, prev = venueId;
  const stops = [];
  for (const sid of order) {
    const arr = t + legMin(state, prev, sid);
    const dep = arr + dwell;
    stops.push({ stationId: sid, arr, dep });
    t = dep; prev = sid;
  }
  return { stops, venueDep: departAt, start: departAt, end: stops.length ? stops[stops.length - 1].arr : departAt };
}

/* The route order for one stop list: automatic (with an optional pinned first
   stop) or manual (the order the chips were switched on; reversed for the return
   leg). The list is the training's own if it has one, else the team's. A subset of
   stops may be passed in when a task was split across buses; the pinned stop only
   applies if it is inside that subset. */
export function legRouteOrder(state, team, training, venueId, dir, stationIds) {
  const leg = legFor(team, training, dir);
  const ids = (stationIds || leg.stationIds || []).filter((id) => byId(state.stations, id));
  if (ids.length <= 1 || leg.routeMode === "manual") {
    /* In manual mode the stored order IS the intended order. Reversing is only
       correct when the return leg mirrors the outbound list; when it has its own,
       the user already built it in homeward order. */
    if (dir === "oda" || leg.isOverride) return ids;
    return [...ids].reverse();
  }
  const anchor = leg.routeAnchorId && ids.includes(leg.routeAnchorId) ? leg.routeAnchorId : null;
  if (dir === "oda") return bestStationOrder(state, ids, { post: venueId, fixedFirst: anchor });
  return bestStationOrder(state, ids, { pre: venueId, fixedLast: anchor });
}

/* The team-level call, the shape this had before per-training lists existed. */
export const teamRouteOrder = (state, team, venueId, dir, stationIds) =>
  legRouteOrder(state, team, null, venueId, dir, stationIds);

/* Pack stops into as few buses as possible (first-fit-decreasing): each bus
   carries at most `cap`, and a stop's whole headcount goes on ONE bus.

   Returns null when there are no per-stop headcounts, or when a single stop alone
   exceeds one bus — neither can be split this way. Within each returned bus the
   stops keep the team's original order. */
export function splitStationsByCapacity(stationIds, cnt, cap) {
  const withCount = stationIds.map((id, i) => ({ id, i, c: cnt(id) })).filter((x) => x.c > 0);
  if (!withCount.length || withCount.some((x) => x.c > cap)) return null;
  const bins = [];
  for (const s of [...withCount].sort((a, b) => b.c - a.c)) {
    let b = bins.find((x) => x.load + s.c <= cap);
    if (!b) { b = { items: [], load: 0 }; bins.push(b); }
    b.items.push(s); b.load += s.c;
  }
  return bins.map((b) => b.items.sort((a, z) => a.i - z.i).map((x) => x.id));
}

/* A day's tasks: an outbound and a return task per training occurrence. When a
   team is larger than the biggest vehicle, the task is split across buses by stop,
   each one an independent parallel ride to the same venue. */
export function genDayTasks(state, weekday, weekMon) {
  const occs = weekOccurrences(state, weekMon).filter((o) => o.dayIdx === weekday);
  const tasks = [], skipped = [];
  const N = state.settings.arriveEarlyMin ?? 10, M = state.settings.departAfterMin ?? 10;
  const dwell = state.settings.dwellMin ?? 2;
  const maxSeats = Math.max(0, ...state.vehicles.map((v) => Number(v.seats) || 0));
  /* A team can have several trainings on one day, at different venues and with
     different stop lists. The bare team name would then produce two
     indistinguishable tasks in the schedule and in the warnings. The venue is
     appended only in that case, so labels stay short on ordinary days. */
  const perTeam = occs.reduce((m, x) => ({ ...m, [x.training.teamId]: (m[x.training.teamId] || 0) + 1 }), {});
  for (const o of occs) {
    const t = o.training, team = byId(state.teams, t.teamId);
    if (!team) continue;
    const suffix = t.type === "weekly" ? weekday : "x";
    const teamLabel = perTeam[t.teamId] > 1 ? `${team.name} · ${locName(state, t.venueId)}` : team.name;

    /* One pass per direction. The return leg may have its own stops and its own
       headcounts, so the stop set, the counts, the passenger total AND the split
       across buses all have to be computed per direction.

       The two directions may therefore split into different numbers of buses.
       Nothing forbids that: from here on the tasks are independent, chaining works
       on time and deadhead, and no rule anywhere pairs #1 with #1. */
    for (const dir of ["oda", "vissza"]) {
      const leg = legFor(team, t, dir);
      const dirLabel = dir === "oda" ? "ODA" : "VISSZA";
      const who = leg.isOverride ? `${teamLabel} · ${dirLabel}` : teamLabel;

      const listed = (leg.stationIds || []).filter((id) => byId(state.stations, id));
      if (!listed.length) {
        skipped.push(`${who}: nincs állomás rendelve, ezért nem készült ${dirLabel} feladat.`);
        continue;
      }
      const sc = leg.stationCounts || {};
      const cnt = (sid) => Number(sc[sid]) || 0;

      /* An explicit 0 means "no need to go here", and the stop drops out of the
         route. An EMPTY field is NOT the same thing: it means "not filled in yet".

         With a half-filled breakdown (the coach has entered counts for only two
         stops so far), skipping the rest would mean leaving children behind — which
         is also why legPax keeps falling back to the team total.

         The data can tell them apart: the editor stores a cleared field as "" and a
         typed zero as a number. */
      const zeroed = (sid) => sc[sid] != null && sc[sid] !== "" && Number(sc[sid]) === 0;
      const st = listed.filter((sid) => !zeroed(sid));
      if (!st.length) {
        skipped.push(`${who}: minden megállónál 0 fő szerepel, ezért nem készült ${dirLabel} feladat.`);
        continue;
      }
      /* Zero passengers means there is nobody to carry. This used to produce a
         task anyway (with a warning), so the optimizer assigned a driver and a bus
         to an empty ride, call-out fee and paid hours included.

         pax is the MAXIMUM of the per-stop breakdown and the team total, so 0 means
         there is no headcount anywhere. The right response is not to schedule a
         ride but to say the data is missing. */
      const pax = legPax(team, t, dir);
      if (!pax) {
        skipped.push(`${who}: nincs megadva létszám (se megállónként, se összesen), ezért nem készült ${dirLabel} feladat. Add meg a létszámot a csapatnál vagy az edzésnél.`);
        continue;
      }

      /* One direction's task over a subset of stops. idx = null means the whole
         team on one bus; idx >= 1 is part idx of a task split across `count` buses. */
      const mkTask = (subset, idx, count) => {
        const order = legRouteOrder(state, team, t, t.venueId, dir, subset);
        const split = idx != null;
        const tag = split ? `#${idx}` : "";
        const name = `${teamLabel} · ${dirLabel}${split ? ` (${idx}/${count})` : ""}`;
        const base = {
          id: `${t.id}:${suffix}:${dir}${tag}`, dir, teamId: team.id, trainingId: t.id,
          pax: split ? order.reduce((a, sid) => a + cnt(sid), 0) : pax, label: name,
          breakdown: order.map((sid) => ({ stationId: sid, count: cnt(sid) })).filter((x) => x.count > 0),
        };
        if (dir === "oda") {
          const op = planOda(state, order, t.venueId, timeToMin(t.start) - N, dwell);
          return { ...base, from: order[0], to: t.venueId, start: op.start, end: op.end,
            plan: op.stops.map((x) => ({ ...x, count: cnt(x.stationId) })), venueTime: op.venueArr };
        }
        const vp = planVissza(state, order, t.venueId, timeToMin(t.end) + M, dwell);
        return { ...base, from: t.venueId, to: order[order.length - 1], start: vp.start, end: vp.end,
          plan: vp.stops.map((x) => ({ ...x, count: cnt(x.stationId) })), venueTime: vp.venueDep };
      };

      const bins = maxSeats > 0 && pax > maxSeats ? splitStationsByCapacity(st, cnt, maxSeats) : null;
      if (bins && bins.length > 1) {
        skipped.push(`${who}: a ${pax} fős létszám meghaladja a legnagyobb jármű férőhelyét (${maxSeats} fő), ezért ${bins.length} buszra bontva, megállónként.`);
        bins.forEach((subset, k) => tasks.push(mkTask(subset, k + 1, bins.length)));
      } else {
        if (maxSeats > 0 && pax > maxSeats) {
          const big = st.filter((sid) => cnt(sid) > maxSeats);
          if (big.length)
            skipped.push(`${who}: megállónként sem osztható — ${big.map((sid) => `${locName(state, sid)} (${cnt(sid)} fő)`).join(", ")} önmagában több, mint a legnagyobb jármű (${maxSeats} fő).`);
          else if (!st.some((sid) => cnt(sid) > 0))
            skipped.push(`${who}: a ${pax} fő meghaladja a legnagyobb jármű férőhelyét (${maxSeats} fő), de nincs megállónkénti létszámbontás, ezért nem osztható buszokra — add meg a megállónkénti létszámokat a felosztáshoz.`);
        }
        tasks.push(mkTask(st, null));
      }
    }
  }
  tasks.sort((a, b) => a.start - b.start || a.end - b.end);
  return { tasks, skipped };
}

/* How many people a team needs carried: the GREATER of the per-stop breakdown's
   sum and the stated team total.

   A partial breakdown used to override the total. On a 12-person team where the
   coach had entered counts for only two stops, that produced 5 — no capacity split
   was triggered, and a 6-seat bus turned up for 12 children, with no warning. */
export function legPax(team, training, dir = "oda") {
  const leg = legFor(team, training, dir);
  const sc = leg.stationCounts;
  const sum = (leg.stationIds || []).reduce((a, id) => a + (Number(sc[id]) || 0), 0);
  /* The total is a fallback: it only counts when the per-stop breakdown is
     smaller. The same rule holds for a return leg with its own list — the same
     children travel, they just get off elsewhere. The fallback comes from whichever
     source supplies the stops: on a training with its own list the team's full
     roster does not apply, since fewer people may attend. */
  return Math.max(sum, Number(legSource(team, training).passengerCount) || 0);
}

/* The team-level call, the shape this had before per-training lists existed. */
export const teamPax = (team, dir = "oda") => legPax(team, null, dir);

/* Is the driver available across the whole [startMin, endMin] span on this
   weekday?

   Touching or overlapping windows MERGE: 15:00-17:00 plus 17:00-19:00 together
   cover a 15:00-19:00 shift. A single window used to have to contain the span on
   its own, so a driver like that dropped out of the day with no explanation.

   Incomplete windows (missing a start or an end) are ignored; they used to make a
   driver silently unavailable for the entire day. */
export function driverAvailableFor(driver, weekday, startMin, endMin) {
  const ws = driver.availability || [];
  if (!ws.length) return true; // nothing specified means available at any time
  const spans = ws
    .filter((w) => (w.days || []).includes(weekday))
    .map((w) => [timeToMin(w.start), timeToMin(w.end)])
    .filter(([a, b]) => a != null && b != null && b > a)
    .sort((x, y) => x[0] - y[0]);
  if (!spans.length) return false;
  let [lo, hi] = spans[0];
  for (const [a, b] of spans.slice(1)) {
    if (a <= hi) { hi = Math.max(hi, b); continue; }   // touching or overlapping, so merge
    if (lo <= startMin && endMin <= hi) return true;
    [lo, hi] = [a, b];
  }
  return lo <= startMin && endMin <= hi;
}

/* Chain view model: ordered tasks plus the links between them (deadhead, idle). */
export function mkChain(state, ts, extra = {}) {
  const tasks = [...ts].sort((a, b) => a.start - b.start);
  const links = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    const A = tasks[i], B = tasks[i + 1];
    const dead = legMin(state, A.to, B.from);
    const gap = B.start - A.end;
    links.push({ a: A, b: B, dead, idle: Math.max(0, gap - dead), infeasible: gap < dead, short: dead - gap });
  }
  return {
    ...extra, tasks, links,
    /* A chain ends at the LATEST finish, not at the finish of whichever task
       starts last. A nested task (15:30-16:00 alongside 15:00-19:00) would otherwise
       shorten the chain to 16:00, breaking availability checks, clash detection and
       the paid-time calculation all at once. */
    start: Math.min(...tasks.map((t) => t.start)),
    end: Math.max(...tasks.map((t) => t.end)),
    maxPax: Math.max(...tasks.map((t) => t.pax)),
  };
}

/* Minimum-cost flow for chaining (bipartite graph, successive shortest paths).
   An edge exists when A.end + deadhead(A.to, B.from) <= B.start; its cost is
   wage x gap minus the call-out fee. Flow is only pushed along paths that reduce
   total cost. */
export function minCostChains(n, edges) {
  const S = 2 * n, T = 2 * n + 1, NN = 2 * n + 2;
  const g = [], head = Array(NN).fill(-1);
  const addEdge = (u, v, cap, cost) => {
    g.push({ v, cap, cost, next: head[u] }); head[u] = g.length - 1;
    g.push({ v: u, cap: 0, cost: -cost, next: head[v] }); head[v] = g.length - 1;
  };
  for (let i = 0; i < n; i++) { addEdge(S, i, 1, 0); addEdge(n + i, T, 1, 0); }
  for (const e of edges) addEdge(e.a, n + e.b, 1, e.cost);
  // Safety bound: at most n augmenting paths can exist (each one links one task).
  // Without it the loop would spin forever on a degenerate residual graph.
  for (let guard = 0; guard <= n; guard++) {
    const dist = Array(NN).fill(Infinity), inq = Array(NN).fill(false), pre = Array(NN).fill(-1);
    dist[S] = 0; const q = [S]; inq[S] = true;
    while (q.length) {
      const u = q.shift(); inq[u] = false;
      for (let ei = head[u]; ei !== -1; ei = g[ei].next) {
        const e = g[ei];
        if (e.cap > 0 && dist[u] + e.cost < dist[e.v] - 1e-9) {
          dist[e.v] = dist[u] + e.cost; pre[e.v] = ei;
          if (!inq[e.v]) { inq[e.v] = true; q.push(e.v); }
        }
      }
    }
    if (!isFinite(dist[T]) || dist[T] >= -1e-9) break;
    let v = T;
    while (v !== S) { const ei = pre[v]; g[ei].cap -= 1; g[ei ^ 1].cap += 1; v = g[ei ^ 1].v; }
  }
  const succ = Array(n).fill(-1), pred = Array(n).fill(-1);
  for (let u = 0; u < n; u++)
    for (let ei = head[u]; ei !== -1; ei = g[ei].next) {
      const e = g[ei];
      if (ei % 2 === 0 && e.v >= n && e.v < 2 * n && e.cap === 0) { succ[u] = e.v - n; pred[e.v - n] = u; }
    }
  /* Read the chains back out. Every task must land in EXACTLY ONE chain. If
     succ/pred closed into a cycle (possible with degenerate, zero- or
     negative-length task windows), the old rule of "only pred === -1 starts a
     chain" made every task in that cycle vanish silently: in no chain and not among
     the uncovered either. The `seen` set guarantees each index appears once. */
  const chains = [];
  const seen = new Array(n).fill(false);
  const walk = (startIdx) => {
    const seq = [];
    let c = startIdx;
    while (c !== -1 && !seen[c]) { seen[c] = true; seq.push(c); c = succ[c]; }
    if (seq.length) chains.push(seq);
  };
  for (let i = 0; i < n; i++) if (pred[i] === -1) walk(i);
  for (let i = 0; i < n; i++) if (!seen[i]) walk(i);   // whatever is left inside a cycle
  return chains;
}

/* A chain's two endpoints: where its first task starts and its last one ends.
   (The occupancy record is deliberately NOT named use*, because that reads as a
   React hook — and the linter treats it as one.) */
export const chainFrom = (c) => c.tasks[0].from;
export const chainTo = (c) => c.tasks[c.tasks.length - 1].to;
export const chainUse = (c, driverId, vehicleId) => ({ driverId, vehicleId, start: c.start, end: c.end, from: chainFrom(c), to: chainTo(c) });

/* A chain's DEPOT-TO-DEPOT span: the driver starts work on leaving the depot and
   finishes on getting back. With no depot the span equals the tasks' own, which is
   exactly the calculation used before depots existed. */
export function spanOf(state, u) {
  const base = baseOf(state, u.vehicleId);
  if (!base) return { start: u.start, end: u.end };
  return { start: u.start - legMin(state, base, u.from), end: u.end + legMin(state, u.to, base) };
}

/* A driver's shifts: overlapping depot-to-depot spans merge into ONE shift.

   This is where "can the driver go home between two rides" is decided, with no
   separate rule: if there is no time to get home and back, the two spans overlap,
   so they become one shift — with the waiting time at the venue paid. */
export function mergeShifts(spans) {
  const out = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/* A driver's paid time and cost, from the chain occupancies assigned to them.
   The call-out fee is PER SHIFT, not per chain: somebody who could not go home in
   between did not turn out twice. */
export function driverPay(state, driver, uses) {
  const shifts = mergeShifts(uses.map((u) => spanOf(state, u)));
  let paid = 0, cost = 0;
  for (const sh of shifts) {
    const p = Math.max(sh.end - sh.start, driver?.minShiftMin || 0);
    paid += p;
    cost += (state.settings.calloutFee || 0) + (p / 60) * (driver?.wage || 0);
  }
  return { paid, cost, shifts };
}

/* On-site waiting: the time between two chains that fall inside one shift. The
   driver cannot go home, so they wait there. Nothing used to count this. */
export function onSiteWait(state, uses) {
  const us = [...uses].sort((a, b) => a.start - b.start);
  let w = 0;
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i], b = us[i + 1];
    if (spanOf(state, b).start <= spanOf(state, a).end) w += Math.max(0, b.start - a.end);
  }
  return w;
}

/* Do two chains using the SAME resource clash? Not overlapping in time is not
   enough: the bus also has to physically get there.

   Without this check one driver and bus could be given a chain ending in one
   village at 15:50 and another starting in a different town at 15:50 — a physically
   impossible roster, with no warning. */
export function resourceClash(state, u, c) {
  // A chain object carries no from/to field; the endpoints come from its tasks.
  // (c.from / c.to would be undefined, legMin would return 0, and the check would
  // silently permit every deadhead.)
  if (u.start < c.end && c.start < u.end) return true;                             // overlap in time
  if (u.end <= c.start) return u.end + legMin(state, u.to, chainFrom(c)) > c.start; // u, then c
  return c.end + legMin(state, chainTo(c), u.from) > u.start;                       // c, then u
}

/* Exact (driver, vehicle) to chain assignment: backtracking search with cost-bound pruning. */
export function assignResources(state, weekday, freeChains, fixedUse) {
  const chains = [...freeChains].sort((a, b) => a.start - b.start);
  let best = null, iter = 0, capped = false;
  const rec = (i, used, acc, cost) => {
    if (iter++ > 30000) { capped = true; return; }
    if (best && cost >= best.cost) return;
    if (i === chains.length) { best = { cost, picks: acc.map((x) => ({ ...x })) }; return; }
    const c = chains[i];
    const opts = [];
    /* The vignette is as hard a constraint as capacity: a bus without one is never
       even considered for a chain going to a venue that requires it. The optimizer
       then cannot propose a bad plan, so there is nothing to undo by hand. */
    const needsV = chainNeedsVignette(state, c);
    for (const d of state.drivers) {
      if (!driverAvailableFor(d, weekday, c.start, c.end)) continue;
      if (used.some((u) => u.driverId === d.id && resourceClash(state, u, c))) continue;
      for (const v of state.vehicles) {
        if (v.seats < c.maxPax) continue;
        if (needsV && !v.hasVignette) continue;
        if (used.some((u) => u.vehicleId === v.id && resourceClash(state, u, c))) continue;
        /* A chain's price is the INCREMENT to that driver's cost for the day. If
           it attaches to a shift they already have (because they cannot go home in
           between), the price is only the extra paid time, with no second call-out
           fee. */
        const mine = used.filter((u) => u.driverId === d.id);
        const delta = driverPay(state, d, [...mine, chainUse(c, d.id, v.id)]).cost
          - driverPay(state, d, mine).cost;
        // Soft preferred-vehicle bias: penalize putting a driver on any bus
        // other than their preferred one, so the optimizer keeps drivers on
        // their usual vehicle unless a real constraint (capacity/availability/
        // contention) or a larger true saving makes it worthwhile.
        const offPreferred = d.preferredVehicleId && v.id !== d.preferredVehicleId;
        const bias = offPreferred ? (state.settings.preferredBias || 0) : 0;
        opts.push({ d, v, cost: delta + bias });
      }
    }
    opts.sort((x, y) => x.cost - y.cost || x.v.seats - y.v.seats);
    for (const o of opts) {
      used.push(chainUse(c, o.d.id, o.v.id));
      acc.push({ chain: c, driverId: o.d.id, vehicleId: o.v.id });
      rec(i + 1, used, acc, cost + o.cost);
      acc.pop(); used.pop();
    }
    if (!opts.length) {
      acc.push({ chain: c, uncovered: true });
      rec(i + 1, used, acc, cost + 1e7);
      acc.pop();
    }
  };
  rec(0, [...fixedUse], [], 0);
  return { picks: best ? best.picks : [], cost: best ? best.cost : (chains.length ? 1e9 : 0), capped };
}

export function contentionReasons(state, weekday, t) {
  const av = state.drivers.filter((d) => driverAvailableFor(d, weekday, t.start, t.end));
  const needsV = taskNeedsVignette(state, t);
  const bigV = state.vehicles.filter((v) => v.seats >= t.pax && (!needsV || v.hasVignette));
  const what = needsV ? "elegendő férőhelyű, országos matricás jármű" : "elegendő férőhelyű jármű";
  return [`Erőforrás-ütközés: ${DAYS[weekday]} ${minToTime(t.start)}–${minToTime(t.end)} között minden alkalmas erőforrás foglalt (elérhető sofőr: ${av.length}, ${what}: ${bigV.length}).`];
}

/* Resolve the saved schedule into a view model, with live clash detection. */
export function resolveDay(state, weekday, weekMon) {
  const { tasks, skipped } = genDayTasks(state, weekday, weekMon);
  const tmap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const assigned = new Set();
  const chains = [];
  let droppedChains = 0;
  for (const ch of (state.assignments?.[weekday]?.chains || [])) {
    const ts = ch.taskIds.filter((x) => tmap[x.id]).map((x) => ({ ...tmap[x.id], locked: !!x.locked }));
    /* A chain's task ids can go stale. The id contains the split index, so after
       a change to the stops or the headcounts a `...:vissza` id can become
       `...:vissza#1` and `...:vissza#2`. The chain would then disappear, taking its
       stored driver, vehicle and locks with it — silently. Count those and let the
       caller say so, because to a user this reads as "my schedule vanished". */
    if (!ts.length) { droppedChains++; continue; }
    ts.forEach((t) => assigned.add(t.id));
    const c = mkChain(state, ts, { id: ch.id, driverId: ch.driverId, vehicleId: ch.vehicleId });
    c.driver = byId(state.drivers, ch.driverId);
    c.vehicle = byId(state.vehicles, ch.vehicleId);
    c.issues = [];
    c.links.filter((l) => l.infeasible).forEach((l) =>
      c.issues.push(`Szoros átkötés: ${l.a.label} → ${l.b.label} — ${l.short} perccel több idő kellene az üresjárathoz.`));
    if (c.driver && !driverAvailableFor(c.driver, weekday, c.start, c.end))
      c.issues.push(`${c.driver.name} nem érhető el a teljes ${minToTime(c.start)}–${minToTime(c.end)} sávban.`);
    if (c.vehicle && c.maxPax > c.vehicle.seats)
      c.issues.push(`A létszám (${c.maxPax} fő) meghaladja a(z) ${c.vehicle.plate} férőhelyét (${c.vehicle.seats}).`);
    /* A bus without a vignette can be assigned by hand, and one can survive in an
       older saved schedule where the venue only became vignette-only afterwards. We
       do not silently fix it, but we do say so. */
    if (c.vehicle && !c.vehicle.hasVignette && chainNeedsVignette(state, c))
      c.issues.push(`A(z) ${c.vehicle.plate} nincs országos matricával, de a lánc ide megy: ${vignetteVenues(state, c).join(", ")}.`);
    chains.push(c);
  }
  for (let i = 0; i < chains.length; i++)
    for (let j = i + 1; j < chains.length; j++) {
      const A = chains[i], B = chains[j];
      if (!(A.start < B.end && B.start < A.end)) continue;
      if (A.driverId && A.driverId === B.driverId) {
        const m = `Sofőrütközés: ${A.driver?.name || "?"} egyszerre két láncban van.`;
        A.issues.push(m); B.issues.push(m);
      }
      if (A.vehicleId && A.vehicleId === B.vehicleId) {
        const m = `Járműütközés: ${A.vehicle?.plate || "?"} egyszerre két láncban van.`;
        A.issues.push(m); B.issues.push(m);
      }
    }
  /* The same resource in two chains that do NOT overlap in time is still
     impossible when there is no room for the deadhead between them. Nothing used to
     flag that. */
  for (let i = 0; i < chains.length; i++)
    for (let j = 0; j < chains.length; j++) {
      if (i === j) continue;
      const A = chains[i], B = chains[j];
      if (A.end > B.start) continue;                       // csak A → B sorrendre
      if (!((A.driverId && A.driverId === B.driverId) || (A.vehicleId && A.vehicleId === B.vehicleId))) continue;
      const dead = legMin(state, chainTo(A), chainFrom(B));
      if (A.end + dead <= B.start) continue;
      const who = A.driverId === B.driverId ? (A.driver?.name || "A sofőr") : (A.vehicle?.plate || "A jármű");
      const m = `Nem érhető át: ${who} ${minToTime(A.end)}-kor végez itt: ${locName(state, chainTo(A))}, `
        + `de ${minToTime(B.start)}-kor már itt kellene lennie: ${locName(state, chainFrom(B))} `
        + `(${dead} p üresjárat, ${B.start - A.end} p áll rendelkezésre).`;
      A.issues.push(m); B.issues.push(m);
    }
  chains.sort((a, b) => a.start - b.start);
  const notes = droppedChains
    ? [...skipped, `${droppedChains} korábban mentett lánc feladatai már nem léteznek ebben a formában (valószínűleg megváltoztak a megállók vagy a létszámok), ezért kikerültek a beosztásból. Futtasd újra az optimalizálást.`]
    : skipped;
  return { tasks, chains, unassigned: tasks.filter((t) => !assigned.has(t.id)), skipped: notes };
}

export function dayStats(state, chains) {
  let paid = 0, cost = 0, dead = 0, idle = 0;
  const ds = new Set();
  /* Totalled per driver, not per chain: paid time is the depot-to-depot shift, and
     two chains can fall inside one shift. Summing per chain dropped the waiting time
     in between and counted the call-out fee twice. */
  const byDriver = new Map();
  for (const c of chains) {
    for (const l of c.links) { dead += l.dead; idle += l.idle; }
    // A call-out fee is only due when somebody actually turns out. A chain with no
    // driver used to carry one anyway, inflating the "before" column of the proposal.
    if (!c.driverId) { paid += Math.max(c.end - c.start, 0); continue; }
    ds.add(c.driverId);
    if (!byDriver.has(c.driverId)) byDriver.set(c.driverId, []);
    byDriver.get(c.driverId).push(chainUse(c, c.driverId, c.vehicleId));
  }
  for (const [id, uses] of byDriver) {
    const r = driverPay(state, byId(state.drivers, id), uses);
    paid += r.paid; cost += r.cost;
    idle += onSiteWait(state, uses);
  }
  return { drivers: ds.size, chains: chains.length, paidMin: paid, dead, idle, cost: Math.round(cost) };
}

/* Turn the schedule's chains into actual rides: one ride per task, with the stop
   times taken from the task's own timetable. This is how the schedule shows up on
   the week and driver screens too. */
export function ridesFromChains(state, weekday, chains) {
  const out = [];
  for (const ch of chains || []) {
    for (const t of ch.tasks || []) {
      const tr = byId(state.trainings, t.trainingId);
      if (!tr) continue;
      out.push({
        id: uid(),
        trainingId: t.trainingId,
        day: tr.type === "weekly" ? weekday : null,
        date: tr.type === "once" ? tr.date : null,
        vehicleId: ch.vehicleId || "",
        driverId: ch.driverId || "",
        dir: t.dir,
        source: "schedule",
        /* Outbound, a stop's time is the DEPARTURE (after boarding); on the return
           leg it is the ARRIVAL (when they get off). Generation used to write the
           arrival in both directions, so the week screen's clash window was
           consistently `dwellMin` minutes out from the schedule, and the printed time
           did not mean what the ride editor's field sets. */
        stops: (t.plan || []).map((s) => ({
          id: uid(), stationId: s.stationId,
          time: minToTime(t.dir === "vissza" ? s.arr : s.dep),
          count: Number(s.count) > 0 ? s.count : "",
        })),
      });
    }
  }
  return out;
}

/* True when this ride belongs to the tasks affected on this weekday. These are the
   rides that generating from the schedule replaces. */
export function rideBelongsToDay(state, ride, weekday, affectedTrainingIds) {
  if (!affectedTrainingIds.has(ride.trainingId)) return false;
  const tr = byId(state.trainings, ride.trainingId);
  if (!tr) return false;
  return tr.type === "weekly" ? ride.day === weekday : true;
}

/* Replace every ride of the day's affected trainings with ones generated from the
   schedule's chains. The user opts into this: the schedule then owns the day's whole
   set of rides. */
export function withGeneratedRides(state, weekday, weekMon, chains) {
  const { tasks } = genDayTasks(state, weekday, weekMon);
  const affected = new Set(tasks.map((t) => t.trainingId));
  const kept = state.rides.filter((r) => !rideBelongsToDay(state, r, weekday, affected));
  return [...kept, ...ridesFromChains(state, weekday, chains)];
}

/* The entry point for optimising one day. */
export function optimizeDay(state, weekday, weekMon) {
  const cur = resolveDay(state, weekday, weekMon);
  const notes = [...cur.skipped];
  if (!cur.tasks.length) return { empty: true, notes };
  const maxSeats = Math.max(0, ...state.vehicles.map((v) => Number(v.seats) || 0));

  // Locked tasks become skeleton chains carrying their driver and vehicle. Untouchable.
  const lockedGroups = new Map();
  for (const ch of cur.chains) {
    const lt = ch.tasks.filter((t) => t.locked);
    if (!lt.length) continue;
    /* Grouped by chain id, NOT by driver|vehicle. The latter fused two deliberately
       separate shifts (a morning and an evening one with the same driver and bus)
       into a single 07:00-20:00 chain with one call-out fee, making both the cost
       estimate and the printed schedule wrong. */
    const k = ch.id || `${ch.driverId}|${ch.vehicleId}`;
    if (!lockedGroups.has(k)) lockedGroups.set(k, { driverId: ch.driverId, vehicleId: ch.vehicleId, tasks: [] });
    lockedGroups.get(k).tasks.push(...lt);
  }
  const lockedIds = new Set([...lockedGroups.values()].flatMap((g) => g.tasks.map((t) => t.id)));

  // Hard feasibility of the free tasks, so an impossible one gets a precise reason.
  const uncovered = [], free = [];
  for (const t of cur.tasks) {
    if (lockedIds.has(t.id)) continue;
    const reasons = [];
    if (t.pax > maxSeats)
      reasons.push(`Nincs jármű elegendő férőhellyel: ${t.pax} fő kellene, a legnagyobb jármű ${maxSeats} férőhelyes.`);
    if (taskNeedsVignette(state, t) && !state.vehicles.some((v) => v.hasVignette && v.seats >= t.pax))
      reasons.push(`Nincs országos matricás jármű ${t.pax} fővel: ${vignetteVenues(state, { tasks: [t] }).join(", ")} csak matricás autóval érhető el.`);
    if (!state.drivers.some((d) => driverAvailableFor(d, weekday, t.start, t.end)))
      reasons.push(`Egyik sofőr sem érhető el ${DAYS[weekday]} ${minToTime(t.start)}–${minToTime(t.end)} között.`);
    if (reasons.length) uncovered.push({ task: t, reasons });
    else free.push(t);
  }

  const skel = [...lockedGroups.values()].map((gp) =>
    mkChain(state, gp.tasks, { id: uid(), driverId: gp.driverId, vehicleId: gp.vehicleId, hasLocked: true }));

  // Phase 1: chaining by minimum-cost flow, gaps weighted by the average wage.
  const wages = state.drivers.map((d) => d.wage || 0);
  const avgWpm = (wages.reduce((a, b) => a + b, 0) / (wages.length || 1)) / 60;
  const homeBase = state.settings?.defaultBaseId || null;
  const edges = [];
  for (let a = 0; a < free.length; a++)
    for (let b = 0; b < free.length; b++) {
      if (a === b) continue;
      const A = free[a], B = free[b];
      const dead = legMin(state, A.to, B.from);
      if (A.end + dead <= B.start) {
        /* If the driver cannot get home during the gap, that waiting time is paid
           whether or not we chain. Chaining then purely saves one call-out fee, so
           the gap must not be charged against it. The vehicle (and therefore its
           depot) is not decided yet, so we reckon with the club depot here;
           assignResources computes the exact price. */
        const gap = B.start - A.end;
        const forced = homeBase && gap < legMin(state, A.to, homeBase) + legMin(state, homeBase, B.from);
        edges.push({ a, b, cost: (forced ? 0 : Math.round(gap * avgWpm)) - (state.settings.calloutFee || 0) });
      }
    }
  let freeChains = minCostChains(free.length, edges).map((seq) => mkChain(state, seq.map((i) => free[i])));

  // Phase 2: assignment at true cost, plus a local-improvement loop that tries
  // merges. The flow only sees gap x average wage minus the call-out fee; minimum
  // shift lengths and differing wages are corrected here, against the real cost
  // function.
  /* Skeleton chains are priced with the same formula assignResources uses, the
     preferred-vehicle penalty included. Without that the improvement loop compared a
     biased cost against an unbiased one, so with the default preferredBias it saw a
     genuinely more expensive merge as an "improvement" — and the displayed daily cost
     went UP after optimising. */
  const skelCost = (c) => {
    const d = byId(state.drivers, c.driverId);
    const offPreferred = d?.preferredVehicleId && c.vehicleId !== d.preferredVehicleId;
    return driverPay(state, d, [chainUse(c, c.driverId, c.vehicleId)]).cost
      + (offPreferred ? (state.settings.preferredBias || 0) : 0);
  };
  const fixedUseOf = (sk) => sk.map((c) => chainUse(c, c.driverId, c.vehicleId));
  let anyCapped = false;
  const evalPlan = (skl, fre) => {
    const asg = assignResources(state, weekday, fre, fixedUseOf(skl));
    if (asg.capped) anyCapped = true;
    return { asg, cost: skl.reduce((a, c) => a + skelCost(c), 0) + asg.cost };
  };
  let skl = skel, fre = freeChains, plan = evalPlan(skl, fre);
  // The optimizer's objective before the local-improvement loop. The loop only
  // accepts a trial when it strictly lowers plan.cost, so this never increases.
  // (This is money + an uncovered-task penalty — the true monetary cost alone
  // can legitimately rise when improvement covers a previously uncovered task.)
  const objectiveBefore = plan.cost;
  for (let guard = 0; guard < 60; guard++) {
    let improved = false;
    outer:
    for (let i = 0; i < fre.length; i++)
      for (let j = 0; j < fre.length; j++) {
        if (i === j) continue;
        const A = fre[i], B = fre[j];
        if (A.end + legMin(state, A.tasks[A.tasks.length - 1].to, B.tasks[0].from) > B.start) continue;
        const trialF = fre.filter((_, k) => k !== i && k !== j);
        trialF.push(mkChain(state, [...A.tasks, ...B.tasks]));
        const t = evalPlan(skl, trialF);
        if (t.cost < plan.cost - 0.5) { fre = trialF; plan = t; improved = true; break outer; }
      }
    if (!improved) {
      skmerge:
      for (let i = 0; i < fre.length; i++)
        for (let k = 0; k < skl.length; k++) {
          const F = fre[i], K = skl[k];
          const d = byId(state.drivers, K.driverId), v = byId(state.vehicles, K.vehicleId);
          if (!d || !v) continue;
          const after = K.end + legMin(state, K.tasks[K.tasks.length - 1].to, F.tasks[0].from) <= F.start;
          const before = F.end + legMin(state, F.tasks[F.tasks.length - 1].to, K.tasks[0].from) <= K.start;
          if ((!after && !before) || Math.max(F.maxPax, K.maxPax) > v.seats) continue;
          if (!driverAvailableFor(d, weekday, Math.min(K.start, F.start), Math.max(K.end, F.end))) continue;
          /* A skeleton chain's vehicle is fixed, so it cannot acquire a vignette:
             a task that needs one may only be appended to a bus that has one. */
          if (chainNeedsVignette(state, F) && !v.hasVignette) continue;
          const trialS = skl.map((c, x) => (x === k ? mkChain(state, [...c.tasks, ...F.tasks], c) : c));
          const trialF = fre.filter((_, x) => x !== i);
          const t = evalPlan(trialS, trialF);
          if (t.cost < plan.cost - 0.5) { skl = trialS; fre = trialF; plan = t; improved = true; break skmerge; }
        }
    }
    if (!improved) break;
  }
  if (anyCapped) notes.push("A keresési tér nagy volt, a hozzárendelés a legjobb megtalált megoldás (heurisztikus).");
  const result = [...skl];
  for (const p of plan.asg.picks) {
    if (p.uncovered) p.chain.tasks.forEach((t) => uncovered.push({ task: t, reasons: contentionReasons(state, weekday, t) }));
    else result.push({ ...p.chain, driverId: p.driverId, vehicleId: p.vehicleId });
  }
  result.sort((a, b) => a.start - b.start);
  return { empty: false, chains: result, uncovered, notes, stats: dayStats(state, result),
    improve: { before: objectiveBefore, after: plan.cost } };
}
