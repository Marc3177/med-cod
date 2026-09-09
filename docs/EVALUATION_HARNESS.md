# P1-E0 — Permanent Clinical Intelligence Evaluation Harness

**What this is not:** a correctness test. The 150 tests in `npx vitest run` (`docs/TEST_REPORT.md`) answer *"does the software preserve its invariants?"* — this harness answers a different question: *"does the coding intelligence actually find the clinically relevant evidence it's supposed to find?"* Both are needed; neither substitutes for the other.

**Where it lives:** `apps/api/src/evaluation/` — `types.ts` (the `GoldCase` schema), `cases/*.ts` (one file per category, hand-authored and gold-annotated), `run-evaluation.spec.ts` (the runner). Deliberately excluded from `npm test` (`vitest.config.ts`'s `exclude`) since it measures quality, not correctness, and is not a merge gate. Run it explicitly:

```bash
npm run evaluate
```

This uses a separate `vitest.evaluate.config.ts` (its own `include`, a 5-minute `testTimeout` since ~70 cases each re-scanning the real 63,138-row FY2026 index take longer than typical unit tests) so it stays fully out of the default test discovery.

## Methodology

Every case in `cases/*.ts` declares its expectation **before** being run — never retrofitted to whatever the engine produced, which would let the engine judge itself:

```ts
{
  id: "neg-01",
  category: "negation",
  documents: ["No evidence of pneumonia on chest x-ray."],
  expectedMatches: [],                                        // codes that SHOULD fire
  expectedNonMatches: [{ code: "J189", codeSystem: "ICD-10-CM" }],  // codes that SHOULD NOT
  reason: "Explicit negation ('no evidence of') directly preceding the condition.",
}
```

The runner (`run-evaluation.spec.ts`) has two phases:

1. **Verification** — every code cited anywhere in the gold set is checked against the real FY2026 reference tables first. A missing code is a gold-case authoring error, not an engine failure, and is reported separately so it's never silently scored as one. Current baseline: 41 unique codes cited, 0 missing.
2. **Scoring** — for each case, `SuggestionsService.listSuggestions()` runs against a real encounter with the case's document(s), and every declared code is scored `TP`/`FN` (from `expectedMatches`) or `FP`/`TN` (from `expectedNonMatches`). Any suggestion the engine returns that isn't mentioned in either list is recorded as an **unannotated extra** — not scored, since its relevance hasn't been judged, but retained per case so a future annotation pass can classify it.

Recall and precision are computed per category from these counts: `recall = TP / (TP + FN)`, `precision = TP / (TP + FP)`. Precision here is *against annotated expectations only* — it does not account for unannotated extras, which is a known limitation of this first version (see "What this baseline doesn't yet measure" below).

## Baseline results (70 cases, 12 categories)

Run against the unmodified engine — **no fixes from `docs/P1_EVIDENCE_EVALUATION.md` have been applied yet.** This is the reference point every future change gets measured against.

| Category | Cases | Recall | Precision | TP | FN | FP | TN |
|---|---:|---:|---:|---:|---:|---:|---:|
| synonyms_morphology | 10 | 0.80 | 1.00 | 8 | 2 | 0 | 0 |
| abbreviations | 10 | 0.70 | 1.00 | 7 | 3 | 0 | 0 |
| negation | 10 | 1.00 | 0.25 | 2 | 0 | 6 | 3 |
| temporal_context | 6 | 0.80 | 0.80 | 4 | 1 | 1 | 1 |
| numeric_qualifiers_staging | 4 | 0.50 | 0.20 | 2 | 2 | 8 | 3 |
| anatomical_specificity | 4 | 1.00 | 0.50 | 2 | 0 | 2 | 0 |
| acute_vs_chronic | 5 | 0.83 | 0.83 | 5 | 1 | 1 | 3 |
| clinical_phrasing_variation | 5 | 0.00 | — | 0 | 3 | 0 | 0 |
| conflicting_evidence | 3 | 1.00 | 0.50 | 2 | 0 | 2 | 0 |
| multiple_evidence_sources | 3 | 1.00 | 1.00 | 3 | 0 | 0 | 0 |
| documentation_gaps | 4 | — | — | 0 | 0 | 0 | 3 |
| false_positive_traps | 6 | 0.50 | 0.17 | 1 | 1 | 5 | 1 |
| **Overall** | **70** | **0.735** | **0.590** | **36** | **13** | **25** | **14** |

(`documentation_gaps` has no expectedMatches by design — those cases test that the engine stays silent, scored entirely via TN/FP.)

## What the baseline confirms from `P1_EVIDENCE_EVALUATION.md`

- **Negation: 6 of 9 traps produce a false positive (67%).** Precision 0.25 quantifies exactly what the earlier one-shot round only showed anecdotally. The 3 true negatives are not evidence of correct negation handling — `neg-03` (MI "ruled out") and `neg-07`/`abbr-06` (UTI "negative for") are silent for an *unrelated* reason (the MI synonym-cluster gap and a UTI-specific-code miss, both independently confirmed below), and `neg-08` (negated family history) never fires regardless of negation because its full word-set rarely co-occurs. **Real, current negation recall on genuinely-reachable cases is 0%, not the ~33% the raw TN count would suggest.**
- **The `respiration`/`respiratory` cluster gap and the MI `infarct`/`infarction` cluster gap** both reproduce exactly as predicted (`syn-08`, `syn-09`, `abbr-10`, `avc-04`, `temp-01`) — cheap, proven-pattern fixes, unaffected by anything else in this baseline.
- **The kidney "injury" trauma-code collision** reproduces at gold-case level (`fp-01`): 1 correct match, 3+ irrelevant trauma codes forced as false positives.
- **Numeric-qualifier staging** (`num-01`, `num-02`) reproduces precisely: all four wrong CKD stages fire alongside the correct one.
- **Conflicting evidence** (`conf-01`, `conf-02`) reproduces: a later note's negation of an earlier suspicion doesn't suppress the earlier suspicion's code, while a later note's *confirmation* correctly leaves the code intact (`conf-03`).

## New findings this baseline surfaced (not previously known)

1. **Pressure ulcers are currently unmatchable at all, for any stage or site — a total category failure, not a partial one.** Traced to the real index rows: pressure-ulcer entries carry the full five-way `ulcer/ulcerated/ulcerating/ulceration/ulcerative` headword. Because that cluster is deliberately *not* shipped (see `suggestions.service.ts`'s own comment on the false-positive risk of relaxing it), `significantWordGroups()` currently treats each of the five spellings as its own separate **AND-required** word rather than dropping or OR-ing them — so a pressure-ulcer entry requires all five spellings to appear in one sentence, which no real note ever will. This is more severe than the numeric-staging gap this category was originally built to test (`num-03`, `num-04`) and is worth its own line item, not folded into the digit-dropping fix.
2. **DVT laterality doesn't suppress the opposite side.** `anat-01`/`anat-02`: documenting a *left*-sided DVT still surfaces the right-sided code (and vice versa) alongside the correct one, plus unspecified-vein and chronic-DVT codes as further noise. Laterality words are present in the sentence but have no suppressive effect on the non-matching laterality's own code.
3. **A negated qualifier inside a "with X" structure still satisfies the requirement for X.** `avc-05`: "chronic obstructive pulmonary disease, stable, **no current exacerbation**" still fires the *with*-exacerbation code (J44.1), because the word "exacerbation" is present in the sentence — negation status is invisible to the matcher regardless of which grammatical structure the negated word sits in. The same root cause as the `negation` category, reproducing in a structurally different place (a qualifier within an already-matched diagnosis, not a whole separate condition).
4. **An unconfirmed differential diagnosis is not suppressed.** `fp-06`: "heart failure was discussed as a differential **but not confirmed**" still fires I50.9. Same root cause as finding 3 — the word "failure" is present, negation/hedging language around it is invisible.
5. **A specific UTI code (N39.0) does not fire on plain "urinary tract infection" phrasing** — only generic urinary-disorder codes (N39.9, N39.8) do (`abbr-06`). Root cause not yet traced to the specific index row (flagged as follow-up work, same as the fracture/complication gaps in `P1_EVIDENCE_EVALUATION.md`).
6. **A minor morphological variant broke an otherwise-working match.** `phrase-03`: "patient is **short of breath**" (natural spoken-register phrasing) missed R06.02 entirely, while "**shortness of breath**" (the exact index headword) matches correctly — confirmed as a real gap, not the weak test this evaluation's first round flagged for `phrase-01`/`phrase-02`. A human would consider these identical; the matcher requires the exact noun form.
7. **A family-history statement produced both a false negative and a false positive simultaneously.** `fp-05`: "family history of malignant neoplasm of the respiratory organs" missed the correct history code (Z80.2) *and* incorrectly fired the generic active-disease code (J98.9) — worse than either failure alone, and not yet root-caused at the index-row level.
8. **An unexplained, unrelated false positive.** `abbr-09`: "patient had a TIA last month, fully resolved" — expected Z86.73 missed (a gap, not yet explained), and an entirely unrelated code (Z59.00, homelessness) fired instead. Flagged for follow-up; no plausible mechanism identified yet and not asserted as understood.

## Two gold-case authoring errors, found and corrected by the process itself

Worth recording as evidence the verification discipline works, not swept away: `syn-04` originally expected `E10.10` (Type 1 diabetic ketoacidosis) from a sentence that never said "Type 1" — the engine's actual answer (`E11.10`, Type 2 by default) was correct; the sentence was fixed to say "Type 1" explicitly. `syn-10`'s control case cited the retired parent code `M54.5`, superseded by `M54.50`/`51`/`59` in the current code set — corrected to `M54.50`. Neither was an engine failure; both were caught by inspecting what the engine actually returned rather than assuming the original annotation was right.

## What this baseline doesn't yet measure

- **Precision against unannotated extras.** Every case's "extra suggestions" (codes returned that aren't in either expected list) are recorded per case but not scored — a future annotation pass should classify each as relevant-but-uncaptured or genuine noise, which would make precision numbers more honest, especially for high-extras categories like `numeric_qualifiers_staging` and `anatomical_specificity`.
- **The fracture, post-op-complication, UTI-specificity, and TIA/homelessness findings** are confirmed failures without a confirmed root cause yet — the next evaluation pass should trace each to its specific index row the way `respiration`/`respiratory` and the pressure-ulcer cluster were traced this round.
- **Scale.** 70 cases is a working foundation, not the ~240 originally scoped (20 per category) — expand `cases/*.ts` incrementally; the schema and runner don't need to change to grow the set.

## Using this harness for future changes

Per the explicit instruction this milestone was scoped under: **do not ship all three of `P1_EVIDENCE_EVALUATION.md`'s proposed fixes at once.** Run `baseline → fix #1 → evaluate → fix #2 → evaluate → fix #3 → evaluate`, and diff each category's recall/precision against this baseline table — not against a single motivating example. A fix should be judged on whether it improved recall *without* dropping precision elsewhere (the exact failure mode `MAX_PREFIX_EXPANSION` produced for acute kidney injury earlier in this project's history). Update this document's baseline table after each verified step, so it stays the living record of the engine's measured behavior over time, the same way `TEST_REPORT.md` is for correctness.

Raw results for each experiment are kept as JSON snapshots in `apps/api/src/evaluation/results/` (`baseline-*.json`, `fix1-*.json`, ...) specifically so a later experiment can be diffed against an earlier one at the individual-case level, not just the aggregate percentages — see the worked example below.

## Experiment log

| Version | Recall | Precision | TP | FN | FP | TN | Regression cases |
|---|---:|---:|---:|---:|---:|---:|---|
| Baseline | 73.5% | 59.0% | 36 | 13 | 25 | 14 | — |
| **Fix #1** (`respiration`/`respiratory` cluster) | **77.6%** | **60.3%** | 38 | 11 | 25 | 14 | **0** |

### Fix #1 — SHIPPED

**Change:** added `["respiration", "respiratory"]` as a fifth entry in `SYNONYM_CLUSTERS` (`suggestions.service.ts`) — the exact same proven pattern as the four existing clusters, applied to the confirmed gap this evaluation found (see the baseline's finding on `syn-09`/`avc-04`/the "acute respiratory failure" miss).

**Exact case-level diff against baseline** (computed by diffing `baseline-detail.json` against `fix1-detail.json` outcome-by-outcome, not by re-reading aggregate percentages):

- `syn-09` (synonyms_morphology): `J96.00` FN → **TP**
- `avc-04` (acute_vs_chronic): `J96.00` FN → **TP**
- Every other one of the 88 annotated code checks across all 70 cases: **unchanged.**

**Decision:** ship. Per the stated rule ("a meaningful improvement in the intended category without unacceptable regression in precision or unrelated categories in it"): recall improved in exactly the two categories the fix targets (`synonyms_morphology` 0.80→0.90, `acute_vs_chronic` 0.833→1.00), precision in both categories held or improved (no new false positives introduced anywhere — `FP` count is identical, 25, before and after), and all other 10 categories are byte-for-byte identical to baseline. This is the clean case the decision rule was written for: a fix that improves exactly what it targets and touches nothing else.

**Verification:** `npm test` 151/151 (150 + 1 new permanent regression test added to `suggestions.service.spec.ts`'s existing synonym-cluster table). Teeth-proofed: temporarily removed the new cluster entry, confirmed the new regression test fails with the exact predicted symptom (`expected [ 'J989' ] to include 'J9600'`), restored, confirmed green again. Zero leftover test data.

`abbr-10` (the MI abbreviation case) and `temp-01` (MI history) remain unchanged FN, as predicted — they depend on the separate, not-yet-shipped `infarct`/`infarction`/`myocardium`/`myocardial` cluster (Fix #3), not this one.

### Fix #2 and Fix #3 — not yet run

Per the controlled-experiment plan, negation is deliberately excluded from the next simple terminology fixes and reserved for its own dedicated experiment — it's a semantically different problem (context/scope modeling) from a missing synonym cluster or a dropped numeric qualifier, and deserves to be measured on its own rather than folded into a "terminology improvements" bucket.
