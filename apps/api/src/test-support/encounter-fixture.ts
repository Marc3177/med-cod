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
