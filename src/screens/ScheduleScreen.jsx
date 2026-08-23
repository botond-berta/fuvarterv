/* Fuvarterv — Beosztás — láncok, optimalizálás, fuvargenerálás
   Kiemelve a fuvarterv.jsx-ből; a viselkedés változatlan. */

import { useState, useMemo } from "react";
import { Plus, AlertTriangle, X, ChevronsRight, Lock, Unlock, Zap, ArrowLeftRight, Settings2, Table, ClipboardCheck } from "lucide-react";
import { DAYS, uid, byId } from "../domain/constants.js";
import { mondayOf, weekdayIdx, minToTime, fmtDateFull } from "../domain/datetime.js";
import { locName, matrixKey, computeMatrix } from "../domain/geo.js";
import { resolveDay, dayStats, optimizeDay, withGeneratedRides, driverAvailableFor } from "../domain/optimizer.js";
import { fmtFt, fmtH } from "../ui/format.js";
import { Field, NumField, Modal, PlateChip, TeamDot, EmptyState, InfoDot } from "../ui/base.jsx";

/* ---------- 4.45 BEOSZTÁS — ütemezés-optimalizáló ---------- */

export function taskHardIssues(state, weekday, t) {
  const out = [];
  const maxSeats = Math.max(0, ...state.vehicles.map((v) => Number(v.seats) || 0));
  if (t.pax > maxSeats) out.push(`Nincs jármű elegendő férőhellyel (${t.pax} fő > ${maxSeats}).`);
  if (!state.drivers.some((d) => driverAvailableFor(d, weekday, t.start, t.end)))
    out.push(`Egyik sofőr sem érhető el ${minToTime(t.start)}–${minToTime(t.end)} között.`);
  return out;
}

export function TaskRow({ state, task: t, locked, inChain, onLock, onMove, reasons }) {
  const team = byId(state.teams, t.teamId);
  const body = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`dirpill ${t.dir === "vissza" ? "v" : ""}`}>{t.dir === "oda" ? "ODA" : "VISSZA"}</span>
      <TeamDot color={team?.color || "#999"} size={10} />
      <span className="font-semibold text-sm">{team?.name || "?"}</span>
      <span className="tnum text-base">{minToTime(t.start)}–{minToTime(t.end)}</span>
      <span className="text-xs" style={{ color: "var(--ink2)" }}>
        {locName(state, t.from)} → {locName(state, t.to)} · {t.pax} fő
      </span>
      <span className="flex gap-1 ml-auto">
        {inChain && (
          <button className="iconbtn" style={{ width: 32, height: 32, ...(locked ? { background: "var(--surface-inv)", color: "var(--on-inv)", borderColor: "var(--surface-inv)" } : {}) }}
            onClick={onLock} aria-label={locked ? "Zárolás feloldása" : "Zárolás"}>
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        )}
        <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={onMove} aria-label="Áthelyezés"><ArrowLeftRight size={14} /></button>
      </span>
      {t.plan && t.plan.length > 0 ? (
        <div className="text-xs tnum" style={{ color: "var(--ink2)", width: "100%", fontWeight: 500 }}>
          {t.dir === "oda"
            ? <>{t.plan.map((s) => `${minToTime(s.arr)} ${locName(state, s.stationId)}${s.count ? ` (${s.count})` : ""}`).join(" · ")} → {minToTime(t.venueTime)} {locName(state, t.to)}</>
            : <>{minToTime(t.venueTime)} {locName(state, t.from)} → {t.plan.map((s) => `${minToTime(s.arr)} ${locName(state, s.stationId)}${s.count ? ` (${s.count})` : ""}`).join(" · ")}</>}
        </div>
      ) : t.breakdown && t.breakdown.length > 0 && (
        <div className="text-xs" style={{ color: "var(--ink2)", width: "100%" }}>
          {t.dir === "oda" ? "Felszállás" : "Leszállás"}: {t.breakdown.map((b) => `${locName(state, b.stationId)} ${b.count}`).join(" · ")}
        </div>
      )}
    </div>
  );
  if (!inChain) return (
    <div>
      {body}
      {(reasons || []).map((r, i) => <div key={i} className="text-xs mt-1" style={{ color: "var(--danger)" }}>{r}</div>)}
    </div>
  );
  return (
    <div className="rail-row" style={{ paddingTop: 4, paddingBottom: 4 }}>
      <span className="rail-dot sm" aria-hidden />
      {body}
    </div>
  );
}

export function ChainCard({ state, chain: c, onLock, onMove }) {
  const paid = Math.max(c.end - c.start, c.driver?.minShiftMin || 0);
  const cost = (state.settings.calloutFee || 0) + (paid / 60) * (c.driver?.wage || 0);
  return (
    <div className="card mb-3 overflow-hidden">
      <div className="p-3 flex items-center gap-2 flex-wrap" style={{ background: "var(--surface-inv)", color: "var(--on-inv)" }}>
        <span className="disp text-base">{c.driver?.name || "— nincs sofőr —"}</span>
        {c.vehicle && <PlateChip plate={c.vehicle.plate} />}
        {c.vehicle && <span className="text-xs" style={{ color: "var(--on-inv)", opacity: .7 }}>{c.vehicle.seats} fh</span>}
        <span className="tnum ml-auto text-base">{minToTime(c.start)}–{minToTime(c.end)}</span>
      </div>
      <div className="px-3 py-1 text-xs flex gap-3 flex-wrap" style={{ color: "var(--ink2)", borderBottom: "1px solid var(--line)" }}>
        <span>fizetett: <b>{fmtH(paid)}</b>{paid > c.end - c.start ? " (min. műszak)" : ""}</span>
        <span>ktg.: <b>{fmtFt(cost)}</b></span>
        <span>max. létszám: <b>{c.maxPax} fő</b></span>
      </div>
      {c.issues.length > 0 && (
        <div className="px-3 pt-2 flex flex-col gap-1">
          {c.issues.map((m, i) => (
            <div key={i} className="banner banner-danger" style={{ padding: "6px 10px" }}><AlertTriangle size={15} />{m}</div>
          ))}
        </div>
      )}
      <div className="rail p-3 flex flex-col gap-1">
        {c.tasks.map((t, i) => (
          <div key={t.id}>
            <TaskRow state={state} task={t} locked={t.locked} inChain
              onLock={() => onLock(t.id)} onMove={() => onMove(t)} />
            {i < c.links.length && (
              <div className="linkline">
                <ChevronsRight size={13} />
                {c.links[i].infeasible
                  ? <b style={{ color: "var(--danger)" }}>{c.links[i].short} perc hiányzik az átálláshoz ({locName(state, c.links[i].a.to)} → {locName(state, c.links[i].b.from)})</b>
                  : <>{c.links[i].dead} p üresjárat: {locName(state, c.links[i].a.to)} → {locName(state, c.links[i].b.from)}{c.links[i].idle > 0 && <> · {c.links[i].idle} p várakozás</>}</>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MoveModal({ state, task, chains, currentChainId, onClose, onToChain, onToNew, onToUnassigned }) {
  const [nd, setNd] = useState(state.drivers[0]?.id || "");
  const [nv, setNv] = useState(state.vehicles[0]?.id || "");
  const targets = chains.filter((c) => c.id !== currentChainId);
  return (
    <Modal title={`Áthelyezés — ${task.label}`} onClose={onClose}>
      {targets.length > 0 && <h4 className="disp text-sm mb-2">Meglévő láncba</h4>}
      <div className="flex flex-col gap-2 mb-3">
        {targets.map((c) => (
          <button key={c.id} className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={() => onToChain(c.id)}>
            <ChevronsRight size={15} /> {c.driver?.name || "?"} · {c.vehicle?.plate || "?"} ({minToTime(c.start)}–{minToTime(c.end)})
          </button>
        ))}
        {currentChainId && (
          <button className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={onToUnassigned}>
            <X size={15} /> Fedetlenek közé (kivétel a láncból)
          </button>
        )}
      </div>
      <h4 className="disp text-sm mb-2">Új lánc indítása</h4>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sofőr">
          <select className="inp" value={nd} onChange={(e) => setNd(e.target.value)}>
            {state.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Jármű">
          <select className="inp" value={nv} onChange={(e) => setNv(e.target.value)}>
            {state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.plate})</option>)}
          </select>
        </Field>
      </div>
      <button className="btn btn-pri w-full" disabled={!nd || !nv} onClick={() => onToNew(nd, nv)}>
        <Plus size={15} /> Új lánc ezzel a feladattal
      </button>
      <p className="text-xs mt-2" style={{ color: "var(--ink2)" }}>
        A kézi áthelyezés automatikusan zárolja a feladatot, így az újraoptimalizálás nem írja felül.
        Ha ütközést okoz, pirossal jelezzük, de engedjük.
      </p>
    </Modal>
  );
}

export /* Modulszinten, nem a renderben: a komponensen belül definiált komponensnek
   minden renderben új típusa lenne, ezért a React a teljes részfát újra
   mountolná (itt ártalmatlan, de pontosan ez a minta okoz máshol beviteli
   fókuszvesztést). */
function CmpRow({ label, va, vb }) {
  return (<tr><td>{label}</td><td className="b">{va}</td><td className="b">{vb}</td></tr>);
}

function ProposalModal({ state, before, out, onApply, onClose }) {
  if (out.empty) return (
    <Modal title="Optimalizálás" onClose={onClose}>
      <EmptyState>Erre a napra nincs fuvarfeladat.</EmptyState>
      {out.notes.map((n, i) => <div key={i} className="banner banner-warn mt-2"><AlertTriangle size={15} />{n}</div>)}
    </Modal>
  );
  const a = before.stats, b = out.stats;
  return (
    <Modal title="Optimalizálás — előtte / utána" onClose={onClose}>
      <table className="cmp mb-3">
        <thead><tr><th></th><th>Jelenlegi</th><th>Javasolt</th></tr></thead>
        <tbody>
          <CmpRow label="Sofőrök" va={a.drivers} vb={b.drivers} />
          <CmpRow label="Láncok" va={a.chains} vb={b.chains} />
          <CmpRow label="Fizetett idő" va={fmtH(a.paidMin)} vb={fmtH(b.paidMin)} />
          <CmpRow label="Üresjárat" va={`${a.dead} p`} vb={`${b.dead} p`} />
          <CmpRow label="Várakozás" va={`${a.idle} p`} vb={`${b.idle} p`} />
          <CmpRow label="Becsült költség" va={fmtFt(a.cost)} vb={fmtFt(b.cost)} />
          <CmpRow label="Fedetlen feladat" va={before.uncovered} vb={out.uncovered.length} />
        </tbody>
      </table>
      <h4 className="disp text-sm mb-2">Javasolt láncok</h4>
      <div className="flex flex-col gap-2 mb-3">
        {out.chains.map((c, i) => {
          const d = byId(state.drivers, c.driverId), v = byId(state.vehicles, c.vehicleId);
          return (
            <div key={i} className="card p-2 text-sm">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                {d?.name || "?"} {v && <PlateChip plate={v.plate} />}
                <span className="tnum ml-auto">{minToTime(c.start)}–{minToTime(c.end)}</span>
              </div>
              {c.tasks.map((t, j) => (
                <div key={t.id}>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`dirpill ${t.dir === "vissza" ? "v" : ""}`}>{t.dir === "oda" ? "ODA" : "VISSZA"}</span>
                    <span>{byId(state.teams, t.teamId)?.name || "?"}</span>
                    <span className="tnum">{minToTime(t.start)}–{minToTime(t.end)}</span>
                    {t.locked && <Lock size={12} />}
                  </div>
                  {j < c.links.length && (
                    <div className="linkline" style={{ paddingLeft: 4 }}>
                      ↳ {c.links[j].dead} p üresjárat: {locName(state, c.links[j].a.to)} → {locName(state, c.links[j].b.from)}{c.links[j].idle > 0 ? ` · ${c.links[j].idle} p várakozás` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {out.uncovered.length > 0 && (
        <div className="banner banner-danger mb-2" style={{ display: "block" }}>
          <b>Nem fedhető le:</b>
          {out.uncovered.map((u, i) => (
            <div key={i} className="mt-1">• {u.task.label} ({minToTime(u.task.start)}–{minToTime(u.task.end)}): {u.reasons.join(" ")}</div>
          ))}
        </div>
      )}
      {out.notes.map((n, i) => <div key={i} className="banner banner-warn mb-2"><AlertTriangle size={15} />{n}</div>)}
      <div className="flex gap-2 mt-3">
        <button className="btn btn-pri flex-1" onClick={onApply}>Alkalmazás</button>
        <button className="btn btn-ghost" onClick={onClose}>Mégse</button>
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--ink2)" }}>A zárolt feladatok hozzárendelését az optimalizálás megőrizte. Az alkalmazás a menetrendet fuvarokként is rögzíti (a nap addigi fuvarjait lecseréli).</p>
    </Modal>
  );
}

export function ScheduleScreen({ state, update }) {
  const weekMon = mondayOf(new Date());
  const [weekday, setWeekday] = useState(weekdayIdx(new Date()));
  const [proposal, setProposal] = useState(null);
  const [moveTask, setMoveTask] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busyMx, setBusyMx] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmGen, setConfirmGen] = useState(false);
  const [busyOpt, setBusyOpt] = useState(false);

  const res = useMemo(() => resolveDay(state, weekday, weekMon), [state, weekday]);
  const curStats = useMemo(() => dayStats(state, res.chains), [state, res]);
  const mxStale = state.matrix && state.matrix.key !== matrixKey(state);

  const doMatrix = async () => {
    setBusyMx(true); setMsg("");
    try {
      const m = await computeMatrix(state);
      update((s) => ({ ...s, matrix: m }));
      setMsg(m.source === "osrm"
        ? `Mátrix kész: ${m.n} pont, OSRM útvonaltervezővel.`
        : `Mátrix kész: ${m.n} pont — az útvonaltervező nem volt elérhető, légvonalas becslés (~${state.settings.estSpeedKmh} km/h).`);
    } catch (e) { setMsg(e.message || "A mátrix számítása nem sikerült."); }
    setBusyMx(false);
  };

  /* Az optimalizálás szinkron és a nap méretétől függően pár tized–másfél
     másodperc; a böngésző addig nem rajzol. Egy képkockányi késleltetéssel
     előbb kirajzoljuk a "Számítás…" állapotot, hogy a gomb ne tűnjön halottnak. */
  const doOptimize = () => {
    setBusyOpt(true);
    requestAnimationFrame(() => setTimeout(() => {
      const out = optimizeDay(state, weekday, weekMon);
      setProposal({ out, before: { stats: curStats, uncovered: res.unassigned.length } });
      setBusyOpt(false);
    }, 0));
  };

  const applyProposal = () => {
    const out = proposal.out;
    update((s) => ({
      ...s,
      assignments: {
        ...s.assignments,
        [weekday]: {
          chains: (out.chains || []).map((c) => ({
            id: c.id || uid(), driverId: c.driverId, vehicleId: c.vehicleId,
            taskIds: c.tasks.map((t) => ({ id: t.id, locked: !!t.locked })),
          })),
        },
      },
      rides: withGeneratedRides(s, weekday, weekMon, out.chains),
    }));
    setProposal(null);
    setMsg("A beosztás alkalmazva és a menetrend rögzítve — a fuvarok a Hét és a Sofőr nézetben is megjelennek.");
  };

  /* Fuvarok (újra)generálása a jelenlegi napi beosztásból, kézi módosítások után. */
  const rideCount = res.chains.reduce((a, c) => a + c.tasks.length, 0);
  const doGenerate = () => {
    update((s) => ({ ...s, rides: withGeneratedRides(s, weekday, weekMon, res.chains) }));
    setConfirmGen(false);
    setMsg(`${rideCount} fuvar rögzítve a beosztásból — a Hét és a Sofőr nézetben megjelennek.`);
  };

  const toggleLock = (taskId) => update((s) => ({
    ...s,
    assignments: {
      ...s.assignments,
      [weekday]: {
        chains: (s.assignments[weekday]?.chains || []).map((ch) => ({
          ...ch, taskIds: ch.taskIds.map((x) => (x.id === taskId ? { ...x, locked: !x.locked } : x)),
        })),
      },
    },
  }));

  const stripTask = (chains, taskId) =>
    chains.map((ch) => ({ ...ch, taskIds: ch.taskIds.filter((x) => x.id !== taskId) })).filter((ch) => ch.taskIds.length);
  const moveToChain = (taskId, chainId) => update((s) => {
    let chains = stripTask(s.assignments[weekday]?.chains || [], taskId);
    chains = chains.map((ch) => (ch.id === chainId ? { ...ch, taskIds: [...ch.taskIds, { id: taskId, locked: true }] } : ch));
    return { ...s, assignments: { ...s.assignments, [weekday]: { chains } } };
  });
  const moveToNew = (taskId, driverId, vehicleId) => update((s) => {
    const chains = stripTask(s.assignments[weekday]?.chains || [], taskId);
    chains.push({ id: uid(), driverId, vehicleId, taskIds: [{ id: taskId, locked: true }] });
    return { ...s, assignments: { ...s.assignments, [weekday]: { chains } } };
  });
  const moveToUnassigned = (taskId) => update((s) => ({
    ...s, assignments: { ...s.assignments, [weekday]: { chains: stripTask(s.assignments[weekday]?.chains || [], taskId) } },
  }));
  const setSetting = (k, v) => update((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));

  const moveChainId = moveTask ? (res.chains.find((c) => c.tasks.some((t) => t.id === moveTask.id))?.id || null) : null;

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between py-3">
        <span className="flex items-center gap-1">
          <h2 className="disp text-xl">Beosztás</h2>
          <InfoDot align="l" text="A napi beosztás. Az „Optimalizálás” a legolcsóbb sofőr+jármű láncokat számolja ki; a „Mátrix” pontosabb üresjárati időket ad. A láncokat kézzel is átrendezheted." />
        </span>
        <button className="iconbtn" onClick={() => setShowSettings(!showSettings)} aria-label="Paraméterek"><Settings2 size={17} /></button>
      </div>

      {showSettings && (
        <div className="card p-3 mb-3">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Érkezés edzés előtt (perc)" value={state.settings.arriveEarlyMin} min={0} onCommit={(v) => setSetting("arriveEarlyMin", v)} />
            <NumField label="Indulás edzés után (perc)" value={state.settings.departAfterMin} min={0} onCommit={(v) => setSetting("departAfterMin", v)} />
            <NumField label="Kiszállási díj (Ft)" value={state.settings.calloutFee} min={0} onCommit={(v) => setSetting("calloutFee", v)} />
            <NumField label="Megállónkénti idő (perc)" value={state.settings.dwellMin} min={0} onCommit={(v) => setSetting("dwellMin", v)} />
            <NumField label="Becsült sebesség (km/h)" value={state.settings.estSpeedKmh} min={1} onCommit={(v) => setSetting("estSpeedKmh", v)} />
            <NumField label="Alap üresjárat adat híján (perc)" value={state.settings.fallbackLegMin} min={0} onCommit={(v) => setSetting("fallbackLegMin", v)} />
            <NumField label="Preferált jármű súlya (Ft)" hint="Mennyire ragaszkodjon a sofőr saját buszához. 0 = kikapcsolva."
              value={state.settings.preferredBias} min={0} onCommit={(v) => setSetting("preferredBias", v)} />
          </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        {DAYS.map((d, i) => (
          <button key={i} className={`chip ${i === weekday ? "on" : ""}`} onClick={() => setWeekday(i)} style={{ whiteSpace: "nowrap" }}>{d}</button>
        ))}
      </div>

      <div className="statgrid mb-3">
        <div className="stat"><b>{curStats.drivers}</b><span>sofőr</span></div>
        <div className="stat"><b>{fmtH(curStats.paidMin)}</b><span>fizetett idő</span></div>
        <div className="stat"><b>{curStats.dead} p</b><span>üresjárat</span></div>
        <div className="stat"><b>{fmtFt(curStats.cost)}</b><span>becsült ktg.</span></div>
      </div>

      <div className="flex gap-2 mb-2 flex-wrap">
        <button className="btn btn-pri flex-1" onClick={doOptimize} disabled={busyOpt}>
          <Zap size={16} /> {busyOpt ? "Számítás…" : "Beosztás optimalizálása"}
        </button>
        <button className="btn btn-ghost" onClick={doMatrix} disabled={busyMx}><Table size={16} /> {busyMx ? "Számítás…" : "Mátrix"}</button>
      </div>
      <div className="flex gap-2 mb-2 items-center">
        <button className="btn btn-ghost flex-1" onClick={() => setConfirmGen(true)} disabled={rideCount === 0}
          title={rideCount === 0 ? "Előbb rendelj feladatokat láncokba (optimalizálás vagy kézi áthelyezés)." : ""}>
          <ClipboardCheck size={16} /> Fuvarok generálása a beosztásból
        </button>
        <InfoDot align="r" text="A kész beosztásból tényleges fuvarokat készít, amiket a sofőrök is látnak. Akkor futtasd, ha kész a napi lánc." />
      </div>
      <p className="text-xs mb-3 px-1" style={{ color: "var(--ink2)" }}>
        {state.matrix
          ? <>Üresjárati mátrix: {state.matrix.n} pont, {state.matrix.source === "osrm" ? "OSRM útvonaltervező" : "légvonalas becslés"} ({fmtDateFull(state.matrix.computedAt.slice(0, 10))}).{mxStale && <b style={{ color: "var(--danger)" }}> A pontok azóta változtak — újraszámítás ajánlott!</b>}</>
          : "Még nincs üresjárati mátrix — addig légvonalas becslés / alapérték megy. A Mátrix gomb egyszer számol, az eredmény eltárolódik."}
      </p>
      {msg && <div className="banner banner-warn mb-3"><Table size={16} />{msg}</div>}
      {res.skipped.map((sk, i) => <div key={i} className="banner banner-warn mb-2"><AlertTriangle size={16} />{sk}</div>)}

      {res.chains.map((c) => (
        <ChainCard key={c.id} state={state} chain={c} onLock={toggleLock} onMove={setMoveTask} />
      ))}
      {res.chains.length === 0 && res.tasks.length > 0 && (
        <EmptyState>Ezen a napon még nincs beosztás. Futtasd az optimalizálást, vagy helyezz át feladatot kézzel.</EmptyState>
      )}
      {res.tasks.length === 0 && <EmptyState>{DAYS[weekday]}i napra nincs edzés, így fuvarfeladat sincs.</EmptyState>}

      {res.unassigned.length > 0 && (
        <section className="mt-4">
          <h3 className="disp text-base mb-2">Fedetlen feladatok</h3>
          <div className="card p-3 flex flex-col gap-3" style={{ borderColor: "var(--acc)", borderWidth: 2 }}>
            {res.unassigned.map((t) => (
              <TaskRow key={t.id} state={state} task={t} onMove={() => setMoveTask(t)} reasons={taskHardIssues(state, weekday, t)} />
            ))}
          </div>
        </section>
      )}

      {moveTask && (
        <MoveModal state={state} task={moveTask} chains={res.chains} currentChainId={moveChainId}
          onClose={() => setMoveTask(null)}
          onToChain={(cid) => { moveToChain(moveTask.id, cid); setMoveTask(null); }}
          onToNew={(d, v) => { moveToNew(moveTask.id, d, v); setMoveTask(null); }}
          onToUnassigned={() => { moveToUnassigned(moveTask.id); setMoveTask(null); }} />
      )}
      {proposal && (
        <ProposalModal state={state} before={proposal.before} out={proposal.out}
          onApply={applyProposal} onClose={() => setProposal(null)} />
      )}
      {confirmGen && (
        <Modal title="Fuvarok generálása" onClose={() => setConfirmGen(false)}>
          <p className="text-sm mb-2">
            A(z) <b>{DAYS[weekday]}</b> napra a beosztás <b>{res.chains.length}</b> láncából{" "}
            <b>{rideCount}</b> fuvar készül (ODA és VISSZA irány külön).
          </p>
          <div className="banner banner-warn mb-2" style={{ display: "block" }}>
            <div className="flex items-center gap-2 mb-1"><AlertTriangle size={15} /><b>Figyelem</b></div>
            Ezen a napon az érintett edzések <b>összes eddigi fuvarja lecserélődik</b> (a kézzel felvett fuvarok is), a beosztás lesz az egyetlen forrás.
          </div>
          {res.unassigned.length > 0 && (
            <p className="text-sm mb-2" style={{ color: "var(--danger)" }}>
              {res.unassigned.length} feladat még fedetlen — ezekhez nem készül fuvar.
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button className="btn btn-pri flex-1" onClick={doGenerate}><ClipboardCheck size={16} /> Fuvarok rögzítése</button>
            <button className="btn btn-ghost" onClick={() => setConfirmGen(false)}>Mégse</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
