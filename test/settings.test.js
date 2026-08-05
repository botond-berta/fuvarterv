import { describe, test, expect } from "vitest";
import { DEFAULT_SETTINGS, seedState, ensureShape } from "../fuvarterv.jsx";

/*
 * Guards against the two settings sources drifting apart. Before the
 * DEFAULT_SETTINGS refactor, seedState() and ensureShape() each listed the
 * defaults inline and had silently diverged (estSpeedKmh 30 vs 50,
 * fallbackLegMin 10 vs 12). Both now derive from DEFAULT_SETTINGS, so their
 * key sets must match it exactly. This test fails if a key is present in one
 * but not the other.
 */
describe("settings defaults stay in sync", () => {
  const defaultKeys = Object.keys(DEFAULT_SETTINGS).sort();

  test("seedState().settings has exactly the DEFAULT_SETTINGS keys", () => {
    expect(Object.keys(seedState().settings).sort()).toEqual(defaultKeys);
  });

  test("ensureShape({}) fills exactly the DEFAULT_SETTINGS keys", () => {
    expect(Object.keys(ensureShape({}).settings).sort()).toEqual(defaultKeys);
  });

  test("a fresh seed carries the DEFAULT_SETTINGS values", () => {
    expect(seedState().settings).toEqual(DEFAULT_SETTINGS);
  });

  test("ensureShape does not overwrite a value the saved state already has", () => {
    const shaped = ensureShape({ settings: { estSpeedKmh: 33 } });
    expect(shaped.settings.estSpeedKmh).toBe(33);
    // ...but still fills the rest from the defaults
    expect(shaped.settings.calloutFee).toBe(DEFAULT_SETTINGS.calloutFee);
  });
});
