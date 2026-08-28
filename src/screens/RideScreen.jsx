/* Fuvarterv — Fuvar szerkesztő — irány, jármű, sofőr, megállók
   Kiemelve a fuvarterv.jsx-ből. Egy eltérés az eredetitől: egy már mentett
   fuvar iránya nem állítható át. */

import { useState, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, GripVertical, ArrowUp, ArrowDown, AlertTriangle, MapPin, Clock, X, Flag, Zap } from "lucide-react";
import { DAYS, uid, byId } from "../domain/constants.js";
import { mondayOf, toISO, addDays, timeToMin, minToTime, fmtDate, fmtDateFull, fmtWeekRange } from "../domain/datetime.js";
import { weekOccurrences, findRides, findConflicts, rideWindow, seatSum, venueDepartMin, legFor, venueNeedsVignette } from "../domain/logic.js";
import { planOda, planVissza, bestStationOrder } from "../domain/optimizer.js";
import { Field, DangerBtn, EmptyState, InfoDot } from "../ui/base.jsx";
import { OccCard } from "../ui/OccCard.jsx";

/* ---------- 4.4 FUVAR SZERKESZTŐ ---------- */
export function RideScreen({ state, update, target, setTarget, onExit }) {
  if (!target) return <RidePicker state={state} onPick={setTarget} />;
  const training = byId(state.trainings, target.trainingId);
  if (!training) return <RidePicker state={state} onPick={setTarget} />;
  return (
    <RideEditor key={`${target.trainingId}-${target.dayIdx}`}
      state={state} update={update} training={training}
      dayIdx={target.dayIdx} dateISO={target.dateISO}
      onBack={onExit || (() => setTarget(null))} />
  );
}

export function RidePicker({ state, onPick }) {
  const [mon, setMon] = useState(() => mondayOf(new Date()));
  const occs = weekOccurrences(state, mon);
  return (
    <div className="px-4 pb-4">
      <div className="py-3"><h2 className="disp text-xl">Fuvar szerkesztő</h2>
        <p className="text-sm mt-1" style={{ color: "var(--ink2)" }}>Válaszd ki az edzésalkalmat, amihez fuvart rendelsz.</p>
      </div>
      <div className="flex items-center justify-between mb-3">
        <button className="iconbtn" onClick={() => setMon(addDays(mon, -7))} aria-label="Előző hét"><ChevronLeft size={18} /></button>
        <span className="disp">{fmtWeekRange(mon)}</span>
        <button className="iconbtn" onClick={() => setMon(addDays(mon, 7))} aria-label="Következő hét"><ChevronRight size={18} /></button>
      </div>
      <div className="flex flex-col gap-2">
        {occs.map((o) => <OccCard key={o.training.id + o.dayIdx} state={state} occ={o} onOpen={() => onPick(o2t(o))} />)}
        {occs.length === 0 && <EmptyState>Ezen a héten nincs edzésalkalom.</EmptyState>}
      </div>
    </div>
  );
}
export const o2t = (o) => ({ trainingId: o.training.id, dayIdx: o.dayIdx, dateISO: o.dateISO });

export function RideEditor({ state, update, training, dayIdx, dateISO, onBack }) {
  const rides = findRides(state, training, dayIdx);
  const [selIdx, setSelIdx] = useState(0);
  const idx = Math.min(selIdx, rides.length); // rides.length = új fuvar
  const existing = idx < rides.length ? rides[idx] : null;
  return (
    <div>
      {rides.length > 0 && (
        <div className="px-4 pt-3 flex gap-2 flex-wrap">
          {rides.map((r, i) => {
            const d = byId(state.drivers, r.driverId);
            return (
              <button key={r.id} className={`chip ${i === idx ? "on" : ""}`} onClick={() => setSelIdx(i)}>
                {i + 1}. fuvar · {(r.dir || "oda") === "vissza" ? "VISSZA" : "ODA"}{d ? ` · ${d.name}` : ""}
              </button>
            );
          })}
          <button className={`chip ${idx === rides.length ? "on" : ""}`} onClick={() => setSelIdx(rides.length)}>＋ Új fuvar</button>
        </div>
      )}
      <RideForm key={existing ? existing.id : `uj-${rides.length}`}
        state={state} update={update} training={training}
        dayIdx={dayIdx} dateISO={dateISO} existing={existing} onBack={onBack} />
    </div>
  );
}

export function RideForm({ state, update, training, dayIdx, dateISO, existing, onBack }) {
  const team = byId(state.teams, training.teamId);
  const venue = byId(state.venues, training.venueId);

  const [draft, setDraft] = useState(() => existing
    ? { ...existing, stops: existing.stops.map((s) => ({ ...s })) }
    : { id: "__uj", trainingId: training.id, day: training.type === "weekly" ? dayIdx : null, date: training.type === "once" ? training.date : null, vehicleId: "", driverId: "", dir: "oda", stops: [] });

  /* Irány. A régebbi, irány nélkül mentett fuvarok ODA-ként viselkednek — ezt a
     rideWindow is így értelmezi (`ride.dir || "oda"`), tehát a kettő nem csúszhat szét. */
  const dir = draft.dir || "oda";
  const isBack = dir === "vissza";
  /* Mentett fuvarnál az irány rögzített. A fuvar neve (a fenti választó chipje),
     a megállók idői és a csapat iránya szerinti megállólista mind az irányra
     épül — átkapcsolva egy VISSZA fuvar ODA-ként menne tovább a régi, immár
     értelmetlen időivel, a sofőr pedig a listáján ugyanazt a fuvart látná
     megfordulva. Rossz irány esetén a fuvart törölni kell és újra felvenni. */
  const dirLocked = !!existing;

  const vehicle = byId(state.vehicles, draft.vehicleId);
  const needsVignette = venueNeedsVignette(state, training.venueId);
  const hasSchedule = ((state.assignments?.[dayIdx]?.chains) || []).length > 0;
  const conflicts = useMemo(() => findConflicts(state, draft), [state, draft]);
  const vConf = conflicts.filter((c) => c.type === "vehicle");
  const dConf = conflicts.filter((c) => c.type === "driver");
  const pax = seatSum(draft.stops);
  const over = vehicle && pax > vehicle.seats;

  /* Az irány saját megállói kerülnek előre — de bármelyik állomás választható,
     mert egy konkrét fuvar eltérhet az állandó listától (pl. egyszeri kitérő).
     A lista ezé az EDZÉSÉ, ha van saját listája: egy másik helyszínen tartott
     edzés megállói másokat kínálnának fel elsőként. */
  const leg = legFor(team, training, dir);
  const used = (id) => draft.stops.some((x) => x.stationId === id);
  const legStations = state.stations.filter((s) => leg.stationIds.includes(s.id) && !used(s.id));
  const otherStations = state.stations.filter((s) => !leg.stationIds.includes(s.id) && !used(s.id));
  const freeStations = [...legStations, ...otherStations];

  const addStop = (stationId) => {
    /* ODA: az edzés kezdete előtt gyűjtünk be; VISSZA: a helyszíni indulás után
       tesszük le a gyerekeket — a kiinduló idő tehát a két irányban más. */
    const first = isBack ? venueDepartMin(state, training) + 10 : (timeToMin(training.start) ?? 0) - 40;
    const base = draft.stops.length
      ? (timeToMin(draft.stops[draft.stops.length - 1].time) ?? first) + 10
      : first;
    setDraft({ ...draft, stops: [...draft.stops, { id: uid(), stationId, time: minToTime(base), count: leg.stationCounts?.[stationId] || "" }] });
  };
  const setStop = (i, patch) => setDraft({ ...draft, stops: draft.stops.map((s, j) => j === i ? { ...s, ...patch } : s) });
  const delStop = (i) => setDraft({ ...draft, stops: draft.stops.filter((_, j) => j !== i) });
  const move = (from, to) => {
    if (to < 0 || to >= draft.stops.length) return;
    const arr = [...draft.stops];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    setDraft({ ...draft, stops: arr });
  };

  /* Menetrend. ODA: visszafelé számolva az edzéskezdéstől, cél az időben odaérés.
     VISSZA: előrefelé a helyszíni indulástól. A két irány két külön tervezőt hív —
     korábban mindkettő planOda-t futtatott, ami a VISSZA fuvarok megállóidejét
     órákkal elrontotta, és ezt látták a sofőrök. */
  const arriveBy = (timeToMin(training.start) ?? 0) - (state.settings.arriveEarlyMin ?? 10);
  const departAt = venueDepartMin(state, training);
  const dwell = state.settings.dwellMin ?? 2;

  const planFor = (order) => isBack
    ? planVissza(state, order, training.venueId, departAt, dwell)
    : planOda(state, order, training.venueId, arriveBy, dwell);

  const fillTimes = () => {
    if (!draft.stops.length) return;
    const p = planFor(draft.stops.map((s) => s.stationId));
    setDraft({ ...draft, stops: draft.stops.map((s, i) => ({ ...s, time: minToTime(p.stops[i].arr) })) });
  };
  /* Sorrend optimalizálása (Held–Karp) + idők kitöltése. VISSZA-nál a helyszín az
     útvonal ELEJE (pre), nem a vége (post). */
  const optimizeStopOrder = () => {
    if (!draft.stops.length) return;
    const ids = draft.stops.map((s) => s.stationId);
    const order = bestStationOrder(state, ids, isBack ? { pre: training.venueId } : { post: training.venueId });
    const byStation = Object.fromEntries(draft.stops.map((s) => [s.stationId, s]));
    const p = planFor(order);
    setDraft({ ...draft, stops: order.map((sid, i) => ({ ...byStation[sid], time: minToTime(p.stops[i].arr) })) });
  };

  /* Drag & drop (asztali); mobilon a nyilak */
  const dragFrom = useRef(null);
  const [dragOn, setDragOn] = useState(false);

  const save = () => {
    update((s) => existing
      ? { ...s, rides: s.rides.map((r) => r.id === existing.id ? { ...draft, id: existing.id } : r) }
      : { ...s, rides: [...s.rides, { ...draft, id: uid() }] });
    onBack();
  };
  const remove = () => {
    if (existing) update((s) => ({ ...s, rides: s.rides.filter((r) => r.id !== existing.id) }));
    onBack();
  };

  const confText = (c) => {
    const tm = byId(state.teams, c.training.teamId);
    const [w1] = rideWindow(state, c.ride, c.training);
    const day = c.training.type === "weekly" ? DAYS[c.ride.day] : fmtDate(c.training.date);
    return `${tm?.name || "?"} · ${day} ${minToTime(w1)}–${c.training.start}`;
  };

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-2 py-3">
        <button className="iconbtn" onClick={onBack} aria-label="Vissza"><ChevronLeft size={18} /></button>
        <h2 className="disp text-xl">Fuvar szerkesztő</h2>
      </div>

      <div className="card p-3 mb-4 flex gap-3 overflow-hidden">
        <div style={{ width: 6, background: team?.color || "#999", borderRadius: 3, flexShrink: 0 }} aria-hidden />
        <div className="min-w-0">
          <div className="font-semibold flex items-center gap-2">
            <span className={`dirpill ${isBack ? "v" : ""}`}>{isBack ? "VISSZA" : "ODA"}</span>
            {team?.name}
          </div>
          <div className="tnum text-lg">{DAYS[dayIdx]} · {training.start}–{training.end}</div>
          <div className="text-sm flex items-center gap-1" style={{ color: "var(--ink2)" }}>
            <MapPin size={14} /> {venue?.name} <span>· {fmtDateFull(dateISO)}</span>
          </div>
          {draft.source === "schedule" && <div className="text-xs mt-1" style={{ color: "var(--ink2)" }}>Beosztásból generált fuvar — kézi módosítás után az újragenerálás felülírja.</div>}
          {/* A withGeneratedRides a nap érintett edzéseinek MINDEN fuvarját lecseréli,
              tehát az itt kézzel választott jármű is elveszik a következő generálásnál.
              Csak akkor szólunk, ha van mentett beosztás a napra — különben nincs mi felülírja. */}
          {hasSchedule && <div className="text-xs mt-1" style={{ color: "var(--warn)" }}>Erre a napra van mentett beosztás: a „Fuvarok generálása” ezt a fuvart felülírja. Ha a járművet rögzíteni akarod, a Beosztás fülön zárold a feladatot.</div>}
        </div>
      </div>

      <Field label={dirLocked ? `Irány · ${isBack ? "VISSZA" : "ODA"} (rögzített)` : "Irány"}
        hint={dirLocked
          ? "A mentett fuvar iránya nem módosítható. Ha rossz irányú lett, töröld a fuvart, és vedd fel újra a másik irányban."
          : "ODA: a falvakból a helyszínre. VISSZA: a helyszínről haza. Mentés után már nem módosítható."}>
        <div className="seg">
          <button className={!isBack ? "on" : ""} disabled={dirLocked} aria-pressed={!isBack}
            onClick={() => setDraft({ ...draft, dir: "oda" })}>ODA</button>
          <button className={isBack ? "on" : ""} disabled={dirLocked} aria-pressed={isBack}
            onClick={() => setDraft({ ...draft, dir: "vissza" })}>VISSZA</button>
        </div>
      </Field>

      <Field label="Jármű *">
        <select className="inp" value={draft.vehicleId} onChange={(e) => setDraft({ ...draft, vehicleId: e.target.value })}>
          <option value="">– válassz járművet –</option>
          {state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.plate}) · {v.seats} fő{v.hasVignette ? " · matricás" : ""}</option>)}
        </select>
      </Field>
      {vConf.map((c, i) => (
        <div key={i} className="banner banner-danger mb-3"><AlertTriangle size={18} />
          <span>A jármű ekkor máshol foglalt: <b>{confText(c)}</b></span></div>
      ))}
      {needsVignette && vehicle && !vehicle.hasVignette && (
        <div className="banner banner-warn mb-3"><AlertTriangle size={18} />
          <span><b>{venue?.name}</b> csak országos matricás autóval érhető el, a(z) {vehicle.plate} viszont nincs matricával.</span></div>
      )}

      <Field label="Sofőr *">
        <select className="inp" value={draft.driverId} onChange={(e) => setDraft({ ...draft, driverId: e.target.value })}>
          <option value="">– válassz sofőrt –</option>
          {state.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      {dConf.map((c, i) => (
        <div key={i} className="banner banner-danger mb-3"><AlertTriangle size={18} />
          <span>A sofőrnek ekkor másik fuvarja van: <b>{confText(c)}</b></span></div>
      ))}

      <div className="flex items-center justify-between mt-4 mb-2">
        <h3 className="disp text-base">Megállók sorrendben</h3>
        {vehicle && <span className={`pill ${over ? "pill-conf" : ""}`} style={over ? {} : { background: "#EEF0F3", color: "var(--ink2)" }}>{pax} / {vehicle.seats} fő</span>}
      </div>
      {over && <div className="banner banner-danger mb-2"><AlertTriangle size={18} />Az utaslétszám ({pax} fő) meghaladja a jármű férőhelyeit ({vehicle.seats}).</div>}

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <button className="btn btn-ghost" onClick={fillTimes} disabled={!draft.stops.length}><Clock size={15} /> Idők számítása</button>
        <button className="btn btn-ghost" onClick={optimizeStopOrder} disabled={draft.stops.length < 2}><Zap size={15} /> Sorrend + idők</button>
        <span className="text-xs" style={{ color: "var(--ink2)" }}>
          {isBack ? `Indulás a helyszínről ${minToTime(departAt)}-kor.` : `Cél: érkezés ${minToTime(arriveBy)}-ig.`}
        </span>
      </div>

      <div className="rail flex flex-col gap-2 mb-2">
        {isBack && (
          <div className="rail-row">
            <span className="rail-dot dest" aria-hidden />
            <div className="p-2 flex items-center gap-2 text-sm font-semibold">
              <Flag size={15} style={{ color: "var(--ok)" }} /> {venue?.name} · indulás <span className="tnum text-base">{minToTime(departAt)}</span>
            </div>
          </div>
        )}
        {draft.stops.map((s, i) => {
          const st = byId(state.stations, s.stationId);
          return (
            <div key={s.id} className="rail-row"
              draggable={dragOn}
              onDragStart={() => { dragFrom.current = i; }}
              onDragOver={(e) => { e.preventDefault(); if (dragFrom.current === null || dragFrom.current === i) return; move(dragFrom.current, i); dragFrom.current = i; }}
              onDragEnd={() => { dragFrom.current = null; setDragOn(false); }}>
              <span className="rail-dot" aria-hidden />
              <div className="card p-2 flex items-center gap-2">
                <span onMouseDown={() => setDragOn(true)} onMouseUp={() => setDragOn(false)}
                  style={{ cursor: "grab", color: "var(--ink2)", touchAction: "none" }} title="Húzd a sorrendhez">
                  <GripVertical size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{st?.name || "?"}</div>
                  <div className="flex gap-2 mt-1">
                    <input type="time" className="inp" style={{ minHeight: 38, padding: "6px 8px", width: 110 }} value={s.time}
                      onChange={(e) => setStop(i, { time: e.target.value })} aria-label={`${isBack ? "Érkezési" : "Indulási"} idő: ${st?.name || "megálló"}`} />
                    <input type="number" min="0" className="inp" style={{ minHeight: 38, padding: "6px 8px", width: 74 }} value={s.count}
                      onChange={(e) => setStop(i, { count: e.target.value })} placeholder="fő" aria-label={`Létszám: ${st?.name || "megálló"}`} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => move(i, i - 1)} aria-label="Feljebb"><ArrowUp size={15} /></button>
                  <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => move(i, i + 1)} aria-label="Lejjebb"><ArrowDown size={15} /></button>
                </div>
                <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => delStop(i)} aria-label="Megálló törlése"><X size={15} /></button>
              </div>
            </div>
          );
        })}
        {!isBack && (
          <div className="rail-row">
            <span className="rail-dot dest" aria-hidden />
            <div className="p-2 flex items-center gap-2 text-sm font-semibold">
              <Flag size={15} style={{ color: "var(--ok)" }} /> {venue?.name} · érkezés legkésőbb <span className="tnum text-base">{training.start}</span>
            </div>
          </div>
        )}
      </div>

      {freeStations.length > 0 ? (
        <select className="inp mb-4" value="" onChange={(e) => e.target.value && addStop(e.target.value)}
          aria-label="Megálló hozzáadása az útvonalhoz">
          <option value="">＋ Megálló hozzáadása…</option>
          {legStations.length > 0 && (
            <optgroup label={`${training.stops ? "Az edzés" : "A csapat"} megállói (${isBack ? "VISSZA" : "ODA"})`}>
              {legStations.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` – ${s.address}` : ""}</option>)}
            </optgroup>
          )}
          {otherStations.length > 0 && (
            <optgroup label="Egyéb állomások">
              {otherStations.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` – ${s.address}` : ""}</option>)}
            </optgroup>
          )}
        </select>
      ) : state.stations.length === 0 ? (
        <div className="banner banner-warn mb-4"><AlertTriangle size={18} />Még nincs felvett állomás. Az Adatok fülön vehetsz fel újat.</div>
      ) : (
        <p className="text-sm mb-4 px-1" style={{ color: "var(--ink2)" }}>Minden állomás szerepel már az útvonalban.</p>
      )}

      <div className="flex gap-2">
        <button className="btn btn-pri flex-1" disabled={!draft.vehicleId || !draft.driverId} onClick={save}>Fuvar mentése</button>
        {existing && <DangerBtn label="Törlés" onConfirm={remove} />}
      </div>
      {(!draft.vehicleId || !draft.driverId) && (
        <p className="text-xs mt-2 px-1" style={{ color: "var(--ink2)" }}>A mentéshez jármű és sofőr kiválasztása szükséges. Az ütközés csak figyelmeztetés, nem tiltja a mentést.</p>
      )}
    </div>
  );
}
