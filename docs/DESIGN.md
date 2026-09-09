# Med-Cod — UI Design Baseline

## Typography

- **Font**: sans-serif only (Inter, falling back to system UI sans-serif stack).
  This is a data-entry/review application, not a reading surface — no serif fonts.
- **Sizes**: fixed two-step scale, defined once in `apps/web/tailwind.config.js`,
  never overridden per-component:
  - `text-sm` (13px) — default body text, form fields, primary content
  - `text-xs` (11px) — dense data: tables, code lists, audit logs, secondary metadata
- No other font sizes are introduced without updating the Tailwind config first —
  this keeps the whole app visually consistent instead of drifting screen by screen.

## Data integrity principle ("no mistakes at the start")

This shows up as concrete engineering decisions, not just a slogan:

1. **Strict TypeScript everywhere** (`tsconfig.base.json`) — `strict`,
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all on from commit one.
2. **One schema, two consumers** — validation rules live once, in
   `packages/shared` (Zod), and are imported by both the API (request validation)
   and the web app (form validation). A rule can't be correct in one place and
   wrong in the other.
3. **Bulk imports never touch live data directly** — see
   `apps/api/src/modules/import/import.service.ts` for the
   validate → stage → apply pattern. A malformed CMS file or a bad batch of
   charts fails validation and is rejected wholesale, before anything is written.
4. **Every coding decision change is audited** (`AuditEntry` in `app.prisma`)
   from Phase 1, not retrofitted later.
