import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { GrouperService } from "../grouper/grouper.service.js";
import { QaService } from "../qa/qa.service.js";
import { CodingService } from "./coding.service.js";
import { QueriesService } from "../queries/queries.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

const TEST_USER_ID = 1;
const PROVIDER_ID = 2;
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
  const queriesService = new QueriesService(appPrisma);

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

  describe("saveDraft — locked-encounter guard (regression: found investigating the QA lifecycle)", () => {
    it("rejects saveDraft() on an encounter that is FINALIZED", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      await service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID);
      // finalize() may itself randomly sample into QA_REVIEW — force back
      // to FINALIZED so this test isolates that specific status, not both.
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });

      await expect(
        service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId))
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects saveDraft() on an encounter that is in QA_REVIEW — without this, an auditor's pending review could reference coding data that was silently replaced out from under them", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      await service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID);
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "QA_REVIEW" } });

      const changedDecision = decision(encounterId, {
        diagnoses: [{ code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      });
      await expect(
        service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, changedDecision)
      ).rejects.toBeInstanceOf(BadRequestException);

      // The real-world consequence this prevents: saveDraft() unconditionally
      // sets encounter.status = IN_PROGRESS, which would silently bypass the
      // pending QaReview entirely, not just overwrite the coding.
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QA_REVIEW");
      const stillOriginal = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
      expect(stillOriginal.diagnoses).toEqual([
        { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
      ]);
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

  /**
   * Business-rule decision, not a bug fix: "an encounter cannot be
   * finalized while any query on it is open" (DRAFT/SENT/RESPONDED).
   * Deliberately checks the real Query rows, not the encounter's derived
   * QUERY_PENDING status — see the comment on the guard itself for why.
   * RESPONDED counts as open on purpose: a provider's answer can change
   * the coding decision, and the coder hasn't resolved/reviewed it yet.
   */
  describe("finalize — business rule: no open queries", () => {
    async function seedWithSavedDraft(): Promise<number> {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      return encounterId;
    }

    it("rejects finalize when a query is still DRAFT", async () => {
      const encounterId = await seedWithSavedDraft();
      await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Clarify pneumonia etiology?");

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects finalize when a query is SENT (unanswered)", async () => {
      const encounterId = await seedWithSavedDraft();
      const query = await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Clarify?");
      await queriesService.send(query.id, TEST_FACILITY_ID);

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects finalize when a query is RESPONDED but not yet resolved by the coder", async () => {
      const encounterId = await seedWithSavedDraft();
      const query = await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Clarify?");
      await queriesService.send(query.id, TEST_FACILITY_ID);
      await queriesService.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "It's aspiration pneumonia.");

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("allows finalize once the query has been resolved", async () => {
      const encounterId = await seedWithSavedDraft();
      const query = await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Clarify?");
      await queriesService.send(query.id, TEST_FACILITY_ID);
      await queriesService.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "It's aspiration pneumonia.");
      await queriesService.resolve(query.id, TEST_USER_ID, TEST_FACILITY_ID);

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).resolves.toBeDefined();
    });

    it("rejects finalize when one of several queries is still open, even if the others are resolved", async () => {
      const encounterId = await seedWithSavedDraft();
      const resolvedQuery = await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Question A?");
      await queriesService.send(resolvedQuery.id, TEST_FACILITY_ID);
      await queriesService.respond(resolvedQuery.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer A.");
      await queriesService.resolve(resolvedQuery.id, TEST_USER_ID, TEST_FACILITY_ID);

      await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Question B?");
      // left as DRAFT — still open

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("allows finalize once every query on the encounter is resolved", async () => {
      const encounterId = await seedWithSavedDraft();
      const queryA = await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Question A?");
      const queryB = await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Question B?");
      await queriesService.send(queryA.id, TEST_FACILITY_ID);
      await queriesService.send(queryB.id, TEST_FACILITY_ID);
      await queriesService.respond(queryA.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer A.");
      await queriesService.respond(queryB.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer B.");
      await queriesService.resolve(queryA.id, TEST_USER_ID, TEST_FACILITY_ID);
      await queriesService.resolve(queryB.id, TEST_USER_ID, TEST_FACILITY_ID);

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).resolves.toBeDefined();
    });

    it("does not mutate encounter or coding-decision state when finalize is rejected for an open query", async () => {
      const encounterId = await seedWithSavedDraft();
      await queriesService.create(encounterId, TEST_USER_ID, TEST_FACILITY_ID, "Clarify?");

      const encounterBefore = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      const codingBefore = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });

      await expect(service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );

      const encounterAfter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      const codingAfter = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
      expect(encounterAfter.status).toBe(encounterBefore.status);
      expect(codingAfter.finalizedAt).toBe(codingBefore.finalizedAt);
      expect(codingAfter.updatedAt).toEqual(codingBefore.updatedAt);
    });
  });
});
