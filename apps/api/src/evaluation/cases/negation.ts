import type { GoldCase } from "../types.js";

/** The systemic gap this evaluation exists to measure precisely, not just
 *  anecdotally: the matcher has zero negation-scope detection. Every case
 *  here declares the negated code as an expectedNonMatch — a case
 *  "passes" only if the engine stays silent, and every one of these is
 *  expected to currently FAIL until negation handling exists. Kept as its
 *  own category deliberately (per explicit instruction): this measures the
 *  real error surface first, rather than assuming a quick regex fix and
 *  declaring victory. */
export const negationCases: GoldCase[] = [
  {
    id: "neg-01",
    category: "negation",
    documents: ["No evidence of pneumonia on chest x-ray."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "J189", codeSystem: "ICD-10-CM" }],
    reason: "Explicit negation ('no evidence of') directly preceding the condition.",
  },
  {
    id: "neg-02",
    category: "negation",
    documents: ["Patient denies chest pain or shortness of breath."],
    expectedMatches: [],
    expectedNonMatches: [
      { code: "R079", codeSystem: "ICD-10-CM" },
      { code: "R0602", codeSystem: "ICD-10-CM" },
    ],
    reason: "'Denies' negating two symptoms in one sentence.",
  },
  {
    id: "neg-03",
    category: "negation",
    documents: ["Myocardial infarction was ruled out by serial troponins."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "I219", codeSystem: "ICD-10-CM" }],
    reason: "'Ruled out' — a standard clinical negation phrase, distinct from 'no'/'denies'.",
  },
  {
    id: "neg-04",
    category: "negation",
    documents: ["No signs of deep vein thrombosis on Doppler ultrasound."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "I82402", codeSystem: "ICD-10-CM" }],
    reason: "'No signs of' negation.",
  },
  {
    id: "neg-05",
    category: "negation",
    documents: ["Blood cultures negative; sepsis is not suspected at this time."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "A419", codeSystem: "ICD-10-CM" }],
    reason: "'Not suspected' negation.",
  },
  {
    id: "neg-06",
    category: "negation",
    documents: ["Patient without acute distress, no shortness of breath noted."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "R0602", codeSystem: "ICD-10-CM" }],
    reason: "'No ... noted' negation.",
  },
  {
    id: "neg-07",
    category: "negation",
    documents: ["Urinalysis is negative for urinary tract infection."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "N390", codeSystem: "ICD-10-CM" }],
    reason: "'Negative for' negation.",
  },
  {
    id: "neg-08",
    category: "negation",
    documents: ["No family history of malignant neoplasm of the respiratory organs."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "Z802", codeSystem: "ICD-10-CM" }],
    reason: "Negation of a family-history statement, not the condition itself — a harder case since the sentence already contains 'history'.",
  },
  {
    id: "neg-09",
    category: "negation",
    documents: ["Patient has pneumonia."],
    expectedMatches: [{ code: "J189", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Control case: the same underlying condition WITHOUT negation, to confirm a fix doesn't overcorrect into suppressing genuine positive findings.",
  },
  {
    id: "neg-10",
    category: "negation",
    documents: ["Sepsis confirmed, patient meets SIRS criteria."],
    expectedMatches: [{ code: "A419", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Control case paired with neg-05: same condition, affirmed rather than negated.",
  },
];
