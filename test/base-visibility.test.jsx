import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ScheduleScreen } from "../src/screens/ScheduleScreen.jsx";
import { baseOf } from "../fuvarterv.jsx";

/*
 * A telephely akkor sem szól, ha nincs — pedig olyankor a beosztás a régi módon
 * számol: minden rést fizetetlen szabadidőnek vesz. A csapda, amibe bele lehet
 * esni: felvenni egy telephelyet az Adatok fülön ATTÓL MÉG nem lesz kiválasztva
 * sem a klubnál, sem a járműveknél — a baseOf null marad, és semmi nem változik.
 */

const settings = { arriveEarlyMin: 10, departAfterMin: 10, calloutFee: 1500, dwellMin: 2,
  estSpeedKmh: 60, fallbackLegMin: 12, preferredBias: 0, defaultBaseId: null };

const makeState = ({ bases = [], defaultBaseId = null, vehicleBase = null } = {}) => ({
  stations: [], venues: [], bases,
  vehicles: [{ id: "b1", name: "Busz", plate: "AB-1", seats: 8, hasVignette: false, baseId: vehicleBase }],
  drivers: [{ id: "d1", name: "Anna", wage: 3000, minShiftMin: 0, availability: [], preferredVehicleId: null }],
  teams: [], trainings: [], rides: [], assignments: {}, matrix: null,
  settings: { ...settings, defaultBaseId },
});
const KLUB = { id: "h1", name: "Klub telephely", address: "", note: "", lat: 46.27, lon: 19.88 };

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function mount(state, update = () => {}) {
  act(() => {
    root = createRoot(container);
    root.render(<ScheduleScreen state={state} update={update} />);
  });
}
const btn = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));

describe("a telephely hiánya nem maradhat némán", () => {
  test("felvett, de ki nem választott telephely: a baseOf még null", () => {
    const s = makeState({ bases: [KLUB] });          // csak felvéve, sehol kiválasztva
    expect(baseOf(s, "b1")).toBe(null);
  });

  test("ilyenkor a Beosztás figyelmeztet, és egy kattintással beállítható", () => {
    let next = null;
    const s = makeState({ bases: [KLUB] });
    mount(s, (fn) => { next = fn(s); });
    expect(container.textContent).toContain("hazamehet");
    const fix = btn("beállítása klubtelephelynek");
    expect(fix).toBeTruthy();
    act(() => fix.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(next.settings.defaultBaseId).toBe("h1");
  });

  test("telephely nélkül a felvételre irányít", () => {
    mount(makeState());
    expect(container.textContent).toContain("Adatok → Telephelyek");
  });

  test("kiválasztott klubtelephellyel nincs figyelmeztetés", () => {
    mount(makeState({ bases: [KLUB], defaultBaseId: "h1" }));
    expect(container.textContent).not.toContain("hazamehet");
  });

  test("a jármű saját telephelye is elég", () => {
    mount(makeState({ bases: [KLUB], vehicleBase: "h1" }));
    expect(container.textContent).not.toContain("hazamehet");
  });
});

describe("a várakozás a napi mutatók között", () => {
  test("ott van a saját mezője", () => {
    mount(makeState({ bases: [KLUB], defaultBaseId: "h1" }));
    const tiles = [...container.querySelectorAll(".stat")].map((t) => t.textContent);
    expect(tiles.some((t) => t.includes("várakozás"))).toBe(true);
    expect(tiles.some((t) => t.includes("fizetett idő"))).toBe(true);
  });
});
