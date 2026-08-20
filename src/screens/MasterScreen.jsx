/* Vector — Törzsadatok — állomások, helyszínek, járművek, sofőrök
   Kiemelve a fuvarterv.jsx-ből; a viselkedés változatlan. */

import { useState } from "react";
import { Plus, Pencil, AlertTriangle, MapPin, X } from "lucide-react";
import { DAYS_SHORT, uid, byId } from "../domain/constants.js";
import { normalizePlate, plateExists, deleteGuard } from "../domain/logic.js";
import { Field, Modal, DangerBtn, PlateChip, EmptyState } from "../ui/base.jsx";
import { MapPickerModal } from "../ui/MapPicker.jsx";

/* ---------- 4.3 TÖRZSADATOK ---------- */
export const MASTER_TABS = [
  { key: "stations", label: "Állomások", sing: "állomás" },
  { key: "venues", label: "Helyszínek", sing: "helyszín" },
  { key: "vehicles", label: "Járművek", sing: "jármű" },
  { key: "drivers", label: "Sofőrök", sing: "sofőr" },
];

export function MasterScreen({ tab, state, update, notice, setNotice }) {
  const [form, setForm] = useState(null); // null | {} | entity
  const items = state[tab];
  const meta = MASTER_TABS.find((t) => t.key === tab);

  const save = (item) => {
    update((s) => item.id
      ? { ...s, [tab]: s[tab].map((x) => x.id === item.id ? item : x) }
      : { ...s, [tab]: [...s[tab], { ...item, id: uid() }] });
    setForm(null);
  };
  const remove = (id) => update((s) => ({ ...s, [tab]: s[tab].filter((x) => x.id !== id) }));

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between py-3">
        <span className="text-sm" style={{ color: "var(--ink2)" }}>{items.length} {meta.label.toLowerCase()}</span>
        <button className="btn btn-pri" onClick={() => setForm({})}><Plus size={17} /> Új {meta.sing}</button>
      </div>

      {notice && <div className="banner banner-warn mb-3"><AlertTriangle size={18} />{notice}</div>}

      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <div key={it.id} className="card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                {tab === "vehicles"
                  ? <>{it.name} <PlateChip plate={it.plate} /></>
                  : <>{it.name}{it.lat != null && it.lon != null && <MapPin size={14} style={{ color: "var(--ok)" }} aria-label="Koordináta megadva" />}</>}
              </div>
              <div className="text-sm" style={{ color: "var(--ink2)" }}>
                {tab === "vehicles" && `${it.seats} férőhely (sofőr nélkül)`}
                {tab === "drivers" && (it.phone ? <a href={`tel:${it.phone.replace(/\s/g, "")}`} className="underline">{it.phone}</a> : "nincs telefonszám")}
                {(tab === "stations" || tab === "venues") && (it.address || "nincs cím")}
                {it.note ? ` · ${it.note}` : ""}
              </div>
            </div>
            <button className="iconbtn" onClick={() => setForm(it)} aria-label="Szerkesztés"><Pencil size={16} /></button>
            <DangerBtn small onConfirm={() => remove(it.id)}
              disabledReason={deleteGuard(state, tab, it.id)}
              onBlocked={(r) => setNotice(`Nem törölhető. ${r}`)} />
          </div>
        ))}
        {items.length === 0 && <EmptyState>Üres lista. Az <b>Új {meta.sing}</b> gombbal vehetsz fel elemet.</EmptyState>}
      </div>

      {form !== null && (
        <MasterForm kind={tab} state={state} entity={form.id ? form : null} onCancel={() => setForm(null)} onSave={save} />
      )}
    </div>
  );
}

export function MasterForm({ kind, state, entity, onSave, onCancel }) {
  const blank = {
    stations: { name: "", address: "", note: "", lat: null, lon: null },
    venues: { name: "", address: "", note: "", lat: null, lon: null },
    vehicles: { name: "", plate: "", seats: 8, note: "" },
    drivers: { name: "", phone: "", note: "", wage: 3000, minShiftMin: 120, availability: [] },
  }[kind];
  const [f, setF] = useState(entity || blank);
  const [plateErr, setPlateErr] = useState("");
  const [mapOpen, setMapOpen] = useState(false);
  const meta = MASTER_TABS.find((t) => t.key === kind);
  const singCap = meta.sing.charAt(0).toUpperCase() + meta.sing.slice(1);

  const trySave = () => {
    if (kind === "vehicles") {
      const p = normalizePlate(f.plate);
      if (!p) { setPlateErr("A rendszám kötelező."); return; }
      if (plateExists(state, p, entity?.id)) { setPlateErr(`Ez a rendszám már létezik: ${p}`); return; }
      onSave({ ...f, plate: p, seats: Math.max(1, Number(f.seats) || 1) });
      return;
    }
    if (kind === "drivers") {
      onSave({
        ...f,
        wage: Math.max(0, Number(f.wage) || 0),
        minShiftMin: Math.max(0, Number(f.minShiftMin) || 0),
        availability: (f.availability || []).filter((w) => (w.days || []).length && w.start && w.end),
      });
      return;
    }
    onSave(f);
  };

  return (
    <Modal title={entity ? `${singCap} szerkesztése` : `Új ${meta.sing}`} onClose={onCancel}>
      <Field label="Név *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      {(kind === "stations" || kind === "venues") && (
        <>
          <Field label="Cím"><input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Koordináta" hint="A térképen koppintással jelölöd ki, a jelölő húzható.">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="tnum" style={{ fontSize: 16 }}>
                {f.lat != null && f.lon != null ? `${Number(f.lat).toFixed(5)}, ${Number(f.lon).toFixed(5)}` : "nincs megadva"}
              </span>
              <button className="btn btn-ghost" onClick={() => setMapOpen(true)}>
                <MapPin size={16} /> Kijelölés térképen
              </button>
              {f.lat != null && f.lon != null && (
                <button className="iconbtn" aria-label="Koordináta törlése" onClick={() => setF({ ...f, lat: null, lon: null })}><X size={16} /></button>
              )}
            </div>
          </Field>
        </>
      )}
      {kind === "vehicles" && (
        <>
          <Field label="Rendszám *" hint="Automatikusan nagybetűs, kötőjeles formára alakítjuk.">
            <input className="inp" value={f.plate}
              onChange={(e) => { setF({ ...f, plate: e.target.value }); setPlateErr(""); }}
              onBlur={() => setF({ ...f, plate: normalizePlate(f.plate) })}
              placeholder="pl. abc123 → ABC-123" />
          </Field>
          {plateErr && <div className="banner banner-danger mb-3"><AlertTriangle size={18} />{plateErr}</div>}
          {f.plate && !plateErr && <div className="mb-3">Előnézet: <PlateChip plate={normalizePlate(f.plate)} /></div>}
          <Field label="Férőhelyek száma (sofőr nélkül) *">
            <input type="number" min="1" className="inp" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} />
          </Field>
        </>
      )}
      {kind === "drivers" && (
        <>
          <Field label="Telefonszám"><input type="tel" className="inp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+36 30 …" /></Field>
          <Field label="Preferált jármű" hint="Ha megadod, az optimalizáló ehhez a sofőrhöz ezt a járművet részesíti előnyben (nem kötelező érvényű).">
            <select className="inp" value={f.preferredVehicleId || ""} onChange={(e) => setF({ ...f, preferredVehicleId: e.target.value || null })}>
              <option value="">— nincs —</option>
              {state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.plate})</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Órabér (Ft/óra)">
              <input type="number" min="0" className="inp" value={f.wage ?? ""} onChange={(e) => setF({ ...f, wage: e.target.value })} />
            </Field>
            <Field label="Min. műszak (perc)">
              <input type="number" min="0" className="inp" value={f.minShiftMin ?? ""} onChange={(e) => setF({ ...f, minShiftMin: e.target.value })} />
            </Field>
          </div>
          <Field label="Elérhetőség" hint="Ha nincs idősáv megadva, a sofőr bármikor beosztható.">
            <div className="flex flex-col gap-2">
              {(f.availability || []).map((w, i) => (
                <div key={i} className="card p-2">
                  <div className="flex gap-1 flex-wrap mb-2">
                    {DAYS_SHORT.map((d, di) => (
                      <button key={di} className={`chip ${(w.days || []).includes(di) ? "on" : ""}`} style={{ padding: "4px 10px", minHeight: 32 }}
                        onClick={() => {
                          const days = (w.days || []).includes(di) ? w.days.filter((x) => x !== di) : [...(w.days || []), di].sort((a, b) => a - b);
                          setF({ ...f, availability: f.availability.map((x, j) => (j === i ? { ...x, days } : x)) });
                        }}>{d}</button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <input type="time" className="inp" style={{ minHeight: 38, padding: "6px 8px" }} value={w.start}
                      onChange={(e) => setF({ ...f, availability: f.availability.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                    <span>–</span>
                    <input type="time" className="inp" style={{ minHeight: 38, padding: "6px 8px" }} value={w.end}
                      onChange={(e) => setF({ ...f, availability: f.availability.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                    <button className="iconbtn" style={{ width: 34, height: 34 }} aria-label="Idősáv törlése"
                      onClick={() => setF({ ...f, availability: f.availability.filter((_, j) => j !== i) })}><X size={15} /></button>
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost" onClick={() => setF({ ...f, availability: [...(f.availability || []), { days: [], start: "15:00", end: "21:00" }] })}>
                <Plus size={15} /> Idősáv hozzáadása
              </button>
            </div>
          </Field>
        </>
      )}
      <Field label="Megjegyzés"><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-pri flex-1" disabled={!f.name.trim()} onClick={trySave}>Mentés</button>
        <button className="btn btn-ghost" onClick={onCancel}>Mégse</button>
      </div>
      {mapOpen && (
        <MapPickerModal
          state={state}
          item={f}
          title={`${f.name.trim() || singCap} — hely kijelölése`}
          onSave={(lat, lon) => { setF({ ...f, lat, lon }); setMapOpen(false); }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </Modal>
  );
}
