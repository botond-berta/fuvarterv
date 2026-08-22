import { describe, test, expect, vi, beforeEach } from "vitest";
import { isNotFound } from "../vector.jsx";

/*
 * Proves task 1: a read failure that happens *after* the pre-flight read (i.e.
 * inside the app's own loadState → window.storage.get) is distinguishable from a
 * genuinely empty workspace, so the app seeds ONLY on true not-found and never
 * mounts on seed data after a transient failure.
 *
 * We drive supabaseStorage.get() with a mocked Supabase client and then apply
 * isNotFound() — the exact predicate the App load effect uses to decide between
 * "seed sample data" and "show the retry screen".
 */

const h = vi.hoisted(() => ({ result: { data: null, error: null } }));

vi.mock("../src/supabaseClient.js", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(h.result),
  };
  return {
    supabase: { from: () => chain },
    isConfigured: true,
    WORKSPACE_ID: "vector:v1",
  };
});

const { supabaseStorage } = await import("../src/supabaseStorage.js");

// Mirrors the App load path: loadState() calls get(); the effect seeds only when
// isNotFound(err) is true, otherwise it shows the retry screen.
async function decideInitialLoad() {
  try {
    await supabaseStorage.get("vector:v1");
    return "loaded";
  } catch (e) {
    return isNotFound(e) ? "seed" : "retry-screen";
  }
}

beforeEach(() => { h.result = { data: null, error: null }; });

describe("load-failure vs empty-workspace", () => {
  test("empty workspace (no row) → typed NOT_FOUND → app seeds", async () => {
    h.result = { data: null, error: null };
    await expect(supabaseStorage.get("vector:v1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await decideInitialLoad()).toBe("seed");
  });

  test("transient read failure → NOT flagged as not-found → retry screen, never seed", async () => {
    h.result = { data: null, error: { message: "network down", code: "ETIMEDOUT" } };
    const err = await supabaseStorage.get("vector:v1").catch((e) => e);
    expect(isNotFound(err)).toBe(false);
    expect(await decideInitialLoad()).toBe("retry-screen");
  });

  test("successful read → loads, no seeding", async () => {
    h.result = { data: { data: { teams: [] }, updated_at: "2026-08-05T00:00:00Z" }, error: null };
    expect(await decideInitialLoad()).toBe("loaded");
  });

  test("isNotFound is defensive against odd inputs", () => {
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
    expect(isNotFound(new Error("plain"))).toBe(false);
    expect(isNotFound({ code: "NOT_FOUND" })).toBe(true);
  });
});
