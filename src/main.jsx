import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// AuthGate installs window.storage (Supabase-backed) at import time, before
// App mounts, so the app never renders against an unconfigured store.
import AuthGate from "./AuthGate.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
