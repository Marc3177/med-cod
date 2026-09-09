/**
 * Bulk-loads the FY2026 ICD-10-CM order file into coding_reference.Icd10CmCode.
 *
 * Source: CDC/NCHS FTP (public domain) —
 *   https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2026/icd10cm-Code%20Descriptions-2026.zip
 * File: icd10cm-order-2026.txt, fixed-width format:
 *   cols 1-5   order number (unused here)
 *   cols 7-13  code (left-justified, space-padded)
 *   col  15    billable flag: '0' = category/header, '1' = billable leaf code
 *   cols 17-76 short description (space-padded to 60 chars)
 *   cols 77+   long description
 *
 * Follows the validate -> stage -> apply pattern from docs/DESIGN.md:
 * every row is parsed and Zod-validated before any DB write; a malformed
 * file fails loudly instead of partially loading.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";
import { Icd10CmBulkImportSchema, type Icd10CmRow } from "../packages/shared/src/schemas/icd10cm.js";

const SOURCE_FILE = process.argv[2];
const FISCAL_YEAR = 2026;
const EFFECTIVE_FROM = "2025-10-01";

if (!SOURCE_FILE) {
  console.error("usage: tsx scripts/import-icd10cm.ts <path-to-icd10cm-order-2026.txt>");
  process.exit(1);
}

function parseLine(line: string): Icd10CmRow | null {
  if (line.trim().length === 0) return null;
  const code = line.slice(6, 13).trim();
  const billableFlag = line.slice(14, 15);
  const shortDescription = line.slice(16, 76).trim();
  const longDescription = line.slice(76).trim() || shortDescription;

  return {
    code,
    shortDescription,
    longDescription,
    isBillable: billableFlag === "1",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    fiscalYear: FISCAL_YEAR,
  };
}

async function main() {
  const raw = readFileSync(SOURCE_FILE, "latin1");
  const lines = raw.split(/\r?\n/);
  const parsed = lines.map(parseLine).filter((row): row is Icd10CmRow => row !== null);

  console.log(`parsed ${parsed.length} rows, validating against shared schema...`);
  const result = Icd10CmBulkImportSchema.safeParse(parsed);
  if (!result.success) {
    console.error("validation failed, aborting import — no rows written:");
    console.error(result.error.issues.slice(0, 20));
    process.exit(1);
  }

  const rows = result.data;
  console.log(`${rows.length} rows valid. Applying to coding_reference...`);

  const prisma = new PrismaClient();
  try {
    // Replace-in-full for this fiscal year, in one transaction: never leaves
    // the table half-loaded if something fails partway through.
    await prisma.$transaction([
      prisma.icd10CmCode.deleteMany({ where: { fiscalYear: FISCAL_YEAR } }),
      prisma.icd10CmCode.createMany({
        data: rows.map((r) => ({
          code: r.code,
          shortDescription: r.shortDescription,
          longDescription: r.longDescription,
          isBillable: r.isBillable,
          fiscalYear: r.fiscalYear,
          effectiveFrom: new Date(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
        })),
      }),
    ]);
    console.log(`loaded ${rows.length} ICD-10-CM codes for FY${FISCAL_YEAR}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
