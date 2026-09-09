/** One-off: creates several minimal encounters purely to test QA sampling
 *  statistics (each will be finalized via the API right after). */
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const patient = await prisma.patient.upsert({
    where: { mrn: "MRN-QA-TEST" },
    update: {},
    create: { mrn: "MRN-QA-TEST", dateOfBirth: new Date("1980-01-01"), sex: "M" },
  });

  const ids: number[] = [];
  for (let i = 0; i < 8; i++) {
    const encounter = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        facilityId: 1,
        admissionDate: new Date("2026-09-01"),
        dischargeDate: new Date("2026-09-02"),
        status: "NEW",
      },
    });
    ids.push(encounter.id);
  }
  console.log(JSON.stringify(ids));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
