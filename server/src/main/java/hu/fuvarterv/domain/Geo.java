package hu.fuvarterv.domain;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/**
 * Coordinates, distance and the deadhead matrix, ported from {@code src/domain/geo.js}.
 *
 * <p>A leaf in the domain graph for the same reason as the original (ADR-03): both
 * {@link Logic} and {@link Optimizer} need {@link #legMin}, so putting it in either would
 * make the two circular.
 *
 * <p>The map helpers ({@code defaultMapCenter}, {@code r5}, {@code CLUB_CENTER}) stay in
 * JavaScript — they serve the map widget, not the schedule.
 */
public final class Geo {
  private Geo() {}

  public static JsonNode locOf(JsonNode state, String id) {
    JsonNode r = Js.byId(Js.get(state, "stations"), id);
    if (r != null) return r;
    r = Js.byId(Js.get(state, "venues"), id);
    if (r != null) return r;
    // Depots are locations too: without them legMin could not price the trip home, and
    // paid time hangs on exactly that distance (ADR-14).
    return Js.byId(Js.get(state, "bases"), id);
  }

  public static String locName(JsonNode state, String id) {
    JsonNode l = locOf(state, id);
    if (l == null) return "?";
    JsonNode n = Js.get(l, "name");
    return Js.truthy(n) ? n.asText() : "?";
  }

  /**
   * The great-circle distance in kilometres.
   *
   * <p>The arithmetic is associated EXACTLY as the JavaScript writes it, and that is not
   * pedantry. {@code Math.toRadians} computes {@code x * (PI / 180)} while the original
   * computes {@code (x * PI) / 180}, which differ in the last bit; {@code Math.pow(x, 2)} is
   * allowed a one-ulp error where {@code x * x} is exactly rounded. Either difference
   * survives into {@link #legMin}, where a value sitting on a rounding boundary flips a whole
   * minute, and a one-minute change to a deadhead can change which chains are feasible.
   */
  public static double haversineKm(JsonNode a, JsonNode b) {
    double R = 6371;
    double aLat = Js.num(Js.get(a, "lat")), aLon = Js.num(Js.get(a, "lon"));
    double bLat = Js.num(Js.get(b, "lat")), bLon = Js.num(Js.get(b, "lon"));
    double dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
    double sLat = Math.sin(dLat / 2), sLon = Math.sin(dLon / 2);
    double s = sLat * sLat + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * (sLon * sLon);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /** {@code (x * Math.PI) / 180} — deliberately not {@link Math#toRadians}. See above. */
  private static double rad(double x) { return (x * Math.PI) / 180; }

  /**
   * Deadhead minutes between two points: the matrix, else a straight-line estimate, else the
   * configured fallback.
   *
   * <p>BOTH coordinates are required on each side. Checking only the latitude lets haversine
   * return NaN, and {@code Math.max(1, NaN)} is NaN too — which then runs through the whole
   * timetable, makes every comparison false (no edge is built, no clash is visible) and
   * prints times as "NaN:NaN". The guard is the bug fix; it is not redundant.
   */
  public static double legMin(JsonNode state, String aId, String bId) {
    if (aId == null || aId.isEmpty() || bId == null || bId.isEmpty() || aId.equals(bId)) return 0;
    JsonNode m = Js.get(Js.get(Js.get(state, "matrix"), "durations"), aId + "|" + bId);
    if (!Js.nullish(m)) return Js.num(m);
    JsonNode A = locOf(state, aId), B = locOf(state, bId);
    JsonNode settings = Js.get(state, "settings");
    if (A != null && B != null
        && !Js.nullish(Js.get(A, "lat")) && !Js.nullish(Js.get(A, "lon"))
        && !Js.nullish(Js.get(B, "lat")) && !Js.nullish(Js.get(B, "lon"))) {
      double speed = Js.num(Js.get(settings, "estSpeedKmh"));
      if (speed == 0) speed = 30;                    // `|| 30`, so a stored 0 also falls back
      return Math.max(1, Js.round((haversineKm(A, B) / speed) * 60) + 2);
    }
    return Js.numOr(Js.get(settings, "fallbackLegMin"), 10);
  }

  /** Stations, venues and depots, in that order. The order is part of the matrix key. */
  public static List<JsonNode> allPoints(JsonNode state) {
    List<JsonNode> out = new ArrayList<>();
    out.addAll(Js.arr(Js.get(state, "stations")));
    out.addAll(Js.arr(Js.get(state, "venues")));
    out.addAll(Js.arr(Js.get(state, "bases")));
    return out;
  }

  /** The staleness key: every located point's id and its coordinate to five decimals (ADR-19). */
  public static String matrixKey(JsonNode state) {
    StringBuilder sb = new StringBuilder();
    boolean first = true;
    for (JsonNode p : allPoints(state)) {
      if (Js.nullish(Js.get(p, "lat")) || Js.nullish(Js.get(p, "lon"))) continue;
      if (!first) sb.append(';');
      first = false;
      sb.append(Js.str(Js.get(p, "id"))).append(':')
        .append(Js.toFixed(Js.num(Js.get(p, "lat")), 5)).append(',')
        .append(Js.toFixed(Js.num(Js.get(p, "lon")), 5));
    }
    return sb.toString();
  }
}
