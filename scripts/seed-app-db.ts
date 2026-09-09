/**
 * Seeds coding_app with one facility, one coder, and three sample inpatient
 * encounters with hand-written discharge summaries — enough to exercise the
 * full Phase 1 loop (work queue -> encounter -> encoder search -> assign
 * codes -> finalize) without needing real PHI or Synthea set up yet.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "General Hospital" },
  });

  const coder = await prisma.user.upsert({
    where: { email: "coder1@med-cod.test" },
    update: {},
    create: {
      email: "coder1@med-cod.test",
      passwordHash: await bcrypt.hash("coder123", 10),
      role: "CODER",
      facilityId: facility.id,
    },
  });

  const patient1 = await prisma.patient.upsert({
    where: { mrn: "MRN-0001" },
    update: {},
    create: { mrn: "MRN-0001", dateOfBirth: new Date("1958-03-12"), sex: "M" },
  });

  const encounter1 = await prisma.encounter.create({
    data: {
      patientId: patient1.id,
      facilityId: facility.id,
      admissionDate: new Date("2026-09-01"),
      dischargeDate: new Date("2026-09-04"),
      admittingDiagnosis: "Shortness of breath",
      dischargeDisposition: "Home",
      status: "NEW",
      documents: {
        create: [
          {
            type: "DISCHARGE_SUMMARY",
            content: `DISCHARGE SUMMARY

Patient admitted with shortness of breath and fever.
Chest imaging demonstrates right lower lobe pneumonia.
Patient treated with IV ceftriaxone and azithromycin with clinical improvement.
History significant for type 2 diabetes mellitus, well-controlled on metformin.
Discharged home in stable condition, follow up with PCP in 1 week.`,
          },
          {
            type: "H_AND_P",
            content: `HISTORY & PHYSICAL

Chief complaint: shortness of breath x 3 days, subjective fever.
Past medical history: type 2 diabetes mellitus.
Assessment: community-acquired pneumonia, likely bacterial. Rule out sepsis.
Plan: admit, blood cultures, empiric IV antibiotics, continue home metformin.`,
          },
        ],
      },
    },
  });

  const patient2 = await prisma.patient.upsert({
    where: { mrn: "MRN-0002" },
    update: {},
    create: { mrn: "MRN-0002", dateOfBirth: new Date("1972-11-02"), sex: "F" },
  });

  const encounter2 = await prisma.encounter.create({
    data: {
      patientId: patient2.id,
      facilityId: facility.id,
      admissionDate: new Date("2026-09-02"),
      dischargeDate: new Date("2026-09-06"),
      admittingDiagnosis: "Elevated creatinine",
      dischargeDisposition: "Home",
      status: "NEW",
      documents: {
        create: [
          {
            type: "DISCHARGE_SUMMARY",
            content: `DISCHARGE SUMMARY

Patient admitted with acute rise in creatinine to 2.4 from baseline 1.0.
Received IV fluids with improvement in renal function to 1.3 at discharge.
Urinalysis unremarkable. No evidence of obstruction on renal ultrasound.
Impression: acute kidney injury, likely pre-renal from poor oral intake.
Discharged home, follow up labs in 1 week.`,
          },
        ],
      },
    },
  });

  const patient3 = await prisma.patient.upsert({
    where: { mrn: "MRN-0003" },
    update: {},
    create: { mrn: "MRN-0003", dateOfBirth: new Date("1965-06-20"), sex: "M" },
  });

  const encounter3 = await prisma.encounter.create({
    data: {
      patientId: patient3.id,
      facilityId: facility.id,
      admissionDate: new Date("2026-09-03"),
      dischargeDate: new Date("2026-09-05"),
      admittingDiagnosis: "Altered mental status",
      dischargeDisposition: "Home",
      status: "NEW",
      documents: {
        create: [
          {
            type: "OPERATIVE_REPORT",
            content: `OPERATIVE REPORT

Procedure: Bronchoscopy with bronchoalveolar lavage.
Indication: persistent hypoxia, suspected aspiration pneumonia.
Findings: mucopurulent secretions in right lower lobe, cleared via lavage.
No endobronchial lesions identified.`,
          },
          {
            type: "DISCHARGE_SUMMARY",
            content: `DISCHARGE SUMMARY

Patient admitted with altered mental status found to be due to aspiration
pneumonia. Underwent bronchoscopy with lavage, improved with IV antibiotics.
Discharged home in stable condition.`,
          },
        ],
      },
    },
  });

  console.log("seeded:", {
    facility: facility.name,
    coder: coder.email,
    encounters: [encounter1.id, encounter2.id, encounter3.id],
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
