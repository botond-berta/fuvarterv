/* Vector — Csapatok — állomások, létszámok, útvonal, edzések
   Kiemelve a vector.jsx-ből; a viselkedés változatlan. */

import { useState } from "react";
import { Plus, Pencil, ChevronLeft, AlertTriangle, MapPin, ChevronsRight } from "lucide-react";
import { GENDERS, TEAM_COLORS, uid, byId } from "../domain/constants.js";
import { DAYS, DAYS_SHORT } from "../domain/constants.js";
import { fmtDate } from "../domain/datetime.js";
import { Field, Modal, DangerBtn, TeamDot, EmptyState, InfoDot } from "../ui/base.jsx";
import { fmtDateFull, toISO } from "../domain/datetime.js";
import { planOda, teamPax, teamRouteOrder } from "../domain/optimizer.js";

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
  const trainings = state.trainings.filter((t) => t.teamId === team.id);

  const toggle = (key, id) => update((s) => ({
    ...s,
    teams: s.teams.map((t) => t.id !== team.id ? t : {
      ...t, [key]: t[key].includes(id) ? t[key].filter((x) => x !== id) : [...t[key], id],
    }),
  }));

  const setReturnCount = (sid, val) => update((s) => ({
    ...s,
    teams: s.teams.map((t) => t.id !== team.id ? t : {
      ...t, returnStationCounts: { ...(t.returnStationCounts || {}), [sid]: val === "" ? "" : Math.max(0, Number(val) || 0) },
    }),
  }));

  const setCount = (sid, val) => update((s) => ({
    ...s,
    teams: s.teams.map((t) => t.id !== team.id ? t : {
      ...t, stationCounts: { ...(t.stationCounts || {}), [sid]: val === "" ? "" : Math.max(0, Number(val) || 0) },
    }),
  }));

  const setTeamField = (patch) => update((s) => ({
    ...s, teams: s.teams.map((x) => (x.id === team.id ? { ...x, ...patch } : x)),
  }));

  /* A visszaút saját listája: null = tükrözze az odautat (a korábbi viselkedés).
     Bekapcsoláskor az odaút megállóival indulunk, hogy legyen mit szerkeszteni,
     kikapcsoláskor null-ra állunk vissza. */
  const setReturnOwn = (own) => setTeamField(own
    ? { returnStationIds: [...team.stationIds], returnStationCounts: { ...(team.stationCounts || {}) } }
    : { returnStationIds: null, returnRouteAnchorId: null });

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

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-2 py-3">
        <button className="iconbtn" onClick={onBack} aria-label="Vissza"><ChevronLeft size={18} /></button>
        <TeamDot color={team.color} size={14} />
        <h2 className="disp text-xl flex-1 truncate">{team.name}</h2>
        <button className="iconbtn" onClick={() => setEditing(true)} aria-label="Szerkesztés"><Pencil size={17} /></button>
      </div>
      <div className="text-sm mb-4 px-1" style={{ color: "var(--ink2)" }}>{team.age} · {team.gender}</div>

      <h3 className="disp text-base mb-2">Állomások (felszállóhelyek)</h3>
      <div className="flex gap-2 flex-wrap mb-1">
        {state.stations.map((s) => (
          <button key={s.id} className={`chip ${team.stationIds.includes(s.id) ? "on" : ""}`} onClick={() => toggle("stationIds", s.id)}>{s.name}</button>
        ))}
        {state.stations.length === 0 && <span className="text-sm" style={{ color: "var(--ink2)" }}>Vegyél fel állomást az Adatok fülön.</span>}
      </div>
      <p className="text-xs mb-2 px-1" style={{ color: "var(--ink2)" }}>A fuvarokhoz csak a bekapcsolt állomások választhatók.</p>
      {team.stationIds.length > 0 && (
        <div className="card p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="disp text-sm">Létszám megállónként</h4>
            <span className="text-sm font-semibold tnum">Σ {teamPax(team)} fő</span>
          </div>
          <div className="flex flex-col gap-2">
            {team.stationIds.map((sid) => {
              const st = byId(state.stations, sid);
              return (
                <div key={sid} className="flex items-center gap-2">
                  <span className="flex-1 text-sm truncate">{st?.name || "?"}</span>
                  <input type="number" min="0" className="inp" style={{ width: 84, minHeight: 38, padding: "6px 8px" }}
                    value={team.stationCounts?.[sid] ?? ""} placeholder="fő" aria-label={`Létszám: ${st?.name || ""}`}
                    onChange={(e) => setCount(sid, e.target.value)} />
                </div>
              );
            })}
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--ink2)" }}>
            Az optimalizáló ennek az összegét használja. Ha minden mező üres, a csapat összlétszáma számít{team.passengerCount ? ` (most ${team.passengerCount} fő)` : ""}.
          </p>
        </div>
      )}

      {team.stationIds.length > 1 && (
        <div className="card p-3 mb-4">
          <h4 className="disp text-sm mb-2">Útvonal (felszállási sorrend)</h4>
          <div className="seg mb-3">
            <button className={(team.routeMode || "auto") === "auto" ? "on" : ""} onClick={() => setTeamField({ routeMode: "auto" })}>Automatikus</button>
            <button className={team.routeMode === "manual" ? "on" : ""} onClick={() => setTeamField({ routeMode: "manual" })}>Kézi sorrend</button>
          </div>
          {(team.routeMode || "auto") === "auto" ? (
            <>
              <Field label="Kezdő megálló" hint="Az odaút első megállójaként rögzítjük; üresen a leggyorsabb sorrend nyer.">
                <select className="inp" value={team.routeAnchorId || ""} onChange={(e) => setTeamField({ routeAnchorId: e.target.value || null })}>
                  <option value="">— szabad (leggyorsabb) —</option>
                  {team.stationIds.map((sid) => <option key={sid} value={sid}>{byId(state.stations, sid)?.name || "?"}</option>)}
                </select>
              </Field>
              {team.venueIds[0] && (() => {
                const venue = byId(state.venues, team.venueIds[0]);
                const order = teamRouteOrder(state, team, team.venueIds[0], "oda");
                const p0 = planOda(state, order, team.venueIds[0], 0, state.settings.dwellMin ?? 2);
                return (
                  <p className="text-xs" style={{ color: "var(--ink2)" }}>
                    Számított sorrend ({venue?.name || "1. helyszín"} felé): <b>{order.map((id) => byId(state.stations, id)?.name || "?").join(" → ")}</b> · össz. {Math.round(-p0.start)} perc az első megállótól.
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--ink2)" }}>
              A megállók bekapcsolási sorrendje a felszállási sorrend
              {team.returnStationIds ? "; a visszaútnak saját sorrendje van (lentebb)." : "; a VISSZA irány ennek fordítottja."}
            </p>
          )}
        </div>
      )}

      <h3 className="disp text-base mb-2">Visszaút (leszállóhelyek)</h3>
      <div className="seg mb-2">
        <button className={!team.returnStationIds ? "on" : ""} onClick={() => setReturnOwn(false)}>Megegyezik az odaúttal</button>
        <button className={team.returnStationIds ? "on" : ""} onClick={() => setReturnOwn(true)}>Külön lista</button>
      </div>

      {!team.returnStationIds ? (
        <p className="text-xs mb-4 px-1" style={{ color: "var(--ink2)" }}>
          A busz hazafelé ugyanazokat a megállókat érinti, fordított sorrendben. Válaszd a <b>Külön lista</b> opciót, ha a gyerekek máshol szállnak le, mint ahol felszálltak.
        </p>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-1">
            {state.stations.map((s2) => (
              <button key={s2.id} className={`chip ${team.returnStationIds.includes(s2.id) ? "on" : ""}`}
                onClick={() => toggle("returnStationIds", s2.id)}>{s2.name}</button>
            ))}
          </div>
          <p className="text-xs mb-2 px-1" style={{ color: "var(--ink2)" }}>
            Ezek teljesen függetlenek az odaút megállóitól — lehet kevesebb, több vagy egészen más.
          </p>

          {team.returnStationIds.length > 0 && (
            <div className="card p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="disp text-sm">Létszám megállónként (vissza)</h4>
                <span className="text-sm font-semibold tnum">Σ {teamPax(team, "vissza")} fő</span>
              </div>
              <div className="flex flex-col gap-2">
                {team.returnStationIds.map((sid) => {
                  const st = byId(state.stations, sid);
                  return (
                    <div key={sid} className="flex items-center gap-2">
                      <span className="flex-1 text-sm truncate">{st?.name || "?"}</span>
                      <input type="number" min="0" className="inp" style={{ width: 84, minHeight: 38, padding: "6px 8px" }}
                        value={team.returnStationCounts?.[sid] ?? ""} placeholder="fő" aria-label={`Létszám hazafelé: ${st?.name || ""}`}
                        onChange={(e) => setReturnCount(sid, e.target.value)} />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--ink2)" }}>
                A visszaút kapacitását és buszokra bontását ez határozza meg — az odaúttól függetlenül.
              </p>
            </div>
          )}

          {team.returnStationIds.length > 1 && (team.routeMode || "auto") === "auto" && (
            <div className="card p-3 mb-4">
              <Field label="Utolsó megálló (vissza)" hint="A hazaút végére rögzítjük; üresen a leggyorsabb sorrend nyer.">
                <select className="inp" value={team.returnRouteAnchorId || ""} onChange={(e) => setTeamField({ returnRouteAnchorId: e.target.value || null })}>
                  <option value="">— szabad (leggyorsabb) —</option>
                  {team.returnStationIds.map((sid) => <option key={sid} value={sid}>{byId(state.stations, sid)?.name || "?"}</option>)}
                </select>
              </Field>
              {team.venueIds[0] && (
                <p className="text-xs" style={{ color: "var(--ink2)" }}>
                  Számított sorrend ({byId(state.venues, team.venueIds[0])?.name || "1. helyszín"} felől):{" "}
                  <b>{teamRouteOrder(state, team, team.venueIds[0], "vissza").map((id) => byId(state.stations, id)?.name || "?").join(" → ")}</b>
                </p>
              )}
            </div>
          )}
        </>
      )}

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
              <div className="flex-1 min-w-0">
                <div className="font-semibold tnum">
                  {t.type === "weekly" ? t.days.map((d) => DAYS_SHORT[d]).join(", ") : fmtDateFull(t.date)} · {t.start}–{t.end}
                </div>
                <div className="text-sm flex items-center gap-1" style={{ color: "var(--ink2)" }}>
                  <MapPin size={13} /> {venue?.name || "nincs helyszín"}
                </div>
              </div>
              <button className="iconbtn" onClick={() => setTrForm(t)} aria-label="Edzés szerkesztése"><Pencil size={16} /></button>
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
