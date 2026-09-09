/**
 * Seeds a curated clinical-abbreviation alias table — fixes the "COPD
 * returns zero results" gap found during the Phase 1-7 end-to-end test
 * pass (docs/TEST_REPORT.md). Neither ICD-10-CM code descriptions nor the
 * Alphabetic Index use abbreviations, only spelled-out clinical terms —
 * this table bridges that gap for the encoder search and the suggestions
 * engine (see TerminologyService).
 *
 * Deliberately excludes genuinely ambiguous abbreviations (e.g. "ARF" —
 * acute respiratory failure vs. acute renal failure depending on context)
 * rather than guess wrong — an abbreviation only belongs here if its
 * expansion is unambiguous in general inpatient use.
 */
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";

const prisma = new PrismaClient();

const ALIASES: { alias: string; expansion: string }[] = [
  { alias: "COPD", expansion: "chronic obstructive pulmonary disease" },
  { alias: "MI", expansion: "myocardial infarction" },
  { alias: "CHF", expansion: "congestive heart failure" },
  { alias: "AKI", expansion: "acute kidney injury" },
  { alias: "CKD", expansion: "chronic kidney disease" },
  { alias: "ESRD", expansion: "end stage renal disease" },
  { alias: "UTI", expansion: "urinary tract infection" },
  { alias: "DM", expansion: "diabetes mellitus" },
  { alias: "DKA", expansion: "diabetic ketoacidosis" },
  { alias: "HTN", expansion: "hypertension" },
  { alias: "DVT", expansion: "deep vein thrombosis" },
  { alias: "PE", expansion: "pulmonary embolism" },
  { alias: "CVA", expansion: "cerebrovascular accident" },
  { alias: "TIA", expansion: "transient ischemic attack" },
  { alias: "CAD", expansion: "coronary artery disease" },
  { alias: "AFIB", expansion: "atrial fibrillation" },
  { alias: "GERD", expansion: "gastroesophageal reflux disease" },
  { alias: "OSA", expansion: "obstructive sleep apnea" },
  { alias: "BPH", expansion: "benign prostatic hyperplasia" },
  { alias: "ARDS", expansion: "acute respiratory distress syndrome" },
  { alias: "PNA", expansion: "pneumonia" },
  { alias: "HLD", expansion: "hyperlipidemia" },
  { alias: "AAA", expansion: "abdominal aortic aneurysm" },
  { alias: "PVD", expansion: "peripheral vascular disease" },
  { alias: "URI", expansion: "upper respiratory infection" },
  { alias: "GI BLEED", expansion: "gastrointestinal hemorrhage" },
];

async function main() {
  for (const a of ALIASES) {
    await prisma.clinicalAlias.upsert({
      where: { alias: a.alias },
      update: { expansion: a.expansion },
      create: a,
    });
  }
  console.log(`seeded ${ALIASES.length} clinical aliases.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
