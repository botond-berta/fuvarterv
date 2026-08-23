/* Fuvarterv — az alkalmazás héja: navigáció, állapot, mentés.
   Kiemelve a fuvarterv.jsx-ből; a viselkedés változatlan. */

import { useState, useEffect, useRef, useContext } from "react";
import { CalendarDays, Boxes, Car, Workflow, HelpCircle, RotateCcw, LogOut } from "lucide-react";

import "./ui/styles.css";
import { RoleContext } from "./roleContext.js";
import { loadState, persistState } from "./data/storage.js";
import { ensureShape, seedState } from "./data/seed.js";
import { isNotFound } from "./data/storage.js";
import { HelpSheet } from "./ui/base.jsx";
import { WeekScreen } from "./screens/WeekScreen.jsx";
import { ScheduleScreen } from "./screens/ScheduleScreen.jsx";
import { DataScreen } from "./screens/DataScreen.jsx";
import { DriverScreen } from "./screens/DriverScreen.jsx";
import { RideScreen, o2t } from "./screens/RideScreen.jsx";

const TABS = [
  { key: "week", label: "Hét", icon: CalendarDays },
  { key: "sched", label: "Beosztás", icon: Workflow },
  { key: "data", label: "Adatok", icon: Boxes },
  { key: "driver", label: "Sofőr", icon: Car },
];

export default function App() {
  /* Szerepkör: az AuthGate tölti be a szerverről, és amíg az App mountolva van,
     nem változik (felhasználóváltáskor az App újramountol). Sofőrként a felület
     csak a Sofőr fület adja, és SOSEM ír — a tényleges tiltást az adatbázis
     szabályai (RLS, 0004-es migráció) adják, ez itt csak a hozzá illő UX. */
  const { role, email: myEmail } = useContext(RoleContext);
  const isAdmin = role === "admin";
  const [state, setState] = useState(null);
  const [tab, setTab] = useState(isAdmin ? "week" : "driver");
  const [rideTarget, setRideTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  /* Sofőr + üres munkaterület: adminnál ilyenkor mintaadatot vetünk és MENTJÜK
     (az hozza létre a sort) — sofőrként az az írás tilos is, hiábavaló is. */
  const [emptyWs, setEmptyWs] = useState(false);
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
    if (!isAdmin) return;   // sofőr sosem ír (a mentő-effekt sem ütemez neki)
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
        } else if (isAdmin) {
          // Üres érték → mintaadat, amit ki KELL írni (ez hozza létre a sort).
          setState(ensureShape(seedState()));
        } else {
          setEmptyWs(true);
        }
        loaded.current = true;
      } catch (e) {
        if (cancelled) return;
        if (isNotFound(e) && isAdmin) {
          // Genuinely empty workspace → seed sample data (and persist it).
          setState(ensureShape(seedState()));
          loaded.current = true;
        } else if (isNotFound(e)) {
          setEmptyWs(true);
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
    if (!isAdmin) return;   // öv és nadrágtartó: az RLS amúgy is elutasítaná
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

  if (emptyWs) {
    return (
      <div className="ft-root flex items-center justify-center" style={{ minHeight: "100vh", padding: 24 }}>
        <div className="card p-4" style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="disp text-2xl mb-2">Még nincs feltöltött adat</div>
          <p className="mb-3" style={{ color: "var(--ink2)", lineHeight: 1.5 }}>
            A munkaterület még üres, és sofőrként nem tudsz adatot felvenni.
            Kérd meg az adminisztrátort, hogy töltse fel a fuvarokat, aztán
            nyisd meg újra az alkalmazást.
          </p>
          <button className="btn btn-pri w-full" onClick={() => { flush(); window.dispatchEvent(new CustomEvent("fuvarterv:signout")); }}>
            Kijelentkezés
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="ft-root flex items-center justify-center" style={{ minHeight: "100vh" }}>
        <div className="disp text-2xl">Fuvarterv betöltése…</div>
      </div>
    );
  }

  return (
    <div className="ft-root">
      <header className="flex items-center gap-2 px-4" style={{ background: "var(--surface-inv)", color: "var(--on-inv)", height: 52 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--acc)" }} />
        <span className="disp text-xl" style={{ letterSpacing: ".12em" }}>Fuvarterv</span>
        <div className="ml-auto flex items-center gap-1">
          {isAdmin && <button className="header-ic" onClick={() => window.dispatchEvent(new CustomEvent("fuvarterv:restore"))} aria-label="Korábbi mentések"><RotateCcw size={18} /></button>}
          <button className="header-ic" onClick={() => { flush(); window.dispatchEvent(new CustomEvent("fuvarterv:signout")); }} aria-label="Kijelentkezés"><LogOut size={18} /></button>
          <button className="header-ic" onClick={() => setHelpOpen(true)} aria-label="Súgó — hogyan működik?"><HelpCircle size={20} /></button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl" style={{ paddingBottom: 84 }}>
        {isAdmin && tab === "week" && <WeekScreen state={state} openRide={openRide} />}
        {isAdmin && tab === "sched" && <ScheduleScreen state={state} update={update} />}
        {isAdmin && tab === "data" && <DataScreen state={state} update={update} resetSeed={resetSeed} notice={notice} setNotice={setNotice} myEmail={myEmail} />}
        {tab === "driver" && <DriverScreen state={state} myEmail={myEmail} />}
        {isAdmin && tab === "ride" && <RideScreen state={state} update={update} target={rideTarget} setTarget={setRideTarget} onExit={() => { setRideTarget(null); setTab("week"); }} />}
      </main>

      <nav className="tabbar" aria-label="Fő navigáció">
        {(isAdmin ? TABS : TABS.filter((t) => t.key === "driver")).map((t) => {
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
