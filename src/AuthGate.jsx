import { useEffect, useState } from "react";
import { supabase, isConfigured, WORKSPACE_ID } from "./supabaseClient.js";
import { supabaseStorage } from "./supabaseStorage.js";

// Install the Supabase-backed KV store the app expects. Assigned at import time
// so it is in place before <App/> ever mounts (App only renders once a session
// exists, so no unauthenticated request is ever made through it).
if (typeof window !== "undefined") {
  window.storage = supabaseStorage;
}

const wrap = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#12151C",
  color: "#fff",
  fontFamily: "system-ui, sans-serif",
  padding: 24,
};
const card = { width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 12 };
const input = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #2A2F3A",
  background: "#0C0E13",
  color: "#fff",
  fontSize: 16,
};
const button = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "none",
  background: "#E8590C",
  color: "#fff",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | signing | error
  const [message, setMessage] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("signing");
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
    // On success onAuthStateChange updates the session and the app renders.
  };

  return (
    <div style={wrap}>
      <form style={card} onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#E8590C" }} />
          <span style={{ fontSize: 22, letterSpacing: ".12em", fontWeight: 700 }}>FUVARTERV</span>
        </div>
        <label style={{ fontSize: 13, color: "#8B93A3" }} htmlFor="email">
          E‑mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="pelda@klub.hu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={input}
          required
        />
        <label style={{ fontSize: 13, color: "#8B93A3" }} htmlFor="password">
          Jelszó
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
          required
        />
        <button type="submit" style={button} disabled={status === "signing"}>
          {status === "signing" ? "Belépés…" : "Bejelentkezés"}
        </button>
        {status === "error" && (
          <p style={{ color: "#FF8787", fontSize: 13 }}>Hibás e‑mail vagy jelszó.</p>
        )}
      </form>
    </div>
  );
}

// Blocking overlay: once the data changed elsewhere, saves can no longer
// succeed, so we stop the user from editing on (silently unsaved) — the only
// safe action is to reload. This covers the whole app and captures clicks.
function StaleOverlay({ onReload }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(18, 21, 28, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ ...card, lineHeight: 1.5, background: "#1B1E27", padding: 24, borderRadius: 14, textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Az adatok máshol módosultak</div>
        <p style={{ color: "#B9C0CC", marginBottom: 16 }}>
          Valaki más időközben mentett, ezért a mentés le van tiltva, hogy ne írd
          felül a módosításait. A mostani, nem mentett változtatásaid nem
          menthetők — töltsd újra az oldalt a legfrissebb adatokkal, és dolgozz
          onnan tovább.
        </p>
        <button onClick={onReload} style={{ ...button, width: "100%" }}>
          Újratöltés
        </button>
      </div>
    </div>
  );
}

function SaveErrorBanner({ onDismiss }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: "#C92A2A",
        color: "#fff",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 14,
      }}
    >
      <span style={{ flex: 1 }}>
        A mentés nem sikerült (hálózat vagy jogosultság). A legutóbbi módosításod
        lehet, hogy nem lett elmentve — ellenőrizd a kapcsolatot, és próbáld újra.
      </span>
      <button
        onClick={onDismiss}
        aria-label="Bezárás"
        style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}
      >
        ×
      </button>
    </div>
  );
}

function LoadErrorScreen({ onRetry }) {
  return (
    <div style={wrap}>
      <div style={{ ...card, lineHeight: 1.5 }}>
        <span style={{ fontSize: 22, letterSpacing: ".12em", fontWeight: 700 }}>FUVARTERV</span>
        <p>
          Nem sikerült betölteni az adatokat. Ez általában hálózati hiba — az
          adataid biztonságban vannak a szerveren. Ellenőrizd a kapcsolatot, és
          próbáld újra.
        </p>
        <button onClick={onRetry} style={button}>
          Újrapróbálkozás
        </button>
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

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onStale = () => setStale(true);
    const onSaveError = () => setSaveError(true);
    window.addEventListener("fuvarterv:stale", onStale);
    window.addEventListener("fuvarterv:saveerror", onSaveError);
    return () => {
      window.removeEventListener("fuvarterv:stale", onStale);
      window.removeEventListener("fuvarterv:saveerror", onSaveError);
    };
  }, []);

  // Pre-flight read once a session exists: confirm the workspace row is
  // reachable before mounting <App/>. An empty result (no row yet) is fine —
  // only a real error blocks. This runs before loadState() inside the app, so
  // by the time App mounts the read path is known-good.
  useEffect(() => {
    if (!isConfigured || !session) return;
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
      });
    return () => {
      cancelled = true;
    };
  }, [session, retryTick]);

  if (!isConfigured) {
    return (
      <div style={wrap}>
        <div style={{ ...card, lineHeight: 1.5 }}>
          <span style={{ fontSize: 22, letterSpacing: ".12em", fontWeight: 700 }}>FUVARTERV</span>
          <p>
            Hiányzik a Supabase konfiguráció. Másold a <code>.env.example</code> fájlt{" "}
            <code>.env</code> néven, és add meg a <code>VITE_SUPABASE_URL</code> és{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> értékeket, majd indítsd újra a szervert.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...wrap, fontSize: 20 }}>Betöltés…</div>
    );
  }

  if (!session) return <LoginScreen />;

  if (preflight === "error") {
    return <LoadErrorScreen onRetry={() => setRetryTick((n) => n + 1)} />;
  }

  if (preflight !== "ready") {
    return <div style={{ ...wrap, fontSize: 20 }}>Betöltés…</div>;
  }

  return (
    <>
      {stale && <StaleOverlay onReload={() => window.location.reload()} />}
      {saveError && !stale && (
        <SaveErrorBanner onDismiss={() => setSaveError(false)} />
      )}
      <div style={{ position: "fixed", top: 8, right: 8, zIndex: 999 }}>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            padding: "4px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.3)",
            background: "rgba(0,0,0,.35)",
            color: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Kijelentkezés
        </button>
      </div>
      {children}
    </>
  );
}
