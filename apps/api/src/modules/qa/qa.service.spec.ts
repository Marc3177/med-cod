import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { QaService } from "./qa.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

const AUDITOR_ID = 3;

/**
 * Documented current implementation, derived from qa.service.ts,
 * qa.controller.ts, auditor.controller.ts and the QaReview Prisma model —
 * not assumed — before any test was written:
 *
 * Legal states: PENDING -> APPROVED, PENDING -> RETURNED. Nothing else
 * transitions a review once it leaves PENDING (both are terminal).
 *
 * maybeSampleForReview(): called by CodingService.finalize() after a
 * successful finalize. Randomly (SAMPLING_RATE = 0.5) creates a PENDING
 * QaReview and moves the encounter to QA_REVIEW; does nothing the rest of
 * the time. QaService is the only writer of the QaReview table (confirmed
 * by grepping every `prisma.qaReview.` call site in apps/api/src).
 *
 * approve(): PENDING -> APPROVED only; sets encounter.status = FINALIZED
 *   (undoing the QA_REVIEW sampling set), no further checks on reason.
 * returnToCoder(): PENDING -> RETURNED only; REQUIRES a non-empty reason;
 *   sets encounter.status = IN_PROGRESS, enabling the coder to recode and
 *   re-finalize (which can itself be re-sampled — no cap on review cycles).
 *
 * Role authorization (AUDITOR-only) is enforced at the controller layer
 * (RolesGuard + @Roles("AUDITOR")), not inside QaService itself — so it is
 * out of scope for these service-level tests, same as PROVIDER-only
 * authorization is out of scope for QueriesService.respond().
 */
describe("QaService", () => {
  const appPrisma = new AppPrismaService();
  const service = new QaService(appPrisma);

  const encounterIds: number[] = [];

  async function seed(): Promise<number> {
    const id = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(id);
    return id;
  }

  /** A PENDING QaReview on an encounter already in QA_REVIEW, set up
   *  directly rather than through finalize()'s random sampler — the same
   *  determinism discipline used in queries.service.spec.ts's
   *  forceIntoQaReview(), for the same reason: asserting behavior that
   *  depends on chance is how a previous suite in this project produced a
   *  genuinely flaky test. */
  async function seedPendingReview(encounterId: number) {
    await appPrisma.codingDecision.create({
      data: {
        encounterId,
        diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: "2026", role: "principal", presentOnAdmission: true }],
        procedures: [],
        finalizedAt: new Date(),
        finalizedById: 1,
      },
    });
    await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "QA_REVIEW" } });
    return appPrisma.qaReview.create({ data: { encounterId } });
  }

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await appPrisma.qaReview.deleteMany({ where: { encounterId: id } });
      await deleteTestEncounter(appPrisma, id);
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
  });

  describe("maybeSampleForReview — tested deterministically, not by chance", () => {
    it("creates a PENDING QaReview and moves the encounter to QA_REVIEW when the sample hits", async () => {
      const encounterId = await seed();
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // < SAMPLING_RATE (0.5): always samples

      await service.maybeSampleForReview(encounterId);

      const reviews = await appPrisma.qaReview.findMany({ where: { encounterId } });
      expect(reviews).toHaveLength(1);
      expect(reviews[0]!.status).toBe("PENDING");
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QA_REVIEW");

      randomSpy.mockRestore();
    });

    it("does nothing when the sample misses", async () => {
      const encounterId = await seed();
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999); // >= SAMPLING_RATE: never samples

      await service.maybeSampleForReview(encounterId);

      const reviews = await appPrisma.qaReview.findMany({ where: { encounterId } });
      expect(reviews).toHaveLength(0);
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("FINALIZED");

      randomSpy.mockRestore();
    });
  });

  describe("legal lifecycle: PENDING -> APPROVED / PENDING -> RETURNED", () => {
    it("approve() moves PENDING -> APPROVED, persists reviewedById/reviewedAt, and restores the encounter to FINALIZED", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      const approved = await service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID);
      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewedById).toBe(AUDITOR_ID);
      expect(approved.reviewedAt).not.toBeNull();

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("FINALIZED");
    });

    it("returnToCoder() moves PENDING -> RETURNED, persists the reason and reviewedById/reviewedAt, and moves the encounter to IN_PROGRESS", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      const returned = await service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Principal diagnosis needs more specificity.");
      expect(returned.status).toBe("RETURNED");
      expect(returned.reason).toBe("Principal diagnosis needs more specificity.");
      expect(returned.reviewedById).toBe(AUDITOR_ID);
      expect(returned.reviewedAt).not.toBeNull();

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("IN_PROGRESS");
    });
  });

  describe("illegal transitions are rejected", () => {
    it("rejects approve() on a review that has already been APPROVED (double approval)", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);
      await service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID);

      await expect(service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects returnToCoder() on a review that has already been RETURNED (double return)", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);
      await service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "First reason.");

      await expect(
        service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Second reason.")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects approve() on a review that has already been RETURNED", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);
      await service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Needs work.");

      await expect(service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects returnToCoder() on a review that has already been APPROVED", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);
      await service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID);

      await expect(
        service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Reason.")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects returnToCoder() with an empty reason", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      await expect(service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "   ")).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });

  describe("facility isolation", () => {
    async function seedOtherFacilityPendingReview() {
      const facility = await appPrisma.facility.create({ data: { name: `Test Facility ${Date.now()}-${Math.random()}` } });
      const patient = await appPrisma.patient.create({
        data: { mrn: `MRN-TEST-${Date.now()}-${Math.random()}`, dateOfBirth: new Date("1990-01-01"), sex: "F" },
      });
      const encounter = await appPrisma.encounter.create({
        data: { patientId: patient.id, facilityId: facility.id, admissionDate: new Date("2026-01-01"), status: "QA_REVIEW" },
      });
      await appPrisma.codingDecision.create({
        data: {
          encounterId: encounter.id,
          diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: "2026", role: "principal", presentOnAdmission: true }],
          procedures: [],
          finalizedAt: new Date(),
          finalizedById: 1,
        },
      });
      const review = await appPrisma.qaReview.create({ data: { encounterId: encounter.id } });
      return { review, encounterId: encounter.id, facilityId: facility.id };
    }

    async function cleanupOtherFacility(encounterId: number, facilityId: number) {
      const encounter = await appPrisma.encounter.findUnique({ where: { id: encounterId } });
      await appPrisma.qaReview.deleteMany({ where: { encounterId } });
      await appPrisma.auditEntry.deleteMany({ where: { codingDecision: { encounterId } } });
      await appPrisma.codingDecision.deleteMany({ where: { encounterId } });
      await appPrisma.encounter.deleteMany({ where: { id: encounterId } });
      if (encounter) await appPrisma.patient.deleteMany({ where: { id: encounter.patientId } });
      await appPrisma.facility.deleteMany({ where: { id: facilityId } });
    }

    it("rejects approve()/returnToCoder()/listForEncounter() for a review belonging to a different facility", async () => {
      const { review, encounterId, facilityId } = await seedOtherFacilityPendingReview();

      await expect(service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(
        service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Reason.")
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.listForEncounter(encounterId, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );

      await cleanupOtherFacility(encounterId, facilityId);
    });

    it("listPendingForAuditor() only returns PENDING reviews at the caller's own facility", async () => {
      const { review: otherReview, encounterId: otherEncounterId, facilityId: otherFacilityId } =
        await seedOtherFacilityPendingReview();
      const ownEncounterId = await seed();
      const ownReview = await seedPendingReview(ownEncounterId);

      const pending = service.listPendingForAuditor(TEST_FACILITY_ID);
      const ids = (await pending).map((r) => r.id);
      expect(ids).toContain(ownReview.id);
      expect(ids).not.toContain(otherReview.id);

      await cleanupOtherFacility(otherEncounterId, otherFacilityId);
    });
  });

  describe("not-found handling", () => {
    it("throws NotFoundException for an encounter that does not exist", async () => {
      await expect(service.listForEncounter(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException for a review that does not exist", async () => {
      await expect(service.approve(999999999, AUDITOR_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
      await expect(
        service.returnToCoder(999999999, AUDITOR_ID, TEST_FACILITY_ID, "Reason.")
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("cross-module lifecycle: return -> recode -> re-finalize -> re-sample", () => {
    it("preserves the original RETURNED review's history when the encounter is recoded and finalized again", async () => {
      const encounterId = await seed();
      const firstReview = await seedPendingReview(encounterId);
      await service.returnToCoder(firstReview.id, AUDITOR_ID, TEST_FACILITY_ID, "Recode with more specificity.");

      // Simulate the coder recoding (encounter is IN_PROGRESS after return)
      // and finalizing again, deterministically sampling a second time.
      await appPrisma.codingDecision.update({
        where: { encounterId },
        data: {
          diagnoses: [{ code: "N179", codeSystem: "ICD-10-CM", codeVersion: "2026", role: "principal", presentOnAdmission: true }],
        },
      });
      const encounterBeforeRefinalize = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounterBeforeRefinalize.status).toBe("IN_PROGRESS");

      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });
      await service.maybeSampleForReview(encounterId);
      randomSpy.mockRestore();

      const allReviews = await appPrisma.qaReview.findMany({ where: { encounterId }, orderBy: { createdAt: "asc" } });
      expect(allReviews).toHaveLength(2);
      expect(allReviews[0]).toMatchObject({ status: "RETURNED", reason: "Recode with more specificity." });
      expect(allReviews[1]).toMatchObject({ status: "PENDING" });

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QA_REVIEW");
    });
  });

  /**
   * Full workflow adversarial matrix, Phase 4 (TOCTOU races) — see
   * docs/TEST_REPORT.md's "P0 Workflow Contract Matrix". Same class and
   * same fix as the finalize()/finalize() race in coding.service.ts: the
   * PENDING check reads in a separate query before the transaction starts,
   * so two genuinely concurrent calls could both pass it. A violation of
   * the already-established sequential invariant ("rejects approve()/
   * returnToCoder() on a review that is already APPROVED/RETURNED", tested
   * above), so a BUG under that invariant. Fixed with a conditional
   * `updateMany` as each transaction's first write.
   */
  describe("approve/returnToCoder — concurrent-request race (TOCTOU)", () => {
    it("exactly one of two truly concurrent approve() calls on the same review succeeds", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      const results = await Promise.allSettled([
        service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID),
        service.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

      const finalReview = await appPrisma.qaReview.findUniqueOrThrow({ where: { id: review.id } });
      expect(finalReview.status).toBe("APPROVED");
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("FINALIZED");
    });

    it("exactly one of two truly concurrent returnToCoder() calls on the same review succeeds", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      const results = await Promise.allSettled([
        service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Reason A"),
        service.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Reason B"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

      const finalReview = await appPrisma.qaReview.findUniqueOrThrow({ where: { id: review.id } });
      expect(finalReview.status).toBe("RETURNED");
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("IN_PROGRESS");
    });
  });

  /**
   * Full workflow adversarial matrix, Phase 5 (failure injection) — see
   * docs/TEST_REPORT.md's "P0 Workflow Contract Matrix". Same `$extends`
   * technique used throughout this pass, applied to approve()'s and
   * returnToCoder()'s own transactions.
   */
  describe("approve/returnToCoder — transaction atomicity under failure injection", () => {
    it("approve() leaves the review PENDING and the encounter in QA_REVIEW when its transaction fails", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      const poisoned = appPrisma.$extends({
        query: { encounter: { async update() { throw new Error("SIMULATED_FAILURE"); } } },
      });
      const poisonedService = new QaService(poisoned as unknown as AppPrismaService);

      await expect(poisonedService.approve(review.id, AUDITOR_ID, TEST_FACILITY_ID)).rejects.toThrow(
        "SIMULATED_FAILURE"
      );

      const reviewAfter = await appPrisma.qaReview.findUniqueOrThrow({ where: { id: review.id } });
      const encounterAfter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(reviewAfter.status).toBe("PENDING");
      expect(reviewAfter.reviewedAt).toBeNull();
      expect(encounterAfter.status).toBe("QA_REVIEW");
    });

    it("returnToCoder() leaves the review PENDING and the encounter in QA_REVIEW when its transaction fails", async () => {
      const encounterId = await seed();
      const review = await seedPendingReview(encounterId);

      const poisoned = appPrisma.$extends({
        query: { encounter: { async update() { throw new Error("SIMULATED_FAILURE"); } } },
      });
      const poisonedService = new QaService(poisoned as unknown as AppPrismaService);

      await expect(
        poisonedService.returnToCoder(review.id, AUDITOR_ID, TEST_FACILITY_ID, "Reason")
      ).rejects.toThrow("SIMULATED_FAILURE");

      const reviewAfter = await appPrisma.qaReview.findUniqueOrThrow({ where: { id: review.id } });
      const encounterAfter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(reviewAfter.status).toBe("PENDING");
      expect(reviewAfter.reason).toBeNull();
      expect(encounterAfter.status).toBe("QA_REVIEW");
    });
  });
});
