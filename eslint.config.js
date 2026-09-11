import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

/*
 * The two rules that actually earn their keep here: `no-undef` catches an import
 * left behind when code moves between modules (the build does not see those, they
 * only surface at runtime), and `react-hooks/*` catches wrong or incomplete
 * dependency arrays.
 */
export default [
  { ignores: ["dist/**", "node_modules/**"] },
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
      "react/react-in-jsx-scope": "off",   // Vite with the modern JSX transform
      "react/prop-types": "off",           // the project does not use PropTypes
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      /* The app sets state inside effects on purpose: the load effect clears the
         error flag, and AuthGate resets the preflight and the blocking flags when the
         user changes. Those are correct and intentional, so this stays a warning
         rather than failing the whole lint run. */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    /* `tools/**` runs under Node, not in the browser: the parity fixture generator reads the
       domain modules and writes files, so it needs the Node globals (ADR-29). */
    files: ["test/**", "tools/**", "*.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
