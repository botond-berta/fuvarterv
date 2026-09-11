package hu.fuvarterv.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.List;
import java.util.stream.Stream;

import static hu.fuvarterv.domain.Model.*;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * The parity suite: the Java port against the JavaScript output, function by function
 * (ADR-29, ACTION_PLAN P3-1).
 *
 * <p>The fixtures come from {@code npm run parity:fixtures}, which runs the JavaScript domain
 * over generated states and records what it returned. The JavaScript is the specification, so
 * a failure here means the port is wrong — not that the fixture needs regenerating. Do not
 * regenerate fixtures to make a test pass; that deletes the only evidence.
 *
 * <p>One test method per layer, so a failure names the layer rather than just "the optimizer".
 * The methods are ordered bottom-up: if {@code legMin} is red, everything above it is noise.
 */
class ParityTest {
  private static final ObjectMapper M = new ObjectMapper();
  private static final Path DIR = Path.of("src/test/resources/parity");

  /** One fixture: the generated state and everything the JavaScript computed from it. */
  record Fixture(String name, JsonNode state, int weekday, LocalDate weekMon, JsonNode expect) {
    @Override public String toString() { return name; }
  }

  static Stream<Fixture> fixtures() throws IOException {
    try (var paths = Files.list(DIR)) {
      List<Path> files = paths.filter(p -> p.toString().endsWith(".json")).sorted().toList();
      assertTrue(!files.isEmpty(), "no parity fixtures in " + DIR.toAbsolutePath()
          + " — run `npm run parity:fixtures` first");
      List<Fixture> out = new ArrayList<>();
      for (Path p : files) {
        JsonNode f = M.readTree(Files.readString(p));
        out.add(new Fixture(f.get("name").asText(), f.get("state"), f.get("weekday").asInt(),
            LocalDate.parse(f.get("weekMonISO").asText()), f.get("expect")));
      }
      return out.stream();
    }
  }

  /* A deterministic id generator, so a skeleton chain's id is at least reproducible within a
     run. The fixtures blank these ids on both sides, because uid() is Math.random(). */
  @BeforeEach void fixedIds() {
    int[] n = { 0 };
    Ids.setGenerator(() -> "uid" + n[0]++);
  }

  @AfterEach void restoreIds() { Ids.setGenerator(null); }

  private void check(Fixture f, String what, JsonNode expected, Object actual) {
    List<String> d = JsonCompare.diff(expected, M.valueToTree(actual));
    if (!d.isEmpty())
      fail(what + " differs from the JavaScript on fixture " + f.name() + ":\n  " + String.join("\n  ", d));
  }

  /* ------------------------------------------------------------------ geo layer */

  @ParameterizedTest(name = "legMin · {0}")
  @MethodSource("fixtures")
  void legMin(Fixture f) {
    ObjectNode got = M.createObjectNode();
    f.expect().get("legMin").fieldNames().forEachRemaining(k -> {
      int bar = k.indexOf('|');
      got.put(k, Geo.legMin(f.state(), k.substring(0, bar), k.substring(bar + 1)));
    });
    check(f, "legMin", f.expect().get("legMin"), got);
  }

  @ParameterizedTest(name = "matrixKey · {0}")
  @MethodSource("fixtures")
  void matrixKey(Fixture f) {
    check(f, "matrixKey", f.expect().get("matrixKey"), Geo.matrixKey(f.state()));
  }

  @ParameterizedTest(name = "allPoints + baseOf + venueNeedsVignette · {0}")
  @MethodSource("fixtures")
  void pointsAndLookups(Fixture f) {
    List<String> ids = new ArrayList<>();
    for (JsonNode p : Geo.allPoints(f.state())) ids.add(Js.str(Js.get(p, "id")));
    check(f, "allPoints", f.expect().get("allPointIds"), ids);

    ObjectNode bases = M.createObjectNode();
    f.expect().get("baseOf").fieldNames().forEachRemaining(
        vid -> bases.put(vid, Logic.baseOf(f.state(), vid)));
    check(f, "baseOf", f.expect().get("baseOf"), bases);

    ObjectNode vig = M.createObjectNode();
    f.expect().get("venueNeedsVignette").fieldNames().forEachRemaining(
        id -> vig.put(id, Logic.venueNeedsVignette(f.state(), id)));
    check(f, "venueNeedsVignette", f.expect().get("venueNeedsVignette"), vig);
  }

  /* ---------------------------------------------------------------- logic layer */

  @ParameterizedTest(name = "weekOccurrences · {0}")
  @MethodSource("fixtures")
  void weekOccurrences(Fixture f) {
    ArrayNode got = M.createArrayNode();
    for (Occurrence o : Logic.weekOccurrences(f.state(), f.weekMon())) {
      ObjectNode n = got.addObject();
      n.put("trainingId", Js.str(Js.get(o.training, "id")));
      n.put("dayIdx", o.dayIdx);
      n.put("dateISO", o.dateISO);
    }
    check(f, "weekOccurrences", f.expect().get("weekOccurrences"), got);
  }

  @ParameterizedTest(name = "legPax · {0}")
  @MethodSource("fixtures")
  void legPax(Fixture f) {
    for (JsonNode c : f.expect().get("legPax")) {
      JsonNode team = Js.byId(Js.get(f.state(), "teams"), c.get("teamId").asText());
      JsonNode training = c.get("trainingId").isNull() ? null
          : Js.byId(Js.get(f.state(), "trainings"), c.get("trainingId").asText());
      double got = Optimizer.legPax(team, training, c.get("dir").asText());
      check(f, "legPax(" + c.get("teamId").asText() + "," + c.get("trainingId") + "," + c.get("dir").asText() + ")",
          c.get("out"), got);
    }
  }

  /* ------------------------------------------------------- routing and timetables */

  @ParameterizedTest(name = "bestStationOrder · {0}")
  @MethodSource("fixtures")
  void bestStationOrder(Fixture f) {
    for (JsonNode c : f.expect().get("bestStationOrder")) {
      JsonNode o = c.get("opts");
      var opts = new Optimizer.OrderOpts(Js.strOrNull(Js.get(o, "pre")), Js.strOrNull(Js.get(o, "post")),
          Js.strOrNull(Js.get(o, "fixedFirst")), Js.strOrNull(Js.get(o, "fixedLast")));
      List<String> got = Optimizer.bestStationOrder(f.state(), Js.ids(c.get("ids")), opts);
      check(f, "bestStationOrder[" + c.get("label").asText() + "," + c.get("teamId").asText() + "]",
          c.get("out"), got);
    }
  }

  @ParameterizedTest(name = "legRouteOrder · {0}")
  @MethodSource("fixtures")
  void legRouteOrder(Fixture f) {
    for (JsonNode c : f.expect().get("legRouteOrder")) {
      JsonNode t = Js.byId(Js.get(f.state(), "trainings"), c.get("trainingId").asText());
      JsonNode team = Js.byId(Js.get(f.state(), "teams"), Js.str(Js.get(t, "teamId")));
      List<String> got = Optimizer.legRouteOrder(f.state(), team, t,
          Js.str(Js.get(t, "venueId")), c.get("dir").asText(), null);
      check(f, "legRouteOrder[" + c.get("trainingId").asText() + "," + c.get("dir").asText() + "]",
          c.get("out"), got);
    }
  }

  @ParameterizedTest(name = "planOda + planVissza · {0}")
  @MethodSource("fixtures")
  void plans(Fixture f) {
    for (JsonNode c : f.expect().get("plans")) {
      JsonNode t = Js.byId(Js.get(f.state(), "trainings"), c.get("trainingId").asText());
      String dir = c.get("dir").asText();
      double dwell = Js.num(Js.get(Js.get(f.state(), "settings"), "dwellMin"));
      PlanResult got = "oda".equals(dir)
          ? Optimizer.planOda(f.state(), Js.ids(c.get("order")), Js.str(Js.get(t, "venueId")), 900, dwell)
          : Optimizer.planVissza(f.state(), Js.ids(c.get("order")), Js.str(Js.get(t, "venueId")), 1100, dwell);
      check(f, "plan[" + c.get("trainingId").asText() + "," + dir + "]", c.get("out"), got);
    }
  }

  @ParameterizedTest(name = "splitStationsByCapacity · {0}")
  @MethodSource("fixtures")
  void splitStationsByCapacity(Fixture f) {
    for (JsonNode c : f.expect().get("splitStationsByCapacity")) {
      JsonNode counts = c.get("counts");
      List<List<String>> got = Optimizer.splitStationsByCapacity(
          Js.ids(c.get("ids")), sid -> Js.num(Js.get(counts, sid)), c.get("cap").asDouble());
      check(f, "splitStationsByCapacity[" + c.get("teamId").asText() + ",cap=" + c.get("cap") + "]",
          c.get("out"), got);
    }
  }

  /* ------------------------------------------------------------ cost and shifts */

  @ParameterizedTest(name = "driverAvailableFor · {0}")
  @MethodSource("fixtures")
  void driverAvailableFor(Fixture f) {
    for (JsonNode c : f.expect().get("driverAvailableFor")) {
      JsonNode d = Js.byId(Js.get(f.state(), "drivers"), c.get("driverId").asText());
      boolean got = Optimizer.driverAvailableFor(d, f.weekday(),
          c.get("startMin").asDouble(), c.get("endMin").asDouble());
      check(f, "driverAvailableFor[" + c.get("driverId").asText() + "," + c.get("startMin") + "-" + c.get("endMin") + "]",
          c.get("out"), got);
    }
  }

  @ParameterizedTest(name = "mergeShifts · {0}")
  @MethodSource("fixtures")
  void mergeShifts(Fixture f) {
    for (JsonNode c : f.expect().get("mergeShifts")) {
      List<Span> in = new ArrayList<>();
      for (JsonNode s : c.get("in")) in.add(new Span(s.get("start").asDouble(), s.get("end").asDouble()));
      check(f, "mergeShifts[" + c.get("idx") + "]", c.get("out"), Optimizer.mergeShifts(in));
    }
  }

  @ParameterizedTest(name = "spanOf + driverPay + onSiteWait · {0}")
  @MethodSource("fixtures")
  void driverPay(Fixture f) {
    for (JsonNode c : f.expect().get("driverPay")) {
      JsonNode d = Js.byId(Js.get(f.state(), "drivers"), c.get("driverId").asText());
      List<Use> uses = new ArrayList<>();
      for (JsonNode u : c.get("uses"))
        uses.add(new Use(Js.strOrNull(Js.get(u, "driverId")), Js.strOrNull(Js.get(u, "vehicleId")),
            u.get("start").asDouble(), u.get("end").asDouble(),
            Js.strOrNull(Js.get(u, "from")), Js.strOrNull(Js.get(u, "to"))));
      String who = "[" + c.get("driverId").asText() + "]";
      List<Span> spans = new ArrayList<>();
      for (Use u : uses) spans.add(Optimizer.spanOf(f.state(), u));
      check(f, "spanOf" + who, c.get("spans"), spans);
      check(f, "driverPay" + who, c.get("pay"), Optimizer.driverPay(f.state(), d, uses));
      check(f, "onSiteWait" + who, c.get("onSiteWait"), Optimizer.onSiteWait(f.state(), uses));
    }
  }

  /* ------------------------------------------------------------ the three phases */

  @ParameterizedTest(name = "genDayTasks · {0}")
  @MethodSource("fixtures")
  void genDayTasks(Fixture f) {
    check(f, "genDayTasks", f.expect().get("genDayTasks"),
        Optimizer.genDayTasks(f.state(), f.weekday(), f.weekMon()));
  }

  @ParameterizedTest(name = "resolveDay · {0}")
  @MethodSource("fixtures")
  void resolveDay(Fixture f) {
    DayResult got = Optimizer.resolveDay(f.state(), f.weekday(), f.weekMon());
    check(f, "resolveDay", f.expect().get("resolveDay"), blankChainIds(got));
  }

  @ParameterizedTest(name = "dayStats · {0}")
  @MethodSource("fixtures")
  void dayStats(Fixture f) {
    DayResult rd = Optimizer.resolveDay(f.state(), f.weekday(), f.weekMon());
    check(f, "dayStats", f.expect().get("dayStats"), Optimizer.dayStats(f.state(), rd.chains));
  }

  @ParameterizedTest(name = "optimizeDay · {0}")
  @MethodSource("fixtures")
  void optimizeDay(Fixture f) {
    OptimizeResult got = Optimizer.optimizeDay(f.state(), f.weekday(), f.weekMon());
    JsonNode tree = M.valueToTree(got);
    if (tree.isObject() && tree.has("chains") && tree.get("chains").isArray())
      for (JsonNode c : tree.get("chains")) ((ObjectNode) c).putNull("id");
    check(f, "optimizeDay", f.expect().get("optimizeDay"), tree);
  }

  @ParameterizedTest(name = "ridesFromChains · {0}")
  @MethodSource("fixtures")
  void ridesFromChains(Fixture f) {
    DayResult rd = Optimizer.resolveDay(f.state(), f.weekday(), f.weekMon());
    JsonNode tree = M.valueToTree(Optimizer.ridesFromChains(f.state(), f.weekday(), rd.chains));
    for (JsonNode r : tree) {
      ((ObjectNode) r).putNull("id");
      for (JsonNode s : r.get("stops")) ((ObjectNode) s).putNull("id");
    }
    check(f, "ridesFromChains", f.expect().get("ridesFromChains"), tree);
  }

  /** resolveDay's chain ids come from the saved schedule, but null them the same way for symmetry. */
  private JsonNode blankChainIds(DayResult r) {
    JsonNode tree = M.valueToTree(r);
    for (JsonNode c : tree.get("chains")) ((ObjectNode) c).putNull("id");
    return tree;
  }

  /* ------------------------------------------------------------------ invariants */

  /**
   * The invariants from {@code test/optimizer.test.js}, re-checked on the Java side.
   *
   * <p>Parity says the port computes the same answer; this says the answer is a valid schedule.
   * Both matter: a port that faithfully reproduces a broken optimizer is still broken.
   */
  @ParameterizedTest(name = "scheduling invariants · {0}")
  @MethodSource("fixtures")
  void invariants(Fixture f) {
    OptimizeResult out = Optimizer.optimizeDay(f.state(), f.weekday(), f.weekMon());
    if (out.empty) return;

    // I5: every generated task lands in exactly one chain, or is uncovered with a reason.
    List<String> covered = new ArrayList<>();
    for (Chain c : out.chains) for (Task t : c.tasks) covered.add(t.id);
    for (Uncovered u : out.uncovered) covered.add(u.task.id);
    List<String> all = new ArrayList<>();
    for (Task t : Optimizer.genDayTasks(f.state(), f.weekday(), f.weekMon()).tasks) all.add(t.id);
    covered.sort(null);
    all.sort(null);
    if (!covered.equals(all))
      fail("task conservation broken on " + f.name() + ": expected " + all + ", got " + covered);

    /* The resource invariants hold over the chains the optimizer CHOSE. A skeleton chain is
       excluded deliberately, and the exclusion is a finding rather than a convenience — see
       lockedChainsAreNotReCheckedButAreReported below for what it cost to learn. */
    List<Chain> chosen = new ArrayList<>();
    for (Chain c : out.chains) if (!Boolean.TRUE.equals(c.hasLocked)) chosen.add(c);

    for (int i = 0; i < chosen.size(); i++) {
      Chain c = chosen.get(i);
      JsonNode veh = Js.byId(Js.get(f.state(), "vehicles"), c.vehicleId);
      JsonNode drv = Js.byId(Js.get(f.state(), "drivers"), c.driverId);
      assertTrue(veh != null, "chain with no vehicle on " + f.name());
      assertTrue(drv != null, "chain with no driver on " + f.name());
      // I8 and capacity: the bus seats the peak headcount and carries a vignette if needed.
      assertTrue(Js.num(Js.get(veh, "seats")) >= c.maxPax,
          "capacity violated on " + f.name() + ": " + c.maxPax + " in " + Js.num(Js.get(veh, "seats")) + " seats");
      if (Logic.chainNeedsVignette(f.state(), c))
        assertTrue(Js.truthy(Js.get(veh, "hasVignette")), "vignette violated on " + f.name());
      // Availability across the whole chain window.
      assertTrue(Optimizer.driverAvailableFor(drv, f.weekday(), c.start, c.end),
          "driver unavailable for their own chain on " + f.name());

      // I6: a shared driver or vehicle must physically be able to do both chains.
      for (int j = i + 1; j < chosen.size(); j++) {
        Chain o = chosen.get(j);
        boolean shared = java.util.Objects.equals(c.driverId, o.driverId)
            || java.util.Objects.equals(c.vehicleId, o.vehicleId);
        if (!shared) continue;
        assertTrue(!(c.start < o.end && o.start < c.end), "shared resource overlaps in time on " + f.name());
        Chain first = c.start <= o.start ? c : o, second = c.start <= o.start ? o : c;
        double dead = Geo.legMin(f.state(), first.tasks.get(first.tasks.size() - 1).to, second.tasks.get(0).from);
        assertTrue(first.end + dead <= second.start,
            "no room for the deadhead between two chains sharing a resource on " + f.name());
      }
    }

    // ADR-24: every uncovered task carries a non-empty reason.
    for (Uncovered u : out.uncovered) {
      assertTrue(u.reasons != null && !u.reasons.isEmpty(), "uncovered task with no reason on " + f.name());
      for (String r : u.reasons) assertTrue(r != null && !r.isEmpty(), "empty reason on " + f.name());
    }

    // Local improvement never raises the objective.
    assertTrue(out.improve.after <= out.improve.before + 1e-6,
        "improvement loop raised the objective on " + f.name());

    // Chain ids are unique, or two chains would collide in the saved schedule.
    Set<String> ids = new LinkedHashSet<>();
    for (Chain c : out.chains) if (c.id != null) assertTrue(ids.add(c.id), "duplicate chain id on " + f.name());
  }

  /**
   * A locked task's chain keeps its driver and bus even when that bus is too small, and
   * {@code resolveDay} is what says so.
   *
   * <p>Found by this suite rather than reasoned out: fixture 45-everything-1 puts an
   * eleven-person task on an eight-seat bus, and the Java port reproduced it exactly, which is
   * how we know it is the JavaScript's behaviour and not a port bug. It is defensible — a lock
   * is the user's explicit instruction and ADR-24 is satisfied because the issue is visible —
   * but the property test in {@code test/optimizer.test.js} asserts capacity over every chain
   * and only passes because it never generates a saved schedule, so the claim is wider than
   * the guarantee.
   *
   * <p>What must not change silently is the REPORTING. If a future optimizer starts fixing
   * these quietly, or stops explaining them, this test goes red.
   */
  @ParameterizedTest(name = "a locked over-capacity chain is kept and reported · {0}")
  @MethodSource("fixtures")
  void lockedChainsAreNotReCheckedButAreReported(Fixture f) {
    OptimizeResult out = Optimizer.optimizeDay(f.state(), f.weekday(), f.weekMon());
    if (out.empty) return;
    DayResult rd = Optimizer.resolveDay(f.state(), f.weekday(), f.weekMon());

    for (Chain c : out.chains) {
      if (!Boolean.TRUE.equals(c.hasLocked)) continue;
      JsonNode veh = Js.byId(Js.get(f.state(), "vehicles"), c.vehicleId);
      if (veh == null || Js.num(Js.get(veh, "seats")) >= c.maxPax) continue;

      // The chain is kept, so the user's lock is honoured rather than quietly undone.
      assertTrue(!c.tasks.isEmpty(), "a locked chain was emptied on " + f.name());

      // And the same over-capacity chain carries a visible explanation in the resolved view.
      boolean explained = false;
      for (Chain r : rd.chains)
        if (r.issues != null)
          for (String issue : r.issues)
            if (issue.contains("létszám") && issue.contains("férőhelyét")) explained = true;
      assertTrue(explained,
          "a locked chain exceeds its bus on " + f.name() + " with nothing said about it (ADR-24)");
    }
  }
}
