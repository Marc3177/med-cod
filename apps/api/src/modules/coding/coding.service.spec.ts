import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { GrouperService } from "../grouper/grouper.service.js";
import { QaService } from "../qa/qa.service.js";
import { CodingService } from "./coding.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

const TEST_USER_ID = 1;
const CODE_VERSION = "2026";

/**
 * P0 data-integrity coverage — see docs/TEST_REPORT.md's stabilization
 * pass. CodingService is the single write path for coded diagnoses and
 * procedures on this project; every invariant here protects against a
 * genuinely bad coding decision reaching the database, not just a
 * malformed request shape (Zod already covers shape).
 */
describe("CodingService", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const grouper = new GrouperService(referencePrisma);
  const qa = new QaService(appPrisma);
  const service = new CodingService(appPrisma, referencePrisma, grouper, qa);

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

  function decision(encounterId: number, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      encounterId,
      diagnoses: [
        { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
      ],
      procedures: [],
      ...overrides,
    };
  }

  describe("saveDraft — code validity", () => {
    it("rejects a diagnosis code that does not exist", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        diagnoses: [{ code: "ZZZZZ", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a diagnosis code that exists but is not billable (a category header)", async () => {
      const encounterId = await seed();
      const header = await referencePrisma.icd10CmCode.findFirstOrThrow({
        where: { fiscalYear: 2026, isBillable: false },
      });
      const bad = decision(encounterId, {
        diagnoses: [{ code: header.code, codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a procedure code that does not exist", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        procedures: [{ code: "ZZZZZZZ", codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a procedure code that exists but is not billable (a table header)", async () => {
      const encounterId = await seed();
      const header = await referencePrisma.icd10PcsCode.findFirstOrThrow({
        where: { fiscalYear: 2026, isBillable: false },
      });
      const bad = decision(encounterId, {
        procedures: [{ code: header.code, codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("accepts and persists a valid, well-formed decision", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));

      const saved = await appPrisma.codingDecision.findUnique({ where: { encounterId } });
      expect(saved).not.toBeNull();
      expect(saved!.diagnoses).toEqual([
        { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
      ]);
    });
  });

  describe("saveDraft — principal-diagnosis invariant", () => {
    it("rejects a decision with zero principal diagnoses", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "secondary", presentOnAdmission: true }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a decision with more than one principal diagnosis", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        diagnoses: [
          { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
          { code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
        ],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a decision with zero diagnoses at all", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, { diagnoses: [] });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });

  describe("saveDraft — other invariants", () => {
    it("rejects when the body's encounterId does not match the URL's encounter id", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, { encounterId: encounterId + 999999 });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("persists presentOnAdmission (POA) exactly as submitted, for both true and false", async () => {
      const encounterId = await seed();
      await service.saveDraft(
        encounterId,
        TEST_USER_ID,
        TEST_FACILITY_ID,
        decision(encounterId, {
          diagnoses: [
            { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
            { code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "secondary", presentOnAdmission: false },
          ],
        })
      );

      const saved = await appPrisma.codingDecision.findUnique({ where: { encounterId } });
      const diagnoses = saved!.diagnoses as { code: string; presentOnAdmission: boolean }[];
      expect(diagnoses.find((d) => d.code === "J189")?.presentOnAdmission).toBe(true);
      expect(diagnoses.find((d) => d.code === "N179")?.presentOnAdmission).toBe(false);
    });

    it("current behavior: does not reject a duplicate diagnosis code (documented, not asserted as correct)", async () => {
      const encounterId = await seed();
      const dup = decision(encounterId, {
        diagnoses: [
          { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
          { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "secondary", presentOnAdmission: true },
        ],
      });

      // No duplicate-code check exists in CodingDecisionSchema or
      // CodingService today — this test pins the CURRENT behavior
      // (accepted) so a future change to add or remove that check is a
      // deliberate decision, not an accidental one.
      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, dup)).resolves.toBeDefined();
    });

    it("sets encounter status to IN_PROGRESS after a draft save", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("IN_PROGRESS");
    });

    it("throws NotFoundException for an encounter that does not exist", async () => {
      await expect(
        service.saveDraft(999999999, TEST_USER_ID, TEST_FACILITY_ID, decision(999999999))
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws ForbiddenException when the encounter belongs to a different facility", async () => {
      const encounterId = await seed();

      await expect(
        service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID + 999, decision(encounterId))
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("saveDraft — audit trail", () => {
    it("writes a CREATE_DRAFT audit entry on the first save, and UPDATE_DRAFT with a before/after snapshot on the next", async () => {
      const encounterId = await seed();
      const first = await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));

      const secondDecision = decision(encounterId, {
        diagnoses: [
          { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
          { code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "secondary", presentOnAdmission: true },
        ],
      });
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, secondDecision);

      const entries = await appPrisma.auditEntry.findMany({
        where: { codingDecisionId: first.id },
        orderBy: { createdAt: "asc" },
      });

      expect(entries).toHaveLength(2);
      const [createEntry, updateEntry] = entries;
      expect(createEntry).toMatchObject({ action: "CREATE_DRAFT", userId: TEST_USER_ID });
      expect(createEntry!.before).toBeNull();
      expect(updateEntry).toMatchObject({ action: "UPDATE_DRAFT", userId: TEST_USER_ID });
      expect((updateEntry!.before as { diagnoses: unknown[] }).diagnoses).toHaveLength(1);
      expect((updateEntry!.after as { diagnoses: unknown[] }).diagnoses).toHaveLength(2);
    });
  });

  describe("finalize", () => {
    it("rejects finalizing an encounter with no saved coding decision", async () => {
      const encounterId = await seed();

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects finalizing an encounter that is already finalized", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      await service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID);

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects finalizing an encounter currently sitting in QA_REVIEW (regression: real bug found writing this suite)", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      await service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID);

      // finalize()'s own QA sampling is random (SAMPLING_RATE) — set the
      // status directly so this test is deterministic rather than relying
      // on chance, unlike the direct experiment that first surfaced this
      // bug: 10 of 20 randomly-sampled encounters allowed a silent second
      // finalize() while sitting in QA_REVIEW, before this check existed.
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "QA_REVIEW" } });

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("sets encounter status to FINALIZED (or QA_REVIEW, if randomly sampled) and writes a FINALIZE audit entry", async () => {
      const encounterId = await seed();
      const saved = await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      await service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID);

      // finalize() itself always sets FINALIZED — but it then calls
      // QaService.maybeSampleForReview(), which randomly (SAMPLING_RATE)
      // moves the encounter on to QA_REVIEW as a separate step. Both are
      // valid post-finalize outcomes; asserting only "FINALIZED" here made
      // this test genuinely flaky (~50% failure rate), not a real bug.
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(["FINALIZED", "QA_REVIEW"]).toContain(encounter.status);

      const finalizeEntry = await appPrisma.auditEntry.findFirst({
        where: { codingDecisionId: saved.id, action: "FINALIZE" },
      });
      expect(finalizeEntry).not.toBeNull();
      expect(finalizeEntry!.userId).toBe(TEST_USER_ID);
    });

    it("throws NotFoundException for an encounter that does not exist", async () => {
      await expect(service.finalize(999999999, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it("throws ForbiddenException when the encounter belongs to a different facility", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));

      await expect(
        service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID + 999)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
