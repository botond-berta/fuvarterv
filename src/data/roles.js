/* Fuvarterv — role management, backed by the user_roles table.

   Only an admin can call these successfully: the table's write policies reject
   everyone else. The Supabase client is imported directly here, on purpose — the
   window.storage seam covers the workspace blob only, and roles are not part of the
   application state.

   In an unconfigured environment (tests, or a storage shim) every call fails with a
   descriptive error, which the calling screen renders as a "no connection" state. */

import { supabase, isConfigured } from "../supabaseClient.js";

function requireClient() {
  if (!isConfigured || !supabase) {
    throw Object.assign(new Error("Supabase is not configured"), { code: "NOT_CONFIGURED" });
  }
  return supabase;
}

/* A missing user_roles table (the schema has not been applied yet) is its own case:
   the UI then prints what to do about it rather than a network error. */
export function isMissingRolesTable(error) {
  const raw = `${error?.code || ""} ${error?.message || ""}`;
  return raw.includes("42P01") || raw.includes("PGRST205");
}

export async function listRoles() {
  const { data, error } = await requireClient()
    .from("user_roles")
    .select("email, role")
    .order("email");
  if (error) throw error;
  return data || [];
}

export async function upsertRole(email, role) {
  const em = (email || "").trim().toLowerCase();
  if (!em) throw new Error("Hiányzó e-mail-cím");
  const { error } = await requireClient()
    .from("user_roles")
    .upsert({ email: em, role }, { onConflict: "email" });
  if (error) throw error;
  return { email: em, role };
}

export async function removeRole(email) {
  const em = (email || "").trim().toLowerCase();
  const { error } = await requireClient().from("user_roles").delete().eq("email", em);
  if (error) throw error;
  return { email: em };
}
