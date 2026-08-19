/* =====================================================================
   VECTOR — kézilabda klub fuvarszervező
   ---------------------------------------------------------------------
   A tiszta (React-mentes) rétegek külön modulokban élnek:
     src/data/storage.js    — perzisztencia-varrat (window.storage) + alapértékek
     src/data/seed.js       — mintaadatok + ensureShape (alaknormalizálás)
     src/domain/constants.js— konstansok, uid, byId
     src/domain/datetime.js — dátum és idő
     src/domain/geo.js      — koordináták, távolság, üresjárati mátrix
     src/domain/logic.js    — rendszám, előfordulások, ütközések, törlésvédelem
     src/domain/optimizer.js— feladatok, útvonal, láncolás, hozzárendelés
   Ebben a fájlban a felület maradt: UI építőkockák, térképválasztó,
   képernyők és az App. A fájl végi export-blokk a domain neveket is
   újra közzéteszi, hogy a tesztek importjai ne törjenek el.
   ===================================================================== */

import { useState, useEffect, useMemo, useRef } from "react";
import {
  CalendarDays, Boxes, Car, Plus, Minus, Pencil, Trash2,
  ChevronLeft, ChevronRight, GripVertical, ArrowUp, ArrowDown,
  AlertTriangle, MapPin, Clock, X, Flag, ChevronsRight, Search,
  Lock, Unlock, Zap, Workflow, ArrowLeftRight, Settings2, Table,
  ClipboardCheck, HelpCircle, RotateCcw, LogOut,
} from "lucide-react";

/* =====================================================================
   1-2. ADAT + DOMAIN — külön modulokban (lásd src/data, src/domain).
   Ez a fájl innentől a felület: UI építőkockák, képernyők, App.
   A modulokból ide behozott neveket a fájl végi export-blokk újra közzéteszi,
   hogy a src/main.jsx és a test/ importjai változatlanok maradjanak.
   ===================================================================== */

import { STORAGE_KEY, DEFAULT_SETTINGS, isNotFound, loadState, persistState } from "./src/data/storage.js";
import { ensureShape, seedState } from "./src/data/seed.js";
import { DAYS, DAYS_SHORT, MONTHS, GENDERS, TEAM_COLORS, uid, byId } from "./src/domain/constants.js";
import {
  toISO, parseISO, weekdayIdx, mondayOf, addDays, timeToMin, minToTime,
  fmtDate, fmtDateFull, fmtWeekRange,
} from "./src/domain/datetime.js";
import {
  CLUB_CENTER, r5, defaultMapCenter, locOf, locName, haversineKm, legMin, matrixKey, computeMatrix,
} from "./src/domain/geo.js";
import {
  normalizePlate, plateExists, weekOccurrences, findRides, venueDepartMin,
  rideWindow, occursOnSameDay, findConflicts, seatSum, deleteGuard,
} from "./src/domain/logic.js";
import {
  bestStationOrder, planOda, planVissza, teamRouteOrder, splitStationsByCapacity,
  genDayTasks, teamPax, driverAvailableFor, mkChain, chainFrom, chainTo,
  resolveDay, dayStats, withGeneratedRides, optimizeDay,
} from "./src/domain/optimizer.js";
import { fmtFt, fmtH } from "./src/ui/format.js";

/* =====================================================================
   3. UI ÉPÍTŐKOCKÁK
   ===================================================================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
:root{
  --ink:#14161C; --ink2:#6A7180; --paper:#F6F7F9; --card:#FFFFFF;
  --line:#EAECEF; --acc:#00C2E8; --acc-soft:#E1F7FC; --on-acc:#00303D;
  --danger:#F04438; --danger-soft:#FDE7E4; --ok:#12B76A;
  --warn:#F79009; --warn-soft:#FEF0D8; --paper2:#EEF0F3;
}
.ft-root{font-family:'Nunito',system-ui,sans-serif;background:var(--paper);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased;}
.disp{font-family:'Nunito',system-ui,sans-serif;font-weight:800;letter-spacing:-.01em;}
.tnum{font-family:'Nunito',system-ui,sans-serif;font-weight:700;font-variant-numeric:tabular-nums;}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgba(16,24,40,.04);}
.inp{width:100%;background:var(--card);border:2px solid var(--line);border-radius:12px;padding:11px 14px;font:inherit;font-weight:600;color:var(--ink);min-height:48px;}
.inp:focus{outline:none;border-color:var(--acc);}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;padding:11px 18px;font-weight:800;min-height:48px;border:1px solid transparent;cursor:pointer;font-family:inherit;font-size:15px;}
.btn:focus-visible{outline:3px solid var(--acc-soft);outline-offset:2px;}
.btn-pri{background:var(--acc);color:var(--on-acc);}
.btn-pri:disabled{opacity:.5;cursor:not-allowed;}
.btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink);}
.btn-ghost:hover{background:var(--paper2);}
.btn-danger{background:var(--card);border-color:var(--danger);color:var(--danger);}
.btn-danger.armed{background:var(--danger);color:#fff;}
.iconbtn{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink2);cursor:pointer;}
.iconbtn:focus-visible{outline:3px solid var(--acc-soft);outline-offset:2px;}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer;min-height:40px;}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff;}
.chip:focus-visible{outline:3px solid var(--acc-soft);outline-offset:2px;}
.plate{display:inline-flex;align-items:stretch;border:1.5px solid var(--ink);border-radius:5px;overflow:hidden;background:#fff;line-height:1;}
.plate i{background:#1B44A8;color:#fff;font-style:normal;font-size:9px;display:flex;align-items:flex-end;padding:2px 3px;font-weight:800;}
.plate b{font-family:'Nunito',sans-serif;font-weight:800;letter-spacing:.06em;padding:3px 7px 2px;font-size:14px;color:var(--ink);}
.rail{position:relative;}
.rail::before{content:'';position:absolute;left:8px;top:14px;bottom:14px;width:2px;background:var(--line);}
.rail-row{position:relative;padding-left:30px;}
.rail-dot{position:absolute;left:2px;top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;background:#fff;border:3.5px solid var(--ink);z-index:1;}
.rail-dot.dest{border-color:var(--ok);background:var(--ok);}
.rail-dot.next{border-color:var(--acc);background:var(--acc);}
.banner{display:flex;gap:10px;align-items:flex-start;border-radius:14px;padding:12px 14px;font-size:14px;font-weight:600;}
.banner-warn{background:var(--warn-soft);border:1px solid transparent;color:var(--warn);}
.banner-danger{background:var(--danger-soft);border:1px solid transparent;color:var(--danger);}
.pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:800;}
.pill-miss{background:var(--warn-soft);color:var(--warn);}
.pill-conf{background:var(--danger);color:#fff;}
.seg{display:flex;background:var(--paper2);border-radius:14px;padding:4px;gap:3px;}
.seg button{flex:1;border:none;background:transparent;border-radius:11px;padding:9px 6px;font-weight:800;font-size:13px;color:var(--ink2);cursor:pointer;font-family:inherit;min-height:40px;}
.seg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(16,24,40,.12);}
.data-cats{scrollbar-width:none;-ms-overflow-style:none;}
.data-cats::-webkit-scrollbar{display:none;}
.tabbar{position:fixed;left:0;right:0;bottom:0;background:var(--ink);display:flex;z-index:40;padding-bottom:env(safe-area-inset-bottom);}
.tabbar button{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 1px 8px;border:none;background:transparent;color:#98A2B3;cursor:pointer;font-family:'Nunito',sans-serif;font-size:10px;letter-spacing:.04em;font-weight:800;border-top:3px solid transparent;}
.tabbar button.on{color:#fff;border-top-color:var(--acc);}
.modal-bg{position:fixed;inset:0;background:rgba(16,20,28,.5);z-index:50;display:flex;align-items:flex-end;justify-content:center;}
.modal{background:var(--paper);width:100%;max-width:560px;border-radius:22px 22px 0 0;padding:18px 16px 24px;overflow-y:auto;}
.map-bg{position:fixed;inset:0;background:rgba(16,20,28,.55);z-index:60;display:flex;align-items:stretch;justify-content:center;}
.map-modal{background:var(--paper);width:100%;height:100%;display:flex;flex-direction:column;font-family:'Nunito',system-ui,sans-serif;color:var(--ink);}
@media(min-width:640px){
  .map-bg{align-items:center;padding:24px;}
  .map-modal{max-width:680px;height:82vh;border-radius:22px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);}
}
.map-head{padding:12px 14px 8px;position:relative;z-index:1100;background:var(--paper);}
.map-results{position:absolute;top:100%;left:0;right:0;margin-top:4px;max-height:220px;overflow-y:auto;z-index:1200;box-shadow:0 10px 30px rgba(0,0,0,.2);}
.map-result{display:block;width:100%;text-align:left;padding:10px 12px;border:none;background:#fff;border-bottom:1px solid var(--line);font:inherit;font-size:13px;cursor:pointer;}
.map-result:hover{background:var(--acc-soft);}
.map-body{flex:1;position:relative;min-height:0;background:#E6EDEF;}
.map-canvas{position:absolute;inset:0;}
.map-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--paper);z-index:500;padding:16px;text-align:center;}
.map-foot{display:flex;align-items:center;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--paper);border-top:1px solid var(--line);position:relative;z-index:1100;}
.ft-pin{width:30px;height:40px;position:relative;cursor:grab;}
.ft-pin::before{content:'';position:absolute;left:3px;top:2px;width:24px;height:24px;background:var(--ink);border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.35);}
.ft-pin span{position:absolute;left:11px;top:10px;width:8px;height:8px;border-radius:50%;background:var(--acc);z-index:1;}
.dirpill{font-family:'Nunito',sans-serif;font-weight:800;letter-spacing:.02em;font-size:11px;border:1.5px solid var(--ink);border-radius:6px;padding:1px 6px;color:var(--ink);flex-shrink:0;}
.dirpill.v{background:var(--ink);color:#fff;}
.linkline{font-size:12.5px;color:var(--ink2);padding:0 0 0 30px;display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.rail-dot.sm{width:10px;height:10px;border-width:3px;left:4px;}
.statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 4px;text-align:center;}
.stat b{display:block;font-family:'Nunito',sans-serif;font-size:22px;font-weight:800;line-height:1.1;}
.stat span{font-size:10.5px;color:var(--ink2);letter-spacing:.02em;}
.cmp{width:100%;border-collapse:collapse;}
.cmp td,.cmp th{padding:7px 10px;border-bottom:1px solid var(--line);font-size:14px;text-align:left;}
.cmp th{font-size:12px;color:var(--ink2);font-weight:700;}
.cmp td.b{font-weight:800;font-variant-numeric:tabular-nums;}
.infodot-wrap{position:relative;display:inline-flex;vertical-align:middle;}
.infodot{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:none;background:transparent;color:var(--ink2);cursor:pointer;padding:0;}
.infodot:hover{color:var(--acc);}
.infodot:focus-visible{outline:3px solid var(--acc-soft);outline-offset:2px;}
.infodot-scrim{position:fixed;inset:0;z-index:69;background:transparent;border:none;padding:0;cursor:default;}
.infodot-pop{position:absolute;z-index:70;top:calc(100% + 8px);width:240px;max-width:76vw;background:var(--ink);color:#fff;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:600;line-height:1.45;letter-spacing:normal;text-transform:none;box-shadow:0 10px 30px rgba(16,24,40,.28);}
.infodot-pop.c{left:50%;transform:translateX(-50%);}
.infodot-pop.r{right:0;}
.infodot-pop.l{left:0;}
.header-ic{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;flex-shrink:0;}
.header-ic:hover{background:rgba(255,255,255,.24);}
.header-ic:focus-visible{outline:3px solid var(--acc-soft);outline-offset:2px;}
.help-steps{list-style:none;counter-reset:s;padding:0;margin:0;display:flex;flex-direction:column;gap:10px;}
.help-steps li{counter-increment:s;position:relative;padding-left:40px;min-height:28px;display:flex;align-items:center;font-size:14px;line-height:1.5;}
.help-steps li::before{content:counter(s);position:absolute;left:0;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:50%;background:var(--acc);color:var(--on-acc);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;}
.help-ic{width:40px;height:40px;border-radius:12px;background:var(--acc-soft);color:var(--acc);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px;}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;}}
`;

function Field({ label, children, hint }) {
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
function NumField({ label, hint, value, min = 0, onCommit }) {
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

function Modal({ title, onClose, children }) {
  const titleId = useRef(`mtitle-${uid()}`).current;
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
function DangerBtn({ label = "Törlés", confirmLabel = "Biztos törlöd?", onConfirm, small, disabledReason, onBlocked }) {
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

function PlateChip({ plate }) {
  return <span className="plate"><i>H</i><b>{plate}</b></span>;
}

function TeamDot({ color, size = 12 }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}

function EmptyState({ children }) {
  return <div className="card p-5 text-center text-sm" style={{ color: "var(--ink2)", borderStyle: "dashed" }}>{children}</div>;
}

/* Kis „?” buborék — koppintásra rövid magyarázatot mutat. `align`: l | c | r */
function InfoDot({ text, align = "c", label = "Mi ez?" }) {
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
function HelpSheet({ onClose }) {
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

/* =====================================================================
   3.5 TÉRKÉPES KOORDINÁTA-VÁLASZTÓ — Leaflet + OpenStreetMap
   A könyvtár csak a modál első megnyitásakor töltődik be (cdnjs).
   ===================================================================== */

let leafletLoader = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoader) return leafletLoader;
  leafletLoader = new Promise((resolve, reject) => {
    const CSS_ID = "leaflet-css";
    // Csak egyszer fűzzük be a stíluslapot: újrapróbálkozáskor korábban minden
    // kísérlet hagyott maga után egy halott <link>-et és egy halott <script>-et.
    if (!document.getElementById(CSS_ID)) {
      const css = document.createElement("link");
      css.id = CSS_ID;
      css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => {
      // A script betöltődhet úgy is, hogy a globális L nem jön létre (pl. CSP);
      // ilyenkor a hívó egyértelmű hibát kapjon, ne egy undefined-ot.
      if (window.L) resolve(window.L);
      else { js.remove(); leafletLoader = null; reject(new Error("Leaflet betöltési hiba")); }
    };
    js.onerror = () => { js.remove(); leafletLoader = null; reject(new Error("Leaflet betöltési hiba")); };
    document.head.appendChild(js);
  });
  return leafletLoader;
}

/* Koordináta-szöveg értelmezése: "46.25311, 20.14503" vagy "46,25311 20,14503" */
function parseLatLon(str) {
  const m = String(str || "").trim().match(/^(-?\d{1,3}(?:[.,]\d+)?)[;,\s]+(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", ".")), lon = parseFloat(m[2].replace(",", "."));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/* Egyszerű helyi vetítés az offline térképhez (városi léptékben pontos) */
const DEG_M = 111320; // méter / szélességi fok
function projPx(view, size, lat, lon) {
  const cosL = Math.cos((view.lat * Math.PI) / 180);
  return {
    x: size.w / 2 + ((lon - view.lon) * DEG_M * cosL) / view.mpp,
    y: size.h / 2 - ((lat - view.lat) * DEG_M) / view.mpp,
  };
}
function projGeo(view, size, x, y) {
  const cosL = Math.cos((view.lat * Math.PI) / 180);
  return {
    lat: view.lat - ((y - size.h / 2) * view.mpp) / DEG_M,
    lon: view.lon + ((x - size.w / 2) * view.mpp) / (DEG_M * cosL),
  };
}

/* Offline (csempementes) választó: rács + a meglévő pontok tájékozódásul.
   Koppintás = jelölő (közeli ismert pontra rásnappel), húzás = pásztázás,
   jelölő húzható, +/− gombokkal nagyítás. */
function OfflinePicker({ state, view, setView, pos, setPos }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 320, h: 320 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => [
    ...state.stations.filter((p) => p.lat != null && p.lon != null).map((p) => ({ ...p, kind: "st" })),
    ...state.venues.filter((p) => p.lat != null && p.lon != null).map((p) => ({ ...p, kind: "ve" })),
  ], [state]);

  const local = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e) => {
    const { x, y } = local(e);
    let mode = "pan";
    if (pos) {
      const p = projPx(view, size, pos.lat, pos.lon);
      if (Math.hypot(p.x - x, p.y - y) < 24) mode = "marker";
    }
    drag.current = { x, y, sLat: view.lat, sLon: view.lon, mode, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = local(e);
    if (Math.hypot(x - d.x, y - d.y) > 5) d.moved = true;
    if (d.mode === "marker") setPos(projGeo(view, size, x, y));
    else if (d.moved) {
      const cosL = Math.cos((d.sLat * Math.PI) / 180);
      setView({ ...view, lat: d.sLat + ((y - d.y) * view.mpp) / DEG_M, lon: d.sLon - ((x - d.x) * view.mpp) / (DEG_M * cosL) });
    }
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.mode !== "pan") return;
    const { x, y } = local(e);
    let g = projGeo(view, size, x, y);
    for (const p of pts) {
      const pp = projPx(view, size, p.lat, p.lon);
      if (Math.hypot(pp.x - x, pp.y - y) < 14) { g = { lat: p.lat, lon: p.lon }; break; }
    }
    setPos({ lat: g.lat, lon: g.lon });
  };
  const zoom = (f) => setView({ ...view, mpp: Math.min(60, Math.max(0.3, view.mpp * f)) });

  const stepM = [50, 100, 250, 500, 1000, 2500, 5000].find((s) => s / view.mpp >= 64) || 5000;
  const stepPx = stepM / view.mpp;
  const cosL = Math.cos((view.lat * Math.PI) / 180);
  const kx = (DEG_M * cosL) / view.mpp, ky = DEG_M / view.mpp;
  const offX = ((size.w / 2 - view.lon * kx) % stepPx + stepPx) % stepPx;
  const offY = ((size.h / 2 + view.lat * ky) % stepPx + stepPx) % stepPx;
  const vLines = []; for (let x = offX; x <= size.w; x += stepPx) vLines.push(x);
  const hLines = []; for (let y = offY; y <= size.h; y += stepPx) hLines.push(y);

  return (
    <div ref={boxRef} className="map-canvas" style={{ touchAction: "none", userSelect: "none", cursor: "crosshair", background: "#E6EDEF", overflow: "hidden" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}>
      <svg width={size.w} height={size.h} style={{ display: "block" }} aria-label="Egyszerűsített térkép">
        {vLines.map((x) => <line key={"v" + x} x1={x} y1={0} x2={x} y2={size.h} stroke="#DCE1E7" strokeWidth="1" />)}
        {hLines.map((y) => <line key={"h" + y} x1={0} y1={y} x2={size.w} y2={y} stroke="#DCE1E7" strokeWidth="1" />)}
        {pts.map((p) => {
          const q = projPx(view, size, p.lat, p.lon);
          if (q.x < -80 || q.y < -30 || q.x > size.w + 80 || q.y > size.h + 30) return null;
          return (
            <g key={p.kind + p.id}>
              {p.kind === "ve"
                ? <rect x={q.x - 5} y={q.y - 5} width={10} height={10} rx={2} fill="#12B76A" />
                : <circle cx={q.x} cy={q.y} r={5} fill="#14161C" />}
              <text x={q.x + 8} y={q.y + 4} fontSize="11" fill="#6A7180">{p.name}</text>
            </g>
          );
        })}
        {pos && (() => {
          const q = projPx(view, size, pos.lat, pos.lon);
          return (
            <g transform={`translate(${q.x},${q.y})`} style={{ cursor: "grab" }}>
              <path d="M0 0 C -8 -12, -13 -17, -13 -25 A 13 13 0 1 1 13 -25 C 13 -17, 8 -12, 0 0 Z" fill="#14161C" />
              <circle cx="0" cy="-25" r="4.5" fill="#00C2E8" />
            </g>
          );
        })()}
        <rect x={10} y={size.h - 24} width={stepPx} height={3} fill="#14161C" />
        <text x={10} y={size.h - 30} fontSize="11" fill="#6A7180">{stepM >= 1000 ? `${stepM / 1000} km` : `${stepM} m`}</text>
      </svg>
      <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 6 }}
        onPointerDown={(e) => e.stopPropagation()}>
        <button className="iconbtn" onClick={() => zoom(1 / 1.5)} aria-label="Nagyítás"><Plus size={16} /></button>
        <button className="iconbtn" onClick={() => zoom(1.5)} aria-label="Kicsinyítés"><Minus size={16} /></button>
      </div>
    </div>
  );
}

function MapPickerModal({ state, item, title, onSave, onClose }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const placeRef = useRef(null);
  const posRef = useRef(null);
  const c0 = defaultMapCenter(state, item);
  const [mode, setMode] = useState("loading"); // loading | osm | offline
  const [offReason, setOffReason] = useState("");
  const [pos, setPos] = useState(item && item.lat != null && item.lon != null ? { lat: item.lat, lon: item.lon } : null);
  const [oView, setOView] = useState({ lat: c0.lat, lon: c0.lon, mpp: 5 });
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [manual, setManual] = useState("");
  const [manualErr, setManualErr] = useState(false);

  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const goOffline = (reason) => {
      if (!alive) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null; placeRef.current = null;
      const p = posRef.current;
      if (p) setOView((v) => ({ ...v, lat: p.lat, lon: p.lon }));
      setOffReason(reason); setMode("offline");
    };
    loadLeaflet().then((L) => {
      if (!alive || !mapDivRef.current) return;
      const map = L.map(mapDivRef.current).setView([c0.lat, c0.lon], c0.zoom);
      let okTiles = 0, errTiles = 0, tries = 0;
      const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> közreműködők',
      });
      layer.on("tileload", () => { okTiles++; });
      layer.on("tileerror", () => { errTiles++; });
      layer.addTo(map);
      const pinIcon = L.divIcon({ className: "", html: '<div class="ft-pin"><span></span></div>', iconSize: [30, 40], iconAnchor: [15, 36] });
      const place = (latlng) => {
        if (markerRef.current) {
          markerRef.current.setLatLng(latlng);
        } else {
          markerRef.current = L.marker(latlng, { draggable: true, icon: pinIcon }).addTo(map);
          markerRef.current.on("dragend", () => {
            const p = markerRef.current.getLatLng();
            setPos({ lat: p.lat, lon: p.lng });
          });
        }
        setPos({ lat: latlng.lat, lon: latlng.lng });
      };
      placeRef.current = (lat, lon) => { place({ lat, lng: lon }); map.setView([lat, lon], Math.max(map.getZoom(), 15)); };
      map.on("click", (e) => place(e.latlng));
      map.on("contextmenu", (e) => place(e.latlng)); // mobilon: hosszú nyomás
      if (item && item.lat != null && item.lon != null) place({ lat: item.lat, lng: item.lon });
      mapRef.current = map;
      setMode("osm");
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 80);
      // Csempe-ellenőrzés: ha csak hibák jönnek és egy csempe sem tölt be, offline módra váltunk
      const check = () => {
        if (!alive || okTiles > 0) return;
        if (errTiles > 0) { goOffline("tiles"); return; }
        if (++tries < 4) timer = setTimeout(check, 2500);
      };
      timer = setTimeout(check, 2500);
    }).catch(() => goOffline("script"));
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null;
    };
  }, []);

  const doSearch = async () => {
    const query = q.trim();
    if (!query || searchBusy) return;
    setSearchBusy(true); setSearchErr(""); setResults(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=hu&q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("http");
      const js = await r.json();
      setResults(Array.isArray(js) ? js : []);
    } catch (e) {
      setSearchErr("A címkeresés most nem érhető el — jelölj kézzel, vagy illessz be koordinátát lent.");
    } finally {
      setSearchBusy(false);
    }
  };
  const jumpTo = (res) => {
    setResults(null);
    const lat = Number(res.lat), lon = Number(res.lon);
    if (mode === "osm" && mapRef.current) mapRef.current.setView([lat, lon], 16);
    else setOView((v) => ({ ...v, lat, lon, mpp: 2 }));
  };
  const applyManual = () => {
    const g = parseLatLon(manual);
    if (!g) { setManualErr(true); return; }
    setManualErr(false);
    if (mode === "osm" && placeRef.current) placeRef.current(g.lat, g.lon);
    else { setPos(g); setOView((v) => ({ ...v, lat: g.lat, lon: g.lon })); }
    setManual("");
  };

  return (
    <div className="map-bg" onClick={onClose}>
      <div className="map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="disp text-lg flex-1 truncate">{title}</h3>
            <button className="iconbtn" onClick={onClose} aria-label="Bezárás"><X size={18} /></button>
          </div>
          <div className="flex gap-2" style={{ position: "relative" }}>
            <input className="inp" placeholder="Címkeresés (pl. Szeged, Kossuth utca 1.)" value={q}
              onChange={(e) => { setQ(e.target.value); setSearchErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} />
            <button className="btn btn-pri" onClick={doSearch} disabled={searchBusy} aria-label="Keresés">
              <Search size={17} />
            </button>
            {results && (
              <div className="map-results card">
                {results.length === 0 && <div className="p-3 text-sm" style={{ color: "var(--ink2)" }}>Nincs találat.</div>}
                {results.map((r, i) => (
                  <button key={i} className="map-result" onClick={() => jumpTo(r)}>{r.display_name}</button>
                ))}
              </div>
            )}
          </div>
          {searchErr && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{searchErr}</div>}
          <p className="text-xs mt-1" style={{ color: "var(--ink2)" }}>
            A keresés csak odaugrik a térképen. A pontot koppintással vagy hosszú nyomással jelölöd ki, a jelölő utána húzható.
          </p>
          {mode === "offline" && (
            <div className="banner banner-warn mt-1" style={{ fontSize: 12.5, padding: "8px 10px" }}>
              <AlertTriangle size={15} />
              <span>
                {offReason === "script" ? "A térképkönyvtár nem tölthető be ebben a környezetben" : "Az OSM-csempéket ez a környezet nem engedi betölteni (az előnézet blokkolja a külső képeket)"}
                {" "}— egyszerűsített térkép fut, a meglévő pontjaid tájékozódási pontként látszanak. Telepítve a teljes OpenStreetMap működik. Google Mapsből másolt koordinátát lent be is illeszthetsz.
              </span>
            </div>
          )}
        </div>
        <div className="map-body">
          {mode !== "offline" && <div ref={mapDivRef} className="map-canvas" />}
          {mode === "offline" && <OfflinePicker state={state} view={oView} setView={setOView} pos={pos} setPos={setPos} />}
          {mode === "loading" && (
            <div className="map-overlay"><span className="disp text-lg">Térkép betöltése…</span></div>
          )}
        </div>
        <div className="map-foot" style={{ flexWrap: "wrap" }}>
          <div className="flex items-center gap-2 w-full">
            <input className="inp" style={{ minHeight: 38, padding: "6px 10px", flex: 1 }}
              placeholder="Koordináta beillesztése: 46.25311, 20.14503"
              value={manual} onChange={(e) => { setManual(e.target.value); setManualErr(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") applyManual(); }} />
            <button className="btn btn-ghost" style={{ minHeight: 38, padding: "6px 12px" }} onClick={applyManual}>Beszúr</button>
          </div>
          {manualErr && <div className="text-xs w-full" style={{ color: "var(--danger)" }}>Nem értelmezhető — várt formátum: 46.25311, 20.14503</div>}
          <div className="flex-1 min-w-0">
            <div className="text-xs" style={{ color: "var(--ink2)" }}>Kijelölt pont</div>
            <div className="tnum text-lg">{pos ? `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` : "—"}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Mégse</button>
          <button className="btn btn-pri" disabled={!pos} onClick={() => pos && onSave(r5(pos.lat), r5(pos.lon))}>Mentés</button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   4. KÉPERNYŐK
   ===================================================================== */

/* ---------- 4.1 HETI ÁTTEKINTÉS ---------- */
function WeekScreen({ state, openRide }) {
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

function OccCard({ state, occ, onOpen }) {
  const { training } = occ;
  const team = byId(state.teams, training.teamId);
  const venue = byId(state.venues, training.venueId);
  const rides = findRides(state, training, occ.dayIdx);

  return (
    <button onClick={onOpen} className="card w-full text-left p-0 overflow-hidden flex" style={{ cursor: "pointer" }}>
      <div style={{ width: 6, background: team?.color || "#999", flexShrink: 0 }} aria-hidden />
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="tnum text-lg">{training.start}–{training.end}</span>
          <span className="font-semibold truncate">{team?.name || "?"}</span>
          {training.type === "once" && <span className="text-xs pill" style={{ background: "#EEF0F3", color: "var(--ink2)" }}>egyszeri</span>}
        </div>
        <div className="flex items-center gap-1 text-sm mt-1" style={{ color: "var(--ink2)" }}>
          <MapPin size={14} /> <span className="truncate">{venue?.name || "nincs helyszín"}</span>
        </div>
        {rides.length > 0 ? rides.map((ride) => {
          const vehicle = byId(state.vehicles, ride.vehicleId);
          const driver = byId(state.drivers, ride.driverId);
          const conflicts = findConflicts(state, ride);
          const dir = ride.dir || "oda";
          const firstStop = ride.stops.length
            ? ride.stops.reduce((a, b) => ((timeToMin(a.time) ?? 9999) <= (timeToMin(b.time) ?? 9999) ? a : b))
            : null;
          const depTime = dir === "vissza" ? minToTime(venueDepartMin(state, training)) : (firstStop?.time || null);
          const pax = seatSum(ride.stops);
          const over = vehicle && pax > vehicle.seats;
          return (
            <div key={ride.id} className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`dirpill ${dir === "vissza" ? "v" : ""}`}>{dir === "oda" ? "ODA" : "VISSZA"}</span>
              {vehicle && <PlateChip plate={vehicle.plate} />}
              <span className="text-sm font-medium truncate">{driver?.name || "?"}</span>
              {depTime && (
                <span className="text-sm tnum flex items-center gap-1" style={{ color: "var(--ink2)" }}>
                  <Clock size={14} /> {dir === "vissza" ? "indulás a helyszínről" : "indulás"} {depTime}
                </span>
              )}
              {conflicts.length > 0 && <span className="pill pill-conf disp"><AlertTriangle size={12} /> ÜTKÖZÉS</span>}
              {over && <span className="pill pill-conf disp">{pax}/{vehicle.seats} FŐ</span>}
            </div>
          );
        }) : (
          <div className="mt-2">
            <span className="pill pill-miss disp"><AlertTriangle size={12} /> NINCS FUVAR</span>
          </div>
        )}
      </div>
      <div className="flex items-center pr-2" style={{ color: "var(--ink2)" }}><ChevronsRight size={18} /></div>
    </button>
  );
}

/* ---------- 4.2 CSAPATOK ---------- */
function TeamsScreen({ state, update, notice }) {
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

function TeamForm({ team, onSave, onCancel }) {
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

function TeamDetail({ state, update, team, onBack, notice }) {
  const [editing, setEditing] = useState(false);
  const [trForm, setTrForm] = useState(null); // null | {} | training
  const trainings = state.trainings.filter((t) => t.teamId === team.id);

  const toggle = (key, id) => update((s) => ({
    ...s,
    teams: s.teams.map((t) => t.id !== team.id ? t : {
      ...t, [key]: t[key].includes(id) ? t[key].filter((x) => x !== id) : [...t[key], id],
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
              <Field label="Kezdő megálló" hint="ODÁ-nál első, VISSZÁ-nál utolsó megállóként rögzítjük; üresen a leggyorsabb sorrend nyer.">
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
            <p className="text-xs" style={{ color: "var(--ink2)" }}>A megállók bekapcsolási sorrendje a felszállási sorrend; a VISSZA irány ennek fordítottja.</p>
          )}
        </div>
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

function TrainingForm({ state, team, training, onSave, onCancel }) {
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

/* ---------- 4.3 TÖRZSADATOK ---------- */
const MASTER_TABS = [
  { key: "stations", label: "Állomások", sing: "állomás" },
  { key: "venues", label: "Helyszínek", sing: "helyszín" },
  { key: "vehicles", label: "Járművek", sing: "jármű" },
  { key: "drivers", label: "Sofőrök", sing: "sofőr" },
];

function MasterScreen({ tab, state, update, notice, setNotice }) {
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

function MasterForm({ kind, state, entity, onSave, onCancel }) {
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

/* ---------- 4.4 FUVAR SZERKESZTŐ ---------- */
function RideScreen({ state, update, target, setTarget, onExit }) {
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

function RidePicker({ state, onPick }) {
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
const o2t = (o) => ({ trainingId: o.training.id, dayIdx: o.dayIdx, dateISO: o.dateISO });

function RideEditor({ state, update, training, dayIdx, dateISO, onBack }) {
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
                {i + 1}. fuvar{(r.dir || "oda") === "vissza" ? " · VISSZA" : ""}{d ? ` · ${d.name}` : ""}
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

function RideForm({ state, update, training, dayIdx, dateISO, existing, onBack }) {
  const team = byId(state.teams, training.teamId);
  const venue = byId(state.venues, training.venueId);

  const [draft, setDraft] = useState(() => existing
    ? { ...existing, stops: existing.stops.map((s) => ({ ...s })) }
    : { id: "__uj", trainingId: training.id, day: training.type === "weekly" ? dayIdx : null, date: training.type === "once" ? training.date : null, vehicleId: "", driverId: "", dir: "oda", stops: [] });

  /* Irány. A régebbi, irány nélkül mentett fuvarok ODA-ként viselkednek — ezt a
     rideWindow is így értelmezi (`ride.dir || "oda"`), tehát a kettő nem csúszhat szét. */
  const dir = draft.dir || "oda";
  const isBack = dir === "vissza";

  const vehicle = byId(state.vehicles, draft.vehicleId);
  const conflicts = useMemo(() => findConflicts(state, draft), [state, draft]);
  const vConf = conflicts.filter((c) => c.type === "vehicle");
  const dConf = conflicts.filter((c) => c.type === "driver");
  const pax = seatSum(draft.stops);
  const over = vehicle && pax > vehicle.seats;

  const teamStations = state.stations.filter((s) => team?.stationIds.includes(s.id));
  const freeStations = teamStations.filter((s) => !draft.stops.some((x) => x.stationId === s.id));

  const addStop = (stationId) => {
    /* ODA: az edzés kezdete előtt gyűjtünk be; VISSZA: a helyszíni indulás után
       tesszük le a gyerekeket — a kiinduló idő tehát a két irányban más. */
    const first = isBack ? venueDepartMin(state, training) + 10 : (timeToMin(training.start) ?? 0) - 40;
    const base = draft.stops.length
      ? (timeToMin(draft.stops[draft.stops.length - 1].time) ?? first) + 10
      : first;
    setDraft({ ...draft, stops: [...draft.stops, { id: uid(), stationId, time: minToTime(base), count: team?.stationCounts?.[stationId] || "" }] });
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
        </div>
      </div>

      <Field label="Irány" hint="ODA: a falvakból a helyszínre. VISSZA: a helyszínről haza.">
        <div className="seg">
          <button className={!isBack ? "on" : ""} onClick={() => setDraft({ ...draft, dir: "oda" })}>ODA</button>
          <button className={isBack ? "on" : ""} onClick={() => setDraft({ ...draft, dir: "vissza" })}>VISSZA</button>
        </div>
      </Field>

      <Field label="Jármű *">
        <select className="inp" value={draft.vehicleId} onChange={(e) => setDraft({ ...draft, vehicleId: e.target.value })}>
          <option value="">– válassz járművet –</option>
          {state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.plate}) · {v.seats} fő</option>)}
        </select>
      </Field>
      {vConf.map((c, i) => (
        <div key={i} className="banner banner-danger mb-3"><AlertTriangle size={18} />
          <span>A jármű ekkor máshol foglalt: <b>{confText(c)}</b></span></div>
      ))}

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
        <select className="inp mb-4" value="" onChange={(e) => e.target.value && addStop(e.target.value)}>
          <option value="">＋ Megálló hozzáadása…</option>
          {freeStations.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` – ${s.address}` : ""}</option>)}
        </select>
      ) : teamStations.length === 0 ? (
        <div className="banner banner-warn mb-4"><AlertTriangle size={18} />A csapathoz még nincs állomás rendelve. A Csapatok fülön kapcsolhatsz be állomásokat.</div>
      ) : (
        <p className="text-sm mb-4 px-1" style={{ color: "var(--ink2)" }}>A csapat összes állomása szerepel az útvonalban.</p>
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

/* ---------- 4.45 BEOSZTÁS — ütemezés-optimalizáló ---------- */

function taskHardIssues(state, weekday, t) {
  const out = [];
  const maxSeats = Math.max(0, ...state.vehicles.map((v) => Number(v.seats) || 0));
  if (t.pax > maxSeats) out.push(`Nincs jármű elegendő férőhellyel (${t.pax} fő > ${maxSeats}).`);
  if (!state.drivers.some((d) => driverAvailableFor(d, weekday, t.start, t.end)))
    out.push(`Egyik sofőr sem érhető el ${minToTime(t.start)}–${minToTime(t.end)} között.`);
  return out;
}

function TaskRow({ state, task: t, locked, inChain, onLock, onMove, reasons }) {
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
          <button className="iconbtn" style={{ width: 32, height: 32, ...(locked ? { background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" } : {}) }}
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

function ChainCard({ state, chain: c, onLock, onMove }) {
  const paid = Math.max(c.end - c.start, c.driver?.minShiftMin || 0);
  const cost = (state.settings.calloutFee || 0) + (paid / 60) * (c.driver?.wage || 0);
  return (
    <div className="card mb-3 overflow-hidden">
      <div className="p-3 flex items-center gap-2 flex-wrap" style={{ background: "var(--ink)", color: "#fff" }}>
        <span className="disp text-base">{c.driver?.name || "— nincs sofőr —"}</span>
        {c.vehicle && <PlateChip plate={c.vehicle.plate} />}
        {c.vehicle && <span className="text-xs" style={{ color: "#B9C0CC" }}>{c.vehicle.seats} fh</span>}
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

function MoveModal({ state, task, chains, currentChainId, onClose, onToChain, onToNew, onToUnassigned }) {
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

function ProposalModal({ state, before, out, onApply, onClose }) {
  if (out.empty) return (
    <Modal title="Optimalizálás" onClose={onClose}>
      <EmptyState>Erre a napra nincs fuvarfeladat.</EmptyState>
      {out.notes.map((n, i) => <div key={i} className="banner banner-warn mt-2"><AlertTriangle size={15} />{n}</div>)}
    </Modal>
  );
  const a = before.stats, b = out.stats;
  const Row = ({ label, va, vb }) => (<tr><td>{label}</td><td className="b">{va}</td><td className="b">{vb}</td></tr>);
  return (
    <Modal title="Optimalizálás — előtte / utána" onClose={onClose}>
      <table className="cmp mb-3">
        <thead><tr><th></th><th>Jelenlegi</th><th>Javasolt</th></tr></thead>
        <tbody>
          <Row label="Sofőrök" va={a.drivers} vb={b.drivers} />
          <Row label="Láncok" va={a.chains} vb={b.chains} />
          <Row label="Fizetett idő" va={fmtH(a.paidMin)} vb={fmtH(b.paidMin)} />
          <Row label="Üresjárat" va={`${a.dead} p`} vb={`${b.dead} p`} />
          <Row label="Várakozás" va={`${a.idle} p`} vb={`${b.idle} p`} />
          <Row label="Becsült költség" va={fmtFt(a.cost)} vb={fmtFt(b.cost)} />
          <Row label="Fedetlen feladat" va={before.uncovered} vb={out.uncovered.length} />
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

function ScheduleScreen({ state, update }) {
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

/* ---------- 4.5 SOFŐR NÉZET ---------- */
function DriverScreen({ state }) {
  const [selDriverId, setDriverId] = useState(state.drivers[0]?.id || "");
  const driverId = byId(state.drivers, selDriverId) ? selDriverId : (state.drivers[0]?.id || "");
  const [dateISO, setDateISO] = useState(() => toISO(new Date()));
  const todayISO = toISO(new Date());
  /* Percenként újrarenderelünk: e nélkül a "KÖVETKEZŐ" jelölés és a múltbeli
     megállók halványítása a képernyő megnyitásának percén ragadt, vagyis a
     nézet fő funkciója egy letett telefonon sosem lépett tovább. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const rides = useMemo(() => {
    const wd = weekdayIdx(dateISO);
    return state.rides
      .filter((r) => r.driverId === driverId)
      .map((r) => ({ ride: r, training: byId(state.trainings, r.trainingId) }))
      .filter(({ ride, training }) => training && (training.type === "weekly" ? ride.day === wd : training.date === dateISO))
      .sort((a, b) => rideWindow(state, a.ride, a.training)[0] - rideWindow(state, b.ride, b.training)[0]);
  }, [state, driverId, dateISO]);

  const driver = byId(state.drivers, driverId);

  return (
    <div className="px-4 pb-4">
      <div className="py-3 flex items-center gap-1"><h2 className="disp text-xl">Sofőr nézet</h2><InfoDot align="l" text="Egy sofőr napi fuvarjai, nyomtatható formában. Fent válts sofőrt és napot." /></div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        {state.drivers.map((d) => (
          <button key={d.id} className={`chip ${d.id === driverId ? "on" : ""}`} onClick={() => setDriverId(d.id)} style={{ whiteSpace: "nowrap" }}>{d.name}</button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <button className="iconbtn" onClick={() => setDateISO(toISO(addDays(parseISO(dateISO), -1)))} aria-label="Előző nap"><ChevronLeft size={18} /></button>
        <button className="disp text-lg" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => setDateISO(todayISO)}>
          {DAYS[weekdayIdx(dateISO)]} · {fmtDate(dateISO)} {dateISO === todayISO && <span className="pill pill-miss disp" style={{ verticalAlign: "middle" }}>MA</span>}
        </button>
        <button className="iconbtn" onClick={() => setDateISO(toISO(addDays(parseISO(dateISO), 1)))} aria-label="Következő nap"><ChevronRight size={18} /></button>
      </div>

      {!driver && <EmptyState>Nincs sofőr felvéve. Az Adatok fülön adhatsz hozzá.</EmptyState>}
      {driver && rides.length === 0 && <EmptyState><b>{driver.name}</b> részére erre a napra nincs fuvar.</EmptyState>}

      <div className="flex flex-col gap-4">
        {rides.map(({ ride, training }) => {
          const team = byId(state.teams, training.teamId);
          const venue = byId(state.venues, training.venueId);
          const vehicle = byId(state.vehicles, ride.vehicleId);
          const isToday = dateISO === todayISO;
          const dir = ride.dir || "oda";
          const nextIdx = isToday ? ride.stops.findIndex((s) => (timeToMin(s.time) ?? 0) >= nowMin) : -1;
          const pax = seatSum(ride.stops);
          const stopRows = ride.stops.map((s, i) => {
            const st = byId(state.stations, s.stationId);
            const past = isToday && (timeToMin(s.time) ?? 0) < nowMin && i !== nextIdx;
            const isNext = i === nextIdx;
            return (
              <div key={s.id} className="rail-row" style={past ? { opacity: 0.45 } : {}}>
                <span className={`rail-dot ${isNext ? "next" : ""}`} aria-hidden />
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="tnum" style={{ fontSize: 28, lineHeight: 1 }}>{s.time || "–:–"}</span>
                  <span className="font-semibold" style={{ fontSize: 19 }}>{st?.name || "?"}</span>
                  {Number(s.count) > 0 && <span className="text-base" style={{ color: "var(--ink2)" }}>{s.count} fő</span>}
                  {isNext && <span className="pill pill-miss disp">KÖVETKEZŐ</span>}
                </div>
                {st?.address && <div className="text-sm mt-1" style={{ color: "var(--ink2)" }}>{st.address}</div>}
              </div>
            );
          });
          const venueRow = (
            <div className="rail-row" key="__venue">
              <span className="rail-dot dest" aria-hidden />
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="tnum" style={{ fontSize: 28, lineHeight: 1, color: "var(--ok)" }}>
                  {dir === "vissza" ? minToTime(venueDepartMin(state, training)) : training.start}
                </span>
                <span className="font-semibold" style={{ fontSize: 19 }}>{venue?.name}</span>
              </div>
              <div className="text-sm mt-1" style={{ color: "var(--ink2)" }}>
                {venue?.address ? `${venue.address} · ` : ""}
                {dir === "vissza" ? "innen indul a hazaszállítás" : "eddigre kell a helyszínen lenni"}
              </div>
            </div>
          );
          return (
            <div key={ride.id} className="card overflow-hidden">
              <div className="p-3 flex items-center gap-3" style={{ background: "var(--ink)", color: "#fff" }}>
                <TeamDot color={team?.color || "#999"} size={14} />
                <div className="flex-1 min-w-0">
                  <div className="disp text-lg truncate flex items-center gap-2">
                    <span className={`dirpill ${dir === "vissza" ? "v" : ""}`} style={dir === "vissza" ? { borderColor: "#fff", background: "#fff", color: "var(--ink)" } : { borderColor: "#fff", color: "#fff" }}>{dir === "oda" ? "ODA" : "VISSZA"}</span>
                    <span className="truncate">{team?.name}</span>
                  </div>
                  <div className="text-sm" style={{ color: "#B9C0CC" }}>edzés {training.start}–{training.end}</div>
                </div>
                {vehicle && <div className="text-right">
                  <PlateChip plate={vehicle.plate} />
                  <div className="text-xs mt-1" style={{ color: "#B9C0CC" }}>{vehicle.name}{pax ? ` · ${pax} fő` : ""}</div>
                </div>}
              </div>
              <div className="rail p-4 flex flex-col" style={{ gap: 18 }}>
                {dir === "vissza" ? [venueRow, ...stopRows] : [...stopRows, venueRow]}
                {ride.stops.length === 0 && <div className="text-sm" style={{ color: "var(--ink2)" }}>Ehhez a fuvarhoz még nincsenek megállók megadva.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =====================================================================
   5. APP — navigáció, állapot, perzisztencia
   ===================================================================== */

/* ---------- 4.x ADATOK — csapatok + törzsadatok egy helyen ---------- */
const DATA_CATS = [
  { key: "teams", label: "Csapatok" },
  { key: "stations", label: "Állomások" },
  { key: "venues", label: "Helyszínek" },
  { key: "vehicles", label: "Járművek" },
  { key: "drivers", label: "Sofőrök" },
];

function DataScreen({ state, update, resetSeed, notice, setNotice }) {
  const [sub, setSub] = useState("teams");
  return (
    <div className="pb-4">
      <div className="data-cats flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
        {DATA_CATS.map((c) => (
          <button key={c.key} className={`chip ${sub === c.key ? "on" : ""}`} style={{ whiteSpace: "nowrap" }}
            onClick={() => { setSub(c.key); setNotice(""); }}>{c.label}</button>
        ))}
      </div>
      {sub === "teams"
        ? <TeamsScreen state={state} update={update} notice={notice} />
        : <MasterScreen tab={sub} state={state} update={update} notice={notice} setNotice={setNotice} />}

      {/* Egyszer, az Adatok fül alján — korábban mind a négy törzsadat-alfülön
          ott volt, vagyis a teljes valós adat felülírása négy helyen, két
          kattintásra volt elérhető. */}
      <div className="mt-8 mb-2 flex justify-center">
        <DangerBtn label="Mintaadatok visszaállítása" confirmLabel="Minden adat felülíródik!" onConfirm={resetSeed} />
      </div>
    </div>
  );
}

const TABS = [
  { key: "week", label: "Hét", icon: CalendarDays },
  { key: "sched", label: "Beosztás", icon: Workflow },
  { key: "data", label: "Adatok", icon: Boxes },
  { key: "driver", label: "Sofőr", icon: Car },
];

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("week");
  const [rideTarget, setRideTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const loaded = useRef(false);
  /* A legutóbb kiírt (vagy a szerverről változatlanul beolvasott) blob. A mentés
     ehhez hasonlít, nem az objektumidentitáshoz — különben minden oldalbetöltés
     visszaírná a beolvasott állapotot, ami a másik szerkesztőt „az adatok máshol
     módosultak" ütközésbe kergetné, és elégetné a 20 elemű mentési előzményt. */
  const lastSaved = useRef(null);
  /* A debounce-ban várakozó mentés, hogy unmountkor / lapelrejtéskor ki tudjuk
     üríteni ahelyett, hogy a clearTimeout némán eldobná. */
  const pending = useRef(null);

  const flush = () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    lastSaved.current = p.blob;
    persistState(p.state);
  };

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const s = await loadState();
        if (cancelled) return;
        if (s) {
          // Valódi, szerverről olvasott állapot → már perzisztált, ne írjuk vissza.
          const shaped = ensureShape(s);
          lastSaved.current = JSON.stringify(shaped);
          setState(shaped);
        } else {
          // Üres érték → mintaadat, amit ki KELL írni (ez hozza létre a sort).
          setState(ensureShape(seedState()));
        }
        loaded.current = true;
      } catch (e) {
        if (cancelled) return;
        if (isNotFound(e)) {
          // Genuinely empty workspace → seed sample data (and persist it).
          setState(ensureShape(seedState()));
          loaded.current = true;
        } else {
          // Real read failure (network/permissions) → show a retry screen,
          // never mount the app on seed data over unread real data.
          setLoadError(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [retryTick]);

  useEffect(() => {
    if (!loaded.current || !state) return;
    const blob = JSON.stringify(state);
    if (blob === lastSaved.current) return;   // nincs valódi változás → nincs írás
    pending.current = { blob, state };
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
  }, [state]);

  /* A függőben lévő mentés kiürítése lapbezáráskor, elrejtéskor és unmountkor
     (utóbbi a kijelentkezés: az <App/> unmountol, mielőtt a debounce lejárna). */
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, []);

  const update = (fn) => setState((s) => fn(s));
  const openRide = (occ) => { setRideTarget(o2t(occ)); setTab("ride"); };
  const resetSeed = () => { setState(ensureShape(seedState())); setNotice(""); };

  if (loadError) {
    return (
      <div className="ft-root flex items-center justify-center" style={{ minHeight: "100vh", padding: 24 }}>
        <style>{CSS}</style>
        <div className="card p-4" style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="disp text-2xl mb-2">Nem sikerült betölteni</div>
          <p className="mb-3" style={{ color: "var(--ink2)", lineHeight: 1.5 }}>
            Az adatok betöltése nem sikerült (valószínűleg hálózati hiba). Az
            adataid biztonságban vannak a szerveren. Ellenőrizd a kapcsolatot, és
            próbáld újra.
          </p>
          <button className="btn btn-pri w-full" onClick={() => { setLoadError(false); setRetryTick((t) => t + 1); }}>
            Újrapróbálkozás
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="ft-root flex items-center justify-center" style={{ minHeight: "100vh" }}>
        <style>{CSS}</style>
        <div className="disp text-2xl">Vector betöltése…</div>
      </div>
    );
  }

  return (
    <div className="ft-root">
      <style>{CSS}</style>
      <header className="flex items-center gap-2 px-4" style={{ background: "var(--ink)", color: "#fff", height: 52 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--acc)" }} />
        <span className="disp text-xl" style={{ letterSpacing: ".12em" }}>Vector</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="header-ic" onClick={() => window.dispatchEvent(new CustomEvent("fuvarterv:restore"))} aria-label="Korábbi mentések"><RotateCcw size={18} /></button>
          <button className="header-ic" onClick={() => { flush(); window.dispatchEvent(new CustomEvent("fuvarterv:signout")); }} aria-label="Kijelentkezés"><LogOut size={18} /></button>
          <button className="header-ic" onClick={() => setHelpOpen(true)} aria-label="Súgó — hogyan működik?"><HelpCircle size={20} /></button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl" style={{ paddingBottom: 84 }}>
        {tab === "week" && <WeekScreen state={state} openRide={openRide} />}
        {tab === "sched" && <ScheduleScreen state={state} update={update} />}
        {tab === "data" && <DataScreen state={state} update={update} resetSeed={resetSeed} notice={notice} setNotice={setNotice} />}
        {tab === "driver" && <DriverScreen state={state} />}
        {tab === "ride" && <RideScreen state={state} update={update} target={rideTarget} setTarget={setRideTarget} onExit={() => { setRideTarget(null); setTab("week"); }} />}
      </main>

      <nav className="tabbar" aria-label="Fő navigáció">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} className={tab === t.key ? "on" : ""}
              onClick={() => { setTab(t.key); setNotice(""); }}>
              <Icon size={20} /> {t.label}
            </button>
          );
        })}
      </nav>
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/* =====================================================================
   Named exports of pure domain/optimizer functions — for unit and
   property tests (test/). The default export above stays the app; these
   add no imports and do not change runtime behaviour.
   ===================================================================== */
export {
  DEFAULT_SETTINGS, isNotFound, ensureShape, seedState,
  normalizePlate, plateExists,
  timeToMin, minToTime, weekdayIdx, mondayOf, toISO, addDays,
  legMin, bestStationOrder, teamRouteOrder, splitStationsByCapacity,
  rideWindow, findConflicts, teamPax, deleteGuard,
  planOda, planVissza, venueDepartMin,
  genDayTasks, resolveDay, mkChain, dayStats, driverAvailableFor, optimizeDay,
};
