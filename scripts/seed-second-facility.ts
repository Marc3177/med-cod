/** One-off: creates a second facility with its own coder and one encounter,
 *  to verify multi-facility isolation for real (not just by inspection). */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.upsert({
    where: { id: 2 },
    update: {},
    create: { id: 2, name: "Riverside Regional Hospital" },
  });

  const coder = await prisma.user.upsert({
    where: { email: "coder2@med-cod.test" },
    update: {},
    create: {
      email: "coder2@med-cod.test",
      passwordHash: await bcrypt.hash("coder123", 10),
      role: "CODER",
      facilityId: facility.id,
    },
  });

  const patient = await prisma.patient.upsert({
    where: { mrn: "MRN-RIVERSIDE-0001" },
    update: {},
    create: { mrn: "MRN-RIVERSIDE-0001", dateOfBirth: new Date("1990-05-15"), sex: "F" },
  });

  const encounter = await prisma.encounter.create({
    data: {
      patientId: patient.id,
      facilityId: facility.id,
      admissionDate: new Date("2026-09-05"),
      dischargeDate: new Date("2026-09-06"),
      admittingDiagnosis: "Chest pain",
      status: "NEW",
      documents: {
        create: [
          {
            type: "DISCHARGE_SUMMARY",
            content: "Patient admitted with chest pain, ruled out for MI. Discharged home in stable condition.",
          },
        ],
      },
    },
  });

  console.log(JSON.stringify({ facilityId: facility.id, coderId: coder.id, encounterId: encounter.id }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
