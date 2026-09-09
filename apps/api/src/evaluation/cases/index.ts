import type { GoldCase } from "../types.js";
import { synonymsMorphologyCases } from "./synonyms-morphology.js";
import { abbreviationsCases } from "./abbreviations.js";
import { negationCases } from "./negation.js";
import { temporalContextCases } from "./temporal-context.js";
import { numericQualifiersStagingCases } from "./numeric-qualifiers-staging.js";
import { anatomicalSpecificityCases } from "./anatomical-specificity.js";
import { acuteVsChronicCases } from "./acute-vs-chronic.js";
import { clinicalPhrasingVariationCases } from "./clinical-phrasing-variation.js";
import { conflictingEvidenceCases } from "./conflicting-evidence.js";
import { multipleEvidenceSourcesCases } from "./multiple-evidence-sources.js";
import { documentationGapsCases } from "./documentation-gaps.js";
import { falsePositiveTrapsCases } from "./false-positive-traps.js";

export const allGoldCases: GoldCase[] = [
  ...synonymsMorphologyCases,
  ...abbreviationsCases,
  ...negationCases,
  ...temporalContextCases,
  ...numericQualifiersStagingCases,
  ...anatomicalSpecificityCases,
  ...acuteVsChronicCases,
  ...clinicalPhrasingVariationCases,
  ...conflictingEvidenceCases,
  ...multipleEvidenceSourcesCases,
  ...documentationGapsCases,
  ...falsePositiveTrapsCases,
];

// Fail fast, at import time, on an authoring mistake (duplicate case id)
// rather than letting it silently double-count in the report.
const seenIds = new Set<string>();
for (const c of allGoldCases) {
  if (seenIds.has(c.id)) {
    throw new Error(`duplicate gold-case id: ${c.id}`);
  }
  seenIds.add(c.id);
}
