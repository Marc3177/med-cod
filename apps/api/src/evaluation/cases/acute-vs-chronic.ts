import type { GoldCase } from "../types.js";

export const acuteVsChronicCases: GoldCase[] = [
  {
    id: "avc-01",
    category: "acute_vs_chronic",
    documents: ["Labs consistent with acute kidney injury, creatinine rising from baseline of 1.0 to 2.8."],
    expectedMatches: [{ code: "N179", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "N189", codeSystem: "ICD-10-CM" }],
    reason: "Acute kidney injury should not also fire the generic chronic-kidney-disease code.",
  },
  {
    id: "avc-02",
    category: "acute_vs_chronic",
    documents: ["Patient has chronic kidney disease, stage 3, stable, followed by nephrology as an outpatient."],
    expectedMatches: [{ code: "N1830", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "N179", codeSystem: "ICD-10-CM" }],
    reason: "Chronic, stable CKD should not fire the acute-kidney-injury code.",
  },
  {
    id: "avc-03",
    category: "acute_vs_chronic",
    documents: ["Patient with acute-on-chronic kidney injury, baseline CKD stage 3 with acute worsening."],
    expectedMatches: [
      { code: "N179", codeSystem: "ICD-10-CM" },
      { code: "N1830", codeSystem: "ICD-10-CM" },
    ],
    expectedNonMatches: [],
    reason: "The one case where BOTH should legitimately fire together — acute-on-chronic is a real, commonly documented combination, not a conflict.",
  },
  {
    id: "avc-04",
    category: "acute_vs_chronic",
    documents: ["Patient in acute respiratory failure requiring intubation, no prior lung disease."],
    expectedMatches: [{ code: "J9600", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "J9610", codeSystem: "ICD-10-CM" }],
    reason: "Acute respiratory failure should not also fire the chronic-respiratory-failure code — depends on the un-shipped respiration/respiratory cluster (see synonyms_morphology syn-09), expected to currently miss the positive match entirely.",
  },
  {
    id: "avc-05",
    category: "acute_vs_chronic",
    documents: ["Patient with chronic obstructive pulmonary disease, stable, no current exacerbation."],
    expectedMatches: [{ code: "J449", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [{ code: "J441", codeSystem: "ICD-10-CM" }],
    reason: "Stable COPD without exacerbation language should not fire the with-exacerbation code.",
  },
];
