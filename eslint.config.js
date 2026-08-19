import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

/*
 * A projekthez korábban nem tartozott linter. A két szabály, amiért igazán
 * megéri: a `no-undef` elkapja a modulbontás után kimaradt importokat (a build
 * ezeket nem látja, csak futásidőben derülnek ki), a `react-hooks/*` pedig a
 * hibás vagy hiányos dependency-tömböket.
 */
export default [
  { ignores: ["dist/**", "node_modules/**", ".preview/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "18.3" } },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",   // Vite + új JSX transzformáció
      "react/prop-types": "off",           // nincs PropTypes a projektben
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      /* Az app szándékosan állít állapotot effektben: a betöltő effekt nullázza a
         hibajelzést, az AuthGate pedig felhasználóváltáskor a preflightot és a
         blokkoló jelzőket. Ezek helyesek és szándékosak, ezért itt figyelmeztetés
         — nem az egész lint futást bukó hiba. */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["test/**", "*.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
