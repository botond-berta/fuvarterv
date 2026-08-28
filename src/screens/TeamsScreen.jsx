/* Fuvarterv — Csapatok — állomások, létszámok, útvonal, edzések
   Kiemelve a fuvarterv.jsx-ből. A megállólista-szerkesztő azóta önálló,
   újrahasznosított komponens (StopListEditor): a csapat állandó listáját és az
   edzés saját listáját (TrainingDetail) ugyanaz szolgálja ki. */

import { useState } from "react";
import { Plus, Pencil, ChevronLeft, AlertTriangle, MapPin, ChevronsRight, Route } from "lucide-react";
import { GENDERS, TEAM_COLORS, uid, byId } from "../domain/constants.js";
import { DAYS, DAYS_SHORT } from "../domain/constants.js";
import { fmtDate } from "../domain/datetime.js";
import { Field, Modal, DangerBtn, TeamDot, EmptyState, InfoDot } from "../ui/base.jsx";
import { fmtDateFull, toISO } from "../domain/datetime.js";
import { StopListEditor } from "./StopListEditor.jsx";

/* ---------- 4.2 CSAPATOK ---------- */
export function TeamsScreen({ state, update, notice }) {
  const [selId, setSelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const sel = selId && byId(state.teams, selId);

  if (sel) return <TeamDetail state={state} update={update} team={sel} onBack={() => setSelId(null)} notice={notice} />;

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between py-3">
        <span className="text-sm" style={{ color: "var(--ink2)" }}>{state.teams.length} csapat</span>
        <button className="btn btn-pri" onClick={() => setCreating(true)}><Plus size={17} /> Új csapat</button>
      </div>
      <div className="flex flex-col gap-2">
        {state.teams.map((t) => {
          const trCount = state.trainings.filter((x) => x.teamId === t.id).length;
          return (
            <button key={t.id} className="card w-full text-left p-0 overflow-hidden flex" style={{ cursor: "pointer" }} onClick={() => setSelId(t.id)}>
              <div style={{ width: 6, background: t.color, flexShrink: 0 }} aria-hidden />
              <div className="flex-1 p-3">
                <div className="font-semibold">{t.name}</div>
                <div className="text-sm" style={{ color: "var(--ink2)" }}>
                  {t.age} · {t.gender} · {trCount} edzés/hét · {t.stationIds.length} állomás
                </div>
              </div>
              <div className="flex items-center pr-3" style={{ color: "var(--ink2)" }}><ChevronsRight size={18} /></div>
            </button>
          );
        })}
        {state.teams.length === 0 && <EmptyState>Még nincs csapat. Hozd létre az elsőt az <b>Új csapat</b> gombbal.</EmptyState>}
      </div>
      {creating && (
        <TeamForm
          onCancel={() => setCreating(false)}
          onSave={(t) => { update((s) => ({ ...s, teams: [...s.teams, { ...t, id: uid(), stationIds: [], venueIds: [] }] })); setCreating(false); }}
        />
      )}
    </div>
  );
}

export function TeamForm({ team, onSave, onCancel }) {
  const [f, setF] = useState(team || { name: "", age: "", gender: "lány", color: TEAM_COLORS[0], passengerCount: null });
  return (
    <Modal title={team ? "Csapat szerkesztése" : "Új csapat"} onClose={onCancel}>
      <Field label="Név *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="pl. U12 Lány" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Korosztály"><input className="inp" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} placeholder="U12" /></Field>
        <Field label="Nem">
          <select className="inp" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Szállítandó létszám" hint="Tartalék érték: ha nincs megállónkénti bontás a csapatnál, ez számít.">
        <input type="number" min="0" className="inp" value={f.passengerCount ?? ""} placeholder="pl. 7"
          onChange={(e) => setF({ ...f, passengerCount: e.target.value })} />
      </Field>
      <Field label="Szín">
        <div className="flex gap-2 flex-wrap">
          {TEAM_COLORS.map((c) => (
            <button key={c} onClick={() => setF({ ...f, color: c })} aria-label={`Szín ${c}`}
              style={{ width: 40, height: 40, borderRadius: 10, background: c, border: f.color === c ? "3px solid var(--ink)" : "3px solid transparent", cursor: "pointer" }} />
          ))}
        </div>
      </Field>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-pri flex-1" disabled={!f.name.trim()}
          onClick={() => onSave({ ...f, passengerCount: f.passengerCount === "" || f.passengerCount == null ? null : Math.max(0, Number(f.passengerCount) || 0) })}>Mentés</button>
        <button className="btn btn-ghost" onClick={onCancel}>Mégse</button>
      </div>
    </Modal>
  );
}

export function TeamDetail({ state, update, team, onBack, notice }) {
  const [editing, setEditing] = useState(false);
  const [trForm, setTrForm] = useState(null); // null | {} | training
  const [selTrId, setSelTrId] = useState(null);
  const trainings = state.trainings.filter((t) => t.teamId === team.id);
  const selTr = selTrId && byId(trainings, selTrId);

  const toggle = (key, id) => update((s) => ({
    ...s,
    teams: s.teams.map((t) => t.id !== team.id ? t : {
      ...t, [key]: t[key].includes(id) ? t[key].filter((x) => x !== id) : [...t[key], id],
    }),
  }));

  const setTeamField = (patch) => update((s) => ({
    ...s, teams: s.teams.map((x) => (x.id === team.id ? { ...x, ...patch } : x)),
  }));

  const deleteTeam = () => {
    update((s) => {
      const trIds = s.trainings.filter((t) => t.teamId === team.id).map((t) => t.id);
      return {
        ...s,
        teams: s.teams.filter((t) => t.id !== team.id),
        trainings: s.trainings.filter((t) => t.teamId !== team.id),
        rides: s.rides.filter((r) => !trIds.includes(r.trainingId)),
      };
    });
    onBack();
  };

  const deleteTraining = (id) => update((s) => ({
    ...s,
    trainings: s.trainings.filter((t) => t.id !== id),
    rides: s.rides.filter((r) => r.trainingId !== id),
  }));

  if (selTr) return (
    <TrainingDetail state={state} update={update} team={team} training={selTr} onBack={() => setSelTrId(null)} />
  );

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-2 py-3">
        <button className="iconbtn" onClick={onBack} aria-label="Vissza"><ChevronLeft size={18} /></button>
        <TeamDot color={team.color} size={14} />
        <h2 className="disp text-xl flex-1 truncate">{team.name}</h2>
        <button className="iconbtn" onClick={() => setEditing(true)} aria-label="Szerkesztés"><Pencil size={17} /></button>
      </div>
      <div className="text-sm mb-4 px-1" style={{ color: "var(--ink2)" }}>{team.age} · {team.gender}</div>

      <StopListEditor state={state} value={team} onChange={setTeamField}
        venueId={team.venueIds[0] || null} venueName={byId(state.venues, team.venueIds[0])?.name || "1. helyszín"} />

      <h3 className="disp text-base mb-2">Helyszínek</h3>
      <div className="flex gap-2 flex-wrap mb-4">
        {state.venues.map((v) => (
          <button key={v.id} className={`chip ${team.venueIds.includes(v.id) ? "on" : ""}`} onClick={() => toggle("venueIds", v.id)}>{v.name}</button>
        ))}
        {state.venues.length === 0 && <span className="text-sm" style={{ color: "var(--ink2)" }}>Vegyél fel helyszínt az Adatok fülön.</span>}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="disp text-base">Edzések</h3>
        <button className="btn btn-ghost" onClick={() => setTrForm({})}><Plus size={16} /> Új edzés</button>
      </div>
      <div className="flex flex-col gap-2 mb-6">
        {trainings.map((t) => {
          const venue = byId(state.venues, t.venueId);
          return (
            <div key={t.id} className="card p-3 flex items-center gap-3">
              <button className="flex-1 min-w-0 text-left" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", color: "inherit" }}
                onClick={() => setSelTrId(t.id)}>
                <div className="font-semibold tnum flex items-center gap-2 flex-wrap">
                  {t.type === "weekly" ? t.days.map((d) => DAYS_SHORT[d]).join(", ") : fmtDateFull(t.date)} · {t.start}–{t.end}
                  {t.stops && <span className="pill" style={{ background: "var(--acc-soft)", color: "var(--acc)" }}>saját megállók</span>}
                </div>
                <div className="text-sm flex items-center gap-1" style={{ color: "var(--ink2)" }}>
                  <MapPin size={13} /> {venue?.name || "nincs helyszín"}
                  <span>· {(t.stops ? t.stops.stationIds || [] : team.stationIds).length} állomás</span>
                </div>
              </button>
              <button className="iconbtn" onClick={() => setSelTrId(t.id)} aria-label="Edzés megnyitása"><ChevronsRight size={17} /></button>
              <DangerBtn small onConfirm={() => deleteTraining(t.id)} />
            </div>
          );
        })}
        {trainings.length === 0 && <EmptyState>Nincs edzés. Az <b>Új edzés</b> gombbal adhatsz hozzá.</EmptyState>}
      </div>

      <DangerBtn label="Csapat törlése" confirmLabel="Biztos? Edzései és fuvarjai is törlődnek" onConfirm={deleteTeam} />

      {editing && (
        <TeamForm team={team} onCancel={() => setEditing(false)}
          onSave={(f) => { update((s) => ({ ...s, teams: s.teams.map((t) => t.id === team.id ? { ...t, ...f } : t) })); setEditing(false); }} />
      )}
      {trForm !== null && (
        <TrainingForm state={state} team={team} training={trForm.id ? trForm : null}
          onCancel={() => setTrForm(null)}
          onSave={(tr) => {
            update((s) => tr.id
              ? { ...s, trainings: s.trainings.map((x) => x.id === tr.id ? tr : x) }
              : { ...s, trainings: [...s.trainings, { ...tr, id: uid() }] });
            setTrForm(null);
          }} />
      )}
    </div>
  );
}

/* Egy edzés részletei. Külön képernyő és nem modál: a megállólista-szerkesztő
   túl magas ahhoz, hogy mobilon egy alsó lapon kényelmesen elférjen. */
export function TrainingDetail({ state, update, team, training, onBack }) {
  const [editing, setEditing] = useState(false);
  const venue = byId(state.venues, training.venueId);
  const own = !!training.stops;

  const setTraining = (patch) => update((s) => ({
    ...s, trainings: s.trainings.map((t) => (t.id === training.id ? { ...t, ...patch } : t)),
  }));
  const setStops = (patch) => setTraining({ stops: { ...training.stops, ...patch } });

  /* Bekapcsoláskor a csapat aktuális listájából indulunk, hogy legyen mit
     szerkeszteni — ugyanaz a minta, mint a visszaút külön listájánál. A másolat
     ettől a pillanattól független: a csapat listájának változása nem követi. */
  const copyOf = (src) => ({
    stationIds: [...(src.stationIds || [])],
    stationCounts: { ...(src.stationCounts || {}) },
    routeMode: src.routeMode || "auto",
    routeAnchorId: src.routeAnchorId ?? null,
    returnStationIds: src.returnStationIds ? [...src.returnStationIds] : null,
    returnStationCounts: { ...(src.returnStationCounts || {}) },
    returnRouteAnchorId: src.returnRouteAnchorId ?? null,
    passengerCount: src.passengerCount ?? null,
  });
  const setOwn = (v) => setTraining({ stops: v ? copyOf(team) : null });

  /* A csapat többi, saját listás edzése — egy háromedzéses csapatnál enélkül
     minden listát elölről kellene összekattintgatni. */
  const sources = state.trainings.filter((t) => t.teamId === team.id && t.id !== training.id && t.stops);
  const when = (t) => (t.type === "weekly" ? (t.days || []).map((d) => DAYS_SHORT[d]).join(", ") : fmtDate(t.date));

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-2 py-3">
        <button className="iconbtn" onClick={onBack} aria-label="Vissza"><ChevronLeft size={18} /></button>
        <TeamDot color={team.color} size={14} />
        <h2 className="disp text-xl flex-1 truncate">{team.name} · edzés</h2>
        <button className="iconbtn" onClick={() => setEditing(true)} aria-label="Edzés szerkesztése"><Pencil size={17} /></button>
      </div>

      <div className="card p-3 mb-4">
        <div className="font-semibold tnum">
          {training.type === "weekly" ? (training.days || []).map((d) => DAYS[d]).join(", ") : fmtDateFull(training.date)} · {training.start}–{training.end}
        </div>
        <div className="text-sm flex items-center gap-1" style={{ color: "var(--ink2)" }}>
          <MapPin size={13} /> {venue?.name || "nincs helyszín"}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Route size={17} style={{ color: "var(--ink2)" }} />
        <h3 className="disp text-base">Megállók</h3>
      </div>
      <div className="seg mb-2">
        <button className={!own ? "on" : ""} onClick={() => setOwn(false)}>Megegyezik a csapatéval</button>
        <button className={own ? "on" : ""} onClick={() => setOwn(true)}>Saját lista</button>
      </div>

      {!own ? (
        <p className="text-xs mb-4 px-1" style={{ color: "var(--ink2)" }}>
          Az edzés a csapat állandó megállólistáját használja ({team.stationIds.length} állomás). Válaszd a <b>Saját lista</b> opciót, ha ez az edzés más helyszínen van, vagy más megállókról hozod a gyerekeket.
        </p>
      ) : (
        <>
          <p className="text-xs mb-3 px-1" style={{ color: "var(--ink2)" }}>
            Csak erre az edzésre érvényes. A csapat listájának későbbi módosítása ezt már nem írja felül.
          </p>
          {sources.length > 0 && (
            <Field label="Másolás másik edzésből" hint="Felülírja az itteni listát a kiválasztott edzés megállóival és létszámaival.">
              <select className="inp" value=""
                onChange={(e) => { const src = byId(sources, e.target.value); if (src) setTraining({ stops: copyOf(src.stops) }); }}>
                <option value="">— válassz edzést —</option>
                {sources.map((t) => (
                  <option key={t.id} value={t.id}>{when(t)} {t.start} · {byId(state.venues, t.venueId)?.name || "?"}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Szállítandó létszám ezen az edzésen" hint="Tartalék érték: ha nincs megállónkénti bontás, ez számít. Üresen a csapat kerete NEM érvényes erre az edzésre.">
            <input type="number" min="0" className="inp" value={training.stops.passengerCount ?? ""} placeholder="pl. 7"
              onChange={(e) => setStops({ passengerCount: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <StopListEditor state={state} value={training.stops} onChange={setStops}
            venueId={training.venueId} venueName={venue?.name} />
        </>
      )}

      {editing && (
        <TrainingForm state={state} team={team} training={training}
          onCancel={() => setEditing(false)}
          onSave={(tr) => { update((s) => ({ ...s, trainings: s.trainings.map((x) => (x.id === tr.id ? tr : x)) })); setEditing(false); }} />
      )}
    </div>
  );
}

export function TrainingForm({ state, team, training, onSave, onCancel }) {
  const teamVenues = state.venues.filter((v) => team.venueIds.includes(v.id));
  const [f, setF] = useState(training || {
    teamId: team.id, venueId: teamVenues[0]?.id || "", type: "weekly",
    days: [], date: toISO(new Date()), start: "17:00", end: "18:30",
  });
  const valid = f.venueId && f.start && f.end && (f.type === "weekly" ? f.days.length > 0 : !!f.date);

  return (
    <Modal title={training ? "Edzés szerkesztése" : "Új edzés"} onClose={onCancel}>
      {teamVenues.length === 0 ? (
        <div className="banner banner-warn mb-3"><AlertTriangle size={18} />Előbb rendelj helyszínt a csapathoz a Helyszínek listában.</div>
      ) : (
        <Field label="Helyszín *">
          <select className="inp" value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value })}>
            {teamVenues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Ismétlődés">
        <div className="seg">
          <button className={f.type === "weekly" ? "on" : ""} onClick={() => setF({ ...f, type: "weekly" })}>Heti</button>
          <button className={f.type === "once" ? "on" : ""} onClick={() => setF({ ...f, type: "once" })}>Egyszeri</button>
        </div>
      </Field>
      {f.type === "weekly" ? (
        <Field label="Napok *">
          <div className="flex gap-2 flex-wrap">
            {DAYS_SHORT.map((d, i) => (
              <button key={i} className={`chip ${f.days.includes(i) ? "on" : ""}`}
                onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort((a, b) => a - b) })}>{d}</button>
            ))}
          </div>
        </Field>
      ) : (
        <Field label="Dátum *"><input type="date" className="inp" value={f.date || ""} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kezdés *"><input type="time" className="inp" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Vége *"><input type="time" className="inp" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-pri flex-1" disabled={!valid} onClick={() => onSave(f)}>Mentés</button>
        <button className="btn btn-ghost" onClick={onCancel}>Mégse</button>
      </div>
    </Modal>
  );
}
