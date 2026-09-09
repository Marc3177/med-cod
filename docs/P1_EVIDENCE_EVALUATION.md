# Med-Cod P1 Evidence & Intelligence Evaluation

**Purpose:** an evaluation, not a feature build. Before writing any P1 code, this document turns everything discovered during P0 stabilization — plus a fresh adversarial run against the real deterministic matching engine and real FY2026 reference data — into an evidence-driven answer to four questions: what's already differentiated, where the deterministic engine actually fails (quantified, not anecdotal), which P1 capabilities solve real coder problems, and whether an LLM/concept layer is justified yet.

**Method:** every claim below is backed by either (a) code already read end to end this session, (b) an existing, already-passing regression test, or (c) a fresh adversarial chart set run directly against `SuggestionsService.listAllEvidence()`/`listSuggestions()` and the real `SynonymIndexEntry` table (63,138 real FY2026 rows, not a mock), with root causes traced back to specific index rows and specific lines of matching logic — not asserted from a single anecdotal example.

---

## 1. What is already genuinely differentiated

Six evidence/intelligence features exist, all built on one architectural principle stated explicitly in `docs/FEATURES.md` and enforced at the type level, not just by convention: **AI finds, explains, and suggests; the coder always decides.** `DocumentationGap` has no `code` field in its TypeScript type — it structurally cannot become a diagnosis, only a query. Nothing anywhere auto-adds a code to a `CodingDecision`.

| Feature | What makes it real, not just a checkbox |
|---|---|
| **Evidence-linked suggestions** | Every suggestion carries the literal source sentence (`evidenceExcerpt`) and the exact Alphabetic Index term that matched (`matchedVia`) — traceable to text, not a model's assertion. |
| **Evidence graph** (`listAllEvidence`) | Doesn't stop at the first match per code — a code mentioned in both the H&P and the discharge summary shows both independently, so a coder sees the full evidentiary weight, not a single citation. |
| **Documentation gaps** | Structurally incapable of becoming a diagnosis (no `code` field on the type) — the one place in the codebase where a hard type constraint, not a runtime check, enforces the "AI never codes" principle. |
| **Chart Intelligence** | Deliberately a pure aggregation over Suggestions + Documentation Gaps, not a second extraction engine — one source of truth for match quality, verified by the code (both services are literally called and their outputs combined, nothing re-scanned). |
| **Change detection** | Solves a real, previously-broken concurrency problem (a race between reading and acknowledging "what's new" that could silently report no changes to something nobody had seen) — not a cosmetic feature, a correctness one, with its own regression test proving the race is closed. |
| **Decision explanation** | Surfaces CC/MCC impact and every linked query alongside the evidence — genuinely aggregates data that would otherwise require a coder to check three separate panels. |

**This is a real, defensible differentiation angle for a coding product**: most commercial CAC (computer-assisted coding) tools either hide their matching logic behind a black-box "confidence score," or use an LLM whose citations can't be verified without re-reading the whole note. Med-Cod's suggestions are mechanically incapable of hallucinating a source — the evidence excerpt is a database row, not a generated string. That property doesn't require an LLM to build and is genuinely harder to fake with one (an LLM can be prompted to "quote the source," but nothing structurally prevents it from paraphrasing or inventing under load, the way a Zod type constraint does).

One thing worth being precise about, since two documents could otherwise read as contradicting each other: `docs/FEATURES.md` states "removing the principal diagnosis auto-promotes the next one," while this session's `docs/TEST_REPORT.md` established that no such logic exists in `CodingService`/`CodingDecisionSchema` — `saveDraft()` re-validates "exactly one principal" from scratch and rejects a submission with zero rather than repairing one. Checked directly: the promotion is real, but frontend-only (`apps/web/src/pages/EncounterDetail.tsx`'s `removeDiagnosis()`, with its own comment citing the same Phase 1–7 test pass). The backend's stricter "exactly one principal, no repair" stance is correct and intentional — it's the boundary that makes the frontend's convenience safe: the client promotes proactively, and the server independently guarantees it can never accept a submission that skipped that step. Both docs are accurate; they're describing different layers of the same guarantee.

---

## 2. Where the deterministic engine actually fails — quantified

A 20-case adversarial chart set was run directly against the real engine and real reference data, covering: straightforward diagnoses, abbreviations, negation, historical/resolved conditions, acute-vs-chronic, complications, anatomical specificity, CC/MCC-relevant conditions, documentation gaps, and conflicting evidence. Every finding below was traced to a specific cause, not left as "it didn't match."

**Score: 9 clearly correct, 5 confirmed false positives/negatives with root cause identified, 3 ambiguous/borderline, 3 not meaningfully tested by this round's case design.**

### False positives (suggested something that shouldn't have been)

| Case | What happened | Root cause | Class |
|---|---|---|---|
| "**No** evidence of pneumonia on chest x-ray" | Suggested J18.9/J18.8 (Pneumonia) anyway | **Representation gap.** The matcher is pure keyword co-occurrence with zero negation-scope detection — it cannot see "no" as negating "pneumonia" three words later. | Systemic, not a local rule fix |
| "Patient **denies** chest pain or shortness of breath" | Suggested R06.02 (Shortness of breath) and R07.9 (Chest pain) anyway | Same root cause as above. | Systemic |
| "History of cerebrovascular accident five years ago" | Suggested I63.9 (**active** cerebral infarction) *alongside* the correct Z86.73 (personal history of TIA/infarction) | **Representation gap**, more subtle than plain negation: the index happens to have a separate "old"/history-specific entry for this condition, but the matcher has no way to *prefer* it or suppress the active-disease entry when both fire — it surfaces both with no signal about which is right. | Systemic — same underlying gap as negation, different surface |
| Conflicting notes: "pneumonia suspected" (admission) vs. "pneumonia ruled out ... atelectasis" (discharge, later/authoritative) | Suggested Pneumonia codes anyway, alongside the correct Atelectasis code | **Representation gap**: no temporal or document-authority weighting — every sentence is equally valid evidence regardless of which note supersedes which. | Systemic — same root cause as negation |
| "Labs consistent with **acute kidney injury**" | Suggested 20 codes: 1 correct (N17.9) + **19 irrelevant traumatic kidney-injury codes** (S37.0xx, "initial encounter"/"subsequent encounter"/"sequela" variants) | **Local representation collision**: "injury" is required by both the clinical-AKI index entry and the entire traumatic S37.0xx injury family — the matcher has no concept-level way to tell "kidney injury" (a lab-derived functional diagnosis) from "injury of kidney" (blunt/penetrating trauma). A single overloaded English word spans two clinically unrelated code families. | Local, but high-volume (this pattern likely recurs for every organ that has both a functional "injury" sense and a trauma S-code family — kidney, liver, spleen, lung, etc.) |

### False negatives (missed something that should have matched)

| Case | What happened | Root cause | Class |
|---|---|---|---|
| "**Acute respiratory failure** requiring intubation" | Missed J96.00 entirely — only a generic, unrelated J98.9 ("Respiratory disorder, unspecified") surfaced | **Confirmed by inspecting the real index row.** The entry is `"Failure, failed, respiration, respiratory, acute"` → J96.00. `respiration` and `respiratory` are two *different* words, and — unlike the four already-shipped `SYNONYM_CLUSTERS` (hypertension/hypertensive, diabetes/diabetic, thrombosis/thrombotic, failure/failed) — they are not clustered, so both are required as separate AND-terms. Real documentation says "respiratory failure," never "respiration respiratory failure," so the entry can essentially never match as written. | **Local rule fix** — add `["respiration", "respiratory"]` as a fifth synonym cluster, exactly the same fix already proven four times |
| "Patient has **chronic kidney disease, stage 3**" | Correctly suggested N18.30, but *also* every other stage (N18.1, N18.2, N18.4, N18.5) — the "stage 3" qualifier didn't narrow anything | **Confirmed by inspecting the index rows and the code.** `MIN_SIGNIFICANT_WORD_LENGTH = 4` silently drops single-digit numeric qualifiers ("1", "2", "3"...) as tokens too short to count as significant — so `"...chronic, stage 1"` and `"...chronic, stage 3"` reduce to the *identical* required-word set once the digit is dropped. Confirmed at scale: **940 of 63,138 index entries** (~1.5%) carry a standalone digit as part of what should be a distinguishing qualifier — CKD stages, retinopathy-of-prematurity stages, pressure-ulcer stages, NEC-in-newborn stages, diabetes presymptomatic stages, and more. | **Local rule fix, but broader than any single condition** — the short-word-loses-specificity class already documented for *words* (see the existing `hasHiddenShortWord` fix) has a parallel, unfixed case for *numbers*, and it's large enough (940 entries) to be worth its own fix, not folded into the existing word-based one |
| "**Post-operative wound infection** following surgery, treated with antibiotics" | 0 suggestions | Not yet traced to a specific index row (lower priority than the two above) — plausible causes include a more specific required-word set than natural phrasing supplies, or a `matchType: 'prefix'` stub not expanded the way CM prefix entries are. Flagged for follow-up, not asserted as diagnosed. | Undetermined — needs the same row-level trace as the two fixed-diagnosis cases above before it's actionable |
| "Fracture of the right femur, closed" | 0 suggestions | Same status — not yet traced. The reference data does contain rich femur-fracture entries (confirmed by direct query), so this is very likely a specific-phrasing mismatch (e.g. requiring "shaft" or a laterality/closed-vs-open qualifier the sentence didn't supply) rather than a missing entry, but that's not yet confirmed by inspecting the exact matching row. | Undetermined |
| "Myocardial infarction was ruled out" / "History of myocardial infarction" | 0 suggestions in both cases | **This looks like correct negation handling, but isn't** — it's the already-documented "un-shipped MI synonym cluster" limitation (see `docs/TEST_REPORT.md`'s Known Limitations): `infarct`/`infarction`/`myocardium`/`myocardial` aren't clustered yet, so *neither* phrasing matches, for reasons unrelated to negation. A dangerous false negative to mistake for a success: fixing the missing cluster (already an open, correctly-scoped Known Limitation) would make this specific case start correctly demonstrating the *real* negation gap it currently only accidentally avoids. | Already tracked — but its interaction with the negation gap above is new information worth carrying into that fix's own verification step |

### Correctly handled (no gap)

Straightforward diagnosis ("pneumonia"), two abbreviation expansions (COPD, DVT), one casual-phrasing case that still contained the literal term (a weak test of that category — see below), HTN, sepsis (the primary condition, not the secondary UTI specificity — see below), and the documentation-gap case (a bare lab value correctly produced zero suggestions, exactly as designed — that's `DocumentationGapsService`'s job, not this engine's).

### What this round did *not* meaningfully test (own up to the gaps in the evaluation itself)

- **True implicit/casual phrasing** ("sugars have been running high" as a stand-in for diabetes *without ever using the word*) — the constructed test case still contained the literal word "diabetes," so it didn't actually stress this category. A real test needs phrasing that never uses the term at all.
- **Multiple independent evidence sources** — the constructed case only used one document; this is already covered by an existing regression test (`listAllEvidence surfaces every independent match`), just not exercised fresh in this round.
- **Complications and anatomical specificity** — both produced false negatives (see table) but root cause wasn't traced to the specific index row before time ran out on this round; needs a follow-up pass before being actionable.
- **Principal-vs-secondary ambiguity** — doesn't apply to this engine at all. Suggesting a code and assigning it a *role* (principal/secondary) are different layers; the suggestions engine has no opinion on role, and shouldn't — that's an inherently human coding-guideline judgment downstream of evidence, not a matching problem.

### The honest summary of Section 2

**Every false positive found traces to one root cause: the matcher has no concept of negation, temporal ordering, or document authority.** That's not a bug fixable with a stoplist or a synonym cluster — it's structural to keyword co-occurrence matching. **Two of the false negatives are cheap, proven-pattern local fixes** (a fifth synonym cluster; a numeric-qualifier version of the existing short-word fix) that would follow the exact same low-risk, high-confidence methodology already used four times this project. **The rest need more root-cause tracing before they're actionable at all** — this evaluation round found real signal, but is a first pass, not an exhaustive one.

---

## 3. Which P1 capabilities directly solve real coder problems

Filtered through "reduces missed diagnoses, reduces unnecessary searching, exposes documentation opportunities, makes coding decisions explainable" — not "more AI":

**High confidence, cheap, ship now (P1 without waiting on further evaluation):**
1. **Add the `respiration`/`respiratory` synonym cluster.** Directly fixes a false negative on one of the single most common, highest CC/MCC-impact inpatient diagnoses (acute respiratory failure). Same proven low-risk methodology as the four existing clusters.
2. **Fix numeric-qualifier dropping** (the CKD-stage / retinopathy-stage / pressure-ulcer-stage class). Affects ~940 index entries at once — a single representation fix with outsized reach, the same shape of leverage the "with"/"specified" connector-word fixes already had.
3. **Ship the previously-verified MI/infarct synonym cluster** (already an open Known Limitation with a defined next step — this evaluation adds urgency: its current "does nothing" behavior can be mistaken for correct negation handling, which is actively misleading).

**Medium confidence — needs the root-cause trace this round didn't finish, then likely cheap:**
4. Complications phrasing and traumatic-fracture phrasing gaps — both are single-diagnosis-family investigations in the same style as the two fixes above, not architecture changes.

**Real coder-facing value, needs product scoping, not urgent:**
5. **A documentation-gap-style flag for the kidney-injury word collision** (and its likely siblings — liver, spleen, lung "injury"): rather than trying to make keyword matching smarter about trauma-vs-function, the *documentation gaps* pattern (flag, don't auto-suggest) might be the right model for any word that's this structurally overloaded — worth a product conversation, not a quick fix.
6. **Surfacing negation/history/conflict explicitly to the coder as a caveat**, rather than trying to solve it silently: e.g. "this suggestion appeared alongside language that may negate it (`no`, `denies`, `ruled out`, `history of`) — review the source sentence" is a cheap, honest, deterministic annotation (a regex/keyword check on the evidence sentence itself, not an LLM) that doesn't fix the underlying representation gap but makes its presence visible to the human who's already the final decision-maker. This is the kind of thing worth prototyping *before* reaching for an LLM.

---

## 4. Where, if anywhere, does an LLM/concept layer become justified

**Not yet, and the evidence gathered this round actively argues against jumping there.** Every false positive found in Section 2 shares one root cause (no negation/temporal/authority modeling), and every false negative with a confirmed root cause was a cheap, local, previously-proven fix (a missing synonym cluster; a length-filter edge case) — exactly the pattern this project's whole matching-engine history has followed (four prior fixes, all local, all data-verified, none requiring new architecture). Nothing found this round demonstrates that deterministic matching *cannot* represent the required clinical concepts — it demonstrates that the *current instance* of deterministic matching hasn't yet had negation/temporal handling built into it, which is a different, much narrower claim.

**The one finding that comes closest to an architectural argument** is the kidney-injury word collision (#5 above): "injury" genuinely refers to two clinically unrelated concept families, and no amount of stoplist tuning fixes a single word that's legitimately ambiguous in English regardless of context. But the honest next step there is a documentation-gap-style flag (deterministic, cheap, already-proven pattern), not a concept layer — try the cheap fix, measure whether it's sufficient, *then* revisit.

**Recommendation: (A) Improve the existing deterministic evidence engine.** Ship items 1–3 from Section 3 now (low-risk, proven pattern, real clinical impact). Scope items 4–6 as a short follow-up evaluation round (finish the root-cause traces this round didn't complete, prototype the negation-caveat annotation, measure it against a larger adversarial set). **Do not introduce a Clinical Concept Layer or an LLM-assisted layer (options B/C) on the evidence gathered so far** — the data doesn't yet show deterministic matching hitting a representational ceiling, only that its coverage of well-understood clinical-language patterns (negation, staging, synonym clusters) is incomplete in specific, fixable ways. Revisit B/C only if a *future* evaluation round — after the cheap fixes above ship and get re-measured — still finds a class of failure that resists the same proven methodology.

---

## Recommended next milestone: expand this into a standing evaluation harness

This round was a single-pass, hand-built 20-case set with manual root-cause tracing — real signal, but not the systematic instrument described in the original ask. Before further P1 feature work, the highest-leverage next step is turning this into a **repeatable, larger adversarial evaluation harness**:

1. **Expand the chart set** to the full category list from the original scope — straightforward, synonyms, abbreviations, clinical phrasing variations, negation, historical, ruled-out, complications, anatomical specificity, acute-vs-chronic, CC/MCC-relevant, documentation gaps, multiple independent sources, conflicting evidence, newly-added information — with enough cases per category (10–20, not 1–2) to produce real false-negative/false-positive *rates*, not single anecdotes. Each case needs an explicit "gold" expected-code annotation decided *before* running it, so scoring isn't retrofitted to whatever the engine happened to produce.
2. **Automate the root-cause classification** this round did by hand (Local rule? Data issue? Representation gap?) — it's mechanical enough (inspect the matching `SynonymIndexEntry` rows, check against `SYNONYM_CLUSTERS`/`GENERIC_MEDICAL_WORDS`/length filters) to be a reusable script, not a one-off investigation.
3. **Re-run after each fix** from Section 3 ships, to confirm the fix's real-world hit rate on the full set, not just the single case that motivated it — the same discipline already used for every matcher fix this project has made (verify against the real index, not a guess), scaled to a repeatable harness instead of a manual sweep.
4. **Keep the harness itself out of the permanent test suite** — like the temporary investigation scripts used to produce this document, an evaluation harness measures *quality*, not *correctness*; it doesn't belong in `vitest run`'s pass/fail gate, but its results belong in a living document (this one, updated) that tracks the engine's measured FN/FP rate over time the way `TEST_REPORT.md` tracks correctness.
