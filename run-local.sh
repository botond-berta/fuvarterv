#!/usr/bin/env bash
#
# run-local.sh — set up and run Fuvarterv (fuvarterv.jsx) on http://localhost:5173/
#
# Does everything needed, without root:
#   1. Installs Node.js 22 LTS into ~/.local (only if a suitable node is missing).
#   2. Scaffolds a Vite project in ./.devserver that wraps fuvarterv.jsx
#      (App.jsx is a symlink to the real file, so edits hot-reload).
#   3. npm install, then starts the dev server.
#
# Re-running is safe: existing steps are skipped. Pass --reinstall to rebuild
# the scaffold from scratch. Ctrl-C stops the server.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$REPO/.devserver"
PORT="${PORT:-5173}"
NODE_MAJOR=22
LOCAL="$HOME/.local"
export PATH="$LOCAL/bin:$PATH"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

if [[ "${1:-}" == "--reinstall" ]]; then
  log "Removing existing scaffold ($APP)"
  rm -rf "$APP"
fi

# ---------------------------------------------------------------------------
# 1. Node.js (no root; prebuilt tarball into ~/.local)
# ---------------------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -v | sed 's/^v//;s/\..*//')"
  if [[ "$cur" -ge 18 ]]; then need_node=0; fi
fi

if [[ "$need_node" -eq 1 ]]; then
  log "Installing Node.js ${NODE_MAJOR} LTS into $LOCAL (no root needed)"
  ver="$(curl -fsSL "https://nodejs.org/dist/index.json" \
        | grep -o "\"version\":\"v${NODE_MAJOR}[0-9.]*\"" | head -1 \
        | grep -o "v${NODE_MAJOR}[0-9.]*" || true)"
  ver="${ver:-v22.23.1}"   # fallback if the index can't be reached
  arch="$(uname -m)"; case "$arch" in x86_64) a=x64;; aarch64|arm64) a=arm64;; *) a="$arch";; esac
  f="node-${ver}-linux-${a}.tar.xz"
  tmp="$(mktemp -d)"
  log "Downloading $f"
  curl -fsSL -o "$tmp/$f"            "https://nodejs.org/dist/${ver}/${f}"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/${ver}/SHASUMS256.txt"
  ( cd "$tmp" && grep " $f\$" SHASUMS256.txt | sha256sum -c - )
  mkdir -p "$LOCAL/bin"
  tar -xf "$tmp/$f" -C "$LOCAL"
  for b in node npm npx; do
    ln -sf "$LOCAL/node-${ver}-linux-${a}/bin/$b" "$LOCAL/bin/$b"
  done
  rm -rf "$tmp"
  log "Installed $(node -v) / npm $(npm -v)"
  echo "    (add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell rc to keep it)"
else
  log "Using existing $(node -v)"
fi

# ---------------------------------------------------------------------------
# 2. Scaffold the Vite project (wraps fuvarterv.jsx)
# ---------------------------------------------------------------------------
if [[ ! -f "$APP/package.json" ]]; then
  log "Scaffolding Vite project in $APP"
  mkdir -p "$APP/src"

  # App.jsx -> the real source file, so edits hot-reload.
  ln -sf "$REPO/fuvarterv.jsx" "$APP/src/App.jsx"

  cat > "$APP/package.json" <<'JSON'
{
  "name": "fuvarterv-dev",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.469.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.0.0",
    "vite": "^6.0.0"
  }
}
JSON

  cat > "$APP/vite.config.js" <<'JS'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // App.jsx is a symlink to the repo's fuvarterv.jsx. preserveSymlinks keeps
  // module resolution anchored at src/ so bare imports (react, lucide-react)
  // resolve from this project's node_modules instead of the repo dir.
  resolve: { preserveSymlinks: true },
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "lucide-react"] },
  server: { host: true, fs: { allow: ["."], strict: false } },
});
JS

  cat > "$APP/index.html" <<'HTML'
<!doctype html>
<html lang="hu">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Fuvarterv</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
HTML

  cat > "$APP/src/index.css" <<'CSS'
@import "tailwindcss";
CSS

  cat > "$APP/src/main.jsx" <<'JSX'
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// The app uses the Claude artifact `window.storage` API for persistence.
// In a regular browser, back it with localStorage (see README).
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      if (value === null) throw new Error("key not found");
      return { key, value };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix = "") {
      return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)) };
    },
  };
}

import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
JSX

  # Keep the scaffold out of git.
  cat > "$APP/.gitignore" <<'GI'
*
GI
else
  log "Scaffold already present ($APP)"
  ln -sf "$REPO/fuvarterv.jsx" "$APP/src/App.jsx"   # ensure symlink is intact
fi

# ---------------------------------------------------------------------------
# 3. Install deps + run
# ---------------------------------------------------------------------------
cd "$APP"
if [[ ! -d node_modules ]]; then
  log "Installing dependencies (npm install)"
  npm install --no-fund --no-audit
fi

log "Starting dev server on http://localhost:${PORT}/  (Ctrl-C to stop)"
exec npm run dev -- --port "$PORT"
