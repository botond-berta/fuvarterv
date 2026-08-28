import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MasterForm } from "../src/screens/MasterScreen.jsx";

/*
 * A két jelölőnégyzet: a járműnél a tény ("van matricája"), a helyszínnél a
 * követelmény ("csak matricás autóval érhető el"). Az állomáson szándékosan
 * NINCS ilyen mező — a matricát a célpont kényszeríti ki.
 */

const baseState = { stations: [], venues: [], vehicles: [], drivers: [], rides: [], teams: [], trainings: [] };

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

const boxFor = (text) => [...container.querySelectorAll("label")]
  .find((l) => l.textContent.includes(text))?.querySelector("input[type=checkbox]");
/* A natív kattintás billenti a checkboxot és váltja ki a change eseményt,
   amit a React szintetikus rendszere elkap — a `checked` kézi állítása
   ezután épp visszabillentené. */
const check = (box) => act(() => box.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const btn = (label) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

describe("matrica jelölőnégyzetek", () => {
  test("jármű: a bejelölt matrica mentésre kerül", () => {
    const saved = [];
    mount({ kind: "vehicles", entity: { id: "v1", name: "Busz", plate: "ABC-123", seats: 8, note: "", hasVignette: false }, onSave: (x) => saved.push(x) });
    const box = boxFor("Van országos autópálya-matricája");
    expect(box.checked).toBe(false);
    check(box);
    click(btn("Mentés"));
    expect(saved[0].hasVignette).toBe(true);
  });

  test("helyszín: a matricakötelezettség mentésre kerül", () => {
    const saved = [];
    mount({ kind: "venues", entity: { id: "x1", name: "Algyő", address: "", note: "", lat: 46.3, lon: 20.2, needsVignette: false }, onSave: (x) => saved.push(x) });
    const box = boxFor("Csak országos matricás autóval érhető el");
    expect(box.checked).toBe(false);
    check(box);
    click(btn("Mentés"));
    expect(saved[0].needsVignette).toBe(true);
  });

  test("állomásnál nincs matrica mező", () => {
    mount({ kind: "stations", entity: { id: "s1", name: "Zsombó", address: "", note: "", lat: 46.3, lon: 19.9 } });
    expect(container.textContent).not.toContain("matricás");
    expect(boxFor("matrica")).toBe(undefined);
  });

  test("sofőrnél sincs", () => {
    mount({ kind: "drivers", entity: null });
    expect(container.textContent).not.toContain("matric");
  });
});

function click(el) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
