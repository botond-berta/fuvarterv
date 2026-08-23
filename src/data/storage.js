/* Fuvarterv — perzisztencia-varrat és a hangolható beállítások alapértékei
   Kiemelve a fuvarterv.jsx monolitból; a viselkedés változatlan. */

export const STORAGE_KEY = "fuvarterv:v1";

/* Az összes hangolható beállítás alapértéke — EGY forrás, hogy a seedState() és az
   ensureShape() ne csúszhasson szét. Mindkettő innen dolgozik. */
export const DEFAULT_SETTINGS = {
  arriveEarlyMin: 10,   // perc: mennyivel az edzés előtt érjen oda a busz
  departAfterMin: 10,   // perc: mennyivel az edzés után induljon a visszaút
  calloutFee: 1500,     // Ft: egy sofőr egyszeri kiszállási díja
  dwellMin: 2,          // perc: megállási idő megállónként
  estSpeedKmh: 50,      // km/h: légvonalas menetidő-becsléshez
  fallbackLegMin: 12,   // perc: üresjárat, ha se mátrix, se koordináta nincs
  preferredBias: 1000,  // Ft: büntetés, ha a sofőr nem a preferált buszát kapja (0 = kikapcsolva)
};

/* Igaz, ha a hiba azt jelenti: "még nincs mentett adat" (üres munkaterület).
   Csak ekkor szabad mintaadatot vetni; minden más hiba valódi (hálózat, jogosultság),
   olyankor NEM vetünk mintaadatot a fel nem olvasott valós adat fölé. */
export function isNotFound(err) {
  return !!(err && err.code === "NOT_FOUND");
}

/* Betölti a mentett állapotot. Nincs adat → NOT_FOUND hibát dob (a hívó vet
   mintaadatot). Bármely más hiba továbbdobódik, hogy a hívó újratöltő képernyőt
   mutathasson mintaadat helyett. */
export async function loadState() {
  const r = await window.storage.get(STORAGE_KEY);
  return r && r.value ? JSON.parse(r.value) : null;
}

export async function persistState(state) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error("Mentési hiba:", e); }
}
