import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true },
  // Sourcemaps ship with the production build: the ErrorBoundary prints a full
  // stack to the console, and a minified one is useless when a user reports it.
  // Nothing secret is in the bundle — the anon key is public by design and the
  // real boundary is row level security.
  build: { sourcemap: true },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{js,jsx}"],
    setupFiles: ["./test/setup.js"],
  },
});
