/* Fuvarterv — rendszám, előfordulások, fuvarablakok, ütközések, törlésvédelem
   Kiemelve a fuvarterv.jsx monolitból; a viselkedés változatlan. */

import { byId } from "./constants.js";
import { toISO, parseISO, weekdayIdx, addDays, timeToMin } from "./datetime.js";
import { legMin } from "./geo.js";

/* Rendszám: nagybetű, kötőjel a betű–szám határon (ABC-123, AABB-123) */
export function normalizePlate(raw) {
  const s = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if (m) return `${m[1]}-${m[2]}`;
  return s;
}
export function plateExists(state, plate, exceptId) {
  const p = normalizePlate(plate);
  return state.vehicles.some((v) => v.id !== exceptId && normalizePlate(v.plate) === p);
}

/* Egy edzés adott heti előfordulásai */
export function weekOccurrences(state, mon) {
  const out = [];
  for (const t of state.trainings) {
    if (t.type === "weekly") {
      for (const di of t.days) out.push({ training: t, dayIdx: di, dateISO: toISO(addDays(mon, di)) });
    } else if (t.date) {
      const diff = Math.round((parseISO(t.date) - mon) / 86400000);
      if (diff >= 0 && diff < 7) out.push({ training: t, dayIdx: weekdayIdx(t.date), dateISO: t.date });
    }
  }
  return out.sort((a, b) => a.dayIdx - b.dayIdx || (timeToMin(a.training.start) ?? 0) - (timeToMin(b.training.start) ?? 0));
}



/* Több fuvar is tartozhat egy edzésalkalomhoz (több busz hordja a csapatot) */
export function findRides(state, training, dayIdx) {
  return state.rides.filter((r) => r.trainingId === training.id && (training.type !== "weekly" || r.day === dayIdx));
}

/* A helyszíni indulás ideje egy VISSZA fuvarnál (edzés vége + ráhagyás). */
export function venueDepartMin(state, training) {
  return (timeToMin(training.end) ?? 0) + (state.settings?.departAfterMin ?? 0);
}

/* Fuvar foglaltsági ablaka. ODA: első megálló indulása → utolsó megálló + út a
   helyszínig (így egy sofőr/jármű több kört is vihet ugyanahhoz az edzéshez
   álütközés nélkül). VISSZA: helyszíni indulás → utolsó megálló érkezése. */
export function rideWindow(state, ride, training) {
  const stops = (ride.stops || []).filter((s) => timeToMin(s.time) != null);
  if ((ride.dir || "oda") === "vissza") {
    const dep = venueDepartMin(state, training);
    if (!stops.length) return [dep, dep + 1];
    const last = Math.max(...stops.map((s) => timeToMin(s.time)));
    return [dep, Math.max(dep + 1, last)];
  }
  const startCap = timeToMin(training.start) ?? 0;
  if (!stops.length) return [startCap, startCap];
  const first = Math.min(...stops.map((s) => timeToMin(s.time)));
  const last = stops.reduce((a, b) => (timeToMin(a.time) >= timeToMin(b.time) ? a : b));
  const end = timeToMin(last.time) + legMin(state, last.stationId, training.venueId);
  return [first, Math.max(first + 1, end)];
}

export function occursOnSameDay(rA, tA, rB, tB) {
  if (tA.type === "once" && tB.type === "once") return tA.date === tB.date;
  // Dátum nélküli egyszeri edzés nem helyezhető el a héten — a weekdayIdx(null)
  // korábban TypeError-t dobott innen, a Hét képernyő renderelése közben.
  const dayOf = (t, r) => (t.type === "weekly" ? r.day : (t.date ? weekdayIdx(t.date) : null));
  const dayA = dayOf(tA, rA), dayB = dayOf(tB, rB);
  if (dayA == null || dayB == null) return false;
  return dayA === dayB;
}

/* Jármű- és sofőrütközések egy (tervezett) fuvarhoz képest */
export function findConflicts(state, cand) {
  const tA = byId(state.trainings, cand.trainingId);
  if (!tA) return [];
  const out = [];
  for (const r of state.rides) {
    if (r.id === cand.id) continue;
    const tB = byId(state.trainings, r.trainingId);
    if (!tB) continue;
    if (!occursOnSameDay(cand, tA, r, tB)) continue;
    const [a1, a2] = rideWindow(state, cand, tA);
    const [b1, b2] = rideWindow(state, r, tB);
    if (!(a1 < b2 && b1 < a2)) continue;
    if (cand.vehicleId && cand.vehicleId === r.vehicleId) out.push({ type: "vehicle", ride: r, training: tB });
    if (cand.driverId && cand.driverId === r.driverId) out.push({ type: "driver", ride: r, training: tB });
  }
  return out;
}

export const seatSum = (stops) => stops.reduce((a, s) => a + (Number(s.count) > 0 ? Number(s.count) : 0), 0);

/* Törlésvédelem a törzsadatokhoz */
/* Hány mentett beosztás-lánc hivatkozik erre a sofőrre / járműre. A fuvarok
   önmagukban nem elegendők: egy lánc a beosztásban élhet anélkül is, hogy már
   fuvarrá lett volna generálva, és a törlése után a resolveDay csendben
   `undefined` sofőrt/járművet ad — a lánc hibajelzés nélkül, 0 Ft bérrel jelenik meg. */
export function chainRefs(state, field, id) {
  let c = 0;
  for (const day of Object.values(state.assignments || {}))
    for (const ch of day?.chains || []) if (ch[field] === id) c++;
  return c;
}

/* Honnan jönnek a megállók: az edzés saját listájából, vagy a csapatéból.

   Egy csapatnak több edzése lehet, akár külön helyszíneken — a megállók, a
   létszámok és a sorrend edzésenként eltérhetnek. Az edzés `stops` mezője
   ezért egy TELJES felülírás: vagy null (a csapat listája érvényes, ez a
   korábbi viselkedés), vagy ugyanazokkal a mezőnevekkel megadott saját lista.
   Az azonos mezőnevek nem véletlenek: így ugyanaz a feloldás és ugyanaz a
   szerkesztő komponens szolgálja ki mindkét szintet, adapter nélkül.

   Irányonként félig örökölni (odaút az edzésé, visszaút a csapaté) szándékosan
   nem lehet: az átláthatatlan mátrixot adna. Az edzés vagy a csapatét
   használja, vagy van egy önálló, teljes sajátja. */
export function legSource(team, training) {
  return training?.stops || team || {};
}
export const hasOwnStops = (training) => !!training?.stops;

/* Egy megállólista adott irányhoz tartozó "lába": mely megállókat érinti,
   mennyi emberrel, és melyik megálló van rögzítve a sor végére.

   Ez az EGYETLEN hely, ahol eldől, hogy a visszaút saját listát használ-e vagy
   tükrözi az odautat. Ha nincs `returnStationIds`, mindkét irány az odaút
   mezőit kapja — vagyis a korábbi viselkedés változatlan, és a meglévő
   csapatoknál semmit nem kell átállítani. A szabály a forráson belül él, tehát
   egy saját listás edzésnél az ő odaútját tükrözi, nem a csapatét.

   `isOverride` azért kell, mert a rendezés máshogy viselkedik: egy tükrözött
   visszautat meg kell fordítani, egy kézzel összeállított visszaút-listát
   viszont NEM — annak a sorrendje már a szándékolt sorrend. */
export function legFor(team, training, dir) {
  const src = legSource(team, training);
  const own = dir === "vissza" && Array.isArray(src.returnStationIds);
  const routeMode = src.routeMode || "auto";
  if (!own) {
    return {
      stationIds: src.stationIds || [],
      stationCounts: src.stationCounts || {},
      routeAnchorId: src.routeAnchorId ?? null,
      routeMode,
      isOverride: false,
    };
  }
  return {
    stationIds: src.returnStationIds,
    stationCounts: src.returnStationCounts || {},
    routeAnchorId: src.returnRouteAnchorId ?? null,
    routeMode,
    isOverride: true,
  };
}

/* A csapat szintje: pontosan az, ami az edzésenkénti listák előtt volt. Ez a
   wrapper mondja ki azt az invariánst, amit a return-leg tesztek ellenőriznek:
   felülírás nélkül semmi nem változik. */
export const teamLeg = (team, dir) => legFor(team, null, dir);

/* Országos autópálya-matrica. A jelölés a HELYSZÍNEN van (`needsVignette`), a
   járművön pedig a tény (`hasVignette`) — a feladat két végpontja közül az egyik
   mindig a helyszín (ODA: `to`, VISSZA: `from`), ezért iránytól függetlenül
   elég mindkettőt megnézni. A megállók szándékosan nem jelölhetők: a matricát a
   célpont kényszeríti ki, és így egyetlen mezőt kell karbantartani. */
export const venueNeedsVignette = (state, id) => !!byId(state.venues, id)?.needsVignette;
export const taskNeedsVignette = (state, task) =>
  venueNeedsVignette(state, task.from) || venueNeedsVignette(state, task.to);
export const chainNeedsVignette = (state, chain) =>
  (chain?.tasks || []).some((t) => taskNeedsVignette(state, t));
/* Mely matricás helyszínekre megy a lánc — az indoklásokhoz, hogy ne csak azt
   mondjuk meg, hogy baj van, hanem azt is, melyik helyszín miatt. */
export const vignetteVenues = (state, chain) => [...new Set((chain?.tasks || [])
  .flatMap((t) => [t.from, t.to])
  .filter((id) => venueNeedsVignette(state, id))
  .map((id) => byId(state.venues, id).name))];

/* Melyik telephelyről indul és hova tér vissza ez a jármű. A jármű saját
   telephelye erősebb a klubénál; ha egyik sincs, null — olyankor a fizetett idő
   a feladatoktól számít, ahogy a telephelyek bevezetése előtt. */
export function baseOf(state, vehicleId) {
  const v = byId(state.vehicles, vehicleId);
  return (v && v.baseId) || state.settings?.defaultBaseId || null;
}

export function deleteGuard(state, kind, id) {
  const n = (c, w) => (c > 0 ? `Használatban: ${c} ${w}.` : null);
  if (kind === "stations") {
    // A visszaút saját listáját is számolni kell: egy csak hazafelé használt
    // állomás egyébként hivatkozatlannak látszana, törölhetővé válna, és utána
    // a teamRouteOrder szűrője némán kihagyná — a gyerekeket nem vinné haza senki.
    // Ugyanez áll az edzések saját listáira: egy csak ott használt állomás
    // szintén hivatkozatlannak tűnne.
    const inSource = (src) => (src.stationIds || []).includes(id) || (src.returnStationIds || []).includes(id);
    const c = state.teams.filter(inSource).length
      + state.trainings.filter((t) => t.stops && inSource(t.stops)).length
      + state.rides.filter((r) => (r.stops || []).some((s) => s.stationId === id)).length;
    return n(c, "csapat/edzés/fuvar");
  }
  if (kind === "venues") {
    const c = state.teams.filter((t) => (t.venueIds || []).includes(id)).length
      + state.trainings.filter((t) => t.venueId === id).length;
    return n(c, "csapat/edzés");
  }
  if (kind === "vehicles") {
    const c = state.rides.filter((r) => r.vehicleId === id).length
      + chainRefs(state, "vehicleId", id)
      // Egy törölt preferált jármű tartósan bünteti a sofőrt: az offPreferred
      // minden járműre igaz marad, így a preferredBias végleg elrejti őt.
      + state.drivers.filter((d) => d.preferredVehicleId === id).length;
    return n(c, "fuvar/beosztás/sofőr");
  }
  if (kind === "bases") {
    // A settings.defaultBaseId-t is számolni kell: a klub telephelyét törölve
    // minden jármű telephely nélkül maradna, és a fizetett idő némán visszaesne
    // a feladatok szerinti számításra.
    const c = state.vehicles.filter((v) => v.baseId === id).length
      + (state.settings?.defaultBaseId === id ? 1 : 0);
    return n(c, "jármű/beállítás");
  }
  if (kind === "drivers") {
    const c = state.rides.filter((r) => r.driverId === id).length + chainRefs(state, "driverId", id);
    return n(c, "fuvar/beosztás");
  }
  return null;
}
