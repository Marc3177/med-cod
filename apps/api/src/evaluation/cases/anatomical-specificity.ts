import type { GoldCase } from "../types.js";

/** Laterality and site specificity — does the matcher pick the SPECIFIC
 *  code the documentation supports, not just a generic/unspecified one,
 *  and does it avoid picking the WRONG side when only one is documented? */
export const anatomicalSpecificityCases: GoldCase[] = [
  {
    id: "anat-01",
    category: "anatomical_specificity",
    documents: ["Ultrasound confirms deep vein thrombosis of the left lower extremity."],
    expectedMatches: [{ code: "I82402", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "I82401", codeSystem: "ICD-10-CM" }],
    reason: "Laterality stated as 'left' — the right-sided code should not fire.",
  },
  {
    id: "anat-02",
    category: "anatomical_specificity",
    documents: ["Ultrasound confirms deep vein thrombosis of the right lower extremity."],
    expectedMatches: [{ code: "I82401", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "I82402", codeSystem: "ICD-10-CM" }],
    reason: "Mirror of anat-01, opposite side, to confirm the engine isn't defaulting to one side regardless of what's documented.",
  },
  {
    id: "anat-03",
    category: "anatomical_specificity",
    documents: ["Patient reports left-sided weakness noted on neurological exam."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "A bare symptom ('weakness') without an underlying diagnosis named is not specific enough to code — confirms the engine doesn't manufacture a diagnosis from a symptom alone, and is a real documentation-gap opportunity, not a matching failure.",
  },
  {
    id: "anat-04",
    category: "anatomical_specificity",
    documents: ["Fracture of the right femoral shaft, closed, sustained in a fall."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "Currently a confirmed false negative in P1_EVIDENCE_EVALUATION.md ('Fracture of the right femur' produced zero suggestions) — no expectedMatches declared yet because the correct specific code hasn't been confirmed against the real index; this case exists to be filled in once that follow-up trace (flagged as future work in the evaluation doc) completes, not to silently pass.",
  },
];
