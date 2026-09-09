import type { GoldCase } from "../types.js";

/** listAllEvidence()'s "evidence graph" — the same code should surface
 *  independently for each document/sentence that supports it, not
 *  collapse to a single citation. Mostly already covered by an existing
 *  regression test (suggestions.service.spec.ts); kept here so the
 *  harness's per-category report doesn't have a silent gap where this
 *  category is concerned. */
export const multipleEvidenceSourcesCases: GoldCase[] = [
  {
    id: "multi-01",
    category: "multiple_evidence_sources",
    documents: [
      "H&P: Type 2 diabetes mellitus noted on past medical history.",
      "Discharge summary: Type 2 diabetes mellitus, continue home metformin.",
    ],
    expectedMatches: [{ code: "E119", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Same condition, genuinely independently documented across two real document types — should surface once in listSuggestions() (deduplicated) while listAllEvidence() should show two independent supporting excerpts.",
  },
  {
    id: "multi-02",
    category: "multiple_evidence_sources",
    documents: [
      "Nursing note: patient reports shortness of breath with exertion.",
      "Physician progress note: shortness of breath improved after diuresis.",
    ],
    expectedMatches: [{ code: "R0602", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Same symptom mentioned by two different document authors — tests that evidence aggregation isn't accidentally scoped to a single document type.",
  },
  {
    id: "multi-03",
    category: "multiple_evidence_sources",
    documents: [
      "Admission H&P: patient with known hypertension.",
      "Nursing note: blood pressure well controlled today.",
      "Discharge summary: hypertension, continue home regimen.",
    ],
    expectedMatches: [{ code: "I10", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Three independent documents; only two explicitly name the condition (the middle one doesn't) — confirms the count of supporting evidence tracks real mentions, not just document count.",
  },
];
