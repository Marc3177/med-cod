import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { DocumentationGapsService } from "./documentation-gaps.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

/**
 * Regression coverage for the real bug found while building this feature
 * (see docs/TEST_REPORT.md, "Documentation-gap 'already coded' check used
 * exact match instead of prefix match"): comparing a full coded code
 * (e.g. "N179") for exact membership against an indicator's related-code
 * *prefix* ("N17") would never match, since "N17" alone is never a real
 * billable code a coder would assign — the fix was to use `startsWith`.
 */
describe("DocumentationGapsService", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const service = new DocumentationGapsService(appPrisma, referencePrisma);

  const encounterIds: number[] = [];

  async function seed(
    documents: { type: string; content: string }[],
    options?: { diagnoses?: Record<string, unknown>[] }
  ): Promise<number> {
    const id = await createTestEncounter(appPrisma, documents, options);
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

  it("flags an elevated lab value with nothing coded to address it", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Creatinine on admission was 2.1, concerning for acute kidney injury." },
    ]);

    const gaps = await service.listGaps(encounterId, TEST_FACILITY_ID);

    expect(gaps.map((g) => g.indicatorName)).toContain("Elevated creatinine");
    expect(gaps.find((g) => g.indicatorName === "Elevated creatinine")?.extractedValue).toBe(2.1);
  });

  it("never produces a code field — only a suggestedQuery (potential query ≠ diagnosis)", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Creatinine on admission was 2.1, concerning for acute kidney injury." },
    ]);

    const gaps = await service.listGaps(encounterId, TEST_FACILITY_ID);
    const gap = gaps.find((g) => g.indicatorName === "Elevated creatinine");

    expect(gap).toBeDefined();
    expect(gap).not.toHaveProperty("code");
    expect(gap).not.toHaveProperty("suggestedCode");
    expect(typeof gap!.suggestedQuery).toBe("string");
    expect(gap!.suggestedQuery.length).toBeGreaterThan(0);
  });

  it("suppresses the gap once a real coded diagnosis prefix-matches the indicator's related codes (regression: exact-match bug)", async () => {
    const encounterId = await seed(
      [{ type: "DISCHARGE_SUMMARY", content: "Creatinine on admission was 2.1, concerning for acute kidney injury." }],
      {
        diagnoses: [
          {
            code: "N179",
            codeSystem: "ICD-10-CM",
            codeVersion: "2026",
            role: "principal",
            presentOnAdmission: true,
          },
        ],
      }
    );

    const gaps = await service.listGaps(encounterId, TEST_FACILITY_ID);

    expect(gaps.map((g) => g.indicatorName)).not.toContain("Elevated creatinine");
  });

  it("does not flag a value that doesn't cross the indicator's threshold", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Creatinine on admission was 1.0, within normal limits." },
    ]);

    const gaps = await service.listGaps(encounterId, TEST_FACILITY_ID);

    expect(gaps.map((g) => g.indicatorName)).not.toContain("Elevated creatinine");
  });

  it("handles a 'below threshold' indicator (low sodium) as well as 'above'", async () => {
    const encounterId = await seed([{ type: "DISCHARGE_SUMMARY", content: "Sodium was 129 on admission labs." }]);

    const gaps = await service.listGaps(encounterId, TEST_FACILITY_ID);

    expect(gaps.map((g) => g.indicatorName)).toContain("Low sodium");
  });

  it("throws NotFoundException for an encounter that does not exist", async () => {
    await expect(service.listGaps(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ForbiddenException when the encounter belongs to a different facility", async () => {
    const encounterId = await seed([{ type: "DISCHARGE_SUMMARY", content: "Creatinine on admission was 2.1." }]);

    await expect(service.listGaps(encounterId, TEST_FACILITY_ID + 999)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
