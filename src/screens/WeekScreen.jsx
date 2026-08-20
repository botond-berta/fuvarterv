/* Vector — Hét — a hét összes edzése, csapatszínekkel
   Kiemelve a fuvarterv.jsx-ből; a viselkedés változatlan. */

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DAYS } from "../domain/constants.js";
import { toISO, addDays, mondayOf, fmtDate, fmtWeekRange } from "../domain/datetime.js";
import { weekOccurrences } from "../domain/logic.js";
import { EmptyState, InfoDot } from "../ui/base.jsx";
import { OccCard } from "../ui/OccCard.jsx";

/* ---------- 4.1 HETI ÁTTEKINTÉS ---------- */
export function WeekScreen({ state, openRide }) {
  const [mon, setMon] = useState(() => mondayOf(new Date()));
  const todayISO = toISO(new Date());
  const occs = useMemo(() => weekOccurrences(state, mon), [state, mon]);

  const days = [...Array(7)].map((_, di) => ({
    di, dateISO: toISO(addDays(mon, di)),
    items: occs.filter((o) => o.dayIdx === di),
  })).filter((d) => d.items.length > 0);

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between py-3">
        <button className="iconbtn" onClick={() => setMon(addDays(mon, -7))} aria-label="Előző hét"><ChevronLeft size={18} /></button>
        <button className="disp text-lg" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          onClick={() => setMon(mondayOf(new Date()))} title="Ugrás a mai hétre">
          {fmtWeekRange(mon)}
        </button>
        <button className="iconbtn" onClick={() => setMon(addDays(mon, 7))} aria-label="Következő hét"><ChevronRight size={18} /></button>
      </div>

      {days.length === 0 && (
        <EmptyState>Ezen a héten nincs edzés. Új edzést a <b>Csapatok</b> fülön, a csapat adatlapján vehetsz fel.</EmptyState>
      )}

      {days.map((d) => (
        <section key={d.di} className="mb-4">
          <div className="flex items-baseline gap-2 mb-2 px-1">
            <h2 className="disp text-base">{DAYS[d.di]}</h2>
            <span className="text-sm" style={{ color: "var(--ink2)" }}>{fmtDate(d.dateISO)}</span>
            {d.dateISO === todayISO && <span className="pill pill-miss disp">MA</span>}
          </div>
          <div className="flex flex-col gap-2">
            {d.items.map((o) => <OccCard key={o.training.id + "-" + o.dayIdx} state={state} occ={o} onOpen={() => openRide(o)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
