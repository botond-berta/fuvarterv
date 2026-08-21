/* Vector — szerepkör-kezelés (user_roles tábla a Supabase-ben).
   Csak admin hívhatja sikerrel: a tábla írás-szabályai (RLS, 0004-es migráció)
   mindenki mást elutasítanak. A supabase kliens itt közvetlen import — a
   window.storage varrat szándékosan csak a munkaterület-blobra vonatkozik, a
   szerepkörök nem részei az app-állapotnak. Nem konfigurált környezetben
   (tesztek, storage-shim) minden hívás beszédes hibával tér vissza; a hívó
   felület ebből "nincs kapcsolat" állapotot mutat. */

import { supabase, isConfigured } from "../supabaseClient.js";

function requireClient() {
  if (!isConfigured || !supabase) {
    throw Object.assign(new Error("Supabase nincs beállítva"), { code: "NOT_CONFIGURED" });
  }
  return supabase;
}

/* A user_roles tábla hiánya (a 0004-es migráció még nem futott le) külön eset:
   a felület ilyenkor teendőt ír ki, nem hálózati hibát. */
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
