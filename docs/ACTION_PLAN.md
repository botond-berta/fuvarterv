# Fuvarterv — action plan

The result of a codebase review: **what is worth doing, in what order, and how you will
know it is finished.** Not a bug list — most items are either carrying a deliberate
trade-off forward or closing an identified weak point.

The "why is it like this" still belongs to [`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`DECISIONS.md`](DECISIONS.md); the day-to-day workflow to [`MAINTENANCE.md`](MAINTENANCE.md).
This file only orders the **work**.

Where an item closes a risk from
[`ARCHITECTURE.md` §15](ARCHITECTURE.md#15-known-risks-and-technical-debt), the `R…`
reference says which.

---

## 1. Already done

These came out of the same review and are in the code now. They are listed so the plan
reads honestly, and so nobody re-does them.

| Item | What changed | Closed |
|---|---|---|
| **Production sourcemaps** | `build.sourcemap` is on, so the error boundary's console stack points at real files instead of minified output | part of R9 |
| **The barrel is gone** | `fuvarterv.jsx` was deleted; `src/main.jsx` and every test import the real modules. `fs.allow: ['..']` went with it | the old R8 |
| **One schema file** | six migrations, two of which were a rename and its exact reversal, became one re-runnable `0001_initial_schema.sql`. The workspace key now lives in a `workspace_id()` function instead of being repeated in every policy | — |
| **One stylesheet** | `theme.css` merged into `src/ui/styles.css`; one token set instead of a `--v-*` namespace aliased onto a second one; the dead `[data-theme]` override removed; the `v-` class prefix (a leftover from an abandoned name) became `shell-` | part of ADR-28 |
| **Anonymised sample data** | real driver names and plates replaced with placeholders; stations and venues kept, since they are public places and make the distances realistic | the old R5 |
| **Dead code removed** | nine unused imports and three unused variables; lint warnings went from 20 to 10, and the remainder are all documented as intentional | part of P0-3 |
| **Everything translated** | code comments, tests and documentation are English. The UI stays Hungarian, as do two stored data values (`oda`/`vissza`, `sofor`) | ADR-25 |

---

## 2. Priorities at a glance

| # | Item | Size | Risk | Closes |
|---|---|---|---|---|
| **P0-1** | Merge the duplicated feasibility check | ~1 hour | low | R6, an ADR-24 violation |
| **P0-2** | Clear the remaining 10 lint warnings | ~1 hour | none | — |
| **P1-1** | Migrate the inline styles into classes | 1–2 days | medium | part of ADR-28 |
| **P1-2** | Split up the large screen components | 1–2 days | medium | — |
| **P1-3** | Machine-enforce the import boundaries | ~2 hours | low | R4 |
| **P2-1** | Stable task ids | 1–2 days | **high** | R1 |
| **P2-2** | Bundle splitting (Leaflet, Supabase) | ~half a day | low | — |
| **P2-3** | Error reporting from production | ~half a day | low | R9 |

**Suggested order.** P0 fits in one pull request. The P1 items are independent and can go
in any order. P1-2 is worth doing before P2-1, since `ScheduleScreen` will change anyway.

---

## 3. P0 — immediate, cheap, high value

### P0-1 · Merge the duplicated feasibility check

**Why.** The same feasibility test lives in two places, and they have **already drifted**:

| Check | `optimizeDay` (`src/domain/optimizer.js`) | `taskHardIssues` (`src/screens/ScheduleScreen.jsx`) |
|---|---|---|
| capacity (`pax > maxSeats`) | yes | yes |
| driver availability | yes | yes |
| **motorway vignette** | **yes** | **no** |

The consequence: an uncovered task blocked **only** by a missing vignette appears in the
uncovered list with **no reason at all**. That is precisely what
[ADR-24](DECISIONS.md#adr-24--every-skip-gets-a-reason) forbids — there is no silent skip.

**What to do.** Move the check into the domain, into one function, and have both callers
use it:

```js
// src/domain/optimizer.js
export function taskFeasibility(state, weekday, t) { /* all three reasons, one place */ }
```

- `optimizeDay` calls it in its "hard feasibility of the free tasks" block.
- `taskHardIssues` disappears; `ScheduleScreen` calls `taskFeasibility`.

**Verification.** A new test: a state where the venue has `needsVignette: true` and no
vehicle carries one. The task should land among the uncovered, and its `reasons` array
must **not** be empty. That test fails on today's code, which is the proof the bug is
real.

### P0-2 · Clear the remaining 10 lint warnings

**Why.** Every CI run is green with 10 warnings. An eleventh — possibly pointing at a real
defect — would go unnoticed. Noise cancels out the lint's value.

**What to do.** All ten are either `react-hooks/exhaustive-deps` or
`react-hooks/set-state-in-effect`, and all are currently intentional. Two deserve a real
fix rather than a silence:

1. **`UsersPanel.jsx`, `set-state-in-effect`.** The "no server configured" branch should
   not set state in an effect. `isConfigured` is known before render, so it belongs in the
   `useState` initialiser.
2. **`ScheduleScreen.jsx`, `exhaustive-deps`.** `weekMon` is a fresh `new Date()` on every
   render, so adding it to the dependency array would disable the memo entirely. Today's
   omission is pragmatic but carries a latent bug: the screen sticks to the week the memo
   first ran in, so a session left open across Sunday midnight shows the wrong week. Fix
   it by making `weekMon` a **stable, comparable value** (the ISO string of the Monday) in
   the dependency array, and deriving the date inside the memo.

The rest should be silenced individually with `eslint-disable-next-line` **and a
one-sentence reason**. A silent exception is worse than a warning.

Once the list is empty, consider promoting `no-unused-vars` from `warn` to `error` so dead
code cannot creep back.

**Verification.** `npm run lint` reports `0 problems`, and `npm test` stays at 168.

---

## 4. P1 — real debt

### P1-1 · Migrate the inline styles into classes

**Why.** The two parallel stylesheets are gone, but **146 inline `style={{…}}` objects**
remain across 16 files, alongside roughly 510 `className` attributes. Changing one colour
still depends on which mechanism a given component happened to use.

| File | Inline styles |
|---|---|
| `ScheduleScreen.jsx` | 25 |
| `RideScreen.jsx` | 16 |
| `TeamsScreen.jsx` | 15 |
| `DriverScreen.jsx` | 15 |
| `MapPicker.jsx` | 14 |

**What to do.** Not a single sweep. Start with the top files; anything that appears twice
becomes a class. What is genuinely unique and computed (a team's colour, for instance) may
stay inline — an inline style is not wrong in itself, its **arbitrariness** is.

Keep the rule Tailwind is held to: layout utilities only, never colour, size, typography
or state.

**Verification.** No automated measure; the count is the measure. Get
`grep -ro 'style={{' src | wc -l` from 146 to under 50. After each pull request, `npm test`
(the smoke test renders every tab) plus a look at a preview deployment.

### P1-2 · Split up the large screen components

**Why.** Five components carry the weight of the screen layer.

| Component | Lines | What it mixes |
|---|---|---|
| `RideForm` (`RideScreen.jsx`) | 267 | draft state, validation, stop editing, layout |
| `ScheduleScreen` | 251 | eight `useState`s, the matrix call, optimisation, modals, layout |
| `MasterForm` (`MasterScreen.jsx`) | 161 | five entity types' forms in one function |
| `UsersPanel` | 153 | a network state machine, a list, and a form |
| `StopListEditor` | 147 | — |

**What to do.** The goal is not a line count but that **one component does one thing**.

- `ScheduleScreen`: the modals are already separate components. Move the remaining
  behaviour into a `useScheduleActions` hook (matrix, optimisation, ride generation) so
  the component is layout.
- `MasterForm`: make the per-entity field set data-driven (kind → field descriptors)
  rather than branching.
- `RideForm`: pull the stop-list editing into its own component, following
  `StopListEditor`.

**Verification.** `smoke.test.jsx` renders every tab, and `training-stops-ui`,
`master-coord`, `ride-direction` and `vignette-ui` pin the specific behaviour. That is the
net for this refactor. **If a split forces you to change a test, that is the signal:
behaviour moved, not just shape.**

### P1-3 · Machine-enforce the import boundaries (R4)

**Why.** The layering is a **convention**, not a rule. An import from `screens` into
`supabaseClient`, or from `domain` into `ui`, fails no check. It surfaces only if somebody
notices in review.

**What to do.** `eslint-plugin-import` (or `eslint-plugin-boundaries`) with zone rules:

| Layer | May import |
|---|---|
| `src/domain/**` | only `src/domain/**` (no `window`, no network, no React) |
| `src/data/**` | `src/domain/**` |
| `src/ui/**` | `src/domain/**`, React |
| `src/screens/**` | `src/domain/**`, `src/data/**`, `src/ui/**` |
| `src/App.jsx` | any of the above |

**Verification.** After adding the rule, write a forbidden import **on purpose** and check
that `npm run lint` fails on it. Without that step the rule is decoration.

---

## 5. P2 — structural, when there is time

### P2-1 · Stable task ids (R1)

**Why.** A task's id is `${trainingId}:${suffix}:${dir}${tag}`, where `tag` is the
**capacity-split index**. Change the stops or the headcounts and a `...:vissza` id can
become `...:vissza#1` — at which point the saved chain drops out, taking its driver,
vehicle and locks with it. `resolveDay` counts this and says so (`droppedChains`), which
is correct damage control, but the schedule is still lost.

**What to do.** Make the identity split-independent (training, direction, day) and carry
the split separately (`part: 1/2`). `resolveDay` can then resolve a saved chain even when
its task has since divided, either binding both halves to the same chain or asking the
user explicitly.

**Risk.** This is a **data format change**: `assignments`' `taskIds` currently stores the
old shape. It needs an `ensureShape` upgrade, and it must not break backwards — an older
client reads the same blob. This is the only high-risk item in the plan. Do not start it
until P1-2 is done and there is time for the tests.

**Verification.** A new test: a saved chain, then a headcount change that triggers a
split. The chain's driver, vehicle and locks must **survive**. The test fails on today's
code first.

### P2-2 · Bundle splitting

**Why.** A single 524 kB chunk (151 kB gzipped) loads on every page open, containing
Leaflet and the whole Supabase client — including for drivers who only check their day
plan on a phone.

**What to do.** `MapPicker` already lazy-loads Leaflet (ADR-20); extend the pattern.
Route-level `React.lazy` for `screens/`, and `manualChunks` for `@supabase/supabase-js`
and `lucide-react`.

**Verification.** `npm run build` emits no chunk-size warning and the entry chunk is under
250 kB. Signed in as a driver, the map code should not load at all (check the network
tab).

### P2-3 · Error reporting from production (R9)

**Why.** There are four `console` calls in the whole source and no reporting. A production
error only surfaces if somebody telephones. Sourcemaps (now shipping) were the
prerequisite; without them a reported stack was unreadable anyway.

**What to do.** The smallest useful step is not an external service but keeping the error
**inside the system**: have the error boundary and `persistState`'s failure branch write a
row to an `app_errors` table (timestamp, e-mail, message, stack, app version), with RLS on
the `user_roles` pattern — insert for anyone, select for admins only. The admin then sees
from the UI what happened to the drivers.

**Alternative.** Sentry or similar: more capability, but a new external dependency, a new
`connect-src` directive, and a privacy question. A judgement call; record it as an ADR.

**Verification.** A deliberate error on a preview deployment appears in the table, and a
driver-role user **cannot** see the list.

---

## 6. Deliberately not doing this now

| Idea | Why not |
|---|---|
| **Multiple concurrent editors (CRDT or merge)** | R3 is a conscious trade-off. The single-editor model is documented, visible, and matches how the club actually works. A large step with no demonstrated need. |
| **A TypeScript migration** | The domain is already heavily tested and `ensureShape` is the runtime shape defence. The cost today (the whole tree plus the tests) exceeds the benefit. If it ever happens: `checkJS` plus JSDoc on `src/domain/` first, incrementally. |
| **Our own backend** | ADR-09. Supabase and Vercel give exactly what is needed with nothing to operate. |
| **Moving the optimizer into a Web Worker** | R8. **Measure first.** The worst case measured today is about a second and a half. Optimising without measuring is guessing. |
| **Adding Prettier** | The style is already consistent, by hand. A formatting pull request would flatten `git blame` across the whole tree — a real loss in a codebase where the comments carry the knowledge. |

---

## 7. Keeping this document honest

- An item leaves this file when it is **done and verified**, not when it is started. Move
  it to §1 with a line saying what changed.
- If an item closes an `R…` risk, remove that risk from `ARCHITECTURE.md` §15 in the same
  pull request.
- If an item needs a **decision** (P2-3's own table versus Sentry, say), the decision goes
  into `DECISIONS.md` as an ADR and this file just links to it.
- If an item turns out not to be worth doing, do not delete it: move it to
  [§6](#6-deliberately-not-doing-this-now) with the reason. Knowing which road was
  rejected is knowledge too.
