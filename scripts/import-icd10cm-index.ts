/**
 * Bulk-loads the FY2026 ICD-10-CM Alphabetic Index into
 * coding_reference.SynonymIndexEntry — the official CMS/NCHS bridge from
 * clinical terms (e.g. "aspiration pneumonia") to codes, since the code
 * descriptions themselves use formal nomenclature (e.g. "Pneumonitis due to
 * inhalation of food and vomit") that a physician's note rarely matches.
 *
 * Source: CDC/NCHS FTP (public, no bot-blocking — unlike cms.gov).
 * File: icd10cm-index-2026.xml. Structure (see icd10cm-index-2026.xsd):
 * <letter> -> <mainTerm> -> nested <term level="N">, each with a <title>
 * (mixed content — may carry a <nemod> non-essential-modifier child) and
 * optionally one <code>. Index codes are dotted (e.g. "J18.9"); normalized
 * here to undotted to match Icd10CmCode's storage convention.
 *
 * <see>/<seeAlso> are plain-text cross-references with no inline code
 * (unlike the PCS index's <see>) — resolving those needs a second pass by
 * title lookup across the whole tree, which this pass does not attempt.
 * Every direct <code> leaf is captured regardless, which covers the
 * overwhelming majority of real search terms.
 *
 * A code ending in "-" (e.g. "I82.40-") is the Index's own convention for
 * "additional character(s) required, see Tabular List" — it's a code STEM
 * covering a range of complete codes, not a single valid one. Storing it as
 * matchType 'code' made every such entry silently unresolvable (no exact
 * code match, so the search just returned nothing) — affects ~11% of all
 * entries (6,955 of 63,138), caught only once the encoder's abbreviation
 * expansion (DVT -> "deep vein thrombosis") routed a search through one.
 * Fixed the same way the PCS index already handles its own table stubs:
 * matchType 'prefix', resolved by the encoder via a startsWith expansion.
 */
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { PrismaClient } from "../apps/api/node_modules/.prisma/reference-client/index.js";

const SOURCE_FILE = process.argv[2];
const FISCAL_YEAR = 2026;
const EFFECTIVE_FROM = "2025-10-01";
const CODE_SYSTEM = "ICD-10-CM";

if (!SOURCE_FILE) {
  console.error("usage: tsx scripts/import-icd10cm-index.ts <path-to-icd10cm-index-2026.xml>");
  process.exit(1);
}

type Entry = { term: string; matchType: "code" | "prefix"; codeValue: string };

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function titleText(title: unknown): string {
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "#text" in title) return String((title as any)["#text"]);
  return "";
}

function normalizeCode(code: string): string {
  return code.replace(".", "").trim().toUpperCase();
}

function walkTerm(node: any, parentPath: string, entries: Entry[]): void {
  const title = titleText(node.title);
  const path = title ? (parentPath ? `${parentPath}, ${title}` : title) : parentPath;

  if (typeof node.code === "string" && path) {
    const normalized = normalizeCode(node.code);
    if (normalized.endsWith("-")) {
      entries.push({ term: path, matchType: "prefix", codeValue: normalized.slice(0, -1) });
    } else {
      entries.push({ term: path, matchType: "code", codeValue: normalized });
    }
  }

  for (const child of asArray(node.term)) {
    walkTerm(child, path, entries);
  }
}

async function main() {
  const raw = readFileSync(SOURCE_FILE, "utf-8");
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: "#text" });
  const doc = parser.parse(raw);

  const letters = asArray(doc["ICD10CM.index"].letter);
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
    console.log(`loaded ${entries.length} CM index entries for FY${FISCAL_YEAR}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
