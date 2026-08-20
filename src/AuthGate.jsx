import { useEffect, useState } from "react";
import { supabase, isConfigured, WORKSPACE_ID } from "./supabaseClient.js";
import { supabaseStorage } from "./supabaseStorage.js";
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

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | signing | error

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("signing");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) setStatus("error");
    // On success onAuthStateChange updates the session and the app renders.
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
        {status === "error" && <p className="v-error">Hibás e‑mail vagy jelszó.</p>}
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

  useEffect(() => {
    if (!isConfigured || !userId) return;
    let cancelled = false;
    setPreflight("checking");
    supabase
      .from("app_state")
      .select("id")
      .eq("id", WORKSPACE_ID)
      .maybeSingle()
      .then(({ error }) => {
        if (cancelled) return;
        setPreflight(error ? "error" : "ready");
      })
      .catch(() => {
        if (!cancelled) setPreflight("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, retryTick]);

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
    <>
      {stale && <StaleOverlay onReload={() => window.location.reload()} />}
      {saveError && !stale && <SaveErrorToast onDismiss={() => setSaveError(false)} />}
      {showRestore && <RestorePanel onClose={() => setShowRestore(false)} />}
      {/* A határ a shellen BELÜL van, hogy egy képernyő-hiba után a korábbi
          mentések és a kijelentkezés még elérhető maradjon. */}
      <ErrorBoundary>{children}</ErrorBoundary>
    </>
  );
}
