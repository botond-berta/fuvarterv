/* Fuvarterv — display formatters, used by the UI only. Hungarian output by
   design: these strings go straight onto the screen. */

export const fmtFt = (n) => `${Math.round(n).toLocaleString("hu-HU")} Ft`;
export const fmtH = (min) => `${(min / 60).toFixed(1).replace(".", ",")} ó`;
