import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { TerminologyService } from "../terminology/terminology.service.js";
import { SuggestionsService } from "../suggestions/suggestions.service.js";
import { DecisionExplanationService } from "./decision-explanation.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

/**
 * Regression coverage for query-to-code linkage: Query gained optional
 * relatedCode/relatedCodeSystem fields (see docs/TEST_REPORT.md
 * "Query-to-code linkage") so a Decision Explanation card can show which
 * open queries are actually about the candidate code being explained,
 * instead of a bare count of every open query anywhere on the encounter.
 * The correctness property that matters here isn't "queries can be
 * created" (already covered elsewhere) — it's that the filter is scoped
 * precisely: a query about one code must never leak into another code's
 * explanation just because they're on the same encounter.
 */
describe("DecisionExplanationService — query linkage", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const terminology = new TerminologyService(referencePrisma);
  const suggestions = new SuggestionsService(appPrisma, referencePrisma, terminology);
  const service = new DecisionExplanationService(appPrisma, referencePrisma, suggestions);

  const encounterIds: number[] = [];

  async function seed(): Promise<number> {
    const id = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(id);
    return id;
  }

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await deleteTestEncounter(appPrisma, id);
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
    await referencePrisma.$disconnect();
  });

  it("surfaces a query linked to this exact code", async () => {
    const encounterId = await seed();
    await appPrisma.query.create({
      data: {
        encounterId,
        createdById: 1,
        question: "Does the documentation support J189?",
        relatedCode: "J189",
        relatedCodeSystem: "ICD-10-CM",
      },
    });

    const explanation = await service.explain(encounterId, TEST_FACILITY_ID, "J189", "ICD-10-CM");

    expect(explanation.relatedQueries).toHaveLength(1);
    expect(explanation.relatedQueries[0]).toMatchObject({ question: "Does the documentation support J189?" });
  });

  it("does not leak a query linked to a different code", async () => {
    const encounterId = await seed();
    await appPrisma.query.create({
      data: {
        encounterId,
        createdById: 1,
        question: "Does the documentation support J189?",
        relatedCode: "J189",
        relatedCodeSystem: "ICD-10-CM",
      },
    });

    // A different code on the same encounter must see none of it.
    const explanation = await service.explain(encounterId, TEST_FACILITY_ID, "N179", "ICD-10-CM");

    expect(explanation.relatedQueries).toEqual([]);
  });

  it("does not treat a same-code-different-codeSystem query as related", async () => {
    const encounterId = await seed();
    // A PCS code that happens to share the literal string "J189" would be a
    // pathological edge case, but the filter must key on BOTH fields, not
    // code alone — assert that explicitly rather than assuming it.
    await appPrisma.query.create({
      data: {
        encounterId,
        createdById: 1,
        question: "Unrelated PCS question",
        relatedCode: "J189",
        relatedCodeSystem: "ICD-10-PCS",
      },
    });

    const explanation = await service.explain(encounterId, TEST_FACILITY_ID, "J189", "ICD-10-CM");

    expect(explanation.relatedQueries).toEqual([]);
  });

  it("a query with no related code (raised from a Documentation Gap) never appears as related to any code", async () => {
    const encounterId = await seed();
    await appPrisma.query.create({
      data: { encounterId, createdById: 1, question: "Is there kidney involvement?" },
    });

    const explanation = await service.explain(encounterId, TEST_FACILITY_ID, "J189", "ICD-10-CM");

    expect(explanation.relatedQueries).toEqual([]);
  });
});
