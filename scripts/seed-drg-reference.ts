/**
 * Seeds a hand-curated, SIMPLIFIED DRG grouper reference set — not the real
 * CMS MS-DRG grouper. Covers a broader set of common inpatient condition
 * families plus an expanded CC/MCC severity list, enough for realistic
 * testing across several MDCs, and a first pass at procedure-driven surgical
 * DRG overrides. Building or licensing the real grouper (which resolves
 * MDC assignment, the full official OR/non-OR procedure designation list,
 * and thousands of CC/MCC codes via the Definitions Manual Appendix C) is a
 * separate, deferred integration project (see docs/REQUIREMENTS.md).
 *
 * CMS's own MS-DRG Definitions Manual (cms.gov/icd10m/...) is bot-blocked
 * the same way the rest of cms.gov is — confirmed via direct request, not
 * assumed — so this list is built from established, well-documented
 * coding-industry knowledge and cross-checked against our own loaded
 * ICD-10-CM/PCS data (every code below was verified to exist and be
 * billable before being added). It is NOT validated against the official
 * Appendix C list or the official OR-procedure list, and should not be
 * treated as authoritative for real billing.
 *
 * Some real MS-DRG families have only two severity tiers (w/ MCC vs. w/o
 * MCC), not three — for those, ccDrg intentionally duplicates noCcMccDrg
 * (documented per-family below) rather than inventing a middle tier.
 *
 * mdc: an approximate Major Diagnostic Category label (e.g. "04" for
 * respiratory, "11" for kidney/urinary) used to pair each medical family
 * with its surgical counterpart in SURGICAL_FAMILIES — see
 * grouper.service.ts for how the surgical override is applied.
 */
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";

const prisma = new PrismaClient();

const FAMILIES = [
  {
    name: "Simple Pneumonia & Pleurisy",
    mdc: "04",
    dxPrefixes: ["J13", "J14", "J15", "J16", "J18"],
    mccDrg: "193",
    mccDescription: "Simple Pneumonia & Pleurisy with MCC",
    ccDrg: "194",
    ccDescription: "Simple Pneumonia & Pleurisy with CC",
    noCcMccDrg: "195",
    noCcMccDescription: "Simple Pneumonia & Pleurisy without CC/MCC",
  },
  {
    name: "Respiratory Infections & Inflammations",
    mdc: "04",
    dxPrefixes: ["J69", "J09", "J10", "J11", "J12"],
    mccDrg: "177",
    mccDescription: "Respiratory Infections & Inflammations with MCC",
    ccDrg: "178",
    ccDescription: "Respiratory Infections & Inflammations with CC",
    noCcMccDrg: "179",
    noCcMccDescription: "Respiratory Infections & Inflammations without CC/MCC",
  },
  {
    name: "Renal Failure",
    mdc: "11",
    dxPrefixes: ["N17"],
    mccDrg: "682",
    mccDescription: "Renal Failure with MCC",
    ccDrg: "683",
    ccDescription: "Renal Failure with CC",
    noCcMccDrg: "684",
    noCcMccDescription: "Renal Failure without CC/MCC",
  },
  {
    name: "Other Kidney & Urinary Tract Diagnoses",
    mdc: "11",
    dxPrefixes: ["N18", "N390", "N10", "N12"],
    mccDrg: "698",
    mccDescription: "Other Kidney & Urinary Tract Diagnoses with MCC",
    ccDrg: "699",
    ccDescription: "Other Kidney & Urinary Tract Diagnoses with CC",
    noCcMccDrg: "700",
    noCcMccDescription: "Other Kidney & Urinary Tract Diagnoses without CC/MCC",
  },
  {
    name: "Chronic Obstructive Pulmonary Disease",
    mdc: "04",
    dxPrefixes: ["J44"],
    mccDrg: "190",
    mccDescription: "Chronic Obstructive Pulmonary Disease with MCC",
    ccDrg: "191",
    ccDescription: "Chronic Obstructive Pulmonary Disease with CC",
    noCcMccDrg: "192",
    noCcMccDescription: "Chronic Obstructive Pulmonary Disease without CC/MCC",
  },
  {
    name: "Heart Failure & Shock",
    mdc: "05",
    dxPrefixes: ["I50"],
    mccDrg: "291",
    mccDescription: "Heart Failure & Shock with MCC",
    ccDrg: "292",
    ccDescription: "Heart Failure & Shock with CC",
    noCcMccDrg: "293",
    noCcMccDescription: "Heart Failure & Shock without CC/MCC",
  },
  {
    name: "GI Hemorrhage",
    mdc: "06",
    dxPrefixes: ["K92", "K25", "K26", "K27", "K28", "I85"],
    mccDrg: "377",
    mccDescription: "GI Hemorrhage with MCC",
    ccDrg: "378",
    ccDescription: "GI Hemorrhage with CC",
    noCcMccDrg: "379",
    noCcMccDescription: "GI Hemorrhage without CC/MCC",
  },
  {
    name: "Diabetes",
    mdc: "10",
    dxPrefixes: ["E10", "E11", "E13"],
    mccDrg: "637",
    mccDescription: "Diabetes with MCC",
    ccDrg: "638",
    ccDescription: "Diabetes with CC",
    noCcMccDrg: "639",
    noCcMccDescription: "Diabetes without CC/MCC",
  },
  {
    name: "Esophagitis, Gastroenteritis & Misc Digestive Disorders",
    mdc: "06",
    // K35 (appendicitis) included so an appendicitis principal dx has an MDC
    // anchor even without an appendectomy — the real DRG for uncomplicated
    // appendicitis differs from this family's numbers; this is an
    // approximation, same caveat as everywhere else in this file.
    dxPrefixes: ["K52", "A08", "A09", "K35"],
    mccDrg: "391",
    mccDescription: "Esophagitis, Gastroenteritis & Misc Digestive Disorders with MCC",
    ccDrg: "392",
    ccDescription: "Esophagitis, Gastroenteritis & Misc Digestive Disorders with CC",
    noCcMccDrg: "393",
    noCcMccDescription: "Esophagitis, Gastroenteritis & Misc Digestive Disorders without CC/MCC",
  },
  {
    // Real-world Cellulitis has only two tiers (602 w MCC, 603 w/o MCC) —
    // ccDrg duplicates noCcMccDrg here rather than inventing a third tier.
    name: "Cellulitis",
    mdc: "09",
    dxPrefixes: ["L03"],
    mccDrg: "602",
    mccDescription: "Cellulitis with MCC",
    ccDrg: "603",
    ccDescription: "Cellulitis without MCC",
    noCcMccDrg: "603",
    noCcMccDescription: "Cellulitis without MCC",
  },
  {
    // Real-world Septicemia/Sepsis (w/o mechanical ventilation 96+ hrs) also
    // has only two tiers (871 w MCC, 872 w/o MCC) — same duplication note.
    name: "Septicemia or Severe Sepsis without Mechanical Ventilation 96+ Hours",
    mdc: "18",
    dxPrefixes: ["A40", "A41"],
    mccDrg: "871",
    mccDescription: "Septicemia or Severe Sepsis w/o MV 96+ Hours with MCC",
    ccDrg: "872",
    ccDescription: "Septicemia or Severe Sepsis w/o MV 96+ Hours without MCC",
    noCcMccDrg: "872",
    noCcMccDescription: "Septicemia or Severe Sepsis w/o MV 96+ Hours without MCC",
  },
  {
    // Acute ischemic stroke without thrombolytic (the thrombolytic-treated
    // variant is a separate real DRG family — 061/062/063 — not modeled here).
    name: "Acute Ischemic Stroke",
    mdc: "01",
    dxPrefixes: ["I63", "I61", "I62"],
    mccDrg: "064",
    mccDescription: "Intracranial Hemorrhage or Cerebral Infarction with MCC",
    ccDrg: "065",
    ccDescription: "Intracranial Hemorrhage or Cerebral Infarction with CC",
    noCcMccDrg: "066",
    noCcMccDescription: "Intracranial Hemorrhage or Cerebral Infarction without CC/MCC",
  },
  {
    // Real-world Seizures has only two tiers (100 w MCC, 101 w/o MCC).
    name: "Seizures",
    mdc: "01",
    dxPrefixes: ["G40", "R56"],
    mccDrg: "100",
    mccDescription: "Seizures with MCC",
    ccDrg: "101",
    ccDescription: "Seizures without MCC",
    noCcMccDrg: "101",
    noCcMccDescription: "Seizures without MCC",
  },
  {
    name: "Alcohol/Drug Abuse or Dependence",
    mdc: "20",
    dxPrefixes: ["F10", "F11", "F12", "F13", "F14", "F15", "F16", "F18", "F19"],
    mccDrg: "895",
    mccDescription: "Alcohol/Drug Abuse or Dependence with MCC",
    ccDrg: "896",
    ccDescription: "Alcohol/Drug Abuse or Dependence with CC",
    noCcMccDrg: "897",
    noCcMccDescription: "Alcohol/Drug Abuse or Dependence without CC/MCC",
  },
  {
    name: "Skin Ulcers",
    mdc: "09",
    dxPrefixes: ["L89", "L97", "L98"],
    mccDrg: "592",
    mccDescription: "Skin Ulcers with MCC",
    ccDrg: "593",
    ccDescription: "Skin Ulcers with CC",
    noCcMccDrg: "594",
    noCcMccDescription: "Skin Ulcers without CC/MCC",
  },
  {
    name: "Nutritional & Misc Metabolic Disorders",
    mdc: "10",
    dxPrefixes: ["E86", "E87", "E88"],
    mccDrg: "640",
    mccDescription: "Nutritional & Misc Metabolic Disorders with MCC",
    ccDrg: "641",
    ccDescription: "Nutritional & Misc Metabolic Disorders with CC",
    noCcMccDrg: "642",
    noCcMccDescription: "Nutritional & Misc Metabolic Disorders without CC/MCC",
  },
];

// Surgical counterpart families — matched by MDC (same as above) and a PCS
// code prefix (body system). See grouper.service.ts for the OR/non-OR
// root-operation classification that decides whether a procedure counts at
// all before this table is even consulted.
const SURGICAL_FAMILIES = [
  {
    name: "Major Chest Procedures",
    mdc: "04",
    pcsPrefixes: ["0B"], // Respiratory System body system
    mccDrg: "163",
    mccDescription: "Major Chest Procedures with MCC",
    ccDrg: "164",
    ccDescription: "Major Chest Procedures with CC",
    noCcMccDrg: "165",
    noCcMccDescription: "Major Chest Procedures without CC/MCC",
  },
  {
    name: "Other Kidney & Urinary Tract Procedures",
    mdc: "11",
    pcsPrefixes: ["0T"], // Urinary System body system
    mccDrg: "673",
    mccDescription: "Other Kidney & Urinary Tract Procedures with MCC",
    ccDrg: "674",
    ccDescription: "Other Kidney & Urinary Tract Procedures with CC",
    noCcMccDrg: "675",
    noCcMccDescription: "Other Kidney & Urinary Tract Procedures without CC/MCC",
  },
  {
    name: "Appendectomy",
    mdc: "06",
    pcsPrefixes: ["0D"], // Digestive System body system
    mccDrg: "338",
    mccDescription: "Appendectomy with MCC",
    ccDrg: "339",
    ccDescription: "Appendectomy with CC",
    noCcMccDrg: "340",
    noCcMccDescription: "Appendectomy without CC/MCC",
  },
  {
    // Note: Drainage ('9' root operation, e.g. an external ventricular drain)
    // is excluded from OR-procedure detection everywhere in this simplified
    // model (see grouper.service.ts) — including here, even though a real
    // EVD placement is often clinically significant for neurosurgery. Only
    // Release/Resection-type neuro procedures trigger this family.
    name: "Craniotomy & Endovascular Intracranial Procedures",
    mdc: "01",
    pcsPrefixes: ["00"], // Central Nervous System body system
    mccDrg: "023",
    mccDescription: "Craniotomy & Endovascular Intracranial Procedures with MCC",
    ccDrg: "024",
    ccDescription: "Craniotomy & Endovascular Intracranial Procedures with CC",
    noCcMccDrg: "025",
    noCcMccDescription: "Craniotomy & Endovascular Intracranial Procedures without CC/MCC",
  },
  {
    name: "Skin Debridement",
    mdc: "09",
    pcsPrefixes: ["0H"], // Skin and Breast body system
    mccDrg: "573",
    mccDescription: "Skin Debridement with MCC",
    ccDrg: "574",
    ccDescription: "Skin Debridement with CC",
    noCcMccDrg: "575",
    noCcMccDescription: "Skin Debridement without CC/MCC",
  },
];

// A hand-curated, EXPANDED but still non-exhaustive subset of the real CMS
// CC/MCC list — see the schema comment in reference.prisma and the file
// header above. Every code here was verified against our own loaded
// Icd10CmCode table (exists + billable) before being added.
const CC_MCC_FLAGS: { code: string; severity: "MCC" | "CC" }[] = [
  // Sepsis / infection
  { code: "A419", severity: "MCC" },
  { code: "A4189", severity: "MCC" },
  { code: "A0472", severity: "CC" }, // C. diff enterocolitis

  // Respiratory failure
  { code: "J9601", severity: "MCC" },
  { code: "J9602", severity: "MCC" },
  { code: "J9622", severity: "MCC" },
  { code: "J810", severity: "MCC" }, // acute pulmonary edema

  // Cardiac
  { code: "I469", severity: "MCC" }, // cardiac arrest, cause unspecified

  // Renal
  { code: "N179", severity: "MCC" },
  { code: "N186", severity: "MCC" }, // ESRD
  { code: "I120", severity: "MCC" }, // hypertensive CKD with stage 5/ESRD
  { code: "N185", severity: "CC" }, // CKD stage 5
  { code: "N184", severity: "CC" }, // CKD stage 4 (severe)

  // Diabetes complications
  { code: "E1122", severity: "CC" }, // type 2 diabetes with CKD
  { code: "E1129", severity: "CC" }, // type 2 diabetes with other kidney complication
  { code: "E1140", severity: "CC" }, // type 2 diabetes with neuropathy
  { code: "E1165", severity: "CC" }, // type 2 diabetes with hyperglycemia

  // Electrolyte / metabolic
  { code: "E8720", severity: "CC" }, // acidosis, unspecified
  { code: "E871", severity: "CC" }, // hypo-osmolality and hyponatremia
  { code: "E875", severity: "CC" }, // hyperkalemia
  { code: "E876", severity: "CC" }, // hypokalemia
  { code: "E860", severity: "CC" }, // dehydration
  { code: "E869", severity: "CC" }, // volume depletion, unspecified

  // Neuro
  { code: "G40901", severity: "MCC" }, // epilepsy with status epilepticus
  { code: "R4020", severity: "MCC" }, // unspecified coma
  { code: "G935", severity: "MCC" }, // compression of brain

  // Hepatic
  { code: "K7211", severity: "MCC" }, // chronic hepatic failure with coma

  // GI bleeding / hematologic
  { code: "K920", severity: "CC" }, // hematemesis
  { code: "K922", severity: "CC" }, // GI hemorrhage, unspecified
  { code: "D62", severity: "CC" }, // acute posthemorrhagic anemia

  // Substance withdrawal
  { code: "F10230", severity: "CC" }, // alcohol dependence with withdrawal

  // Pressure ulcers
  { code: "L89153", severity: "CC" }, // sacral pressure ulcer, stage 3
  { code: "L89154", severity: "MCC" }, // sacral pressure ulcer, stage 4

  // Respiratory (principal-family conditions also usable as CC when secondary)
  { code: "J690", severity: "CC" }, // pneumonitis due to inhalation of food and vomit
];

async function main() {
  await prisma.drgFamily.deleteMany();
  await prisma.surgicalDrgFamily.deleteMany();
  for (const family of FAMILIES) {
    await prisma.drgFamily.create({ data: family });
  }
  for (const family of SURGICAL_FAMILIES) {
    await prisma.surgicalDrgFamily.create({ data: family });
  }
  for (const flag of CC_MCC_FLAGS) {
    await prisma.ccMccFlag.upsert({
      where: { code: flag.code },
      update: { severity: flag.severity },
      create: flag,
    });
  }
  console.log(
    `seeded ${FAMILIES.length} DRG families, ${SURGICAL_FAMILIES.length} surgical DRG families, and ${CC_MCC_FLAGS.length} CC/MCC flags.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
