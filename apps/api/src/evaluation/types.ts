export type EvalCategory =
  | "synonyms_morphology"
  | "abbreviations"
  | "negation"
  | "temporal_context"
  | "numeric_qualifiers_staging"
  | "anatomical_specificity"
  | "acute_vs_chronic"
  | "clinical_phrasing_variation"
  | "conflicting_evidence"
  | "multiple_evidence_sources"
  | "documentation_gaps"
  | "false_positive_traps";

export type ExpectedCode = { code: string; codeSystem: "ICD-10-CM" | "ICD-10-PCS" };

/**
 * One gold-annotated adversarial case. The expectation is declared BEFORE
 * the case is ever run against the engine — never retrofitted to whatever
 * the engine happened to produce (that would let the engine judge itself).
 *
 * documents: one case can span multiple documents, for the
 * multiple-evidence-sources and conflicting-evidence categories
 * specifically — most categories use exactly one.
 */
export type GoldCase = {
  id: string;
  category: EvalCategory;
  documents: string[];
  /** Codes the engine SHOULD surface (a true positive if present, a false
   *  negative if absent). Empty for cases where nothing should match at
   *  all (e.g. a pure documentation-gap case, or a negation case where the
   *  correct behavior is silence). */
  expectedMatches: ExpectedCode[];
  /** Codes the engine SHOULD NOT surface (a false positive if present, a
   *  true negative if absent) — the primary signal for negation and
   *  false-positive-trap cases. */
  expectedNonMatches: ExpectedCode[];
  /** Why this case exists and what specifically it's testing — required,
   *  not optional, so a failing case is immediately actionable rather than
   *  needing re-derivation of intent. */
  reason: string;
};
