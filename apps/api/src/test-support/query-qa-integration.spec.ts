import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AppPrismaService } from "../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../prisma/reference-prisma.service.js";
import { GrouperService } from "../modules/grouper/grouper.service.js";
import { QaService } from "../modules/qa/qa.service.js";
import { CodingService } from "../modules/coding/coding.service.js";
import { QueriesService } from "../modules/queries/queries.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "./encounter-fixture.js";

const CODER_ID = 1;
const PROVIDER_ID = 2;
const AUDITOR_ID = 3;
const CODE_VERSION = "2026";

/**
 * Cross-service Query + QA edge cases, the next P0 boundary after the
 * ownership audit (see docs/TEST_REPORT.md "CodingService data-integrity
 * gaps") — every prior suite tested Query and QA transitions largely in
 * isolation from each other. This file specifically covers the case none of
 * them exercise: a query raised, answered, and resolved entirely *within*
 * the window between a QA return and the next finalize — not just "return,
 * then recode, then finalize" (already covered in qa.service.spec.ts's
 * cross-module lifecycle test), but "return, then a whole new CDI query
 * cycle, then finalize."
 */
describe("Query + QA integration — the requery-after-return loop", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const grouper = new GrouperService(referencePrisma);
  const qa = new QaService(appPrisma);
  const coding = new CodingService(appPrisma, referencePrisma, grouper, qa);
  const queries = new QueriesService(appPrisma);

  const encounterIds: number[] = [];

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await appPrisma.query.deleteMany({ where: { encounterId: id } });
      await appPrisma.qaReview.deleteMany({ where: { encounterId: id } });
      await deleteTestEncounter(appPrisma, id);
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
    await referencePrisma.$disconnect();
  });

  it("a query raised after a QA return correctly blocks, then permits, re-finalization — and QA's prior review history survives", async () => {
    const encounterId = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(encounterId);

    // --- Reach QA_REVIEW deterministically ---
    await coding.saveDraft(encounterId, CODER_ID, TEST_FACILITY_ID, {
      encounterId,
      diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      procedures: [],
    });
    let randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    await coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID);
    randomSpy.mockRestore();
    let encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QA_REVIEW");

    // --- QA returns to coder ---
    const review = await appPrisma.qaReview.findFirstOrThrow({ where: { encounterId, status: "PENDING" } });
    await qa.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Needs a query to clarify the diagnosis.");
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("IN_PROGRESS");

    // --- Coder raises an entirely new query, not just a recode ---
    const query = await queries.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Aspiration or community-acquired?");
    await queries.send(query.id, TEST_FACILITY_ID);
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QUERY_PENDING");

    // Ownership check: finalize must reject while this fresh query is open,
    // exactly the same business rule as the very first cycle — proving it
    // still applies identically on the second time through the loop.
    await expect(coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      BadRequestException
    );

    // --- Provider responds; still open (RESPONDED counts as open) ---
    await queries.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Aspiration pneumonia, confirmed on imaging.");
    await expect(coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      BadRequestException
    );
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QUERY_PENDING");

    // --- Coder resolves the query, recodes with the clarified diagnosis ---
    await queries.resolve(query.id, CODER_ID, TEST_FACILITY_ID);
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("IN_PROGRESS");
    await coding.saveDraft(encounterId, CODER_ID, TEST_FACILITY_ID, {
      encounterId,
      diagnoses: [{ code: "J690", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      procedures: [],
    });

    // --- Finalize now succeeds ---
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999); // force a miss, land cleanly on FINALIZED
    await coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID);
    randomSpy.mockRestore();
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("FINALIZED");

    // --- Integrity: the original RETURNED review's history is untouched,
    // the query ended RESOLVED (not silently reopened or orphaned), and the
    // audit trail records every real step in order ---
    const allReviews = await appPrisma.qaReview.findMany({ where: { encounterId }, orderBy: { createdAt: "asc" } });
    expect(allReviews).toHaveLength(1);
    expect(allReviews[0]).toMatchObject({ status: "RETURNED", reason: "Needs a query to clarify the diagnosis." });

    const finalQuery = await appPrisma.query.findUniqueOrThrow({ where: { id: query.id } });
    expect(finalQuery.status).toBe("RESOLVED");

    const coder = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
    const auditEntries = await appPrisma.auditEntry.findMany({
      where: { codingDecisionId: coder.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEntries.map((e) => e.action)).toEqual(["CREATE_DRAFT", "FINALIZE", "UPDATE_DRAFT", "FINALIZE"]);
  });
});
