# Fuvarterv

A training-transport planner for a handball club. A rural Hungarian club shuttles several youth teams to practice by minibus from the surrounding villages — this app manages the whole logistics: weekly training schedule, pickup stops, vehicles, drivers, shuttle runs, and a cost-based **schedule optimizer** that chains transport tasks together using min-cost flow.

The app is a single React file (`fuvarterv.jsx`), originally built as a Claude artifact. The code is written in clearly marked layers so it can be split into real modules mechanically later. **The UI language is Hungarian** (it's built for the club's staff and drivers).

> **⚠️ Privacy:** the built-in sample data (`seedState`) contains a real club's driver names and license plates. **Anonymize the seed before making this repo public**, or keep the repo private.

## Screens

- **Hét (Week)** — all trainings of the week, color-coded by team; every assigned bus per training (license-plate chip, driver, departure time), a yellow badge when no ride is assigned, red when there's a conflict.
- **Beosztás (Schedule)** — daily view of transport tasks (outbound/return): chains per driver, link explanations ("X min deadhead: from → to"), task locking, manual reassignment, and an optimize button with a before/after comparison.
- **Csapatok (Teams)** — team details, station and venue assignment, per-stop headcounts, route mode (auto-ordered / manual, with an optional pinned first stop), training CRUD.
- **Törzsadatok (Master data)** — stations, venues (with map-based coordinate picking), vehicles (plate normalization + uniqueness check), drivers (hourly wage, minimum shift, availability windows).
- **Fuvar (Ride editor)** — per-occurrence ride editing with multiple parallel rides, drag & drop stop ordering, automatic time and stop-order calculation.
- **Sofőr (Driver view)** — mobile-optimized, large-type daily route list with a "NEXT stop" highlight.

## Key features

- **Routing:** Held–Karp dynamic programming finds the optimal stop order (exact up to 10 stops); arrival times are computed backwards from the training start.
- **Deadhead matrix:** a single OSRM `table` API call fetches real road travel times for every point pair; without network access it falls back to a haversine estimate (labeled as such), and it warns when coordinates have changed since the last computation.
- **Optimizer:** compatibility graph → chaining via min-cost flow (gap × average wage − callout fee) → exact (driver, vehicle) assignment via backtracking search → a local-improvement loop on the true cost function (minimum shifts, differing wages). When a task can't be covered, it explains exactly why (capacity / availability / resource contention).
- **Conflict handling:** vehicle and driver conflicts are detected from occupancy windows (a bus is free after its last stop plus the leg to the venue — so one driver can run several waves to the same training without false alarms).
- **Map:** Leaflet + OpenStreetMap, lazy-loaded; Nominatim address search; if the environment blocks tile loading, it switches to a built-in offline SVG map showing your existing points; coordinates can also be pasted manually (Google Maps format, decimal commas accepted).
- **Persistence:** all data is saved to a key-value store (see the shim below).

## Running locally

The app uses the Claude artifact environment's `window.storage` API for persistence — in a regular browser a ~10-line localStorage shim replaces it.

```bash
npm create vite@latest fuvarterv -- --template react
cd fuvarterv
npm i lucide-react
npm i -D tailwindcss @tailwindcss/vite
```

`vite.config.js` — Tailwind v4 plugin:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

`src/index.css`:

```css
@import "tailwindcss";
```

Copy `fuvarterv.jsx` to `src/App.jsx` (it has a default export), then add the storage shim to the top of `src/main.jsx`, **before** the render call:

```js
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      if (value === null) throw new Error("key not found");
      return { key, value };
    },
    async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
    async delete(key) { localStorage.removeItem(key); return { key, deleted: true }; },
    async list(prefix = "") {
      return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)) };
    },
  };
}
```

```bash
npm run dev
```

Build and deploy as usual (`npm run build` → Vercel / Netlify / any static host). When deployed, the full OSM map, the Nominatim search and the OSRM matrix all work — inside the artifact preview these are restricted by CSP, which is what the fallbacks are for.

## Architecture

One file, but with marked layers (the file header documents the same split plan):

| Layer | Contents |
|---|---|
| `data/storage` | persistence (`window.storage`), sample data, migration (`ensureShape`) |
| `domain/logic` | date/time handling (Monday-first weeks, 24h), plate normalization, occurrences, conflicts |
| `domain/optimizer` | task generation, deadhead matrix, Held–Karp, min-cost flow, assignment, diagnostics |
| `ui/base` | Modal, Field, Chip, PlateChip, DangerBtn (two-step delete) … |
| `ui/mapPicker` | Leaflet picker + offline SVG fallback |
| `screens/*` | the six screens |
| `App` | navigation, state, saving |

### Data model (sketch)

- **Team** — name, age group, gender, color, station and venue assignments, per-stop headcounts, route mode.
- **Station / Venue** — name, address, note, coordinates.
- **Vehicle** — name, unique normalized license plate, seat count (excluding driver).
- **Driver** — name, phone, hourly wage, minimum shift, availability windows.
- **Training** — team + venue + weekly days *or* a one-off date + start–end times.
- **Ride** — a run bound to a training occurrence: vehicle + driver + ordered, timed stops (multiple rides may belong to one occurrence).
- **Task** (derived) — an outbound (ODA) and a return (VISSZA) task per training occurrence, with a timetable and headcount; this is what the optimizer works on.
- **Schedule** — per-weekday chains (driver + vehicle + task sequence) with per-task locking.

## External services and their policies

- **OpenStreetMap tiles** — attribution is required (the map includes it).
- **Nominatim** — max ~1 request/sec; only called on explicit user interaction (Enter/button).
- **OSRM demo server** — fine for testing, not for production: self-hosted OSRM is recommended (Docker + a Hungary OSM extract), or a paid traffic-aware API. The demo uses a static speed profile (real routes, no live traffic).

## Known limitations, roadmap

- **Task splitting:** real team sizes (10–14 kids) exceed the 8-seat buses. When a team's headcount is larger than the biggest vehicle, the optimizer now partitions the task across multiple buses **by stop** — each stop's whole headcount goes to one bus, packed into the fewest buses (first-fit-decreasing) that each fit within capacity. Every partition is an independent, parallel run to the same venue with its own optimal route and timetable, and the optimizer assigns a distinct driver+vehicle to each. Splitting only happens when per-stop headcounts are known; a single stop larger than every vehicle (or a team with only a total headcount and no per-stop breakdown) still can't be split and is reported with an exact reason.
- Manual rides and optimized tasks are two parallel layers; syncing them (generating rides from an applied schedule) is planned.
- Sample-data coordinates are accurate to ~100–200 m; two points ("Szeged, Petőfi iskola", "Újszeged Gellért") are explicitly marked for refinement on the map.
- No headcount data exists for the NB2 team in the source documents.
- The weekly schedule is a per-weekday template; chains never cross days.

## License

Not chosen yet — for a public repo MIT is a reasonable default (but see the privacy warning above first).
