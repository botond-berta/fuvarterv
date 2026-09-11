package hu.fuvarterv.domain;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.LocalDate;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static hu.fuvarterv.domain.Model.*;

/**
 * Tasks, routing, chaining and resource assignment, ported from {@code src/domain/optimizer.js}.
 *
 * <p>Three phases, in order (ADR-12): turn the day's trainings into tasks, link tasks into
 * chains one bus can run, then pick the cheapest driver and vehicle for each chain.
 *
 * <p>Two rules govern this port and both are easy to break without any test going red:
 *
 * <p><b>Iteration order is part of the answer.</b> E2 requires determinism — the same day must
 * produce the same schedule, or nobody can trust it. JavaScript objects, {@code Map} and
 * {@code Set} all iterate in insertion order, and this code leans on that in the locked-chain
 * grouping, in the {@code seen} set and in the per-driver totals. Every map and set here is a
 * {@code LinkedHashMap} or {@code LinkedHashSet} for that reason. A plain {@code HashMap}
 * would still produce a valid schedule, just a different one each build.
 *
 * <p><b>Sorts must stay stable.</b> Both languages sort stably, and ties are common: two tasks
 * starting at the same minute keep generation order. {@link Js#sign} reproduces how
 * JavaScript reads a comparator, NaN included.
 */
public final class Optimizer {
  private Optimizer() {}

  /** UI copy, but indexed by weekday number in the explanations, so the order is load-bearing. */
  private static final String[] DAYS =
      { "Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat", "Vasárnap" };

  /* ------------------------------------------------------------------ routing */

  /** Options for {@link #bestStationOrder}: a point pinned before or after, or a fixed end. */
  public record OrderOpts(String pre, String post, String fixedFirst, String fixedLast) {
    public static OrderOpts none() { return new OrderOpts(null, null, null, null); }
    public static OrderOpts post(String v) { return new OrderOpts(null, v, null, null); }
    public static OrderOpts pre(String v) { return new OrderOpts(v, null, null, null); }
    public static OrderOpts postFirst(String v, String f) { return new OrderOpts(null, v, f, null); }
    public static OrderOpts preLast(String v, String l) { return new OrderOpts(v, null, null, l); }
  }

  /**
   * Held-Karp: the shortest order that visits every station.
   *
   * <p>Exact up to ten stops; above that the original order is kept, because the table is
   * {@code 2^n} by {@code n} and both memory and time run away past that (ADR-13). Real runs
   * are not longer.
   */
  public static List<String> bestStationOrder(JsonNode state, List<String> ids, OrderOpts o) {
    int n = ids.size();
    if (n <= 1 || n > 10) return new ArrayList<>(ids);
    int full = (1 << n) - 1;
    double[][] dp = new double[1 << n][n];
    int[][] par = new int[1 << n][n];
    for (double[] row : dp) Arrays.fill(row, Double.POSITIVE_INFINITY);
    for (int[] row : par) Arrays.fill(row, -1);

    for (int i = 0; i < n; i++) {
      if (o.fixedFirst() != null && !ids.get(i).equals(o.fixedFirst())) continue;
      dp[1 << i][i] = Js.truthy(textNode(o.pre())) ? Geo.legMin(state, o.pre(), ids.get(i)) : 0;
    }
    for (int m = 1; m <= full; m++)
      for (int i = 0; i < n; i++) {
        double cur = dp[m][i];
        if (Double.isInfinite(cur) || Double.isNaN(cur)) continue;
        for (int j = 0; j < n; j++) {
          if ((m & (1 << j)) != 0) continue;
          int nm = m | (1 << j);
          double nc = cur + Geo.legMin(state, ids.get(i), ids.get(j));
          if (nc < dp[nm][j]) { dp[nm][j] = nc; par[nm][j] = i; }
        }
      }
    double best = Double.POSITIVE_INFINITY;
    int bi = -1;
    for (int i = 0; i < n; i++) {
      if (o.fixedLast() != null && !ids.get(i).equals(o.fixedLast())) continue;
      double c = dp[full][i] + (Js.truthy(textNode(o.post())) ? Geo.legMin(state, ids.get(i), o.post()) : 0);
      if (c < best) { best = c; bi = i; }
    }
    if (bi < 0) return new ArrayList<>(ids);   // the pinned stop was not in the list
    List<String> order = new ArrayList<>();
    int m = full, i = bi;
    while (i != -1) {
      order.add(ids.get(i));
      int pi = par[m][i];
      m &= ~(1 << i);
      i = pi;
    }
    java.util.Collections.reverse(order);
    return order;
  }

  /** {@code pre ? ... : ...} in the original tests truthiness, so "" pins nothing. */
  private static JsonNode textNode(String s) {
    return s == null ? com.fasterxml.jackson.databind.node.NullNode.getInstance()
                     : com.fasterxml.jackson.databind.node.TextNode.valueOf(s);
  }

  /**
   * Outbound timetable, computed BACKWARDS from the arrival time at the venue.
   *
   * <p>This is the only correct direction: the fixed point is the venue, not the stop.
   */
  public static PlanResult planOda(JsonNode state, List<String> order, String venueId,
                                   double arriveBy, double dwell) {
    double t = arriveBy;
    PlanResult r = new PlanResult();
    for (int i = order.size() - 1; i >= 0; i--) {
      String next = i == order.size() - 1 ? venueId : order.get(i + 1);
      double dep = t - Geo.legMin(state, order.get(i), next);
      double arr = dep - dwell;
      r.stops.add(0, new PlanStop(order.get(i), arr, dep));
      t = arr;
    }
    r.venueArr = arriveBy;
    r.start = r.stops.isEmpty() ? arriveBy : r.stops.get(0).arr;
    r.end = arriveBy;
    return r;
  }

  /** Return timetable, computed forwards from the departure at the venue. */
  public static PlanResult planVissza(JsonNode state, List<String> order, String venueId,
                                      double departAt, double dwell) {
    double t = departAt;
    String prev = venueId;
    PlanResult r = new PlanResult();
    for (String sid : order) {
      double arr = t + Geo.legMin(state, prev, sid);
      double dep = arr + dwell;
      r.stops.add(new PlanStop(sid, arr, dep));
      t = dep;
      prev = sid;
    }
    r.venueDep = departAt;
    r.start = departAt;
    r.end = r.stops.isEmpty() ? departAt : r.stops.get(r.stops.size() - 1).arr;
    return r;
  }

  /**
   * The route order for one stop list: automatic with an optional pinned first stop, or manual.
   *
   * <p>In manual mode the stored order IS the intended order. Reversing is only correct when
   * the return leg mirrors the outbound list; when it has its own, the user already built it
   * in homeward order (I2).
   */
  public static List<String> legRouteOrder(JsonNode state, JsonNode team, JsonNode training,
                                           String venueId, String dir, List<String> stationIds) {
    Logic.Leg leg = Logic.legFor(team, training, dir);
    List<String> src = stationIds != null ? stationIds : leg.stationIds();
    List<String> ids = new ArrayList<>();
    for (String id : src) if (Js.byId(Js.get(state, "stations"), id) != null) ids.add(id);

    if (ids.size() <= 1 || "manual".equals(leg.routeMode())) {
      if ("oda".equals(dir) || leg.isOverride()) return ids;
      List<String> rev = new ArrayList<>(ids);
      java.util.Collections.reverse(rev);
      return rev;
    }
    String anchor = leg.routeAnchorId() != null && !leg.routeAnchorId().isEmpty()
        && ids.contains(leg.routeAnchorId()) ? leg.routeAnchorId() : null;
    if ("oda".equals(dir)) return bestStationOrder(state, ids, OrderOpts.postFirst(venueId, anchor));
    return bestStationOrder(state, ids, OrderOpts.preLast(venueId, anchor));
  }

  /** The team-level call, the shape this had before per-training stop lists existed. */
  public static List<String> teamRouteOrder(JsonNode state, JsonNode team, String venueId,
                                            String dir, List<String> stationIds) {
    return legRouteOrder(state, team, null, venueId, dir, stationIds);
  }

  /* -------------------------------------------------------------- task splitting */

  /** A per-stop headcount lookup, with JavaScript's {@code Number(x) || 0} coercion. */
  public interface Counter { double count(String stationId); }

  /**
   * Pack stops into as few buses as possible, first-fit-decreasing (ADR-16). A stop's whole
   * headcount goes on ONE bus, and within each bus the stops keep the team's original order.
   *
   * <p>Null when there are no per-stop headcounts, or when one stop alone exceeds a bus —
   * neither can be split this way, and the caller turns that into an explanation.
   */
  public static List<List<String>> splitStationsByCapacity(List<String> stationIds, Counter cnt, double cap) {
    record WithCount(String id, int i, double c) {}
    List<WithCount> withCount = new ArrayList<>();
    for (int i = 0; i < stationIds.size(); i++) {
      double c = cnt.count(stationIds.get(i));
      if (c > 0) withCount.add(new WithCount(stationIds.get(i), i, c));
    }
    if (withCount.isEmpty()) return null;
    for (WithCount x : withCount) if (x.c() > cap) return null;

    record Bin(List<WithCount> items, double[] load) {}
    List<Bin> bins = new ArrayList<>();
    List<WithCount> desc = new ArrayList<>(withCount);
    desc.sort((a, b) -> Js.sign(b.c() - a.c()));      // stable, so equal counts keep their order
    for (WithCount s : desc) {
      Bin b = null;
      for (Bin x : bins) if (x.load()[0] + s.c() <= cap) { b = x; break; }
      if (b == null) { b = new Bin(new ArrayList<>(), new double[] { 0 }); bins.add(b); }
      b.items().add(s);
      b.load()[0] += s.c();
    }
    List<List<String>> out = new ArrayList<>();
    for (Bin b : bins) {
      List<WithCount> items = b.items();
      items.sort((a, z) -> Js.sign(a.i() - z.i()));
      List<String> ids = new ArrayList<>();
      for (WithCount x : items) ids.add(x.id());
      out.add(ids);
    }
    return out;
  }

  /**
   * How many people a team needs carried: the GREATER of the per-stop breakdown's sum and the
   * stated team total (I3).
   *
   * <p>A partial breakdown must never shrink a team. On a twelve-person team where the coach
   * had entered counts for two stops, overriding with the breakdown produced 5, no capacity
   * split was triggered, and a six-seat bus turned up for twelve children with no warning.
   */
  public static double legPax(JsonNode team, JsonNode training, String dir) {
    Logic.Leg leg = Logic.legFor(team, training, dir);
    JsonNode sc = leg.stationCounts();
    double sum = 0;
    for (String id : leg.stationIds()) sum += Js.num(Js.get(sc, id));
    return Math.max(sum, Js.num(Js.get(Logic.legSource(team, training), "passengerCount")));
  }

  public static double teamPax(JsonNode team, String dir) { return legPax(team, null, dir); }

  /* ------------------------------------------------------------ task generation */

  /**
   * A day's tasks: an outbound and a return task per training occurrence, split across buses
   * when a team is larger than the biggest vehicle.
   *
   * <p>One pass per direction, because the return leg may have its own stops, its own
   * headcounts and its own bus count. From there the two directions are independent: chaining
   * works on time and deadhead, and nothing pairs part #1 with part #1.
   */
  public static GenTasks genDayTasks(JsonNode state, int weekday, LocalDate weekMon) {
    GenTasks out = new GenTasks();
    List<Occurrence> occs = new ArrayList<>();
    for (Occurrence o : Logic.weekOccurrences(state, weekMon)) if (o.dayIdx == weekday) occs.add(o);

    JsonNode settings = Js.get(state, "settings");
    double n = Js.numOr(Js.get(settings, "arriveEarlyMin"), 10);
    double m = Js.numOr(Js.get(settings, "departAfterMin"), 10);
    double dwell = Js.numOr(Js.get(settings, "dwellMin"), 2);
    double maxSeats = maxSeats(state);

    /* A team can have several trainings on one day, at different venues. The bare team name
       would then produce two indistinguishable tasks; the venue is appended only in that case,
       so labels stay short on ordinary days. */
    Map<String, Integer> perTeam = new LinkedHashMap<>();
    for (Occurrence o : occs) {
      String tid = Js.str(Js.get(o.training, "teamId"));
      perTeam.merge(tid, 1, Integer::sum);
    }

    for (Occurrence o : occs) {
      JsonNode t = o.training;
      JsonNode team = Js.byId(Js.get(state, "teams"), Js.str(Js.get(t, "teamId")));
      if (team == null) continue;
      String suffix = "weekly".equals(Js.str(Js.get(t, "type"))) ? Integer.toString(weekday) : "x";
      String teamName = Js.s(Js.get(team, "name"));
      Integer count = perTeam.get(Js.str(Js.get(t, "teamId")));
      String venueId = Js.str(Js.get(t, "venueId"));
      String teamLabel = count != null && count > 1
          ? teamName + " · " + Geo.locName(state, venueId) : teamName;

      for (String dir : new String[] { "oda", "vissza" }) {
        Logic.Leg leg = Logic.legFor(team, t, dir);
        String dirLabel = "oda".equals(dir) ? "ODA" : "VISSZA";
        String who = leg.isOverride() ? teamLabel + " · " + dirLabel : teamLabel;

        List<String> listed = new ArrayList<>();
        for (String id : leg.stationIds())
          if (Js.byId(Js.get(state, "stations"), id) != null) listed.add(id);
        if (listed.isEmpty()) {
          out.skipped.add(who + ": nincs állomás rendelve, ezért nem készült " + dirLabel + " feladat.");
          continue;
        }
        JsonNode sc = leg.stationCounts();
        Counter cnt = sid -> Js.num(Js.get(sc, sid));

        /* ADR-23: an explicit 0 means "no need to go here" and the stop drops out. An EMPTY
           field means "not filled in yet" and must NOT, or a half-filled breakdown leaves
           children behind. The editor stores a cleared field as "" and a typed zero as a
           number, which is the only reason the two can be told apart here. */
        List<String> st = new ArrayList<>();
        for (String sid : listed) {
          JsonNode v = Js.get(sc, sid);
          boolean zeroed = !Js.nullish(v) && !(v.isTextual() && v.textValue().isEmpty()) && Js.num(v) == 0;
          if (!zeroed) st.add(sid);
        }
        if (st.isEmpty()) {
          out.skipped.add(who + ": minden megállónál 0 fő szerepel, ezért nem készült " + dirLabel + " feladat.");
          continue;
        }

        /* Zero passengers means there is nobody to carry. This used to produce a task anyway,
           so the optimizer put a driver and a bus on an empty ride, call-out fee included. */
        double pax = legPax(team, t, dir);
        if (pax == 0) {
          out.skipped.add(who + ": nincs megadva létszám (se megállónként, se összesen), ezért nem készült "
              + dirLabel + " feladat. Add meg a létszámot a csapatnál vagy az edzésnél.");
          continue;
        }

        List<List<String>> bins = maxSeats > 0 && pax > maxSeats
            ? splitStationsByCapacity(st, cnt, maxSeats) : null;
        if (bins != null && bins.size() > 1) {
          out.skipped.add(who + ": a " + Js.numStr(pax) + " fős létszám meghaladja a legnagyobb jármű férőhelyét ("
              + Js.numStr(maxSeats) + " fő), ezért " + bins.size() + " buszra bontva, megállónként.");
          for (int k = 0; k < bins.size(); k++)
            out.tasks.add(mkTask(state, t, team, dir, teamLabel, dirLabel, suffix, venueId,
                bins.get(k), k + 1, bins.size(), cnt, pax, n, m, dwell));
        } else {
          if (maxSeats > 0 && pax > maxSeats) {
            List<String> big = new ArrayList<>();
            for (String sid : st) if (cnt.count(sid) > maxSeats) big.add(sid);
            if (!big.isEmpty()) {
              List<String> parts = new ArrayList<>();
              for (String sid : big)
                parts.add(Geo.locName(state, sid) + " (" + Js.numStr(cnt.count(sid)) + " fő)");
              out.skipped.add(who + ": megállónként sem osztható — " + String.join(", ", parts)
                  + " önmagában több, mint a legnagyobb jármű (" + Js.numStr(maxSeats) + " fő).");
            } else {
              boolean any = false;
              for (String sid : st) if (cnt.count(sid) > 0) { any = true; break; }
              if (!any)
                out.skipped.add(who + ": a " + Js.numStr(pax) + " fő meghaladja a legnagyobb jármű férőhelyét ("
                    + Js.numStr(maxSeats) + " fő), de nincs megállónkénti létszámbontás, ezért nem osztható "
                    + "buszokra — add meg a megállónkénti létszámokat a felosztáshoz.");
            }
          }
          out.tasks.add(mkTask(state, t, team, dir, teamLabel, dirLabel, suffix, venueId,
              st, null, 0, cnt, pax, n, m, dwell));
        }
      }
    }
    out.tasks.sort((a, b) -> {
      int c = Js.sign(a.start - b.start);
      return c != 0 ? c : Js.sign(a.end - b.end);
    });
    return out;
  }

  /** One direction's task over a subset of stops. {@code idx} null means the whole team on one bus. */
  private static Task mkTask(JsonNode state, JsonNode t, JsonNode team, String dir,
                             String teamLabel, String dirLabel, String suffix, String venueId,
                             List<String> subset, Integer idx, int count, Counter cnt,
                             double pax, double n, double m, double dwell) {
    List<String> order = legRouteOrder(state, team, t, venueId, dir, subset);
    boolean split = idx != null;
    String tag = split ? "#" + idx : "";
    String name = teamLabel + " · " + dirLabel + (split ? " (" + idx + "/" + count + ")" : "");

    Task task = new Task();
    task.id = Js.s(Js.get(t, "id")) + ":" + suffix + ":" + dir + tag;
    task.dir = dir;
    task.teamId = Js.str(Js.get(team, "id"));
    task.trainingId = Js.str(Js.get(t, "id"));
    task.label = name;
    if (split) {
      double sum = 0;
      for (String sid : order) sum += cnt.count(sid);
      task.pax = sum;
    } else {
      task.pax = pax;
    }
    for (String sid : order) {
      double c = cnt.count(sid);
      if (c > 0) task.breakdown.add(new Breakdown(sid, c));
    }

    if ("oda".equals(dir)) {
      // `timeToMin(t.start) - N`: a missing time coerces to 0 in JavaScript rather than
      // throwing, and the schedule then shows an absurd hour instead of crashing the render.
      double arriveBy = Js.nz(DateTimes.timeToMin(Js.str(Js.get(t, "start")))) - n;
      PlanResult op = planOda(state, order, venueId, arriveBy, dwell);
      task.from = order.isEmpty() ? null : order.get(0);
      task.to = venueId;
      task.start = op.start;
      task.end = op.end;
      for (PlanStop s : op.stops) task.plan.add(s.withCount(cnt.count(s.stationId)));
      task.venueTime = op.venueArr;
      return task;
    }
    double departAt = Js.nz(DateTimes.timeToMin(Js.str(Js.get(t, "end")))) + m;
    PlanResult vp = planVissza(state, order, venueId, departAt, dwell);
    task.from = venueId;
    task.to = order.isEmpty() ? null : order.get(order.size() - 1);
    task.start = vp.start;
    task.end = vp.end;
    for (PlanStop s : vp.stops) task.plan.add(s.withCount(cnt.count(s.stationId)));
    task.venueTime = vp.venueDep;
    return task;
  }

  private static double maxSeats(JsonNode state) {
    double max = 0;
    for (JsonNode v : Js.arr(Js.get(state, "vehicles"))) max = Math.max(max, Js.num(Js.get(v, "seats")));
    return max;
  }

  /* ------------------------------------------------------------- availability */

  /**
   * Is the driver available across the whole span on this weekday?
   *
   * <p>Touching or overlapping windows MERGE: 15:00-17:00 plus 17:00-19:00 together cover a
   * 15:00-19:00 shift. A single window used to have to contain the span on its own, so a
   * driver like that dropped out of the day with no explanation. Incomplete windows are
   * ignored rather than making the driver unavailable all day.
   */
  public static boolean driverAvailableFor(JsonNode driver, int weekday, double startMin, double endMin) {
    List<JsonNode> ws = Js.arr(Js.get(driver, "availability"));
    if (ws.isEmpty()) return true;        // nothing specified means available at any time
    List<double[]> spans = new ArrayList<>();
    for (JsonNode w : ws) {
      boolean onDay = false;
      for (JsonNode d : Js.arr(Js.get(w, "days"))) if (Js.num(d) == weekday) { onDay = true; break; }
      if (!onDay) continue;
      Double a = DateTimes.timeToMin(Js.str(Js.get(w, "start")));
      Double b = DateTimes.timeToMin(Js.str(Js.get(w, "end")));
      if (a == null || b == null || !(b > a)) continue;
      spans.add(new double[] { a, b });
    }
    if (spans.isEmpty()) return false;
    spans.sort((x, y) -> Js.sign(x[0] - y[0]));
    double lo = spans.get(0)[0], hi = spans.get(0)[1];
    for (int i = 1; i < spans.size(); i++) {
      double a = spans.get(i)[0], b = spans.get(i)[1];
      if (a <= hi) { hi = Math.max(hi, b); continue; }
      if (lo <= startMin && endMin <= hi) return true;
      lo = a; hi = b;
    }
    return lo <= startMin && endMin <= hi;
  }

  /* -------------------------------------------------------------------- chains */

  public static Chain mkChain(JsonNode state, List<Task> ts) { return mkChain(state, ts, null); }

  /**
   * Chain view model: ordered tasks plus the links between them.
   *
   * <p>{@code extra} is the JavaScript object spread: it carries a skeleton chain's identity
   * (id, driver, vehicle, the locked flag) into the new chain, and is then overwritten on the
   * computed fields.
   */
  public static Chain mkChain(JsonNode state, List<Task> ts, Chain extra) {
    List<Task> tasks = new ArrayList<>(ts);
    tasks.sort((a, b) -> Js.sign(a.start - b.start));
    Chain c = extra == null ? new Chain() : extra.copy();
    c.tasks = tasks;
    c.links = new ArrayList<>();
    for (int i = 0; i < tasks.size() - 1; i++) {
      Task a = tasks.get(i), b = tasks.get(i + 1);
      double dead = Geo.legMin(state, a.to, b.from);
      double gap = b.start - a.end;
      Link l = new Link();
      l.a = a; l.b = b; l.dead = dead;
      l.idle = Math.max(0, gap - dead);
      l.infeasible = gap < dead;
      l.shortBy = dead - gap;
      c.links.add(l);
    }
    /* A chain ends at the LATEST finish, not at the finish of whichever task starts last. A
       nested task would otherwise shorten the chain, breaking the availability check, the
       clash detection and the paid-time calculation all at once. */
    double start = Double.POSITIVE_INFINITY, end = Double.NEGATIVE_INFINITY, pax = Double.NEGATIVE_INFINITY;
    for (Task t : tasks) {
      start = Math.min(start, t.start);
      end = Math.max(end, t.end);
      pax = Math.max(pax, t.pax);
    }
    c.start = start; c.end = end; c.maxPax = pax;
    return c;
  }

  public static String chainFrom(Chain c) { return c.tasks.get(0).from; }
  public static String chainTo(Chain c) { return c.tasks.get(c.tasks.size() - 1).to; }

  public static Use chainUse(Chain c, String driverId, String vehicleId) {
    return new Use(driverId, vehicleId, c.start, c.end, chainFrom(c), chainTo(c));
  }

  /**
   * Minimum-cost flow for chaining, as successive shortest paths over a bipartite graph.
   *
   * <p>Flow is pushed only along paths whose total cost is negative, so it chains exactly as
   * long as chaining is cheaper. The loop is bounded at {@code n} augmenting paths: without
   * that bound a degenerate residual graph spins forever.
   */
  public static List<List<Integer>> minCostChains(int n, List<double[]> edges) {
    int S = 2 * n, T = 2 * n + 1, NN = 2 * n + 2;
    /* The edge list is split in two: {target, capacity, nextEdgeIndex} as ints, and the cost
       as a double alongside. Keeping them apart lets capacity stay integral while the cost
       carries the fractional wage, which is what the original's single object does for free. */
    List<int[]> gv = new ArrayList<>();
    List<Double> gc = new ArrayList<>();
    int[] head = new int[NN];
    Arrays.fill(head, -1);

    for (int i = 0; i < n; i++) {
      addEdge(gv, gc, head, S, i, 1, 0);
      addEdge(gv, gc, head, n + i, T, 1, 0);
    }
    for (double[] e : edges) addEdge(gv, gc, head, (int) e[0], n + (int) e[1], 1, e[2]);

    for (int guard = 0; guard <= n; guard++) {
      double[] dist = new double[NN];
      boolean[] inq = new boolean[NN];
      int[] pre = new int[NN];
      Arrays.fill(dist, Double.POSITIVE_INFINITY);
      Arrays.fill(pre, -1);
      dist[S] = 0;
      // A plain FIFO queue, matching `q.shift()` / `q.push()`: which equal-cost path is found
      // first depends on this order, and so does the schedule that comes out.
      Deque<Integer> q = new ArrayDeque<>();
      q.addLast(S);
      inq[S] = true;
      while (!q.isEmpty()) {
        int u = q.pollFirst();
        inq[u] = false;
        for (int ei = head[u]; ei != -1; ei = gv.get(ei)[2]) {
          int[] e = gv.get(ei);
          double cost = gc.get(ei);
          if (e[1] > 0 && dist[u] + cost < dist[e[0]] - 1e-9) {
            dist[e[0]] = dist[u] + cost;
            pre[e[0]] = ei;
            if (!inq[e[0]]) { inq[e[0]] = true; q.addLast(e[0]); }
          }
        }
      }
      if (Double.isInfinite(dist[T]) || dist[T] >= -1e-9) break;
      int v = T;
      while (v != S) {
        int ei = pre[v];
        gv.get(ei)[1] -= 1;
        gv.get(ei ^ 1)[1] += 1;
        v = gv.get(ei ^ 1)[0];
      }
    }

    int[] succ = new int[n], pred = new int[n];
    Arrays.fill(succ, -1);
    Arrays.fill(pred, -1);
    for (int u = 0; u < n; u++)
      for (int ei = head[u]; ei != -1; ei = gv.get(ei)[2]) {
        int[] e = gv.get(ei);
        if (ei % 2 == 0 && e[0] >= n && e[0] < 2 * n && e[1] == 0) {
          succ[u] = e[0] - n;
          pred[e[0] - n] = u;
        }
      }

    /* Every task must land in EXACTLY ONE chain. If succ/pred closed into a cycle (possible
       with degenerate task windows), the old rule of "only pred === -1 starts a chain" made
       every task in that cycle vanish: in no chain, and not among the uncovered either. */
    List<List<Integer>> chains = new ArrayList<>();
    boolean[] seen = new boolean[n];
    for (int i = 0; i < n; i++) if (pred[i] == -1) walk(i, succ, seen, chains);
    for (int i = 0; i < n; i++) if (!seen[i]) walk(i, succ, seen, chains);   // left inside a cycle
    return chains;
  }

  private static void walk(int startIdx, int[] succ, boolean[] seen, List<List<Integer>> chains) {
    List<Integer> seq = new ArrayList<>();
    int c = startIdx;
    while (c != -1 && !seen[c]) { seen[c] = true; seq.add(c); c = succ[c]; }
    if (!seq.isEmpty()) chains.add(seq);
  }

  private static void addEdge(List<int[]> gv, List<Double> gc, int[] head,
                             int u, int v, int cap, double cost) {
    gv.add(new int[] { v, cap, head[u] });
    gc.add(cost);
    head[u] = gv.size() - 1;
    gv.add(new int[] { u, 0, head[v] });
    gc.add(-cost);
    head[v] = gv.size() - 1;
  }

  /* ----------------------------------------------------------------- the cost */

  /**
   * A chain's DEPOT-TO-DEPOT span (ADR-14): the driver starts work on leaving the depot and
   * finishes on getting back. With no depot the span is the tasks' own, exactly as paid time
   * was measured before depots existed (E8).
   */
  public static Span spanOf(JsonNode state, Use u) {
    String base = Logic.baseOf(state, u.vehicleId);
    if (base == null) return new Span(u.start, u.end);
    return new Span(u.start - Geo.legMin(state, base, u.from), u.end + Geo.legMin(state, u.to, base));
  }

  /**
   * A driver's shifts: overlapping depot-to-depot spans merge into ONE.
   *
   * <p>This is where "can the driver go home between two rides" is decided, with no separate
   * rule. If there is no time to get home and back, the spans overlap, so they become one
   * shift — and the waiting at the venue is paid.
   */
  public static List<Span> mergeShifts(List<Span> spans) {
    List<Span> out = new ArrayList<>();
    List<Span> sorted = new ArrayList<>(spans);
    sorted.sort((a, b) -> Js.sign(a.start - b.start));
    for (Span s : sorted) {
      Span last = out.isEmpty() ? null : out.get(out.size() - 1);
      if (last != null && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else out.add(new Span(s.start, s.end));
    }
    return out;
  }

  /**
   * A driver's paid time and cost. The call-out fee is PER SHIFT, not per chain (I7): somebody
   * who could not go home in between did not turn out twice.
   */
  public static Pay driverPay(JsonNode state, JsonNode driver, List<Use> uses) {
    List<Span> spans = new ArrayList<>();
    for (Use u : uses) spans.add(spanOf(state, u));
    Pay pay = new Pay();
    pay.shifts = mergeShifts(spans);
    double minShift = Js.num(Js.get(driver, "minShiftMin"));
    double wage = Js.num(Js.get(driver, "wage"));
    double fee = Js.num(Js.get(Js.get(state, "settings"), "calloutFee"));
    for (Span sh : pay.shifts) {
      double p = Math.max(sh.end - sh.start, minShift);
      pay.paid += p;
      // Kept as written: (p / 60) * wage, not p * (wage / 60). Reassociating changes the
      // last bits, and the improvement loop accepts a merge only when the total strictly
      // falls — a one-forint difference flips that comparison and changes the schedule.
      pay.cost += fee + (p / 60) * wage;
    }
    return pay;
  }

  /** On-site waiting: time between two chains inside one shift, which the driver cannot go home for. */
  public static double onSiteWait(JsonNode state, List<Use> uses) {
    List<Use> us = new ArrayList<>(uses);
    us.sort((a, b) -> Js.sign(a.start - b.start));
    double w = 0;
    for (int i = 0; i < us.size() - 1; i++) {
      Use a = us.get(i), b = us.get(i + 1);
      if (spanOf(state, b).start <= spanOf(state, a).end) w += Math.max(0, b.start - a.end);
    }
    return w;
  }

  /**
   * Do two chains using the SAME resource clash? Not overlapping in time is not enough: the
   * bus also has to physically get there (I6).
   */
  public static boolean resourceClash(JsonNode state, Use u, Chain c) {
    if (u.start < c.end && c.start < u.end) return true;                                  // overlap
    if (u.end <= c.start) return u.end + Geo.legMin(state, u.to, chainFrom(c)) > c.start;  // u then c
    return c.end + Geo.legMin(state, chainTo(c), u.from) > u.start;                        // c then u
  }

  /* ------------------------------------------------------------- assignment */

  /** One chain's assignment, or the admission that it could not be covered. */
  public static final class Pick {
    public Chain chain;
    public String driverId;
    public String vehicleId;
    public boolean uncovered;

    Pick copy() {
      Pick p = new Pick();
      p.chain = chain; p.driverId = driverId; p.vehicleId = vehicleId; p.uncovered = uncovered;
      return p;
    }
  }

  public static final class Assignment {
    public List<Pick> picks = new ArrayList<>();
    public double cost;
    public boolean capped;
  }

  private static final int ITER_CAP = 30000;

  /**
   * Exact driver-and-vehicle assignment: backtracking search with cost-bound pruning.
   *
   * <p>It stops after {@value #ITER_CAP} iterations and SAYS so (ADR-24) rather than
   * pretending it found an optimum.
   */
  public static Assignment assignResources(JsonNode state, int weekday,
                                           List<Chain> freeChains, List<Use> fixedUse) {
    List<Chain> chains = new ArrayList<>(freeChains);
    chains.sort((a, b) -> Js.sign(a.start - b.start));
    Assignment result = new Assignment();
    Search s = new Search(state, weekday, chains);
    s.rec(0, new ArrayList<>(fixedUse), new ArrayList<>(), 0);
    result.capped = s.capped;
    if (s.best != null) {
      result.picks = s.best;
      result.cost = s.bestCost;
    } else {
      result.cost = chains.isEmpty() ? 0 : 1e9;
    }
    return result;
  }

  /** The search state, held in an object because the recursion mutates it. */
  private static final class Search {
    final JsonNode state;
    final int weekday;
    final List<Chain> chains;
    List<Pick> best;
    double bestCost;
    int iter;
    boolean capped;

    Search(JsonNode state, int weekday, List<Chain> chains) {
      this.state = state; this.weekday = weekday; this.chains = chains;
    }

    void rec(int i, List<Use> used, List<Pick> acc, double cost) {
      if (iter++ > ITER_CAP) { capped = true; return; }
      if (best != null && cost >= bestCost) return;
      if (i == chains.size()) {
        List<Pick> snapshot = new ArrayList<>();
        for (Pick p : acc) snapshot.add(p.copy());
        best = snapshot;
        bestCost = cost;
        return;
      }
      Chain c = chains.get(i);
      record Opt(JsonNode d, JsonNode v, double cost, double seats) {}
      List<Opt> opts = new ArrayList<>();
      /* The vignette is as hard a constraint as capacity (ADR-15): a bus without one is never
         considered for a chain going somewhere that requires it, so the optimizer cannot
         propose a bad plan and there is nothing to undo by hand. */
      boolean needsV = Logic.chainNeedsVignette(state, c);
      for (JsonNode d : Js.arr(Js.get(state, "drivers"))) {
        if (!driverAvailableFor(d, weekday, c.start, c.end)) continue;
        String did = Js.str(Js.get(d, "id"));
        if (clashes(used, "driver", did, c)) continue;
        for (JsonNode v : Js.arr(Js.get(state, "vehicles"))) {
          double seats = Js.num(Js.get(v, "seats"));
          if (seats < c.maxPax) continue;
          if (needsV && !Js.truthy(Js.get(v, "hasVignette"))) continue;
          String vid = Js.str(Js.get(v, "id"));
          if (clashes(used, "vehicle", vid, c)) continue;
          /* A chain's price is the INCREMENT to that driver's cost for the day. Attaching it
             to a shift they already have costs only the extra paid time, with no second
             call-out fee. */
          List<Use> mine = new ArrayList<>();
          for (Use u : used) if (did.equals(u.driverId)) mine.add(u);
          List<Use> plus = new ArrayList<>(mine);
          plus.add(chainUse(c, did, vid));
          double delta = driverPay(state, d, plus).cost - driverPay(state, d, mine).cost;
          // The one soft constraint: a forint penalty for putting a driver on a bus other
          // than their usual one (ADR-15).
          JsonNode pref = Js.get(d, "preferredVehicleId");
          boolean offPreferred = Js.truthy(pref) && !vid.equals(pref.asText());
          double bias = offPreferred ? Js.num(Js.get(Js.get(state, "settings"), "preferredBias")) : 0;
          opts.add(new Opt(d, v, delta + bias, seats));
        }
      }
      opts.sort((x, y) -> {
        int k = Js.sign(x.cost() - y.cost());
        return k != 0 ? k : Js.sign(x.seats() - y.seats());
      });
      for (Opt o : opts) {
        String did = Js.str(Js.get(o.d(), "id")), vid = Js.str(Js.get(o.v(), "id"));
        used.add(chainUse(c, did, vid));
        Pick p = new Pick();
        p.chain = c; p.driverId = did; p.vehicleId = vid;
        acc.add(p);
        rec(i + 1, used, acc, cost + o.cost());
        acc.remove(acc.size() - 1);
        used.remove(used.size() - 1);
      }
      if (opts.isEmpty()) {
        Pick p = new Pick();
        p.chain = c;
        p.uncovered = true;
        acc.add(p);
        rec(i + 1, used, acc, cost + 1e7);
        acc.remove(acc.size() - 1);
      }
    }

    private boolean clashes(List<Use> used, String kind, String id, Chain c) {
      for (Use u : used) {
        String uid = "driver".equals(kind) ? u.driverId : u.vehicleId;
        if (id != null && id.equals(uid) && resourceClash(state, u, c)) return true;
      }
      return false;
    }
  }

  public static List<String> contentionReasons(JsonNode state, int weekday, Task t) {
    int av = 0;
    for (JsonNode d : Js.arr(Js.get(state, "drivers")))
      if (driverAvailableFor(d, weekday, t.start, t.end)) av++;
    boolean needsV = Logic.taskNeedsVignette(state, t);
    int bigV = 0;
    for (JsonNode v : Js.arr(Js.get(state, "vehicles")))
      if (Js.num(Js.get(v, "seats")) >= t.pax && (!needsV || Js.truthy(Js.get(v, "hasVignette")))) bigV++;
    String what = needsV ? "elegendő férőhelyű, országos matricás jármű" : "elegendő férőhelyű jármű";
    return List.of("Erőforrás-ütközés: " + DAYS[weekday] + " " + DateTimes.minToTime(t.start) + "–"
        + DateTimes.minToTime(t.end) + " között minden alkalmas erőforrás foglalt (elérhető sofőr: "
        + av + ", " + what + ": " + bigV + ").");
  }

  /* ------------------------------------------------------------------- resolve */

  /** Resolve the saved schedule into a view model, with live clash detection. */
  public static DayResult resolveDay(JsonNode state, int weekday, LocalDate weekMon) {
    GenTasks gen = genDayTasks(state, weekday, weekMon);
    Map<String, Task> tmap = new LinkedHashMap<>();
    for (Task t : gen.tasks) tmap.put(t.id, t);
    Set<String> assigned = new LinkedHashSet<>();
    List<Chain> chains = new ArrayList<>();
    int droppedChains = 0;

    JsonNode dayAsg = Js.get(Js.get(state, "assignments"), Integer.toString(weekday));
    for (JsonNode ch : Js.arr(Js.get(dayAsg, "chains"))) {
      List<Task> ts = new ArrayList<>();
      for (JsonNode x : Js.arr(Js.get(ch, "taskIds"))) {
        Task t = tmap.get(Js.str(Js.get(x, "id")));
        if (t != null) ts.add(t.withLocked(Js.truthy(Js.get(x, "locked"))));
      }
      /* R1: a chain's task ids can go stale, because the id contains the split index. The
         chain would then disappear with its driver, vehicle and locks — silently. Count them
         so the caller can say so, because to a user this reads as "my schedule vanished". */
      if (ts.isEmpty()) { droppedChains++; continue; }
      for (Task t : ts) assigned.add(t.id);

      Chain extra = new Chain();
      extra.id = Js.strOrNull(Js.get(ch, "id"));
      extra.driverId = Js.strOrNull(Js.get(ch, "driverId"));
      extra.vehicleId = Js.strOrNull(Js.get(ch, "vehicleId"));
      Chain c = mkChain(state, ts, extra);
      c.driver = Js.byId(Js.get(state, "drivers"), c.driverId);
      c.vehicle = Js.byId(Js.get(state, "vehicles"), c.vehicleId);
      c.issues = new ArrayList<>();
      for (Link l : c.links)
        if (l.infeasible)
          c.issues.add("Szoros átkötés: " + l.a.label + " → " + l.b.label + " — "
              + Js.numStr(l.shortBy) + " perccel több idő kellene az üresjárathoz.");
      if (c.driver != null && !driverAvailableFor(c.driver, weekday, c.start, c.end))
        c.issues.add(Js.s(Js.get(c.driver, "name")) + " nem érhető el a teljes "
            + DateTimes.minToTime(c.start) + "–" + DateTimes.minToTime(c.end) + " sávban.");
      if (c.vehicle != null && c.maxPax > Js.num(Js.get(c.vehicle, "seats")))
        c.issues.add("A létszám (" + Js.numStr(c.maxPax) + " fő) meghaladja a(z) "
            + Js.s(Js.get(c.vehicle, "plate")) + " férőhelyét (" + Js.s(Js.get(c.vehicle, "seats")) + ").");
      /* A bus without a vignette can be assigned by hand, and one can survive in an older
         saved schedule where the venue only became vignette-only afterwards. We do not
         silently fix it, but we do say so. */
      if (c.vehicle != null && !Js.truthy(Js.get(c.vehicle, "hasVignette")) && Logic.chainNeedsVignette(state, c))
        c.issues.add("A(z) " + Js.s(Js.get(c.vehicle, "plate")) + " nincs országos matricával, de a lánc ide megy: "
            + String.join(", ", Logic.vignetteVenues(state, c)) + ".");
      chains.add(c);
    }

    for (int i = 0; i < chains.size(); i++)
      for (int j = i + 1; j < chains.size(); j++) {
        Chain A = chains.get(i), B = chains.get(j);
        if (!(A.start < B.end && B.start < A.end)) continue;
        if (A.driverId != null && A.driverId.equals(B.driverId)) {
          String m = "Sofőrütközés: " + nameOr(A.driver, "?") + " egyszerre két láncban van.";
          A.issues.add(m); B.issues.add(m);
        }
        if (A.vehicleId != null && A.vehicleId.equals(B.vehicleId)) {
          String m = "Járműütközés: " + plateOr(A.vehicle, "?") + " egyszerre két láncban van.";
          A.issues.add(m); B.issues.add(m);
        }
      }

    /* The same resource in two chains that do NOT overlap in time is still impossible when
       there is no room for the deadhead between them. Nothing used to flag that. */
    for (int i = 0; i < chains.size(); i++)
      for (int j = 0; j < chains.size(); j++) {
        if (i == j) continue;
        Chain A = chains.get(i), B = chains.get(j);
        if (A.end > B.start) continue;                       // only the A → B direction
        boolean sameDriver = A.driverId != null && A.driverId.equals(B.driverId);
        boolean sameVehicle = A.vehicleId != null && A.vehicleId.equals(B.vehicleId);
        if (!(sameDriver || sameVehicle)) continue;
        double dead = Geo.legMin(state, chainTo(A), chainFrom(B));
        if (A.end + dead <= B.start) continue;
        String who = java.util.Objects.equals(A.driverId, B.driverId)
            ? nameOr(A.driver, "A sofőr") : plateOr(A.vehicle, "A jármű");
        String m = "Nem érhető át: " + who + " " + DateTimes.minToTime(A.end) + "-kor végez itt: "
            + Geo.locName(state, chainTo(A)) + ", de " + DateTimes.minToTime(B.start)
            + "-kor már itt kellene lennie: " + Geo.locName(state, chainFrom(B))
            + " (" + Js.numStr(dead) + " p üresjárat, " + Js.numStr(B.start - A.end) + " p áll rendelkezésre).";
        A.issues.add(m); B.issues.add(m);
      }

    chains.sort((a, b) -> Js.sign(a.start - b.start));

    DayResult out = new DayResult();
    out.tasks = gen.tasks;
    out.chains = chains;
    for (Task t : gen.tasks) if (!assigned.contains(t.id)) out.unassigned.add(t);
    out.skipped = new ArrayList<>(gen.skipped);
    if (droppedChains > 0)
      out.skipped.add(droppedChains + " korábban mentett lánc feladatai már nem léteznek ebben a formában "
          + "(valószínűleg megváltoztak a megállók vagy a létszámok), ezért kikerültek a beosztásból. "
          + "Futtasd újra az optimalizálást.");
    return out;
  }

  private static String nameOr(JsonNode driver, String fallback) {
    if (driver == null) return fallback;
    JsonNode n = Js.get(driver, "name");
    return Js.truthy(n) ? n.asText() : fallback;
  }

  private static String plateOr(JsonNode vehicle, String fallback) {
    if (vehicle == null) return fallback;
    JsonNode n = Js.get(vehicle, "plate");
    return Js.truthy(n) ? n.asText() : fallback;
  }

  /**
   * The day's totals, per DRIVER rather than per chain: paid time is the depot-to-depot shift,
   * and two chains can fall inside one. Summing per chain dropped the waiting in between and
   * counted the call-out fee twice.
   */
  public static DayStats dayStats(JsonNode state, List<Chain> chains) {
    double paid = 0, cost = 0, dead = 0, idle = 0;
    Set<String> ds = new LinkedHashSet<>();
    Map<String, List<Use>> byDriver = new LinkedHashMap<>();
    for (Chain c : chains) {
      for (Link l : c.links) { dead += l.dead; idle += l.idle; }
      // A call-out fee is only due when somebody actually turns out. A chain with no driver
      // used to carry one anyway, inflating the proposal's "before" column.
      if (c.driverId == null || c.driverId.isEmpty()) { paid += Math.max(c.end - c.start, 0); continue; }
      ds.add(c.driverId);
      byDriver.computeIfAbsent(c.driverId, k -> new ArrayList<>()).add(chainUse(c, c.driverId, c.vehicleId));
    }
    for (Map.Entry<String, List<Use>> e : byDriver.entrySet()) {
      Pay r = driverPay(state, Js.byId(Js.get(state, "drivers"), e.getKey()), e.getValue());
      paid += r.paid;
      cost += r.cost;
      idle += onSiteWait(state, e.getValue());
    }
    DayStats s = new DayStats();
    s.drivers = ds.size();
    s.chains = chains.size();
    s.paidMin = paid;
    s.dead = dead;
    s.idle = idle;
    s.cost = Js.round(cost);
    return s;
  }

  /* --------------------------------------------------------------------- rides */

  /**
   * Turn the schedule's chains into rides, one per task, with the times from the task's own
   * timetable (ADR-17).
   *
   * <p>Outbound a stop's time is the DEPARTURE, after boarding; on the return leg it is the
   * ARRIVAL, when they get off. Generation used to write the arrival in both directions, so
   * the week screen's clash window was consistently off by the dwell time.
   */
  public static List<Ride> ridesFromChains(JsonNode state, int weekday, List<Chain> chains) {
    List<Ride> out = new ArrayList<>();
    for (Chain ch : chains == null ? List.<Chain>of() : chains) {
      for (Task t : ch.tasks) {
        JsonNode tr = Js.byId(Js.get(state, "trainings"), t.trainingId);
        if (tr == null) continue;
        boolean weekly = "weekly".equals(Js.str(Js.get(tr, "type")));
        Ride r = new Ride();
        r.id = Ids.uid();
        r.trainingId = t.trainingId;
        r.day = weekly ? weekday : null;
        r.date = "once".equals(Js.str(Js.get(tr, "type"))) ? Js.strOrNull(Js.get(tr, "date")) : null;
        r.vehicleId = ch.vehicleId == null ? "" : ch.vehicleId;
        r.driverId = ch.driverId == null ? "" : ch.driverId;
        r.dir = t.dir;
        r.source = "schedule";
        for (PlanStop s : t.plan) {
          RideStop rs = new RideStop();
          rs.id = Ids.uid();
          rs.stationId = s.stationId;
          rs.time = DateTimes.minToTime("vissza".equals(t.dir) ? s.arr : s.dep);
          double c = s.count == null ? 0 : s.count;
          rs.count = c > 0 ? (Object) c : "";
          r.stops.add(rs);
        }
        out.add(r);
      }
    }
    return out;
  }

  /** True when this ride belongs to the tasks affected on this weekday. */
  public static boolean rideBelongsToDay(JsonNode state, JsonNode ride, int weekday,
                                         Set<String> affectedTrainingIds) {
    String tid = Js.str(Js.get(ride, "trainingId"));
    if (!affectedTrainingIds.contains(tid)) return false;
    JsonNode tr = Js.byId(Js.get(state, "trainings"), tid);
    if (tr == null) return false;
    return "weekly".equals(Js.str(Js.get(tr, "type"))) ? Js.num(Js.get(ride, "day")) == weekday : true;
  }

  /* ------------------------------------------------------------- the entry point */

  /** The entry point for optimising one day. */
  public static OptimizeResult optimizeDay(JsonNode state, int weekday, LocalDate weekMon) {
    DayResult cur = resolveDay(state, weekday, weekMon);
    List<String> notes = new ArrayList<>(cur.skipped);
    OptimizeResult out = new OptimizeResult();
    if (cur.tasks.isEmpty()) {
      out.empty = true;
      out.notes = notes;
      return out;
    }
    double maxSeats = maxSeats(state);

    // Locked tasks become skeleton chains carrying their driver and vehicle. Untouchable.
    record Group(String driverId, String vehicleId, List<Task> tasks) {}
    Map<String, Group> lockedGroups = new LinkedHashMap<>();
    for (Chain ch : cur.chains) {
      List<Task> lt = new ArrayList<>();
      for (Task t : ch.tasks) if (Boolean.TRUE.equals(t.locked)) lt.add(t);
      if (lt.isEmpty()) continue;
      /* Grouped by chain id, NOT by driver|vehicle. The latter fused two deliberately separate
         shifts (a morning and an evening one with the same driver and bus) into a single
         07:00-20:00 chain with one call-out fee, making both the cost estimate and the printed
         schedule wrong. */
      String k = ch.id != null && !ch.id.isEmpty() ? ch.id : ch.driverId + "|" + ch.vehicleId;
      lockedGroups.computeIfAbsent(k, x -> new Group(ch.driverId, ch.vehicleId, new ArrayList<>()))
          .tasks().addAll(lt);
    }
    Set<String> lockedIds = new LinkedHashSet<>();
    for (Group g : lockedGroups.values()) for (Task t : g.tasks()) lockedIds.add(t.id);

    // Hard feasibility of the free tasks, so an impossible one gets a precise reason (ADR-24).
    List<Uncovered> uncovered = new ArrayList<>();
    List<Task> free = new ArrayList<>();
    for (Task t : cur.tasks) {
      if (lockedIds.contains(t.id)) continue;
      List<String> reasons = new ArrayList<>();
      if (t.pax > maxSeats)
        reasons.add("Nincs jármű elegendő férőhellyel: " + Js.numStr(t.pax)
            + " fő kellene, a legnagyobb jármű " + Js.numStr(maxSeats) + " férőhelyes.");
      if (Logic.taskNeedsVignette(state, t)) {
        boolean any = false;
        for (JsonNode v : Js.arr(Js.get(state, "vehicles")))
          if (Js.truthy(Js.get(v, "hasVignette")) && Js.num(Js.get(v, "seats")) >= t.pax) { any = true; break; }
        if (!any) {
          Chain one = new Chain();
          one.tasks = List.of(t);
          reasons.add("Nincs országos matricás jármű " + Js.numStr(t.pax) + " fővel: "
              + String.join(", ", Logic.vignetteVenues(state, one)) + " csak matricás autóval érhető el.");
        }
      }
      boolean anyDriver = false;
      for (JsonNode d : Js.arr(Js.get(state, "drivers")))
        if (driverAvailableFor(d, weekday, t.start, t.end)) { anyDriver = true; break; }
      if (!anyDriver)
        reasons.add("Egyik sofőr sem érhető el " + DAYS[weekday] + " " + DateTimes.minToTime(t.start)
            + "–" + DateTimes.minToTime(t.end) + " között.");
      if (!reasons.isEmpty()) uncovered.add(new Uncovered(t, reasons));
      else free.add(t);
    }

    List<Chain> skel = new ArrayList<>();
    for (Group g : lockedGroups.values()) {
      Chain extra = new Chain();
      extra.id = Ids.uid();
      extra.driverId = g.driverId();
      extra.vehicleId = g.vehicleId();
      extra.hasLocked = true;
      skel.add(mkChain(state, g.tasks(), extra));
    }

    // Phase 1: chaining by minimum-cost flow, gaps weighted by the average wage.
    double wageSum = 0;
    int wageCount = 0;
    for (JsonNode d : Js.arr(Js.get(state, "drivers"))) { wageSum += Js.num(Js.get(d, "wage")); wageCount++; }
    double avgWpm = (wageSum / (wageCount == 0 ? 1 : wageCount)) / 60;
    JsonNode homeBaseNode = Js.get(Js.get(state, "settings"), "defaultBaseId");
    String homeBase = Js.truthy(homeBaseNode) ? homeBaseNode.asText() : null;
    double fee = Js.num(Js.get(Js.get(state, "settings"), "calloutFee"));

    List<double[]> edges = new ArrayList<>();
    for (int a = 0; a < free.size(); a++)
      for (int b = 0; b < free.size(); b++) {
        if (a == b) continue;
        Task A = free.get(a), B = free.get(b);
        double dead = Geo.legMin(state, A.to, B.from);
        if (A.end + dead <= B.start) {
          /* If the driver cannot get home during the gap, that waiting is paid whether or not
             we chain, so the gap must not be charged against chaining. The vehicle — and so
             its depot — is not decided yet, so the club depot stands in here; assignResources
             computes the exact price. */
          double gap = B.start - A.end;
          boolean forced = homeBase != null
              && gap < Geo.legMin(state, A.to, homeBase) + Geo.legMin(state, homeBase, B.from);
          edges.add(new double[] { a, b, (forced ? 0 : Js.round(gap * avgWpm)) - fee });
        }
      }
    List<Chain> freeChains = new ArrayList<>();
    for (List<Integer> seq : minCostChains(free.size(), edges)) {
      List<Task> ts = new ArrayList<>();
      for (int i : seq) ts.add(free.get(i));
      freeChains.add(mkChain(state, ts));
    }

    // Phase 2 and 3: assignment at true cost, then a local-improvement loop that tries merges.
    Plan plan = new Plan();
    List<Chain> skl = skel, fre = freeChains;
    Eval ev = new Eval(state, weekday);
    plan = ev.evalPlan(skl, fre);
    /* The objective BEFORE improvement. The loop only accepts a trial that strictly lowers it,
       so it never increases. This is money plus an uncovered-task penalty — the true monetary
       cost alone can legitimately rise when improvement covers a previously uncovered task. */
    double objectiveBefore = plan.cost;

    for (int guard = 0; guard < 60; guard++) {
      boolean improved = false;
      outer:
      for (int i = 0; i < fre.size(); i++)
        for (int j = 0; j < fre.size(); j++) {
          if (i == j) continue;
          Chain A = fre.get(i), B = fre.get(j);
          if (A.end + Geo.legMin(state, A.tasks.get(A.tasks.size() - 1).to, B.tasks.get(0).from) > B.start) continue;
          List<Chain> trialF = new ArrayList<>();
          for (int k = 0; k < fre.size(); k++) if (k != i && k != j) trialF.add(fre.get(k));
          List<Task> merged = new ArrayList<>(A.tasks);
          merged.addAll(B.tasks);
          trialF.add(mkChain(state, merged));
          Plan t = ev.evalPlan(skl, trialF);
          if (t.cost < plan.cost - 0.5) { fre = trialF; plan = t; improved = true; break outer; }
        }

      if (!improved) {
        skmerge:
        for (int i = 0; i < fre.size(); i++)
          for (int k = 0; k < skl.size(); k++) {
            Chain F = fre.get(i), K = skl.get(k);
            JsonNode d = Js.byId(Js.get(state, "drivers"), K.driverId);
            JsonNode v = Js.byId(Js.get(state, "vehicles"), K.vehicleId);
            if (d == null || v == null) continue;
            boolean after = K.end + Geo.legMin(state, K.tasks.get(K.tasks.size() - 1).to, F.tasks.get(0).from) <= F.start;
            boolean before = F.end + Geo.legMin(state, F.tasks.get(F.tasks.size() - 1).to, K.tasks.get(0).from) <= K.start;
            if ((!after && !before) || Math.max(F.maxPax, K.maxPax) > Js.num(Js.get(v, "seats"))) continue;
            if (!driverAvailableFor(d, weekday, Math.min(K.start, F.start), Math.max(K.end, F.end))) continue;
            /* A skeleton chain's vehicle is fixed, so it cannot acquire a vignette: a task
               that needs one may only be appended to a bus that has one. */
            if (Logic.chainNeedsVignette(state, F) && !Js.truthy(Js.get(v, "hasVignette"))) continue;
            List<Chain> trialS = new ArrayList<>();
            for (int x = 0; x < skl.size(); x++) {
              if (x == k) {
                List<Task> merged = new ArrayList<>(skl.get(x).tasks);
                merged.addAll(F.tasks);
                trialS.add(mkChain(state, merged, skl.get(x)));
              } else {
                trialS.add(skl.get(x));
              }
            }
            List<Chain> trialF = new ArrayList<>();
            for (int x = 0; x < fre.size(); x++) if (x != i) trialF.add(fre.get(x));
            Plan t = ev.evalPlan(trialS, trialF);
            if (t.cost < plan.cost - 0.5) { skl = trialS; fre = trialF; plan = t; improved = true; break skmerge; }
          }
      }
      if (!improved) break;
    }

    if (ev.anyCapped)
      notes.add("A keresési tér nagy volt, a hozzárendelés a legjobb megtalált megoldás (heurisztikus).");

    List<Chain> result = new ArrayList<>(skl);
    for (Pick p : plan.asg.picks) {
      if (p.uncovered) {
        for (Task t : p.chain.tasks) uncovered.add(new Uncovered(t, contentionReasons(state, weekday, t)));
      } else {
        Chain c = p.chain.copy();
        c.driverId = p.driverId;
        c.vehicleId = p.vehicleId;
        result.add(c);
      }
    }
    result.sort((a, b) -> Js.sign(a.start - b.start));

    out.empty = false;
    out.chains = result;
    out.uncovered = uncovered;
    out.notes = notes;
    out.stats = dayStats(state, result);
    out.improve = new Improve();
    out.improve.before = objectiveBefore;
    out.improve.after = plan.cost;
    return out;
  }

  private static final class Plan {
    Assignment asg;
    double cost;
  }

  /** The plan evaluator: skeleton chains priced with the SAME formula assignResources uses. */
  private static final class Eval {
    final JsonNode state;
    final int weekday;
    boolean anyCapped;

    Eval(JsonNode state, int weekday) { this.state = state; this.weekday = weekday; }

    /**
     * A skeleton chain's price, the preferred-vehicle penalty included. Without that penalty
     * the improvement loop compared a biased cost against an unbiased one, so with the default
     * bias it saw a genuinely more expensive merge as an improvement — and the displayed daily
     * cost went UP after optimising. ADR-15's golden rule.
     */
    double skelCost(Chain c) {
      JsonNode d = Js.byId(Js.get(state, "drivers"), c.driverId);
      JsonNode pref = Js.get(d, "preferredVehicleId");
      boolean offPreferred = Js.truthy(pref) && !java.util.Objects.equals(c.vehicleId, pref.asText());
      double bias = offPreferred ? Js.num(Js.get(Js.get(state, "settings"), "preferredBias")) : 0;
      return driverPay(state, d, List.of(chainUse(c, c.driverId, c.vehicleId))).cost + bias;
    }

    Plan evalPlan(List<Chain> skl, List<Chain> fre) {
      List<Use> fixed = new ArrayList<>();
      for (Chain c : skl) fixed.add(chainUse(c, c.driverId, c.vehicleId));
      Assignment asg = assignResources(state, weekday, fre, fixed);
      if (asg.capped) anyCapped = true;
      Plan p = new Plan();
      p.asg = asg;
      double sum = 0;
      for (Chain c : skl) sum += skelCost(c);
      p.cost = sum + asg.cost;
      return p;
    }
  }
}
