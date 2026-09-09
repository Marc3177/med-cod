import { AppPrismaService } from "../prisma/app-prisma.service.js";

/**
 * Real-DB test fixture, not a mock — this project's whole testing philosophy
 * (see docs/VALIDATION_METHODOLOGY.md) is verifying against real data, and
 * that applies to automated tests too: they run against the actual local
 * dev Postgres and the actual FY2026 reference data, the same databases
 * every manual verification pass this project has used. Requires the local
 * dev databases to exist and be seeded (see docs/ARCHITECTURE.md) — a
 * missing MRN-QA-TEST patient means the environment isn't set up, not that
 * the test is wrong.
 */
export const TEST_FACILITY_ID = 1;
export const TEST_PATIENT_MRN = "MRN-QA-TEST";

export async function createTestEncounter(
  prisma: AppPrismaService,
  documents: { type: string; content: string }[],
  options?: { diagnoses?: Record<string, unknown>[] }
): Promise<number> {
  const patient = await prisma.patient.findFirstOrThrow({ where: { mrn: TEST_PATIENT_MRN } });
  const encounter = await prisma.encounter.create({
    data: {
      patientId: patient.id,
      facilityId: TEST_FACILITY_ID,
      admissionDate: new Date("2026-01-01"),
      status: "NEW",
      documents: { create: documents },
      ...(options?.diagnoses
        ? { codingDecision: { create: { diagnoses: options.diagnoses as object, procedures: [] } } }
        : {}),
    },
  });
  return encounter.id;
}

export async function deleteTestEncounter(prisma: AppPrismaService, encounterId: number): Promise<void> {
  await prisma.rejectedSuggestion.deleteMany({ where: { encounterId } });
  await prisma.encounterView.deleteMany({ where: { encounterId } });
  await prisma.query.deleteMany({ where: { encounterId } });
  await prisma.qaReview.deleteMany({ where: { encounterId } });
  await prisma.auditEntry.deleteMany({ where: { codingDecision: { encounterId } } });
  await prisma.codingDecision.deleteMany({ where: { encounterId } });
  await prisma.clinicalDocument.deleteMany({ where: { encounterId } });
  await prisma.encounter.deleteMany({ where: { id: encounterId } });
}

/**
 * A genuinely separate facility + patient + encounter, for facility-
 * isolation tests — created fresh per call rather than relying on
 * scripts/seed-second-facility.ts having been run, so no suite that uses
 * this has an external setup dependency. Options mirror
 * createTestEncounter's, plus an initial `status` (defaults to "NEW") since
 * isolation tests often need to seed a QA_REVIEW/FINALIZED starting point
 * directly rather than driving a whole workflow to reach it.
 */
export async function createOtherFacilityEncounter(
  prisma: AppPrismaService,
  options?: { status?: string; diagnoses?: Record<string, unknown>[]; finalized?: boolean }
): Promise<{ encounterId: number; facilityId: number }> {
  const facility = await prisma.facility.create({ data: { name: `Test Facility ${Date.now()}-${Math.random()}` } });
  const patient = await prisma.patient.create({
    data: { mrn: `MRN-TEST-${Date.now()}-${Math.random()}`, dateOfBirth: new Date("1990-01-01"), sex: "F" },
  });
  const encounter = await prisma.encounter.create({
    data: {
      patientId: patient.id,
      facilityId: facility.id,
      admissionDate: new Date("2026-01-01"),
      status: (options?.status ?? "NEW") as never,
      ...(options?.diagnoses
        ? {
            codingDecision: {
              create: {
                diagnoses: options.diagnoses as object,
                procedures: [],
                ...(options.finalized ? { finalizedAt: new Date(), finalizedById: 1 } : {}),
              },
            },
          }
        : {}),
    },
  });
  return { encounterId: encounter.id, facilityId: facility.id };
}

export async function deleteOtherFacilityEncounter(
  prisma: AppPrismaService,
  encounterId: number,
  facilityId: number
): Promise<void> {
  const encounter = await prisma.encounter.findUnique({ where: { id: encounterId } });
  await deleteTestEncounter(prisma, encounterId);
  if (encounter) await prisma.patient.deleteMany({ where: { id: encounter.patientId } });
  await prisma.facility.deleteMany({ where: { id: facilityId } });
}
