import type { GoldCase } from "../types.js";

/** Real documentation rarely uses the exact Alphabetic Index headword —
 *  casual, narrative, or shorthand phrasing that never uses the literal
 *  term at all is the hard version of this category (distinct from the
 *  weak test case flagged in P1_EVIDENCE_EVALUATION.md, which
 *  accidentally still contained the literal word). */
export const clinicalPhrasingVariationCases: GoldCase[] = [
  {
    id: "phrase-01",
    category: "clinical_phrasing_variation",
    documents: ["Blood sugars have been running in the 300s all week, patient reports poor adherence to insulin."],
    expectedMatches: [{ code: "E119", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Never uses the word 'diabetes' or 'diabetic' at all — a real test of implicit clinical phrasing, expected to currently miss (no lab-value-to-diagnosis inference exists in a pure keyword matcher).",
  },
  {
    id: "phrase-02",
    category: "clinical_phrasing_variation",
    documents: ["Patient's kidneys are not filtering well, BUN and creatinine both trending up."],
    expectedMatches: [{ code: "N179", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Describes acute kidney injury functionally without the term itself — expected to currently miss for the same reason as phrase-01.",
  },
  {
    id: "phrase-03",
    category: "clinical_phrasing_variation",
    documents: ["Patient is short of breath and requiring more oxygen than baseline, working harder to breathe."],
    expectedMatches: [{ code: "R0602", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Uses the literal phrase 'short of breath' rather than 'shortness of breath' — tests whether tense/word-order variation, not vocabulary substitution, still matches.",
  },
  {
    id: "phrase-04",
    category: "clinical_phrasing_variation",
    documents: ["Pressure is running high today, 190s systolic, patient asymptomatic."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "Describes an elevated vital sign narratively without ever naming hypertension as a diagnosis — a single elevated reading is not itself grounds to code hypertension, so silence here is arguably CORRECT, not a gap (contrast with phrase-01/02, which describe genuine diagnosable states).",
  },
  {
    id: "phrase-05",
    category: "clinical_phrasing_variation",
    documents: ["Sats have been dropping, patient looks like they're working hard to breathe, sent to the ICU."],
    expectedMatches: [],
    expectedNonMatches: [],
    reason: "Highly informal narrative language describing possible acute respiratory decompensation, with no named diagnosis at all — a real documentation-gap trigger (declining oxygenation), not something a matching engine should code from directly.",
  },
];
