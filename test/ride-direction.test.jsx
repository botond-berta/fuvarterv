import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RideEditor } from "../src/screens/RideScreen.jsx";

/*
 * Egy mentett fuvar iránya rögzített. A fuvar neve (a választó chipje), a
 * megállók idői és a megállólista mind az irányra épül, így az átkapcsolás egy
 * VISSZA fuvart ODA-ként vitt volna tovább a régi időivel — a sofőr a listáján
 * ugyanazt a fuvart látta volna megfordulva. Új fuvarnál a kapcsoló szabad.
 */

const training = { id: "tr1", teamId: "t1", venueId: "v1", type: "weekly", days: [1], start: "16:00", end: "18:00" };

const baseState = (rides) => ({
  teams: [{ id: "t1", name: "U14", color: "#f00", stationIds: ["s1"], stationCounts: { s1: 5 }, venueIds: ["v1"] }],
  venues: [{ id: "v1", name: "Csarnok", lat: 46.2, lon: 19.9 }],
  stations: [{ id: "s1", name: "Kistelek", lat: 46.4, lon: 19.9 }],
  vehicles: [{ id: "veh1", name: "Busz", plate: "ABC-123", seats: 8 }],
  drivers: [{ id: "d1", name: "Anna" }],
  trainings: [training],
  rides,
  assignments: {},
  matrix: { durations: {} },
  settings: { arriveEarlyMin: 10, departAfterMin: 15, dwellMin: 2, estSpeedKmh: 30, fallbackLegMin: 12 },
});

const ride = (dir) => ({ id: "r1", trainingId: "tr1", day: 1, dir, vehicleId: "veh1", driverId: "d1", stops: [] });

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function mount(state, onUpdate = () => {}) {
  act(() => {
    root = createRoot(container);
    root.render(<RideEditor state={state} update={onUpdate} training={training} dayIdx={1} dateISO="2026-08-31" onBack={() => {}} />);
  });
}

const seg = (label) => [...container.querySelectorAll(".seg button")].find((b) => b.textContent.trim() === label);
const chips = () => [...container.querySelectorAll(".chip")].map((c) => c.textContent.trim());
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const dirPill = () => container.querySelector(".dirpill").textContent.trim();

describe("a mentett fuvar iránya rögzített", () => {
  test("VISSZA fuvar: a kapcsoló nem állítható ODA-ra", () => {
    mount(baseState([ride("vissza")]));
    expect(dirPill()).toBe("VISSZA");
    expect(seg("ODA").disabled).toBe(true);
    expect(seg("VISSZA").disabled).toBe(true);
    click(seg("ODA"));
    expect(dirPill()).toBe("VISSZA");
    expect(seg("VISSZA").className).toContain("on");
  });

  test("VISSZA fuvar: a mentés is VISSZA irányt ír vissza", () => {
    const state = baseState([ride("vissza")]);
    let saved = null;
    mount(state, (fn) => { saved = fn(state); });
    click(seg("ODA"));
    click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Fuvar mentése"));
    expect(saved.rides).toHaveLength(1);
    expect(saved.rides[0].dir).toBe("vissza");
  });

  test("ODA fuvar: a kapcsoló nem állítható VISSZA-ra", () => {
    mount(baseState([ride("oda")]));
    expect(dirPill()).toBe("ODA");
    expect(seg("ODA").disabled).toBe(true);
    expect(seg("VISSZA").disabled).toBe(true);
    click(seg("VISSZA"));
    expect(dirPill()).toBe("ODA");
  });

  test("irány nélkül mentett (régi) fuvar ODA-ként rögzül", () => {
    const r = ride("oda");
    delete r.dir;
    mount(baseState([r]));
    expect(dirPill()).toBe("ODA");
    expect(seg("VISSZA").disabled).toBe(true);
  });

  test("új fuvarnál az irány szabadon választható", () => {
    mount(baseState([ride("vissza")]));
    click([...container.querySelectorAll(".chip")].find((c) => c.textContent.includes("Új fuvar")));
    expect(seg("ODA").disabled).toBe(false);
    expect(seg("VISSZA").disabled).toBe(false);
    expect(dirPill()).toBe("ODA");
    click(seg("VISSZA"));
    expect(dirPill()).toBe("VISSZA");
  });

  test("a fuvar neve mindkét irányt kiírja", () => {
    mount(baseState([ride("vissza"), { ...ride("oda"), id: "r2" }]));
    expect(chips()[0]).toBe("1. fuvar · VISSZA · Anna");
    expect(chips()[1]).toBe("2. fuvar · ODA · Anna");
  });
});
