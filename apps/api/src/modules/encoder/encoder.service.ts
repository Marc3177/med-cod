import { Injectable } from "@nestjs/common";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { TerminologyService } from "../terminology/terminology.service.js";

const CURRENT_FISCAL_YEAR = 2026;
const RESULT_LIMIT = 50;
const SYNONYM_TERM_LIMIT = 20;
const PREFIX_EXPANSION_LIMIT = 20;
/** Below this length, a substring match against free-text descriptions is
 *  noise, not signal — e.g. "MI" matches "middle", "AKI" matches
 *  "anisakiasis". Found via real testing: short clinical abbreviations
 *  (which the terminology-expanded index search already handles properly)
 *  were being drowned out by garbage direct-description matches filling
 *  the result list first. Same threshold as MIN_SIGNIFICANT_WORD_LENGTH in
 *  suggestions.service.ts, for the same reason. */
const MIN_DESCRIPTION_SEARCH_LENGTH = 4;

/**
 * The alphabetic index stores terms in inverted, comma-joined order
 * (e.g. "Pneumonia, aspiration"), which a physician's note never matches
 * word-for-word ("aspiration pneumonia"). Requiring every query word to
 * appear somewhere in the term — instead of the whole phrase in order —
 * is what makes the search order-independent.
 */
function wordFilters(query: string) {
  return query
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((word) => ({ term: { contains: word, mode: "insensitive" as const } }));
}

type SearchResult<TDescriptionField extends string> = {
  code: string;
  isBillable: boolean;
  /** Set when this result came from the alphabetic index rather than a
   *  direct description match — shown in the UI so a coder can see *why*
   *  a code with no shared words to their search term was suggested. */
  matchedVia?: string;
} & Record<TDescriptionField, string>;

@Injectable()
export class EncoderService {
  constructor(
    private readonly referencePrisma: ReferencePrismaService,
    private readonly terminologyService: TerminologyService
  ) {}

  async searchIcd10Cm(query: string): Promise<SearchResult<"shortDescription" | "longDescription">[]> {
    const term = query.trim();
    if (term.length === 0) return [];
    // Expanding only feeds the index (wordFilters) search below — the direct
    // description search still runs on the coder's literal input.
    const expandedTerm = await this.terminologyService.expandText(term);

    const [direct, indexEntries] = await Promise.all([
      this.referencePrisma.icd10CmCode.findMany({
        where: {
          fiscalYear: CURRENT_FISCAL_YEAR,
          OR: [
            { code: { startsWith: term.toUpperCase() } },
            ...(term.length >= MIN_DESCRIPTION_SEARCH_LENGTH
              ? [{ longDescription: { contains: term, mode: "insensitive" as const } }]
              : []),
          ],
        },
        orderBy: { code: "asc" },
        take: RESULT_LIMIT,
      }),
      this.referencePrisma.synonymIndexEntry.findMany({
        where: { codeSystem: "ICD-10-CM", fiscalYear: CURRENT_FISCAL_YEAR, AND: wordFilters(expandedTerm) },
        take: SYNONYM_TERM_LIMIT,
      }),
    ]);

    const results = new Map<string, SearchResult<"shortDescription" | "longDescription">>();
    for (const row of direct) {
      results.set(row.code, { code: row.code, shortDescription: row.shortDescription, longDescription: row.longDescription, isBillable: row.isBillable });
    }

    for (const entry of indexEntries) {
      if (entry.matchType === "code") {
        if (results.has(entry.codeValue)) continue;
        const code = await this.referencePrisma.icd10CmCode.findUnique({
          where: { code_fiscalYear: { code: entry.codeValue, fiscalYear: CURRENT_FISCAL_YEAR } },
        });
        if (code) {
          results.set(code.code, {
            code: code.code,
            shortDescription: code.shortDescription,
            longDescription: code.longDescription,
            isBillable: code.isBillable,
            matchedVia: entry.term,
          });
        }
      } else {
        // 'prefix': the index gave a code STEM requiring more characters
        // (e.g. "I8240-" — "additional character required, see Tabular
        // List"), not a single valid code — expand to the billable codes
        // under that stem, same pattern as the PCS table-stub handling.
        const expansions = await this.referencePrisma.icd10CmCode.findMany({
          where: { fiscalYear: CURRENT_FISCAL_YEAR, isBillable: true, code: { startsWith: entry.codeValue } },
          take: PREFIX_EXPANSION_LIMIT,
        });
        for (const code of expansions) {
          if (results.has(code.code)) continue;
          results.set(code.code, {
            code: code.code,
            shortDescription: code.shortDescription,
            longDescription: code.longDescription,
            isBillable: code.isBillable,
            matchedVia: entry.term,
          });
        }
      }
    }

    return Array.from(results.values()).slice(0, RESULT_LIMIT);
  }

  async searchIcd10Pcs(query: string): Promise<SearchResult<"description">[]> {
    const term = query.trim();
    if (term.length === 0) return [];
    const expandedTerm = await this.terminologyService.expandText(term);

    const [direct, indexEntries] = await Promise.all([
      this.referencePrisma.icd10PcsCode.findMany({
        where: {
          fiscalYear: CURRENT_FISCAL_YEAR,
          OR: [
            { code: { startsWith: term.toUpperCase() } },
            ...(term.length >= MIN_DESCRIPTION_SEARCH_LENGTH
              ? [{ description: { contains: term, mode: "insensitive" as const } }]
              : []),
          ],
        },
        orderBy: { code: "asc" },
        take: RESULT_LIMIT,
      }),
      this.referencePrisma.synonymIndexEntry.findMany({
        where: { codeSystem: "ICD-10-PCS", fiscalYear: CURRENT_FISCAL_YEAR, AND: wordFilters(expandedTerm) },
        take: SYNONYM_TERM_LIMIT,
      }),
    ]);

    const results = new Map<string, SearchResult<"description">>();
    for (const row of direct) {
      results.set(row.code, { code: row.code, description: row.description, isBillable: row.isBillable });
    }

    for (const entry of indexEntries) {
      if (entry.matchType === "code") {
        if (results.has(entry.codeValue)) continue;
        const code = await this.referencePrisma.icd10PcsCode.findUnique({
          where: { code_fiscalYear: { code: entry.codeValue, fiscalYear: CURRENT_FISCAL_YEAR } },
        });
        if (code) {
          results.set(code.code, { code: code.code, description: code.description, isBillable: code.isBillable, matchedVia: entry.term });
        }
      } else {
        // 'prefix': the index points at a table (e.g. "0B9"), not a single code —
        // expand to the billable codes under that table so the coder can pick
        // the specific approach/device, same as a human would from the index.
        const expansions = await this.referencePrisma.icd10PcsCode.findMany({
          where: { fiscalYear: CURRENT_FISCAL_YEAR, isBillable: true, code: { startsWith: entry.codeValue } },
          take: PREFIX_EXPANSION_LIMIT,
        });
        for (const code of expansions) {
          if (results.has(code.code)) continue;
          results.set(code.code, { code: code.code, description: code.description, isBillable: code.isBillable, matchedVia: entry.term });
        }
      }
    }

    return Array.from(results.values()).slice(0, RESULT_LIMIT);
  }
}
