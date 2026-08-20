/* Vector — mintaadatok és a mentett állapot alakjának normalizálása
   Kiemelve a fuvarterv.jsx monolitból; a viselkedés változatlan. */

import { DEFAULT_SETTINGS } from "./storage.js";

/* Régebbi mentett állapotok felokosítása az új mezőkkel. MINDEN felső szintű
   gyűjteményt normalizál: a hiányzó tömbök különben `TypeError`-t dobnak render
   közben (team.stationIds.filter, ride.stops.some, …), error boundary nélkül,
   fehér képernyővel. A `seats` coercion azért fontos, mert az `undefined < pax`
   hamis — egy férőhely nélküli jármű korlátlan kapacitásúnak látszana. */
export function ensureShape(s) {
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  s.stations = (s.stations || []).map((x) => ({ ...x, lat: x.lat ?? null, lon: x.lon ?? null }));
  s.venues = (s.venues || []).map((x) => ({ ...x, lat: x.lat ?? null, lon: x.lon ?? null }));
  s.vehicles = (s.vehicles || []).map((v) => ({ ...v, seats: Number(v.seats) || 0, plate: v.plate || "" }));
  s.drivers = (s.drivers || []).map((d) => ({ ...d, wage: d.wage ?? 3000, minShiftMin: d.minShiftMin ?? 120, availability: d.availability || [], preferredVehicleId: d.preferredVehicleId ?? null }));
  /* returnStationIds === null azt jelenti: a visszaút tükrözze az odautat (ez a
     korábbi, egyetlen listás viselkedés). Tömb esetén a visszaútnak saját
     megállói vannak. A mezők szándékosan laposak, nem egy beágyazott objektumban:
     a csapat-felület tömbkapcsoló segédfüggvénye felső szintű mezőnévvel dolgozik. */
  s.teams = (s.teams || []).map((t) => ({ ...t, stationIds: t.stationIds || [], venueIds: t.venueIds || [], passengerCount: t.passengerCount ?? null, stationCounts: t.stationCounts || {}, routeMode: t.routeMode || "auto", routeAnchorId: t.routeAnchorId ?? null, returnStationIds: t.returnStationIds ?? null, returnStationCounts: t.returnStationCounts || {}, returnRouteAnchorId: t.returnRouteAnchorId ?? null }));
  s.trainings = (s.trainings || []).map((t) => ({ ...t, type: t.type || "weekly", days: t.days || [], date: t.date ?? null }));
  s.rides = (s.rides || []).map((r) => ({ ...r, dir: r.dir || "oda", stops: r.stops || [] }));
  s.matrix = s.matrix || null;
  s.assignments = s.assignments || {};
  return s;
}

export function seedState() {
  return {
    /* Források: 2025–26 terembeosztás (edzések), sofőrök lap (sofőrök, rendszámok),
       csütörtöki fuvarlista (megállók, létszámok, indulási idők). */
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
      { id: "vALG", name: "Algyő spcs.", address: "Sportcsarnok, Algyő", note: "", lat: 46.3327, lon: 20.2069 },
      { id: "vGEL", name: "Újszeged Gellért", address: "Újszeged, Szeged", note: "Pontosítsd a térképen", lat: 46.245, lon: 20.1745 },
      { id: "vMORA", name: "Mórahalom spcs.", address: "Sportcsarnok, Mórahalom", note: "", lat: 46.2172, lon: 19.883 },
      { id: "vBAL", name: "Balástya terem", address: "Iskola tornaterme, Balástya", note: "", lat: 46.4262, lon: 20.0046 },
    ],
    vehicles: [
      { id: "jPAK543", name: "Kisbusz 1", plate: "PAK-543", seats: 8, note: "Országos engedély · Sipos Zsolti" },
      { id: "jPAK544", name: "Kisbusz 2", plate: "PAK-544", seats: 8, note: "Megyei engedély · Vincze Gábor" },
      { id: "jPAK545", name: "Kisbusz 3", plate: "PAK-545", seats: 8, note: "Megyei engedély · Habenyák/Csomor" },
      { id: "jPPC574", name: "Kisbusz 4", plate: "PPC-574", seats: 8, note: "Országos engedély · Nagy Ferenc" },
      { id: "jPWF852", name: "Kisbusz 5", plate: "PWF-852", seats: 8, note: "Országos engedély · Gera Józsi" },
      { id: "jSLP752", name: "Kisbusz 6", plate: "SLP-752", seats: 8, note: "Országos engedély · Kolumbán Józsi" },
      { id: "jSLP753", name: "Kisbusz 7", plate: "SLP-753", seats: 8, note: "Megyei engedély · Zámbó Zsolti" },
    ],
    drivers: [
      { id: "dSIP", name: "Sipos Zsolti", phone: "", note: "Állandó busz: PAK-543", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jPAK543" },
      { id: "dVIN", name: "Vincze Gábor", phone: "", note: "Állandó busz: PAK-544", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jPAK544" },
      { id: "dHAB", name: "Habenyák Alex", phone: "", note: "PAK-545, váltásban Csomor Tamással", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jPAK545" },
      { id: "dCSO", name: "Csomor Tamás", phone: "", note: "PAK-545, váltásban Habenyák Alexszel", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jPAK545" },
      { id: "dNAG", name: "Nagy Ferenc", phone: "", note: "Állandó busz: PPC-574", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jPPC574" },
      { id: "dGER", name: "Gera Józsi", phone: "", note: "Állandó busz: PWF-852", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jPWF852" },
      { id: "dKOL", name: "Kolumbán Józsi", phone: "", note: "Állandó busz: SLP-752", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jSLP752" },
      { id: "dZAM", name: "Zámbó Zsolti", phone: "", note: "Állandó busz: SLP-753", wage: 3000, minShiftMin: 120, availability: [], preferredVehicleId: "jSLP753" },
    ],
    /* Napok: 0=H, 1=K, 2=Sze, 3=Cs, 4=P */
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
      { id: "trFU12_p", teamId: "tFU12", venueId: "vBAL", type: "weekly", days: [4], date: null, start: "15:00", end: "16:30" },
      { id: "trFU14_hszep", teamId: "tFU14", venueId: "vALG", type: "weekly", days: [0, 2, 4], date: null, start: "17:00", end: "18:30" },
      { id: "trFU14_cs", teamId: "tFU14", venueId: "vGEL", type: "weekly", days: [3], date: null, start: "17:00", end: "18:30" },
      { id: "trFU16_hszep", teamId: "tFU16", venueId: "vALG", type: "weekly", days: [0, 2, 4], date: null, start: "18:30", end: "20:00" },
      { id: "trFU16_kcs", teamId: "tFU16", venueId: "vGEL", type: "weekly", days: [1, 3], date: null, start: "15:30", end: "17:00" },
      { id: "trNB2", teamId: "tNB2", venueId: "vKIS", type: "weekly", days: [0, 2, 3, 4], date: null, start: "18:00", end: "20:00" },
    ],
    /* Csütörtöki fuvarkörök a fuvarlistából; a sofőrök a 2025–26-os beosztás szerint */
    rides: [
      { id: "rFU16a", trainingId: "trFU16_kcs", day: 3, date: null, vehicleId: "jPWF852", driverId: "dGER",
        stops: [
          { id: "x1", stationId: "sSAND", time: "14:25", count: 2 },
          { id: "x2", stationId: "sALGISK", time: "14:45", count: 2 },
          { id: "x3", stationId: "sSHELL", time: "14:55", count: 3 },
        ] },
      { id: "rFU16b", trainingId: "trFU16_kcs", day: 3, date: null, vehicleId: "jPAK543", driverId: "dSIP",
        stops: [
          { id: "x4", stationId: "sZSOM", time: "14:40", count: 1 },
          { id: "x5", stationId: "sDORO", time: "14:55", count: 2 },
          { id: "x6", stationId: "sGD", time: "15:10", count: 4 },
        ] },
      { id: "rFU12a", trainingId: "trFU12_cs", day: 3, date: null, vehicleId: "jPPC574", driverId: "dNAG",
        stops: [
          { id: "x7", stationId: "sZSOM", time: "14:20", count: 1 },
          { id: "x8", stationId: "sKIISK", time: "14:40", count: 4 },
          { id: "x9", stationId: "sBALA", time: "14:50", count: 3 },
          { id: "x10", stationId: "sSAND", time: "15:05", count: 2 },
        ] },
      { id: "rLU12a", trainingId: "trLU12K_cs", day: 3, date: null, vehicleId: "jPAK545", driverId: "dHAB",
        stops: [
          { id: "x11", stationId: "sGD", time: "14:30", count: 1 },
          { id: "x12", stationId: "sDORO", time: "14:45", count: 1 },
          { id: "x13", stationId: "sROSZ1", time: "15:00", count: 1 },
          { id: "x14", stationId: "sMORA", time: "15:15", count: 3 },
        ] },
      { id: "rLU12b", trainingId: "trLU12K_cs", day: 3, date: null, vehicleId: "jPAK545", driverId: "dHAB",
        stops: [
          { id: "x15", stationId: "sZSOM", time: "15:35", count: 2 },
          { id: "x16", stationId: "sBORD", time: "15:45", count: 3 },
        ] },
      { id: "rFU14a", trainingId: "trFU14_cs", day: 3, date: null, vehicleId: "jPWF852", driverId: "dGER",
        stops: [
          { id: "x17", stationId: "sKISPCS", time: "15:45", count: 2 },
          { id: "x18", stationId: "sBALA", time: "15:55", count: 1 },
          { id: "x19", stationId: "sSAND", time: "16:10", count: 1 },
          { id: "x20", stationId: "sZSOM", time: "16:25", count: 3 },
        ] },
      { id: "rFU14b", trainingId: "trFU14_cs", day: 3, date: null, vehicleId: "jPAK543", driverId: "dSIP",
        stops: [
          { id: "x21", stationId: "sROSZ2", time: "16:25", count: 2 },
          { id: "x22", stationId: "sGD", time: "16:40", count: 3 },
        ] },
      { id: "rLU14a", trainingId: "trLU14_cs", day: 3, date: null, vehicleId: "jSLP752", driverId: "dKOL",
        stops: [
          { id: "x23", stationId: "sKISPCS", time: "16:00", count: 2 },
          { id: "x24", stationId: "sSAND", time: "16:15", count: 3 },
          { id: "x25", stationId: "sBORD", time: "16:35", count: 1 },
        ] },
      { id: "rLU14b", trainingId: "trLU14_cs", day: 3, date: null, vehicleId: "jPPC574", driverId: "dNAG",
        stops: [
          { id: "x26", stationId: "sPETO", time: "16:10", count: 3 },
          { id: "x27", stationId: "sZSOM", time: "16:35", count: 5 },
        ] },
    ],
    settings: { ...DEFAULT_SETTINGS },
    matrix: null,
    assignments: {},
  };
}
