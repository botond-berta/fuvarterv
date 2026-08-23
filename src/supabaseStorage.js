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

// Last blob we read or wrote per key. Used to archive the *previous* version to
// app_state_history when the next save overwrites it.
const lastData = new Map();

// Last blob we *attempted* to write per key, kept even when the write appears to
// fail. If a committed write loses its response, the server ends up holding this
// value while `lastSeen` still points at the pre-write timestamp — the guard then
// matches 0 rows and looks exactly like someone else having saved. Remembering
// the attempt lets us tell our own landed write apart from a real conflict.
const lastAttempt = new Map();

// How many snapshots to keep per workspace in app_state_history.
const HISTORY_LIMIT = 20;

// jsonb normalises key order on the round-trip, so a plain JSON.stringify of a
// client object never matches one read back. Sort keys recursively to compare.
function stableStr(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStr).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStr(v[k])}`).join(",")}}`;
}

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

// Best-effort: archive the blob that was just replaced, then prune to the last
// HISTORY_LIMIT snapshots. Fire-and-forget — history must never fail a save, so
// all errors (incl. the table not existing yet) are swallowed here.
async function archivePrevious(key, blob) {
  if (blob === undefined) return;
  try {
    const { error } = await supabase
      .from("app_state_history")
      .insert({ workspace_id: key, data: blob });
    if (error) throw error;
    const { data: extra } = await supabase
      .from("app_state_history")
      .select("id")
      .eq("workspace_id", key)
      .order("saved_at", { ascending: false })
      .order("id", { ascending: false })   // tiebreak: same-millisecond snapshots
      .range(HISTORY_LIMIT, HISTORY_LIMIT + 1000);
    if (extra && extra.length) {
      await supabase.from("app_state_history").delete().in("id", extra.map((r) => r.id));
    }
  } catch (e) {
    if (typeof console !== "undefined") console.warn("Előzmény mentése sikertelen:", e);
  }
}

async function doSet(key, value, retried = false) {
  const parsed = JSON.parse(value);
  const prev = lastSeen.get(key);
  lastAttempt.set(key, parsed);

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
    // Fresh workspace: no previous blob to archive.
    lastSeen.set(key, data.updated_at);
    lastData.set(key, parsed);
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
    // The guard matched nothing. Before blocking the user, find out whether this
    // is a real conflict or our own earlier write whose response we never saw.
    const { data: cur, error: readErr } = await supabase
      .from("app_state")
      .select("data, updated_at")
      .eq("id", key)
      .maybeSingle();

    if (!retried && !readErr && cur && stableStr(cur.data) === stableStr(lastAttempt.get(key))) {
      // The server already holds exactly what we last tried to write: that write
      // did commit, only the response was lost. Adopt the row's timestamp and
      // retry this save against it instead of hard-blocking the workspace.
      lastSeen.set(key, cur.updated_at);
      lastData.set(key, cur.data);
      return doSet(key, value, true);
    }

    // Someone else really did write since we loaded. Keep our stale marker so
    // further saves keep failing until the user reloads, and surface it in the UI.
    announceStale();
    throw new Error("stale write: workspace changed elsewhere");
  }

  // Overwrite succeeded → archive the blob we just replaced (fire-and-forget),
  // then adopt the new one as current. An unchanged blob is never archived: the
  // history holds only 20 slots, and filling them with identical copies would
  // destroy exactly the restore points a user goes looking for.
  const replaced = lastData.get(key);
  lastSeen.set(key, data[0].updated_at);
  lastData.set(key, parsed);
  if (stableStr(replaced) !== stableStr(parsed)) archivePrevious(key, replaced);
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
      // No row yet → a *typed* not-found error. Only this specific case should
      // make the app seed sample data; any other failure (network, permissions)
      // keeps its own error so the caller can tell them apart and never seeds
      // over real data it simply failed to read. Postgres/PostgREST error codes
      // never collide with this sentinel.
      throw Object.assign(new Error("key not found"), { code: "NOT_FOUND" });
    }

    lastSeen.set(key, data.updated_at);
    lastData.set(key, data.data);
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
    lastData.delete(key);
    return { key, deleted: true };
  },

  // Kijelentkezéskor hívandó: a modul-szintű gyorsítótár nem élhet túl egy
  // felhasználóváltást (a következő get() amúgy is felülírná, de a lastData a
  // korábbi felhasználó teljes blobját tartaná a memóriában addig is).
  reset() {
    lastSeen.clear();
    lastData.clear();
    lastAttempt.clear();
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
