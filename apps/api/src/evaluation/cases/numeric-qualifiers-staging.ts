import type { GoldCase } from "../types.js";

/** Confirmed by this evaluation: MIN_SIGNIFICANT_WORD_LENGTH=4 silently
 *  drops standalone digits, so numerically-staged conditions collapse to
 *  "any stage matches" rather than the specific one documented — affects
 *  ~940 of 63,138 index entries by direct count. */
export const numericQualifiersStagingCases: GoldCase[] = [
  {
    id: "num-01",
    category: "numeric_qualifiers_staging",
    documents: ["Patient has chronic kidney disease, stage 3."],
    expectedMatches: [{ code: "N1830", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [
      { code: "N181", codeSystem: "ICD-10-CM" },
      { code: "N182", codeSystem: "ICD-10-CM" },
      { code: "N184", codeSystem: "ICD-10-CM" },
      { code: "N185", codeSystem: "ICD-10-CM" },
    ],
    reason: "Confirmed false positive: stage 1/2/4/5 all fire alongside the correct stage-3 code because the digit is dropped as too short to count.",
  },
  {
    id: "num-02",
    category: "numeric_qualifiers_staging",
    documents: ["Chronic kidney disease, stage 5, patient on hemodialysis."],
    expectedMatches: [{ code: "N185", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [
      { code: "N181", codeSystem: "ICD-10-CM" },
      { code: "N182", codeSystem: "ICD-10-CM" },
      { code: "N1830", codeSystem: "ICD-10-CM" },
      { code: "N184", codeSystem: "ICD-10-CM" },
    ],
    reason: "Same gap, opposite end of the stage range.",
  },
  {
    id: "num-03",
    category: "numeric_qualifiers_staging",
    documents: ["Sacral pressure ulcer, stage 2, being treated with wound care."],
    expectedMatches: [{ code: "L8912", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [
      { code: "L8911", codeSystem: "ICD-10-CM" },
      { code: "L8913", codeSystem: "ICD-10-CM" },
      { code: "L8914", codeSystem: "ICD-10-CM" },
    ],
    reason: "Confirmed by the baseline run, but for a MORE SEVERE reason than the numeric-qualifier gap: pressure-ulcer index entries carry all five excluded ulcer/ulcerated/ulcerating/ulceration/ulcerative word-forms as their headword (see suggestions.service.ts's SYNONYM_CLUSTERS comment on why that cluster is deliberately not shipped). Since they aren't clustered, significantWordGroups() treats each of the five spellings as its OWN separate AND-required word — meaning a pressure-ulcer entry currently requires all five spellings to appear in the same sentence simultaneously, which no real sentence ever will. Pressure ulcers are not just imprecise about staging, they are currently UNMATCHABLE by this engine at all, for any stage or site.",
  },
  {
    id: "num-04",
    category: "numeric_qualifiers_staging",
    documents: ["Heel pressure ulcer, unstageable, black eschar noted on exam."],
    expectedMatches: [{ code: "L896", codeSystem: "ICD-10-CM" }],
    expectedNonMatches: [],
    reason: "Originally intended as a control ('unstageable' isn't a dropped digit, so it should isolate the digit-specific gap from the rest of the pressure-ulcer system) — but it FAILED too, for the same reason as num-03: the entire pressure-ulcer entry family is unmatchable regardless of the stage/site qualifier, because of the unclustered five-way ulcer word-form requirement, not the digit-dropping bug this category was named for. Kept as a real, more severe finding rather than corrected away.",
  },
];
