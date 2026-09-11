package hu.fuvarterv.domain;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Structural comparison of a Java result against the JavaScript output recorded in a fixture.
 *
 * <p>Two tolerances, and only two, both of them artefacts of crossing languages rather than
 * differences anyone should be allowed to ignore:
 *
 * <ol>
 *   <li><b>Missing equals null.</b> {@code JSON.stringify} drops a key whose value is
 *       {@code undefined}, so a field the JavaScript never set is absent from the fixture while
 *       Java writes it as null. An explicit {@code false} against a missing key is still a
 *       difference — that one is real.
 *   <li><b>Numbers compare by value.</b> JavaScript has one number type, so 1500 and 1500.0 are
 *       the same number written two ways. Comparison is exact otherwise: no epsilon, because the
 *       port is supposed to reproduce the arithmetic, not approximate it.
 * </ol>
 */
final class JsonCompare {
  private JsonCompare() {}

  static List<String> diff(JsonNode expected, JsonNode actual) {
    List<String> out = new ArrayList<>();
    walk("", expected, actual, out);
    return out;
  }

  private static void walk(String path, JsonNode e, JsonNode a, List<String> out) {
    if (out.size() > 25) return;         // enough to diagnose; the rest is noise
    boolean eNull = e == null || e.isNull() || e.isMissingNode();
    boolean aNull = a == null || a.isNull() || a.isMissingNode();
    if (eNull && aNull) return;
    if (eNull != aNull) {
      out.add(at(path) + ": expected " + show(e) + ", got " + show(a));
      return;
    }
    if (e.isNumber() && a.isNumber()) {
      double ev = e.doubleValue(), av = a.doubleValue();
      if (ev != av && !(Double.isNaN(ev) && Double.isNaN(av)))
        out.add(at(path) + ": expected " + ev + ", got " + av);
      return;
    }
    if (e.isArray() || a.isArray()) {
      if (!e.isArray() || !a.isArray()) {
        out.add(at(path) + ": expected " + kind(e) + ", got " + kind(a));
        return;
      }
      if (e.size() != a.size()) {
        out.add(at(path) + ": expected " + e.size() + " elements, got " + a.size());
        // Still walk the common prefix: the first differing element is usually the cause.
      }
      for (int i = 0; i < Math.min(e.size(), a.size()); i++)
        walk(path + "[" + i + "]", e.get(i), a.get(i), out);
      return;
    }
    if (e.isObject() || a.isObject()) {
      if (!e.isObject() || !a.isObject()) {
        out.add(at(path) + ": expected " + kind(e) + ", got " + kind(a));
        return;
      }
      Set<String> keys = new LinkedHashSet<>();
      e.fieldNames().forEachRemaining(keys::add);
      a.fieldNames().forEachRemaining(keys::add);
      for (String k : keys) walk(path + "." + k, e.get(k), a.get(k), out);
      return;
    }
    if (!e.equals(a)) out.add(at(path) + ": expected " + show(e) + ", got " + show(a));
  }

  private static String at(String path) { return path.isEmpty() ? "<root>" : path; }

  private static String kind(JsonNode n) {
    if (n == null || n.isMissingNode()) return "<missing>";
    return n.getNodeType().toString().toLowerCase();
  }

  private static String show(JsonNode n) {
    if (n == null || n.isMissingNode()) return "<missing>";
    String s = n.toString();
    return s.length() > 160 ? s.substring(0, 160) + "…" : s;
  }
}
