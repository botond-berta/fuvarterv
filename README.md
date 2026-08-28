# Fuvarterv

A training-transport planner for a handball club. A rural Hungarian club shuttles several youth teams to practice by minibus from the surrounding villages — this app manages the whole logistics: weekly training schedule, pickup stops, vehicles, drivers, shuttle runs, and a cost-based **schedule optimizer** that chains transport tasks together using min-cost flow.

The app started life as a single React file (`fuvarterv.jsx`) built as a Claude artifact; it is now split into modules under `src/` (see [Architecture](#architecture)). **The UI language is Hungarian** (it's built for the club's staff and drivers).

> **⚠️ Privacy:** the built-in sample data (`seedState`) contains a real club's driver names and license plates. **Anonymize the seed before making this repo public**, or keep the repo private.

## Screens

Four tabs, plus the ride editor which opens from a week-view card.

- **Hét (Week)** — all trainings of the week, color-coded by team; every assigned bus per training (license-plate chip, driver, departure time), a yellow badge when no ride is assigned, red when there's a conflict.
- **Beosztás (Schedule)** — daily view of transport tasks (outbound/return): chains per driver, link explanations ("X min deadhead: from → to"), task locking, manual reassignment, and an optimize button with a before/after comparison.
- **Adatok (Data)** — five categories in one tab. **Csapatok:** team details, station and venue assignment, per-stop headcounts, route mode (auto-ordered / manual, with an optional pinned first stop), training CRUD. **Állomások / Helyszínek:** with map-based coordinate picking — the coordinate is mandatory, so a station or venue cannot be saved without one. **Járművek:** plate normalization + uniqueness check. **Sofőrök:** hourly wage, minimum shift, availability windows, preferred vehicle.
- **Sofőr (Driver view)** — mobile-optimized, large-type daily route list with a "NEXT stop" highlight that advances every minute.
- **Fuvar (Ride editor)** — per-occurrence ride editing: direction (outbound/return), multiple parallel rides, drag & drop stop ordering, automatic time and stop-order calculation.

## Key features

- **Routing:** Held–Karp dynamic programming finds the optimal stop order (exact up to 10 stops); arrival times are computed backwards from the training start.
- **Deadhead matrix:** a single OSRM `table` API call fetches real road travel times for every point pair; without network access it falls back to a haversine estimate (labeled as such), and it warns when coordinates have changed since the last computation.
- **Optimizer:** compatibility graph → chaining via min-cost flow (gap × average wage − callout fee) → exact (driver, vehicle) assignment via backtracking search → a local-improvement loop on the true cost function (minimum shifts, differing wages). When a task can't be covered, it explains exactly why (capacity / availability / resource contention).
- **Conflict handling:** vehicle and driver conflicts are detected from occupancy windows (a bus is free after its last stop plus the leg to the venue — so one driver can run several waves to the same training without false alarms).
- **Map:** Leaflet + OpenStreetMap, lazy-loaded; Nominatim address search; if the environment blocks tile loading, it switches to a built-in offline SVG map showing your existing points; coordinates can also be pasted manually (Google Maps format, decimal commas accepted).
- **Persistence:** all data is saved to a **Supabase** table as a single JSON blob, behind an email + password login. In the Claude artifact preview the app still uses the sandbox's `window.storage`; the committed Vite project swaps in a Supabase-backed implementation of the same key-value contract (`src/supabaseStorage.js`).
- **Roles:** two kinds of user — **admin** (full access) and **driver** (sees only the read-only Sofőr tab, opened on their own day plan via the e-mail set on their driver entry). Roles are assigned by e-mail under **Adatok → Felhasználók**; the restriction is enforced server-side by RLS (`0004_user_roles.sql`), not just hidden in the UI. A user with no role row is a driver.

## Supabase setup (one time)

1. Create a Supabase project; from **Settings → API** copy the **Project URL** and the **publishable** (anon) key.
2. In the **SQL editor**, run **all six** migrations in order:
   - [`0001_app_state.sql`](supabase/migrations/0001_app_state.sql) — the `app_state` table and its RLS policies.
   - [`0002_app_state_history.sql`](supabase/migrations/0002_app_state_history.sql) — the snapshot history behind the **Korábbi mentések** panel. **Skipping this leaves the restore feature silently non-functional:** the button is still there, the panel still opens, and it will always say there are no snapshots. History writes fail quietly by design (they must never fail a save), so nothing else tells you.
   - [`0003_tighten_rls.sql`](supabase/migrations/0003_tighten_rls.sql) — restricts writes to the one workspace row, makes the history append-only, and moves `updated_at` onto the server clock.
   - [`0004_user_roles.sql`](supabase/migrations/0004_user_roles.sql) — admin/driver roles. From here on only **admins** can change data; everyone else is a **driver** who sees the Sofőr tab read-only.
   - [`0005_rename_workspace_key.sql`](supabase/migrations/0005_rename_workspace_key.sql) — history: renamed the workspace key `fuvarterv:v1` → `vector:v1` while the app was called Vector. Kept as-is because it is what live databases actually ran; a no-op on a database you are creating now.
   - [`0006_rename_workspace_key_back.sql`](supabase/migrations/0006_rename_workspace_key_back.sql) — renames the key back, `vector:v1` → `fuvarterv:v1`, after the return to the name Fuvarterv. **Required** — it is the only migration that scopes the write policies to the key the client actually sends, so skipping it leaves the app loading an empty workspace with every save refused.
3. **Make yourself the first admin** — run this once in the SQL editor with your own address (details in [`supabase/migrations/README.md`](supabase/migrations/README.md)):
   ```sql
   insert into public.user_roles (email, role)
   values (lower('you@example.com'), 'admin')
   on conflict (email) do update set role = 'admin';
   ```
   Further roles are managed inside the app under **Adatok → Felhasználók**.
4. **Turn off public sign-up — this is the security boundary, not an optional hardening step.** Under **Authentication → Providers → Email**, switch **Enable sign-ups** OFF. The anon key is public by design (it ships in the JS bundle) and every policy grants read access to any *authenticated* user, so while sign-ups are open anyone who reads the key out of the bundle can register and read your data.
5. **Create your login(s):** add each staff member under **Authentication → Users → Add user**, set a password, and enable **Auto Confirm User**. No emails are sent. Give each person a role under **Adatok → Felhasználók** (no row = driver); for drivers, also set the same e-mail on their entry under **Adatok → Sofőrök** so the Sofőr tab opens on their own day plan.

## Running locally

The project is a normal committed Vite app; the app source is `fuvarterv.jsx` at the repo root (imported by `src/main.jsx`). `src/AuthGate.jsx` renders the login screen and installs the Supabase-backed `window.storage`.

```bash
cp .env.example .env      # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
./run-local.sh            # bootstraps Node if needed, npm install, npm run dev
# or, if you already have Node 20+:
npm install && npm run dev
```

Open http://localhost:5173, sign in with a user you created in step 5 above, and you're in. The first save seeds the shared workspace from `seedState()`.

## Deploy (Vercel)

Before the first deploy, make sure the database is ready: run **all six** migrations in
order and turn off public sign-up (see [Supabase setup](#supabase-setup-one-time) and
[`supabase/migrations/README.md`](supabase/migrations/README.md), which includes a
read-only query telling you which migrations are still outstanding).

1. Import the repo into Vercel — the **Vite** preset is auto-detected (build `npm run build`, output `dist`). Node comes from `engines` in `package.json`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings → Environment Variables**, ticking **Production *and* Preview**. Both are browser-safe; RLS protects the data.

   > Vite inlines these **at build time**. If you add them after a deployment has already
   > been built, that build will not pick them up — redeploy. A build without them still
   > succeeds; the app just shows the "missing configuration" screen.
3. Push a branch for a preview deployment, verify it, then merge to `main` for production.

`vercel.json` adds the SPA catch-all rewrite (so deep links and refreshes resolve to the
app) and a set of security headers.

### About the Content-Security-Policy

The policy in `vercel.json` allows exactly the origins this app actually uses — Supabase,
the OSRM matrix, Nominatim, OSM tiles, Leaflet from cdnjs, and Google Fonts. If you add a
new external service, it needs a matching directive or the browser will silently block it.

It deliberately has **no `'unsafe-inline'`**: the production `index.html` contains no
inline script or style, and React and Leaflet set styles through the CSSOM, which CSP does
not govern. This was verified by serving the built app with these exact headers and
clicking through every screen — zero violations.

One caveat worth knowing when you check a preview deployment: that verification ran in a
sandbox where `cdnjs.cloudflare.com` and `tile.openstreetmap.org` were unreachable, so the
Leaflet path fell back to the built-in offline map and was never exercised under the
policy. **Open the map picker on the preview and check the browser console.** If Leaflet
turns out to need it, adding `'unsafe-inline'` back to `style-src` is a one-line fix.

When deployed, the full OSM map, the Nominatim search and the OSRM matrix all work — inside
the artifact preview these are restricted by CSP, which is what the fallbacks are for.

## Architecture

Real modules, with the dependencies flowing one way (`screens → ui → domain → data`).
`fuvarterv.jsx` is now just a barrel re-exporting `src/App.jsx` plus the pure
functions the tests import.

| Module | Contents |
|---|---|
| `src/data/storage.js` | persistence seam (`window.storage`) + `DEFAULT_SETTINGS` |
| `src/data/seed.js` | sample data + `ensureShape` (shape migration) |
| `src/domain/constants.js` | days, months, `uid`, `byId` |
| `src/domain/datetime.js` | Monday-first weeks, 24h times |
| `src/domain/geo.js` | coordinates, haversine, deadhead matrix |
| `src/domain/logic.js` | plate normalization, occurrences, ride windows, conflicts, delete guards |
| `src/domain/optimizer.js` | task generation, Held–Karp, min-cost flow, assignment, diagnostics |
| `src/ui/` | `styles.css`, `base.jsx`, `OccCard.jsx`, `MapPicker.jsx`, `format.js` |
| `src/screens/` | Week, Schedule, Data (Teams + master data), Ride editor, Driver |
| `src/App.jsx` | navigation, state, debounced saving |

`src/domain/geo.js` is a leaf on purpose: both `logic` (`rideWindow`) and
`optimizer` (`genDayTasks`) need `legMin`, so keeping it in either would make the
two modules circular.

### Data model (sketch)

- **Team** — name, age group, gender, color, station and venue assignments, per-stop headcounts, route mode. The **return leg can have its own stop list and headcounts** (`returnStationIds`); left unset, it mirrors the outbound in reverse, as before.
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
- **Schedule → rides sync (done):** applying an optimizer proposal (or the **Fuvarok generálása a beosztásból** button on the Beosztás screen) now materializes the schedule chains into real `rides` — one ride per task, both ODA and VISSZA, direction stored on the ride (`dir`) and tagged `source: "schedule"`. Generated rides show up in the Hét and Sofőr views (return rides render venue→stops, outbound stops→venue) and feed conflict detection. Generation replaces every ride of the day's affected trainings (schedule becomes the single source), so manual edits to a generated ride are overwritten on the next regeneration.
- Sample-data coordinates are accurate to ~100–200 m; two points ("Szeged, Petőfi iskola", "Újszeged Gellért") are explicitly marked for refinement on the map.
- No headcount data exists for the NB2 team in the source documents.
- The weekly schedule is a per-weekday template; chains never cross days.

## License

Not chosen yet — for a public repo MIT is a reasonable default (but see the privacy warning above first).
