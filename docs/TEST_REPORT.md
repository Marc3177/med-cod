# Med-Cod — End-to-End Browser Test Report

**Date:** 2026-09-07
**Method:** Live browser walkthrough (Claude Browser tool) driving the real running app against real data — no mocks. Every action below was verified either by reading the actual rendered page, checking the network request that fired, or querying the database directly.

## Scope

A full round-trip across all five roles, using a mix of pre-existing test data and one freshly FHIR-ingested encounter, covering every phase built (1–7):

1. **Coder** — login (including a wrong-password negative test), work queue, encounter detail, encoder search (direct + synonym-index), suggestions panel, DRG panel, diagnosis/procedure assignment, save draft, raise/send a query, resolve a query, finalize.
2. **Auditor** — QA review queue, approve.
3. **Provider** — pending query queue, respond.
4. **Supervisor** — Reports dashboard, before and after the session's activity, to confirm every metric is live-computed.
5. Cross-cutting: QA sampling triggering automatically on finalize, an encounter cycling through **finalize → QA return → recode → resolve query → re-finalize → re-sample**.

## What was confirmed working, exactly as designed

- **Login**: correct success and failure paths (wrong password shows an inline error, doesn't crash).
- **Work queue**: correctly filtered to the coder's own facility, excludes `FINALIZED` and `QA_REVIEW` encounters.
- **Encounter detail**: renders real FHIR-ingested documentation verbatim; encoder search returns both direct code matches and index-based synonym matches (with the matching index phrase shown as evidence); DRG panel updates live as diagnoses/procedures change; Suggestions panel disappears once its only candidate is accepted; Queries panel supports the full draft → sent → responded → resolved lifecycle.
- **QA workflow**: an encounter finalized mid-session was correctly auto-sampled into `QA_REVIEW`; the auditor's queue showed it with the right DRG; approving it correctly returned the encounter to `FINALIZED`.
- **Query workflow**: raised by the coder, sent, correctly appeared in the provider's facility-scoped queue (and only there), responded to, then resolved by the coder — encounter status transitioned `New → In Progress → Query Pending → In Progress` correctly at each step.
- **Recode-and-refinalize loop**: an encounter returned from QA with a specific, actionable reason ("J189 is not specific enough — recode") was correctly recoded (J189 → J13, using the provider's query response as the clinical justification), re-finalized, and correctly re-sampled into QA a second time.
- **Reporting**: every number on the Supervisor dashboard changed exactly as expected across the session (first-pass acceptance, specificity capture, QA return rate, coder productivity, pipeline workload) — confirmed against the same data actually produced by the walkthrough, not a separate fixture.

## Real bugs found and fixed during this pass

### 1. Stale QA-return banner after re-finalizing (fixed)

**Symptom:** After an encounter was returned from QA, recoded, and re-finalized — triggering a brand-new `PENDING` QA sample — the encounter page kept showing the *old* "Returned from QA Review" banner with the stale reason, even though a new review had superseded it.

**Root cause:** `EncounterDetail.tsx` fetched QA review history once on mount but never refetched it after `finalize()`, even though finalizing can trigger a brand-new QA sample server-side.

**Fix:** `finalize()` now calls `loadQaReviews()` alongside the existing `load()` refresh. Verified fixed: reloading the page after the second finalize showed the banner correctly gone, with only the current `PENDING` review present.

Files: [apps/web/src/pages/EncounterDetail.tsx](../apps/web/src/pages/EncounterDetail.tsx)

### 2. Principal diagnosis didn't auto-promote after removal (fixed)

**Symptom:** Removing the diagnosis marked "Principal" left the remaining diagnosis as "secondary" rather than auto-promoting it — the backend correctly rejected finalize with zero principal diagnoses (no bad data reached the database), but it was an unexpected extra click for a coder.

**Fix:** `removeDiagnosis()` now auto-promotes the first remaining diagnosis to principal when the removed one was principal. Verified live: added J189 (principal) + E119 (secondary), removed J189, confirmed E119 instantly became principal with the DRG panel live-recomputing to the new correct value — no extra click needed.

Files: [apps/web/src/pages/EncounterDetail.tsx](../apps/web/src/pages/EncounterDetail.tsx)

### 3. Encoder didn't expand common clinical abbreviations (fixed)

**Symptom:** Searching **"COPD"** returned zero results — the ICD-10-CM Alphabetic Index and code descriptions both use the spelled-out term ("Chronic Obstructive Pulmonary Disease"), never the acronym.

**Fix:** New `terminology` module with a curated `ClinicalAlias` table (26 common inpatient abbreviations — COPD, MI, CHF, AKI, CKD, UTI, DVT, PE, CVA, TIA, etc.), wired into both the encoder search and the suggestions engine. Verified live: "COPD" now returns J441 and related codes with full evidence trails; a batch of 10 abbreviations (MI, CHF, AKI, UTI, DVT, PE, CVA, TIA, CAD) all confirmed returning clinically correct results.

**Two further real bugs surfaced and fixed while building this:**

- **~11% of the ICD-10-CM index was silently unresolvable.** Codes ending in "-" (e.g. "I82.40-") are the Index's own convention for "additional characters required" — a code *stem*, not a complete code. The original importer stored these as exact-match `code` entries, so every lookup against the real code table silently failed (6,955 of 63,138 entries affected). Only surfaced once abbreviation expansion (DVT → "deep vein thrombosis") happened to route a search through one. Fixed by re-importing these as `prefix` entries, resolved the same way the PCS index already handles its own table stubs.
- **Short abbreviations (2–3 letters) were drowning in false positives from the direct description search.** "MI" matched "middle" (inside an unrelated tuberculosis code), "AKI" matched "anisakiasis" — plain substring search has no word-boundary awareness. Fixed by gating the direct free-text description search to queries of 4+ characters (the abbreviation path already goes through the properly-expanded, word-bounded index search instead).
- **Expansion itself introduced a new false-positive category**, caught by testing, not inspection: expanding "COPD" injects the word "disease" into a sentence, which spuriously satisfied unrelated single-word index entries like "Erb's, disease" in the suggestions engine. Fixed with a small stoplist of overly generic medical words (disease, syndrome, disorder, condition) that never count as distinctive on their own, regardless of length.

Files: [apps/api/src/modules/terminology/](../apps/api/src/modules/terminology/), [scripts/import-icd10cm-index.ts](../scripts/import-icd10cm-index.ts), [scripts/seed-clinical-aliases.ts](../scripts/seed-clinical-aliases.ts), [apps/api/src/modules/encoder/encoder.service.ts](../apps/api/src/modules/encoder/encoder.service.ts), [apps/api/src/modules/suggestions/suggestions.service.ts](../apps/api/src/modules/suggestions/suggestions.service.ts)

**Update — the "known remaining limitation" above was itself a fixable bug, not a fundamental limit (see "Clinical understanding" scoping below).**

## Post-MVP intelligence features (verified in later sessions)

These were built and verified after the initial 7-phase pass above, each as its own bounded, testable slice.

### Documentation-gap detection

A `ClinicalIndicator` reference table (5 seeded: creatinine, sodium low, potassium high/low, troponin) flags when a lab value is documented but nothing coded addresses it — e.g. creatinine 2.1 with no AKI/CKD diagnosis coded. Deliberately scoped so its output type has **no code field at all**, only a `suggestedQuery` string — a potential gap can only ever become a query, never an auto-produced diagnosis.

Verified live: seeded an encounter with an elevated creatinine and low sodium, neither addressed by the initial coding. Both gaps appeared correctly. Clicking "Raise Query" on the creatinine gap created a real `DRAFT` query pre-filled with the suggested question, and the gap itself disappeared from the list once a related diagnosis was coded (prefix-matched, not exact-matched — see bug #9 below).

**Bug caught before shipping:** the "already coded" check originally compared coded diagnosis codes for exact match against an indicator's related-code prefixes (e.g. checking whether the literal string `"N17"` was in the coded set, which a real code like `"N179"` would never satisfy). Fixed to use prefix matching (`code.startsWith(prefix)`) before any testing happened.

Files: [apps/api/src/modules/documentation-gaps/](../apps/api/src/modules/documentation-gaps/), [scripts/seed-clinical-indicators.ts](../scripts/seed-clinical-indicators.ts)

### Chart Intelligence

A chart-overview panel aggregating the existing Suggestions and Documentation-Gap services into one summary — confirmed findings (already coded, resolved to real descriptions), potential findings (suggested but not yet coded, each with its evidence excerpt), and a gap count. Deliberately **not** a new extraction engine: it reuses the same two services' outputs rather than re-matching text, so there's one source of truth for match quality, not two.

Verified live: seeded an encounter documenting COPD (already coded as principal), aspiration pneumonia, an elevated creatinine, and low sodium. The panel correctly showed COPD as the sole confirmed finding, three potential findings (aspiration pneumonitis, pneumonia, AKI) each with real evidence text — correctly excluding COPD since it was already coded — and a gap count of 2. Clicking a potential-finding pill correctly scrolled the Documentation panel to the source document and applied a 2-second amber highlight before fading.

Files: [apps/api/src/modules/chart-intelligence/](../apps/api/src/modules/chart-intelligence/), [apps/web/src/components/ChartIntelligencePanel.tsx](../apps/web/src/components/ChartIntelligencePanel.tsx)

### Change detection ("what's changed since you last looked at this chart")

Tracks, per user per encounter, a `viewedAt` timestamp (`EncounterView` table). On load, the encounter page diffs the current state against that timestamp and shows a banner for anything that happened since: a new document, coding edited by a different user (via `AuditEntry`, filtered to exclude the current user's own edits), a provider's query response, or a QA return with its reason. Nothing here needed new matching logic — it's a straight timestamp comparison across tables that already existed.

Verified live: seeded an encounter, viewed it once (banner correctly absent — nothing has a "before" to diff against on a first-ever view), then simulated a second coder editing the coding, a new document being added, a provider responding to a query, and QA returning the encounter, all as other users. Reloading showed all four lines in the banner; a follow-up reload showed it gone (already acknowledged); and a coding edit made by the viewing coder themself was confirmed to *not* trigger the banner.

**Real bug caught during testing, not by inspection:** the first version of this feature did the read (diff) and the write (advancing `viewedAt`) in a single `GET`. React 18 StrictMode's double-effect-invocation in dev fired that `GET` twice on mount; the two requests raced, and the second one — reading the timestamp the first had *just* advanced — reported an empty diff. Because whichever response resolved last won the state update, the banner would sometimes render and then immediately vanish, or never appear at all, non-deterministically. This wasn't a dev-tooling-only quirk: the same race would hit two open tabs, or any retried request. Fixed by splitting the endpoint into a pure-read `GET /encounters/:id/chart-changes` (safe to call any number of times) and a separate `POST /encounters/:id/chart-changes/ack` that advances the timestamp — confirmed fixed by calling `GET` twice in a row after seeding real changes and getting identical, correct results both times.

Files: [apps/api/src/modules/chart-changes/](../apps/api/src/modules/chart-changes/), [apps/web/src/components/ChartChangesBanner.tsx](../apps/web/src/components/ChartChangesBanner.tsx), [apps/api/prisma/app/schema.prisma](../apps/api/prisma/app/schema.prisma)

### Decision explanation ("why this code?")

A "why?" affordance on every coded diagnosis, coded procedure, and pending suggestion opens a "Candidate Code" card: the full description, whether the code is billable, whether its own description says "unspecified" (a prompt to check for something more specific — not a claim that it's wrong), whether it's flagged as a CC or MCC in the reference data (and therefore affects DRG severity if coded as secondary), the evidence sentence that originally surfaced it (click to jump to and highlight the source document, reusing the same jump/highlight mechanism as Chart Intelligence), or an explicit note when there is no evidence because the coder added the code directly rather than accepting a suggestion. Like Chart Intelligence, this reuses `SuggestionsService` for evidence rather than re-deriving it — one source of truth for what counts as evidence.

Verified live against a real encounter: a principal diagnosis coded as "Pneumonia, unspecified organism" correctly showed the specificity warning and its real evidence sentence with a working jump-to-source click; a secondary diagnosis added directly (not from a suggestion) correctly showed no specificity warning and the "added directly by a coder" fallback instead of evidence; querying a code known to be MCC-flagged in the reference data correctly returned that flag; an invalid code and a missing `codeSystem` both correctly returned 400s instead of silently returning something misleading.

Files: [apps/api/src/modules/decision-explanation/](../apps/api/src/modules/decision-explanation/), [apps/web/src/components/DecisionExplanationCard.tsx](../apps/web/src/components/DecisionExplanationCard.tsx)

### Evidence graph (multi-source evidence per code)

`SuggestionsService.listSuggestions` originally stopped at the first sentence that matched a given code — enough to justify a suggestion, but it discarded every other independent mention once one was found. `listAllEvidence` is the same underlying scan with that early exit removed: every (sentence, index term) match is kept, so a code documented in more than one place (e.g. mentioned in both the H&P and the discharge summary) surfaces every one of those mentions rather than just the first. `listSuggestions` is now a thin wrapper over `listAllEvidence` (dedup to one entry per code, first match wins) — same public behavior, single underlying implementation instead of two that could drift apart. The Decision Explanation card's evidence section was extended from one excerpt to the full list, each independently clickable to jump to its own source document.

Verified live: seeded an encounter with pneumonia mentioned in three separate sentences across two documents (H&P and discharge summary). The explanation card correctly showed "Evidence (3)"; clicking the third entry (from the discharge summary) correctly highlighted that document specifically and not the H&P, confirmed by checking each document's CSS class directly rather than trusting a screenshot. A regression check confirmed `listSuggestions` and Chart Intelligence's `potentialFindings` still returned exactly one deduplicated entry per code, matching pre-refactor behavior.

Files: [apps/api/src/modules/suggestions/suggestions.service.ts](../apps/api/src/modules/suggestions/suggestions.service.ts), [apps/api/src/modules/decision-explanation/decision-explanation.service.ts](../apps/api/src/modules/decision-explanation/decision-explanation.service.ts), [apps/web/src/components/DecisionExplanationCard.tsx](../apps/web/src/components/DecisionExplanationCard.tsx)

### Unified chart-review workflow

A "Chart Review" summary bar now sits at the top of the encounter page — confirmed conditions, potential coding opportunities, documentation gaps, changes since last visit, and distinct evidence sources, all as plain counts. It's pure client-side aggregation of data the page was already fetching (Chart Intelligence, Documentation Gaps, Chart Changes) — no new backend endpoint needed for the summary itself.

The real gap this closed was in the Suggestions panel: it only ever offered Accept or a session-only Dismiss that silently came back on reload. It now offers all four real outcomes a suggestion can reach — **Accept** (unchanged), **Reject** (new — persisted per encounter via a `RejectedSuggestion` table, so it does *not* come back on reload or for a different coder opening the same chart), **Modify** (re-focuses the diagnosis/procedure search box on the suggestion's own matched term, so the coder picks a more specific real code instead of the suggestion being accepted as-is or typed from scratch), and **Query** (raises a real query pre-filled with the suggestion's evidence, reusing the same mechanism Documentation Gaps already used).

Rejection is enforced once, centrally: `SuggestionsService.listActiveSuggestions()` filters `listSuggestions()` against the rejected set, and both the Suggestions panel and Chart Intelligence's `potentialFindings` now go through it — a suggestion rejected in one place can't keep showing up in the other, the same "one source of truth" principle behind Chart Intelligence and Decision Explanation.

Verified live end to end: seeded an encounter with two suggestions (pneumonia, an AKI-suggestive creatinine). **Reject** on one correctly removed it from both the Suggestions panel and Chart Intelligence, confirmed via a follow-up `GET /suggestions` and `GET /chart-summary` both omitting it, and the Chart Review tile count dropping from 2 to 1 live in the browser. **Modify** on the other correctly pre-filled the diagnosis search with "Pneumonia" and surfaced real organism-specific codes (J13, J14, J150...) instead of blindly accepting the unspecified one. **Query** correctly created a real `DRAFT` query carrying the evidence excerpt as its clinical indicators, confirmed via the actual response body, not just a UI check.

Files: [apps/web/src/components/ChartReviewSummary.tsx](../apps/web/src/components/ChartReviewSummary.tsx), [apps/web/src/components/SuggestionsPanel.tsx](../apps/web/src/components/SuggestionsPanel.tsx), [apps/api/src/modules/suggestions/](../apps/api/src/modules/suggestions/), [apps/api/prisma/app/schema.prisma](../apps/api/prisma/app/schema.prisma)

### Clinical understanding — scoped, and mostly already fixed

Before committing to a new "clinical concept normalization" layer (raw text → concept → normalized concept → evidence), the actual cause of the documented COPD-exacerbation gap was investigated by pulling the real `SynonymIndexEntry` rows for J440/J441/J449 rather than guessing. The Alphabetic Index entry for J441 is the literal import-preserved tree path `"Disease, diseased, pulmonary, chronic obstructive, with, exacerbation"` — a real, correct parent-child path through the CMS index (see `scripts/import-icd10cm-index.ts`'s `walkTerm`), not a flattening bug. Two separate word-filtering bugs in `SuggestionsService`, not a missing architecture layer, were the actual cause:

1. `GENERIC_MEDICAL_WORDS` (disease, diseased, syndrome, disorder, condition) was only consulted to decide whether an *entire entry* qualified for matching (`isDistinctiveEnough`) — it was never actually removed from the word list the `.every()` match check required. An entry with plenty of real content words (pulmonary, chronic, obstructive, exacerbation) still additionally demanded the literal alternate spelling "diseased", which essentially never appears in real documentation alongside "disease".
2. `"with"` is the Alphabetic Index's own standard subheading convention for introducing an associated/combination condition (exactly what happens here: "...chronic obstructive, **with**, exacerbation") — not real clinical content. The code's own comment already said connectors like "with" should be filtered, but "with" is exactly 4 characters, the same as `MIN_SIGNIFICANT_WORD_LENGTH`, so it silently passed the length filter meant to catch it.

Both are now stripped inside `significantWords()` itself, so the distinctiveness check and the actual required-word list can never disagree. Verified against real data: `"Patient admitted with acute COPD exacerbation."` — which previously returned zero suggestions — now correctly returns both J449 (unspecified) and, more specifically, **J441 (COPD with acute exacerbation)**. Regression-checked against every case this fix could plausibly break: a sentence containing only bare "disease"/"syndrome" mentions with no real distinctive term still correctly returns nothing (the original "Erb's, disease" false-positive fix is unaffected, since that entry is still excluded upstream by `isDistinctiveEnough` for having zero non-generic words), and both previously-passing cases (aspiration pneumonia, the original COPD test) still match correctly.

**What this means for "Clinical Understanding" as a bigger initiative:** the dictionary-matching approach is more capable than it looked — a large fraction of "obviously-coded condition doesn't surface" cases were this same class of bug (a required word that's structurally a connector or a synonym-alternate spelling, not real content), not evidence that word-matching is the wrong approach. A bigger concept-normalization layer is not recommended as the next step; if further gaps surface, the right move is the same one used here — pull the actual index rows for the missing code and find the specific word-list defect — before reaching for new architecture.

Files: [apps/api/src/modules/suggestions/suggestions.service.ts](../apps/api/src/modules/suggestions/suggestions.service.ts)

### Broadening the word-filter fix — a data-driven sweep, not a guess

The COPD fix touched matching logic used for every single suggestion, so before considering it closed, the whole FY2026 ICD-10-CM index (63,138 entries, 13,466 distinct significant words) was analyzed for other words behaving the same way "with" did: appearing as a bare, isolated tree-node segment (a strong signal of a structural subheading rather than real clinical content) at high frequency.

The sweep found one more real case at meaningful scale: **"specified"** appears as its own isolated segment in 118 entries (e.g. `"Complication, transplant, specified, tissue, infection"` → T86.892, "Other transplanted tissue infection") — the same shape of bug as "with", just a smaller blast radius. It was added to the existing generic-word list. A second, much smaller case, **"from"** (3 isolated occurrences, e.g. `"Hemorrhage, hemorrhagic, from, tracheostomy stoma"`), was added to the connector list at essentially zero risk.

Several other high-frequency candidates were checked and deliberately **not** touched, because the same isolated-segment check showed they carry real clinical meaning: **"type"** (74 isolated occurrences, almost all followed by a Roman numeral — "type I" vs "type II" are different codes), **"site"** and **"body"** (real anatomical content — e.g. mandible *body* vs ramus), and **"without"** (only 8 isolated occurrences across the entire index, all inside real phrases like "without adequate housing," not a structural marker the way "with" is). This distinction — checking whether a word is ever an isolated segment on its own, not just how often it appears at all — is what separates a real fix from a guess that could just as easily have introduced new false positives.

Verified live: a sentence built specifically to satisfy every real content word of the T86.892 entry ("transplant complication with tissue infection") now correctly surfaces it, where it previously would have required the literal, undocumentable word "specified." Regression-checked: the COPD/J441 fix still holds, and a sentence containing only generic/connector words ("specified," "disorder," "from," "unspecified") and no real clinical content still correctly returns zero suggestions.

### Query-to-code linkage

`Query` gained two optional columns, `relatedCode`/`relatedCodeSystem`, set only when a query is raised from a Suggestion's new "Query" action (Decision Explanation, Chart Review workflow) — never when raised from a Documentation Gap, which by design has no code to link to (`potential query ≠ diagnosis` — see the Documentation Gaps section above). Decision Explanation's vague "N open queries on this encounter" line was replaced with a real, scoped list: `relatedQueries`, filtered to exactly the code being explained. The Queries panel also gained a small "Re: J189"-style badge on any query that carries the link, for encounter-level context.

Verified live: raised a query from a J189 suggestion, confirmed via the real response body that it carried `relatedCode: "J189"`; confirmed Decision Explanation for J189 listed it while Decision Explanation for a different code on the same encounter (N179) correctly showed an empty list — no cross-code leakage; confirmed a gap-originated query still has `relatedCode: null`; confirmed visually in the browser that the "Re: J189" badge and the "Queries about this code" section both render correctly. Permanent test coverage added for the scoping property specifically: same code passes, different code on the same encounter doesn't leak, same code-string-but-different-codeSystem doesn't leak, and an unlinked (gap-originated) query never shows as related to anything.

Files: [apps/api/prisma/app/schema.prisma](../apps/api/prisma/app/schema.prisma), [apps/api/src/modules/queries/](../apps/api/src/modules/queries/), [apps/api/src/modules/decision-explanation/](../apps/api/src/modules/decision-explanation/), [apps/web/src/components/QueriesPanel.tsx](../apps/web/src/components/QueriesPanel.tsx), [apps/web/src/components/DecisionExplanationCard.tsx](../apps/web/src/components/DecisionExplanationCard.tsx)

## Testing-tool notes (not app bugs)

Several clicks during this session landed on stale element references from a prior screenshot/render and silently no-op'd (no network request fired). Every such case was caught by cross-checking the network request log or database state after the action, and retried with a fresh element reference or direct coordinates — never assumed successful from a screenshot alone. This is a property of the browser-automation tooling, not the application; it's noted here only because it explains why some steps in this report show a "first attempt failed, retried" pattern.

## Overall assessment

The application is in a solid, genuinely working state end to end across all five roles and seven build phases. Every core workflow was exercised with real data, not scripted happy-path assumptions, and every real issue this pass surfaced — six in total, spanning the frontend, the encoder, the suggestions engine, and the original index import — was fixed and re-verified rather than glossed over. The system's own honesty conventions — the DRG grouper's "simplified approximation" labeling, the suggestions panel's evidence-first design, the explicit multi-facility isolation — all held up under actual use, not just code review.
