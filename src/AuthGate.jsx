import { useEffect, useState } from "react";
import { supabase, isConfigured, WORKSPACE_ID } from "./supabaseClient.js";
import { supabaseStorage } from "./supabaseStorage.js";
import { RoleContext } from "./roleContext.js";
import RestorePanel from "./RestorePanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./theme.css";

// Install the Supabase-backed KV store the app expects. Assigned at import time
// so it is in place before <App/> ever mounts (App only renders once a session
// exists, so no unauthenticated request is ever made through it).
if (typeof window !== "undefined") {
  window.storage = supabaseStorage;
}

// Vector app-ikon: kerek cián csempe egy egyszerű útvonal-jellel.
function AppIcon() {
  return (
    <span className="v-appicon" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <circle cx="7" cy="24" r="3.4" fill="#fff" />
        <path d="M7 24 C 14 24, 12 11, 20 9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M18 5 L26 9 L18 13 Z" fill="#fff" />
      </svg>
    </span>
  );
}

/* A Supabase pontosan megmondja, miért nem sikerült a belépés — a felület viszont
   korábban minden esetre ugyanazt a "Hibás e-mail vagy jelszó" mondatot írta ki, és
   az információ elveszett. A klub személyzete fogja ezt használni, nem fejlesztők:
   ha nem az appból derül ki, mi a teendő, akkor sehonnan.

   Amit NEM bontunk szét: azt, hogy létezik-e egyáltalán ez az e-mail-cím. A rossz
   jelszó és a nem létező fiók továbbra is közös üzenetet kap, különben a belépő
   képernyő felhasználólistát szivárogtatna. Csak a SZERVER állapotáról szóló
   eseteket különböztetjük meg — azok nem mondanak semmit egyetlen fiókról sem. */
export function loginErrorMessage(error) {
  const code = error?.code || error?.error_code || "";
  const status = error?.status;
  const raw = `${code} ${error?.message || ""}`.toLowerCase();

  if (code === "email_not_confirmed" || raw.includes("email not confirmed"))
    return "Ez a fiók még nincs megerősítve. A Supabase-ben az Authentication → Users alatt erősítsd meg az e-mail-címet (vagy hozd létre újra a felhasználót az „Auto Confirm User” bepipálásával).";

  if (code === "invalid_credentials" || raw.includes("invalid login credentials"))
    return "Hibás e‑mail vagy jelszó.";

  if (code === "email_provider_disabled" || code === "signup_disabled" || raw.includes("logins are disabled") || raw.includes("not allowed for this instance"))
    return "Az e‑mailes bejelentkezés ki van kapcsolva a szerveren. A Supabase-ben az Authentication → Providers → Email alatt kapcsold be (az „Enable sign-ups” kikapcsolva maradhat).";

  if (code === "over_request_rate_limit" || status === 429)
    return "Túl sok próbálkozás egymás után. Várj egy percet, és próbáld újra.";

  if (status === 401 || raw.includes("invalid api key"))
    return "A szerver beállítása hibás (érvénytelen API kulcs) — ez nem rajtad múlik. A Vercelen a VITE_SUPABASE_ANON_KEY értékét kell javítani, majd újradeployolni.";

  // Hálózat / CSP: a kérés el sem jutott a szerverig.
  if (error?.name === "AuthRetryableFetchError" || raw.includes("failed to fetch") || raw.includes("networkerror"))
    return "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot, és próbáld újra.";

  /* Ismeretlen eset. Szándékosan kiírjuk a szerver saját szövegét és kódját: egy
     nyers azonosító, amit tovább lehet adni, sokkal többet ér, mint egy újabb
     "valami hiba történt". Pontosan ez hiányzott, amikor egy 422-es válasz okát
     a böngésző Network fülén kellett keresni. */
  const detail = [status, code, error?.message].filter(Boolean).join(" · ");
  return `Nem sikerült a belépés.${detail ? ` (${detail})` : ""}`;
}

/* A belépett felhasználó szerepköre a user_roles táblából, e-mail alapján.
   Nincs sor → sofőr: pontosan az, amit a szerver-oldali szabályok is mondanak
   (akit nem vettek fel adminnak, az nem írhat semmit). Egy kivétel van, és az
   szándékos: ha maga a user_roles TÁBLA hiányzik — vagyis a 0004-es migráció
   még nem futott le —, mindenki admin. Ilyenkor a szerver sem korlátoz semmit,
   tehát a fülek elrejtése csak színház volna, egy frissen deployolt kliens
   viszont e nélkül olvasásra némítaná a régi adatbázis minden felhasználóját. */
export async function fetchRole(email) {
  try {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("email", (email || "").toLowerCase())
      .maybeSingle();
    if (error) {
      const raw = `${error.code || ""} ${error.message || ""}`;
      // 42P01: Postgres "relation does not exist"; PGRST205: a PostgREST
      // séma-gyorsítótára nem ismeri a táblát. Mindkettő = nincs 0004.
      if (raw.includes("42P01") || raw.includes("PGRST205")) return { role: "admin", error: null };
      return { role: null, error };
    }
    return { role: data?.role === "admin" ? "admin" : "sofor", error: null };
  } catch (e) {
    return { role: null, error: e };
  }
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | signing | error
  const [errorMsg, setErrorMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("signing");
    setErrorMsg("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setErrorMsg(loginErrorMessage(error));
        setStatus("error");
      }
      // On success onAuthStateChange updates the session and the app renders.
    } catch (err) {
      /* A try/catch nélkül egy DOBOTT hiba (hálózat, CSP) sosem érte el a
         setStatus-t, így a gomb véglegesen a „Belépés…” feliraton ragadt,
         üzenet nélkül — a felhasználó számára néma megállás. */
      setErrorMsg(loginErrorMessage(err));
      setStatus("error");
    }
  };

  return (
    <div className="v-screen">
      <form className="v-card v-login" onSubmit={submit}>
        <div className="v-login-head">
          <AppIcon />
          <div>
            <div className="v-title">Üdv újra!</div>
            <div className="sub">Lépj be a Vectorba</div>
          </div>
        </div>

        <div className="v-field">
          <label className="v-label" htmlFor="email">E‑mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="edzo@klub.hu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="v-input"
            required
          />
        </div>

        <div className="v-field">
          <label className="v-label" htmlFor="password">Jelszó</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="v-input"
            required
          />
        </div>

        <button type="submit" className="v-btn v-btn-primary v-btn-block" disabled={status === "signing"}>
          {status === "signing" ? "Belépés…" : "Bejelentkezés"}
        </button>
        {status === "error" && <p className="v-error" role="alert">{errorMsg}</p>}
      </form>
    </div>
  );
}

// Blocking overlay: once the data changed elsewhere, saves can no longer
// succeed, so we stop the user from editing (silently unsaved) — the only safe
// action is to reload. This covers the whole app and captures clicks.
function StaleOverlay({ onReload }) {
  return (
    <div className="v-overlay">
      <div className="v-dialog">
        <span className="v-noteic warn">!</span>
        <div className="v-title">Az adatok máshol módosultak</div>
        <p className="v-muted">
          Valaki más időközben mentett, ezért a mentés le van tiltva, hogy ne írd
          felül a módosításait. A nem mentett változtatásaid nem menthetők — tölts
          újra a legfrissebb adatokkal, és onnan dolgozz tovább.
        </p>
        <button onClick={onReload} className="v-btn v-btn-primary v-btn-block">Újratöltés</button>
      </div>
    </div>
  );
}

function SaveErrorToast({ onDismiss }) {
  return (
    <div className="v-toast" role="alert">
      <span className="v-noteic crit">!</span>
      <div className="body">
        <b>A mentés nem sikerült</b>
        <p>
          Úgy tűnik, megszakadt a kapcsolat. A legutóbbi módosításod lehet, hogy nem
          mentődött — ellenőrizd a netet, és próbáld újra.
        </p>
      </div>
      <button onClick={onDismiss} aria-label="Bezárás" className="v-toast-x">×</button>
    </div>
  );
}

function LoadErrorScreen({ onRetry }) {
  return (
    <div className="v-screen">
      <div className="v-card v-pad v-info-card">
        <AppIcon />
        <div className="v-title">Nem sikerült betölteni</div>
        <p className="v-muted" style={{ margin: 0 }}>
          Ez általában hálózati hiba — az adataid biztonságban vannak a szerveren.
          Ellenőrizd a kapcsolatot, és próbáld újra.
        </p>
        <button onClick={onRetry} className="v-btn v-btn-primary v-btn-block">Újrapróbálkozás</button>
      </div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Pre-flight read state: "checking" | "ready" | "error". Gates <App/> so a
  // transient read failure at login can't be mistaken for an empty workspace
  // (which would make the app seed fresh sample data over the user's real data).
  const [preflight, setPreflight] = useState("checking");
  const [retryTick, setRetryTick] = useState(0);
  const [showRestore, setShowRestore] = useState(false);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    // A .catch nélkül egy elutasított token-frissítés örökre a "Betöltés…"
    // képernyőn hagyná a felhasználót, retry lehetőség nélkül.
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data?.session ?? null))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onStale = () => setStale(true);
    const onSaveError = () => setSaveError(true);
    // The app's header buttons live in fuvarterv.jsx (which never imports auth);
    // they signal the shell through the same event seam as stale/saveerror.
    const onRestore = () => setShowRestore(true);
    const onSignout = async () => {
      await supabase.auth.signOut();
      supabaseStorage.reset();
    };
    window.addEventListener("fuvarterv:stale", onStale);
    window.addEventListener("fuvarterv:saveerror", onSaveError);
    window.addEventListener("fuvarterv:restore", onRestore);
    window.addEventListener("fuvarterv:signout", onSignout);
    return () => {
      window.removeEventListener("fuvarterv:stale", onStale);
      window.removeEventListener("fuvarterv:saveerror", onSaveError);
      window.removeEventListener("fuvarterv:restore", onRestore);
      window.removeEventListener("fuvarterv:signout", onSignout);
    };
  }, []);

  // Pre-flight read once a session exists: confirm the workspace row is
  // reachable before mounting <App/>. An empty result (no row yet) is fine —
  // only a real error blocks. This runs before loadState() inside the app, so
  // by the time App mounts the read path is known-good.
  // A felhasználó azonosítója — NEM a session objektum. Az onAuthStateChange a
  // TOKEN_REFRESHED eseményre is tüzel (nagyjából óránként), minden alkalommal új
  // objektummal; ha a preflight arra volna kötve, visszaesne "checking" állapotba,
  // ami korai visszatéréssel unmountolná az <App/>-ot — elveszítve minden nyitott
  // űrlapot és piszkozatot. Az azonosító csak valódi felhasználóváltáskor változik.
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;
  // A szerepkör a preflighttal együtt dől el; amíg nincs meg, az App nem mountol.
  const [role, setRole] = useState(null);

  useEffect(() => {
    if (!isConfigured || !userId) return;
    let cancelled = false;
    setPreflight("checking");
    setRole(null);
    Promise.all([
      supabase.from("app_state").select("id").eq("id", WORKSPACE_ID).maybeSingle(),
      fetchRole(userEmail),
    ])
      .then(([ws, r]) => {
        if (cancelled) return;
        if (ws.error || r.error) {
          setPreflight("error");
          return;
        }
        setRole(r.role);
        setPreflight("ready");
      })
      .catch(() => {
        if (!cancelled) setPreflight("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, userEmail, retryTick]);

  // Felhasználóváltáskor (ki-, majd bejelentkezés ugyanazon a gépen) a korábbi
  // munkamenet blokkoló állapota nem öröklődhet át: a stale overlay egyébként a
  // következő felhasználót is kizárná egy őt nem érintő ütközés miatt.
  useEffect(() => {
    setStale(false);
    setSaveError(false);
    setShowRestore(false);
  }, [userId]);

  if (!isConfigured) {
    return (
      <div className="v-screen">
        <div className="v-card v-pad v-info-card">
          <AppIcon />
          <div className="v-title">Hiányzik a beállítás</div>
          <p className="v-muted" style={{ margin: 0 }}>
            Másold a <code>.env.example</code> fájlt <code>.env</code> néven, és add meg a{" "}
            <code>VITE_SUPABASE_URL</code> és <code>VITE_SUPABASE_ANON_KEY</code> értékeket,
            majd indítsd újra a szervert.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="v-screen v-muted" style={{ fontSize: 18, fontWeight: 700 }}>Betöltés…</div>;
  }

  if (!session) return <LoginScreen />;

  if (preflight === "error") {
    return <LoadErrorScreen onRetry={() => setRetryTick((n) => n + 1)} />;
  }

  if (preflight !== "ready") {
    return <div className="v-screen v-muted" style={{ fontSize: 18, fontWeight: 700 }}>Betöltés…</div>;
  }

  return (
    <RoleContext.Provider value={{ role: role || "sofor", email: userEmail }}>
      {stale && <StaleOverlay onReload={() => window.location.reload()} />}
      {saveError && !stale && <SaveErrorToast onDismiss={() => setSaveError(false)} />}
      {showRestore && <RestorePanel onClose={() => setShowRestore(false)} />}
      {/* A határ a shellen BELÜL van, hogy egy képernyő-hiba után a korábbi
          mentések és a kijelentkezés még elérhető maradjon. */}
      <ErrorBoundary>{children}</ErrorBoundary>
    </RoleContext.Provider>
  );
}
