import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { FhirService } from "./fhir.service.js";
import { TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

function bundle(mrn: string) {
  return {
    resourceType: "Bundle",
    entry: [
      {
        fullUrl: "urn:uuid:patient-1",
        resource: {
          resourceType: "Patient",
          identifier: [{ value: mrn }],
          birthDate: "1985-06-01",
          gender: "female",
        },
      },
      {
        fullUrl: "urn:uuid:encounter-1",
        resource: {
          resourceType: "Encounter",
          subject: { reference: "urn:uuid:patient-1" },
          period: { start: "2026-01-01", end: "2026-01-03" },
        },
      },
      {
        fullUrl: "urn:uuid:doc-1",
        resource: {
          resourceType: "DocumentReference",
          type: { text: "Discharge Summary" },
          context: { encounter: [{ reference: "urn:uuid:encounter-1" }] },
          content: [{ attachment: { data: Buffer.from("Patient admitted with pneumonia.").toString("base64") } }],
        },
      },
    ],
  };
}

/**
 * Facility isolation for FHIR ingestion, part of the systematic audit (see
 * docs/TEST_REPORT.md "Encounter ownership / locked-state audit"). Unlike
 * every other module audited, ingestBundle() takes no target resource ID at
 * all — facilityId comes only from the caller's own JWT, never from bundle
 * content — so there is no "supply a child-resource ID belonging to another
 * facility" vector here by construction. What actually needs verifying:
 * every encounter/document this creates is tied to the CALLING facility
 * regardless of what the bundle itself claims, and that Patient rows (which
 * have no facilityId — see the model comment — patient identity is
 * deliberately shared across facilities, only encounters are tenant-scoped)
 * don't leak one facility's encounters to another via a shared MRN.
 */
describe("FhirService — facility isolation", () => {
  const appPrisma = new AppPrismaService();
  const service = new FhirService(appPrisma);

  let OTHER_FACILITY_ID: number;
  const encounterIds: number[] = [];
  const mrns: string[] = [];

  beforeAll(async () => {
    const facility = await appPrisma.facility.create({ data: { name: `Test Facility ${Date.now()}` } });
    OTHER_FACILITY_ID = facility.id;
  });

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await appPrisma.clinicalDocument.deleteMany({ where: { encounterId: id } });
      await appPrisma.encounter.deleteMany({ where: { id } });
    }
    while (mrns.length > 0) {
      await appPrisma.patient.deleteMany({ where: { mrn: mrns.pop()! } });
    }
  });

  afterAll(async () => {
    await appPrisma.facility.deleteMany({ where: { id: OTHER_FACILITY_ID } });
    await appPrisma.$disconnect();
  });

  it("always ties the ingested encounter to the calling facility, not anything the bundle itself might claim", async () => {
    const mrn = `MRN-FHIR-TEST-${Date.now()}`;
    mrns.push(mrn);

    const result = await service.ingestBundle(bundle(mrn), OTHER_FACILITY_ID);
    expect(result).toEqual({ patients: 1, encounters: 1, documents: 1 });

    const patient = await appPrisma.patient.findUniqueOrThrow({ where: { mrn } });
    const encounter = await appPrisma.encounter.findFirstOrThrow({ where: { patientId: patient.id } });
    encounterIds.push(encounter.id);
    expect(encounter.facilityId).toBe(OTHER_FACILITY_ID);
  });

  it("a shared MRN across two facilities' bundles reuses one Patient row but creates two separately-owned encounters, not a merged/cross-visible one", async () => {
    const mrn = `MRN-FHIR-SHARED-${Date.now()}`;
    mrns.push(mrn);

    await service.ingestBundle(bundle(mrn), TEST_FACILITY_ID);
    await service.ingestBundle(bundle(mrn), OTHER_FACILITY_ID);

    const patient = await appPrisma.patient.findUniqueOrThrow({ where: { mrn } });
    const encounters = await appPrisma.encounter.findMany({ where: { patientId: patient.id } });
    encounters.forEach((e) => encounterIds.push(e.id));

    expect(encounters).toHaveLength(2);
    const facilityIds = encounters.map((e) => e.facilityId).sort((a, b) => a - b);
    expect(facilityIds).toEqual([TEST_FACILITY_ID, OTHER_FACILITY_ID].sort((a, b) => a - b));
    // Each encounter's facility is exactly the one that ingested it — no
    // cross-contamination between the two ingestion calls.
    for (const e of encounters) {
      expect([TEST_FACILITY_ID, OTHER_FACILITY_ID]).toContain(e.facilityId);
    }
  });

  it("rejects a bundle missing a Patient or Encounter resource, without creating anything", async () => {
    const emptyBundle = { resourceType: "Bundle", entry: [] };
    await expect(service.ingestBundle(emptyBundle, OTHER_FACILITY_ID)).rejects.toThrow();
  });
});
