import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import type { CodedDiagnosis } from "@med-cod/shared";

export type DocumentationGap = {
  indicatorName: string;
  /** The number actually found in the text, e.g. 2.4 for "creatinine 2.4". */
  extractedValue: number;
  unit: string | null;
  /** The sentence the value was found in — the coder always sees the exact
   *  source text, never just a bare number. */
  evidenceExcerpt: string;
  documentId: number;
  documentType: string;
  /** A ready-to-send query question — this is the ONLY thing this feature
   *  ever produces. There is deliberately no `suggestedCode` field on this
   *  type: a lab value alone is never enough to code a diagnosis, and this
   *  module must not become a second, quieter path to the same mistake the
   *  suggestions engine is designed to avoid (see SuggestionsService). */
  suggestedQuery: string;
};

/**
 * Flags lab values documented in the chart that suggest an undocumented
 * condition — "creatinine 2.4 is written down, but nothing in the current
 * coding says kidney disease" — the everyday CDI/coding query trigger this
 * is modeled on. Deliberately produces query SUGGESTIONS only; it is not
 * a second code-suggestion path. See docs/TEST_REPORT.md and the original
 * product discussion this was scoped from: "potential query ≠ diagnosis."
 */
@Injectable()
export class DocumentationGapsService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly referencePrisma: ReferencePrismaService
  ) {}

  async listGaps(encounterId: number, facilityId: number): Promise<DocumentationGap[]> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { documents: true, codingDecision: true },
    });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }

    const codedCodes = getCodedCodes(encounter.codingDecision?.diagnoses);
    const indicators = await this.referencePrisma.clinicalIndicator.findMany();

    const gaps: DocumentationGap[] = [];
    for (const doc of encounter.documents) {
      const sentences = splitIntoSentences(doc.content);
      for (const indicator of indicators) {
        // Already addressed by an existing diagnosis — don't nag the coder
        // about something they've already coded. Prefix match, not exact:
        // related prefix "N17" must match a coded code like "N179", not
        // require the literal string "N17" to be a coded code on its own
        // (which would never happen — N17 alone isn't a billable code).
        const alreadyCoded = indicator.relatedDxPrefixes.some((prefix) =>
          codedCodes.some((code) => code.startsWith(prefix))
        );
        if (alreadyCoded) continue;

        const pattern = new RegExp(`${escapeRegex(indicator.keyword)}[^0-9]{0,20}(\\d+\\.?\\d*)`, "i");
        for (const sentence of sentences) {
          const match = sentence.match(pattern);
          if (!match) continue;
          const value = Number(match[1]);
          if (Number.isNaN(value)) continue;

          const exceeds = indicator.direction === "above" ? value > indicator.threshold : value < indicator.threshold;
          if (!exceeds) continue;

          gaps.push({
            indicatorName: indicator.name,
            extractedValue: value,
            unit: indicator.unit,
            evidenceExcerpt: sentence,
            documentId: doc.id,
            documentType: doc.type,
            suggestedQuery: indicator.queryTemplate.replace("{value}", String(value)),
          });
          break; // one flag per indicator per document is enough
        }
      }
    }

    return gaps;
  }
}

function getCodedCodes(diagnosesJson: unknown): string[] {
  if (!diagnosesJson) return [];
  return (diagnosesJson as CodedDiagnosis[]).map((dx) => dx.code);
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
