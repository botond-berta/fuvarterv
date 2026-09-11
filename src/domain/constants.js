/* Fuvarterv — constants and small helpers used across the whole app.

   The day, month and gender lists are UI copy and stay Hungarian: they are
   rendered directly, and DAYS is also indexed by weekday number everywhere in
   the scheduler (Monday = 0). */

export const DAYS = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat", "Vasárnap"];
export const DAYS_SHORT = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
export const MONTHS = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
export const GENDERS = ["lány", "fiú", "női", "férfi", "vegyes"];
export const TEAM_COLORS = ["#D6336C", "#1E6FD9", "#6F42C1", "#0F8A5F", "#D9760B", "#0E7C99", "#B02A2A", "#5C7A0A"];

export const uid = () => Math.random().toString(36).slice(2, 10);
export const byId = (arr, id) => arr.find((x) => x.id === id);
