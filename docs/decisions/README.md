# Decision & Spec Documents

These are local, read-only copies of the locked specification chain for this
product, kept in-repo so a Claude Code session never has to re-fetch them
from the claude.ai Project to know what to build. **The claude.ai Project
("SaaS for investment Tracking") is still the canonical source** — if these
ever diverge, the Project copy wins; update both together.

Read in this order (each is the parent of the next):

1. `calculation-specification-v0.1.md` — canonical CAL-xxx/ASM-xxx formulas,
   diagnostic states (OK/INCOMPLETE_INPUT/INVALID_INPUT/STALE_INPUT), and the
   golden test cases GT-001..013 that `tests/golden/` must keep passing.
2. `architecture-adrs-v0.1.md` — system context, trust boundaries, the 14
   logical modules and their folder layout, and ADR-001..022 (treat these as
   binding constraints, not suggestions — a conflicting design needs a new,
   superseding ADR, not a silent deviation).
3. `physical-schema-rls-erd-v0.1.md` — exact table/column plan, RLS helper
   functions and policy pattern, composite tenant-aware FK pattern, and the
   migration order (0001..0019) to implement verbatim.
4. `api-application-service-contracts-v0.1.md` — every Server Action /
   route contract's request/response shape, error-code taxonomy, and the
   CV-xx verification gates.
5. `decisions-log.md` — the fast-moving running log of founder decisions;
   check "Still open" before assuming something is settled, and the "Next
   step" line for what's currently in flight.

## What's already built (see `decisions-log.md` for the authoritative status)

- `src/domain/money/decimal.ts` + `src/domain/calculations/*` — the pure
  CAL-xxx/ASM-xxx calculation engine. No DB, no I/O. Golden tests live in
  `tests/golden/calculations.golden.test.ts` (`npm test` to run).
- Everything else (migrations, RLS, auth/tenant bootstrap, Lead capture +
  conversion, Server Actions) is still to be built, per the "Next step" note
  in `decisions-log.md`.

## Non-negotiable rules carried through every doc above

- Never silently conflate ACTUAL / ESTIMATE / CALCULATED / FORECAST data.
- A missing input produces `INCOMPLETE_INPUT`, never a fabricated 0.
- A zero/undefined denominator produces `INVALID_INPUT`, never 0 or Infinity.
- Money uses `numeric(19,4)` in Postgres and `decimal.js` in TypeScript —
  never native floating point for authoritative values.
- `tenant_id` is resolved server-side from the session, never accepted from
  the client.
- `leads` and pre-conversion `property_assessments` are never exposed to
  client roles directly (service-role/server-mediated only).
- Evidence/Reporting modules exist in schema but have no UI until MVP2 —
  do not build that UI in this phase.
