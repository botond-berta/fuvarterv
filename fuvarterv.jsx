/* =====================================================================
   FUVARTERV — kézilabda klub fuvarszervező
   ---------------------------------------------------------------------
   Ez a fájl ma már csak ÖSSZEFOGÓ (barrel): a tényleges kód modulokban él.
   Azért marad, mert a src/main.jsx és a test/ innen importál — így a
   szétvágás egyetlen importot sem tört el.

     src/data/storage.js      — perzisztencia-varrat (window.storage) + alapértékek
     src/data/seed.js         — mintaadatok + ensureShape (alaknormalizálás)
     src/domain/constants.js  — konstansok, uid, byId
     src/domain/datetime.js   — dátum és idő (hétfővel kezdődő hetek, 24 óra)
     src/domain/geo.js        — koordináták, távolság, üresjárati mátrix
     src/domain/logic.js      — rendszám, előfordulások, ütközések, törlésvédelem
     src/domain/optimizer.js  — feladatok, útvonal, láncolás, hozzárendelés
     src/ui/                  — stílusok, alap építőkockák, térképválasztó
     src/screens/             — Hét, Beosztás, Adatok, Fuvar, Sofőr
     src/App.jsx              — navigáció, állapot, mentés

   Új kódot a megfelelő modulba írj, ne ide.
   ===================================================================== */

export { default } from "./src/App.jsx";

/* A tesztek (test/) által használt tiszta függvények újra közzétéve. */
export { DEFAULT_SETTINGS, isNotFound } from "./src/data/storage.js";
export { ensureShape, seedState } from "./src/data/seed.js";
export { uid, byId, DAYS } from "./src/domain/constants.js";
export {
  timeToMin, minToTime, weekdayIdx, mondayOf, toISO, addDays,
} from "./src/domain/datetime.js";
export { legMin, matrixKey, computeMatrix } from "./src/domain/geo.js";
export {
  normalizePlate, plateExists, rideWindow, findConflicts, venueDepartMin, deleteGuard,
  teamLeg, legFor, legSource, hasOwnStops,
  venueNeedsVignette, taskNeedsVignette, chainNeedsVignette, vignetteVenues, baseOf,
} from "./src/domain/logic.js";
export {
  bestStationOrder, teamRouteOrder, legRouteOrder, splitStationsByCapacity, planOda, planVissza,
  teamPax, legPax, genDayTasks, resolveDay, mkChain, dayStats, driverAvailableFor, assignResources,
  spanOf, mergeShifts, driverPay, onSiteWait, chainUse,
  optimizeDay, withGeneratedRides,
} from "./src/domain/optimizer.js";
