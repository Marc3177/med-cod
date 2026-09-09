import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ClaimsService } from "./claims.service.js";
import {
  createOtherFacilityEncounter,
  createTestEncounter,
  deleteOtherFacilityEncounter,
  deleteTestEncounter,
  TEST_FACILITY_ID,
} from "../../test-support/encounter-fixture.js";

const CODE_VERSION = "2026";

/**
 * P0 facility isolation + the FINALIZED-only export rule, part of the
 * systematic ownership/isolation audit (see docs/TEST_REPORT.md "Encounter
 * ownership / locked-state audit"). ClaimsService never writes to the
 * database — read isolation only.
 */
describe("ClaimsService — facility isolation and export rules", () => {
  const appPrisma = new AppPrismaService();
  const service = new ClaimsService(appPrisma);

  const encounterIds: number[] = [];
  const otherFacility: { encounterId: number; facilityId: number }[] = [];

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

  it("rejects a non-finalized encounter, even at the caller's own facility", async () => {
    const encounterId = await createTestEncounter(appPrisma, [
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);
    encounterIds.push(encounterId);

    await expect(service.getClaimExport(encounterId, TEST_FACILITY_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("exports a finalized encounter at the caller's own facility with the expected shape", async () => {
    const encounterId = await createTestEncounter(
      appPrisma,
      [{ type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." }],
      {
        diagnoses: [
          { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
        ],
      }
    );
    encounterIds.push(encounterId);
    await appPrisma.codingDecision.update({
      where: { encounterId },
      data: { finalizedAt: new Date(), finalizedById: 1, msDrg: "195", msDrgDescription: "Simple Pneumonia" },
    });
    await appPrisma.encounter.update({ where: { id: encounterId }, data: { status: "FINALIZED" } });

    const claim = await service.getClaimExport(encounterId, TEST_FACILITY_ID);
    expect(claim.claimType).toBe("institutional-inpatient");
    expect(claim.principalDiagnosis).toMatchObject({ code: "J189", formattedCode: "J18.9" });
    expect(claim.drg).toEqual({ code: "195", description: "Simple Pneumonia" });
  });

  it("rejects (403) a finalized encounter belonging to a different facility, by valid ID (indirect/child-resource access check)", async () => {
    const other = await createOtherFacilityEncounter(appPrisma, {
      diagnoses: [
        { code: "J189", codeSystem: "ICD-10-CM", codeVersion: CODE_VERSION, role: "principal", presentOnAdmission: true },
      ],
      finalized: true,
      status: "FINALIZED",
    });
    otherFacility.push(other);

    await expect(service.getClaimExport(other.encounterId, TEST_FACILITY_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("throws NotFoundException for an encounter id that does not exist", async () => {
    await expect(service.getClaimExport(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
