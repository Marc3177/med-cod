import { Injectable } from "@nestjs/common";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";

export type ClinicalAlias = { alias: string; expansion: string };

/**
 * Expands clinical abbreviations (see ClinicalAlias / seed-clinical-aliases.ts)
 * into the spelled-out term the ICD-10-CM/PCS Alphabetic Index actually
 * contains — fixes the "COPD returns zero results" gap from the Phase 1-7
 * end-to-end test pass (docs/TEST_REPORT.md). Used to build the text that
 * *matching* logic runs against, in both directions:
 *   - encoder search: a coder types "COPD" -> matched against the index as
 *     if they'd typed "chronic obstructive pulmonary disease".
 *   - suggestions: a note says "COPD" -> checked against index terms as if
 *     it said the full phrase.
 * Never used for what's actually displayed — evidence excerpts and search
 * boxes always show the coder's or the chart's own original text.
 */
@Injectable()
export class TerminologyService {
  constructor(private readonly referencePrisma: ReferencePrismaService) {}

  /** For callers expanding many texts in a loop (e.g. one per sentence) —
   *  fetch the alias list once, then call expandWithAliases per text,
   *  instead of hitting the DB on every call like expandText does. */
  async loadAliases(): Promise<ClinicalAlias[]> {
    const rows = await this.referencePrisma.clinicalAlias.findMany();
    // Longest alias first so a multi-word alias (e.g. "GI BLEED") is matched
    // whole before a shorter one that might otherwise partially overlap it.
    return rows.map((r) => ({ alias: r.alias, expansion: r.expansion })).sort((a, b) => b.alias.length - a.alias.length);
  }

  async expandText(text: string): Promise<string> {
    const aliases = await this.loadAliases();
    return expandWithAliases(text, aliases);
  }
}

/**
 * Pure function so it can run in a tight loop (once per sentence) without a
 * DB round-trip each time — see loadAliases(). Replaces, not appends: e.g.
 * the encoder's word-match search treats the expanded text as a set of
 * required words, so leaving "COPD" itself in the text would require the
 * literal substring "copd" in the matched term, which no real term
 * contains, silently breaking the very match this exists to enable.
 */
export function expandWithAliases(text: string, aliases: ClinicalAlias[]): string {
  let expanded = text;
  for (const { alias, expansion } of aliases) {
    const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, "gi");
    expanded = expanded.replace(pattern, expansion);
  }
  return expanded;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
