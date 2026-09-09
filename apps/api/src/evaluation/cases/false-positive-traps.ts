import type { GoldCase } from "../types.js";

/** Deliberately adversarial sentences designed to trigger over-matching —
 *  generic words, overloaded clinical vocabulary, and structural index
 *  quirks that have already caused real false positives this project
 *  found (see docs/TEST_REPORT.md and P1_EVIDENCE_EVALUATION.md). */
export const falsePositiveTrapsCases: GoldCase[] = [
  {
    id: "fp-01",
    category: "false_positive_traps",
    documents: ["Labs consistent with acute kidney injury."],
    expectedMatches: [{ code: "N179", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [
      { code: "S37001A", codeSystem: "ICD-10-CM" },
      { code: "S37002A", codeSystem: "ICD-10-CM" },
      { code: "S37009A", codeSystem: "ICD-10-CM" },
    ],
    reason: "Confirmed false positive from P1_EVIDENCE_EVALUATION.md: 'injury' collides with the entire traumatic-kidney-injury (S37.0xx) code family, none of which apply to a clinical (non-traumatic) AKI.",
  },
  {
    id: "fp-02",
    category: "false_positive_traps",
    documents: ["Patient reports right ear pain, likely otitis externa."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "'Right' alone is a documented historical false positive (see TEST_REPORT.md: 'right' alone matched an unrelated 'Ear, wax, right' entry) — this case is a regression guard for that already-fixed bug, not a new gap.",
  },
  {
    id: "fp-03",
    category: "false_positive_traps",
    documents: ["Patient's chest x-ray shows no acute cardiopulmonary process."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "J189", codeSystem: "ICD-10-CM" }],
    reason: "A normal/negative imaging finding should never be mistaken for a positive diagnosis.",
  },
  {
    id: "fp-04",
    category: "false_positive_traps",
    documents: ["Impression: no acute findings. Patient stable for discharge."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "'Impression' as a section header contains 'PRES' as a substring in older matching logic — regression guard confirming whole-word matching (not substring) is in effect for this exact historical false-positive shape.",
  },
  {
    id: "fp-05",
    category: "false_positive_traps",
    documents: ["Patient has a family history of malignant neoplasm of the respiratory organs, no personal history."],
    expectedMatches: [{ code: "Z802", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "J989", codeSystem: "ICD-10-CM" }],
    reason: "A FAMILY history of a respiratory condition should code the family-history Z-code, not an active respiratory disorder in the patient themselves — tests whether 'respiratory' alone over-triggers the generic 'Disease, diseased, respiratory' -> J98.9 entry regardless of context.",
  },
  {
    id: "fp-06",
    category: "false_positive_traps",
    documents: ["Patient was seen by cardiology; heart failure was discussed as a differential but not confirmed."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "I509", codeSystem: "ICD-10-CM" }],
    reason: "A differential diagnosis explicitly framed as unconfirmed ('discussed... but not confirmed') should not be coded as an actual diagnosis.",
  },
];
