/* Vector — dátum és idő — hétfővel kezdődő hetek, 24 órás idők
   Kiemelve a vector.jsx monolitból; a viselkedés változatlan. */

import { MONTHS } from "./constants.js";

export const pad2 = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const weekdayIdx = (x) => { const d = typeof x === "string" ? parseISO(x) : x; return (d.getDay() + 6) % 7; };
export const mondayOf = (x) => { const d = typeof x === "string" ? parseISO(x) : new Date(x); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - weekdayIdx(d)); return d; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const timeToMin = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const minToTime = (m) => { m = Math.max(0, Math.min(1439, Math.round(m))); return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };

export const fmtDate = (iso) => { const d = parseISO(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}.`; };
export const fmtDateFull = (iso) => { const d = parseISO(iso); return `${d.getFullYear()}. ${MONTHS[d.getMonth()]} ${d.getDate()}.`; };
export function fmtWeekRange(mon) {
  const sun = addDays(mon, 6);
  if (mon.getMonth() === sun.getMonth())
    return `${mon.getFullYear()}. ${MONTHS[mon.getMonth()]} ${mon.getDate()} – ${sun.getDate()}.`;
  return `${mon.getFullYear()}. ${MONTHS[mon.getMonth()]} ${mon.getDate()}. – ${MONTHS[sun.getMonth()]} ${sun.getDate()}.`;
}
