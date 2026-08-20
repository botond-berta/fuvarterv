import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/*
 * The login screen used to answer every failure with "Hibás e-mail vagy jelszó",
 * throwing away the reason Supabase had already told it. That turned a two-click
 * fix (confirm the user) into a hunt through the browser's Network tab. These
 * tests pin each branch to the message it must produce.
 */

const signInWithPassword = vi.fn();

vi.mock("../src/supabaseClient.js", () => ({
  supabase: { auth: { signInWithPassword: (...a) => signInWithPassword(...a),
                      getSession: async () => ({ data: { session: null } }),
                      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
  isConfigured: true,
  WORKSPACE_ID: "fuvarterv:v1",
}));
vi.mock("../src/supabaseStorage.js", () => ({ supabaseStorage: {} }));

const { default: AuthGate, loginErrorMessage } = await import("../src/AuthGate.jsx");

let container, root;
beforeEach(() => {
  signInWithPassword.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

async function mountAndSubmit() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AuthGate><div>app</div></AuthGate>);
  });
  await act(async () => { await Promise.resolve(); });
  const [emailInput, pwInput] = container.querySelectorAll("input");
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => { set(emailInput, "edzo@klub.hu"); set(pwInput, "titok123"); });
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  return {
    error: container.querySelector(".v-error")?.textContent ?? "",
    button: container.querySelector('button[type="submit"]'),
  };
}

describe("loginErrorMessage maps each cause to something actionable", () => {
  test("an unconfirmed account names the fix, not a wrong password", () => {
    const msg = loginErrorMessage({ code: "email_not_confirmed", status: 400 });
    expect(msg).toMatch(/nincs megerősítve/i);
    expect(msg).not.toMatch(/Hibás e.mail vagy jelszó/i);
  });

  test("bad credentials stay deliberately vague", () => {
    // Splitting "no such user" from "wrong password" would leak who has an account.
    expect(loginErrorMessage({ code: "invalid_credentials", status: 400 }))
      .toBe("Hibás e‑mail vagy jelszó.");
  });

  test("a disabled email provider says so, and that sign-ups may stay off", () => {
    const msg = loginErrorMessage({ code: "email_provider_disabled", status: 422 });
    expect(msg).toMatch(/ki van kapcsolva/i);
    expect(msg).toMatch(/Enable sign-ups/);
  });

  test("a bad API key is flagged as a server misconfiguration", () => {
    const msg = loginErrorMessage({ status: 401, message: "Invalid API key" });
    expect(msg).toMatch(/API kulcs/i);
    expect(msg).toMatch(/nem rajtad múlik/i);
  });

  test("a network failure is not reported as a credential problem", () => {
    const msg = loginErrorMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch" });
    expect(msg).toMatch(/Nem sikerült elérni a szervert/i);
  });

  test("an unrecognised failure surfaces the server's own status and text", () => {
    // This is the 422 that sent us to the Network tab: the message must carry
    // enough for the user to quote it, rather than hiding behind a platitude.
    const msg = loginErrorMessage({ status: 422, code: "validation_failed", message: "Unable to validate" });
    expect(msg).toContain("422");
    expect(msg).toContain("validation_failed");
    expect(msg).toContain("Unable to validate");
  });
});

describe("the login form surfaces those messages", () => {
  test("shows the unconfirmed-account message", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed", status: 400 } });
    const { error } = await mountAndSubmit();
    expect(error).toMatch(/nincs megerősítve/i);
  });

  test("a thrown error leaves the button usable again", async () => {
    // Regression: without try/catch the rejection escaped submit(), setStatus was
    // never reached, and the button stayed on "Belépés…" forever with no message.
    signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    const { error, button } = await mountAndSubmit();
    expect(error).toMatch(/Nem sikerült elérni a szervert/i);
    expect(button.disabled).toBe(false);
    expect(button.textContent).not.toMatch(/Belépés…/);
  });

  test("a successful sign-in shows no error", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const { error } = await mountAndSubmit();
    expect(error).toBe("");
  });
});
