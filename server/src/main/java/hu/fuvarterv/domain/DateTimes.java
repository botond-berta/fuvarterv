package hu.fuvarterv.domain;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * Dates and times, ported from {@code src/domain/datetime.js}.
 *
 * <p>Only the parts the domain computes with. The formatters ({@code fmtDate},
 * {@code fmtWeekRange}) stay in JavaScript: they are presentation, they are Hungarian, and
 * ADR-29 draws the line at what prices, times or schedules.
 *
 * <p>The JavaScript works in LOCAL time deliberately — a training is "Wednesday at half
 * past four" in the club's own timezone. {@link LocalDate} is the faithful port precisely
 * because it has no timezone to shift across: the original's
 * {@code Math.round(msDifference / 86400000)} exists to round a DST-shifted difference back
 * to whole calendar days, which is what {@code ChronoUnit.DAYS} gives directly.
 */
public final class DateTimes {
  private DateTimes() {}

  /** {@code timeToMin}: null for an empty or absent time, NOT zero. The caller decides. */
  public static Double timeToMin(String t) {
    if (t == null || t.isEmpty()) return null;
    int i = t.indexOf(':');
    if (i < 0) {
      double h = parse(t);
      return Double.isNaN(h) ? null : h * 60;
    }
    double h = parse(t.substring(0, i));
    double m = parse(t.substring(i + 1));
    // JavaScript: "x:y".split(":").map(Number) yields NaN, and NaN*60+NaN is NaN — which
    // every later comparison then treats as false. Kept as NaN rather than "fixed" to 0.
    return h * 60 + m;
  }

  private static double parse(String s) {
    String t = s.trim();
    if (t.isEmpty()) return 0;                       // Number("") is 0
    if (!t.matches("[+-]?((\\d+\\.?\\d*)|(\\.\\d+))([eE][+-]?\\d+)?")) return Double.NaN;
    try { return Double.parseDouble(t); } catch (NumberFormatException e) { return Double.NaN; }
  }

  /** {@code minToTime}: clamped to one day, so a negative or runaway minute still prints. */
  public static String minToTime(double m) {
    double v = Math.max(0, Math.min(1439, Js.round(m)));
    long iv = (long) v;
    return pad2(iv / 60) + ":" + pad2(iv % 60);
  }

  public static String pad2(long n) {
    String s = Long.toString(n);
    return s.length() >= 2 ? s : "0" + s;
  }

  public static String toISO(LocalDate d) {
    return d.getYear() + "-" + pad2(d.getMonthValue()) + "-" + pad2(d.getDayOfMonth());
  }

  /** {@code parseISO}: returns null for an absent date, mirroring the guard in occursOnSameDay. */
  public static LocalDate parseISO(String s) {
    if (s == null || s.isEmpty()) return null;
    String[] p = s.split("-");
    if (p.length < 3) return null;
    try {
      return LocalDate.of(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]));
    } catch (RuntimeException e) { return null; }
  }

  /** Monday-first weekday index: Monday is 0, Sunday is 6. */
  public static int weekdayIdx(LocalDate d) {
    return d.getDayOfWeek().getValue() - 1;
  }

  public static Integer weekdayIdx(String iso) {
    LocalDate d = parseISO(iso);
    return d == null ? null : weekdayIdx(d);
  }

  public static LocalDate addDays(LocalDate d, int n) { return d.plusDays(n); }

  public static LocalDate mondayOf(LocalDate d) { return d.minusDays(weekdayIdx(d)); }

  /** Whole calendar days between two dates — see the class note on why this is the faithful port. */
  public static long daysBetween(LocalDate from, LocalDate to) {
    return ChronoUnit.DAYS.between(from, to);
  }
}
