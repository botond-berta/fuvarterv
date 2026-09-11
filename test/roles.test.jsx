import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App.jsx";
import { seedState, ensureShape } from "../src/data/seed.js";
import { RoleContext } from "../src/roleContext.js";
import { DriverScreen, defaultDriverId } from "../src/screens/DriverScreen.jsx";

/*
 * The driver role: the UI offers only the driver tab and NEVER writes. The real
 * prohibition lives on the server, in the row level security policies. These tests
 * pin down that the client does not even try: a driver session must not issue a
 * single storage.set call, or every time they opened the app an error would flash.
 */

const KEY = "fuvarterv:v1";

function fakeStorage(initial) {
  const rows = new Map();
  if (initial) rows.set(KEY, JSON.stringify(initial));
  return {
    sets: [],
    async get(key) {
      if (!rows.has(key)) throw Object.assign(new Error("key not found"), { code: "NOT_FOUND" });
      return { key, value: rows.get(key) };
    },
    async set(key, value) {
      rows.set(key, value);
      this.sets.push(value);
      return { key, value };
    },
    async delete(key) { rows.delete(key); return { key, deleted: true }; },
    async list() { return { keys: [...rows.keys()] }; },
  };
}

let container, root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
});

async function mountAs(role, email) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <RoleContext.Provider value={{ role, email }}>
        <App />
      </RoleContext.Provider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

describe("driver role in the app shell", () => {
  test("a driver sees only the Sofőr tab and no restore button", async () => {
    window.storage = fakeStorage(seedState());
    await mountAs("sofor", "gera@klub.hu");
    const tabs = [...container.querySelectorAll("nav.tabbar button")];
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toContain("Sofőr");
    expect(container.textContent).toContain("Sofőr nézet");
    expect(container.querySelector('button[aria-label="Korábbi mentések"]')).toBeNull();
    // Sign-out and help belong to the driver too.
    expect(container.querySelector('button[aria-label="Kijelentkezés"]')).toBeTruthy();
  });

  test("a driver session never writes", async () => {
    const storage = fakeStorage(seedState());
    window.storage = storage;
    await mountAs("sofor", "gera@klub.hu");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(storage.sets).toHaveLength(0);
  });

  test("a driver on an empty workspace gets a notice instead of seeding", async () => {
    // For an admin an empty workspace seeds sample data AND saves it, which is what
    // creates the row. For a driver that same write is forbidden on the server, so
    // instead of attempting it they get a message they can act on.
    const storage = fakeStorage(null);
    window.storage = storage;
    await mountAs("sofor", "gera@klub.hu");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(container.textContent).toContain("Még nincs feltöltött adat");
    expect(storage.sets).toHaveLength(0);
  });

  test("an admin keeps every tab (the default context is admin)", async () => {
    window.storage = fakeStorage(seedState());
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await act(async () => { await Promise.resolve(); });
    const tabs = [...container.querySelectorAll("nav.tabbar button")];
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('button[aria-label="Korábbi mentések"]')).toBeTruthy();
  });
});

describe("the driver screen opens on the signed-in driver", () => {
  const stateWithEmails = () => {
    const s = ensureShape(seedState());
    s.drivers = s.drivers.map((d) => (d.id === "d6" ? { ...d, email: "sofor6@klub.hu" } : d));
    return s;
  };

  test("defaultDriverId matches by e-mail, case-insensitively", () => {
    const s = stateWithEmails();
    expect(defaultDriverId(s.drivers, "Sofor6@Klub.hu")).toBe("d6");
    expect(defaultDriverId(s.drivers, "ismeretlen@klub.hu")).toBe(s.drivers[0].id);
    expect(defaultDriverId(s.drivers, null)).toBe(s.drivers[0].id);
    expect(defaultDriverId([], "sofor6@klub.hu")).toBe("");
  });

  test("the matching driver's chip is pre-selected", async () => {
    const s = stateWithEmails();
    await act(async () => {
      root = createRoot(container);
      root.render(<DriverScreen state={s} myEmail="SOFOR6@klub.hu" />);
    });
    const on = [...container.querySelectorAll("button.chip")].find((b) => b.classList.contains("on"));
    expect(on?.textContent).toBe("Sofőr 6");
  });

  test("without an e-mail the first driver stays selected, as before", async () => {
    const s = stateWithEmails();
    await act(async () => {
      root = createRoot(container);
      root.render(<DriverScreen state={s} />);
    });
    const on = [...container.querySelectorAll("button.chip")].find((b) => b.classList.contains("on"));
    expect(on?.textContent).toBe(s.drivers[0].name);
  });
});
