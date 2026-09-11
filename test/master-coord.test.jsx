import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MasterForm } from "../src/screens/MasterScreen.jsx";

/*
 * A station or venue can only be saved with a coordinate. Without one legMin falls
 * back to fallbackLegMin and the point drops out of the matrix, so the optimizer
 * quietly plans on wrong travel times. The form is where that gets enforced, so this
 * is where we pin down that Save stays disabled.
 */

const baseState = { stations: [], venues: [], bases: [], vehicles: [], drivers: [], rides: [], teams: [], trainings: [] };

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function mount(props) {
  act(() => {
    root = createRoot(container);
    root.render(<MasterForm state={baseState} onSave={() => {}} onCancel={() => {}} {...props} />);
  });
}

const btn = (label) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const type = (input, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("a koordináta kötelező állomásnál és helyszínnél", () => {
  for (const kind of ["stations", "venues"]) {
    test(`${kind}: névvel, koordináta nélkül nem menthető`, () => {
      mount({ kind, entity: null });
      type(container.querySelector("input.inp"), "Új megálló");
      expect(btn("Mentés").disabled).toBe(true);
      expect(container.textContent).toContain("A koordináta kötelező");
    });

    test(`${kind}: koordinátával menthető, és a mentett elem viszi a koordinátát`, () => {
      const saved = [];
      mount({ kind, entity: { id: "x1", name: "Kistelek", address: "", note: "", lat: 46.4703, lon: 19.9793 }, onSave: (item) => saved.push(item) });
      expect(container.textContent).not.toContain("A koordináta kötelező");
      const save = btn("Mentés");
      expect(save.disabled).toBe(false);
      act(() => save.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(saved).toEqual([{ id: "x1", name: "Kistelek", address: "", note: "", lat: 46.4703, lon: 19.9793 }]);
    });

    test(`${kind}: a koordináta nélküli régi rekord szerkesztése is csak koordinátával zárható le`, () => {
      const saved = [];
      mount({ kind, entity: { id: "old", name: "Régi", address: "", note: "", lat: null, lon: null }, onSave: (item) => saved.push(item) });
      const save = btn("Mentés");
      expect(save.disabled).toBe(true);
      act(() => save.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(saved).toEqual([]);
    });
  }

  test("járműnél nincs koordinátaigény", () => {
    const saved = [];
    mount({ kind: "vehicles", entity: null, onSave: (item) => saved.push(item) });
    const inputs = container.querySelectorAll("input.inp");
    type(inputs[0], "Busz 1");
    type(container.querySelectorAll("input.inp")[1], "abc123");
    const save = btn("Mentés");
    expect(save.disabled).toBe(false);
    act(() => save.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(saved).toHaveLength(1);
    expect(saved[0].plate).toBe("ABC-123");
  });
});
