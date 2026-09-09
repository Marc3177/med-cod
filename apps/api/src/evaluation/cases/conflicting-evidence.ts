import type { GoldCase } from "../types.js";

/** Two documents (or two passages) disagreeing about the same condition —
 *  the matcher has no temporal/authority weighting, so it treats every
 *  sentence as equally valid evidence regardless of which note supersedes
 *  which. */
export const conflictingEvidenceCases: GoldCase[] = [
  {
    id: "conf-01",
    category: "conflicting_evidence",
    documents: [
      "Admission note: pneumonia suspected given fever and cough.",
      "Discharge summary: pneumonia was ruled out; findings ultimately attributed to atelectasis.",
    ],
    expectedMatches: [{ code: "J9811", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "J189", codeSystem: "ICD-10-CM" }],
    reason: "Confirmed false positive from P1_EVIDENCE_EVALUATION.md: the later, authoritative discharge note's negation doesn't suppress the earlier suspicion.",
  },
  {
    id: "conf-02",
    category: "conflicting_evidence",
    documents: [
      "H&P: rule out sepsis given tachycardia and fever.",
      "Progress note day 2: cultures negative, sepsis effectively excluded, likely viral syndrome.",
    ],
    expectedMatches: [],
    expectedNonMatches: [{ code: "A419", codeSystem: "ICD-10-CM" }],
    reason: "Same pattern as conf-01 for a different condition — an initial working diagnosis later excluded should not be coded.",
  },
  {
    id: "conf-03",
    category: "conflicting_evidence",
    documents: [
      "Admission note: acute kidney injury suspected, creatinine 2.1 on arrival.",
      "Discharge summary: acute kidney injury confirmed, resolved with IV fluids prior to discharge.",
    ],
    expectedMatches: [{ code: "N179", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Control: two documents that AGREE (the second confirms rather than negates the first) — should still correctly surface the code, confirming a future fix for conf-01/02 doesn't overcorrect into suppressing confirmed diagnoses just because a later note also discusses them.",
  },
];
