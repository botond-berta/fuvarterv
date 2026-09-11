import { useEffect, useState } from "react";
import { supabase, isConfigured, WORKSPACE_ID } from "./supabaseClient.js";
import { supabaseStorage } from "./supabaseStorage.js";
import { RoleContext } from "./roleContext.js";
import RestorePanel from "./RestorePanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./ui/styles.css";

// Install the Supabase-backed KV store the app expects. Assigned at import time
// so it is in place before <App/> ever mounts (App only renders once a session
// exists, so no unauthenticated request is ever made through it).
if (typeof window !== "undefined") {
  window.storage = supabaseStorage;
}

// The app icon: a rounded cyan tile with a simple route mark.
function AppIcon() {
  return (
    <span className="shell-appicon" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <circle cx="7" cy="24" r="3.4" fill="#fff" />
        <path d="M7 24 C 14 24, 12 11, 20 9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M18 5 L26 9 L18 13 Z" fill="#fff" />
      </svg>
    </span>
  );
}

/* Supabase says precisely why a sign-in failed, but the UI used to print the same
   "wrong e-mail or password" sentence for every case and throw that away. Club staff
   use this, not developers: if the app does not say what to do, nothing will.

   What we deliberately do NOT separate is whether an address exists at all. A wrong
   password and a non-existent account still share one message, or the login screen
   would leak a user list. Only cases describing the state of the SERVER are
   distinguished, and those reveal nothing about any individual account. */
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

  // Network or CSP: the request never reached the server at all.
  if (error?.name === "AuthRetryableFetchError" || raw.includes("failed to fetch") || raw.includes("networkerror"))
    return "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot, és próbáld újra.";

  /* An unknown case. The server's own text and code are printed on purpose: a raw
     identifier somebody can pass on is worth far more than another "something went
     wrong". This is exactly what was missing when the reason for a 422 had to be dug
     out of the browser's network tab. */
  const detail = [status, code, error?.message].filter(Boolean).join(" · ");
  return `Nem sikerült a belépés.${detail ? ` (${detail})` : ""}`;
}

/* The signed-in user's role, from user_roles, matched on e-mail.

   No row means driver, which is exactly what the server-side policies say: anyone not
   entered as an admin may write nothing.

   There is one deliberate exception. If the user_roles TABLE itself is missing (the
   schema has not been applied yet), everyone is an admin. The server is not
   restricting anything in that state either, so hiding the tabs would be theatre —
   and without this a freshly deployed client would silently drop every user of an
   older database to read-only. */
export async function fetchRole(email) {
  try {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("email", (email || "").toLowerCase())
      .maybeSingle();
    if (error) {
      const raw = `${error.code || ""} ${error.message || ""}`;
      // 42P01 is Postgres "relation does not exist"; PGRST205 means PostgREST's
      // schema cache does not know the table. Either way: the schema is not applied.
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
      /* Without this try/catch a THROWN error (network, CSP) never reached
         setStatus, so the button was stuck on "signing in" forever,
         üzenet nélkül — a felhasználó számára néma megállás. */
      setErrorMsg(loginErrorMessage(err));
      setStatus("error");
    }
  };

  return (
    <div className="shell-screen">
      <form className="shell-card shell-login" onSubmit={submit}>
        <div className="shell-login-head">
          <AppIcon />
          <div>
            <div className="shell-title">Üdv újra!</div>
            <div className="sub">Lépj be a Fuvartervbe</div>
          </div>
        </div>

        <div className="shell-field">
          <label className="shell-label" htmlFor="email">E‑mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="edzo@klub.hu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="shell-input"
            required
          />
        </div>

        <div className="shell-field">
          <label className="shell-label" htmlFor="password">Jelszó</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="shell-input"
            required
          />
        </div>

        <button type="submit" className="shell-btn shell-btn-primary shell-btn-block" disabled={status === "signing"}>
          {status === "signing" ? "Belépés…" : "Bejelentkezés"}
        </button>
        {status === "error" && <p className="shell-error" role="alert">{errorMsg}</p>}
      </form>
    </div>
  );
}

// Blocking overlay: once the data changed elsewhere, saves can no longer
// succeed, so we stop the user from editing (silently unsaved) — the only safe
// action is to reload. This covers the whole app and captures clicks.
function StaleOverlay({ onReload }) {
  return (
    <div className="shell-overlay">
      <div className="shell-dialog">
        <span className="shell-noteic warn">!</span>
        <div className="shell-title">Az adatok máshol módosultak</div>
        <p className="shell-muted">
          Valaki más időközben mentett, ezért a mentés le van tiltva, hogy ne írd
          felül a módosításait. A nem mentett változtatásaid nem menthetők — tölts
          újra a legfrissebb adatokkal, és onnan dolgozz tovább.
        </p>
        <button onClick={onReload} className="shell-btn shell-btn-primary shell-btn-block">Újratöltés</button>
      </div>
    </div>
  );
}

function SaveErrorToast({ onDismiss }) {
  return (
    <div className="shell-toast" role="alert">
      <span className="shell-noteic crit">!</span>
      <div className="body">
        <b>A mentés nem sikerült</b>
        <p>
          Úgy tűnik, megszakadt a kapcsolat. A legutóbbi módosításod lehet, hogy nem
          mentődött — ellenőrizd a netet, és próbáld újra.
        </p>
      </div>
      <button onClick={onDismiss} aria-label="Bezárás" className="shell-toast-x">×</button>
    </div>
  );
}

function LoadErrorScreen({ onRetry }) {
  return (
    <div className="shell-screen">
      <div className="shell-card shell-pad shell-info-card">
        <AppIcon />
        <div className="shell-title">Nem sikerült betölteni</div>
        <p className="shell-muted" style={{ margin: 0 }}>
          Ez általában hálózati hiba — az adataid biztonságban vannak a szerveren.
          Ellenőrizd a kapcsolatot, és próbáld újra.
        </p>
        <button onClick={onRetry} className="shell-btn shell-btn-primary shell-btn-block">Újrapróbálkozás</button>
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
    // Without the .catch a rejected token refresh would leave the user on the
    // loading screen forever, with no way to retry.
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
    // The app's header buttons live in App.jsx, which never imports auth; they signal
    // the shell through the same event seam as stale/saveerror.
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
  // Keyed on the user's ID, NOT on the session object. onAuthStateChange also fires
  // for TOKEN_REFRESHED (roughly hourly) with a fresh object each time; keying the
  // preflight on that would drop it back to "checking", and the early return would
  // unmount <App/>, losing every open form and draft. The ID only changes on a real
  // change of user.
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;
  // The role is settled together with the preflight; App does not mount until it is.
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

  // On a change of user (sign out, then sign in on the same machine) the previous
  // session's blocking state must not carry over: the stale overlay would otherwise
  // lock out the next user over a conflict that was never theirs.
  useEffect(() => {
    setStale(false);
    setSaveError(false);
    setShowRestore(false);
  }, [userId]);

  if (!isConfigured) {
    return (
      <div className="shell-screen">
        <div className="shell-card shell-pad shell-info-card">
          <AppIcon />
          <div className="shell-title">Hiányzik a beállítás</div>
          <p className="shell-muted" style={{ margin: 0 }}>
            Másold a <code>.env.example</code> fájlt <code>.env</code> néven, és add meg a{" "}
            <code>VITE_SUPABASE_URL</code> és <code>VITE_SUPABASE_ANON_KEY</code> értékeket,
            majd indítsd újra a szervert.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="shell-screen shell-muted" style={{ fontSize: 18, fontWeight: 700 }}>Betöltés…</div>;
  }

  if (!session) return <LoginScreen />;

  if (preflight === "error") {
    return <LoadErrorScreen onRetry={() => setRetryTick((n) => n + 1)} />;
  }

  if (preflight !== "ready") {
    return <div className="shell-screen shell-muted" style={{ fontSize: 18, fontWeight: 700 }}>Betöltés…</div>;
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
