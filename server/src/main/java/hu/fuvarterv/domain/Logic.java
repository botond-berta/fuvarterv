package hu.fuvarterv.domain;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static hu.fuvarterv.domain.Model.*;

/** Plates, occurrences, ride windows, legs, vignettes and delete guards, ported from
 *  {@code src/domain/logic.js}. */
public final class Logic {
  private Logic() {}

  private static final Pattern PLATE_STRIP = Pattern.compile("[^A-Z0-9]");
  private static final Pattern PLATE_SPLIT = Pattern.compile("^([A-Z]+)(\\d+)$");

  public static String normalizePlate(String raw) {
    String s = PLATE_STRIP.matcher((raw == null ? "" : raw).toUpperCase()).replaceAll("");
    Matcher m = PLATE_SPLIT.matcher(s);
    if (m.matches()) return m.group(1) + "-" + m.group(2);
    return s;
  }

  public static boolean plateExists(JsonNode state, String plate, String exceptId) {
    String p = normalizePlate(plate);
    for (JsonNode v : Js.arr(Js.get(state, "vehicles"))) {
      String id = Js.str(Js.get(v, "id"));
      if (id != null && id.equals(exceptId)) continue;
      if (normalizePlate(Js.str(Js.get(v, "plate"))).equals(p)) return true;
    }
    return false;
  }

  /**
   * Every occurrence of every training inside one week.
   *
   * <p>A one-off training with an unparseable date drops out rather than throwing. The
   * original relies on {@code Math.round(NaN)} failing the range test; here the null date
   * does the same job explicitly.
   */
  public static List<Occurrence> weekOccurrences(JsonNode state, LocalDate mon) {
    List<Occurrence> out = new ArrayList<>();
    for (JsonNode t : Js.arr(Js.get(state, "trainings"))) {
      if ("weekly".equals(Js.str(Js.get(t, "type")))) {
        for (JsonNode di : Js.arr(Js.get(t, "days"))) {
          int d = (int) Js.num(di);
          out.add(new Occurrence(t, d, DateTimes.toISO(DateTimes.addDays(mon, d))));
        }
      } else if (Js.truthy(Js.get(t, "date"))) {
        String iso = Js.str(Js.get(t, "date"));
        LocalDate d = DateTimes.parseISO(iso);
        if (d == null) continue;
        long diff = DateTimes.daysBetween(mon, d);
        if (diff >= 0 && diff < 7) out.add(new Occurrence(t, DateTimes.weekdayIdx(d), iso));
      }
    }
    // Stable, so occurrences that tie on day and start time keep the trainings' own order.
    out.sort(Comparator.comparingInt((Occurrence o) -> o.dayIdx)
        .thenComparing((a, b) -> Js.sign(startOf(a) - startOf(b))));
    return out;
  }

  private static double startOf(Occurrence o) {
    Double v = DateTimes.timeToMin(Js.str(Js.get(o.training, "start")));
    return v == null ? 0 : v;      // `?? 0` in the comparator, not in the data
  }

  /** One training session can have several rides: more than one bus carrying the team. */
  public static List<JsonNode> findRides(JsonNode state, JsonNode training, int dayIdx) {
    List<JsonNode> out = new ArrayList<>();
    String tid = Js.str(Js.get(training, "id"));
    boolean weekly = "weekly".equals(Js.str(Js.get(training, "type")));
    for (JsonNode r : Js.arr(Js.get(state, "rides"))) {
      if (tid == null || !tid.equals(Js.str(Js.get(r, "trainingId")))) continue;
      if (weekly && (int) Js.num(Js.get(r, "day")) != dayIdx) continue;
      out.add(r);
    }
    return out;
  }

  public static double venueDepartMin(JsonNode state, JsonNode training) {
    Double end = DateTimes.timeToMin(Js.str(Js.get(training, "end")));
    return (end == null ? 0 : end) + Js.numOr(Js.get(Js.get(state, "settings"), "departAfterMin"), 0);
  }

  /**
   * The window in which a ride occupies its driver and vehicle.
   *
   * <p>Outbound it runs from the first stop's time to the last stop plus the run to the
   * venue, so one bus can make several trips for the SAME training without showing a false
   * clash. Return runs from the venue departure to the last arrival.
   */
  public static double[] rideWindow(JsonNode state, JsonNode ride, JsonNode training) {
    List<JsonNode> stops = new ArrayList<>();
    for (JsonNode s : Js.arr(Js.get(ride, "stops")))
      if (DateTimes.timeToMin(Js.str(Js.get(s, "time"))) != null) stops.add(s);

    String dir = Js.truthy(Js.get(ride, "dir")) ? Js.str(Js.get(ride, "dir")) : "oda";
    if ("vissza".equals(dir)) {
      double dep = venueDepartMin(state, training);
      if (stops.isEmpty()) return new double[] { dep, dep + 1 };
      double last = Double.NEGATIVE_INFINITY;
      for (JsonNode s : stops) last = Math.max(last, DateTimes.timeToMin(Js.str(Js.get(s, "time"))));
      return new double[] { dep, Math.max(dep + 1, last) };
    }

    Double st = DateTimes.timeToMin(Js.str(Js.get(training, "start")));
    double startCap = st == null ? 0 : st;
    if (stops.isEmpty()) return new double[] { startCap, startCap };
    double first = Double.POSITIVE_INFINITY;
    for (JsonNode s : stops) first = Math.min(first, DateTimes.timeToMin(Js.str(Js.get(s, "time"))));
    // `reduce((a, b) => timeToMin(a.time) >= timeToMin(b.time) ? a : b)` keeps the FIRST of
    // equal times, so the tie-break is >= and not >.
    JsonNode last = stops.get(0);
    for (JsonNode s : stops)
      if (!(DateTimes.timeToMin(Js.str(Js.get(last, "time"))) >= DateTimes.timeToMin(Js.str(Js.get(s, "time")))))
        last = s;
    double end = DateTimes.timeToMin(Js.str(Js.get(last, "time")))
        + Geo.legMin(state, Js.str(Js.get(last, "stationId")), Js.str(Js.get(training, "venueId")));
    return new double[] { first, Math.max(first + 1, end) };
  }

  /**
   * Do two rides fall on the same day?
   *
   * <p>A one-off training with no date cannot be placed in the week at all.
   * {@code weekdayIdx(null)} used to throw from here, mid-render, taking the page down.
   */
  public static boolean occursOnSameDay(JsonNode rA, JsonNode tA, JsonNode rB, JsonNode tB) {
    boolean onceA = "once".equals(Js.str(Js.get(tA, "type")));
    boolean onceB = "once".equals(Js.str(Js.get(tB, "type")));
    if (onceA && onceB) {
      String da = Js.str(Js.get(tA, "date")), db = Js.str(Js.get(tB, "date"));
      return da == null ? db == null : da.equals(db);
    }
    Integer dayA = dayOf(tA, rA), dayB = dayOf(tB, rB);
    if (dayA == null || dayB == null) return false;
    return dayA.equals(dayB);
  }

  private static Integer dayOf(JsonNode t, JsonNode r) {
    if ("weekly".equals(Js.str(Js.get(t, "type")))) {
      JsonNode d = Js.get(r, "day");
      return Js.nullish(d) ? null : (int) Js.num(d);
    }
    return Js.truthy(Js.get(t, "date")) ? DateTimes.weekdayIdx(Js.str(Js.get(t, "date"))) : null;
  }

  /** A conflict between a candidate ride and a saved one. */
  public record Conflict(String type, JsonNode ride, JsonNode training) {}

  public static List<Conflict> findConflicts(JsonNode state, JsonNode cand) {
    JsonNode tA = Js.byId(Js.get(state, "trainings"), Js.str(Js.get(cand, "trainingId")));
    List<Conflict> out = new ArrayList<>();
    if (tA == null) return out;
    String candId = Js.str(Js.get(cand, "id"));
    for (JsonNode r : Js.arr(Js.get(state, "rides"))) {
      String rid = Js.str(Js.get(r, "id"));
      if (candId != null && candId.equals(rid)) continue;
      JsonNode tB = Js.byId(Js.get(state, "trainings"), Js.str(Js.get(r, "trainingId")));
      if (tB == null) continue;
      if (!occursOnSameDay(cand, tA, r, tB)) continue;
      double[] a = rideWindow(state, cand, tA);
      double[] b = rideWindow(state, r, tB);
      if (!(a[0] < b[1] && b[0] < a[1])) continue;
      String cv = Js.str(Js.get(cand, "vehicleId")), cd = Js.str(Js.get(cand, "driverId"));
      if (Js.truthy(Js.get(cand, "vehicleId")) && cv.equals(Js.str(Js.get(r, "vehicleId"))))
        out.add(new Conflict("vehicle", r, tB));
      if (Js.truthy(Js.get(cand, "driverId")) && cd.equals(Js.str(Js.get(r, "driverId"))))
        out.add(new Conflict("driver", r, tB));
    }
    return out;
  }

  public static double seatSum(JsonNode stops) {
    double a = 0;
    for (JsonNode s : Js.arr(stops)) {
      double c = Js.num(Js.get(s, "count"));
      if (c > 0) a += c;
    }
    return a;
  }

  /** How many saved schedule chains reference this driver or vehicle. */
  public static int chainRefs(JsonNode state, String field, String id) {
    int c = 0;
    JsonNode asg = Js.get(state, "assignments");
    if (asg != null && asg.isObject())
      for (JsonNode day : asg)
        for (JsonNode ch : Js.arr(Js.get(day, "chains")))
          if (id != null && id.equals(Js.str(Js.get(ch, field)))) c++;
    return c;
  }

  /** Where the stops come from: the training's own list, or the team's (I2 — a full override). */
  public static JsonNode legSource(JsonNode team, JsonNode training) {
    JsonNode own = Js.get(training, "stops");
    if (Js.truthy(own)) return own;
    if (team != null && !team.isMissingNode() && !team.isNull()) return team;
    return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
  }

  public static boolean hasOwnStops(JsonNode training) { return Js.truthy(Js.get(training, "stops")); }

  /** One direction's leg: its stops, its headcounts, its pinned stop, and whether it is an override. */
  public record Leg(List<String> stationIds, JsonNode stationCounts, String routeAnchorId,
                    String routeMode, boolean isOverride) {}

  /**
   * The ONLY place that decides whether the return leg uses its own list or mirrors the
   * outbound one (I1). With no {@code returnStationIds} both directions get the outbound
   * fields, so an existing team needs no migration.
   *
   * <p>{@code isOverride} matters because ordering differs: a mirrored return leg must be
   * reversed, a hand-built one must not.
   */
  public static Leg legFor(JsonNode team, JsonNode training, String dir) {
    JsonNode src = legSource(team, training);
    boolean own = "vissza".equals(dir) && Js.isArray(Js.get(src, "returnStationIds"));
    JsonNode rm = Js.get(src, "routeMode");
    String routeMode = Js.truthy(rm) ? rm.asText() : "auto";
    if (!own) {
      return new Leg(Js.ids(Js.get(src, "stationIds")), objOrEmpty(Js.get(src, "stationCounts")),
          Js.strOrNull(Js.get(src, "routeAnchorId")), routeMode, false);
    }
    return new Leg(Js.ids(Js.get(src, "returnStationIds")), objOrEmpty(Js.get(src, "returnStationCounts")),
        Js.strOrNull(Js.get(src, "returnRouteAnchorId")), routeMode, true);
  }

  private static JsonNode objOrEmpty(JsonNode n) {
    return Js.truthy(n) ? n : com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
  }

  public static Leg teamLeg(JsonNode team, String dir) { return legFor(team, null, dir); }

  /* The vignette: the REQUIREMENT is on the venue, the FACT is on the vehicle. One of a
     task's endpoints is always the venue, so checking both covers either direction. */
  public static boolean venueNeedsVignette(JsonNode state, String id) {
    JsonNode v = Js.byId(Js.get(state, "venues"), id);
    return v != null && Js.truthy(Js.get(v, "needsVignette"));
  }

  public static boolean taskNeedsVignette(JsonNode state, Task t) {
    return venueNeedsVignette(state, t.from) || venueNeedsVignette(state, t.to);
  }

  public static boolean chainNeedsVignette(JsonNode state, Chain c) {
    if (c == null) return false;
    for (Task t : c.tasks) if (taskNeedsVignette(state, t)) return true;
    return false;
  }

  /** Which vignette-requiring venues a chain visits, so the explanation names the cause. */
  public static List<String> vignetteVenues(JsonNode state, Chain c) {
    Set<String> seen = new LinkedHashSet<>();   // a JavaScript Set keeps insertion order
    if (c != null)
      for (Task t : c.tasks)
        for (String id : new String[] { t.from, t.to })
          if (venueNeedsVignette(state, id))
            seen.add(Js.str(Js.get(Js.byId(Js.get(state, "venues"), id), "name")));
    return new ArrayList<>(seen);
  }

  /** A vehicle's own depot beats the club's; with neither, null (ADR-14). */
  public static String baseOf(JsonNode state, String vehicleId) {
    JsonNode v = Js.byId(Js.get(state, "vehicles"), vehicleId);
    if (v != null && Js.truthy(Js.get(v, "baseId"))) return Js.str(Js.get(v, "baseId"));
    JsonNode d = Js.get(Js.get(state, "settings"), "defaultBaseId");
    return Js.truthy(d) ? d.asText() : null;
  }

  /** Referenced master data cannot be deleted (I10). Returns the Hungarian reason, or null. */
  public static String deleteGuard(JsonNode state, String kind, String id) {
    switch (kind) {
      case "stations": {
        int c = 0;
        for (JsonNode t : Js.arr(Js.get(state, "teams"))) if (inSource(t, id)) c++;
        for (JsonNode t : Js.arr(Js.get(state, "trainings")))
          if (Js.truthy(Js.get(t, "stops")) && inSource(Js.get(t, "stops"), id)) c++;
        for (JsonNode r : Js.arr(Js.get(state, "rides")))
          for (JsonNode s : Js.arr(Js.get(r, "stops")))
            if (id.equals(Js.str(Js.get(s, "stationId")))) { c++; break; }
        return used(c, "csapat/edzés/fuvar");
      }
      case "venues": {
        int c = 0;
        for (JsonNode t : Js.arr(Js.get(state, "teams")))
          if (Js.ids(Js.get(t, "venueIds")).contains(id)) c++;
        for (JsonNode t : Js.arr(Js.get(state, "trainings")))
          if (id.equals(Js.str(Js.get(t, "venueId")))) c++;
        return used(c, "csapat/edzés");
      }
      case "vehicles": {
        int c = 0;
        for (JsonNode r : Js.arr(Js.get(state, "rides")))
          if (id.equals(Js.str(Js.get(r, "vehicleId")))) c++;
        c += chainRefs(state, "vehicleId", id);
        for (JsonNode d : Js.arr(Js.get(state, "drivers")))
          if (id.equals(Js.str(Js.get(d, "preferredVehicleId")))) c++;
        return used(c, "fuvar/beosztás/sofőr");
      }
      case "bases": {
        int c = 0;
        for (JsonNode v : Js.arr(Js.get(state, "vehicles")))
          if (id.equals(Js.str(Js.get(v, "baseId")))) c++;
        if (id.equals(Js.str(Js.get(Js.get(state, "settings"), "defaultBaseId")))) c++;
        return used(c, "jármű/beállítás");
      }
      case "drivers": {
        int c = 0;
        for (JsonNode r : Js.arr(Js.get(state, "rides")))
          if (id.equals(Js.str(Js.get(r, "driverId")))) c++;
        c += chainRefs(state, "driverId", id);
        return used(c, "fuvar/beosztás");
      }
      default:
        return null;
    }
  }

  private static boolean inSource(JsonNode src, String id) {
    return Js.ids(Js.get(src, "stationIds")).contains(id)
        || Js.ids(Js.get(src, "returnStationIds")).contains(id);
  }

  private static String used(int c, String what) {
    return c > 0 ? "Használatban: " + c + " " + what + "." : null;
  }
}
