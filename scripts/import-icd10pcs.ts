/**
 * Bulk-loads the FY2026 ICD-10-PCS order file into coding_reference.Icd10PcsCode.
 *
 * Source: CMS (public domain) — cms.gov itself is bot-protected (Akamai, blocks
 * both curl and automated browsers), so this was retrieved from the Wayback
 * Machine's archive of the same file:
 *   http://web.archive.org/web/20260512153346/https://www.cms.gov/files/zip/2026-icd-10-pcs-order-file-long-and-abbreviated-titles.zip
 * The zip's internal file timestamps (May 2025) match the genuine FY2026 CMS
 * release — verified before trusting this as a real source.
 *
 * File: icd10pcs_order_2026.txt, same fixed-width layout as the ICD-10-CM
 * order file:
 *   cols 1-5   order number (unused here)
 *   cols 7-13  code (left-justified, space-padded to 7 chars)
 *   col  15    billable flag: '0' = table/header row, '1' = billable code
 *   cols 17-76 short/abbreviated title (unused — PCS has only one description)
 *   cols 77+   long description
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";
import { Icd10PcsBulkImportSchema, type Icd10PcsRow } from "../packages/shared/src/schemas/icd10pcs.js";

const SOURCE_FILE = process.argv[2];
const FISCAL_YEAR = 2026;
const EFFECTIVE_FROM = "2025-10-01";

if (!SOURCE_FILE) {
  console.error("usage: tsx scripts/import-icd10pcs.ts <path-to-icd10pcs_order_2026.txt>");
  process.exit(1);
}

function parseLine(line: string): Icd10PcsRow | null {
  if (line.trim().length === 0) return null;
  const code = line.slice(6, 13).trim();
  const billableFlag = line.slice(14, 15);
  const longDescription = line.slice(76).trim();

  return {
    code,
    description: longDescription,
    isBillable: billableFlag === "1",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    fiscalYear: FISCAL_YEAR,
  };
}

async function main() {
  const raw = readFileSync(SOURCE_FILE, "latin1");
  const lines = raw.split(/\r?\n/);
  const parsed = lines.map(parseLine).filter((row): row is Icd10PcsRow => row !== null);

  console.log(`parsed ${parsed.length} rows, validating against shared schema...`);
  const result = Icd10PcsBulkImportSchema.safeParse(parsed);
  if (!result.success) {
    console.error("validation failed, aborting import — no rows written:");
    console.error(result.error.issues.slice(0, 20));
    process.exit(1);
  }

  const rows = result.data;
  console.log(`${rows.length} rows valid. Applying to coding_reference...`);

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.icd10PcsCode.deleteMany({ where: { fiscalYear: FISCAL_YEAR } }),
      prisma.icd10PcsCode.createMany({
        data: rows.map((r) => ({
          code: r.code,
          description: r.description,
          isBillable: r.isBillable,
          fiscalYear: r.fiscalYear,
          effectiveFrom: new Date(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
        })),
      }),
    ]);
    console.log(`loaded ${rows.length} ICD-10-PCS codes for FY${FISCAL_YEAR}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
