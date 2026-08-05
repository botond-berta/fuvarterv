import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True only when both env vars are present. When false we avoid calling
// createClient (which throws on missing config) so AuthGate can show a helpful
// message instead of a blank screen.
export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  console.error(
    "Hiányzó Supabase konfiguráció: állítsd be a VITE_SUPABASE_URL és " +
      "VITE_SUPABASE_ANON_KEY változókat a .env fájlban (lásd .env.example).",
  );
}

export const supabase = isConfigured ? createClient(url, anonKey) : null;

// One shared workspace: every authenticated user reads/writes the same row.
// Matches the STORAGE_KEY the app already uses in fuvarterv.jsx.
export const WORKSPACE_ID = "fuvarterv:v1";
