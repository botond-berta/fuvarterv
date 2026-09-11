/* Fuvarterv — coordinates, distance, and the deadhead matrix.

   This module is a LEAF in the domain graph, and deliberately so: both logic
   (rideWindow) and optimizer (genDayTasks) need legMin, so if it lived in either
   of them the two would depend on each other in a cycle. */

import { byId } from "./constants.js";

/* Default map centre: the club's own area. Change it to suit your club. */
export const CLUB_CENTER = { lat: 46.2745, lon: 19.889 };
export const r5 = (n) => Math.round(n * 1e5) / 1e5;

/* Opening map view: the item's own coordinate, else the last known station, else the club centre. */
export function defaultMapCenter(state, item) {
  if (item && item.lat != null && item.lon != null) return { lat: item.lat, lon: item.lon, zoom: 16 };
  for (let i = state.stations.length - 1; i >= 0; i--) {
    const s = state.stations[i];
    if (s.lat != null && s.lon != null) return { lat: s.lat, lon: s.lon, zoom: 14 };
  }
  return { ...CLUB_CENTER, zoom: 13 };
}

/* Depots are locations too. Without them legMin could not price the trip home
   and they would be missing from the matrix — and paid time hangs on exactly
   that distance. */
export const locOf = (state, id) => byId(state.stations, id) || byId(state.venues, id) || byId(state.bases, id);
export const locName = (state, id) => locOf(state, id)?.name || "?";

export function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* Deadhead time between two points, in minutes: matrix, else straight-line estimate, else the fallback. */
export function legMin(state, aId, bId) {
  if (!aId || !bId || aId === bId) return 0;
  const m = state.matrix?.durations?.[`${aId}|${bId}`];
  if (m != null) return m;
  const A = locOf(state, aId), B = locOf(state, bId);
  // BOTH coordinates are required. Checking only lat lets haversine return NaN,
  // and Math.max(1, NaN) is NaN too — that then runs through the whole timetable,
  // makes every comparison false (no edge is built, no clash is visible), and
  // prints times as "NaN:NaN".
  if (A && B && A.lat != null && A.lon != null && B.lat != null && B.lon != null)
    return Math.max(1, Math.round((haversineKm(A, B) / (state.settings.estSpeedKmh || 30)) * 60) + 2);
  return state.settings.fallbackLegMin ?? 10;
}

export const allPoints = (state) => [...(state.stations || []), ...(state.venues || []), ...(state.bases || [])];

export const matrixKey = (state) =>
  allPoints(state)
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => `${p.id}:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
    .join(";");

/* Deadhead matrix for every pair of located points: one OSRM request, with a straight-line estimate as the fallback. */
export async function computeMatrix(state) {
  const pts = allPoints(state).filter((p) => p.lat != null && p.lon != null);
  if (pts.length < 2) throw new Error("Legalább két, koordinátával rendelkező pont kell a mátrixhoz.");
  const durations = {};
  let source = "osrm";
  try {
    const coords = pts.map((p) => `${p.lon},${p.lat}`).join(";");
    const r = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`);
    if (!r.ok) throw new Error("http");
    const js = await r.json();
    if (js.code !== "Ok" || !js.durations) throw new Error("osrm");
    js.durations.forEach((row, i) => row.forEach((sec, j) => {
      if (i !== j && sec != null) durations[`${pts[i].id}|${pts[j].id}`] = Math.max(1, Math.round(sec / 60));
    }));
  } catch {
    source = "estimate";
    for (const a of pts) for (const b of pts) {
      if (a.id === b.id) continue;
      durations[`${a.id}|${b.id}`] = Math.max(1, Math.round((haversineKm(a, b) / (state.settings.estSpeedKmh || 30)) * 60) + 2);
    }
  }
  return { key: matrixKey(state), source, durations, computedAt: new Date().toISOString(), n: pts.length };
}
