import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True only when both env vars are present. When false we avoid calling
// createClient (which throws on missing config), so AuthGate can show a helpful
// message instead of a blank screen.
export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  console.error(
    "Missing Supabase configuration: set VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_ANON_KEY in your .env file (see .env.example).",
  );
}

export const supabase = isConfigured ? createClient(url, anonKey) : null;

// One shared workspace: every authenticated user reads and writes the same row.
// Re-exported rather than restated, so the key has exactly one definition on the
// client side. It must also match workspace_id() in the database schema.
export { STORAGE_KEY as WORKSPACE_ID } from "./data/storage.js";
