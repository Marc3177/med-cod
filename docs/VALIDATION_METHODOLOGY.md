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

Four spec files exist so far (`npx vitest run` from `apps/api`, or `npm run test`),
covering the modules whose bugs were the most subtle this project found:

- `src/modules/suggestions/suggestions.service.spec.ts` — COPD-with-exacerbation, the
  "specified"/"from" word-filter fixes, the "Erb's, disease" false-positive guard,
  evidence-graph dedup and multi-evidence, and suggestion-rejection scoping.
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

All four run against the actual local dev Postgres databases — not mocks — using the
same `MRN-QA-TEST` patient every manual seed script has used, via
`src/test-support/encounter-fixture.ts` (`createTestEncounter` / `deleteTestEncounter`,
which every test calls in an `afterEach` regardless of pass/fail). This is a deliberate
choice consistent with the project's whole testing philosophy: a mocked reference table
could silently drift from the real FY2026 index and never be noticed.

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
