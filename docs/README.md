# Fuvarterv — documentation

| Document | What it answers | Who for |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Why is it built this way?** Layers, invariants, data flow, the scheduling pipeline, the security model, known risks. | anyone about to change or extend it |
| [`DECISIONS.md`](DECISIONS.md) | **What was decided, and what was the alternative?** 28 short decision records. | anyone questioning an existing decision |
| [`ACTION_PLAN.md`](ACTION_PLAN.md) | **What should be done next, and in what order?** Prioritised work with verification steps. | anyone planning the next piece of work |
| [`MAINTENANCE.md`](MAINTENANCE.md) | **What do I run and check?** Workflow, conventions, review and release checklists, troubleshooting. | anyone working on the code day to day |
| [`DEVELOPER.md`](DEVELOPER.md) | **How does it work?** A file-by-file, field-by-field reference. | anyone hunting a specific detail |
| [`../README.md`](../README.md) | What the product does and how to set it up. | anyone installing or using it |
| [`../supabase/migrations/README.md`](../supabase/migrations/README.md) | The database schema, the first admin, diagnostics. | anyone setting up the database |

## A suggested reading order

**New to the project:** the top-level `README` → `ARCHITECTURE.md` sections 1 to 4 →
`MAINTENANCE.md` sections 1 to 3 → then the part of `DEVELOPER.md` covering whatever you
are about to touch.

**For the scheduler:** `ARCHITECTURE.md` section 9 → `DECISIONS.md` ADR-12 through ADR-16
→ `src/domain/optimizer.js`.

**For debugging:** `MAINTENANCE.md` section 7 (symptom to cause) → the "where to look
when…" table in `ARCHITECTURE.md`.
