import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { QueriesService } from "./queries.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

const CODER_ID = 1;
const PROVIDER_ID = 2;

/**
 * Documented current implementation, derived from queries.service.ts,
 * queries.controller.ts, provider-queries.controller.ts and the Query
 * Prisma model — not assumed — before any test was written (see
 * docs/TEST_REPORT.md's stabilization pass):
 *
 * Legal states: DRAFT -> SENT -> RESPONDED -> RESOLVED. EXPIRED exists in
 * the schema but nothing transitions a query there (no expiry job) — see
 * the schema comment on QueryStatus.
 *
 * QueriesService is the ONLY writer of the Query table (confirmed by
 * grepping every `prisma.query.` call site in apps/api/src) — chart-changes,
 * decision-explanation, and reporting only ever read it.
 *
 * create(): always produces DRAFT. Does not check encounter.status.
 * send(): DRAFT -> SENT only; also sets encounter.status = QUERY_PENDING
 *   unconditionally, with NO check on the encounter's current status.
 * respond(): SENT -> RESPONDED only; provider-only at the controller layer
 *   (RolesGuard), not enforced in the service itself.
 * resolve(): RESPONDED -> RESOLVED only; sets encounter.status = IN_PROGRESS
 *   ONLY if no other query on the same encounter is still DRAFT/SENT/RESPONDED.
 *
 * Facility isolation: create/send/respond/resolve/listForEncounter all
 * check facility via the encounter (create, listForEncounter) or via the
 * query's own encounter relation (send, respond, resolve).
 */
describe("QueriesService", () => {
  const appPrisma = new AppPrismaService();
  const service = new QueriesService(appPrisma);

  const encounterIds: number[] = [];
  // Tracked as {facilityId, patientId} pairs, not just facilityId — a real
  // bug in an earlier version of this cleanup re-queried "which patients
  // belong to this facility's encounters" AFTER the encounter had already
  // been deleted by the encounterIds loop below (since
  // seedOtherFacilityEncounter also pushes into encounterIds), so the
  // lookup found nothing and the Patient row leaked on every run. Capturing
  // patientId directly at seed time removes the ordering dependency.
  const otherFacilities: { facilityId: number; patientId: number }[] = [];

  async function seed(): Promise<number> {
    const id = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(id);
    return id;
  }

  /** A genuinely separate facility + encounter, for isolation tests —
   *  created fresh per test rather than relying on scripts/seed-second-
   *  facility.ts having been run, so this suite has no external setup
   *  dependency. */
  async function seedOtherFacilityEncounter(): Promise<{ encounterId: number; facilityId: number }> {
    const facility = await appPrisma.facility.create({ data: { name: `Test Facility ${Date.now()}-${Math.random()}` } });
    const patient = await appPrisma.patient.create({
      data: { mrn: `MRN-TEST-${Date.now()}-${Math.random()}`, dateOfBirth: new Date("1990-01-01"), sex: "F" },
    });
    const encounter = await appPrisma.encounter.create({
      data: { patientId: patient.id, facilityId: facility.id, admissionDate: new Date("2026-01-01"), status: "NEW" },
    });
    encounterIds.push(encounter.id);
    otherFacilities.push({ facilityId: facility.id, patientId: patient.id });
    return { encounterId: encounter.id, facilityId: facility.id };
  }

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await appPrisma.query.deleteMany({ where: { encounterId: id } });
      await deleteTestEncounter(appPrisma, id);
    }
    while (otherFacilities.length > 0) {
      const { facilityId: id, patientId } = otherFacilities.pop()!;
      await appPrisma.encounter.deleteMany({ where: { facilityId: id } });
      await appPrisma.patient.deleteMany({ where: { id: patientId } });
      await appPrisma.facility.deleteMany({ where: { id } });
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
  });

  describe("legal lifecycle: DRAFT -> SENT -> RESPONDED -> RESOLVED", () => {
    it("create() produces a DRAFT query and does not touch encounter status", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Is this pneumonia aspiration?");

      expect(query.status).toBe("DRAFT");
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("NEW");
    });

    it("send() moves DRAFT -> SENT and sets sentAt, and moves the encounter to QUERY_PENDING", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Is this pneumonia aspiration?");

      const sent = await service.send(query.id, TEST_FACILITY_ID);
      expect(sent.status).toBe("SENT");
      expect(sent.sentAt).not.toBeNull();

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QUERY_PENDING");
    });

    it("respond() moves SENT -> RESPONDED and persists the response, respondedById, respondedAt", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Is this pneumonia aspiration?");
      await service.send(query.id, TEST_FACILITY_ID);

      const responded = await service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Yes, aspiration pneumonia.");
      expect(responded.status).toBe("RESPONDED");
      expect(responded.response).toBe("Yes, aspiration pneumonia.");
      expect(responded.respondedById).toBe(PROVIDER_ID);
      expect(responded.respondedAt).not.toBeNull();
    });

    it("resolve() moves RESPONDED -> RESOLVED, persists resolvedById/resolvedAt, and returns the encounter to IN_PROGRESS when no other query is open", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Is this pneumonia aspiration?");
      await service.send(query.id, TEST_FACILITY_ID);
      await service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Yes.");

      const resolved = await service.resolve(query.id, CODER_ID, TEST_FACILITY_ID);
      expect(resolved.status).toBe("RESOLVED");
      expect(resolved.resolvedById).toBe(CODER_ID);
      expect(resolved.resolvedAt).not.toBeNull();

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("IN_PROGRESS");
    });
  });

  describe("illegal transitions are rejected", () => {
    it("rejects send() on a query that is not DRAFT (e.g. already SENT)", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);

      await expect(service.send(query.id, TEST_FACILITY_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects respond() on a query that is not SENT (e.g. still DRAFT)", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");

      await expect(
        service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "An answer.")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects respond() on a query that has already been RESPONDED to", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);
      await service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "First answer.");

      await expect(
        service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Second answer.")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects resolve() on a query that is not RESPONDED (e.g. still SENT)", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);

      await expect(service.resolve(query.id, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects resolve() on a query that has already been RESOLVED", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);
      await service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer.");
      await service.resolve(query.id, CODER_ID, TEST_FACILITY_ID);

      await expect(service.resolve(query.id, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a DRAFT query with an empty question", async () => {
      const encounterId = await seed();

      await expect(service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "   ")).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects an empty response", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);

      await expect(service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "   ")).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });

  describe("multiple queries on one encounter", () => {
    it("resolving one query does not clear QUERY_PENDING while a second query is still open", async () => {
      const encounterId = await seed();
      const queryA = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question A?");
      const queryB = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question B?");
      await service.send(queryA.id, TEST_FACILITY_ID);
      await service.send(queryB.id, TEST_FACILITY_ID);
      await service.respond(queryA.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer A.");

      await service.resolve(queryA.id, CODER_ID, TEST_FACILITY_ID);

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QUERY_PENDING");
    });

    it("resolving the last open query returns the encounter to IN_PROGRESS", async () => {
      const encounterId = await seed();
      const queryA = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question A?");
      const queryB = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question B?");
      await service.send(queryA.id, TEST_FACILITY_ID);
      await service.send(queryB.id, TEST_FACILITY_ID);
      await service.respond(queryA.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer A.");
      await service.respond(queryB.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer B.");
      await service.resolve(queryA.id, CODER_ID, TEST_FACILITY_ID);

      await service.resolve(queryB.id, CODER_ID, TEST_FACILITY_ID);

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("IN_PROGRESS");
    });
  });

  describe("facility isolation", () => {
    it("rejects create() for an encounter in a different facility", async () => {
      const { encounterId } = await seedOtherFacilityEncounter();

      await expect(
        service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?")
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects listForEncounter() for an encounter in a different facility", async () => {
      const { encounterId } = await seedOtherFacilityEncounter();

      await expect(service.listForEncounter(encounterId, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("rejects send()/respond()/resolve() for a query belonging to a different facility", async () => {
      const { encounterId, facilityId: otherFacilityId } = await seedOtherFacilityEncounter();
      const query = await service.create(encounterId, CODER_ID, otherFacilityId, "Question?");

      await expect(service.send(query.id, TEST_FACILITY_ID)).rejects.toBeInstanceOf(ForbiddenException);

      // Send it for real (as the owning facility) to reach SENT, then
      // confirm the OTHER facility still can't respond to or resolve it.
      await service.send(query.id, otherFacilityId);
      await expect(
        service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "Answer.")
      ).rejects.toBeInstanceOf(ForbiddenException);

      await service.respond(query.id, PROVIDER_ID, otherFacilityId, "Answer.");
      await expect(service.resolve(query.id, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("listPendingForProvider() only returns SENT queries at the caller's own facility", async () => {
      const { encounterId: otherEncounterId, facilityId: otherFacilityId } = await seedOtherFacilityEncounter();
      const ownEncounterId = await seed();

      const ownQuery = await service.create(ownEncounterId, CODER_ID, TEST_FACILITY_ID, "Own facility question?");
      await service.send(ownQuery.id, TEST_FACILITY_ID);
      const otherQuery = await service.create(otherEncounterId, CODER_ID, otherFacilityId, "Other facility question?");
      await service.send(otherQuery.id, otherFacilityId);

      const pending = await service.listPendingForProvider(TEST_FACILITY_ID);
      const ids = pending.map((q) => q.id);
      expect(ids).toContain(ownQuery.id);
      expect(ids).not.toContain(otherQuery.id);
    });
  });

  describe("not-found handling", () => {
    it("throws NotFoundException for an encounter that does not exist (create, listForEncounter)", async () => {
      await expect(service.create(999999999, CODER_ID, TEST_FACILITY_ID, "Question?")).rejects.toBeInstanceOf(
        NotFoundException
      );
      await expect(service.listForEncounter(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException for a query that does not exist (send, respond, resolve)", async () => {
      await expect(service.send(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.respond(999999999, PROVIDER_ID, TEST_FACILITY_ID, "Answer.")
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.resolve(999999999, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("relatedCode linkage persistence", () => {
    it("persists relatedCode/relatedCodeSystem when both are provided, and omits them when not", async () => {
      const encounterId = await seed();
      const linked = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Q?", undefined, "J189", "ICD-10-CM");
      expect(linked.relatedCode).toBe("J189");
      expect(linked.relatedCodeSystem).toBe("ICD-10-CM");

      const unlinked = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Q2?");
      expect(unlinked.relatedCode).toBeNull();
      expect(unlinked.relatedCodeSystem).toBeNull();
    });
  });

  describe("interaction with a locked encounter (FINALIZED / QA_REVIEW)", () => {
    /** Finalizes the encounter and forces it into QA_REVIEW deterministically
     *  (bypassing QaService's random sampling — see CodingService's own P0
     *  suite for why asserting a specific post-finalize status at random is
     *  a flaky-test trap) so this test doesn't depend on chance. */
    async function forceIntoQaReview(encounterId: number) {
      await appPrisma.codingDecision.create({
        data: {
          encounterId,
          diagnoses: [{ code: "J189", codeSystem: "ICD-10-CM", codeVersion: "2026", role: "principal", presentOnAdmission: true }],
          procedures: [],
          finalizedAt: new Date(),
          finalizedById: CODER_ID,
        },
      });
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "QA_REVIEW" } });
    }

    it("rejects create() on an encounter that is FINALIZED (regression: real bug found writing this suite)", async () => {
      const encounterId = await seed();
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });

      await expect(
        service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Late question?")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects create() on an encounter that is in QA_REVIEW (regression: real bug found writing this suite)", async () => {
      const encounterId = await seed();
      await forceIntoQaReview(encounterId);

      await expect(
        service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Late question?")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects send() for a DRAFT query whose encounter has since moved to QA_REVIEW (regression)", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question drafted before finalize");
      await forceIntoQaReview(encounterId);

      await expect(service.send(query.id, TEST_FACILITY_ID)).rejects.toBeInstanceOf(BadRequestException);

      // The real-world consequence this prevents: send() unconditionally
      // set encounter.status = QUERY_PENDING, which would make a QA_REVIEW
      // encounter reappear in the coder's work queue (which excludes
      // QA_REVIEW) while an auditor's PENDING QaReview for it still exists
      // — the same chart visible in two different queues at once.
      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QA_REVIEW");
    });

    /**
     * Under normal sequential use, a SENT/RESPONDED query can never coexist
     * with a FINALIZED/QA_REVIEW encounter — finalize()'s own business rule
     * (see coding.service.ts) refuses to finalize while any query is still
     * open. But that's a TOCTOU race, not a hard guarantee: create() and
     * send() both only check the encounter's status at the moment they run,
     * so both can pass while the encounter is still IN_PROGRESS, and then
     * finalize()'s transaction can commit around them — leaving exactly
     * this state. Constructed directly here (not via the race itself, which
     * isn't practical to reproduce in a sequential test) because the
     * resulting STATE is what respond()/resolve() need to defend against,
     * however it's reached. Direct experiment before this guard existed
     * confirmed both respond() and resolve() succeeded unconditionally here
     * — resolve() went on to silently overwrite QA_REVIEW back to
     * IN_PROGRESS, discarding the auditor's active review.
     */
    async function seedSentQueryOnQaReviewEncounter(): Promise<{ encounterId: number; queryId: number }> {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);
      await forceIntoQaReview(encounterId);
      return { encounterId, queryId: query.id };
    }

    it("rejects respond() for a SENT query whose encounter is in QA_REVIEW (fourth instance of the lock-bypass bug class)", async () => {
      const { encounterId, queryId } = await seedSentQueryOnQaReviewEncounter();

      await expect(
        service.respond(queryId, PROVIDER_ID, TEST_FACILITY_ID, "An answer.")
      ).rejects.toBeInstanceOf(BadRequestException);

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QA_REVIEW");
      const query = await appPrisma.query.findUniqueOrThrow({ where: { id: queryId } });
      expect(query.status).toBe("SENT");
    });

    it("rejects resolve() for a RESPONDED query whose encounter is in QA_REVIEW — without this, resolving would silently end the auditor's active review", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);
      // respond() while the encounter is still legitimately IN_PROGRESS —
      // isolates this test to resolve()'s own guard, not respond()'s.
      await service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "An answer.");
      await forceIntoQaReview(encounterId);

      await expect(service.resolve(query.id, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );

      const encounter = await appPrisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
      expect(encounter.status).toBe("QA_REVIEW");
      const queryAfter = await appPrisma.query.findUniqueOrThrow({ where: { id: query.id } });
      expect(queryAfter.status).toBe("RESPONDED");
    });

    it("rejects respond() for a SENT query whose encounter is FINALIZED", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });

      await expect(
        service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "An answer.")
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects resolve() for a RESPONDED query whose encounter is FINALIZED", async () => {
      const encounterId = await seed();
      const query = await service.create(encounterId, CODER_ID, TEST_FACILITY_ID, "Question?");
      await service.send(query.id, TEST_FACILITY_ID);
      await service.respond(query.id, PROVIDER_ID, TEST_FACILITY_ID, "An answer.");
      await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });

      await expect(service.resolve(query.id, CODER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });
});
