import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// AuthGate installs window.storage (Supabase-backed) at import time, before
// App mounts. App itself is the portable single-file artifact at the repo root.
import AuthGate from "./AuthGate.jsx";
import App from "../fuvarterv.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
