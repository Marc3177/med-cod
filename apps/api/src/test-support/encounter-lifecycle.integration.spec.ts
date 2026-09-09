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
 * One deterministic, whole-lifecycle integration test — the capstone of the
 * stabilization pass (see docs/TEST_REPORT.md "Encounter ownership /
 * locked-state audit"). Every module-level spec in this project tests one
 * service's transitions in isolation; this is the only test that drives the
 * full real sequence across all three services and asserts, at each stage,
 * that only the workflow which owns the current state can mutate it — the
 * exact invariant whose absence produced the three bugs and one business
 * rule this stabilization pass found.
 *
 * NEW -> IN_PROGRESS -> QUERY_PENDING -> IN_PROGRESS -> QA_REVIEW ->
 * RETURNED -> IN_PROGRESS -> QA_REVIEW -> APPROVED (-> FINALIZED)
 *
 * QaService's sampling is mocked deterministically at each finalize() call
 * (vi.spyOn(Math, "random")) rather than looping until chance cooperates —
 * the whole point of this suite's discipline, established in the two
 * commits before it, is never asserting on a random outcome.
 */
describe("Encounter lifecycle — full state machine, deterministic", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const grouper = new GrouperService(referencePrisma);
  const qa = new QaService(appPrisma);
  const coding = new CodingService(appPrisma, referencePrisma, grouper, qa);
  const queries = new QueriesService(appPrisma);

  // Not just a happy-path convenience — cleanup MUST survive a failed run
  // (e.g. a deliberate teeth-proof revert) or every subsequent run leaks
  // an encounter, same lesson as the leftover-patient cleanup bug found
  // and fixed in queries.service.spec.ts. Tracked in an outer-scope array
  // rather than deleted inline at the end of the test body, so afterEach
  // runs it regardless of how the test exits.
  const encounterIds: number[] = [];

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await appPrisma.qaReview.deleteMany({ where: { encounterId: id } });
      await deleteTestEncounter(appPrisma, id);
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
    await referencePrisma.$disconnect();
  });

  it("drives the whole real lifecycle, asserting ownership at every stage", async () => {
    const encounterId = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(encounterId);

    // --- NEW ---
    let encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("NEW");

    // --- NEW -> IN_PROGRESS (Coding owns this transition) ---
    await coding.saveDraft(encounterId, CODER_ID, TEST_FACILITY_ID, {
      encounterId,
      diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      procedures: [],
    });
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("IN_PROGRESS");

    // --- IN_PROGRESS -> QUERY_PENDING (Queries owns this transition) ---
    const query = await queries.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Is this aspiration pneumonia?");
    await queries.send(query.id, TEST_FACILITY_ID);
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QUERY_PENDING");

    // Ownership check: Coding does not own QUERY_PENDING. finalize() must
    // reject (the "no open queries" business rule), and must not mutate
    // anything while rejecting.
    await expect(coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      BadRequestException
    );
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QUERY_PENDING");

    // --- QUERY_PENDING -> IN_PROGRESS (Queries owns this transition, once resolved) ---
    await queries.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Yes, aspiration pneumonia.");
    await queries.resolve(query.id, CODER_ID, TEST_FACILITY_ID);
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("IN_PROGRESS");

    // --- IN_PROGRESS -> [FINALIZED, transiently] -> QA_REVIEW (Coding
    // finalizes; QaService's sampling — forced to hit — immediately moves
    // it on, so QA_REVIEW is the only externally-observable resting state) ---
    let randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // forces a sample
    await coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID);
    randomSpy.mockRestore();
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QA_REVIEW");

    // Ownership check: neither Coding nor Queries owns QA_REVIEW. All three
    // coder-side mutations must reject it, and none may mutate state.
    await expect(
      coding.saveDraft(encounterId, CODER_ID, TEST_FACILITY_ID, {
        encounterId,
        diagnoses: [{ code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
        procedures: [],
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      queries.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Another question?")
    ).rejects.toBeInstanceOf(BadRequestException);
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QA_REVIEW");
    const codingAfterAttempts = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
    expect((codingAfterAttempts.diagnoses as { code: string }[]).map((d) => d.code)).toEqual(["J189"]);

    // --- QA_REVIEW -> RETURNED -> IN_PROGRESS (QA owns this transition) ---
    const firstReview = await appPrisma.qaReview.findFirstOrThrow({ where: { encounterId, status: "PENDING" } });
    await qa.returnToCoder(firstReview.id, AUDITOR_ID, TEST_FACILITY_ID, "Principal diagnosis needs more specificity.");
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("IN_PROGRESS");

    // Ownership check: the return is QA's alone to make — a second
    // return/approve on the same (now RETURNED) review must reject.
    await expect(qa.approve(firstReview.id, AUDITOR_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      BadRequestException
    );

    // --- Recode, now legal again at IN_PROGRESS (Coding owns this) ---
    await coding.saveDraft(encounterId, CODER_ID, TEST_FACILITY_ID, {
      encounterId,
      diagnoses: [{ code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      procedures: [],
    });
    const recoded = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
    expect((recoded.diagnoses as { code: string }[]).map((d) => d.code)).toEqual(["N179"]);

    // --- IN_PROGRESS -> QA_REVIEW again (re-sampled on re-finalize) ---
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    await coding.finalize(encounterId, CODER_ID, TEST_FACILITY_ID);
    randomSpy.mockRestore();
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("QA_REVIEW");

    // --- QA_REVIEW -> APPROVED -> FINALIZED (QA owns this transition) ---
    const secondReview = await appPrisma.qaReview.findFirstOrThrow({ where: { encounterId, status: "PENDING" } });
    await qa.approve(secondReview.id, AUDITOR_ID, TEST_FACILITY_ID);
    encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(encounter.status).toBe("FINALIZED");

    // --- Final integrity assertions: nothing about the earlier cycle was
    // lost or overwritten by the second one ---
    const allReviews = await appPrisma.qaReview.findMany({ where: { encounterId }, orderBy: { createdAt: "asc" } });
    expect(allReviews).toHaveLength(2);
    expect(allReviews[0]).toMatchObject({ status: "RETURNED", reason: "Principal diagnosis needs more specificity." });
    expect(allReviews[1]).toMatchObject({ status: "APPROVED" });

    const finalQuery = await appPrisma.query.findUniqueOrThrow({ where: { id: query.id } });
    expect(finalQuery.status).toBe("RESOLVED");

    const auditEntries = await appPrisma.auditEntry.findMany({
      where: { codingDecision: { encounterId } },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEntries.map((e) => e.action)).toEqual(["CREATE_DRAFT", "FINALIZE", "UPDATE_DRAFT", "FINALIZE"]);
  });
});
