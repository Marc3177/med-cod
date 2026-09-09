import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
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

  // No "automatic principal promotion after removing the principal" logic
  // exists anywhere in CodingService or CodingDecisionSchema — confirmed by
  // reading both end to end, not assumed. saveDraft() re-validates the
  // exactly-one-principal invariant from scratch on every call; there is no
  // repair/promotion step that picks a new principal from the remaining
  // secondaries. The "zero principal diagnoses" test below IS that
  // invariant's enforcement: removing the principal without designating a
  // new one is rejected outright, not silently patched by promoting a
  // secondary. Any promotion behavior is therefore entirely a frontend UX
  // concern (if it exists there at all) — the backend has no state to keep
  // consistent across a promotion because it never partially accepts one.
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

    it("current behavior: does not reject a duplicate procedure code (documented, not asserted as correct — same gap as diagnoses)", async () => {
      const encounterId = await seed();
      const pcs = await referencePrisma.icd10PcsCode.findFirstOrThrow({ where: { fiscalYear: 2026, isBillable: true } });
      const dup = decision(encounterId, {
        procedures: [
          { code: pcs.code, codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION },
          { code: pcs.code, codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION },
        ],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, dup)).resolves.toBeDefined();
    });

    it("rejects a diagnosis submitted with codeSystem ICD-10-PCS (Zod literal mismatch — mixed codeSystem handling)", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        diagnoses: [{ code: "J189", codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a procedure submitted with codeSystem ICD-10-CM (Zod literal mismatch — mixed codeSystem handling)", async () => {
      const encounterId = await seed();
      const pcs = await referencePrisma.icd10PcsCode.findFirstOrThrow({ where: { fiscalYear: 2026, isBillable: true } });
      const bad = decision(encounterId, {
        procedures: [{ code: pcs.code, codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a diagnosis missing presentOnAdmission entirely (POA is required, not defaulted)", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal" }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a diagnosis with a non-boolean presentOnAdmission", async () => {
      const encounterId = await seed();
      const bad = decision(encounterId, {
        diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: "yes" }],
      });

      await expect(service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, bad)).rejects.toBeInstanceOf(
        BadRequestException
      );
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

  describe("finalize — audit entry correctness", () => {
    it("writes a FINALIZE audit entry with before=null and after matching the finalized diagnoses/procedures exactly", async () => {
      const encounterId = await seed();
      const saved = await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      await service.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID);

      const entry = await appPrisma.auditEntry.findFirstOrThrow({
        where: { codingDecisionId: saved.id, action: "FINALIZE" },
      });
      expect(entry.before).toBeNull();
      expect(entry.after).toEqual({
        diagnoses: [
          { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
        ],
        procedures: [],
      });
    });
  });

  /**
   * Answers the question this phase was explicitly scoped around: "can a
   * permitted mutation leave the database in a partially corrupted state if
   * something inside the operation fails?" Rather than assume the existing
   * `$transaction(async (tx) => {...})` wrapping is atomic, this forces a
   * real failure partway through each transaction (via a Prisma `$extends`
   * query interceptor that throws on a specific model call — verified first
   * as a standalone experiment) and asserts nothing partial was written.
   * `auditEntry.create` is the interception point for both: it's the last
   * write before the closing `encounter.update` in each transaction, so a
   * successful rollback here proves the *whole* transaction is atomic, not
   * just the two writes before the interception point.
   */
  describe("saveDraft — transaction atomicity", () => {
    function poisonedService(): CodingService {
      const poisoned = appPrisma.$extends({
        query: {
          auditEntry: {
            async create() {
              throw new Error("SIMULATED_FAILURE");
            },
          },
        },
      });
      return new CodingService(poisoned as unknown as AppPrismaService, referencePrisma, grouper, qa);
    }

    it("leaves no coding decision and no status change when the transaction fails on first save", async () => {
      const encounterId = await seed();

      await expect(
        poisonedService().saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId))
      ).rejects.toThrow("SIMULATED_FAILURE");

      const coding = await appPrisma.codingDecision.findUnique({ where: { encounterId } });
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(coding).toBeNull();
      expect(encounter.status).toBe("NEW");
    });

    it("leaves the existing coding decision and status completely unchanged when the transaction fails on an update", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      const before = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });

      const changed = decision(encounterId, {
        diagnoses: [{ code: "N179", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true }],
      });
      await expect(
        poisonedService().saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, changed)
      ).rejects.toThrow("SIMULATED_FAILURE");

      const after = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(after.diagnoses).toEqual(before.diagnoses);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(encounter.status).toBe("IN_PROGRESS"); // set by the successful first save, not touched by the failed second one
    });
  });

  describe("finalize — transaction atomicity", () => {
    it("leaves finalizedAt/msDrg/status/audit trail completely untouched when the transaction fails", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));
      const codingBefore = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
      const encounterBefore = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });

      const poisoned = appPrisma.$extends({
        query: {
          auditEntry: {
            async create() {
              throw new Error("SIMULATED_FAILURE");
            },
          },
        },
      });
      const poisonedService = new CodingService(poisoned as unknown as AppPrismaService, referencePrisma, grouper, qa);

      await expect(poisonedService.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toThrow(
        "SIMULATED_FAILURE"
      );

      const codingAfter = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
      const encounterAfter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      const auditEntries = await appPrisma.auditEntry.findMany({ where: { codingDecisionId: codingBefore.id } });
      const qaReviews = await appPrisma.qaReview.findMany({ where: { encounterId } });

      expect(codingAfter.finalizedAt).toBe(codingBefore.finalizedAt);
      expect(codingAfter.msDrg).toBe(codingBefore.msDrg);
      expect(codingAfter.updatedAt).toEqual(codingBefore.updatedAt);
      expect(encounterAfter.status).toBe(encounterBefore.status);
      // Only the CREATE_DRAFT entry from the seed save above — no FINALIZE
      // entry, and QA sampling (which only runs after finalize's own
      // transaction commits) never ran at all.
      expect(auditEntries.map((e) => e.action)).toEqual(["CREATE_DRAFT"]);
      expect(qaReviews).toHaveLength(0);
    });
  });

  /**
   * A genuine finding from the atomicity investigation, reported rather than
   * silently fixed (same discipline as the open-query business rule): unlike
   * the two transactions above, `finalize()`'s call to
   * `qaService.maybeSampleForReview()` runs AFTER the main transaction has
   * already committed, and isn't wrapped in try/catch. Direct experiment
   * confirmed: if that call throws (its own internal 2-write
   * `$transaction([...])` still rolls back correctly — no orphaned
   * `QaReview` row is left behind), the exception propagates out of
   * `finalize()` to the caller as a failure, EVEN THOUGH the finalize itself
   * (coding decision's finalizedAt/msDrg, encounter status, and the
   * FINALIZE audit entry) already committed successfully and is not rolled
   * back. The database is never left inconsistent — but the caller receives
   * an error response describing an operation that, in fact, already
   * succeeded. This is a real gap, not a corruption risk: whether finalize()
   * should catch/log a sampling failure instead of surfacing it as the
   * request's own failure is a product decision (does the client need to
   * know sampling didn't run?), not something to silently pick here.
   */
  describe("finalize — QA-sampling boundary (documented finding, not fixed)", () => {
    it("current behavior: a QA-sampling failure after a successful finalize still propagates to the caller as an error", async () => {
      const encounterId = await seed();
      await service.saveDraft(encounterId, TEST_USER_ID, TEST_FACILITY_ID, decision(encounterId));

      const poisonedQaPrisma = appPrisma.$extends({
        query: {
          qaReview: {
            async create() {
              throw new Error("SIMULATED_QA_SAMPLING_FAILURE");
            },
          },
        },
      });
      const poisonedQa = new QaService(poisonedQaPrisma as unknown as AppPrismaService);
      const serviceWithPoisonedQa = new CodingService(appPrisma, referencePrisma, grouper, poisonedQa);

      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // force sampling to hit
      try {
        await expect(serviceWithPoisonedQa.finalize(encounterId, TEST_USER_ID, TEST_FACILITY_ID)).rejects.toThrow(
          "SIMULATED_QA_SAMPLING_FAILURE"
        );
      } finally {
        randomSpy.mockRestore();
      }

      // ...despite the thrown error, the finalize itself genuinely
      // succeeded and is not rolled back:
      const coding = await appPrisma.codingDecision.findUniqueOrThrow({ where: { encounterId } });
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      const qaReviews = await appPrisma.qaReview.findMany({ where: { encounterId } });
      expect(coding.finalizedAt).not.toBeNull();
      expect(encounter.status).toBe("FINALIZED");
      expect(qaReviews).toHaveLength(0); // sampling's own transaction rolled back correctly
    });
  });
});
