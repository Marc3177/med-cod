import type { GoldCase } from "../types.js";

/** Cases where the CORRECT behavior for the SUGGESTIONS engine is
 *  silence — a lab value or symptom alone is not sufficient grounds to
 *  suggest a diagnosis; that gap is DocumentationGapsService's job, not
 *  this engine's. Every expectedMatches list here is deliberately empty;
 *  a "failure" in this category would mean the engine is manufacturing
 *  diagnoses it has no real business asserting. */
export const documentationGapsCases: GoldCase[] = [
  {
    id: "gap-01",
    category: "documentation_gaps",
    documents: ["Creatinine 3.2 on admission labs."],
    expectedMatches: [],
    expectedNonMatches: [
      { code: "N179", codeSystem: "ICD-10-CM" },
      { code: "N189", codeSystem: "ICD-10-CM" },
    ],
    reason: "A bare lab value with no diagnosis language at all — the suggestions engine must not infer a kidney diagnosis from a number alone; this is exactly what DocumentationGapsService exists to flag instead.",
  },
  {
    id: "gap-02",
    category: "documentation_gaps",
    documents: ["Troponin elevated at 0.8 on repeat draw."],
    expectedMatches: [],
    expectedNonMatches: [{ code: "I219", codeSystem: "ICD-10-CM" }],
    reason: "Same pattern for a cardiac marker — an elevated troponin alone is not a diagnosis of MI.",
  },
  {
    id: "gap-03",
    category: "documentation_gaps",
    documents: ["Sodium 128 on admission chemistry panel."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "A low sodium value alone, with no diagnosis (hyponatremia) ever named.",
  },
  {
    id: "gap-04",
    category: "documentation_gaps",
    documents: ["Patient reports feeling generally unwell for the past two days."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "Vague, non-specific narrative with no clinical content precise enough to code anything from.",
  },
];
