import type { GoldCase } from "../types.js";

/** Distinguishing a resolved/historical condition from an active one —
 *  related to but distinct from plain negation: the condition genuinely
 *  happened, just not now. The correct code is often a Z-code (personal
 *  history), not the active-disease code, and the matcher has no
 *  mechanism to prefer one over the other when both fire. */
export const temporalContextCases: GoldCase[] = [
  {
    id: "temp-01",
    category: "temporal_context",
    documents: ["History of myocardial infarction, no acute event this admission."],
    expectedMatches: [{ code: "I252", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "I219", codeSystem: "ICD-10-CM" }],
    reason: "Old/healed MI should code to I25.2 (history of MI), never the acute I21.x code — currently blocked by the un-shipped infarct/infarction cluster (see synonyms_morphology syn-08), so expect a false negative on the expected match for a different, already-tracked reason.",
  },
  {
    id: "temp-02",
    category: "temporal_context",
    documents: ["Patient has a history of cerebrovascular accident five years ago, no residual deficits."],
    expectedMatches: [{ code: "Z8673", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "I639", codeSystem: "ICD-10-CM" }],
    reason: "Confirmed false positive from P1_EVIDENCE_EVALUATION.md: both the correct history code AND the active-infarction code fire together, with no signal to prefer the history code.",
  },
  {
    id: "temp-03",
    category: "temporal_context",
    documents: ["Patient admitted with acute ischemic stroke, right-sided weakness on exam."],
    expectedMatches: [{ code: "I639", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Control: a genuinely ACTIVE stroke should still correctly surface I63.9 — confirms a temporal-context fix must not suppress true active-disease matches.",
  },
  {
    id: "temp-04",
    category: "temporal_context",
    documents: ["History of type 2 diabetes mellitus, well controlled, continues home metformin."],
    expectedMatches: [{ code: "E119", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Deliberately the OPPOSITE expectation from temp-01/02: a chronic condition still being actively managed ('well controlled', continued medication) is correctly coded as active despite the words 'history of' — coding guidelines treat this differently from a truly resolved acute event. Already an existing regression test (suggestions.service.spec.ts) — included here to keep the temporal-context category honest about which direction is correct.",
  },
  {
    id: "temp-05",
    category: "temporal_context",
    documents: ["Post-operative day 3 following appendectomy, recovering well."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "A purely administrative/status statement with no active diagnosis to suggest — confirms the engine doesn't manufacture a diagnosis out of routine post-op status language alone.",
  },
  {
    id: "temp-06",
    category: "temporal_context",
    documents: ["Patient's diabetes, previously well controlled, is now poorly controlled with hyperglycemia."],
    expectedMatches: [{ code: "E119", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "A condition changing status over time within one note — should still surface the active code for the CURRENT state described.",
  },
];
