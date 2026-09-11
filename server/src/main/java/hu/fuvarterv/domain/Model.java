package hu.fuvarterv.domain;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/**
 * The computed shapes: tasks, timetables, chains, shifts, costs.
 *
 * <p>These are typed because they are OUR shapes — we produce them, so nothing is lost by
 * naming the fields. The workspace state on the other side stays a raw {@link JsonNode}:
 * there is no schema version (ADR-05), so a typed round-trip of the blob would silently drop
 * any field a newer client saved. ADR-29 states that rule; this class is the half of it that
 * is allowed to be typed.
 *
 * <p>Every number is a {@code double} for the reason given in {@link Js}: JavaScript has no
 * other kind, and introducing integer division here would change results.
 */
public final class Model {
  private Model() {}

  /** One stop's headcount inside a task's breakdown. */
  public static final class Breakdown {
    public String stationId;
    public double count;

    public Breakdown() {}
    public Breakdown(String stationId, double count) { this.stationId = stationId; this.count = count; }
  }

  /** A timetabled stop. {@code count} is null in a bare plan and set once it is on a task. */
  public static final class PlanStop {
    public String stationId;
    public double arr;
    public double dep;
    public Double count;

    public PlanStop() {}
    public PlanStop(String stationId, double arr, double dep) {
      this.stationId = stationId; this.arr = arr; this.dep = dep;
    }
    public PlanStop withCount(double c) {
      PlanStop p = new PlanStop(stationId, arr, dep);
      p.count = c;
      return p;
    }
  }

  /**
   * A direction's timetable. Exactly one of {@code venueArr} and {@code venueDep} is set:
   * outbound is computed backwards to an arrival, return forwards from a departure, and the
   * field name says which, as it does in the JavaScript.
   */
  public static final class PlanResult {
    public List<PlanStop> stops = new ArrayList<>();
    public Double venueArr;
    public Double venueDep;
    public double start;
    public double end;
  }

  /** One outbound or return unit of work. */
  public static final class Task {
    public String id;
    public String dir;
    public String teamId;
    public String trainingId;
    public double pax;
    public String label;
    public List<Breakdown> breakdown = new ArrayList<>();
    public String from;
    public String to;
    public double start;
    public double end;
    public List<PlanStop> plan = new ArrayList<>();
    public double venueTime;
    /** Null out of genDayTasks; set by resolveDay from the saved chain's lock flag. */
    public Boolean locked;

    public Task copy() {
      Task t = new Task();
      t.id = id; t.dir = dir; t.teamId = teamId; t.trainingId = trainingId;
      t.pax = pax; t.label = label; t.breakdown = breakdown; t.from = from; t.to = to;
      t.start = start; t.end = end; t.plan = plan; t.venueTime = venueTime; t.locked = locked;
      return t;
    }

    public Task withLocked(boolean l) {
      Task t = copy();
      t.locked = l;
      return t;
    }
  }

  /** The join between two consecutive tasks in a chain. */
  public static final class Link {
    public Task a;
    public Task b;
    public double dead;
    public double idle;
    public boolean infeasible;
    /** {@code short} in the JavaScript, which is a Java keyword — the wire name is kept. */
    @JsonProperty("short")
    public double shortBy;
  }

  /** Tasks one driver and bus run back to back. */
  public static final class Chain {
    public String id;
    public String driverId;
    public String vehicleId;
    public Boolean hasLocked;
    /** The resolved state objects, attached by resolveDay for the view. */
    public JsonNode driver;
    public JsonNode vehicle;
    public List<String> issues;
    public List<Task> tasks = new ArrayList<>();
    public List<Link> links = new ArrayList<>();
    public double start;
    public double end;
    public double maxPax;

    /** A shallow copy, the equivalent of the JavaScript's object spread. */
    public Chain copy() {
      Chain c = new Chain();
      c.id = id; c.driverId = driverId; c.vehicleId = vehicleId; c.hasLocked = hasLocked;
      c.driver = driver; c.vehicle = vehicle; c.issues = issues;
      c.tasks = tasks; c.links = links; c.start = start; c.end = end; c.maxPax = maxPax;
      return c;
    }
  }

  /** A depot-to-depot interval. */
  public static final class Span {
    public double start;
    public double end;

    public Span() {}
    public Span(double start, double end) { this.start = start; this.end = end; }
  }

  /** One chain's occupancy of a driver and a vehicle. */
  public static final class Use {
    public String driverId;
    public String vehicleId;
    public double start;
    public double end;
    public String from;
    public String to;

    public Use() {}
    public Use(String driverId, String vehicleId, double start, double end, String from, String to) {
      this.driverId = driverId; this.vehicleId = vehicleId;
      this.start = start; this.end = end; this.from = from; this.to = to;
    }
  }

  public static final class Pay {
    public double paid;
    public double cost;
    public List<Span> shifts = new ArrayList<>();
  }

  /** One training's appearance in one week. */
  public static final class Occurrence {
    public JsonNode training;
    public int dayIdx;
    public String dateISO;

    public Occurrence(JsonNode training, int dayIdx, String dateISO) {
      this.training = training; this.dayIdx = dayIdx; this.dateISO = dateISO;
    }
  }

  public static final class GenTasks {
    public List<Task> tasks = new ArrayList<>();
    public List<String> skipped = new ArrayList<>();
  }

  public static final class DayStats {
    public int drivers;
    public int chains;
    public double paidMin;
    public double dead;
    public double idle;
    public double cost;
  }

  public static final class DayResult {
    public List<Task> tasks = new ArrayList<>();
    public List<Chain> chains = new ArrayList<>();
    public List<Task> unassigned = new ArrayList<>();
    public List<String> skipped = new ArrayList<>();
  }

  /** A task that could not be placed, with the reason (ADR-24 — the reason is not optional). */
  public static final class Uncovered {
    public Task task;
    public List<String> reasons;

    public Uncovered(Task task, List<String> reasons) { this.task = task; this.reasons = reasons; }
  }

  public static final class Improve {
    public double before;
    public double after;
  }

  /**
   * The optimiser's proposal. When {@code empty} is true the JavaScript returns only
   * {@code empty} and {@code notes}, so every other field stays null here rather than being
   * an empty list: a missing key and an empty array are not the same answer.
   */
  public static final class OptimizeResult {
    public boolean empty;
    public List<Chain> chains;
    public List<Uncovered> uncovered;
    public List<String> notes;
    public DayStats stats;
    public Improve improve;
  }

  public static final class RideStop {
    public String id;
    public String stationId;
    public String time;
    /** A number when somebody boards here, otherwise the empty string, as the editor stores it. */
    public Object count;
  }

  public static final class Ride {
    public String id;
    public String trainingId;
    public Integer day;
    public String date;
    public String vehicleId;
    public String driverId;
    public String dir;
    public String source;
    public List<RideStop> stops = new ArrayList<>();
  }
}
