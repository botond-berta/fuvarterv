/* Fuvarterv — sample data, and shape normalisation for a loaded state.

   The sample data is FICTIONAL. Names, plates and headcounts are placeholders; the
   stations and venues are real public places, kept because they make the distances
   and therefore the optimiser's output realistic. Replace the whole thing with your
   own club's data, or delete the rows from inside the app. */

import { DEFAULT_SETTINGS } from "./storage.js";

/* Upgrade an older saved state with newer fields. This normalises EVERY top-level
   collection: a missing array otherwise throws a TypeError mid-render
   (team.stationIds.filter, ride.stops.some, and so on).

   The `seats` coercion matters for a subtler reason: `undefined < pax` is false, so
   a vehicle with no seat count would look like it had unlimited capacity.

   There is no schema version number. Every field is defaulted independently, which
   makes this forward- and backward-tolerant: an older client reading a newer blob
   ignores what it does not know, and a newer client fills in what is missing. */
export function ensureShape(s) {
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  s.stations = (s.stations || []).map((x) => ({ ...x, lat: x.lat ?? null, lon: x.lon ?? null }));
  /* needsVignette: the venue is only reachable with a national motorway vignette.
     Marked on venues only, never on stops: the destination is what forces it, and
     this way there is one field to maintain. */
  s.venues = (s.venues || []).map((x) => ({ ...x, lat: x.lat ?? null, lon: x.lon ?? null, needsVignette: !!x.needsVignette }));
  /* Depot: where the bus spends the night. Settable per vehicle, because a driver
     often keeps theirs at home; null means the club depot (settings.defaultBaseId).
     With neither set, paid time is measured from the tasks, so existing data behaves
     exactly as it did before depots existed. */
  s.bases = (s.bases || []).map((x) => ({ ...x, lat: x.lat ?? null, lon: x.lon ?? null }));
  s.vehicles = (s.vehicles || []).map((v) => ({ ...v, seats: Number(v.seats) || 0, plate: v.plate || "", hasVignette: !!v.hasVignette, baseId: v.baseId ?? null }));
  /* email: the driver's sign-in address, lower-cased. A user with the driver role
     opens on their own day plan, matched on this. */
  s.drivers = (s.drivers || []).map((d) => ({ ...d, wage: d.wage ?? 3000, minShiftMin: d.minShiftMin ?? 120, availability: d.availability || [], preferredVehicleId: d.preferredVehicleId ?? null, email: d.email || "" }));
  /* returnStationIds === null means the return leg mirrors the outbound one (the
     original single-list behaviour). An array means the return leg has its own stops.
     The fields are deliberately flat rather than nested: the team screen's array
     toggle helper works on top-level field names. */
  s.teams = (s.teams || []).map((t) => ({ ...t, stationIds: t.stationIds || [], venueIds: t.venueIds || [], passengerCount: t.passengerCount ?? null, stationCounts: t.stationCounts || {}, routeMode: t.routeMode || "auto", routeAnchorId: t.routeAnchorId ?? null, returnStationIds: t.returnStationIds ?? null, returnStationCounts: t.returnStationCounts || {}, returnRouteAnchorId: t.returnRouteAnchorId ?? null }));
  /* stops === null means the training uses the team's stop list (the original
     single-list behaviour). An object means the training has its own complete list,
     using the same field names the team uses. */
  s.trainings = (s.trainings || []).map((t) => ({ ...t, type: t.type || "weekly", days: t.days || [], date: t.date ?? null, stops: t.stops ?? null }));
  s.rides = (s.rides || []).map((r) => ({ ...r, dir: r.dir || "oda", stops: r.stops || [] }));
  s.matrix = s.matrix || null;
  s.assignments = s.assignments || {};
  return s;
}

export function seedState() {
  return {
    /* The club depot. Every vehicle's baseId is null, so they all start here; a bus
       kept at a driver's home gets its own depot on the vehicle. */
    bases: [
      { id: "hZAK", name: "Klub telephely", address: "Zákányszék", note: "", lat: 46.2745, lon: 19.889 },
    ],
    teams: [
      { id: "tLU12K", name: "LU12 Kitti", age: "U12", gender: "lány", color: "#D6336C",
        stationIds: ["sGD", "sDORO", "sROSZ1", "sMORA", "sZSOM", "sBORD"], venueIds: ["vZAK", "vMORA"],
        passengerCount: 11, stationCounts: { sGD: 1, sDORO: 1, sROSZ1: 1, sMORA: 3, sZSOM: 2, sBORD: 3 } },
      { id: "tLU14", name: "LU14", age: "U14", gender: "lány", color: "#6F42C1",
        stationIds: ["sKISPCS", "sSAND", "sBORD", "sPETO", "sZSOM"], venueIds: ["vZAK", "vMORA"],
        passengerCount: 14, stationCounts: { sKISPCS: 2, sSAND: 3, sBORD: 1, sPETO: 3, sZSOM: 5 } },
      { id: "tFU12", name: "FU12", age: "U12", gender: "fiú", color: "#1E6FD9",
        stationIds: ["sZSOM", "sKIISK", "sBALA", "sSAND"], venueIds: ["vKIS", "vALG", "vBAL"],
        passengerCount: 10, stationCounts: { sZSOM: 1, sKIISK: 4, sBALA: 3, sSAND: 2 } },
      { id: "tFU14", name: "FU14", age: "U14", gender: "fiú", color: "#0F8A5F",
        stationIds: ["sKISPCS", "sBALA", "sSAND", "sZSOM", "sROSZ2", "sGD"], venueIds: ["vALG", "vGEL"],
        passengerCount: 12, stationCounts: { sKISPCS: 2, sBALA: 1, sSAND: 1, sZSOM: 3, sROSZ2: 2, sGD: 3 } },
      { id: "tFU16", name: "FU16", age: "U16", gender: "fiú", color: "#D9760B",
        stationIds: ["sSAND", "sALGISK", "sSHELL", "sZSOM", "sDORO", "sGD"], venueIds: ["vALG", "vGEL"],
        passengerCount: 14, stationCounts: { sSAND: 2, sALGISK: 2, sSHELL: 3, sZSOM: 1, sDORO: 2, sGD: 4 } },
      { id: "tNB2", name: "NB2 (felnőtt)", age: "Felnőtt", gender: "vegyes", color: "#0E7C99",
        stationIds: ["sPLAZA"], venueIds: ["vKIS"],
        passengerCount: null, stationCounts: {} },
    ],
    stations: [
      { id: "sKISPCS", name: "Kistelek spcs.", address: "Sportcsarnok, Kistelek", note: "", lat: 46.4703, lon: 19.9793 },
      { id: "sKIISK", name: "Kistelek iskola", address: "Iskola, Kistelek", note: "", lat: 46.4736, lon: 19.9812 },
      { id: "sBALA", name: "Balástya iskola", address: "Iskola, Balástya", note: "2-4 fő, Erika autóval besegít", lat: 46.4262, lon: 20.0046 },
      { id: "sSAND", name: "Sándorfalva iskola", address: "Iskola, Sándorfalva", note: "", lat: 46.3625, lon: 20.1008 },
      { id: "sZSOM", name: "Zsombó iskola", address: "Iskola, Zsombó", note: "", lat: 46.3271, lon: 19.9754 },
      { id: "sBORD", name: "Bordány, Zákányszéki út", address: "Zákányszéki út, kisbolt, Bordány", note: "", lat: 46.3135, lon: 19.921 },
      { id: "sMORA", name: "Mórahalom iskola", address: "Iskola, Mórahalom", note: "", lat: 46.2185, lon: 19.8853 },
      { id: "sROSZ1", name: "Röszke, Fő u. kereszteződés", address: "Fő u.–Dugonyi u.–Felszabadulás u., Röszke", note: "", lat: 46.1872, lon: 20.0322 },
      { id: "sROSZ2", name: "Röszke, Rendelő u.", address: "Rendelő u.–Szent Antal tér sarok (iskola mögött), Röszke", note: "", lat: 46.1878, lon: 20.0342 },
      { id: "sDORO", name: "Dorozsma, Stop cukrászda", address: "Kiskundorozsma, Szeged", note: "", lat: 46.2718, lon: 20.0788 },
      { id: "sGD", name: "Szeged, GD bejárat", address: "Gábor Dénes iskola, Mars tér, Szeged", note: "", lat: 46.2536, lon: 20.1398 },
      { id: "sPETO", name: "Szeged, Petőfi iskola", address: "Petőfitelep, Szeged", note: "Pontosítsd a térképen", lat: 46.281, lon: 20.162 },
      { id: "sPLAZA", name: "Szeged Pláza", address: "Kossuth Lajos sgt. 119., Szeged", note: "", lat: 46.2648, lon: 20.1268 },
      { id: "sSHELL", name: "Algyői út, Shell kút", address: "Algyői út, Szeged", note: "", lat: 46.2842, lon: 20.1697 },
      { id: "sALGISK", name: "Algyő iskola", address: "Iskola, Algyő", note: "", lat: 46.3327, lon: 20.2075 },
    ],
    venues: [
      { id: "vZAK", name: "Zákányszék spcs.", address: "Sportcsarnok, Zákányszék", note: "", lat: 46.2745, lon: 19.889 },
      { id: "vKIS", name: "Kistelek spcs.", address: "Sportcsarnok, Kistelek", note: "", lat: 46.4703, lon: 19.9793 },
      /* An example of the vignette rule: this venue is most easily reached via the
         motorway, so only a bus with a national vignette may be scheduled to it. */
      { id: "vALG", name: "Algyő spcs.", address: "Sportcsarnok, Algyő", note: "", lat: 46.3327, lon: 20.2069, needsVignette: true },
      { id: "vGEL", name: "Újszeged Gellért", address: "Újszeged, Szeged", note: "Pontosítsd a térképen", lat: 46.245, lon: 20.1745 },
      { id: "vMORA", name: "Mórahalom spcs.", address: "Sportcsarnok, Mórahalom", note: "", lat: 46.2172, lon: 19.883 },
      { id: "vBAL", name: "Balástya terem", address: "Iskola tornaterme, Balástya", note: "", lat: 46.4262, lon: 20.0046 },
    ],
    vehicles: [
      { id: "b1", name: "Kisbusz 1", plate: "ABC-101", seats: 8, hasVignette: true, note: "Országos engedély" },
      { id: "b2", name: "Kisbusz 2", plate: "ABC-102", seats: 8, hasVignette: false, note: "Megyei engedély" },
      { id: "b3", name: "Kisbusz 3", plate: "ABC-103", seats: 8, hasVignette: false, note: "Megyei engedély" },
      { id: "b4", name: "Kisbusz 4", plate: "ABC-104", seats: 8, hasVignette: true, note: "Országos engedély" },
      { id: "b5", name: "Kisbusz 5", plate: "ABC-105", seats: 8, hasVignette: true, note: "Országos engedély" },
      { id: "b6", name: "Kisbusz 6", plate: "ABC-106", seats: 8, hasVignette: true, note: "Országos engedély" },
      { id: "b7", name: "Kisbusz 7", plate: "ABC-107", seats: 8, hasVignette: false, note: "Megyei engedély" },
    ],
    drivers: [
      { id: "d1", name: "Sofőr 1", phone: "", note: "Állandó busz: ABC-101", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b1" },
      { id: "d2", name: "Sofőr 2", phone: "", note: "Állandó busz: ABC-102", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b2" },
      { id: "d3", name: "Sofőr 3", phone: "", note: "ABC-103, váltásban Sofőr 4-gyel", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b3" },
      { id: "d4", name: "Sofőr 4", phone: "", note: "ABC-103, váltásban Sofőr 3-mal", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b3" },
      { id: "d5", name: "Sofőr 5", phone: "", note: "Állandó busz: ABC-104", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b4" },
      { id: "d6", name: "Sofőr 6", phone: "", note: "Állandó busz: ABC-105", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b5" },
      { id: "d7", name: "Sofőr 7", phone: "", note: "Állandó busz: ABC-106", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b6" },
      { id: "d8", name: "Sofőr 8", phone: "", note: "Állandó busz: ABC-107", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "b7" },
    ],
    /* Weekday indices, Monday first: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri. */
    trainings: [
      { id: "trLU12K_k", teamId: "tLU12K", venueId: "vZAK", type: "weekly", days: [1], date: null, start: "16:30", end: "18:30" },
      { id: "trLU12K_sze", teamId: "tLU12K", venueId: "vMORA", type: "weekly", days: [2], date: null, start: "16:00", end: "17:30" },
      { id: "trLU12K_cs", teamId: "tLU12K", venueId: "vZAK", type: "weekly", days: [3], date: null, start: "16:00", end: "18:30" },
      { id: "trLU14_k", teamId: "tLU14", venueId: "vZAK", type: "weekly", days: [1], date: null, start: "16:30", end: "18:30" },
      { id: "trLU14_sze", teamId: "tLU14", venueId: "vZAK", type: "weekly", days: [2], date: null, start: "17:00", end: "18:30" },
      { id: "trLU14_cs", teamId: "tLU14", venueId: "vZAK", type: "weekly", days: [3], date: null, start: "16:00", end: "18:30" },
      { id: "trLU14_p", teamId: "tLU14", venueId: "vMORA", type: "weekly", days: [4], date: null, start: "17:00", end: "18:30" },
      { id: "trFU12_hsze", teamId: "tFU12", venueId: "vKIS", type: "weekly", days: [0, 2], date: null, start: "16:00", end: "17:30" },
      { id: "trFU12_cs", teamId: "tFU12", venueId: "vALG", type: "weekly", days: [3], date: null, start: "15:30", end: "17:00" },
      /* An example of a per-training stop list. This Friday session is held in a
         village whose own children can walk there, so that stop drops out of the
         team's standing list and fewer people travel. */
      { id: "trFU12_p", teamId: "tFU12", venueId: "vBAL", type: "weekly", days: [4], date: null, start: "15:00", end: "16:30",
        stops: { stationIds: ["sZSOM", "sKIISK", "sSAND"], stationCounts: { sZSOM: 1, sKIISK: 4, sSAND: 2 },
          routeMode: "auto", routeAnchorId: null,
          returnStationIds: null, returnStationCounts: {}, returnRouteAnchorId: null, passengerCount: null } },
      { id: "trFU14_hszep", teamId: "tFU14", venueId: "vALG", type: "weekly", days: [0, 2, 4], date: null, start: "17:00", end: "18:30" },
      { id: "trFU14_cs", teamId: "tFU14", venueId: "vGEL", type: "weekly", days: [3], date: null, start: "17:00", end: "18:30" },
      { id: "trFU16_hszep", teamId: "tFU16", venueId: "vALG", type: "weekly", days: [0, 2, 4], date: null, start: "18:30", end: "20:00" },
      { id: "trFU16_kcs", teamId: "tFU16", venueId: "vGEL", type: "weekly", days: [1, 3], date: null, start: "15:30", end: "17:00" },
      { id: "trNB2", teamId: "tNB2", venueId: "vKIS", type: "weekly", days: [0, 2, 3, 4], date: null, start: "18:00", end: "20:00" },
    ],
    /* A worked example: one Thursday's rides, already assigned to drivers and buses. */
    rides: [
      { id: "rFU16a", trainingId: "trFU16_kcs", day: 3, date: null, vehicleId: "b5", driverId: "d6",
        stops: [
          { id: "x1", stationId: "sSAND", time: "14:25", count: 2 },
          { id: "x2", stationId: "sALGISK", time: "14:45", count: 2 },
          { id: "x3", stationId: "sSHELL", time: "14:55", count: 3 },
        ] },
      { id: "rFU16b", trainingId: "trFU16_kcs", day: 3, date: null, vehicleId: "b1", driverId: "d1",
        stops: [
          { id: "x4", stationId: "sZSOM", time: "14:40", count: 1 },
          { id: "x5", stationId: "sDORO", time: "14:55", count: 2 },
          { id: "x6", stationId: "sGD", time: "15:10", count: 4 },
        ] },
      { id: "rFU12a", trainingId: "trFU12_cs", day: 3, date: null, vehicleId: "b4", driverId: "d5",
        stops: [
          { id: "x7", stationId: "sZSOM", time: "14:20", count: 1 },
          { id: "x8", stationId: "sKIISK", time: "14:40", count: 4 },
          { id: "x9", stationId: "sBALA", time: "14:50", count: 3 },
          { id: "x10", stationId: "sSAND", time: "15:05", count: 2 },
        ] },
      { id: "rLU12a", trainingId: "trLU12K_cs", day: 3, date: null, vehicleId: "b3", driverId: "d3",
        stops: [
          { id: "x11", stationId: "sGD", time: "14:30", count: 1 },
          { id: "x12", stationId: "sDORO", time: "14:45", count: 1 },
          { id: "x13", stationId: "sROSZ1", time: "15:00", count: 1 },
          { id: "x14", stationId: "sMORA", time: "15:15", count: 3 },
        ] },
      { id: "rLU12b", trainingId: "trLU12K_cs", day: 3, date: null, vehicleId: "b3", driverId: "d3",
        stops: [
          { id: "x15", stationId: "sZSOM", time: "15:35", count: 2 },
          { id: "x16", stationId: "sBORD", time: "15:45", count: 3 },
        ] },
      { id: "rFU14a", trainingId: "trFU14_cs", day: 3, date: null, vehicleId: "b5", driverId: "d6",
        stops: [
          { id: "x17", stationId: "sKISPCS", time: "15:45", count: 2 },
          { id: "x18", stationId: "sBALA", time: "15:55", count: 1 },
          { id: "x19", stationId: "sSAND", time: "16:10", count: 1 },
          { id: "x20", stationId: "sZSOM", time: "16:25", count: 3 },
        ] },
      { id: "rFU14b", trainingId: "trFU14_cs", day: 3, date: null, vehicleId: "b1", driverId: "d1",
        stops: [
          { id: "x21", stationId: "sROSZ2", time: "16:25", count: 2 },
          { id: "x22", stationId: "sGD", time: "16:40", count: 3 },
        ] },
      { id: "rLU14a", trainingId: "trLU14_cs", day: 3, date: null, vehicleId: "b6", driverId: "d7",
        stops: [
          { id: "x23", stationId: "sKISPCS", time: "16:00", count: 2 },
          { id: "x24", stationId: "sSAND", time: "16:15", count: 3 },
          { id: "x25", stationId: "sBORD", time: "16:35", count: 1 },
        ] },
      { id: "rLU14b", trainingId: "trLU14_cs", day: 3, date: null, vehicleId: "b4", driverId: "d5",
        stops: [
          { id: "x26", stationId: "sPETO", time: "16:10", count: 3 },
          { id: "x27", stationId: "sZSOM", time: "16:35", count: 5 },
        ] },
    ],
    settings: { ...DEFAULT_SETTINGS, defaultBaseId: "hZAK" },
    matrix: null,
    assignments: {},
  };
}
