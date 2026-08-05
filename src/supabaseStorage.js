import { supabase } from "./supabaseClient.js";

/*
 * Supabase-backed implementation of the `window.storage` KV contract that
 * fuvarterv.jsx expects (get / set / delete / list). The whole app state is a
 * single JSON blob stored in one `public.app_state` row:
 *
 *   id text (pk) | data jsonb | updated_at timestamptz
 *
 * The app only uses get(key) and set(key, value); delete/list are provided for
 * contract completeness. `value` on set is an already-stringified JSON string
 * (fuvarterv.jsx does JSON.stringify before calling set and JSON.parse after
 * get), so we parse it into the jsonb column on write and stringify on read.
 *
 * Single-editor model with a stale-write guard: we remember the updated_at we
 * last read, and only overwrite the row if it still matches. If someone else
 * saved in the meantime, we refuse to clobber and fire a `fuvarterv:stale`
 * event so the UI can prompt a reload.
 *
 * Writes are serialized (one in flight at a time). The app debounces saves but
 * a slow round-trip could otherwise let two overlap; the second would read a
 * stale `lastSeen` and misfire the stale guard, so we chain them instead.
 */

// Last updated_at we observed per key. Undefined means "we have not read a row"
// (fresh workspace) — the first save inserts.
const lastSeen = new Map();

// Serializes writes: every set() waits for the previous one to settle before
// running, so `lastSeen` is always current when the guard checks it.
let writeChain = Promise.resolve();

function announceStale() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fuvarterv:stale"));
  }
}

function announceSaveError(error) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fuvarterv:saveerror", { detail: error }));
  }
}

async function doSet(key, value) {
  const parsed = JSON.parse(value);
  const prev = lastSeen.get(key);

  // Fresh workspace: no row observed yet → insert.
  if (prev === undefined) {
    const { data, error } = await supabase
      .from("app_state")
      .insert({ id: key, data: parsed })
      .select("updated_at")
      .single();

    if (error) {
      // Unique violation → a row appeared since we started (another editor
      // seeded first). Don't clobber it — this is a stale conflict, not a
      // save failure.
      if (error.code === "23505") {
        announceStale();
        throw new Error("stale write: workspace already initialised elsewhere");
      }
      announceSaveError(error);
      throw error;
    }
    lastSeen.set(key, data.updated_at);
    return { key, value };
  }

  // Guarded update: only succeeds if the row is still what we last read.
  const { data, error } = await supabase
    .from("app_state")
    .update({ data: parsed, updated_at: new Date().toISOString() })
    .eq("id", key)
    .eq("updated_at", prev)
    .select("updated_at");

  if (error) {
    announceSaveError(error);
    throw error;
  }

  if (!data || data.length === 0) {
    // Someone else wrote since we loaded. Keep our stale marker so further
    // saves keep failing until the user reloads, and surface it in the UI.
    announceStale();
    throw new Error("stale write: workspace changed elsewhere");
  }

  lastSeen.set(key, data[0].updated_at);
  return { key, value };
}

export const supabaseStorage = {
  async get(key) {
    const { data, error } = await supabase
      .from("app_state")
      .select("data, updated_at")
      .eq("id", key)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      // No row yet: mirror the localStorage shim so loadState() seeds.
      throw new Error("key not found");
    }

    lastSeen.set(key, data.updated_at);
    return { key, value: JSON.stringify(data.data) };
  },

  set(key, value) {
    // Chain onto the previous write so only one runs at a time. The chain must
    // never stay rejected (a failed save would block every later save), so we
    // swallow the result for the chain while still returning the real promise
    // to the caller.
    const run = writeChain.then(
      () => doSet(key, value),
      () => doSet(key, value),
    );
    writeChain = run.then(
      () => {},
      () => {},
    );
    return run;
  },

  async delete(key) {
    const { error } = await supabase.from("app_state").delete().eq("id", key);
    if (error) throw error;
    lastSeen.delete(key);
    return { key, deleted: true };
  },

  async list(prefix = "") {
    const { data, error } = await supabase
      .from("app_state")
      .select("id")
      .like("id", `${prefix}%`);
    if (error) throw error;
    return { keys: (data || []).map((r) => r.id) };
  },
};
