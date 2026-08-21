import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App, { seedState } from "../fuvarterv.jsx";

/*
 * Integration smoke test: actually mounts <App/> against a fake window.storage
 * and walks every tab. A build succeeds even when a screen references an
 * identifier that no longer exists (a real risk once the file was split into
 * modules) — only rendering catches that.
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

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  // let the async load effect settle
  await act(async () => { await Promise.resolve(); });
}

describe("App renders end to end", () => {
  test("seeds and renders the week view when the workspace is empty", async () => {
    window.storage = fakeStorage(null);
    await mount();
    expect(container.textContent).toContain("Vector");
    // Seed data has teams with trainings, so the week view lists occurrences.
    expect(container.querySelector("nav.tabbar")).toBeTruthy();
  });

  test("every tab renders without throwing", async () => {
    window.storage = fakeStorage(seedState());
    await mount();
    const tabs = [...container.querySelectorAll("nav.tabbar button")];
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    for (const tab of tabs) {
      await act(async () => { tab.click(); });
      expect(container.textContent.length).toBeGreaterThan(0);
    }
  });

  test("the data tab reaches every master-data category", async () => {
    window.storage = fakeStorage(seedState());
    await mount();
    const dataTab = [...container.querySelectorAll("nav.tabbar button")]
      .find((b) => b.textContent.includes("Adatok"));
    await act(async () => { dataTab.click(); });
    const cats = [...container.querySelectorAll(".data-cats button")];
    expect(cats.length).toBe(6);
    for (const c of cats) {
      await act(async () => { c.click(); });
      expect(container.textContent.length).toBeGreaterThan(0);
    }
  });

  test("loading an existing workspace does NOT immediately write it back", async () => {
    // The bug this locks out: two users merely opening the app used to lock
    // each other out via the stale guard, and 20 refreshes wiped the history.
    const storage = fakeStorage(seedState());
    window.storage = storage;
    await mount();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(storage.sets).toHaveLength(0);
  });

  test("an empty workspace IS seeded and persisted", async () => {
    const storage = fakeStorage(null);
    window.storage = storage;
    await mount();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(storage.sets.length).toBeGreaterThan(0);
  });
});
