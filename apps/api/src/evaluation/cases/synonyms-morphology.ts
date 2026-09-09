import type { GoldCase } from "../types.js";

/** Word-FORM variants of the same underlying concept (noun/adjective/verb
 *  spellings) — tests whether the matcher's SYNONYM_CLUSTERS coverage
 *  (currently: hypertension/hypertensive, diabetes/diabetic, thrombosis/
 *  thrombotic, failure/failed) is complete, and surfaces the concrete
 *  gaps that aren't (respiration/respiratory, infarct/infarction). */
export const synonymsMorphologyCases: GoldCase[] = [
  {
    id: "syn-01",
    category: "synonyms_morphology",
    documents: ["Patient has essential hypertension, well controlled on lisinopril."],
    expectedMatches: [{ code: "I10", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Baseline: 'hypertension' (noun form) should match without needing 'hypertensive' too.",
  },
  {
    id: "syn-02",
    category: "synonyms_morphology",
    documents: ["Blood pressure elevated, consistent with hypertensive urgency."],
    expectedMatches: [{ code: "I160", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Adjective form ('hypertensive') alone, shipped cluster.",
  },
  {
    id: "syn-03",
    category: "synonyms_morphology",
    documents: ["Patient has type 2 diabetes mellitus, diet controlled."],
    expectedMatches: [{ code: "E119", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Noun form 'diabetes' alone, shipped cluster.",
  },
  {
    id: "syn-04",
    category: "synonyms_morphology",
    documents: ["Type 1 diabetic ketoacidosis on admission, insulin drip started."],
    expectedMatches: [{ code: "E1010", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Adjective form 'diabetic' alone, shipped cluster. Corrected after the baseline run: the original sentence omitted 'Type 1', so the engine correctly returned the Type 2 code (E11.10) by default — a gold-case authoring error, not an engine bug.",
  },
  {
    id: "syn-05",
    category: "synonyms_morphology",
    documents: ["Ultrasound confirms deep vein thrombosis of the left lower extremity."],
    expectedMatches: [{ code: "I82402", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Noun form 'thrombosis' alone, shipped cluster.",
  },
  {
    id: "syn-06",
    category: "synonyms_morphology",
    documents: ["CT confirms an acute thrombotic occlusion of the deep venous system."],
    expectedMatches: [{ code: "I8290", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Adjective form 'thrombotic' alone, shipped cluster.",
  },
  {
    id: "syn-07",
    category: "synonyms_morphology",
    documents: ["Patient presents with acute CHF exacerbation, started on IV diuresis."],
    expectedMatches: [{ code: "I509", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "'Failure' via CHF abbreviation, shipped cluster + terminology expansion combined.",
  },
  {
    id: "syn-08",
    category: "synonyms_morphology",
    documents: ["Acute myocardial infarction confirmed by troponin elevation and EKG changes."],
    expectedMatches: [{ code: "I219", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "KNOWN GAP (already tracked in TEST_REPORT.md Known Limitations): 'infarct'/'infarction'/'myocardium'/'myocardial' word-forms are not yet a shipped synonym cluster — expected to currently FAIL. Kept in the harness specifically so the fix's real effect is measured, not assumed.",
  },
  {
    id: "syn-09",
    category: "synonyms_morphology",
    documents: ["Patient in acute respiratory failure requiring emergent intubation."],
    expectedMatches: [{ code: "J9600", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "KNOWN GAP found by this evaluation (P1_EVIDENCE_EVALUATION.md): 'respiration'/'respiratory' are required as two separate AND-terms, not clustered — expected to currently FAIL.",
  },
  {
    id: "syn-10",
    category: "synonyms_morphology",
    documents: ["Patient reports chronic lower back pain, worsened over the past week."],
    expectedMatches: [{ code: "M5450", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Control case: a condition with no word-form ambiguity at all, to confirm the harness itself isn't systematically biased toward failure. Corrected after the baseline run: M54.5 was subdivided into M54.50/51/59 in the FY2026 code set — the original case cited the retired parent code, a gold-case authoring error caught by seeing what the engine actually returned (M54.50 among the extras), not an engine bug.",
  },
];
