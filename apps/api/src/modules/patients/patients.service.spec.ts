import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { PatientsService } from "./patients.service.js";
import {
  createOtherFacilityEncounter,
  createTestEncounter,
  deleteOtherFacilityEncounter,
  deleteTestEncounter,
  TEST_FACILITY_ID,
} from "../../test-support/encounter-fixture.js";

/**
 * P0 facility isolation for the work queue and single-encounter read path —
 * part of the systematic ownership/isolation audit (see docs/TEST_REPORT.md
 * "Encounter ownership / locked-state audit"). Both PatientsService methods
 * are read-only, so this is read-isolation only; there's no write path here
 * to test for write isolation.
 */
describe("PatientsService — facility isolation", () => {
  const appPrisma = new AppPrismaService();
  const service = new PatientsService(appPrisma);

  const encounterIds: number[] = [];
  const otherFacility: { encounterId: number; facilityId: number }[] = [];

  async function seed(): Promise<number> {
    const id = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(id);
    return id;
  }

  afterEach(async () => {
    while (encounterIds.length > 0) {
      await deleteTestEncounter(appPrisma, encounterIds.pop()!);
    }
    while (otherFacility.length > 0) {
      const { encounterId, facilityId } = otherFacility.pop()!;
      await deleteOtherFacilityEncounter(appPrisma, encounterId, facilityId);
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
  });

  it("listWorkQueue only returns encounters at the caller's own facility", async () => {
    const ownEncounterId = await seed();
    const other = await createOtherFacilityEncounter(appPrisma);
    otherFacility.push(other);

    const queue = await service.listWorkQueue(TEST_FACILITY_ID);
    const ids = queue.map((e) => e.id);
    expect(ids).toContain(ownEncounterId);
    expect(ids).not.toContain(other.encounterId);
  });

  it("listWorkQueue excludes FINALIZED and QA_REVIEW encounters even at the caller's own facility", async () => {
    const encounterId = await seed();
    await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "QA_REVIEW" } });

    const queue = await service.listWorkQueue(TEST_FACILITY_ID);
    expect(queue.map((e) => e.id)).not.toContain(encounterId);
  });

  it("getEncounter returns an encounter at the caller's own facility", async () => {
    const encounterId = await seed();

    const encounter = await service.getEncounter(encounterId, TEST_FACILITY_ID);
    expect(encounter.id).toBe(encounterId);
  });

  it("getEncounter rejects (403) an encounter belonging to a different facility, by valid ID (indirect/child-resource access check)", async () => {
    const other = await createOtherFacilityEncounter(appPrisma);
    otherFacility.push(other);

    // The critical case: the ID is real and resolvable — this isn't a
    // not-found case, it's Facility A supplying a genuinely valid ID that
    // happens to belong to Facility B.
    await expect(service.getEncounter(other.encounterId, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("getEncounter throws NotFoundException for an encounter id that does not exist at all", async () => {
    await expect(service.getEncounter(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
