/* Vector — alap építőkockák (Field, Modal, DangerBtn, …)
   Kiemelve a vector.jsx-ből; a viselkedés változatlan. */

import { useState, useEffect, useRef, useId } from "react";
import { AlertTriangle, Boxes, CalendarDays, Car, HelpCircle, Trash2, Workflow, X } from "lucide-react";

export function Field({ label, children, hint }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-semibold mb-1" style={{ color: "var(--ink2)" }}>{label}</span>
      {children}
      {hint && <span className="block text-xs mt-1" style={{ color: "var(--ink2)" }}>{hint}</span>}
    </label>
  );
}

/* Számmező, ami gépelés közben nem ugrál. A nyers `Number(e.target.value) || 0`
   mintával a mező kiürítése azonnal 0-t (vagy 1-et) írt vissza, így az "50"
   begépeléséből "150" lett. Itt a gépelt szöveg helyben marad, és csak elhagyáskor
   (blur / Enter) rögzül számként — érvénytelen bevitelnél az előző érték áll vissza. */
export function NumField({ label, hint, value, min = 0, onCommit }) {
  const [raw, setRaw] = useState(null);          // null = a mentett érték látszik
  const commit = () => {
    const n = Number(raw);
    if (raw !== null && raw.trim() !== "" && Number.isFinite(n)) onCommit(Math.max(min, n));
    setRaw(null);
  };
  return (
    <Field label={label} hint={hint}>
      <input type="number" className="inp" min={min}
        value={raw ?? value}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} />
    </Field>
  );
}

export function Modal({ title, onClose, children }) {
  const titleId = useId();
  /* A háttérre kattintás csak akkor zár, ha az egérgomb LENYOMÁSA is a háttéren
     történt. Enélkül elég az inputban elkezdett szövegkijelölést pár pixellel a
     modálon kívül elengedni: a click a közös ősre, a háttérre esik, és a fél
     kitöltött űrlap (vagy a térképen épp kiválasztott koordináta) elveszik. */
  const downOnBg = useRef(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-bg"
      onMouseDown={(e) => { downOnBg.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBg.current && e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxHeight: "88vh" }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="disp text-xl" id={titleId}>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Bezárás"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* Kétlépcsős törlés: első koppintásra élesedik, 3 mp múlva visszaáll */
export function DangerBtn({ label = "Törlés", confirmLabel = "Biztos törlöd?", onConfirm, small, disabledReason, onBlocked }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const click = () => {
    if (disabledReason) { onBlocked && onBlocked(disabledReason); return; }
    if (armed) { setArmed(false); onConfirm(); } else setArmed(true);
  };
  if (small) return (
    <button className="iconbtn" onClick={click} aria-label={label}
      style={armed ? { background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" } : disabledReason ? { opacity: 0.4 } : {}}>
      <Trash2 size={17} />
    </button>
  );
  return (
    <button className={`btn btn-danger ${armed ? "armed" : ""}`} onClick={click}>
      <Trash2 size={17} /> {armed ? confirmLabel : label}
    </button>
  );
}

export function PlateChip({ plate }) {
  return <span className="plate"><i>H</i><b>{plate}</b></span>;
}

export function TeamDot({ color, size = 12 }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}

export function EmptyState({ children }) {
  return <div className="card p-5 text-center text-sm" style={{ color: "var(--ink2)", borderStyle: "dashed" }}>{children}</div>;
}

/* Kis „?” buborék — koppintásra rövid magyarázatot mutat. `align`: l | c | r */
export function InfoDot({ text, align = "c", label = "Mi ez?" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="infodot-wrap">
      <button type="button" className="infodot" aria-label={label} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>
        <HelpCircle size={16} />
      </button>
      {open && (
        <>
          <button className="infodot-scrim" aria-hidden="true" tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <span className={`infodot-pop ${align}`} role="tooltip">{text}</span>
        </>
      )}
    </span>
  );
}

/* Súgó lap: hogyan működik az app + ajánlott munkamenet */
export function HelpSheet({ onClose }) {
  const rows = [
    [CalendarDays, "Hét", "A hét összes edzése és fuvarja egy helyen. Koppints egy fuvarra a szerkesztéshez."],
    [Workflow, "Beosztás", "A napi beosztás. Az Optimalizálás a legolcsóbb sofőr+jármű láncokat számolja ki; a láncok kézzel is átrendezhetők."],
    [Boxes, "Adatok", "Itt tartod karban a csapatokat, állomásokat, helyszíneket, járműveket és sofőröket."],
    [Car, "Sofőr", "Napi, nyomtatható nézet egy-egy sofőr fuvarjairól."],
  ];
  return (
    <Modal title="Hogyan működik?" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <p className="text-sm" style={{ color: "var(--ink2)", margin: 0 }}>
          A Vector megtervezi, ki melyik járművel és mikor viszi a csapatokat az
          edzésekre és haza. Így érdemes haladni:
        </p>
        <ol className="help-steps">
          <li><span>Vedd fel az <b>alapadatokat</b> (Adatok): állomások, helyszínek, járművek, sofőrök.</span></li>
          <li><span>Hozd létre a <b>csapatokat és edzéseket</b> (Adatok › Csapatok).</span></li>
          <li><span>A <b>Beosztás</b> fülön futtasd az <b>Optimalizálást</b>.</span></li>
          <li><span>Oszd meg a sofőrökkel a <b>Sofőr</b> nézetet.</span></li>
        </ol>
        <div className="flex flex-col gap-3">
          {rows.map(([Icon, t, d]) => (
            <div key={t} className="flex gap-3 items-start">
              <span className="help-ic"><Icon size={19} /></span>
              <div><div className="font-semibold">{t}</div><div className="text-sm" style={{ color: "var(--ink2)" }}>{d}</div></div>
            </div>
          ))}
        </div>
        <div className="banner banner-warn">
          <AlertTriangle size={18} />
          <span>Jó tudni: minden mentés előtti állapotot megőrzünk. A fejléc „Korábbi mentések” gombjával bármikor visszaállhatsz.</span>
        </div>
      </div>
    </Modal>
  );
}
