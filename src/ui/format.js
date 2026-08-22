/* Vector — megjelenítési formázók (csak a felület használja)
   Kiemelve a vector.jsx monolitból; a viselkedés változatlan. */

export const fmtFt = (n) => `${Math.round(n).toLocaleString("hu-HU")} Ft`;
export const fmtH = (min) => `${(min / 60).toFixed(1).replace(".", ",")} ó`;
