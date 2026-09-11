import { describe, test, expect, vi, beforeEach } from "vitest";

/*
 * fetchRole decides what a user sees after signing in. It carries two obligations
 * at once: fail closed (no row means driver), while NOT bricking an older database.
 * If the user_roles table does not exist yet, everyone stays admin, because in that
 * state the server is not restricting anything either.
 */

const maybeSingle = vi.fn();
const eqArgs = [];

vi.mock("../src/supabaseClient.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col, val) => {
          eqArgs.push(val);
          return { maybeSingle };
        },
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  isConfigured: true,
  WORKSPACE_ID: "fuvarterv:v1",
}));
vi.mock("../src/supabaseStorage.js", () => ({ supabaseStorage: {} }));

const { fetchRole } = await import("../src/AuthGate.jsx");

beforeEach(() => {
  maybeSingle.mockReset();
  eqArgs.length = 0;
});

describe("fetchRole", () => {
  test("an admin row yields admin", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "admin" }, error: null });
    expect(await fetchRole("edzo@klub.hu")).toEqual({ role: "admin", error: null });
  });

  test("a driver row — and a MISSING row — both yield sofőr", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "sofor" }, error: null });
    expect((await fetchRole("sofor@klub.hu")).role).toBe("sofor");
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await fetchRole("senki@klub.hu")).role).toBe("sofor");
  });

  test("the lookup is by lower-cased e-mail", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await fetchRole("Edzo@Klub.HU");
    expect(eqArgs).toEqual(["edzo@klub.hu"]);
  });

  test("a missing user_roles table means the 0004 migration has not run: admin", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: 'relation "public.user_roles" does not exist' } });
    expect((await fetchRole("edzo@klub.hu")).role).toBe("admin");
    maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.user_roles' in the schema cache" } });
    expect((await fetchRole("edzo@klub.hu")).role).toBe("admin");
  });

  test("any other error blocks instead of guessing a role", async () => {
    const error = { code: "XX000", message: "boom" };
    maybeSingle.mockResolvedValue({ data: null, error });
    expect(await fetchRole("edzo@klub.hu")).toEqual({ role: null, error });
    maybeSingle.mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await fetchRole("edzo@klub.hu");
    expect(r.role).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
