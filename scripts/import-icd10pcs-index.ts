/**
 * Bulk-loads the FY2026 ICD-10-PCS Alphabetic Index into
 * coding_reference.SynonymIndexEntry — this is what lets the encoder answer
 * a clinical-term search like "bronchoscopy" (which never appears in any
 * ICD-10-PCS code description) with the correct code(s).
 *
 * Source: CMS "2026 ICD-10-PCS Code Tables and Index" (cms.gov itself is
 * bot-protected — retrieved via the Wayback Machine, same as the order file;
 * verified by internal file timestamps matching the real FY2026 release).
 *
 * File: icd10pcs_index_2026.xml. Structure (see icd10pcs_index.xsd):
 * <letter> -> <mainTerm> -> nested <term level="N">, each optionally carrying
 * <code> (one complete code), <codes>/<tab> (a table stub — a prefix, not a
 * full code), or <see> (a cross-reference, sometimes with its own inline
 * <codes>/<tab>). <use> references are synonyms for table VALUES, not codes
 * — skipped here, they don't resolve to anything codeable on their own.
 */
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";

const SOURCE_FILE = process.argv[2];
const FISCAL_YEAR = 2026;
const EFFECTIVE_FROM = "2025-10-01";
const CODE_SYSTEM = "ICD-10-PCS";

if (!SOURCE_FILE) {
  console.error("usage: tsx scripts/import-icd10pcs-index.ts <path-to-icd10pcs_index_2026.xml>");
  process.exit(1);
}

type Entry = { term: string; matchType: "code" | "prefix"; codeValue: string };

// fast-xml-parser gives a single object (not an array) when an element occurs
// once, and an array when it repeats — normalize every place that can repeat.
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function walkTerm(node: any, parentPath: string, entries: Entry[]): void {
  const title: string | undefined = node.title;
  const path = title ? (parentPath ? `${parentPath}, ${title}` : title) : parentPath;

  if (typeof node.code === "string") {
    entries.push({ term: path, matchType: "code", codeValue: node.code });
  } else if (typeof node.codes === "string") {
    entries.push({ term: path, matchType: "prefix", codeValue: node.codes });
  } else if (typeof node.tab === "string") {
    entries.push({ term: path, matchType: "prefix", codeValue: node.tab });
  } else if (node.see !== undefined) {
    // <see> can carry its own inline <codes>/<tab> even without a full cross-
    // reference resolution — that's the common case and the only one handled.
    const see = node.see;
    if (typeof see === "object") {
      if (typeof see.codes === "string") entries.push({ term: path, matchType: "prefix", codeValue: see.codes });
      else if (typeof see.tab === "string") entries.push({ term: path, matchType: "prefix", codeValue: see.tab });
    }
  }
  // <use> intentionally produces no entry — see file header comment.

  for (const child of asArray(node.term)) {
    walkTerm(child, path, entries);
  }
}

async function main() {
  const raw = readFileSync(SOURCE_FILE, "utf-8");
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(raw);

  const letters = asArray(doc["ICD10PCS.index"].letter);
  const entries: Entry[] = [];

  for (const letter of letters) {
    for (const mainTerm of asArray(letter.mainTerm)) {
      walkTerm(mainTerm, "", entries);
    }
  }

  console.log(`extracted ${entries.length} index entries.`);

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.synonymIndexEntry.deleteMany({ where: { codeSystem: CODE_SYSTEM, fiscalYear: FISCAL_YEAR } }),
      prisma.synonymIndexEntry.createMany({
        data: entries.map((e) => ({
          codeSystem: CODE_SYSTEM,
          term: e.term,
          matchType: e.matchType,
          codeValue: e.codeValue,
          fiscalYear: FISCAL_YEAR,
          effectiveFrom: new Date(EFFECTIVE_FROM),
        })),
      }),
    ]);
    console.log(`loaded ${entries.length} PCS index entries for FY${FISCAL_YEAR}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
