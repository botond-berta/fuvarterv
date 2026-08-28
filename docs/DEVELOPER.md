# Fuvarterv — Developer Documentation

This is a deep, plain-language guide to how the **Fuvarterv** app is built, for anyone
who needs to read, change, or extend the code. It assumes you know JavaScript and
React, but it does **not** assume you know anything about this project.

The app plans minibus transport for a rural Hungarian handball club: it shuttles
several youth teams to training from surrounding villages, and it works out which
bus and which driver does which run, at what time, for the lowest cost.

> **Language note.** The **user interface is Hungarian**. The **code, comments in
> this document, and identifiers are a mix** — variable names are English-ish,
> but many domain words are Hungarian. A glossary at the end maps the Hungarian
> words to English so the code reads clearly.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Technology stack](#2-technology-stack)
3. [Repository layout — every file](#3-repository-layout--every-file)
4. [How the app starts up (boot sequence)](#4-how-the-app-starts-up-boot-sequence)
5. [Login and sessions (authentication)](#5-login-and-sessions-authentication)
6. [Persistence — how data is saved](#6-persistence--how-data-is-saved)
7. [The data model (the single JSON blob)](#7-the-data-model-the-single-json-blob)
8. [Migrations and seeding](#8-migrations-and-seeding)
9. [Domain logic — dates, times, plates, conflicts](#9-domain-logic--dates-times-plates-conflicts)
10. [The optimizer, step by step](#10-the-optimizer-step-by-step)
11. [Schedule ↔ rides: how they connect](#11-schedule--rides-how-they-connect)
12. [The user interface](#12-the-user-interface)
13. [The map and external services](#13-the-map-and-external-services)
14. [Settings reference](#14-settings-reference)
15. [Build, run, and deploy](#15-build-run-and-deploy)
16. [Environment variables](#16-environment-variables)
17. [Known limitations and gotchas](#17-known-limitations-and-gotchas)
18. [How to extend the app](#18-how-to-extend-the-app)
19. [Tests](#19-tests)
20. [Glossary (Hungarian ↔ English)](#20-glossary-hungarian--english)

---

## 1. The big picture

The app has an unusual shape you must understand before anything else:

**Almost the entire application lives in one file: `fuvarterv.jsx`** (about 2,800
lines). It was originally built as a "Claude artifact" — a self-contained React
component that runs in a sandbox. The file is deliberately kept as a single,
portable unit. It is organized into clearly labelled layers (data, domain logic,
optimizer, UI base, screens, App) so it *could* be split into real modules later,
but today it is one file.

Around that one file sits a small **committed Vite project** (in `src/`, plus
config files at the repo root). This wrapper does three jobs:

1. It builds and serves `fuvarterv.jsx` for local development and for production.
2. It adds a **login screen** in front of the app.
3. It swaps the app's storage from a browser sandbox store to a **Supabase**
   database, so data is durable and shared across devices.

The key design rule:

> **`fuvarterv.jsx` never imports Supabase, auth, or anything about hosting.**
> It only ever talks to a global object called `window.storage`. The wrapper
> installs a Supabase-backed `window.storage` before the app mounts. This keeps
> the big file portable — you could drop it back into the artifact sandbox and it
> would still work.

So there are two "sides":

| Side | Files | Knows about |
|------|-------|-------------|
| **The app** | `fuvarterv.jsx` | Teams, buses, drivers, routes, the optimizer, the UI. Talks only to `window.storage`. |
| **The wrapper** | `src/*`, config files | Supabase, login, build, deploy. Provides `window.storage`. |

---

## 2. Technology stack

- **React 18** — UI library. Function components and hooks only (`useState`,
  `useEffect`, `useMemo`, `useRef`). No Redux, no router library.
- **Vite 6** — dev server and production bundler.
- **Tailwind CSS v4** (via the `@tailwindcss/vite` plugin) — used lightly. Most
  styling is a hand-written CSS string embedded inside `fuvarterv.jsx` (see
  [§12](#12-the-user-interface)).
- **lucide-react** — icon set.
- **@supabase/supabase-js v2** — client for the Supabase backend (database + auth).
- **Leaflet + OpenStreetMap** — map, lazy-loaded only when the map picker opens.
- **External HTTP services** — OSRM (road travel times), Nominatim (address
  search). Both have offline fallbacks. See [§13](#13-the-map-and-external-services).

Tests run on **vitest** in a jsdom environment (`npm test`); linting is ESLint
flat config (`npm run lint`). See [§19](#19-tests).

---

## 3. Repository layout — every file

```
.
├── fuvarterv.jsx                ← barrel only (~40 lines): re-exports src/App.jsx
│                               and the pure functions the tests import
├── index.html                ← HTML entry; loads /src/main.jsx + the Nunito font
├── package.json              ← deps + scripts (dev / build / preview / test / lint)
├── vite.config.js            ← Vite config (React + Tailwind) and the vitest block
├── eslint.config.js          ← flat ESLint config (react + react-hooks)
├── vercel.json               ← SPA rewrite for Vercel hosting
├── run-local.sh              ← one-command local setup (installs Node if needed)
├── .env.example              ← template for the two required env vars
├── .env                      ← your real Supabase keys (git-ignored)
├── README.md                 ← short overview + setup steps
├── docs/DEVELOPER.md         ← this document
├── test/                     ← vitest suites (see §20)
│   ├── domain.test.js        ← plates, times, routing, ride windows
│   ├── optimizer.test.js     ← property tests over 100 generated states
│   ├── fixes.test.js         ← regressions for the fixed defects
│   ├── smoke.test.jsx        ← mounts <App/> and walks every tab
│   ├── load-error.test.js    ← NOT_FOUND vs. a real read failure
│   ├── settings.test.js      ← DEFAULT_SETTINGS is the single source
│   └── setup.js              ← IS_REACT_ACT_ENVIRONMENT for the smoke test
├── src/
│   ├── main.jsx              ← React entry; renders <AuthGate><App/></AuthGate>
│   ├── index.css             ← just: @import "tailwindcss";
│   ├── App.jsx               ← navigation, state, debounced saving
│   ├── AuthGate.jsx          ← login, session, stale/save-error UI, error boundary
│   ├── ErrorBoundary.jsx     ← keeps a screen crash from white-screening the app
│   ├── RestorePanel.jsx      ← the "Korábbi mentések" snapshot list
│   ├── theme.css             ← the --v-* design tokens (incl. dark mode)
│   ├── supabaseClient.js     ← creates the Supabase client from env vars
│   ├── supabaseStorage.js    ← implements window.storage on top of Supabase
│   ├── data/
│   │   ├── storage.js        ← window.storage seam + DEFAULT_SETTINGS
│   │   └── seed.js           ← seedState + ensureShape
│   ├── domain/               ← pure, React-free, directly unit-testable
│   │   ├── constants.js      ← DAYS / MONTHS / uid / byId
│   │   ├── datetime.js       ← Monday-first weeks, 24h times
│   │   ├── geo.js            ← coordinates, haversine, deadhead matrix
│   │   ├── logic.js          ← plates, occurrences, ride windows, conflicts
│   │   └── optimizer.js      ← tasks, routing, chaining, assignment
│   ├── ui/
│   │   ├── styles.css        ← the app stylesheet (tokens alias theme.css)
│   │   ├── base.jsx          ← Field, NumField, Modal, DangerBtn, …
│   │   ├── OccCard.jsx       ← one training occurrence (week + ride picker)
│   │   ├── MapPicker.jsx     ← Leaflet picker + offline SVG fallback
│   │   └── format.js         ← Ft / hour formatters
│   └── screens/              ← WeekScreen, TeamsScreen, MasterScreen,
│                               RideScreen, ScheduleScreen, DriverScreen, DataScreen
└── supabase/migrations/
    ├── 0001_app_state.sql        ← the app_state table + RLS policies
    ├── 0002_app_state_history.sql← snapshot history behind the restore panel
    ├── 0003_tighten_rls.sql      ← scoped writes, append-only history, server clock
    ├── 0004_user_roles.sql       ← admin/driver roles; writes become admin-only
    ├── 0005_rename_workspace_key.sql
    │                             ← history: 'fuvarterv:v1' → 'vector:v1'
    └── 0006_rename_workspace_key_back.sql
                                  ← 'vector:v1' → 'fuvarterv:v1' — today's key
```

**Dependency direction.** `screens → ui → domain → data`, and inside `domain`
it is `optimizer → logic → geo → datetime → constants`. Nothing points back.
`geo.js` exists precisely to keep that true: `rideWindow` (logic) and
`genDayTasks` (optimizer) both need `legMin`, so leaving it in either module
would make the two circular.

### What each wrapper file does (short version)

- **`index.html`** — `lang="hu"`, a `<div id="root">`, and a script tag for
  `/src/main.jsx`. Nothing else.
- **`src/main.jsx`** — imports `App` from `../fuvarterv.jsx` (Vite can import a file
  from outside `src/`), wraps it in `AuthGate`, and renders it into `#root`.
- **`src/supabaseClient.js`** — reads the two `VITE_SUPABASE_*` env vars, and
  exports a Supabase client (or `null` if the vars are missing, so the app can show
  a helpful message instead of a blank screen). Also exports
  `WORKSPACE_ID = "fuvarterv:v1"` — the single database row everyone shares.
- **`src/supabaseStorage.js`** — the bridge. Implements the `window.storage`
  contract (`get` / `set` / `delete` / `list`) using the Supabase database. This is
  where the whole app state is saved and loaded. Details in [§6](#6-persistence--how-data-is-saved).
- **`src/AuthGate.jsx`** — shows the login screen when nobody is signed in;
  once signed in, checks the database is reachable, then renders the app. Also
  shows the stale overlay (data changed elsewhere) and the save-failed toast, hosts
  the restore panel, and wraps the app in an error boundary.

---

## 4. How the app starts up (boot sequence)

Follow the chain of events from page load to a working app:

1. **The browser loads `index.html`**, which loads `src/main.jsx`.
2. **`main.jsx` runs.** It imports `AuthGate` and `App`, and renders
   `<React.StrictMode><AuthGate><App/></AuthGate></React.StrictMode>`.
3. **Importing `AuthGate.jsx` has a side effect:** at the top of the file, it does
   `window.storage = supabaseStorage`. This happens at import time — **before any
   component renders** — so `window.storage` is guaranteed to exist before the app
   ever tries to use it.
4. **`AuthGate` renders and decides what to show**, in this order:
   - If Supabase env vars are missing → a "configuration missing" screen.
   - While it checks for an existing login session → "Betöltés…" (Loading).
   - If nobody is logged in → the **login screen**.
   - Once logged in, it does a **pre-flight read** of the database. If that read
     fails (network/permissions) → a retry screen. If it succeeds → it renders the
     app (`children`).
5. **`App` (inside `fuvarterv.jsx`) mounts.** Its first `useEffect` calls
   `loadState()`, which reads the saved blob through `window.storage.get(...)`. If
   there is saved data, it loads it; if not, it seeds sample data. From here the app
   is running normally.

The important idea: **the app only mounts after a valid login and a successful
database read.** That ordering prevents two classes of bug (unauthenticated
requests, and mistaking a temporary read failure for "no data").

---

## 5. Login and sessions (authentication)

Authentication is handled entirely by Supabase Auth in `src/AuthGate.jsx`. The model
is deliberately simple:

- **One shared workspace, individual logins.** Every user logs in with their own
  **email + password**, but they all read and write the *same* data (one database
  row). There is no per-user data.
- **No public sign-up.** You cannot create an account from the app. An admin
  creates users in the Supabase dashboard (Authentication → Users → Add user, with
  "Auto Confirm User" enabled so no confirmation email is sent). This is why login
  is email+password and not magic-link: it avoids Supabase's email rate limits.

How the code handles it:

- On mount, `AuthGate` calls `supabase.auth.getSession()` to see if the user is
  already logged in (Supabase stores the session in the browser and refreshes the
  token automatically).
- It subscribes to `supabase.auth.onAuthStateChange(...)` so that logging in or out
  updates the UI immediately.
- The **login form** calls `supabase.auth.signInWithPassword({ email, password })`.
  On success, the auth-state listener fires and the app appears. On failure it shows
  "Hibás e-mail vagy jelszó." (Wrong email or password.)
- The **sign-out button** (top-right, "Kijelentkezés") calls
  `supabase.auth.signOut()`.

Access to the data is protected on the server by **Row Level Security** (see
[§6](#6-persistence--how-data-is-saved)), so being logged in is what grants access —
not anything in the browser code.

---

## 6. Persistence — how data is saved

This is the heart of the wrapper. Read it carefully.

### 6.1 The `window.storage` contract

`fuvarterv.jsx` treats persistence as a tiny key-value store on `window.storage`
with four async methods:

```js
window.storage.get(key)          // → { key, value } ; throws if the key doesn't exist
window.storage.set(key, value)   // value is a STRING (already JSON.stringified)
window.storage.delete(key)       // → { key, deleted: true }
window.storage.list(prefix)      // → { keys: [...] }
```

The app uses only **one key**: `STORAGE_KEY = "fuvarterv:v1"`. (It was
`"vector:v1"` while the app was called Vector;
`supabase/migrations/0006_rename_workspace_key_back.sql` moves an existing install's
rows and RLS policies back onto this key, and is required even on a fresh
database — see that directory's README.) The *entire*
application state is one JSON object, turned into a string with `JSON.stringify`
before `set`, and parsed with `JSON.parse` after `get`. In the app:

```js
// Swallowing the error here would seed sample data over real data the app
// merely failed to read, so loadState rethrows and the caller uses isNotFound
// to tell "empty workspace" apart from "the read failed".
async function loadState() {
  const r = await window.storage.get(STORAGE_KEY);
  return r && r.value ? JSON.parse(r.value) : null;
}

async function persistState(state) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error("Mentési hiba:", e); }
}
```

Saving is **debounced**: whenever the state changes, the app waits 300 ms and then
saves once. Rapid edits collapse into a single save.

### 6.2 The Supabase table

The whole state is stored as **one row** in one table (`supabase/migrations/0001_app_state.sql`):

```sql
create table public.app_state (
  id         text primary key,   -- the workspace key, e.g. 'fuvarterv:v1'
  data       jsonb not null,     -- the entire app state as JSON
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "authenticated read"  on public.app_state
  for select to authenticated using (true);
create policy "authenticated write" on public.app_state
  for all    to authenticated using (true) with check (true);
```

- **`jsonb`** stores the whole blob. We don't have per-entity tables; the app's own
  code manages the shape.
- **Row Level Security (RLS)** means: only logged-in ("authenticated") users can
  read or write, and they can read/write the whole table. Anonymous visitors get
  nothing. This is the real security boundary.
- **`updated_at`** powers the stale-write guard (below).

### 6.3 `supabaseStorage.js` — the implementation

This file maps the four `window.storage` methods onto the table. The two that matter
are `get` and `set`.

**`get(key)`**
- Selects `data, updated_at` from `app_state` where `id = key`.
- If **no row** exists, it **throws `"key not found"`**. This is intentional — it
  tells `loadState` "there's no saved data yet", so the app seeds sample data. A
  fresh workspace and a missing key look the same, which is correct.
- If a row exists, it remembers `updated_at` in a module-level `Map` called
  `lastSeen`, and returns the data as a JSON string.

**`set(key, value)`** — this is where the safety logic lives.

1. **Write serialization.** `set` does not run immediately. It chains onto a
   module-level promise (`writeChain`) so that **only one save runs at a time**.
   Why: the app debounces saves, but a slow network round-trip could still let two
   saves overlap. If they overlapped, the second one would check an out-of-date
   `updated_at` and wrongly think someone else edited the data. Chaining removes that
   race. The chain is written so that a failed save never permanently blocks later
   saves.

2. **First save on a fresh workspace → INSERT.** If we have never read a row
   (`lastSeen` has no entry for this key), we `insert` a new row. If the insert hits
   a unique-key violation (`23505`), it means another editor created the row first;
   we treat that as a "stale" conflict and do **not** overwrite it.

3. **Later saves → guarded UPDATE (the stale-write guard).** We update the row
   **only if `updated_at` still equals what we last read**:
   ```
   update app_state set data = ..., updated_at = now-ish
   where id = key and updated_at = <the value we last saw>
   ```
   - If the update touches a row, all good — we store the new `updated_at`.
   - If it touches **zero rows**, it means someone else saved since we loaded. We do
     **not** overwrite their change. Instead we fire a `fuvarterv:stale`
     browser event (the UI shows a blocking overlay asking the user to reload), and we
     keep failing future saves until they reload. This is the "single editor at a
     time" safety model.

4. **Reporting real failures.** If the database returns a genuine error (network
   down, permission denied), `set` fires a `fuvarterv:saveerror` event so the UI can
   show a red "save failed" banner. Stale conflicts and real failures are kept
   distinct — a stale conflict is *not* reported as a save error.

### 6.4 How the UI reacts (`AuthGate.jsx`)

`AuthGate` listens for those two events. They are deliberately *asymmetric*, because
the consequences are:

- `fuvarterv:stale` → a **blocking overlay**. Once the row has moved on, no save can
  succeed, so continuing to edit would silently lose work; the only safe action is a
  reload. Before blocking, `doSet` re-reads the row: if the server already holds what
  we last tried to write, that was our own committed write with a lost response, so it
  adopts the new timestamp and retries instead of blocking.
  ("The data changed elsewhere") with a **Reload** button.
- `fuvarterv:saveerror` → red banner: "A mentés nem sikerült…" ("Save failed"),
  dismissible. Only one banner shows at a time (stale takes priority).

It also does the **pre-flight read** described in [§4](#4-how-the-app-starts-up-boot-sequence):
after login, before mounting the app, it does one test read of the workspace row.
If that fails it shows a retry screen. This stops a temporary read failure from
looking like an empty workspace (which would make the app show sample data over the
user's real data — very alarming even though the real data is safe on the server).

### 6.5 Summary of the save/load flow

```
Edit in UI
  → setState(...)                       (fuvarterv.jsx)
  → 300 ms debounce
  → persistState(state)
  → window.storage.set(KEY, JSON)       (== supabaseStorage.set)
  → queued behind any in-flight save
  → INSERT (first time) or guarded UPDATE on updated_at
      → success: remember new updated_at
      → 0 rows: re-read; if unchanged from our last attempt, adopt + retry,
                otherwise fire "fuvarterv:stale" → blocking overlay
      → db error: fire "fuvarterv:saveerror" → red banner
```

---

## 7. The data model (the single JSON blob)

The whole app state is one plain object. Its top-level keys:

```js
{
  teams:       [ ... ],   // the youth teams
  stations:    [ ... ],   // pickup points (villages/stops)
  venues:      [ ... ],   // training locations (gyms)
  vehicles:    [ ... ],   // the minibuses
  drivers:     [ ... ],   // the drivers
  trainings:   [ ... ],   // when/where each team trains
  rides:       [ ... ],   // concrete bus runs bound to a training occurrence
  assignments: { ... },   // the saved schedule (per weekday: chains of tasks)
  matrix:      { ... }|null, // cached road travel-time matrix
  settings:    { ... },   // tunable numbers
}
```

Every entity has a string `id`. IDs are generated by `uid()` (8 random base-36
characters); seed data uses readable IDs like `jPAK543` (vehicle) or `dSIP`
(driver). Look-ups use the helper `byId(array, id)`.

### Entity shapes

**Team** (`teams[]`)
```js
{
  id, name, age, gender, color,          // gender: lány/fiú/női/férfi/vegyes
  stationIds: [id, ...],                 // which pickup points this team uses
  venueIds:   [id, ...],                 // which gyms this team can train at
  passengerCount: number|null,           // total headcount (fallback)
  stationCounts: { stationId: number },  // per-stop headcount (preferred)
  routeMode: "auto" | "manual",          // how stop order is decided (both directions)
  routeAnchorId: id|null,                // optional forced first stop, outbound (auto mode)

  // The return leg may drop children somewhere other than where it collected them.
  returnStationIds: [id, ...] | null,    // null = mirror the outbound (the default)
  returnStationCounts: { stationId: number },
  returnRouteAnchorId: id|null,          // optional forced LAST stop, return (auto mode)
}
```

`returnStationIds === null` is the pre-feature behaviour and the default: the return
visits the outbound stops in reverse. An array — including an empty one — means the
return has a list of its own. **Never read these fields directly**: use
`teamLeg(team, dir)` from `src/domain/logic.js`, which is the single place that
decides between the two and returns `{ stationIds, stationCounts, routeAnchorId,
isOverride }` for the direction you ask for.

**Station** (`stations[]`) — a pickup point.
```js
{ id, name, address, note, lat: number|null, lon: number|null }
```

`lat`/`lon` are **mandatory in the editor**: `MasterForm` refuses to save a station
or venue without a coordinate, so new records always carry one. The type stays
nullable because records saved before this rule (and `ensureShape`, which fills
missing keys with `null`) can still be coordinate-less — those show a warning icon
in the master list and must be given a coordinate the next time they are edited.
Reading code must therefore keep its null checks (`legMin`, `computeMatrix`,
`defaultMapCenter` all still guard).

**Venue** (`venues[]`) — a training location. Same shape as a station.

**Vehicle** (`vehicles[]`) — a minibus.
```js
{ id, name, plate, seats, note }         // plate is normalized; seats excludes the driver
```

**Driver** (`drivers[]`)
```js
{
  id, name, phone, note,
  wage: number,                          // Ft per hour
  minShiftMin: number,                   // minimum paid shift length in minutes
  availability: [                        // empty array = available any time
    { days: [weekdayIdx, ...], start: "HH:MM", end: "HH:MM" }
  ],
  preferredVehicleId: id|null,           // the driver's usual bus (soft preference)
}
```

**Training** (`trainings[]`) — when a team trains.
```js
{
  id, teamId, venueId,
  type: "weekly" | "once",
  days: [weekdayIdx, ...],               // for "weekly"
  date: "YYYY-MM-DD" | null,             // for "once"
  start: "HH:MM", end: "HH:MM",
}
```

**Ride** (`rides[]`) — a concrete bus run for one training occurrence. Several rides
can belong to one occurrence (several buses carrying one team).
```js
{
  id, trainingId,
  day: weekdayIdx | null,                // which weekday (for weekly trainings)
  date: "YYYY-MM-DD" | null,             // for one-off trainings
  vehicleId, driverId,
  dir: "oda" | "vissza",                 // outbound or return
  source: "schedule" | undefined,        // "schedule" = generated from the optimizer
  stops: [ { id, stationId, time: "HH:MM", count: number|"" } ],
}
```

**Assignments** (`assignments`) — the saved schedule, keyed by weekday index (0–6):
```js
{
  [weekdayIdx]: {
    chains: [
      {
        id, driverId, vehicleId,
        taskIds: [ { id: taskId, locked: boolean } ],
      }
    ]
  }
}
```
A **chain** is one driver+bus doing a sequence of tasks back-to-back. `taskIds`
references derived tasks (see [§10](#10-the-optimizer-step-by-step)). `locked: true`
means "don't let the optimizer move this task."

**Matrix** (`matrix`) — cached point-to-point travel times.
```js
{
  key: string,                           // fingerprint of all coordinates
  source: "osrm" | "estimate",           // real roads vs straight-line estimate
  durations: { "fromId|toId": minutes }, // one entry per ordered pair
  computedAt: ISO string, n: number,
}
```
When the coordinates change, `matrix.key` no longer matches `matrixKey(state)`, and
the UI warns that the matrix is stale.

**Settings** (`settings`) — see [§14](#14-settings-reference).

---

## 8. Migrations and seeding

There is no database schema for the blob's *contents* — the app manages shape in
code. Two functions handle this:

**`seedState()`** returns a full sample dataset: the real club's teams, stations,
venues, buses, drivers, trainings, and a set of Thursday rides. This is used the
first time the app runs (no saved data) and when the user clicks "Mintaadatok
visszaállítása" (Reset sample data).

> ⚠️ **Privacy:** the seed contains real driver names and license plates. Anonymize
> it before making the repo public, or keep the repo private.

**`ensureShape(s)`** is a lightweight "migration". Every time state is loaded, it is
passed through `ensureShape`, which fills in any missing fields with defaults. This
lets old saved data gain new fields without breaking. For example, it guarantees
every driver has `wage`, `minShiftMin`, `availability`, and `preferredVehicleId`,
and it guarantees `settings` has every key (including newer ones like
`preferredBias`).

The App load effect combines them:

```js
const s = await loadState();                 // saved data or null
setState(ensureShape(s || seedState()));     // seed if empty, then normalize
```

**When you add a new field to an entity or setting, add its default to
`ensureShape` too** — otherwise old saved data will have `undefined` where the new
field should be. This is the single most important rule for evolving the data model
safely.

---

## 9. Domain logic — dates, times, plates, conflicts

All of this is pure, framework-free JavaScript in the "domain" layer of
`fuvarterv.jsx`. No React, no I/O.

### 9.1 Dates and weeks

The app thinks in **Monday-first weeks** and **weekday indices 0–6 = Mon–Sun**.

- `weekdayIdx(date)` → `(date.getDay() + 6) % 7` — converts JS's Sunday-first day
  into Monday-first.
- `mondayOf(date)` → the Monday of that date's week (midnight).
- `toISO(date)` / `parseISO("YYYY-MM-DD")` — convert to/from a local date string.
  These use local time on purpose (no timezone surprises for a single-region app).
- `addDays`, `fmtDate`, `fmtWeekRange`, etc. — display helpers in Hungarian.

### 9.2 Times

Times are `"HH:MM"` strings in the data, but all math is done in **minutes since
midnight**:

- `timeToMin("16:30")` → `990`
- `minToTime(990)` → `"16:30"` (clamped to a valid 00:00–23:59 range)

### 9.3 License plates

- `normalizePlate(raw)` — uppercases, strips everything except A–Z and 0–9, then
  inserts one hyphen at the letters→digits boundary. So `abc123`, `ABC 123`, and
  `abc-123` all become `ABC-123`. It is idempotent. Mixed strings that don't fit the
  "letters then digits" pattern are returned uppercased without a hyphen.
- `plateExists(state, plate, exceptId)` — case/format-insensitive duplicate check
  used by the vehicle editor.

Important: the **plate is a display label only**. Vehicle identity everywhere in the
code is the `id`, never the plate. A duplicate or odd plate cannot break scheduling.

### 9.4 Occurrences

- `weekOccurrences(state, monday)` — expands trainings into concrete occurrences for
  a given week. A weekly training on `days: [1,3]` produces two occurrences
  (Tue, Thu); a one-off training produces one occurrence if its date falls in the
  week. Each occurrence is `{ training, dayIdx, dateISO }`.
- `findRides(state, training, dayIdx)` — the rides attached to a specific occurrence.

### 9.5 Ride time windows and conflicts

To detect clashes, each ride is reduced to a **time window** it occupies:

- `rideWindow(state, ride, training)`:
  - **Outbound (oda):** from the first stop's departure to (last stop + travel time
    to the venue). This clever end-point means a bus that finishes dropping kids and
    reaches the gym is then "free", so one driver can run several waves to the same
    training without a false conflict.
  - **Return (vissza):** from the venue departure (training end + `departAfterMin`)
    to the last stop's arrival.
- `findConflicts(state, candidateRide)` — compares a ride against all others on the
  same day. If their windows overlap **and** they share a `vehicleId` → a vehicle
  conflict; if they share a `driverId` → a driver conflict. Returns a list. The UI
  shows a red "ÜTKÖZÉS" (conflict) badge when this is non-empty.

### 9.6 Delete protection

`deleteGuard(state, kind, id)` returns a Hungarian "in use" message (or `null` if
safe to delete). E.g. you can't quietly delete a station that teams or rides still
reference. The UI uses this to warn before deletion.

---

## 10. The optimizer, step by step

This is the most complex part. Its job: given a weekday, produce the cheapest set of
driver+bus **chains** that cover every transport task, and explain anything it can't
cover. The entry point is `optimizeDay(state, weekday, weekMon)`.

Think of it as a pipeline. Here is each stage in plain terms.

### 10.1 Generate the day's tasks — `genDayTasks`

For each training occurrence on that weekday, the app creates two **tasks**: one
**ODA** (outbound: villages → gym) and one **VISSZA** (return: gym → villages). A
task carries:
- a passenger count (`pax`),
- a **planned timetable** (`plan`: which stop at which minute),
- a `from` and `to` point,
- a `start` and `end` time (in minutes).

**Timing is computed from the training time.** Outbound is calculated *backwards*
from "arrive at the gym `arriveEarlyMin` before training starts". Return is
calculated *forwards* from "leave the gym `departAfterMin` after training ends".

**The two directions are generated independently.** `genDayTasks` loops over
`["oda", "vissza"]` and resolves the stop list, the per-stop counts, the `pax` **and
the capacity split** separately for each, via `teamLeg(team, dir)`. A team whose
return has its own stops can therefore need a different number of buses each way —
nothing requires `…:oda#1` and `…:vissza#1` to pair up. After `genDayTasks` returns,
tasks are flat and independent; chaining is decided purely by time and deadhead.

> **Task ids embed the split index** (`trainingId:weekday:dir` plus `#1`, `#2`, …).
> Changing a team's stops or headcounts can therefore change how many buses a
> direction needs, which renames its tasks — and `resolveDay` cannot match a saved
> chain against ids that no longer exist. It drops such chains (with their driver,
> vehicle and lock flags) and reports how many, so the Schedule screen can tell the
> user to re-run the optimiser rather than leave them wondering where the roster
> went. Outbound ids are unaffected by adding a return list.

**Capacity splitting.** Real teams (10–14 kids) can be bigger than the biggest bus
(8 seats). If a team's headcount exceeds the largest vehicle, `genDayTasks` tries to
**split the task across several buses by stop**, using
`splitStationsByCapacity(...)` — a first-fit-decreasing bin-packing where each stop's
whole headcount goes into one bus, using as few buses as possible. Each resulting bus
is an independent, parallel task (its own optimal route and timetable). Splitting only
works when per-stop headcounts are known and no single stop is larger than a bus;
otherwise the task can't be split and the reason is recorded in `skipped`.

### 10.2 Deadhead matrix — travel time between points

"Deadhead" = driving empty between two points. The cost of chaining tasks depends on
these times.

- `computeMatrix(state)` makes **one** call to the OSRM `table` API for all
  coordinate pairs and caches the result in `state.matrix`. If OSRM is unreachable,
  it falls back to a straight-line (haversine) estimate using `estSpeedKmh`, and
  marks `source: "estimate"`.
- `legMin(state, aId, bId)` is the lookup used everywhere: matrix value if present →
  else haversine estimate → else `fallbackLegMin`. Same point or missing point → 0.

### 10.3 Route order — `bestStationOrder` (Held–Karp)

For one task, in what order should the bus visit the stops to minimize driving?

`bestStationOrder` solves this exactly with the **Held–Karp dynamic-programming TSP**
for up to 10 stops (above 10 it keeps the given order, since exact TSP gets too
expensive). It supports:
- `pre` / `post` — a point glued before/after the route (e.g. the gym),
- `fixedFirst` / `fixedLast` — a forced first/last stop (the team's "anchor" stop).

`teamRouteOrder(...)` wraps this and resolves the direction's stop list through
`teamLeg`. In **manual** route mode it uses the stored order; that order is reversed
for the return **only when the return mirrors the outbound** — a hand-authored return
list is already in the intended order, so reversing it would undo the user's
arrangement. In **auto** mode it calls Held–Karp with the venue as the end (oda) or
start (vissza) and the direction's own anchor.

`planOda` / `planVissza` then turn an order into a **timetable** (arrival + departure
minute per stop), counting a `dwellMin` pause at each stop.

### 10.4 Chaining tasks — `minCostChains` (min-cost flow)

Now decide **which tasks one driver should do back-to-back**. If task A ends near
where task B starts and there's enough time to drive over, chaining them into one
driver-shift saves a second call-out.

This is modelled as **minimum-cost flow on a bipartite graph**:
- One node per task on each side.
- An edge A→B exists if `A.end + deadhead(A.to, B.from) <= B.start` (B can follow A).
- Edge cost = `gap_minutes × average_wage_per_minute − calloutFee`. A big gap is
  costly (idle paid time); avoiding a call-out is a saving.
- The solver (`minCostChains`, successive shortest paths / SPFA) only pushes flow
  along cost-reducing paths, so it links tasks only when it actually helps.

The result is a set of task sequences (`freeChains`). Note this stage uses the
**average** wage, because it doesn't yet know *which* driver runs each chain.

### 10.5 Assign real drivers and buses — `assignResources`

Now attach a concrete **(driver, vehicle)** to each chain, using the real cost. This
is an exact **backtracking search** with cost-bound pruning (capped at 30,000
iterations, after which it keeps the best found and notes it was heuristic).

For each chain it enumerates valid (driver, vehicle) options, requiring:
- **Capacity:** `vehicle.seats >= chain.maxPax`.
- **Driver availability:** `driverAvailableFor(driver, weekday, start, end)` — true
  if the driver has no availability windows, else a window on that weekday must fully
  contain the shift.
- **No double-booking:** neither the driver nor the vehicle already overlaps another
  chain in time.

The cost of an option is:
```
base = calloutFee + paidHours × driver.wage
paidHours uses max(shift length, driver.minShiftMin)   // min-shift is paid even if short
```

**Preferred-vehicle bias (soft preference).** On top of `base`, if the driver has a
`preferredVehicleId` and this vehicle is a *different* one, we add
`settings.preferredBias` (default 1000 Ft) as a penalty:

```js
const offPreferred = d.preferredVehicleId && v.id !== d.preferredVehicleId;
const bias = offPreferred ? (state.settings.preferredBias || 0) : 0;
opts.push({ d, v, cost: base + bias });
```

This nudges the optimizer to keep each driver on their usual bus, but it is **soft**:
coverage always wins, and a real saving larger than the bias can still move a driver
off their bus. Set `preferredBias` to 0 to disable it. If a driver's preferred
vehicle no longer exists, every option gets the same penalty, so it cancels out and
behaves as "no preference." Note the bias affects only the optimizer's internal
choice; the **displayed** cost (`dayStats`) is always the true money cost.

### 10.6 Local improvement

After the first assignment, `optimizeDay` runs an improvement loop (up to 60 passes)
that tries **merging chains** — both free chains with each other, and free chains
into the fixed "skeleton" chains from locked tasks — whenever the merge lowers the
true cost. This is where the effects of minimum shifts and *differing* driver wages
get optimized, which the average-wage flow stage couldn't see.

### 10.7 Locked tasks and uncovered tasks

- **Locked tasks** (from `assignments`) become fixed skeleton chains the optimizer
  won't rearrange. It can still merge free tasks *into* them if that helps.
- **Uncovered tasks** — a task with no big-enough bus or no available driver is not
  forced into a bad assignment. It is returned in `uncovered` with an exact,
  human-readable reason (e.g. "no vehicle with enough seats", "no driver available in
  this window", or "all suitable resources are busy at this time").

### 10.8 Output and stats

`optimizeDay` returns `{ chains, uncovered, notes, stats }`. `dayStats(state, chains)`
computes totals for the before/after comparison: number of drivers, number of chains,
paid minutes, deadhead minutes, idle minutes, and **true** cost in Ft.

---

## 11. Schedule ↔ rides: how they connect

There are two related but different things:

- **`assignments`** — the saved *schedule* (chains of tasks per weekday). This is the
  optimizer's output, and the source of truth for planning.
- **`rides`** — concrete bus runs shown in the Week and Driver views, used for
  conflict detection.

They are linked by **materialization**:

- `resolveDay(state, weekday, weekMon)` reads the saved `assignments`, regenerates
  that day's tasks, and rebuilds the chains as a view model (with live conflict/issue
  detection). Used to display the schedule.
- `ridesFromChains(state, weekday, chains)` turns chains into `rides` — one ride per
  task, with `dir`, the timetable copied into `stops`, and `source: "schedule"`.
- `withGeneratedRides(state, weekday, weekMon, chains)` replaces all rides of the
  affected trainings for that day with freshly generated ones, and keeps the rest.

Two UI actions trigger this (both in the Schedule screen):
- **Apply an optimizer proposal** (`applyProposal`) — saves the new `assignments`
  *and* regenerates rides.
- **"Fuvarok generálása a beosztásból"** (`doGenerate`) — regenerates rides from the
  current saved schedule, e.g. after manual tweaks.

> **Gotcha:** generation *replaces* every ride of the affected trainings. Manual
> edits to a generated ride are overwritten the next time you generate. The schedule
> is the single source of truth for generated rides.

---

## 12. The user interface

### 12.1 Structure

The UI lives in `src/ui` (building blocks) and `src/screens` (one file per screen):

- **`src/App.jsx`** — top-level component. Holds the entire state in one `useState`,
  handles loading/seeding, the 300 ms debounced save, tab navigation, and renders the
  current screen. State updates go through a single helper:
  `update(fn)` = `setState(s => fn(s))`.
- **`src/ui/base.jsx`** — small building blocks: `Modal`, `Field`, `NumField`,
  `PlateChip`, `DangerBtn` (two-step delete), `EmptyState`, `TeamDot`, `InfoDot`.

**Four tabs** in the bottom bar. Teams and master data were merged under **Adatok**,
which switches between five categories with a chip row:

| Tab (Hungarian) | Component | What it does |
|---|---|---|
| **Hét** (Week) | `WeekScreen` / `OccCard` | All trainings this week, color-coded, with each assigned bus (plate chip, driver, time), and conflict/"no ride" badges. |
| **Beosztás** (Schedule) | `ScheduleScreen` / `ChainCard` | Per-weekday task chains, the optimizer, before/after comparison, task lock/move, ride generation, and the ⚙ settings panel. |
| **Adatok** (Data) | `DataScreen` → `TeamsScreen` / `MasterScreen` | Csapatok, Állomások, Helyszínek, Járművek, Sofőrök. Team details, station/venue assignment, per-stop headcounts, route mode; CRUD for the master entities. Also holds the one "restore sample data" button. |
| **Sofőr** (Driver view) | `DriverScreen` | Mobile-friendly, large-type daily route list per driver with a "NEXT stop" highlight, refreshed every minute. |

The **Fuvar** (ride editor, `RideScreen`) is not a tab — it opens from a week-view
card. It edits one occurrence's rides: direction (ODA/VISSZA), vehicle, driver, and
ordered, timed stops.

### 12.2 Styling

Styling is **not** mostly Tailwind. The visual identity lives in
**`src/ui/styles.css`** — component classes (`.card`, `.btn`, `.plate`, `.chip`,
`.pill`, `.rail`, …) built on CSS variables. Tailwind utility classes are used for
quick layout (`flex`, `gap-2`, `mt-2`, etc.). When changing appearance, look in
`styles.css` first.

**One palette.** `src/theme.css` owns the `--v-*` design tokens *and the dark mode*;
`styles.css` defines the app's own names as aliases onto them
(`--ink: var(--v-ink)`, `--acc: var(--v-acc)`, …). That is why every rule can stay
written in the short names while the whole app still follows the OS colour scheme.
Change a colour in `theme.css`, not in `styles.css`.

**The one trap.** A few surfaces are *deliberately* dark — the header, the tab bar,
the driver-view card headers, the active chip. They must use `--surface-inv` with
`--on-inv` for their text, **never** `--ink` as a background: in dark mode `--v-ink`
is near-white, so `background: var(--ink); color: #fff` renders white on white. The
licence plate is the same idea in reverse: it keeps `--plate-bg` / `--plate-ink` so
it stays a real-world white plate with dark lettering in both themes.

> Real example of why this matters: the plate number element (`.plate b`) originally
> had no explicit color, so it *inherited* the surrounding text color. Inside the
> dark headers of the Driver and Schedule screens (white text), the plate number
> became white-on-white and looked blank. The fix was one line: give `.plate b` an
> explicit dark `color`.

### 12.3 State-update pattern

There is no reducer. Components receive `state` and an `update` function.
Modifications are immutable object spreads, e.g.:

```js
update((s) => ({ ...s, teams: s.teams.map(t => t.id === id ? { ...t, name } : t) }));
```

Because `App` saves on every state change (debounced), any `update` is automatically
persisted.

---

## 13. The map and external services

- **Leaflet map** — used by the map picker (`MapPickerModal`) for choosing station /
  venue coordinates. Leaflet is **lazy-loaded** only when the picker opens. If the
  environment blocks map tiles (e.g. a restrictive sandbox), it falls back to a
  built-in **offline SVG map** that plots your existing points. Coordinates can also
  be pasted manually (Google-Maps-style `lat, lon`, decimal commas accepted).
- **Nominatim** — OpenStreetMap address search, called only on explicit user action
  (Enter / button), respecting its ~1 request/second limit.
- **OSRM** — road travel-time matrix (`computeMatrix`). The public demo server is
  fine for testing; for production you'd self-host OSRM or use a paid API. Without
  OSRM, the app falls back to straight-line estimates (clearly labelled in the UI).

These services all work in the deployed (Vercel) app and in normal local dev. Inside
the original artifact sandbox they may be blocked by CSP, which is exactly why every
one of them has a fallback.

---

## 14. Settings reference

`state.settings` holds tunable numbers. Defaults live in both `seedState()` and
`ensureShape()` (keep them in sync). Every value is editable in the Schedule screen's
⚙ panel.

| Key | Meaning | Default |
|---|---|---|
| `arriveEarlyMin` | Minutes before training start the bus should reach the gym. | 10 |
| `departAfterMin` | Minutes after training end the return bus leaves the gym. | 10 |
| `calloutFee` | Fixed cost (Ft) of putting one driver on the road once. | 1500 |
| `dwellMin` | Pause (minutes) at each stop for boarding/alighting. | 2 |
| `estSpeedKmh` | Assumed speed for straight-line travel-time estimates. | 50 |
| `fallbackLegMin` | Travel time used when there's no matrix and no coordinates. | 12 |
| `preferredBias` | Extra cost (Ft) charged when a driver is put on a bus other than their preferred one. 0 disables the preference. | 1000 |

---

## 15. Build, run, and deploy

### Scripts (`package.json`)

- `npm run dev` — start the Vite dev server (default port 5173, hot reload).
- `npm run build` — production build into `dist/`.
- `npm run preview` — serve the built `dist/` locally to sanity-check a build.

### Run locally

```bash
cp .env.example .env      # then fill in the two VITE_SUPABASE_* values
./run-local.sh            # installs Node 22 into ~/.local if missing, then npm install + npm run dev
# or, if you already have Node 18+:
npm install && npm run dev
```

Then open http://localhost:5173, log in with a user created in the Supabase
dashboard, and the app loads (seeding sample data on the very first save).

### Deploy to Vercel

1. Import the repo into Vercel — the **Vite** preset is auto-detected (build
   `npm run build`, output `dist`).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings →
   Environment Variables** (Production **and** Preview). Both are browser-safe; RLS
   protects the data.
3. `vercel.json` adds an SPA catch-all rewrite so deep links / refreshes resolve to
   the app.

---

## 16. Environment variables

Only two, both read at build time by Vite and inlined into the browser bundle:

| Variable | What it is | Safe in the browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL. | Yes |
| `VITE_SUPABASE_ANON_KEY` | The **publishable / anon** key. | **Yes** — it's designed to be public; RLS is the real protection. |

> 🔴 **Never** put a Supabase **secret** key (`sb_secret_...` or the `service_role`
> JWT) into any `VITE_*` variable, `.env` in this project, or the code. Anything
> `VITE_`-prefixed is bundled into the JavaScript that every visitor downloads. The
> secret key bypasses RLS and would hand the whole database to anyone. Only the
> publishable/anon key belongs here. If a secret key is ever exposed, rotate it in
> the Supabase dashboard.

---

## 17. Known limitations and gotchas

- **Single-editor model.** Two people editing at once is handled by *refusing* the
  second save (the stale banner), not by merging. If you need true multi-editor
  live sync, you'd add Supabase Realtime and per-entity tables — a much bigger change.
- **Whole-blob saves.** Every save writes the entire state as one JSON blob. This is
  simple and fine at this data size, but it means no field-level history and no
  partial updates.
- **Generated rides are overwritten.** Manual edits to a `source: "schedule"` ride
  are lost the next time you generate rides from the schedule. Edit the schedule, not
  the generated ride.
- **`ensureShape` must know every field.** Add a field without a default there and
  old saved data will carry `undefined`.
- **Seed contains real personal data.** Anonymize before going public.
- **Exact TSP only up to 10 stops.** Beyond that, the given stop order is kept.
- **The optimizer's assignment search is capped** at 30,000 iterations; very large
  days fall back to the best solution found and say so.
- **Plate validation is lenient.** Any non-empty alphanumeric string is accepted as
  a plate (this is intentional — Hungary allows custom plates — but there's no strict
  format check).

---

## 18. How to extend the app

### Add a field to an entity (e.g. a new driver attribute)

1. Add the field to the relevant objects in **`seedState()`**.
2. Add a default in **`ensureShape()`** so old saved data gets it.
3. Add an input to the entity's editor (e.g. `MasterForm` for drivers/vehicles).
4. Use the field wherever needed (e.g. the optimizer). *(This is exactly how
   `preferredVehicleId` was added — see [§10.5](#105-assign-real-drivers-and-buses--assignresources).)*

No storage changes are needed — it's all part of the one blob.

### Add a new setting

Add its default to **both** `seedState().settings` and `ensureShape`'s settings
merge, then add a `Field` to the ⚙ panel in `ScheduleScreen`.

### Add a new screen

Add a component, add an entry to the `TABS` array (label + icon), and render it in
`App` based on the active `tab`.

### Change how data is stored

You almost never need to touch `fuvarterv.jsx`. To change the backend, reimplement
the four methods in **`src/supabaseStorage.js`** (or point `window.storage` at a
different implementation in `AuthGate.jsx`). As long as `get`/`set` honor the
contract in [§6.1](#61-the-windowstorage-contract), the app doesn't care.

### Where to put new code

The split is done — see the tree in [§3](#3-repository-layout--every-file). Put new
code in the module that owns the concern, not in `fuvarterv.jsx` (that is only a
barrel now, kept so existing imports and tests keep working).

- Pure rule, no React → `src/domain/*`. It becomes directly unit-testable.
- A new reusable control → `src/ui/base.jsx`.
- A new screen → `src/screens/`, then add it to `TABS` in `src/App.jsx`.
- A different backend → reimplement the four methods in `src/supabaseStorage.js`.

Keep the dependency direction (`screens → ui → domain → data`). If a domain module
starts needing something from a module above it, that is the signal to pull the
shared piece down into a leaf — which is exactly why `src/domain/geo.js` exists.

---

## 19. Tests

`npm test` runs vitest in jsdom; `npm run lint` runs ESLint.

| File | Covers |
|---|---|
| `test/domain.test.js` | plate normalisation, time conversion, weekday maths, `bestStationOrder` (brute-force verified up to n=7), capacity splitting, ride windows and conflicts |
| `test/optimizer.test.js` | property tests: 100 seeded random states through `optimizeDay`, asserting conservation of tasks, capacity, availability, resource feasibility, and that local improvement never raises the objective |
| `test/fixes.test.js` | regressions for the defects fixed on this branch — each test says which wrong behaviour it locks out |
| `test/smoke.test.jsx` | mounts `<App/>` against a fake `window.storage`, walks every tab and data category, and pins the "loading must not write back" rule |
| `test/load-error.test.js` | `NOT_FOUND` vs. a real read failure (never seed over unread data) |
| `test/settings.test.js` | `DEFAULT_SETTINGS` stays the single source for `seedState` and `ensureShape` |

Two things worth knowing before you change them:

- **Invariant (2) in `optimizer.test.js` is load-bearing.** It used to assert only
  that two chains sharing a driver or bus do not *overlap in time*, which is weaker
  than reality and therefore accepted a roster where the same bus finishes in one
  village and starts in another the same minute. It now also requires room for the
  deadhead. Do not weaken it back.
- **`smoke.test.jsx` is what catches a missing import after a refactor.** A Vite
  build succeeds even when a screen references an identifier that no longer exists;
  only rendering the component finds it. `npm run lint` (`no-undef`) is the other
  half of that net.

---

## 20. Glossary (Hungarian ↔ English)

| Hungarian | English | Notes |
|---|---|---|
| fuvar | ride / run | one bus trip |
| beosztás | schedule / roster | the `assignments` |
| csapat | team | |
| állomás / megálló | station / stop | pickup point |
| helyszín | venue | training location (gym) |
| jármű / busz / kisbusz | vehicle / bus / minibus | |
| sofőr | driver | |
| edzés | training | |
| rendszám | license plate | |
| férőhely | seat / capacity | excludes the driver |
| oda | outbound | villages → venue |
| vissza | return | venue → villages |
| lánc | chain | tasks done back-to-back by one driver+bus |
| feladat | task | one ODA or VISSZA unit of work |
| üresjárat | deadhead | driving empty between tasks |
| órabér | hourly wage | |
| műszak | shift | |
| kiszállási díj | call-out fee | fixed cost per driver dispatch |
| elérhetőség | availability | driver time windows |
| létszám | headcount | passengers |
| törzsadat | master data | reference entities |
| ütközés | conflict | overlapping vehicle/driver use |
| fedetlen | uncovered | a task with no valid assignment |
| mátrix | matrix | travel-time table |
| preferált jármű | preferred vehicle | a driver's usual bus (soft bias) |
| Hét | Week | screen |
| Kijelentkezés | Sign out | |

---

*This document describes the code as of the current branch. When you change
behavior — especially the data model, the storage contract, or the optimizer — update
the relevant section here so it stays trustworthy.*
