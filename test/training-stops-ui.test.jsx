import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TrainingDetail, TeamDetail } from "../src/screens/TeamsScreen.jsx";

/*
 * The training screen is the only place a per-training stop list can come into
 * existence. Switching the toggle on must copy from the team's list (otherwise the
 * user is handed an empty one), and switching it off must return to null — that null
 * is what means "inherit the team's list".
 */

const team = {
  id: "tm", name: "TM", age: "U12", gender: "vegyes", color: "#000",
  stationIds: ["sA", "sB"], venueIds: ["v0", "v1"], passengerCount: 7,
  stationCounts: { sA: 2, sB: 3 }, routeMode: "auto", routeAnchorId: null,
  returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null,
};
const baseState = (trainings) => ({
  teams: [team],
  stations: [{ id: "sA", name: "Alfa", lat: 46.1, lon: 19.8 }, { id: "sB", name: "Béta", lat: 46.2, lon: 19.85 },
    { id: "sC", name: "Cé", lat: 46.3, lon: 19.9 }],
  venues: [{ id: "v0", name: "V0", lat: 46.25, lon: 19.88 }, { id: "v1", name: "V1", lat: 46.05, lon: 19.75 }],
  vehicles: [], drivers: [], rides: [], trainings, assignments: {}, matrix: null,
  settings: { arriveEarlyMin: 10, departAfterMin: 10, dwellMin: 2, estSpeedKmh: 50, fallbackLegMin: 12 },
});
const training = (stops = null) => ({
  id: "tr1", teamId: "tm", venueId: "v1", type: "weekly", days: [2], date: null,
  start: "16:00", end: "17:30", stops,
});

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function mount(tr, onUpdate) {
  const state = baseState([tr]);
  act(() => {
    root = createRoot(container);
    root.render(<TrainingDetail state={state} update={(fn) => onUpdate(fn(state))} team={team} training={tr} onBack={() => {}} />);
  });
}

const btn = (label) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("edzésenkénti megállólista a felületen", () => {
  test("alapból a csapat listáját örökli", () => {
    mount(training(), () => {});
    expect(btn("Megegyezik a csapatéval").className).toContain("on");
    expect(container.textContent).toContain("a csapat állandó megállólistáját használja (2 állomás)");
  });

  test("a Saját lista a csapat listájából másol", () => {
    let next = null;
    mount(training(), (s) => { next = s; });
    click(btn("Saját lista"));
    expect(next.trainings[0].stops).toEqual({
      stationIds: ["sA", "sB"], stationCounts: { sA: 2, sB: 3 }, routeMode: "auto", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, passengerCount: 7,
    });
  });

  test("a másolat független: a csapat tömbjeit nem osztja meg", () => {
    let next = null;
    mount(training(), (s) => { next = s; });
    click(btn("Saját lista"));
    expect(next.trainings[0].stops.stationIds).not.toBe(team.stationIds);
    expect(next.trainings[0].stops.stationCounts).not.toBe(team.stationCounts);
  });

  test("visszakapcsolva null lesz — vagyis újra a csapat listája", () => {
    let next = null;
    mount(training({ stationIds: ["sC"], stationCounts: { sC: 4 }, routeMode: "auto", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, passengerCount: null }), (s) => { next = s; });
    expect(btn("Saját lista").className).toContain("on");
    click(btn("Megegyezik a csapatéval"));
    expect(next.trainings[0].stops).toBe(null);
  });

  test("saját listánál a megállószerkesztő jelenik meg", () => {
    mount(training({ stationIds: ["sC"], stationCounts: { sC: 4 }, routeMode: "auto", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, passengerCount: null }), () => {});
    expect(container.textContent).toContain("Állomások (felszállóhelyek)");
    expect(container.textContent).toContain("Szállítandó létszám ezen az edzésen");
    expect(btn("Cé").className).toContain("on");
    expect(btn("Alfa").className).not.toContain("on");
  });
});

describe("belépési pont: a csapat edzéslistája", () => {
  test("az edzés sora megnyitja az edzés képernyőjét, és jelzi a saját listát", () => {
    const own = { stationIds: ["sC"], stationCounts: { sC: 4 }, routeMode: "auto", routeAnchorId: null,
      returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, passengerCount: null };
    const state = baseState([training(own)]);
    act(() => {
      root = createRoot(container);
      root.render(<TeamDetail state={state} update={() => {}} team={team} onBack={() => {}} />);
    });
    expect(container.textContent).toContain("saját megállók");
    expect(container.textContent).toContain("1 állomás");

    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("16:00–17:30")));
    expect(container.textContent).toContain("Megegyezik a csapatéval");
    expect(btn("Saját lista").className).toContain("on");
  });

  test("felülírás nélkül a csapat állomásszáma látszik, jelvény nélkül", () => {
    const state = baseState([training()]);
    act(() => {
      root = createRoot(container);
      root.render(<TeamDetail state={state} update={() => {}} team={team} onBack={() => {}} />);
    });
    expect(container.textContent).not.toContain("saját megállók");
    expect(container.textContent).toContain("2 állomás");
  });
});
