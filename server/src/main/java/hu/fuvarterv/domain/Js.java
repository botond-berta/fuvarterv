package hu.fuvarterv.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * JavaScript value semantics over a Jackson tree (ADR-29, ACTION_PLAN P3-2 trap 3).
 *
 * <p>The workspace is an untyped JSON blob with no schema version (ADR-05), and the
 * JavaScript domain leans on coercion in places where it matters: {@code Number(sc[id]) || 0}
 * turns an empty string, a null and a non-numeric string all into {@code 0}, and
 * {@code timeToMin(t.start) - N} silently treats a missing time as {@code 0} rather than
 * throwing. A port that "fixes" those with null checks computes different numbers.
 *
 * <p>So the rules live here once, and nowhere else reimplements them. Every number is a
 * {@code double}, because in JavaScript every number is one: carrying ints through the
 * port would introduce integer division and overflow the original cannot have.
 */
public final class Js {
  private Js() {}

  /** Never returns null: an absent key is a MissingNode, so chained access cannot NPE. */
  public static JsonNode get(JsonNode o, String k) {
    if (o == null || !o.isObject()) return MissingNode.getInstance();
    return o.path(k);
  }

  public static JsonNode get(JsonNode o, String a, String b) { return get(get(o, a), b); }

  /** JavaScript {@code x == null}: true for both null and undefined, false for "" and 0. */
  public static boolean nullish(JsonNode n) {
    return n == null || n.isMissingNode() || n.isNull();
  }

  /** JavaScript truthiness. "" and 0 are false; [] and {} are true. */
  public static boolean truthy(JsonNode n) {
    if (nullish(n)) return false;
    if (n.isBoolean()) return n.booleanValue();
    if (n.isNumber()) { double d = n.doubleValue(); return d != 0 && !Double.isNaN(d); }
    if (n.isTextual()) return !n.textValue().isEmpty();
    return true;
  }

  /**
   * JavaScript {@code Number(x) || 0}.
   *
   * <p>The {@code || 0} is what makes this total: {@code Number("")} is 0,
   * {@code Number(null)} is 0, {@code Number(undefined)} and {@code Number("abc")} are NaN,
   * and NaN is falsy, so every one of them lands on 0.
   */
  public static double num(JsonNode n) {
    if (nullish(n)) return 0;
    if (n.isNumber()) { double d = n.doubleValue(); return Double.isNaN(d) ? 0 : d; }
    if (n.isBoolean()) return n.booleanValue() ? 1 : 0;
    if (n.isTextual()) return numOfString(n.textValue());
    return 0;   // arrays and objects: Number([{}]) is NaN, so 0
  }

  /** {@code Number("  12  ")} is 12; a trailing type suffix or a hex float is NaN, not a number. */
  private static double numOfString(String s) {
    String t = s.trim();
    if (t.isEmpty()) return 0;
    // Double.parseDouble accepts forms JavaScript rejects ("12f", "0x1p3", "12d").
    if (!t.matches("[+-]?((\\d+\\.?\\d*)|(\\.\\d+))([eE][+-]?\\d+)?")) return 0;
    try { double d = Double.parseDouble(t); return Double.isNaN(d) ? 0 : d; }
    catch (NumberFormatException e) { return 0; }
  }

  /** JavaScript {@code a ?? fallback}: only null and undefined fall through, not 0 or "". */
  public static double numOr(JsonNode n, double fallback) {
    return nullish(n) ? fallback : num(n);
  }

  /** The text, or null when absent. Distinguishes "" from absent, which ADR-23 depends on. */
  public static String str(JsonNode n) {
    if (nullish(n)) return null;
    return n.isTextual() ? n.textValue() : n.asText();
  }

  /** Like {@link #str} but with {@code ?? null} semantics for a non-string. */
  public static String strOrNull(JsonNode n) {
    return nullish(n) ? null : n.asText();
  }

  /** How a value renders inside a template literal. A missing field really does print "undefined". */
  public static String s(JsonNode n) {
    if (n == null || n.isMissingNode()) return "undefined";
    if (n.isNull()) return "null";
    if (n.isNumber()) return numStr(n.doubleValue());
    return n.asText();
  }

  /**
   * {@code String(n)} for a number: JavaScript prints an integral double without a decimal
   * point, so a count of 8 is "8" and never "8.0". The Hungarian explanation strings are
   * compared literally, so this is load-bearing.
   */
  public static String numStr(double d) {
    if (Double.isNaN(d)) return "NaN";
    if (Double.isInfinite(d)) return d > 0 ? "Infinity" : "-Infinity";
    if (d == Math.rint(d) && Math.abs(d) < 1e15) return Long.toString((long) d);
    String r = Double.toString(d);
    return r.endsWith(".0") ? r.substring(0, r.length() - 2) : r;
  }

  /** {@code Number.prototype.toFixed}: rounds the exact binary value, half away from zero. */
  public static String toFixed(double d, int digits) {
    return new BigDecimal(d).setScale(digits, RoundingMode.HALF_UP).toPlainString();
  }

  /**
   * {@code Math.round}: half rounds towards +Infinity, so round(-2.5) is -2 in both languages.
   *
   * <p>{@link Math#round} is used rather than {@code floor(d + 0.5)} because the naive form
   * gets {@code 0.49999999999999994} wrong — the addition itself rounds up to 1.0. Java fixed
   * that in JDK 7 and the JavaScript specification never had it, so the two agree. NaN and the
   * infinities are passed through, since Math.round would turn them into 0 and Long.MAX_VALUE.
   */
  public static double round(double d) {
    if (Double.isNaN(d) || Double.isInfinite(d)) return d;
    return Math.round(d);
  }

  /** An array's elements, or empty for anything that is not an array. */
  public static List<JsonNode> arr(JsonNode n) {
    List<JsonNode> out = new ArrayList<>();
    if (n != null && n.isArray()) n.forEach(out::add);
    return out;
  }

  /** {@code (src.stationIds || []).map(String)} — the common "list of ids" read. */
  public static List<String> ids(JsonNode n) {
    List<String> out = new ArrayList<>();
    if (n != null && n.isArray()) for (JsonNode x : n) out.add(x.asText());
    return out;
  }

  public static boolean isArray(JsonNode n) { return n != null && n.isArray(); }

  /** {@code arr.find(x => x.id === id)}, returning null like JavaScript's undefined. */
  public static JsonNode byId(JsonNode arr, String id) {
    if (arr == null || !arr.isArray() || id == null) return null;
    for (JsonNode x : arr) if (id.equals(str(get(x, "id")))) return x;
    return null;
  }

  /** A null-tolerant minutes value: JavaScript's {@code null - 10} is -10, not a crash. */
  public static double nz(Double v) { return v == null ? 0 : v; }

  /**
   * The sign of a sort comparator's result, the way {@code Array.prototype.sort} reads it.
   *
   * <p>A NaN comparison counts as "equal" in JavaScript, so a training with an unparseable
   * time keeps its position instead of scrambling the order. Both languages sort stably, so
   * reproducing this keeps tied elements in generation order.
   */
  public static int sign(double d) { return d < 0 ? -1 : d > 0 ? 1 : 0; }
}
