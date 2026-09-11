# Fuvarterv — decision log

This log records the **design decisions**: what the situation was, what was chosen, what
it costs, and what was rejected. The point is that a later change should not overwrite a
deliberate decision by accident — and when one does need overwriting, that we know what we
are reaching into.

Format: **context → decision → consequence → rejected alternative → where it lives.**

Unless a record says otherwise, the decision is **still in force**.

| # | Decision | Area |
|---|---|---|
| [ADR-01](#adr-01--the-whole-state-is-one-json-blob) | One JSON blob | persistence |
| [ADR-02](#adr-02--keep-the-windowstorage-key-value-seam) | The `window.storage` seam | persistence |
| [ADR-03](#adr-03--one-way-layering-with-geo-as-a-leaf) | Layering, `geo` as a leaf | module structure |
| [ADR-04](#adr-04--no-global-state-manager) | No store | state |
| [ADR-05](#adr-05--client-side-shape-normalisation-with-no-version-number) | `ensureShape` | migration |
| [ADR-06](#adr-06--single-editor-model-with-an-optimistic-guard) | Optimistic guard | concurrency |
| [ADR-07](#adr-07--telling-a-lost-response-apart-from-a-real-conflict) | Lost response | concurrency |
| [ADR-08](#adr-08--save-history-best-effort-20-snapshots) | History | persistence |
| [ADR-09](#adr-09--no-backend-of-our-own-supabase--vercel) | No backend | infrastructure |
| [ADR-10](#adr-10--roles-by-e-mail-fail-closed) | Roles | security |
| [ADR-11](#adr-11--row-level-security-is-the-boundary-the-ui-is-only-ux) | RLS is the boundary | security |
| [ADR-12](#adr-12--three-phase-optimisation-instead-of-one-exact-model) | Three phases | optimisation |
| [ADR-13](#adr-13--heldkarp-up-to-ten-stops) | Held-Karp | optimisation |
| [ADR-14](#adr-14--paid-time-runs-depot-to-depot) | Depots, shifts | optimisation |
| [ADR-15](#adr-15--hard-constraints-and-exactly-one-soft-term) | Hard vs. soft | optimisation |
| [ADR-16](#adr-16--capacity-splitting-by-stop-first-fit-decreasing) | Task splitting | optimisation |
| [ADR-17](#adr-17--the-schedule-is-the-source-of-rides) | Schedule → rides | domain |
| [ADR-18](#adr-18--the-coordinate-is-mandatory) | Mandatory coordinate | domain |
| [ADR-19](#adr-19--one-osrm-call-invalidated-by-a-key) | The matrix | external service |
| [ADR-20](#adr-20--leaflet-lazy-loaded-with-an-offline-fallback) | Map and fallback | UI |
| [ADR-21](#adr-21--a-csp-with-no-unsafe-inline) | CSP | security |
| [ADR-22](#adr-22--an-event-based-seam-between-the-app-and-the-shell) | Event seam | architecture |
| [ADR-23](#adr-23--telling-an-explicit-zero-apart-from-an-empty-headcount) | Zero vs. empty | domain |
| [ADR-24](#adr-24--every-skip-gets-a-reason) | Explanations | domain, UX |
| [ADR-25](#adr-25--hungarian-ui-english-everything-else) | Language | convention |
| [ADR-26](#adr-26--vitest-and-jsdom-tests-against-the-real-modules) | Tests | testing |
| [ADR-27](#adr-27--an-error-boundary-inside-the-shell) | Error boundary | resilience |
| [ADR-28](#adr-28--one-stylesheet-os-driven-dark-mode) | One stylesheet | UI |

---

## ADR-01 — The whole state is one JSON blob

**Context.** A few dozen entities, one club, one workspace. Every derived view (weekly
occurrences, daily tasks, chains) is computed from several collections at once.

**Decision.** The whole workspace is one plain object, stored as JSON in one database row.

**Consequence.** Saves are atomic and rollback is trivial. There are no server-side schema
migrations. Every derived view is computed from one consistent snapshot. The costs are no
partial saves, no real-time co-editing, and a practical size ceiling of a few megabytes.

**Rejected.** Per-entity tables with foreign keys. That would buy concurrent editing and
server-side validation at the price of a schema, migrations, queries and joins — a great
deal of machinery for data this small.

**Where.** `src/data/storage.js`, `src/supabaseStorage.js`, `supabase/migrations/`.

## ADR-02 — Keep the `window.storage` key-value seam

**Context.** The app needs to persist, but the storage backend is a deployment concern,
not a domain one.

**Decision.** The app talks only to `window.storage`, a four-method contract (`get`,
`set`, `delete`, `list`). `AuthGate` installs the Supabase-backed implementation before
`App` mounts; tests install a stub.

**Consequence.** Changing backend means writing one object. Nothing in `domain`, `ui` or
`screens` knows Supabase exists, and the full load-and-save cycle is testable without a
network.

**Rejected.** Importing the Supabase client directly where it is needed. Faster to write,
and it would have welded hosting into the domain.

**Where.** `src/data/storage.js`, `src/supabaseStorage.js`, `src/AuthGate.jsx`.

## ADR-03 — One-way layering, with `geo` as a leaf

**Context.** Both `logic` (`rideWindow`) and `optimizer` (`genDayTasks`) need to compute
travel time between two points.

**Decision.** Dependencies flow one way, `App → screens → ui → domain → data`, and
`legMin` lives in its own leaf module, `domain/geo.js`.

**Consequence.** No cycles. Inside `domain` the order is also strict: `constants →
datetime → geo → logic → optimizer`.

**Rejected.** Keeping `legMin` in `logic` and importing it from `optimizer`. That works
until `logic` needs something from `optimizer`, at which point the cycle is already there.

**Status note.** The rule is enforced by reading, not by a tool. See risk R4 and
`ACTION_PLAN.md` P1-4.

## ADR-04 — No global state manager

**Context.** One state object, one editor, a handful of screens.

**Decision.** `App.jsx` holds the state in a `useState` and passes it down as props.
Mutation goes through `update(fn)`, which must be a pure transform.

**Consequence.** Less machinery to understand, and every change is traceable by reading.
The cost is prop drilling and a whole-tree re-render on every edit — imperceptible at this
scale (risk R8).

**Rejected.** Redux, Zustand, or a reducer. At this size the ceremony would exceed the
benefit.

## ADR-05 — Client-side shape normalisation, with no version number

**Context.** The blob has no schema, and an older client may read a blob written by a
newer one and vice versa.

**Decision.** `ensureShape(s)` runs on every load and defaults every field
**independently**. There is no version number and no migration chain.

**Consequence.** Tolerant in both directions: an old client ignores what it does not know,
a new one fills in what is missing. The requirement this places on every new field is
ADR-driven: its default must reproduce the **previous** behaviour (principle E8).

**Rejected.** A numbered schema with a migration chain. That needs a migration runner and
a policy for downgrades, for a blob only this app ever writes.

**Where.** `src/data/seed.js`.

## ADR-06 — Single-editor model with an optimistic guard

**Context.** In practice one person edits, but two browser tabs or two people on the same
evening are entirely possible.

**Decision.** `get` remembers the row's `updated_at`; `set` only updates where it still
matches. A mismatch blocks and asks the user to reload.

**Consequence.** Nobody's work is silently overwritten. The cost is that the second editor
loses their unsaved edits and must reload. Writes are also serialised, so two overlapping
saves cannot make the guard misfire.

**Rejected.** Last-write-wins (silent data loss) and CRDT merging (a large step, no
demonstrated need — risk R3).

**Where.** `src/supabaseStorage.js`.

## ADR-07 — Telling a lost response apart from a real conflict

**Context.** If a write commits but its response is lost, the client's `lastSeen` still
points at the pre-write timestamp. The next save's guard then matches nothing and looks
exactly like somebody else having saved.

**Decision.** On a zero-row guard result, re-read the row. If the server already holds
exactly what we last tried to write, that write did commit: adopt its timestamp and retry
once, rather than blocking.

**Consequence.** A flaky network no longer locks a workspace. The comparison uses a stable
stringify, because `jsonb` normalises key order on the round trip and a plain
`JSON.stringify` would never match.

**Rejected.** Treating every zero-row result as a conflict, which meant a dropped response
locked the user out until they reloaded.

**Where.** `src/supabaseStorage.js`, `doSet`.

## ADR-08 — Save history: best-effort, 20 snapshots

**Context.** One blob means one bad overwrite can lose everything, and there is no
server-side validation to stop it.

**Decision.** On every successful overwrite, archive the **previous** blob to
`app_state_history` and prune to the newest 20. It is fire-and-forget and swallows its own
errors.

**Consequence.** There is always a way back, reachable from inside the app, including from
the error boundary. History failures never fail a save. An unchanged blob is never
archived, or 20 identical copies would destroy exactly the restore points a user goes
looking for.

**Rejected.** A transactional history write. It would mean a history problem could block
saving, which is the wrong trade for an audit convenience.

**Where.** `src/supabaseStorage.js` (`archivePrevious`), `src/RestorePanel.jsx`.

## ADR-09 — No backend of our own: Supabase + Vercel

**Context.** One club, a handful of users, no operations staff, no budget for servers.

**Decision.** A static single-page app on Vercel, with Supabase for auth, storage and
access control. All computation happens in the browser.

**Consequence.** Nothing to operate and nothing to patch. The costs are that the anon key
is public (hence ADR-11), there is no server-side validation, and the optimizer is bounded
by one browser tab.

**Rejected.** A small Node or Python backend. It would buy validation and server-side
computation, at the price of hosting, deployment and monitoring for a workload this size.

## ADR-10 — Roles by e-mail, fail-closed

**Context.** An admin should be able to grant roles without opening the Supabase
dashboard.

**Decision.** `user_roles` is keyed by **e-mail address**, not user id. The e-mail is
verified by Supabase auth and arrives in the JWT, which the policies read back. An account
with **no row is a driver**.

**Consequence.** Roles are manageable from inside the app, and a forgotten account can
read the schedule but touch nothing. A role change takes effect on the affected user's
next sign-in or reload.

**One deliberate exception.** If the `user_roles` table does not exist at all, everyone is
an admin. In that state the server is not restricting anything either, so hiding tabs
would be theatre — and without the exception a freshly deployed client would silently drop
every user of an older database to read-only.

**Where.** `supabase/migrations/0001_initial_schema.sql`, `src/AuthGate.jsx` (`fetchRole`).

## ADR-11 — Row level security is the boundary; the UI is only UX

**Context.** The anon key ships in the JS bundle. Anything the client "forbids" is a
suggestion.

**Decision.** Every real rule lives in RLS policies. Hiding tabs and disabling buttons is
purely so the interface matches what the server will actually permit.

**Consequence.** A modified client cannot write. The UI guards are belt and braces, which
is why `App` also refuses to schedule a save for a driver: not for security, but so an
error does not flash on every session.

**Corollary.** Turning off public sign-ups is part of the security model, not optional
hardening. Without it anyone can become an authenticated user.

## ADR-12 — Three-phase optimisation instead of one exact model

**Context.** Resource-constrained scheduling with chaining, shift merging and a minimum
shift length is NP-hard. It has to run in a browser, in about a second.

**Decision.** Three phases, each on a more accurate cost function: min-cost flow for
chaining, exact backtracking for assignment, then a local-improvement loop on the true
cost.

**Consequence.** Good schedules, fast, with an explanation when something cannot be
covered. The result is not provably optimal, and the assignment search says so when it
hits its iteration cap.

**Rejected.** A single MILP model. Exact, and not runnable in a browser without a solver
dependency an order of magnitude larger than this app.

**Where.** `src/domain/optimizer.js`.

## ADR-13 — Held-Karp up to ten stops

**Context.** Stop ordering is a travelling-salesman problem with fixed endpoints.

**Decision.** Exact dynamic programming over `2^n × n` states, up to ten stops. Above
that, keep the given order.

**Consequence.** Optimal routes in every real case, with a hard ceiling instead of a
performance cliff. A real run is not longer than ten stops; if one ever is, the route is
merely unoptimised, never wrong.

**Rejected.** A heuristic (nearest neighbour plus 2-opt) everywhere. Cheaper, and it would
give up optimality in exactly the cases that are easy to solve exactly.

## ADR-14 — Paid time runs depot to depot

**Context.** A driver is paid from leaving the depot to getting back, not for the duration
of the ride. Between two runs at a distant venue they cannot go home.

**Decision.** A chain's span is measured depot to depot, and overlapping spans **merge
into one shift**. The call-out fee is charged per shift.

**Consequence.** "Can the driver go home in between" is answered with no special rule at
all: if there is no time, the spans overlap, so it is one shift with the waiting paid.
With no depot configured, the span equals the tasks' own, which is exactly the arithmetic
used before depots existed (principle E8).

**Where.** `spanOf`, `mergeShifts`, `driverPay`, `onSiteWait`.

## ADR-15 — Hard constraints, and exactly one soft term

**Context.** Capacity, availability, the vignette and physical reachability are absolute.
A driver's usual bus is a preference.

**Decision.** Everything absolute is a hard filter. The only soft term is the
preferred-vehicle bias, a forint penalty.

**Consequence.** The optimizer never proposes an impossible plan, so there is nothing to
correct by hand. Keeping the soft terms to one keeps the cost function readable.

**The golden rule.** A soft term must also go into `skelCost`. Leave it out and the
improvement loop compares a biased cost against an unbiased one, and the displayed daily
cost can go **up** after optimising. That actually happened.

## ADR-16 — Capacity splitting by stop (first-fit-decreasing)

**Context.** Real teams are 10 to 14 children; the buses seat 8.

**Decision.** When a team exceeds the largest vehicle, split the task **by stop**: a
stop's whole headcount goes on one bus, packed into the fewest buses that fit.

**Consequence.** Each part is an independent parallel run with its own route, timetable
and crew, and the two directions may split differently. Splitting requires per-stop
headcounts; a single stop larger than every bus cannot be split, and that is reported with
an exact reason.

**Rejected.** Splitting a stop's headcount across buses. It would be tidier arithmetic and
nonsense in practice: those children are standing in one place.

## ADR-17 — The schedule is the source of rides

**Context.** Chains and rides described the same reality twice, and could disagree.

**Decision.** Generating from the schedule replaces **every** ride of the day's affected
trainings. The schedule becomes the single source for that day.

**Consequence.** The week and driver views show the optimised plan. A manual edit to a
generated ride is overwritten by the next regeneration, which is why the button asks for
confirmation and says so.

## ADR-18 — The coordinate is mandatory

**Context.** Without a coordinate `legMin` falls back to `fallbackLegMin` and the point
drops out of the matrix, so the optimizer plans hours of work on invented travel times.

**Decision.** A station, venue or depot cannot be saved without one. Older records are
flagged, and editing one cannot be completed until a coordinate is set.

**Consequence.** Slightly more friction on entry, in exchange for the optimizer's output
meaning something. The map picker has an offline fallback precisely so this rule is always
satisfiable (ADR-20).

## ADR-19 — One OSRM call, invalidated by a key

**Context.** Real road times are far better than straight-line estimates, but a request
per pair would be slow and rude.

**Decision.** One OSRM `table` call for every located point, stored in the blob. Staleness
is detected by `matrixKey`: every point's id plus its coordinate to five decimals.

**Consequence.** One request, and the UI can say the matrix is out of date. If OSRM is
unreachable, a haversine estimate fills in and `matrix.source` records that it did.

## ADR-20 — Leaflet lazy-loaded, with an offline fallback

**Context.** The map is needed on a few screens, weighs a lot, and can be blocked by a
CSP or a missing network — while the coordinate is mandatory (ADR-18).

**Decision.** Load Leaflet from a CDN on first use. If the script, the global, or the
tiles fail, fall back to a built-in SVG picker: a grid with the known points drawn on it.

**Consequence.** The map stays out of the main bundle, and a coordinate can always be
entered: by pin, or by pasting one.

## ADR-21 — A CSP with no `'unsafe-inline'`

**Context.** A public app holding a club's data, with an anon key in the bundle.

**Decision.** `vercel.json` lists exactly the origins used, and omits `'unsafe-inline'`.

**Consequence.** The built `index.html` must stay free of inline script and style. React
and Leaflet set styles through the CSSOM, which CSP does not govern. Adding an external
service requires a matching directive, or the browser blocks it silently.

**Caveat.** Verify the Leaflet path on a preview deployment with the real headers. If it
turns out to need it, adding `'unsafe-inline'` back to `style-src` is a one-line change.

## ADR-22 — An event-based seam between the app and the shell

**Context.** `App` needs to trigger sign-out and open the snapshot panel, both of which
live in `AuthGate`. Importing upward would break the layering (ADR-03).

**Decision.** `App` dispatches `fuvarterv:signout` and `fuvarterv:restore` on `window`;
`AuthGate` listens. The role travels the other way through `RoleContext`.

**Consequence.** `App` knows nothing about authentication. The cost is a seam a reader has
to find by grepping for the event name, which is why both ends carry a comment.

## ADR-23 — Telling an explicit zero apart from an empty headcount

**Context.** A coach filling in per-stop numbers may enter `0` ("nobody there this time")
or leave the field blank ("I do not know yet"). Treating both as zero leaves children
behind.

**Decision.** The editor stores a cleared field as `""` and a typed zero as a number.
`zeroed()` only drops the explicit zero, and `legPax` returns the **maximum** of the
breakdown and the stated total.

**Consequence.** A half-filled breakdown can never shrink a team. This is principle E6,
and it exists because the alternative failure is the worst one this system can produce.

## ADR-24 — Every skip gets a reason

**Context.** The users are club staff. "Something went wrong" is useless to them, and so
is a task that quietly does not appear.

**Decision.** Every skipped or uncovered item carries a sentence naming the cause and,
where possible, the fix. When a new constraint is added, the explanation is part of the
feature.

**Consequence.** More code on the failure branches than on the happy path in places, and
that is the right ratio here. `optimizeDay` even reports when its search hit the iteration
cap rather than claiming an optimum.

**Known violation.** `taskHardIssues` in `ScheduleScreen` duplicates part of the
feasibility check and omits the vignette case, so a task blocked only by that shows no
reason. See risk R6 and `ACTION_PLAN.md` P0-2.

## ADR-25 — Hungarian UI, English everything else

**Context.** The users are Hungarian club staff and drivers. Contributors may not be.

**Decision.** Every user-visible string is Hungarian. Code, comments, documentation and
commit messages are English.

**Consequence.** Two Hungarian words remain in the code as **stored data values**, and are
not translated: a ride's direction (`oda`, `vissza`) and the driver role (`sofor`).
Renaming them would be a data migration, not a translation, and would break every saved
blob. They are listed in the architecture glossary.

## ADR-26 — Vitest and jsdom, tests against the real modules

**Context.** The domain is pure and easy to test; the UI rules (roles, mandatory
coordinate, fixed direction) are exactly the ones worth pinning down on screen.

**Decision.** Vitest with jsdom. Domain tests import the real modules directly; UI tests
mount components. `window.storage` is filled with a stub.

**Consequence.** The whole suite runs in about ten seconds without a network or a
database. Not covered: the real Supabase round trip, the Leaflet path, and CSP behaviour
under production headers. Those are manual checkpoints in `MAINTENANCE.md`.

## ADR-27 — An error boundary inside the shell

**Context.** One throw on any screen produced a white page the user could not even
navigate away from to fix the data that caused it.

**Decision.** An error boundary inside the shell, offering the two useful exits: reload,
or open the earlier snapshots. The full stack goes to the console; the text shown to the
user stays short.

**Consequence.** A screen crash stays a screen crash. Deliberately a class component,
since that is still the only way to write a boundary in React.

**Follow-up.** Production sourcemaps now ship, so a console stack from a real user is
readable. Reporting them anywhere is still open — risk R9.

## ADR-28 — One stylesheet, OS-driven dark mode

**Context.** The styling had grown into two parallel systems with two token namespaces,
one aliasing the other, plus Tailwind utilities and inline styles.

**Decision.** One stylesheet, `src/ui/styles.css`, defining every token once. It keeps two
class namespaces with a stated boundary: `.shell-*` for the frames outside the app proper
(login, error boundary, restore panel, toast) and unprefixed for the app itself. Tailwind
is for layout only.

**Consequence.** Changing a colour is one edit. The `[data-theme]` override was removed:
nothing ever set that attribute, and dead theming is worse than none. Dark mode follows
the operating system.

**Still open.** 146 inline style objects remain and should migrate into classes over time.
See `ACTION_PLAN.md` P1-2.
