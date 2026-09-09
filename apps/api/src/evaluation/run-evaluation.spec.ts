import { afterAll, describe, it } from "vitest";
import { AppPrismaService } from "../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../prisma/reference-prisma.service.js";
import { TerminologyService } from "../modules/terminology/terminology.service.js";
import { SuggestionsService } from "../modules/suggestions/suggestions.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../test-support/encounter-fixture.js";
import { allGoldCases } from "./cases/index.js";
import type { ExpectedCode, GoldCase } from "./types.js";

/**
 * P1-E0 — Permanent Clinical Intelligence Evaluation Harness.
 *
 * This is NOT a correctness test — it measures whether the deterministic
 * matching engine finds the clinically relevant evidence it's supposed to
 * find, against a gold-annotated adversarial chart set declared BEFORE any
 * case is run (see cases/*.ts). It is deliberately excluded from the
 * default `npm test` run (see vitest.config.ts's exclude list) — its
 * "pass/fail" is not a merge gate, its MEASUREMENTS are the product. Run it
 * explicitly via `npm run evaluate`.
 *
 * Every gold case declares expectedMatches (codes that SHOULD fire) and
 * expectedNonMatches (codes that SHOULD NOT fire, the primary signal for
 * negation/false-positive-trap cases) — scored, never inferred from
 * whatever the engine happens to produce. See docs/EVALUATION_HARNESS.md
 * for the methodology and the current baseline results.
 */

type ScoredCode = ExpectedCode & { outcome: "TP" | "FN" | "FP" | "TN" };

type CaseResult = {
  id: string;
  category: string;
  reason: string;
  scored: ScoredCode[];
  extraSuggestions: { code: string; codeSystem: string }[];
};

const codeKey = (c: ExpectedCode) => `${c.codeSystem}:${c.code}`;

describe("P1-E0 evaluation harness", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const terminology = new TerminologyService(referencePrisma);
  const service = new SuggestionsService(appPrisma, referencePrisma, terminology);

  afterAll(async () => {
    await appPrisma.$disconnect();
    await referencePrisma.$disconnect();
  });

  it("verifies every gold-case code actually exists in the FY2026 reference tables (catches authoring errors before they're scored as engine failures)", async () => {
    const allCodes = new Map<string, ExpectedCode>();
    for (const c of allGoldCases) {
      for (const ec of [...c.expectedMatches, ...c.expectedNonMatches]) {
        allCodes.set(codeKey(ec), ec);
      }
    }
    const missing: ExpectedCode[] = [];
    for (const ec of allCodes.values()) {
      if (ec.codeSystem === "ICD-10-CM") {
        const found = await referencePrisma.icd10CmCode.findUnique({
          where: { code_fiscalYear: { code: ec.code, fiscalYear: 2026 } },
        });
        if (!found) missing.push(ec);
      } else {
        const found = await referencePrisma.icd10PcsCode.findUnique({
          where: { code_fiscalYear: { code: ec.code, fiscalYear: 2026 } },
        });
        if (!found) missing.push(ec);
      }
    }
    console.log("VERIFICATION", JSON.stringify({ totalUniqueCodes: allCodes.size, missingCount: missing.length, missing }));
  });

  it("runs the full gold-case set against the real engine and reports recall/precision per category", async () => {
    const results: CaseResult[] = [];

    for (const c of allGoldCases) {
      const encounterId = await createTestEncounter(
        appPrisma,
        c.documents.map((content) => ({ type: "NOTE", content }))
      );
      const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);
      const actualKeys = new Set(suggestions.map((s) => `${s.codeSystem}:${s.code}`));

      const scored: ScoredCode[] = [];
      for (const ec of c.expectedMatches) {
        scored.push({ ...ec, outcome: actualKeys.has(codeKey(ec)) ? "TP" : "FN" });
      }
      for (const ec of c.expectedNonMatches) {
        scored.push({ ...ec, outcome: actualKeys.has(codeKey(ec)) ? "FP" : "TN" });
      }
      const annotatedKeys = new Set([...c.expectedMatches, ...c.expectedNonMatches].map(codeKey));
      const extraSuggestions = suggestions
        .filter((s) => !annotatedKeys.has(`${s.codeSystem}:${s.code}`))
        .map((s) => ({ code: s.code, codeSystem: s.codeSystem }));

      results.push({ id: c.id, category: c.category, reason: c.reason, scored, extraSuggestions });
      await deleteTestEncounter(appPrisma, encounterId);
    }

    const byCategory = new Map<string, { tp: number; fn: number; fp: number; tn: number }>();
    for (const r of results) {
      const bucket = byCategory.get(r.category) ?? { tp: 0, fn: 0, fp: 0, tn: 0 };
      for (const s of r.scored) {
        if (s.outcome === "TP") bucket.tp++;
        else if (s.outcome === "FN") bucket.fn++;
        else if (s.outcome === "FP") bucket.fp++;
        else bucket.tn++;
      }
      byCategory.set(r.category, bucket);
    }

    const summary = Array.from(byCategory.entries()).map(([category, b]) => ({
      category,
      recall: b.tp + b.fn > 0 ? +(b.tp / (b.tp + b.fn)).toFixed(3) : null,
      precision: b.tp + b.fp > 0 ? +(b.tp / (b.tp + b.fp)).toFixed(3) : null,
      ...b,
    }));

    const totals = summary.reduce(
      (acc, s) => ({ tp: acc.tp + s.tp, fn: acc.fn + s.fn, fp: acc.fp + s.fp, tn: acc.tn + s.tn }),
      { tp: 0, fn: 0, fp: 0, tn: 0 }
    );

    console.log("EVAL_SUMMARY", JSON.stringify({ summary, totals, caseCount: allGoldCases.length }));
    console.log("EVAL_DETAIL", JSON.stringify(results));
  });
});
