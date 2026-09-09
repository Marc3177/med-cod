import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ChartChangesService } from "./chart-changes.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

const VIEWING_USER_ID = 1;
const OTHER_USER_ID = 2;

/**
 * Regression coverage for the real race condition found and fixed here
 * (see docs/TEST_REPORT.md, "Change detection... real bug caught during
 * testing"): an earlier version read the prior viewedAt AND advanced it to
 * now in the same call, so two concurrent getChanges() calls for the same
 * user (React StrictMode's double effect invocation, two tabs, a retried
 * request) could race — the second call would see the first call's
 * freshly-advanced timestamp and silently report no changes, even though
 * neither had actually reached the user. getChanges() is now a pure read;
 * acknowledgeView() is the only thing that advances the timestamp. The
 * core test below (calling getChanges twice in a row and expecting
 * identical results) is exactly the scenario that used to be flaky.
 */
describe("ChartChangesService", () => {
  const appPrisma = new AppPrismaService();
  const service = new ChartChangesService(appPrisma);

  const encounterIds: number[] = [];

  async function seed(): Promise<number> {
    const id = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Initial documentation." },
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
  });

  it("reports isFirstView with no changes on a first-ever view, and does not advance the timestamp itself", async () => {
    const encounterId = await seed();

    const first = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);
    expect(first).toEqual({ isFirstView: true, changes: [] });

    // getChanges alone must never create an EncounterView row — only
    // acknowledgeView does. Calling it again should still be "first view".
    const second = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);
    expect(second).toEqual({ isFirstView: true, changes: [] });
  });

  it("getChanges is a pure read — calling it twice in a row returns identical results (the race-condition regression)", async () => {
    const encounterId = await seed();
    await service.acknowledgeView(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    await appPrisma.clinicalDocument.create({
      data: { encounterId, type: "PROGRESS_NOTE", content: "A new note." },
    });

    const call1 = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);
    const call2 = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    expect(call1.changes.length).toBe(1);
    expect(call2).toEqual(call1);
  });

  it("acknowledgeView advances the timestamp so a subsequent getChanges reports the change as seen", async () => {
    const encounterId = await seed();
    await service.acknowledgeView(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    await appPrisma.clinicalDocument.create({
      data: { encounterId, type: "PROGRESS_NOTE", content: "A new note." },
    });

    const before = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);
    expect(before.changes).toHaveLength(1);

    await service.acknowledgeView(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    const after = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);
    expect(after.changes).toHaveLength(0);
  });

  it("reports a coding edit made by a different user, but not the viewing user's own edit", async () => {
    const encounterId = await seed();
    await service.acknowledgeView(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    const codingDecision = await appPrisma.codingDecision.create({
      data: { encounterId, diagnoses: [], procedures: [] },
    });
    await appPrisma.auditEntry.create({
      data: { codingDecisionId: codingDecision.id, userId: OTHER_USER_ID, action: "UPDATE_DRAFT", after: {} },
    });
    await appPrisma.auditEntry.create({
      data: { codingDecisionId: codingDecision.id, userId: VIEWING_USER_ID, action: "UPDATE_DRAFT", after: {} },
    });

    const result = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);
    const codingChanges = result.changes.filter((c) => c.type === "CODING_UPDATED");

    expect(codingChanges).toHaveLength(1);
    expect(codingChanges[0]).toMatchObject({ byUserId: OTHER_USER_ID });
  });

  it("reports a responded query and a QA return", async () => {
    const encounterId = await seed();
    await service.acknowledgeView(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    await appPrisma.query.create({
      data: {
        encounterId,
        createdById: VIEWING_USER_ID,
        question: "Test question?",
        status: "RESPONDED",
        sentAt: new Date(),
        response: "Test response.",
        respondedAt: new Date(),
        respondedById: OTHER_USER_ID,
      },
    });
    await appPrisma.qaReview.create({
      data: { encounterId, status: "RETURNED", reason: "Needs more specificity.", reviewedById: OTHER_USER_ID, reviewedAt: new Date() },
    });

    const result = await service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID);

    expect(result.changes.some((c) => c.type === "QUERY_RESPONDED")).toBe(true);
    expect(result.changes.some((c) => c.type === "QA_RETURNED")).toBe(true);
  });

  it("throws NotFoundException for an encounter that does not exist", async () => {
    await expect(service.getChanges(999999999, VIEWING_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.acknowledgeView(999999999, VIEWING_USER_ID, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("throws ForbiddenException when the encounter belongs to a different facility", async () => {
    const encounterId = await seed();

    await expect(
      service.getChanges(encounterId, VIEWING_USER_ID, TEST_FACILITY_ID + 999)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
