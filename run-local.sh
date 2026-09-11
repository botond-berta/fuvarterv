#!/usr/bin/env bash
#
# run-local.sh — set up and run Fuvarterv on http://localhost:5173/
#
# Does everything needed, without root:
#   1. Installs Node.js 22 LTS into ~/.local (only if node >= 20 is missing —
#      the same floor as "engines" in package.json, which Vercel also reads).
#   2. npm install + starts the Vite dev server for the committed root project.
#
# The app source lives entirely under src/. Persistence and login are handled by
# Supabase: copy .env.example to .env and fill in your project's URL and anon key
# (see the README). Ctrl-C stops the server.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5173}"
NODE_MAJOR=22
LOCAL="$HOME/.local"
export PATH="$LOCAL/bin:$PATH"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Node.js (no root; prebuilt tarball into ~/.local)
# ---------------------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -v | sed 's/^v//;s/\..*//')"
  if [[ "$cur" -ge 20 ]]; then need_node=0; fi
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
# 2. Install deps + run
# ---------------------------------------------------------------------------
cd "$REPO"

if [[ ! -f .env ]]; then
  log "No .env found — copy .env.example to .env and add your Supabase URL + anon key."
  log "(The dev server will start, but login/persistence won't work until you do.)"
fi

if [[ ! -d node_modules ]]; then
  log "Installing dependencies (npm install)"
  npm install --no-fund --no-audit
fi

log "Starting dev server on http://localhost:${PORT}/  (Ctrl-C to stop)"
exec npm run dev -- --port "$PORT"
