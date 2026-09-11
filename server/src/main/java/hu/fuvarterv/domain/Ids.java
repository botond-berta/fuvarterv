package hu.fuvarterv.domain;

import java.util.function.Supplier;

/**
 * The id generator, behind a seam.
 *
 * <p>The JavaScript {@code uid()} is {@code Math.random().toString(36).slice(2, 10)}. That
 * does not breach E2, which forbids randomness on a DECISION path, but it does mean
 * {@code optimizeDay}'s output is not reproducible field for field: a skeleton chain gets a
 * fresh id on every call. The parity fixtures therefore blank those ids on both sides, and
 * this seam lets a test make them predictable instead of unpredictable-but-ignored.
 *
 * <p>ADR-29 suggests giving the JavaScript side the same seam if stable task ids (P2-1) land
 * first, at which point the blanking can go.
 */
public final class Ids {
  private Ids() {}

  private static volatile Supplier<String> generator = Ids::random;

  public static String uid() { return generator.get(); }

  /** Test-only: install a deterministic generator. Pass null to restore the random one. */
  public static void setGenerator(Supplier<String> g) {
    generator = g == null ? Ids::random : g;
  }

  private static String random() {
    // The same shape as the JavaScript: up to 8 characters of base-36.
    String s = Long.toString(Math.abs(java.util.concurrent.ThreadLocalRandom.current().nextLong()), 36);
    return s.length() > 8 ? s.substring(0, 8) : s;
  }
}
