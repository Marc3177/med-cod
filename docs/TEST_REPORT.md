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

### Synonym clusters — the biggest matching fix yet, found by a systematic sweep

Before committing to a "Clinical Concept Layer" (a proposed new architecture for normalizing clinical language into concepts before matching), a systematic sweep was run first: 20 common inpatient conditions across different body systems (respiratory, cardiac, renal, endocrine, infectious, GI, neuro, vascular, dermatologic), each as a realistic discharge-summary sentence, tested against the real suggestions engine. 11 of 20 passed. Investigating the 9 failures against the real index rows (not guessing) found one dominant root cause behind most of them: **CMS writes noun/adjective/verb word-form variants of the same concept as consecutive words in a single headword** — "Hypertension, hypertensive" (I10 family), "Diabetes, diabetic" (E11 family), "Thrombosis, thrombotic" (I82 family), "Failure, failed" (I50 family) — and the matching logic required every one of these spellings verbatim, when real documentation only ever uses one. Nobody writes both "hypertension" and "hypertensive" in the same sentence.

This is the same underlying defect class as the earlier "disease"/"diseased" fix, just far more widespread — that fix only handled one specific pair by fully dropping both words when a stronger stoplist made sense. Here the fix is structural: `significantWordGroups()` now groups a term's required words so that members of a verified synonym cluster form an OR-requirement (any one spelling satisfies it) while everything else stays an AND-requirement, same as before. `SuggestionsService` now exposes this via `groupsSatisfied()`.

**A fifth candidate cluster — ulcer/ulcerated/ulcerating/ulceration/ulcerative — was found and deliberately NOT included**, because checking it against the real index first (the same discipline used for every stoplist addition) found it introduces real new false positives: several pressure-ulcer entries pair the cluster with a genuinely distinguishing but *short* word that the existing 4-character length filter silently drops — `"Ulcer, ulcerated, ulcerating, ulceration, ulcerative, gum"` (K06.8) and `"...lip"` (K13.0) collapse to "does the sentence contain the word ulcer?" once the cluster relaxation applies, which is far too broad. This was caught by testing the relaxed cluster against real data *before* shipping it, seeing it produce K06.8/K13.0 for a sentence that never mentions gum or lip, and reverting just that one cluster while keeping the four verified-clean ones. Fixing the underlying short-word-drop problem generally is separate, not-yet-done work.

Verified live (re-running the same 20-condition sweep): 15/20 pass, up from 11/20, with the four synonym-cluster fixes (hypertensive urgency, type 2 diabetes, DVT, CHF exacerbation) confirmed, and the pressure-ulcer sentence confirmed to correctly return nothing (rather than the false positives the relaxed cluster would have produced) — checked by comparing before/after results for the exact same sentence, not assumed. Full regression suite re-run and green (32/32) after the change. Permanent tests added for all four fixed clusters plus an explicit "must NOT match K06.8/K13.0" test for the deliberately-excluded ulcer cluster; proved to have real teeth by temporarily removing the diabetes cluster and confirming exactly its corresponding test — and only that one — failed.

**Other findings from the same sweep, deliberately left as open items, not silently ignored:**
- A sentence mentioning bare "delirium" and "infection" matched B20 (HIV) via `"Syndrome, HIV infection, acute"` — the entry's only real content word, "HIV" (3 characters), gets dropped by the length filter, leaving "infection"+"acute" as the entire requirement, which is far too generic. Same root cause as the ulcer/gum/lip issue (short real words silently dropped), not yet fixed.
- "Cellulitis" alone matched K13.0 (`"Cellulitis, lip"`) for the same reason — "lip" dropped, leaving only "cellulitis" required.
- 5 of 20 conditions (Afib with RVR, GI bleed, respiratory failure, and the two above) remain genuine gaps or test-authoring imprecision, not yet individually root-caused.

**The scoping conclusion, matching the earlier "Clinical Understanding" finding:** a real, general fix for short-word specificity loss is worth doing, but a new concept-normalization architecture layer is still not justified — every fix in this pass, including this one (the largest so far), was a targeted, data-verified correction to the existing matching function, not a new system.

Files: [apps/api/src/modules/suggestions/suggestions.service.ts](../apps/api/src/modules/suggestions/suggestions.service.ts), [apps/api/src/modules/suggestions/suggestions.service.spec.ts](../apps/api/src/modules/suggestions/suggestions.service.spec.ts)

### Short-word specificity loss — a structured investigation, per a fixed set of diagnostic questions answered before any code changed

The synonym-cluster fix's own "delirium sentence matched HIV" and "cellulitis matched a lip entry" findings warranted a dedicated investigation before touching code, following a fixed set of questions (what's actually dropped, is it a false negative or a false positive, is the cause really word length or something else, can it be fixed inside the existing matcher, what new false positives would a fix introduce) rather than jumping to a fix.

**What's dropped, and by whom.** 570 distinct words shorter than 4 characters appear across the whole CM index. Most (`nec`, `nos`, `or`, `to`, `due`, `of`, `in`, `and`, `not`...) are genuinely non-content CMS abbreviations and English connectors. A real minority (`hip`, `lip`, `gum`, `ear`, `eye`, `arm`, `leg`, `toe`, `jaw`, `rib`...) are real anatomical content. Because matching is whole-word (`Set.has`), not substring, there's no "MI matches middle"-style noise risk from admitting them — that risk is specific to `EncoderService`'s free-text substring search, a different code path. 5,419 entries (8.6% of the index) are currently offered as matches with reduced specificity because of this.

**A second, unrelated bug was found while root-causing "why doesn't a plain 'acute MI' sentence match anything": `SuggestionsService` silently drops every `matchType: "prefix"` CM index entry** — 6,955 entries, **11.0% of the entire CM index**, the exact same count and cause as the "~11% of entries silently unresolvable" bug already fixed in `EncoderService` months earlier, just never applied to this service, which independently re-implements matching. A `matchType: "prefix"` entry is a code *stem* needing a 7th-character encounter-type extension (most S/T injury codes) — `"Abrasion, ankle"` → S90.51 is itself non-billable; the real codes are S90511A/D/S etc. Fixed by applying the exact expansion pattern already proven safe in `EncoderService.searchIcd10Cm()`: expand to real billable codes under the stem via `startsWith`, capped at 20.

**The two bugs turned out to be coupled, and testing that interaction surfaced a real regression before it shipped.** The prefix fix alone, tested against the "acute kidney injury" sentence, caused `"Injury, arm"` — an entry that had already collapsed to just "injury" once "arm" was dropped — to expand into ~20 real arm-injury codes that filled the 30-item suggestion cap and pushed the correct N17.9 result out entirely. What used to be one wrong code is now twenty. This is exactly why the investigation didn't stop at "ship the prefix fix": the short-word problem had to be fixed *before* the prefix fix could safely ship, not treated as separate follow-up work.

**The fix**, scoped precisely to the demonstrated failure mode rather than a blanket length change: a small curated `KNOWN_STOPWORDS` set (nec, nos, or, to, due, of, in, by, and, not, as, on, for, non, pre, at, the, out, use, and bare single letters) marks genuinely-safe-to-ignore tokens. Separately, `hasHiddenShortWord()` detects when an entry's *only* remaining group relies on a single long word while the original term had a real, non-stopword short word that got silently dropped alongside it — and in exactly that case, `isDistinctiveEnough()` now refuses to treat the entry as matchable at all, rather than letting it stand in for what used to be a two-part requirement. Entries with 2+ surviving groups are untouched (losing one short qualifier among several is low-risk and was left alone) — this only tightens the specific single-group collapse pattern.

**Deliberately left open, not silently ignored:** the fix only gates the *single-group* case. `"Syndrome, HIV infection, acute"` → B20 still false-positive-matches a bare "delirium... infection" sentence, because dropping "hiv" (3 characters) still leaves *two* surviving groups (infection, acute) — the multi-group branch was never gated, since doing so unconditionally would very likely break many of the 5,419 flagged entries where losing a short qualifier is genuinely harmless. This needs its own investigation (likely: recognizing that some *kept* words, like "acute", are themselves too weak to count as a real second group) before touching that branch, following the same discipline as everything else in this pass.

Verified: the 21-condition sweep (20 from the synonym-cluster pass, plus "acute MI") went from 15/20 to 15/21 net — the MI miss is a *third*, separate bug (more synonym-form clusters needed: infarct/infarction, myocardium/myocardial — not yet fixed), while the arm/kidney-injury regression and the lip/cellulitis false positive were both confirmed fixed via the adversarial matrix, and the ankle-abrasion prefix case confirmed working via a real billable-code check. Full regression suite green at 35/35 (up from 32). Every new test proved to have real teeth by temporarily disabling its corresponding fix and confirming the exact expected failure, then restoring it — done separately for the prefix fix and the hidden-short-word fix, not just once.

**The scoping conclusion, matching the earlier "Clinical Understanding" finding:** a real, general fix for short-word specificity loss is worth doing, but a new concept-normalization architecture layer is still not justified — every fix in this pass, including this one (the largest so far), was a targeted, data-verified correction to the existing matching function, not a new system.

Files: [apps/api/src/modules/suggestions/suggestions.service.ts](../apps/api/src/modules/suggestions/suggestions.service.ts), [apps/api/src/modules/suggestions/suggestions.service.spec.ts](../apps/api/src/modules/suggestions/suggestions.service.spec.ts)

## Known limitations (open, tracked, not silently ignored)

Formally recorded rather than left as a comment buried in prose — each of these was deliberately *not* fixed, with a reason, so a future session doesn't need to rediscover why.

### Multi-group weak-token matching (HIV → B20 false positive)

- **Status:** OPEN
- **Severity:** Investigate
- **Architecture change:** NO
- **Current behavior:** Known limitation, not a regression
- **Observed because:** `"Syndrome, HIV infection, acute"` → B20. Dropping "HIV" (3 characters, below `MIN_SIGNIFICANT_WORD_LENGTH`) still leaves two surviving required groups (`infection`, `acute`) — both individually real English words, neither a stopword — so the entry passes `isDistinctiveEnough`'s 2-group threshold and matches a sentence that only mentions delirium and infection, never HIV.
- **Not fixed because:** the shipped fix (`hasHiddenShortWord`) only gates the *single-group* case. Extending it to gate any multi-group entry with a dropped short word would very likely break a meaningful fraction of the 5,419 entries flagged in the sweep, where losing one short qualifier alongside 2+ other real words is genuinely low-risk (e.g. `"Abnormal, abnormality, abnormalities, electrocardiogram [ECG] [EKG]"` — dropping "ECG"/"EKG" barely matters when "abnormal" + "electrocardiogram" is already specific). Blanket-gating multi-group entries was rejected without first measuring that trade-off, same discipline that excluded the ulcer synonym cluster.
- **Required next investigation:** determine whether some *kept* words (e.g. "acute", "chronic" — real words, but weak as sole distinguishing content) should count less than others toward the 2-group threshold, then measure both new false negatives and false positives from any candidate fix against a larger evaluation set before changing matcher semantics — not another one-off heuristic.
- **Reference:** [apps/api/src/modules/suggestions/suggestions.service.ts](../apps/api/src/modules/suggestions/suggestions.service.ts) — `isDistinctiveEnough`, `hasHiddenShortWord`

### Additional un-shipped synonym clusters

- **Status:** OPEN
- **Severity:** Low (one confirmed case: "acute MI" doesn't surface I21.x)
- **Architecture change:** NO
- **Observed because:** the plain MI entry `"Infarct, infarction, myocardium, myocardial"` → I21.9 requires all four word-forms literally; real documentation uses one. Same shape of bug as the four already-shipped clusters (hypertension/hypertensive, diabetes/diabetic, thrombosis/thrombotic, failure/failed).
- **Not fixed because:** not yet individually verified against the real index for the same false-positive risk the ulcer cluster had (short co-occurring words that would collapse to over-broad matching). Every cluster added so far was checked one at a time — this one hasn't been yet.
- **Required next step:** run the same isolated-segment / false-positive check used for the other four clusters (`infarct`/`infarction`, `myocardium`/`myocardial`) before adding them.

## Stabilization: P0 automated test coverage

A deliberate shift from feature work to coverage — per the explicit call to lock in the matcher work above and make the existing intelligence hard to break before doing anything else. Target: every business-critical invariant has an automated test, not a coverage percentage.

### CodingService — the single write path for coded diagnoses and procedures

21 tests: invalid-code and non-billable-code rejection (diagnoses and procedures separately), the principal-diagnosis invariant (exactly one, enforced by a Zod `.refine` in `packages/shared`), zero-diagnoses rejection, the `encounterId` body/URL mismatch check, POA persistence for both `true` and `false`, current (undefended) duplicate-diagnosis-code behavior pinned as a deliberate documentation of what exists rather than an assumption of what should, the audit trail's `CREATE_DRAFT`/`UPDATE_DRAFT` before/after snapshots, facility isolation on both `saveDraft` and `finalize`, and the finalize/QA_REVIEW state machine.

**A real, previously-unknown bug was found while writing this suite, not manually testing beforehand.** `CodingService.finalize()`'s "already finalized" guard checked only `encounter.status === "FINALIZED"` — but `finalize()` itself calls `QaService.maybeSampleForReview()` afterward, which *randomly* (per `SAMPLING_RATE`) moves the encounter on to `QA_REVIEW`. A direct 20-run experiment confirmed the consequence: in every one of the 10 runs that landed in `QA_REVIEW`, a **second** `finalize()` call silently succeeded — overwriting the coding decision an auditor was actively reviewing, recomputing the DRG, and re-triggering QA sampling on top of an already-pending review. Fixed by rejecting `QA_REVIEW` alongside `FINALIZED`; the legitimate way out of `QA_REVIEW` remains the auditor's approve/return actions (`RETURNED` → `IN_PROGRESS`, where `finalize()` is correctly allowed again for the recode-and-refinalize loop).

**The same randomness also produced a genuinely flaky test while writing this suite**, caught before it shipped: an early assertion that `finalize()` always leaves status `FINALIZED` failed at random (`QA_REVIEW` is an equally valid, equally correct outcome of the same call). Fixed by asserting either outcome, not by suppressing or mocking the randomness — the test now reflects what the system is actually allowed to do.

Verified: a direct 20-encounter loop calling `finalize()` twice on every encounter that landed in `QA_REVIEW` — 10/10 second calls incorrectly succeeded before the fix; a deterministic regression test (set status to `QA_REVIEW` directly, not relying on the random sampler) was added and confirmed to fail when the fix is reverted, then pass again once restored, same as every other fix this session.

Files: [apps/api/src/modules/coding/coding.service.ts](../apps/api/src/modules/coding/coding.service.ts), [apps/api/src/modules/coding/coding.service.spec.ts](../apps/api/src/modules/coding/coding.service.spec.ts)

### QueriesService — the CDI/coding query state machine (Phase 1 of workflow state-machine stabilization)

Per the explicit instruction to derive behavior from the actual implementation rather than assume it: before writing any test, every `prisma.query.` call site in `apps/api/src` was grepped to confirm `QueriesService` is the *only* writer of the `Query` table (chart-changes, decision-explanation, and reporting only ever read it) — so the whole state-machine surface is contained in one file. The legal states (`DRAFT → SENT → RESPONDED → RESOLVED`, `EXPIRED` unused — no expiry job exists) and each transition's actual guards were read and documented in the spec file's own header comment before a single test was written.

23 tests: the full happy-path lifecycle with real DB assertions at each step (status, `sentAt`/`respondedAt`/`resolvedAt`, `respondedById`/`resolvedById`); every illegal transition (`send()` on non-`DRAFT`, `respond()` on non-`SENT`, `resolve()` on non-`RESPONDED`, each including a "call it twice" repeated-transition case); empty-question and empty-response rejection; the multi-query interaction (`resolve()` only returns the encounter to `IN_PROGRESS` once *every* query on it is resolved, not just one); facility isolation on all four mutating calls plus `listForEncounter`/`listPendingForProvider`; not-found handling; and `relatedCode`/`relatedCodeSystem` persistence.

**A second real, previously-unknown state-corruption bug was found and confirmed by direct experiment before any test was written** (same discipline as the `finalize()` bug): neither `create()` nor `send()` checked the *encounter's* status, only the query's. `send()` unconditionally set `encounter.status = QUERY_PENDING` — on a `FINALIZED` or `QA_REVIEW` encounter, this silently un-finalized it, or worse, made a `QA_REVIEW` encounter reappear in the coder's work queue (which explicitly excludes `QA_REVIEW`) while an auditor's `PENDING` `QaReview` for that exact encounter still existed — the same chart visible in two different queues at once. A direct experiment (finalize an encounter, force it into `QA_REVIEW`, then create and send a query against it) reproduced this every time before the fix. Fixed by applying the identical principle already established for `CodingService.finalize()`: reject `create()`/`send()` when the encounter is `FINALIZED` or `QA_REVIEW`, consistent with the CDI query workflow being part of *active* coding (per the Query model's own schema comment), not something that starts against an already-locked chart.

Verified: three deterministic regression tests (using `forceIntoQaReview()`, a fixture helper that sets status directly rather than relying on `QaService`'s random sampler — avoiding the exact flaky-test trap the `CodingService` suite hit) confirmed to fail with the intended `BadRequestException`-not-thrown message when both guards are reverted, then pass again once restored. One transient failure during the very first suite run (2 tests, an apparent Prisma connection hiccup, not reproduced across 3 subsequent full runs) was investigated and treated as environmental rather than a real flaky test, per the same "prove it, don't just retry" discipline applied to the intentional flaky-test fix in `CodingService`.

Full backend suite: 79/79 passing (up from 56). Typecheck clean. No leftover test data (including the two temporary facilities the isolation tests create) after the run.

Files: [apps/api/src/modules/queries/queries.service.ts](../apps/api/src/modules/queries/queries.service.ts), [apps/api/src/modules/queries/queries.service.spec.ts](../apps/api/src/modules/queries/queries.service.spec.ts)

### A third instance of the same bug class, found investigating QA before writing any QA test

Before writing the QA lifecycle suite, the same question that found the Query bug was asked about `CodingService.saveDraft()`: does it check the encounter's own status, or only facility? A direct experiment (finalize an encounter, force it into `QA_REVIEW`, call `saveDraft()` with different diagnoses) confirmed it did not — `saveDraft()` silently overwrote the coding decision an auditor was actively reviewing **and** unconditionally reset `encounter.status` to `IN_PROGRESS`, completely bypassing the pending `QaReview` rather than merely racing it. This is more severe than the two bugs already fixed: it happens in the single most frequently called write path (every autosave), and the auditor's eventual approve/return decision would reference coding data that no longer existed.

Fixed with the identical guard already established twice: reject `saveDraft()` when the encounter is `FINALIZED` or `QA_REVIEW`. Two deterministic regression tests added to the existing `coding.service.spec.ts` (not a new file — this is `CodingService`'s own behavior, just found via the QA investigation): one for each status, the `QA_REVIEW` case additionally asserting that the encounter status and the coding decision are both left completely untouched, not just that the call throws. Both proved to fail when the fix is reverted, then pass again once restored. Full suite 81/81 at this point (up from 79).

Files: [apps/api/src/modules/coding/coding.service.ts](../apps/api/src/modules/coding/coding.service.ts), [apps/api/src/modules/coding/coding.service.spec.ts](../apps/api/src/modules/coding/coding.service.spec.ts)

### QaService — the auditor approval/return lifecycle (Phase 2 of workflow state-machine stabilization)

Same documentation-before-testing discipline: every `prisma.qaReview.` call site was grepped first, confirming `QaService` is the sole writer of the `QaReview` table. Legal states are `PENDING → APPROVED` and `PENDING → RETURNED`, both terminal — nothing transitions a review further once it leaves `PENDING`.

14 tests, including two forms of determinism discipline learned from the two prior suites in this same pass:

- `maybeSampleForReview()`'s randomness (`SAMPLING_RATE`) is tested directly by mocking `Math.random()` (`vi.spyOn`) rather than asserting on a real random outcome — one test forces a "hit" (`Math.random` → 0), one forces a "miss" (`Math.random` → 0.999), both proved to have teeth by disabling the sampling check entirely and confirming the "hit" test fails.
- Every other test that needs a `PENDING` review sets it up directly (`seedPendingReview()`) rather than depending on `maybeSampleForReview` actually sampling, for the same reason `queries.service.spec.ts`'s `forceIntoQaReview()` exists — asserting behavior downstream of an unrelated random event is how the `CodingService` suite produced its one genuinely flaky test.

Also covered: double-approval and double-return rejection (proved to have teeth by reverting the shared `PENDING` guard and confirming all 4 illegal-transition tests fail together), the mandatory non-empty return reason, facility isolation on every mutating call plus both list methods (using a fresh, disposable facility per test, same as the Query suite), not-found handling, and the full cross-module lifecycle: return → recode → re-finalize → re-sample, asserting the *original* `RETURNED` review row is still present and unchanged (`reason` intact) alongside the *new* `PENDING` review — the audit history of a chart that cycled through QA twice is not lost or overwritten.

Unlike the Query suite, no new bug was found inside `QaService` itself — every one of its own transitions was already correctly guarded. This is itself informative: the state-corruption pattern this pass has now found three times all lived in the *other* services that mutate an encounter's status without checking whether QA already has a claim on it (`CodingService.finalize()`, `CodingService.saveDraft()`, `QueriesService.create()`/`send()`) — never in `QaService`'s own approve/return logic, which was written with the right checks from the start.

Full backend suite: 95/95 passing (up from 81). Typecheck clean. No leftover test data (including the disposable facilities the isolation tests create).

Files: [apps/api/src/modules/qa/qa.service.ts](../apps/api/src/modules/qa/qa.service.ts), [apps/api/src/modules/qa/qa.service.spec.ts](../apps/api/src/modules/qa/qa.service.spec.ts)

### Encounter ownership / locked-state audit

Before writing any more tests, every real write to the `Encounter` table across the whole backend was found and accounted for — grepped every `.encounter.update`/`.encounter.updateMany`/status-bearing write, not just the three services already tested. Exactly 8 call sites exist, across exactly 3 services (`CodingService`, `QueriesService`, `QaService`). `FhirService` only ever `create`s brand-new encounters (never touches an existing one — no lock-bypass risk). `ClaimsService` never writes at all (read-only, and already requires `FINALIZED` before exporting). `QueriesService.respond()` correctly never touches encounter status (it doesn't need to — `QUERY_PENDING` is already set by `send()` and cleared by `resolve()`). No hidden 4th mutator exists, and `EncounterStatus` has exactly 5 values (`NEW`, `IN_PROGRESS`, `QUERY_PENDING`, `QA_REVIEW`, `FINALIZED`) — `NEW`/`IN_PROGRESS` are both fully open by design, so `QUERY_PENDING`/`QA_REVIEW`/`FINALIZED` were the only three states worth reasoning about.

This audit surfaced one more real interaction, found by direct experiment before any test was written: `finalize()` never checked for an open (unanswered/unresolved) query. Sending a query moves the encounter to `QUERY_PENDING`, but `finalize()`'s guard only excluded `FINALIZED`/`QA_REVIEW` — so finalizing while a query sat `SENT` succeeded, leaving the query orphaned (still independently answerable and resolvable) on an already-finalized chart. Unlike the three bugs already fixed, this wasn't a clear violation of an established principle — it was reported as an open product-specification question rather than silently fixed, per this project's own stated discipline for genuinely ambiguous cases.

**Decision (not a bug fix — an explicit business rule):** an encounter cannot be finalized while any query on it is open. The chosen definition of "open" is deliberately broader than the derived `QUERY_PENDING` status: `DRAFT`, `SENT`, **and `RESPONDED`** all block finalize, checked directly against the real `Query` rows rather than the encounter's status field — a provider's response can itself contain documentation that changes the coding decision, and the coder hasn't reviewed it yet, so treating `RESPONDED` as still-open was chosen over allowing an arbitrary boundary at "provider has answered." Checking the actual rows rather than the derived status also means the rule stays correct even if `encounter.status` were ever wrong for an unrelated reason.

7 new tests added to `coding.service.spec.ts`: DRAFT/SENT/RESPONDED each independently rejected, resolved-query finalize allowed, one-of-several-still-open rejected even with others resolved, all-resolved finalize allowed, and — matching the "an error must not mutate state" principle explicitly requested — a test confirming a rejected finalize leaves both the encounter's status and the coding decision's `finalizedAt`/`updatedAt` completely untouched. Proved to have teeth: reverting the guard failed all 5 of the "should reject" tests with the exact expected assertion, restored, full suite green again.

Full backend suite: 102/102 passing (up from 95). Typecheck clean.

Files: [apps/api/src/modules/coding/coding.service.ts](../apps/api/src/modules/coding/coding.service.ts), [apps/api/src/modules/coding/coding.service.spec.ts](../apps/api/src/modules/coding/coding.service.spec.ts)

### Facility isolation — Patients, FHIR, Claims

Continuing the ownership audit into the isolation dimension per the same instruction to test indirect/child-resource access, not just the obvious direct endpoints: `PatientsService`, `FhirService`, and `ClaimsService` were each tested for whether a caller from one facility can read or influence data belonging to another, including via a *valid* ID for a resource that exists but belongs elsewhere (the case a naive "does this ID exist" check would miss).

- **`PatientsService`** (5 tests): `listWorkQueue` is scoped to the caller's facility and correctly excludes `FINALIZED`/`QA_REVIEW` encounters from the queue; `getEncounter` rejects (403) a *valid* encounter ID belonging to another facility, and returns `NotFoundException` for a nonexistent one — distinguishing the two rather than leaking existence via error type.
- **`FhirService`** (3 tests): an ingested bundle is always tied to the caller's own facility regardless of what the bundle content claims. By design, `Patient` has no `facilityId` (it's a shared/global directory across facilities, confirmed against the schema, not assumed) — so a shared MRN across two facilities correctly reuses one `Patient` row while creating two independently-owned `Encounter` rows, verified directly rather than assumed. A bundle missing a `Patient` or `Encounter` resource is rejected.
- **`ClaimsService`** (4 tests): rejects a non-finalized encounter even at the caller's own facility; exports the correct UB-04-style shape for an own-facility finalized encounter (including the `"J189"` → `"J18.9"` display-formatting convention); rejects (403) a valid finalized encounter ID belonging to another facility; `NotFoundException` for a nonexistent ID.

**No new bugs were found in any of the three.** This is treated as informative, not a non-result: `FhirService.ingestBundle()` takes no target ID at all (every resource is freshly `create`d, `facilityId` comes only from the JWT — there's no attack surface for cross-facility writes by construction) and `ClaimsService`/`PatientsService` were both already scoping every query by `facilityId` correctly. Unlike the ownership-lock bug class (found three times), isolation-by-facility was implemented consistently everywhere it was checked.

New fixture helpers `createOtherFacilityEncounter`/`deleteOtherFacilityEncounter` were added to the shared `encounter-fixture.ts` (a genuinely separate `Facility`+`Patient`+`Encounter` created per call, since `Encounter.facilityId` has a real FK constraint — an arbitrary fake ID like `999999` fails at the database, not at the application layer, as the FHIR test initially discovered and fixed).

Full backend suite: 114/114 passing (up from 102). Typecheck clean.

Files: [apps/api/src/modules/patients/patients.service.spec.ts](../apps/api/src/modules/patients/patients.service.spec.ts), [apps/api/src/modules/fhir/fhir.service.spec.ts](../apps/api/src/modules/fhir/fhir.service.spec.ts), [apps/api/src/modules/claims/claims.service.spec.ts](../apps/api/src/modules/claims/claims.service.spec.ts), [apps/api/src/test-support/encounter-fixture.ts](../apps/api/src/test-support/encounter-fixture.ts)

### Full-lifecycle integration test (capstone of the stabilization pass)

One deterministic end-to-end test drives the complete real state machine across all three services in a single run — `NEW → IN_PROGRESS → QUERY_PENDING → IN_PROGRESS → QA_REVIEW → RETURNED → IN_PROGRESS → QA_REVIEW → APPROVED (→ FINALIZED)` — asserting at every stage that only the workflow which currently owns the encounter can mutate it: the exact invariant whose absence produced all three lock-bypass bugs and the open-query business rule found earlier in this pass. `QaService`'s sampling is mocked deterministically (`vi.spyOn(Math, "random")`) at each `finalize()` call rather than looped until chance cooperates, consistent with this pass's determinism discipline throughout.

Spot-check teeth-proofed against the open-query-finalize guard (reverted, confirmed the integration test fails at that exact assertion, restored) rather than proofing every individual assertion again — each guard already has its own dedicated regression test in its own module's spec file; this test's job is proving the *sequence* is coherent end to end, not re-proving each guard in isolation.

While finishing this test, a fragility in its own cleanup was found and fixed: cleanup was originally inline at the end of the test body, so a failed or interrupted run (such as the deliberate teeth-proof revert) never reached it and leaked the test encounter. Fixed by moving cleanup into `afterEach` against an outer-scope tracking array, the same pattern already used by every other spec file in this pass, so cleanup runs regardless of how the test exits.

Full backend suite: 115/115 passing (up from 114). Typecheck clean.

Files: [apps/api/src/test-support/encounter-lifecycle.integration.spec.ts](../apps/api/src/test-support/encounter-lifecycle.integration.spec.ts)

### Test-fixture cleanup leak, found and fixed in the project's own test infrastructure

Not an application bug — a bug in `queries.service.spec.ts`'s own `afterEach`. Its two-loop cleanup had an ordering dependency: the isolation tests' `seedOtherFacilityEncounter()` pushed the same encounter ID into both an `encounterIds` array and a `facilityIds` array, and `afterEach` processed `encounterIds` first — deleting the encounter — before using `facilityIds` to look up that facility's patients via `encounter.findMany({ where: { facilityId } })`, which by then found nothing (the encounter was already gone), so the `Patient` row backing it was never deleted. This silently leaked one orphaned `Patient` row per isolation test run, accumulating to 50 rows (confirmed via direct investigation: all 50 had zero attached encounters, ruling out an application-level leak and isolating it to this ordering bug) before it was noticed.

Fixed by tracking `{ facilityId, patientId }` pairs directly instead of re-deriving the patient from a since-deleted encounter's facility relation. The 50 pre-existing orphaned rows (leaked before the fix existed, not reproducible by it) plus one leaked `Encounter` row (from an earlier interrupted run, found the same way) were cleaned up directly; a repeat check afterward confirmed zero orphaned `Facility`/`Patient`/`Encounter` rows remain.

Files: [apps/api/src/modules/queries/queries.service.spec.ts](../apps/api/src/modules/queries/queries.service.spec.ts)

## Testing-tool notes (not app bugs)

Several clicks during this session landed on stale element references from a prior screenshot/render and silently no-op'd (no network request fired). Every such case was caught by cross-checking the network request log or database state after the action, and retried with a fresh element reference or direct coordinates — never assumed successful from a screenshot alone. This is a property of the browser-automation tooling, not the application; it's noted here only because it explains why some steps in this report show a "first attempt failed, retried" pattern.

## Overall assessment

The application is in a solid, genuinely working state end to end across all five roles and seven build phases. Every core workflow was exercised with real data, not scripted happy-path assumptions, and every real issue this pass surfaced — six in total, spanning the frontend, the encoder, the suggestions engine, and the original index import — was fixed and re-verified rather than glossed over. The system's own honesty conventions — the DRG grouper's "simplified approximation" labeling, the suggestions panel's evidence-first design, the explicit multi-facility isolation — all held up under actual use, not just code review.
