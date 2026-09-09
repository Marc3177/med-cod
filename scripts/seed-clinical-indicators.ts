/**
 * Seeds a small, hand-curated set of lab-value indicators used by
 * documentation-gap detection — the "elevated creatinine documented but no
 * kidney diagnosis coded" pattern real coders/CDI specialists query on
 * every day. Every related diagnosis code was verified to exist and be
 * billable against our own loaded ICD-10-CM data before being added here
 * (same discipline as seed-drg-reference.ts and seed-clinical-aliases.ts).
 *
 * Deliberately small and explicit — this is not meant to be exhaustive,
 * it's five well-understood, unambiguous clinical triggers. Thresholds are
 * standard adult reference-range cutoffs, not patient-specific (a real
 * system would compare against the patient's own baseline where available;
 * this app has no structured lab data to do that with yet — see
 * docs/ROADMAP.md).
 */
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";

const prisma = new PrismaClient();

const INDICATORS = [
  {
    name: "Elevated creatinine",
    keyword: "creatinine",
    direction: "above",
    threshold: 1.2,
    unit: "mg/dL",
    relatedDxPrefixes: ["N17", "N18", "N19"],
    queryTemplate:
      "Creatinine of {value} mg/dL is documented. Does this represent acute kidney injury, chronic kidney disease, both, or is it not clinically significant?",
  },
  {
    name: "Low sodium",
    keyword: "sodium",
    direction: "below",
    threshold: 135,
    unit: "mEq/L",
    relatedDxPrefixes: ["E871"],
    queryTemplate:
      "Sodium of {value} mEq/L is documented. Does this represent clinically significant hyponatremia, or is it not clinically significant?",
  },
  {
    name: "High potassium",
    keyword: "potassium",
    direction: "above",
    threshold: 5.5,
    unit: "mEq/L",
    relatedDxPrefixes: ["E875"],
    queryTemplate:
      "Potassium of {value} mEq/L is documented. Does this represent clinically significant hyperkalemia, or is it not clinically significant?",
  },
  {
    name: "Low potassium",
    keyword: "potassium",
    direction: "below",
    threshold: 3.5,
    unit: "mEq/L",
    relatedDxPrefixes: ["E876"],
    queryTemplate:
      "Potassium of {value} mEq/L is documented. Does this represent clinically significant hypokalemia, or is it not clinically significant?",
  },
  {
    name: "Elevated troponin",
    keyword: "troponin",
    direction: "above",
    threshold: 0.04,
    unit: "ng/mL",
    relatedDxPrefixes: ["I21", "I22"],
    queryTemplate:
      "Troponin of {value} ng/mL is documented. Does this represent an acute myocardial infarction, demand ischemia, or is it not clinically significant?",
  },
];

async function main() {
  await prisma.clinicalIndicator.deleteMany();
  for (const indicator of INDICATORS) {
    await prisma.clinicalIndicator.create({ data: indicator });
  }
  console.log(`seeded ${INDICATORS.length} clinical indicators.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
