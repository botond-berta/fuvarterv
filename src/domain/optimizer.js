/* Fuvarterv — feladatok, útvonal, láncolás, erőforrás-hozzárendelés
   Kiemelve a fuvarterv.jsx monolitból; a viselkedés változatlan. */

import { DAYS, byId, uid } from "./constants.js";
import { timeToMin, minToTime } from "./datetime.js";
import { legMin, locName } from "./geo.js";
import { weekOccurrences, teamLeg } from "./logic.js";

/* Held–Karp: az összes állomást érintő legrövidebb út sorrendje.
   pre/post: a lánc elé/mögé kötött pont (pl. helyszín); fixedFirst/fixedLast:
   kötelező első/utolsó állomás. n≤10-ig egzakt, felette az eredeti sorrend marad. */
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

/* ODA menetrend: visszafelé számolva a helyszíni céltidőponttól.
   arr = mikor kell a megállóban lenni; dep = arr + megállási idő. */
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

/* VISSZA menetrend: előrefelé számolva a helyszíni indulástól. */
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

/* A csapat útvonal-sorrendje: automatikus (opcionális rögzített kezdő megállóval)
   vagy kézi (a chipek bekapcsolási sorrendje; VISSZA fordítva). Feladatbontásnál
   egy megálló-részhalmaz is átadható; a rögzített kezdő megálló csak akkor
   érvényes, ha benne van a részhalmazban. */
export function teamRouteOrder(state, team, venueId, dir, stationIds) {
  const leg = teamLeg(team, dir);
  const ids = (stationIds || leg.stationIds || []).filter((id) => byId(state.stations, id));
  if (ids.length <= 1 || team.routeMode === "manual") {
    /* Kézi módban a tárolt sorrend a szándékolt sorrend. Megfordítani csak akkor
       helyes, ha a visszaút az ODAÚT listáját tükrözi; ha saját listája van, azt
       a felhasználó már hazafelé menő sorrendben állította össze. */
    if (dir === "oda" || leg.isOverride) return ids;
    return [...ids].reverse();
  }
  const anchor = leg.routeAnchorId && ids.includes(leg.routeAnchorId) ? leg.routeAnchorId : null;
  if (dir === "oda") return bestStationOrder(state, ids, { post: venueId, fixedFirst: anchor });
  return bestStationOrder(state, ids, { pre: venueId, fixedLast: anchor });
}

/* Megállók csomagolása a lehető legkevesebb buszba (first-fit-decreasing):
   minden busz létszáma <= cap, egy megálló teljes létszáma egyetlen buszba kerül.
   null, ha nincs megállónkénti létszámadat, vagy ha egy megálló önmagában több,
   mint egy busz (ekkor megállónként nem osztható). A visszaadott buszok megállói
   a csapat eredeti sorrendjét követik. */
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

/* Egy nap feladatai: minden edzés-előfordulásból ODA + VISSZA. Ha a csapat
   létszáma meghaladja a legnagyobb jármű férőhelyét, a feladatot megállónként
   több buszra bontjuk (mindegyik önálló, párhuzamos fuvar ugyanarra a helyszínre). */
export function genDayTasks(state, weekday, weekMon) {
  const occs = weekOccurrences(state, weekMon).filter((o) => o.dayIdx === weekday);
  const tasks = [], skipped = [];
  const N = state.settings.arriveEarlyMin ?? 10, M = state.settings.departAfterMin ?? 10;
  const dwell = state.settings.dwellMin ?? 2;
  const maxSeats = Math.max(0, ...state.vehicles.map((v) => Number(v.seats) || 0));
  for (const o of occs) {
    const t = o.training, team = byId(state.teams, t.teamId);
    if (!team) continue;
    const suffix = t.type === "weekly" ? weekday : "x";

    /* Irányonként külön kör: a visszaútnak saját megállói és saját létszámai
       lehetnek, ezért a megállóhalmazt, a létszámokat, a pax-ot ÉS a buszokra
       bontást is irányonként kell számolni. A két irány így eltérő számú buszra
       is bomolhat — ezt semmi nem tiltja: a feladatok innentől függetlenek, a
       láncolás időre és üresjáratra megy, az #1/#2 párosítás sehol nincs
       kikényszerítve. */
    for (const dir of ["oda", "vissza"]) {
      const leg = teamLeg(team, dir);
      const dirLabel = dir === "oda" ? "ODA" : "VISSZA";
      const who = leg.isOverride ? `${team.name} · ${dirLabel}` : team.name;

      const st = (leg.stationIds || []).filter((id) => byId(state.stations, id));
      if (!st.length) {
        skipped.push(`${who}: nincs állomás rendelve, ezért nem készült ${dirLabel} feladat.`);
        continue;
      }
      const pax = teamPax(team, dir);
      if (!pax) skipped.push(`${who}: nincs megadva létszám (se megállónként, se összesen) — 0 főnek számol.`);
      const sc = leg.stationCounts || {};
      const cnt = (sid) => Number(sc[sid]) || 0;

      /* Egy irány feladata egy megálló-részhalmazra. idx=null: teljes csapat egy
         buszon; idx>=1: a `count` buszra bontott feladat idx-edik része. */
      const mkTask = (subset, idx, count) => {
        const order = teamRouteOrder(state, team, t.venueId, dir, subset);
        const split = idx != null;
        const tag = split ? `#${idx}` : "";
        const name = `${team.name} · ${dirLabel}${split ? ` (${idx}/${count})` : ""}`;
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

/* Csapat szállítandó létszáma: a megállónkénti bontás összege és a megadott
   összlétszám közül a NAGYOBB. Korábban a részleges bontás felülírta az
   összlétszámot: egy 12 fős csapatnál, ahol az edző még csak két megállóhoz írt
   létszámot, ez 5 főt adott — nem indult kapacitás szerinti felosztás, és 12
   gyerek elé állt be egy 6 személyes busz, figyelmeztetés nélkül. */
export function teamPax(team, dir = "oda") {
  const leg = teamLeg(team, dir);
  const sc = leg.stationCounts;
  const sum = (leg.stationIds || []).reduce((a, id) => a + (Number(sc[id]) || 0), 0);
  /* Az összlétszám tartalék érték: csak akkor számít, ha a megállónkénti bontás
     kisebb nála. Saját visszaút-listánál is ugyanez a szabály — ugyanazok a
     gyerekek utaznak, csak máshol szállnak le. */
  return Math.max(sum, Number(team.passengerCount) || 0);
}

/* Elérhető-e a sofőr a teljes [startMin, endMin] sávban az adott hétköznapon?
   Az egymáshoz érő vagy átfedő ablakok ÖSSZEÁLLNAK: a 15:00–17:00 és a
   17:00–19:00 együtt lefed egy 15:00–19:00-s műszakot. Korábban egyetlen
   ablaknak kellett önmagában tartalmaznia a sávot, így egy ilyen sofőr
   indoklás nélkül kiesett a napból. A hiányos (kezdet vagy vég nélküli)
   ablakokat figyelmen kívül hagyjuk — azok korábban némán egész napra
   elérhetetlenné tették a sofőrt. */
export function driverAvailableFor(driver, weekday, startMin, endMin) {
  const ws = driver.availability || [];
  if (!ws.length) return true; // nincs megadva → bármikor elérhető
  const spans = ws
    .filter((w) => (w.days || []).includes(weekday))
    .map((w) => [timeToMin(w.start), timeToMin(w.end)])
    .filter(([a, b]) => a != null && b != null && b > a)
    .sort((x, y) => x[0] - y[0]);
  if (!spans.length) return false;
  let [lo, hi] = spans[0];
  for (const [a, b] of spans.slice(1)) {
    if (a <= hi) { hi = Math.max(hi, b); continue; }   // érintkező/átfedő → összeolvad
    if (lo <= startMin && endMin <= hi) return true;
    [lo, hi] = [a, b];
  }
  return lo <= startMin && endMin <= hi;
}

/* Lánc nézetmodell: rendezett feladatok + átkötések (üresjárat, várakozás) */
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
    /* A lánc vége a LEGKÉSŐBBI befejezés, nem az utolsóként induló feladaté. Egy
       beágyazott feladat (15:00–19:00 mellett 15:30–16:00) különben 16:00-ra
       rövidítené a láncot, és ezzel elrontaná a rendelkezésre állást, az
       ütközésvizsgálatot és a fizetett idő számítását is. */
    start: Math.min(...tasks.map((t) => t.start)),
    end: Math.max(...tasks.map((t) => t.end)),
    maxPax: Math.max(...tasks.map((t) => t.pax)),
  };
}

/* Minimális költségű folyam a láncoláshoz (páros gráf, egymást követő legrövidebb utak).
   Él: A.vég + üresjárat(A.hova, B.honnan) <= B.kezdet; élköltség = bér×rés − kiszállási díj.
   Csak összköltséget csökkentő (negatív) utak mentén küldünk folyamot. */
export function minCostChains(n, edges) {
  const S = 2 * n, T = 2 * n + 1, NN = 2 * n + 2;
  const g = [], head = Array(NN).fill(-1);
  const addEdge = (u, v, cap, cost) => {
    g.push({ v, cap, cost, next: head[u] }); head[u] = g.length - 1;
    g.push({ v: u, cap: 0, cost: -cost, next: head[v] }); head[v] = g.length - 1;
  };
  for (let i = 0; i < n; i++) { addEdge(S, i, 1, 0); addEdge(n + i, T, 1, 0); }
  for (const e of edges) addEdge(e.a, n + e.b, 1, e.cost);
  // Biztonsági korlát: legfeljebb n javító út létezhet (minden út egy feladatot
  // köt be), a ciklus enélkül egy elfajult reziduális gráfon megállás nélkül futna.
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
  /* Láncok kiolvasása. Minden feladatnak PONTOSAN egy láncba kell kerülnie: ha a
     succ/pred körré záródna (elfajult, nulla vagy negatív hosszú feladatablakok
     esetén lehetséges), a régi "csak pred === -1 indít láncot" szabály mellett a
     kör összes feladata némán eltűnt — se láncban, se a fedetlenek közt. A
     `seen` halmaz garantálja, hogy minden index pontosan egyszer szerepel. */
  const chains = [];
  const seen = new Array(n).fill(false);
  const walk = (startIdx) => {
    const seq = [];
    let c = startIdx;
    while (c !== -1 && !seen[c]) { seen[c] = true; seq.push(c); c = succ[c]; }
    if (seq.length) chains.push(seq);
  };
  for (let i = 0; i < n; i++) if (pred[i] === -1) walk(i);
  for (let i = 0; i < n; i++) if (!seen[i]) walk(i);   // körben maradt maradék
  return chains;
}

/* Egy lánc két végpontja: honnan indul az első feladat, hová ér az utolsó.
   (A foglaltság-bejegyzés neve szándékosan NEM use*, mert az React hook-nak
   olvasódik — a linter is annak veszi.) */
export const chainFrom = (c) => c.tasks[0].from;
export const chainTo = (c) => c.tasks[c.tasks.length - 1].to;
export const chainUse = (c, driverId, vehicleId) => ({ driverId, vehicleId, start: c.start, end: c.end, from: chainFrom(c), to: chainTo(c) });

/* Ütközik-e két, UGYANAZT az erőforrást használó lánc? Nem elég, hogy időben ne
   fedjék egymást: a busznak át is kell érnie. Enélkül ugyanaz a sofőr+busz
   megkaphatott egy 15:50-kor Kisteleken végződő és egy 15:50-kor Szegeden induló
   láncot — fizikailag lehetetlen beosztás, figyelmeztetés nélkül. */
export function resourceClash(state, u, c) {
  // A lánc objektum nem hordoz from/to mezőt — a végpontokat a feladataiból
  // kell kiolvasni. (c.from/c.to undefined lenne, amitől a legMin 0-t adna, és
  // az ellenőrzés csendben minden üresjáratot megengedne.)
  if (u.start < c.end && c.start < u.end) return true;                             // időbeli átfedés
  if (u.end <= c.start) return u.end + legMin(state, u.to, chainFrom(c)) > c.start; // u, majd c
  return c.end + legMin(state, chainTo(c), u.from) > u.start;                       // c, majd u
}

/* Egzakt (sofőr, jármű) → lánc hozzárendelés visszalépéses kereséssel, költségkorlátos vágással */
export function assignResources(state, weekday, freeChains, fixedUse) {
  const chains = [...freeChains].sort((a, b) => a.start - b.start);
  let best = null, iter = 0, capped = false;
  const rec = (i, used, acc, cost) => {
    if (iter++ > 30000) { capped = true; return; }
    if (best && cost >= best.cost) return;
    if (i === chains.length) { best = { cost, picks: acc.map((x) => ({ ...x })) }; return; }
    const c = chains[i];
    const opts = [];
    for (const d of state.drivers) {
      if (!driverAvailableFor(d, weekday, c.start, c.end)) continue;
      if (used.some((u) => u.driverId === d.id && resourceClash(state, u, c))) continue;
      for (const v of state.vehicles) {
        if (v.seats < c.maxPax) continue;
        if (used.some((u) => u.vehicleId === v.id && resourceClash(state, u, c))) continue;
        const paid = Math.max(c.end - c.start, d.minShiftMin || 0);
        const base = (state.settings.calloutFee || 0) + (paid / 60) * (d.wage || 0);
        // Soft preferred-vehicle bias: penalize putting a driver on any bus
        // other than their preferred one, so the optimizer keeps drivers on
        // their usual vehicle unless a real constraint (capacity/availability/
        // contention) or a larger true saving makes it worthwhile.
        const offPreferred = d.preferredVehicleId && v.id !== d.preferredVehicleId;
        const bias = offPreferred ? (state.settings.preferredBias || 0) : 0;
        opts.push({ d, v, cost: base + bias });
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
  const bigV = state.vehicles.filter((v) => v.seats >= t.pax);
  return [`Erőforrás-ütközés: ${DAYS[weekday]} ${minToTime(t.start)}–${minToTime(t.end)} között minden alkalmas erőforrás foglalt (elérhető sofőr: ${av.length}, elegendő férőhelyű jármű: ${bigV.length}).`];
}

/* A mentett beosztás feloldása nézetmodellé + élő ütközésjelzés */
export function resolveDay(state, weekday, weekMon) {
  const { tasks, skipped } = genDayTasks(state, weekday, weekMon);
  const tmap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const assigned = new Set();
  const chains = [];
  let droppedChains = 0;
  for (const ch of (state.assignments?.[weekday]?.chains || [])) {
    const ts = ch.taskIds.filter((x) => tmap[x.id]).map((x) => ({ ...tmap[x.id], locked: !!x.locked }));
    /* Egy lánc feladatazonosítói elavulhatnak: az azonosító tartalmazza a
       felosztási indexet, így pl. a megállók vagy a létszámok módosítása után
       a `…:vissza` azonosítóból `…:vissza#1/#2` lehet. Ilyenkor a lánc a benne
       tárolt sofőrrel, járművel és zárolással együtt eltűnne — némán. Számoljuk,
       és a hívó jelezze, különben az felhasználói szemmel "eltűnt a beosztásom". */
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
  /* Ugyanaz az erőforrás két, időben NEM fedő láncban is lehetetlen, ha nincs idő
     az üresjáratra közöttük — ezt eddig semmi nem jelezte. */
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
  for (const c of chains) {
    const d = byId(state.drivers, c.driverId);
    if (c.driverId) ds.add(c.driverId);
    const p = Math.max(c.end - c.start, d?.minShiftMin || 0);
    paid += p;
    // Kiszállási díj csak akkor jár, ha tényleg kiszáll valaki: a sofőr nélküli
    // lánc korábban is 1500 Ft-ot vitt, felfújva a javaslat "előtte" oszlopát.
    if (d) cost += (state.settings.calloutFee || 0) + (p / 60) * (d.wage || 0);
    for (const l of c.links) { dead += l.dead; idle += l.idle; }
  }
  return { drivers: ds.size, chains: chains.length, paidMin: paid, dead, idle, cost: Math.round(cost) };
}

/* A beosztás láncaiból tényleges fuvarokat készít: minden feladat (ODA/VISSZA)
   egy fuvar, a feladat menetrendje (plan) adja a megállók idejét. Így a beosztás
   a Hét és a Sofőr nézetben is megjelenik. */
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
        /* ODA-nál a megálló ideje az INDULÁS (a felszállás után), VISSZA-nál az
           ÉRKEZÉS (a leszállás). A generálás korábban mindkét irányban az
           érkezést írta ki, ezért a Hét nézet ütközésablaka rendszeresen
           `dwellMin` perccel elcsúszott a beosztáshoz képest, és a kiírt idő sem
           azt jelentette, amit a fuvarszerkesztő mezője állít. */
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

/* Igaz, ha az adott fuvar az adott hétköznap érintett feladataihoz tartozik
   (ezeket cseréli le a beosztásból való fuvargenerálás). */
export function rideBelongsToDay(state, ride, weekday, affectedTrainingIds) {
  if (!affectedTrainingIds.has(ride.trainingId)) return false;
  const tr = byId(state.trainings, ride.trainingId);
  if (!tr) return false;
  return tr.type === "weekly" ? ride.day === weekday : true;
}

/* Az adott napra érintett edzések összes fuvarját lecseréli a beosztás
   láncaiból generáltakra (a felhasználó választása szerint a nap teljes
   fuvarkészletét a beosztás adja). */
export function withGeneratedRides(state, weekday, weekMon, chains) {
  const { tasks } = genDayTasks(state, weekday, weekMon);
  const affected = new Set(tasks.map((t) => t.trainingId));
  const kept = state.rides.filter((r) => !rideBelongsToDay(state, r, weekday, affected));
  return [...kept, ...ridesFromChains(state, weekday, chains)];
}

/* A napi optimalizálás fő belépési pontja */
export function optimizeDay(state, weekday, weekMon) {
  const cur = resolveDay(state, weekday, weekMon);
  const notes = [...cur.skipped];
  if (!cur.tasks.length) return { empty: true, notes };
  const maxSeats = Math.max(0, ...state.vehicles.map((v) => Number(v.seats) || 0));

  // Zárolt feladatok: (sofőr, jármű) szerinti csontváz-láncok, ezekhez nem nyúlunk
  const lockedGroups = new Map();
  for (const ch of cur.chains) {
    const lt = ch.tasks.filter((t) => t.locked);
    if (!lt.length) continue;
    /* Láncazonosító szerint csoportosítunk, NEM sofőr|jármű szerint. Utóbbi két
       szándékosan külön műszakot (pl. egy reggelit és egy estit, ugyanazzal a
       sofőrrel és busszal) egyetlen 07:00–20:00-s lánccá olvasztott, egyetlen
       kiszállási díjjal — a költségbecslés és a kiírt beosztás is hibás lett. */
    const k = ch.id || `${ch.driverId}|${ch.vehicleId}`;
    if (!lockedGroups.has(k)) lockedGroups.set(k, { driverId: ch.driverId, vehicleId: ch.vehicleId, tasks: [] });
    lockedGroups.get(k).tasks.push(...lt);
  }
  const lockedIds = new Set([...lockedGroups.values()].flatMap((g) => g.tasks.map((t) => t.id)));

  // Szabad feladatok kemény megvalósíthatósága → pontos indoklás, ha nem megy
  const uncovered = [], free = [];
  for (const t of cur.tasks) {
    if (lockedIds.has(t.id)) continue;
    const reasons = [];
    if (t.pax > maxSeats)
      reasons.push(`Nincs jármű elegendő férőhellyel: ${t.pax} fő kellene, a legnagyobb jármű ${maxSeats} férőhelyes.`);
    if (!state.drivers.some((d) => driverAvailableFor(d, weekday, t.start, t.end)))
      reasons.push(`Egyik sofőr sem érhető el ${DAYS[weekday]} ${minToTime(t.start)}–${minToTime(t.end)} között.`);
    if (reasons.length) uncovered.push({ task: t, reasons });
    else free.push(t);
  }

  const skel = [...lockedGroups.values()].map((gp) =>
    mkChain(state, gp.tasks, { id: uid(), driverId: gp.driverId, vehicleId: gp.vehicleId, hasLocked: true }));

  // 1. fázis: láncolás min. költségű folyammal (átlag-órabérrel súlyozott rések)
  const wages = state.drivers.map((d) => d.wage || 0);
  const avgWpm = (wages.reduce((a, b) => a + b, 0) / (wages.length || 1)) / 60;
  const edges = [];
  for (let a = 0; a < free.length; a++)
    for (let b = 0; b < free.length; b++) {
      if (a === b) continue;
      const A = free[a], B = free[b];
      const dead = legMin(state, A.to, B.from);
      if (A.end + dead <= B.start)
        edges.push({ a, b, cost: Math.round((B.start - A.end) * avgWpm) - (state.settings.calloutFee || 0) });
    }
  let freeChains = minCostChains(free.length, edges).map((seq) => mkChain(state, seq.map((i) => free[i])));

  // 2. fázis: valódi költségű hozzárendelés + lokális javítás (összevonások).
  // A folyam a rés×átlagbér − kiszállás költséget látja; a min. műszak és az
  // eltérő órabérek hatását itt, a tényleges költségfüggvényen javítjuk.
  /* A csontváz-láncok ára ugyanazon a képleten, amit az assignResources használ —
     a preferált-jármű büntetést is beleértve. Enélkül a javítóciklus torzított
     (biased) és torzítatlan költséget vetett össze, így az alapértelmezett
     preferredBias mellett egy valójában drágább összevonást is "javulásnak" látott,
     és az optimalizálás UTÁN nőtt a kijelzett napi költség. */
  const skelCost = (c) => {
    const d = byId(state.drivers, c.driverId);
    const paid = Math.max(c.end - c.start, d?.minShiftMin || 0);
    const base = (state.settings.calloutFee || 0) + (paid / 60) * (d?.wage || 0);
    const offPreferred = d?.preferredVehicleId && c.vehicleId !== d.preferredVehicleId;
    return base + (offPreferred ? (state.settings.preferredBias || 0) : 0);
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
