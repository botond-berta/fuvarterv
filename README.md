# Fuvarterv

A training-transport planner for a handball club.

A rural Hungarian club shuttles several youth teams to practice by minibus from the
surrounding villages. This app manages the whole job: the weekly training schedule,
pickup stops, vehicles, drivers, the shuttle runs themselves, and a cost-based
**schedule optimizer** that chains transport tasks together so the club's daily wage
bill comes out as low as the constraints allow.

**The user interface is Hungarian.** It is built for the club's staff and drivers, who
are not developers. Everything else — code, comments, documentation, commit messages —
is English.

> ### Built with heavy AI assistance
>
> This project was written almost entirely by [Claude](https://claude.ai), working from
> a human's requirements, review and testing. It began as a single-file React prototype
> and was then split into modules, tested, documented and hardened across a series of
> AI-authored pull requests. The architecture documents and the decision log were
> likewise produced by reading the code back and writing down what it does and why.
>
> This is disclosed for two reasons. Contributors should know what they are reading:
> the comments are unusually dense because they carry reasoning that would otherwise
> live in a person's head, and the same reasoning was derived after the fact in places.
> And anyone evaluating the code should weigh it accordingly — the test suite is real
> and the invariants it checks are real, but no part of this has the benefit of long
> production use.
>
> Bugs, wrong assumptions and over-engineering in here are the project's to own, not an
> excuse. If you find one, the decision log is the right place to check whether it was
> a choice before assuming it was a mistake.

---

## What it does

Four tabs, plus a ride editor that opens from a week-view card.

- **Hét (Week)** — every training in the week, colour-coded by team. Each assigned bus
  shows as a plate chip with its driver and departure time; a yellow badge means no
  ride is assigned, red means a clash.
- **Beosztás (Schedule)** — the day's transport tasks, outbound and return. Chains per
  driver, an explanation for every link between two tasks, per-task locking, manual
  reassignment, and an optimize button that shows the cost before and after.
- **Adatok (Data)** — five categories under one tab: teams, stations, venues, depots,
  vehicles, drivers, and the user-role panel.
- **Sofőr (Driver)** — a read-only, large-type daily route for one driver, with a "next
  stop" highlight that advances every minute. Built for a phone on a dashboard.
- **Fuvar (Ride editor)** — editing one ride: direction, vehicle, driver, and an
  ordered, timed stop list with automatic time calculation.

## How the scheduling works

- **Stop ordering** uses Held-Karp dynamic programming, exact up to ten stops. Arrival
  times are computed backwards from the training's start on the outbound leg and
  forwards from the venue departure on the return leg.
- **Travel times** come from a deadhead matrix: one OSRM `table` call fetches real road
  times for every pair of points. With no network it falls back to a haversine estimate
  and says so, and it warns when a coordinate has changed since the matrix was built.
- **The optimizer** runs in three phases. Build the compatibility graph, chain tasks by
  min-cost flow (gap times the average wage, minus the call-out fee), then assign
  (driver, vehicle) pairs by exact backtracking search, followed by a local-improvement
  loop against the true cost function. When a task cannot be covered, it says precisely
  why: capacity, availability, vignette, or resource contention.
- **Paid time runs depot to depot.** A driver starts work on leaving the depot and
  finishes on getting back, and two chains merge into one shift when there is no time to
  go home between them — so waiting at a distant venue is paid, under a single call-out
  fee.
- **Capacity splitting.** Real teams (10 to 14 children) outgrow the 8-seat buses. When
  that happens the task is partitioned across buses by stop, each stop's whole headcount
  on one bus, packed into the fewest buses that fit. Each partition is an independent
  parallel run with its own route, timetable and assigned crew.
- **Every skip gets a reason.** Nothing is dropped silently. If a ride is not scheduled,
  the screen says what to fix.

## Setup

You need a [Supabase](https://supabase.com) project and Node 20 or newer.

**1. Create the database.** In the Supabase SQL editor, run
[`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql).
That one file is the entire server side: three tables, two functions, a trigger, and the
row level security policies.

**2. Turn off public sign-ups.** Under **Authentication → Providers → Email**, switch
**Enable sign-ups** OFF. This is the security boundary, not an optional hardening step.
The anon key is public by design — it ships in the JS bundle — and every policy grants
read access to any *authenticated* user. While sign-ups are open, anyone who reads that
key out of the bundle can register and read your data.

**3. Make yourself the first admin.** Writes are admin-only, and an account with no role
row is a read-only driver, including yours. Run this once with your own address:

```sql
insert into public.user_roles (email, role)
values (lower('you@example.com'), 'admin')
on conflict (email) do update set role = 'admin';
```

**4. Create the staff logins.** Add each person under **Authentication → Users → Add
user**, set a password, and tick **Auto Confirm User**. No emails are sent. Then give
them a role inside the app under **Adatok → Felhasználók** (no row means driver). For a
driver, put the same address on their record under **Adatok → Sofőrök** so the driver tab
opens on their own day plan.

More detail, including a query that tells you what is and is not applied, is in
[`supabase/migrations/README.md`](supabase/migrations/README.md).

## Running locally

```bash
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

Or in one step, installing Node if you do not have it: `./run-local.sh`.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Vitest, single run |
| `npm run lint` | ESLint |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve the built bundle |

The first save seeds the shared workspace from `seedState()`. **That sample data is
fictional** — placeholder driver names and plates, with real public places as stations
and venues so the distances stay realistic. Replace it with your club's own data, or
delete the rows from inside the app.

## Deploying to Vercel

Make sure the database is ready first: the schema applied and public sign-ups off.

1. Import the repo. The **Vite** preset is detected automatically (build `npm run build`,
   output `dist`), and Node comes from `engines` in `package.json`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings → Environment
   Variables**, ticking **Production _and_ Preview**. Both are browser-safe.

   > Vite inlines these **at build time**. Adding them after a deployment has been built
   > will not affect that build — redeploy. A build without them still succeeds; the app
   > just shows its "missing configuration" screen.
3. Push a branch for a preview deployment, check it, then merge.

`vercel.json` adds the single-page-app rewrite and a set of security headers, including a
Content-Security-Policy that allows exactly the origins this app uses: Supabase, the OSRM
matrix, Nominatim, OSM tiles, Leaflet from cdnjs, and Google Fonts. Add an external
service and it needs a matching directive, or the browser will block it silently.

The policy deliberately has no `'unsafe-inline'`. The built `index.html` contains no
inline script or style, and React and Leaflet set styles through the CSSOM, which CSP
does not govern. One caveat when checking a preview deployment: open the map picker and
watch the browser console. If Leaflet turns out to need it, adding `'unsafe-inline'` back
to `style-src` is a one-line fix.

## How it is built

No backend of its own, and no global state manager. The entire application state is one
JSON object, held in `src/App.jsx`, persisted as a single blob, and passed down as props.
The data is small; the logic is not.

Dependencies flow one way: `App → screens → ui → domain → data`.

| Module | Contents |
|---|---|
| `src/data/storage.js` | the `window.storage` persistence seam and `DEFAULT_SETTINGS` |
| `src/data/seed.js` | sample data and `ensureShape`, the shape normaliser |
| `src/data/roles.js` | reading and writing the `user_roles` table |
| `src/domain/constants.js` | days, months, `uid`, `byId` |
| `src/domain/datetime.js` | Monday-first weeks, 24-hour times, local time throughout |
| `src/domain/geo.js` | coordinates, haversine, the deadhead matrix |
| `src/domain/logic.js` | plates, occurrences, ride windows, clashes, delete guards |
| `src/domain/optimizer.js` | task generation, Held-Karp, min-cost flow, assignment, diagnostics |
| `src/ui/` | `styles.css`, `base.jsx`, `OccCard.jsx`, `MapPicker.jsx`, `format.js` |
| `src/screens/` | Week, Schedule, Data, the stop-list editor, Ride editor, Driver, Users |
| `src/App.jsx` | navigation, state, debounced saving |
| `src/AuthGate.jsx` | login, role loading, and installing the Supabase-backed storage |

`src/domain/geo.js` is a leaf on purpose. Both `logic` and `optimizer` need `legMin`, so
keeping it inside either one would make the two circular.

`src/domain/` is pure: no `window`, no network, and no `Math.random()` on a decision
path. The optimizer has to be deterministic, or the same day would produce a different
schedule on every click.

### The data model, in brief

- **Team** — name, age group, gender, colour, assigned stations and venues, per-stop
  headcounts, route mode. The return leg may carry its own stop list and headcounts;
  left unset it mirrors the outbound leg reversed.
- **Station / Venue / Depot** — name, address, note, coordinates. The coordinate is
  mandatory. A venue can be marked as reachable only with a motorway vignette.
- **Vehicle** — name, normalised unique plate, seats excluding the driver, vignette flag,
  and optionally its own depot.
- **Driver** — name, phone, hourly wage, minimum shift, availability windows, preferred
  vehicle, and the sign-in address that links them to their own day plan.
- **Training** — a team and venue, plus either weekly days or a one-off date, with start
  and end times. It may override the team's stop list with a complete one of its own.
- **Ride** — one run against a training occurrence: vehicle, driver, and ordered timed
  stops. Several rides can belong to one occurrence.
- **Task** (derived) — an outbound and a return task per occurrence, with a timetable and
  a headcount. This is what the optimizer operates on.
- **Schedule** — per-weekday chains of tasks with a driver and vehicle, and per-task
  locking.

## Documentation

| Document | What it answers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **Why is it built this way?** Layers, invariants, the state and save cycle, concurrency, the security model, the optimizer pipeline, known risks. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | **What was decided, and what was rejected?** Short architecture decision records. |
| [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md) | **What do I run and check?** Workflow, conventions, review and deploy checklists, and a symptom-to-cause table. |
| [`docs/DEVELOPER.md`](docs/DEVELOPER.md) | **How does it work?** A file-by-file, field-by-field reference. |
| [`docs/ACTION_PLAN.md`](docs/ACTION_PLAN.md) | **What should be done next?** Prioritised work from a code review, with verification steps. |

[`docs/README.md`](docs/README.md) suggests a reading order.

## External services

- **OpenStreetMap tiles** — attribution is required, and the map includes it.
- **Nominatim** — roughly one request per second, only on explicit user action.
- **OSRM demo server** — fine for testing, not for production. Self-host OSRM (Docker
  plus a Hungary extract) or use a paid traffic-aware API. The demo uses a static speed
  profile: real routes, no live traffic.

Each of these degrades rather than failing. No matrix means a haversine estimate; no
Leaflet means a built-in offline SVG map you can still place a pin on.

## Known limitations

- The weekly schedule is a per-weekday template, so chains never cross midnight and
  one-off trainings get limited scheduling.
- A task id contains its capacity-split index, so changing stops or headcounts can
  invalidate saved chains. The app counts those and tells you to re-run the optimizer,
  but the assignment is lost. See `ACTION_PLAN.md`, item P2-1.
- One editor at a time. Concurrent saves are caught by an optimistic guard and the second
  editor is asked to reload rather than silently losing work.
- There is no server-side validation. `ensureShape` defends reads, and the twenty-snapshot
  save history is the way back from a bad write.

## License

Not chosen yet. MIT is a reasonable default for a public repo.
