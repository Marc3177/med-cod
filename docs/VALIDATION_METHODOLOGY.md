# Med-Cod — Validation Methodology

This is the process behind every feature in [TEST_REPORT.md](TEST_REPORT.md): how each
slice was actually verified, not just how it was built. It exists because the process
caught real bugs — race conditions, silent false negatives, a cross-tenant leak — that
"it compiles and the screenshot looks right" would have missed. Follow it for new work;
update it when it fails to catch something.

## The core rule: no single signal is trusted alone

A feature is not "working" because the UI renders correctly. It's working because at
least two independent signals agree:

- **Rendered UI** — what the page actually shows (via `read_page` / `get_page_text`, not
  just a screenshot; see "Screenshots lie" below)
- **Network behavior** — the actual request fired and the actual response body
  (`read_network_requests`), not an assumption that a click "must have" triggered one
- **Database state** — what was actually written (a throwaway Prisma script, or a direct
  query), when the claim is about persistence, not just display

A screenshot alone confirms *something* rendered. It does not confirm the right request
fired, that the request used the data you think it did, or that the change persisted.
Every real bug caught this session was caught by a mismatch between two of these three
signals — never by inspection of the code alone, and never by a screenshot alone.

## Standard verification sequence for a new slice

1. **Typecheck both sides** (`npx tsc --noEmit` in `apps/api` and `apps/web`) before
   running anything. Cheap, catches whole classes of mistakes before they cost a
   server restart.
2. **Seed real data through Prisma, never hand-written raw SQL.** A multi-statement
   `psql -c "INSERT ...; INSERT ..."` with embedded JSON casts failed silently on this
   project (`null value in column "updatedAt"`, zero rows actually inserted) — a Prisma
   script matching the shape every other seed script uses doesn't have that failure
   mode, and reads the same as the rest of the codebase.
3. **Start dev servers cleanly.** `nest start --watch` restarts a new process on every
   save without necessarily killing the old listener — check
   `netstat -ano | grep LISTENING` on the port before assuming a fresh start, and kill
   anything stale. An `EADDRINUSE` on startup, or a route responding with **old**
   behavior after an edit, means a leftover process is still bound to the port, not that
   the fix didn't work.
4. **Hit the API directly with curl first.** Faster and more deterministic than the
   browser, and it isolates backend logic from frontend/rendering concerns. Confirm the
   real response body, not just the status code — a 200 with the wrong shape is not a
   pass.
5. **Then verify in the browser** — but corroborate, don't just look:
   - Use `get_page_text` / `read_page` to confirm actual rendered content, not only a
     screenshot (a screenshot can crop to a sub-region of a taller viewport — see below).
   - Use `read_network_requests` to confirm the request you expect actually fired, with
     the right method/body, and check the *response body*, not just that a call
     happened.
   - When the claim is about persistence or a race, use `javascript_tool` to read live
     DOM state (e.g. a CSS class, an input's `.value`) immediately after an action,
     rather than waiting for a screenshot round-trip that may arrive after a transient
     state (like a 2-second highlight) has already cleared.
6. **Regression-check, not just the new case.** Any time shared logic changes — a
   refactor like `listSuggestions` being rebuilt on top of `listAllEvidence`, or the
   word-filtering fix in `SuggestionsService` — explicitly re-test the cases that were
   already known to pass *and* the cases that were previously fixed false positives.
   "The new thing works" is not the same claim as "nothing else broke."
7. **Clean up.** Delete every seeded test/demo encounter (and any rows it created) when
   done, and stop every dev server started for the session. A stale test encounter left
   behind is next session's confusing mystery data.
8. **Write up every real bug found**, not just the features shipped — symptom, root
   cause, fix, and how it was confirmed fixed — in [TEST_REPORT.md](TEST_REPORT.md).
   "Added feature X" is a changelog; "X failed like this, because of this, fixed by
   this, confirmed by this" is what makes the report worth re-reading later.

## When a "known limitation" is reported, verify before designing around it

The instinct when dictionary/index-based matching misses a case is to reach for more
architecture (more aliases, a normalization layer, a different matching approach). Do
that last, not first. Pull the actual data the match was supposed to work against —
the real reference-table rows, the real request/response — before concluding the
approach itself is inadequate.

Case in point: a documented "the Alphabetic Index doesn't naturally match this
phrasing" limitation for COPD-with-exacerbation looked like it might need a new
clinical-concept-normalization layer. Pulling the actual `SynonymIndexEntry` rows for
the code in question showed the real cause was two small, specific bugs in how
required-match words were filtered (a generic-word stoplist that was checked but never
actually applied, and a structural connector word slipping past a length filter by
exactly one coincidence) — not a structural limit of the approach. The fix was a few
lines in one function, verified against the literal sentence that had been failing.
Guessing at the cause would have produced a much bigger, unnecessary rebuild.

## Known tool quirks — not app bugs

These have shown up repeatedly during this project's testing and are properties of the
browser-automation tooling, not the application. Documented here so a future session
doesn't misdiagnose one as a real bug:

- **Stale element references silently no-op.** A `computer` click using a `ref_N` from
  an earlier `read_page`/`find` call can land on nothing if the page re-rendered since.
  No error is raised — the click just doesn't do anything. Always verify a click did
  something (a network request fired, DOM state changed) rather than assuming success;
  get a fresh `ref` (or use coordinates from the most recent screenshot) if it didn't.
- **The screenshot pane can crop a sub-region of a taller viewport.** A `computer`
  screenshot has shown as little as 455px of a page whose actual `window.innerHeight`
  was 720px, independent of scroll position — producing an apparently "blank" capture
  that isn't blank in the DOM. When a screenshot looks wrong, check `get_page_text`,
  `read_page`, or direct DOM measurements (`getBoundingClientRect`, `scrollY`) before
  concluding the layout is broken.
- **Multi-second tool round-trips race short-lived UI state.** A 2-second highlight-then-
  fade animation can easily finish before a screenshot request returns, especially
  across several sequential tool calls. If a transient state needs verifying, batch the
  triggering action and the check into one `browser_batch` call (or an immediate
  `javascript_tool` read) rather than checking several tool calls later.

## Automated regression coverage

Every verification step above was, until now, manual and thrown away after use — a
one-off seed script, a curl call, a cleanup script, deleted at the end of the session.
That caught real bugs in the moment but left nothing behind to catch a *future*
regression of the same bug.

Thirteen spec files exist so far (`npx vitest run` from `apps/api`, or `npm run test`),
covering the modules whose bugs were the most subtle this project found, plus the P0
data-integrity invariants, workflow state machines, facility-isolation surface,
transaction atomicity, cross-service Query/QA ownership, cross-module authorization
(auth/role/facility boundaries at the guard layer), and — the final P0 gate — the full
workflow adversarial matrix (TOCTOU races found by genuine concurrent execution, not
just constructed state) around the core coding write path. See docs/TEST_REPORT.md's
"P0 Workflow Contract Matrix" for the definitive state × operation reference this
whole effort was building toward.

- `src/modules/suggestions/suggestions.service.spec.ts` — COPD-with-exacerbation, the
  "specified"/"from" word-filter fixes, the "Erb's, disease" false-positive guard,
  evidence-graph dedup and multi-evidence, suggestion-rejection scoping, the four
  synonym-form clusters, matchType "prefix" resolution, and hidden-short-word
  specificity loss.
- `src/modules/documentation-gaps/documentation-gaps.service.spec.ts` — the
  exact-match-vs-prefix-match "already coded" bug, the "above"/"below" threshold
  directions, and the "no `code` field, ever" contract (`potential query ≠ diagnosis`)
  asserted directly against the returned object's shape, not just its values.
- `src/modules/chart-changes/chart-changes.service.spec.ts` — the read/acknowledge race
  condition, by literally calling `getChanges()` twice in a row and asserting identical
  results, plus the self-edit-exclusion rule for coding changes.
- `src/modules/decision-explanation/decision-explanation.service.spec.ts` — the
  query-to-code linkage scoping property: a query linked to one code must never leak
  into a different code's explanation, even a different codeSystem sharing the same
  literal code string, and an unlinked (gap-originated) query never appears as related
  to anything.
- `src/modules/coding/coding.service.spec.ts` — P0 data integrity for the single write
  path for coded diagnoses/procedures: invalid/non-billable code rejection, the
  principal-diagnosis invariant (exactly one, enforced by a Zod `.refine`), mismatched
  `codeSystem` rejection, POA persistence and required-boolean validation, duplicate
  diagnosis/procedure codes (pinned as current-accepted behavior, not asserted correct),
  the audit trail's before/after snapshots, facility isolation, the finalize/QA_REVIEW
  state machine, and transaction atomicity for both `saveDraft()` and `finalize()` —
  including a genuine, previously-unknown bug this suite caught while being written (see
  TEST_REPORT.md): `finalize()` could be called a second time while an encounter sat in
  `QA_REVIEW`, silently overwriting the coding decision an auditor was actively
  reviewing, because the guard only excluded `FINALIZED`. This suite also caught its own
  flaky test: an assertion that finalize always leaves status `FINALIZED` ignored that
  `QA_REVIEW` is an equally valid outcome of the same call (QA sampling is randomized) —
  fixed to assert either, not by suppressing the randomness. The atomicity tests forced
  each of `saveDraft()`'s and `finalize()`'s transactions to fail partway through (a
  Prisma `$extends` query interceptor throwing on `auditEntry.create`) and confirmed no
  partial write survives either — teeth-proofed by temporarily replacing the real
  `$transaction(...)` wrapping with an equivalent non-transactional call and watching all
  three tests fail with exactly the partial-write symptom they exist to catch. This
  investigation also surfaced a real API-contract gap, documented rather than silently
  fixed: `finalize()`'s post-commit call to `qaService.maybeSampleForReview()` isn't
  wrapped in try/catch, so a sampling failure propagates to the caller as an error even
  though the finalize itself already committed successfully — the database is never left
  inconsistent (the sampling call's own transaction rolls back cleanly), but the caller
  is told an operation failed that, in fact, already succeeded.
- `src/modules/queries/queries.service.spec.ts` — the full CDI query state machine
  (`DRAFT → SENT → RESPONDED → RESOLVED`), documented from the actual implementation
  before any test was written (grepped every write site to confirm this is the only
  module that mutates `Query`). Every illegal and repeated transition, the multi-query
  "only clear QUERY_PENDING once everything is resolved" interaction, facility isolation
  on all four mutating calls, and a second real state-corruption bug this suite caught:
  neither `create()` nor `send()` checked the *encounter's* own status, so raising or
  sending a query against a `FINALIZED` or `QA_REVIEW` encounter silently overwrote it to
  `QUERY_PENDING` — making a chart under active QA review reappear in the coder's work
  queue while still sitting in the auditor's queue. A dedicated fixture helper
  (`forceIntoQaReview()`) sets status directly rather than relying on `QaService`'s
  random sampler, specifically to avoid the flaky-test trap the `CodingService` suite
  hit one file earlier. Investigating this bug also found a third instance of the same
  class in `CodingService.saveDraft()` (fixed and tested in `coding.service.spec.ts`,
  not a new file — see TEST_REPORT.md). Later extended with a **fourth instance**,
  found by cross-service Query + QA integration testing rather than a per-service pass:
  `respond()`/`resolve()` also had no encounter-status guard. Sequential API use can
  never produce a `SENT`/`RESPONDED` query alongside a `FINALIZED`/`QA_REVIEW`
  encounter (the open-query business rule prevents it) — but that's a TOCTOU race, not
  a guarantee: `create()`/`send()` can both pass their own status checks before
  `finalize()`'s transaction commits around them. The resulting state was constructed
  directly (not via the literal race) and confirmed `resolve()` would silently overwrite
  `QA_REVIEW` back to `IN_PROGRESS`. Fixed identically to the other three; teeth-proofed
  by disabling each new guard and confirming the exact corruption reproduces.
- `src/modules/qa/qa.service.spec.ts` — the auditor approve/return lifecycle
  (`PENDING → APPROVED` / `PENDING → RETURNED`, both terminal). `maybeSampleForReview()`'s
  randomness is tested by mocking `Math.random()` directly (`vi.spyOn`) rather than
  asserting on a real random outcome — both the "always samples" and "never samples"
  branches proved to have teeth by disabling the check and confirming the expected test
  fails. Every other test needing a `PENDING` review sets it up directly rather than
  depending on the sampler, same discipline as `queries.service.spec.ts`'s
  `forceIntoQaReview()`. Also covers double-approval/double-return rejection, the
  mandatory return reason, facility isolation, and the full cross-module lifecycle
  (return → recode → re-finalize → re-sample), asserting the original `RETURNED`
  review's history survives unchanged alongside the new `PENDING` one. No new bug was
  found inside `QaService` itself — informative on its own: every state-corruption bug
  this pass found lived in a different service mutating an encounter's status without
  checking whether QA already had a claim on it, never in `QaService`'s own logic.
- `src/modules/patients/patients.service.spec.ts`,
  `src/modules/fhir/fhir.service.spec.ts`,
  `src/modules/claims/claims.service.spec.ts` — the facility-isolation half of the
  ownership audit: each tested for cross-facility read/write access including via a
  *valid* ID belonging to another facility, not just a nonexistent one. No new bugs
  found in any of the three — `FhirService.ingestBundle()` has no target-ID attack
  surface by construction (every resource is freshly created, `facilityId` comes only
  from the JWT), and `PatientsService`/`ClaimsService` were already scoping every query
  correctly. New fixture helpers `createOtherFacilityEncounter` /
  `deleteOtherFacilityEncounter` in `encounter-fixture.ts` create a genuinely separate
  `Facility`+`Patient`+`Encounter` per call (a fake facility ID fails at the database's
  own FK constraint, not the application layer).
- `src/test-support/encounter-lifecycle.integration.spec.ts` — the capstone: one
  deterministic test driving the full real state machine
  (`NEW → IN_PROGRESS → QUERY_PENDING → IN_PROGRESS → QA_REVIEW → RETURNED →
  IN_PROGRESS → QA_REVIEW → APPROVED → FINALIZED`) across all three services in a single
  run, asserting at each stage that only the workflow owning the current state can
  mutate it. `QaService`'s sampling is mocked deterministically at each `finalize()`
  call. Spot-check teeth-proofed against the open-query-finalize guard rather than
  re-proofing every individual assertion, since each guard already has its own
  dedicated regression test elsewhere.
- `src/test-support/query-qa-integration.spec.ts` — the cross-service case none of the
  per-service suites cover: a query raised, answered, and resolved *entirely within* the
  window between a QA return and the next finalize, not just "return, then recode, then
  finalize." Confirms the open-query business rule applies identically the second time
  through the loop, and that the original `RETURNED` review's history and the full audit
  trail both survive intact.
- `src/modules/auth/authorization.guard.spec.ts` — the cross-module authorization audit:
  built by reading every controller's `@UseGuards`/`@Roles()` decorators first (not
  assumed), then unit-testing the real `AuthGuard`/`RolesGuard` classes directly — real
  `AuthService`, real JWT verification, and for `RolesGuard`, the actual controller
  classes/methods so the `@Roles()` metadata under test is the real decorator. A full
  HTTP-level e2e attempt (`NestFactory.create(AppModule)` + `supertest`) was tried first
  and abandoned after confirming, via a live `npm run dev` server, that it was a Vitest/
  Vite tooling limitation (guard constructor injection breaks only when this app's full
  DI graph boots inside Vitest — see TEST_REPORT.md's "Testing-tool notes"), not a real
  bug. Found and fixed one real gap: `ImportController` had no `AuthGuard` at all, the
  only controller missing it. Found and deliberately did not fix a second: only three
  controllers restrict by role at all — `CodingController`/`QueriesController`'s
  coder-facing routes have none, recorded as an open decision in Known Limitations.

All thirteen run against the actual local dev Postgres databases — not mocks — using the
same `MRN-QA-TEST` patient every manual seed script has used, via
`src/test-support/encounter-fixture.ts` (`createTestEncounter` / `deleteTestEncounter`,
which every test calls in an `afterEach` regardless of pass/fail). This is a deliberate
choice consistent with the project's whole testing philosophy: a mocked reference table
could silently drift from the real FY2026 index and never be noticed.

A cleanup-ordering bug in `queries.service.spec.ts`'s own `afterEach` was found and
fixed during this phase: it silently leaked one orphaned `Patient` row per isolation
test run (50 accumulated before being noticed) because it re-derived a patient from a
since-deleted encounter's facility relation instead of tracking the patient ID directly.
See TEST_REPORT.md for the full account; the fix generalizes to "track everything an
`afterEach` needs to delete directly, never re-derive it after an earlier delete in the
same cleanup may have already removed the path to it."

The full workflow adversarial matrix phase (see TEST_REPORT.md) added a new technique
to the toolbox: **genuine-concurrency testing**, distinct from the constructed-state
testing used everywhere else in this project. Rather than manually setting a row's
status to simulate an "impossible via the API" state, `Promise.allSettled([serviceCall(),
serviceCall()])` fires two real async calls against the same row and lets Node's event
loop and Postgres's real transaction handling produce whatever interleaving actually
occurs. This is how the `finalize()`×`finalize()` and `approve()`/`returnToCoder()`×
themselves TOCTOU races were found — constructed-state testing could show the *result*
of a bad interleaving but not prove one was actually reachable; genuine-concurrency
testing proved it directly. Both bug classes were fixed with the same pattern: a
conditional `updateMany` (`where` including the expected prior status) as the first
write inside the transaction, so Postgres evaluates the guard atomically as part of the
single `UPDATE` rather than as a separate read-then-write with a gap in between.
Teeth-proofed the same way as every other fix in this project: revert to the naive
`update()`, confirm the exact regression test fails with the predicted symptom (two
fulfilled promises instead of one), restore, confirm green.

Every one of these suites was verified to have real teeth, not just pass by
construction, the same way: temporarily revert the real fix in the source file (exact
line, not a contrived stand-in), confirm the specific test that covers it fails with a
message describing the actual old bug, then restore the fix and confirm the full suite
is green again. Done for the "specified" word filter, the prefix-vs-exact-match
documentation-gap bug, and the chart-changes race condition — each one reproduced the
exact original failure, not a different error.

These are integration tests, not unit tests, and run noticeably slower where they touch
the full ICD-10-CM index (~2s per case in `suggestions.service.spec.ts`; the other two
are fast, since they don't scan the index) — `vitest.config.ts` raises the global test
timeout to accommodate the slow ones. Requires the local dev databases to exist and be
seeded; a `NotFoundException` looking like a real assertion failure but paired with a
missing `MRN-QA-TEST` patient means the environment isn't set up, not that the code
regressed.

This is a growing pattern, not full coverage yet — most modules still have none.

## Definition of done, for any slice

- [ ] Both `apps/api` and `apps/web` typecheck cleanly
- [ ] Verified against real (seeded, not fixture-only) data via curl
- [ ] Verified in the browser via render + network + (DB where relevant) — at least two
      of the three
- [ ] Regression-checked against anything the change could plausibly have broken
- [ ] All test/demo data cleaned up; dev servers stopped
- [ ] Real bugs found (if any) written up in TEST_REPORT.md with symptom → cause → fix →
      confirmation
