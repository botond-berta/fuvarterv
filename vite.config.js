import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The app source (fuvarterv.jsx) lives at the repo root and is imported from
// src/main.jsx. fs.allow lets Vite serve it in dev from one level up.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, fs: { allow: [".", ".."] } },
});
