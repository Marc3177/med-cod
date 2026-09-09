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
| **Fix #2** (numeric-qualifier digit preservation) | **77.6%** | **69.1%** | 38 | 11 | 17 | 22 | **0** |
| **Fix #3** (MI `infarct`/`myocardial` two-cluster) | **81.6%** | 67.8% | 40 | 9 | 19 | 20 | **2 (both anticipated, see below)** |
| **Combined** (Fix #1 + #2 + #3 together) | **81.6%** | 67.8% | 40 | 9 | 19 | 20 | **0 — see note below** |

### A methodology note, stated plainly rather than glossed over

**The "Combined" row above is not a new measurement — it is byte-identical to Fix #3's, confirmed by diffing every one of the 88 annotated outcomes and every case's unannotated extras: 0 changes.** This is expected, not a coincidence, and worth being explicit about why: each fix in this log was shipped *on top of* the previously-shipped one rather than reverted back to a clean baseline first. Fix #2's evaluation run already had Fix #1 present in the codebase; Fix #3's run already had both Fix #1 and Fix #2 present. In other words, **every row from Fix #2 onward in this table was already a cumulative measurement, not an isolated one** — "Fix #3" and "Combined" describe the exact same code state, because Fix #3 was never tested in isolation from Fix #1/#2 to begin with.

This is a real deviation from a stricter protocol (revert-to-baseline before testing each fix independently, then combine only at the end), and it's recorded here rather than silently presented as if the combined run were a fresh, independent confirmation. It does not invalidate what was measured, though: cumulative sequential validation is itself a legitimate methodology for exactly the question the combined run exists to answer — cross-fix interaction. If Fix #3 had interacted badly with Fix #1 or Fix #2 (e.g., the MI clusters somehow re-exposing the CKD-staging false positives, or the digit-preservation change interacting with the new MI clusters to produce some new collision), that interaction would necessarily have shown up in the Fix #3 diff already, since Fix #1 and Fix #2 were already present in the codebase at that point. What this sequence does NOT establish is each fix's effect in true isolation *from each other* — Fix #2's own row describes "Fix #1 + Fix #2," not "Fix #2 alone from a clean baseline," and Fix #3's row describes all three together. A future evaluation wanting genuinely independent per-fix measurements would need to revert to baseline and re-apply each fix separately before combining — not done here, and not repeated retroactively for this round given the interaction question is already answered by the sequence as executed.

**Delta classification for the combined run** (all categories from the requested classification scheme, reported even where empty, since an empty category is itself information):

| Class | Count | Cases |
|---|---:|---|
| Cases improved | 0 | — (all improvements already occurred at Fix #1/#2/#3's own steps) |
| Cases regressed | 0 | — |
| Cases changed only because another fix exposed a masked problem | 0 | — (this happened once already, at the Fix #3 step itself: `neg-03`/`temp-01`, already classified and decided there) |
| New false positives | 0 | — |
| New false negatives | 0 | — |
| Cross-fix interactions | 0 | — no evidence of any interaction between the three fixes, positive or negative |

**Decision: the combined state is the new evaluation baseline.** 81.6% recall / 67.8% precision, up from 73.5%/59.0% at E0. No interaction regressions — because, per the methodology note above, the interaction question was already being answered incrementally at each step, and none of the three fixes' individual diffs showed any sign of touching a case outside its own stated target. `combined-detail.json`/`combined-summary.json` are saved alongside the other snapshots in `apps/api/src/evaluation/results/` for future reference, even though their content is identical to `fix3-*.json`.

### Fix #1 — SHIPPED

**Change:** added `["respiration", "respiratory"]` as a fifth entry in `SYNONYM_CLUSTERS` (`suggestions.service.ts`) — the exact same proven pattern as the four existing clusters, applied to the confirmed gap this evaluation found (see the baseline's finding on `syn-09`/`avc-04`/the "acute respiratory failure" miss).

**Exact case-level diff against baseline** (computed by diffing `baseline-detail.json` against `fix1-detail.json` outcome-by-outcome, not by re-reading aggregate percentages):

- `syn-09` (synonyms_morphology): `J96.00` FN → **TP**
- `avc-04` (acute_vs_chronic): `J96.00` FN → **TP**
- Every other one of the 88 annotated code checks across all 70 cases: **unchanged.**

**Decision:** ship. Per the stated rule ("a meaningful improvement in the intended category without unacceptable regression in precision or unrelated categories in it"): recall improved in exactly the two categories the fix targets (`synonyms_morphology` 0.80→0.90, `acute_vs_chronic` 0.833→1.00), precision in both categories held or improved (no new false positives introduced anywhere — `FP` count is identical, 25, before and after), and all other 10 categories are byte-for-byte identical to baseline. This is the clean case the decision rule was written for: a fix that improves exactly what it targets and touches nothing else.

**Verification:** `npm test` 151/151 (150 + 1 new permanent regression test added to `suggestions.service.spec.ts`'s existing synonym-cluster table). Teeth-proofed: temporarily removed the new cluster entry, confirmed the new regression test fails with the exact predicted symptom (`expected [ 'J989' ] to include 'J9600'`), restored, confirmed green again. Zero leftover test data.

`abbr-10` (the MI abbreviation case) and `temp-01` (MI history) remain unchanged FN, as predicted — they depend on the separate, not-yet-shipped `infarct`/`infarction`/`myocardium`/`myocardial` cluster (Fix #3), not this one.

### Fix #2 — SHIPPED

**Change:** in `significantWordGroups()`, exempted standalone-digit tokens from the `MIN_SIGNIFICANT_WORD_LENGTH` filter (`.filter((w) => w.length >= MIN_SIGNIFICANT_WORD_LENGTH || isNumericQualifier(w))`) — the confirmed root cause of the numeric-staging gap: a "3" was being silently dropped as "too short," so every stage of CKD (and every other digit-differentiated condition) collapsed to "any stage matches."

**Exact case-level diff against Fix #1** (computed the same way, diffing outcome-by-outcome, this time also diffing each case's unannotated "extra suggestions" list since this fix's real reach turned out to extend beyond the annotated categories):

- `num-01`: `N181`/`N182`/`N184`/`N185` FP → **TN** (4 cases)
- `num-02`: `N181`/`N182`/`N1830`/`N184` FP → **TN** (4 cases)
- **Unplanned bonus, caught only by diffing the unannotated extras**: `syn-03`, `temp-04`, and `multi-01` each stopped returning `E10.9` (Type 1 diabetes) as noise alongside the correct `E11.9` (Type 2) — the exact same digit-dropping bug was also silently collapsing "Type 1" and "Type 2" diabetes entries together, in cases that were never in the `numeric_qualifiers_staging` category at all.
- `abbr-05`, `avc-02`, `avc-03`: the same CKD-stage noise (`N181`/`N182`/`N184`/`N185`) disappeared from their extras lists too, even though none of these cases had declared it as a formal `expectedNonMatches` — real precision improvement the original annotation didn't even ask for.
- **Every other one of the 88 annotated code checks, and every other case's extras list: unchanged. Zero new false positives introduced anywhere** — every diff was a removal, never an addition.
- `num-03`/`num-04` (pressure ulcers) remain unchanged FN, exactly as predicted — that gap is the separate, more severe ulcer-cluster-unmatchable issue documented in the baseline, not the digit-dropping bug this fix targets.

**Decision:** ship — an even cleaner case than Fix #1. `numeric_qualifiers_staging` precision went from 0.20 to **1.00** (FP 8→0, TN 3→11) with recall unchanged (the two genuinely-unrelated pressure-ulcer failures correctly remain FN, not silently masked). Two new permanent regression tests added (CKD-stage specificity; the Type-1-vs-Type-2 diabetes collision this fix incidentally also closed), both teeth-proofed by reverting the filter change and confirming the exact predicted failure (`expected [ Array(9) ] to not include 'N181'`; `expected [ 'E119', 'E139', 'E109' ] to not include 'E109'`), then restored.

**Verification:** `npm test` 153/153 (151 + 2 new tests). Zero leftover test data.

### Fix #3 — SHIPPED (with a deliberate, verified design decision, and an anticipated tradeoff)

**Change:** added the real MI headword — verified against the actual FY2026 index (`"Infarct, infarction, myocardium, myocardial"`, confirmed identical across the whole I21.x subtree) — as **two** `SYNONYM_CLUSTERS` entries, not one four-way cluster: `["infarct", "infarction"]` (event word-forms) and `["myocardium", "myocardial"]` (site word-forms), both still required together. A naive single four-way cluster was considered and rejected *before* shipping, the same way the five-way ulcer cluster was rejected in the original matcher work: checked directly against a constructed adversarial sentence ("Biopsy of the myocardium was performed...", no infarction language at all) and confirmed it would wrongly fire I21.9 once `isDistinctiveEnough`'s length-6 fallback treated the single remaining cluster group as sufficient on its own. The two-cluster design correctly stays silent on that same sentence.

**Exact case-level diff against Fix #2:**

- `syn-08` (synonyms_morphology): `I21.9` FN → **TP** — the intended fix.
- `abbr-10` (abbreviations): `I21.9` FN → **TP** — same, via the MI abbreviation expansion.
- `neg-03` (negation): `I21.9` TN → **FP** — anticipated, not new. This case's own `reason` field (written *before* this fix shipped) predicted exactly this: "this looks like correct negation handling, but isn't... expected to currently FAIL once the MI cluster ships." MI was previously unmatchable at all, which accidentally masked the negation gap on this one case; Fix #3 doesn't make negation worse, it removes the accidental mask that was hiding a gap every other condition (pneumonia, sepsis, DVT...) already has.
- `temp-01` (temporal_context): `I21.9` TN → **FP**, same reason. Its `expectedMatches` (`I25.2`, the history-of-MI code) remains FN either way — a separate, not-yet-traced phrasing gap in the I25.2 entry itself (likely requires "old"/"healed," not generic "history of"), unrelated to this fix.
- Every other one of the 88 annotated code checks: unchanged.

**Decision:** ship — put to an explicit judgment call rather than decided unilaterally, given the real (if small, anticipated) precision cost. Recall 77.6%→81.6%, precision 69.1%→67.8%. The two negation-category changes are the deliberate unmasking of an already-tracked, already-scoped-for-its-own-experiment limitation, not a new defect this fix introduced — negation's real, honest error rate doesn't get worse because of Fix #3, it becomes visible on 2 more cases where it was previously and coincidentally hidden.

**Verification:** `npm test` 155/155 (153 + 2 new tests: the intended MI-cluster regression test, and a dedicated test proving the two-cluster design choice — "myocardium" alone must not fire I21.9). Teeth-proofed twice: (1) removed both new cluster entries, confirmed the MI-match test fails with the exact predicted symptom; (2) merged them into a single naive four-way cluster instead of restoring the real fix, and confirmed the anatomical-language guard test fails exactly as the design rationale predicted (`expected [ 'I515', 'I219' ] to not include 'I219'`) — direct proof the two-cluster structure, not just "a" fix, is what's required. Zero leftover test data.

### Combined run — DONE, see the "Experiment log" table and methodology note above

Confirmed via a fresh `npm run evaluate` on the current codebase state (all three fixes present): 81.6% recall / 67.8% precision, zero delta from Fix #3 at the individual-case level (0 improved, 0 regressed, 0 newly-exposed, 0 new FP, 0 new FN, 0 cross-fix interactions) — expected given each fix was shipped cumulatively on top of the last, not re-isolated from a clean baseline (see the methodology note). This combined state is now the evaluation harness's baseline going forward.

## Next: pausing matcher modifications

Per explicit direction, no further terminology/index fixes are planned for now. The next area the harness's own findings point to — negation/temporal/context handling (`negation`, `temporal_context`, and the negation-shaped false positives inside `acute_vs_chronic`'s `avc-05` and `false_positive_traps`' `fp-06`) — is qualitatively different from a missing synonym cluster or a dropped index character: it's the first candidate for genuinely testing whether deterministic keyword matching has hit a representational ceiling, rather than just an incomplete-coverage gap. That question is deliberately not answered here.
