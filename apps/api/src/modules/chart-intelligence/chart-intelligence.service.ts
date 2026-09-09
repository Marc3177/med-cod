import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { SuggestionsService } from "../suggestions/suggestions.service.js";
import { DocumentationGapsService } from "../documentation-gaps/documentation-gaps.service.js";
import type { CodedDiagnosis, CodedProcedure } from "@med-cod/shared";

const CURRENT_FISCAL_YEAR = 2026;

export type ChartFinding = {
  code: string;
  codeSystem: "ICD-10-CM" | "ICD-10-PCS";
  description: string;
};

export type ChartPotentialFinding = ChartFinding & {
  evidenceExcerpt: string;
  documentId: number;
  matchedVia: string;
};

export type ChartSummary = {
  documentCount: number;
  /** Already coded on this encounter — the "confirmed" list. */
  confirmedFindings: ChartFinding[];
  /** From the suggestions engine, not yet accepted — each one still points
   *  at its own evidence sentence and source document, same as the
   *  suggestions panel itself; this is a summary view over the same data,
   *  not a separate extraction. */
  potentialFindings: ChartPotentialFinding[];
  documentationGapCount: number;
};

/**
 * A chart-overview aggregation — deliberately NOT a new extraction engine.
 * Every fact here comes from SuggestionsService (dictionary-matched
 * candidates) and DocumentationGapsService (lab-value gaps), both already
 * built and independently tested; this module only combines and summarizes
 * what they already produce, so a coder can see "what's going on with this
 * chart" before reading the full documentation panel. If either underlying
 * service's matching quality is wrong, this summary will be too — that's
 * intentional: one source of truth, not two.
 */
@Injectable()
export class ChartIntelligenceService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly referencePrisma: ReferencePrismaService,
    private readonly suggestionsService: SuggestionsService,
    private readonly documentationGapsService: DocumentationGapsService
  ) {}

  async getSummary(encounterId: number, facilityId: number): Promise<ChartSummary> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { documents: true, codingDecision: true },
    });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }

    const [suggestions, gaps] = await Promise.all([
      this.suggestionsService.listActiveSuggestions(encounterId, facilityId),
      this.documentationGapsService.listGaps(encounterId, facilityId),
    ]);

    const codedDiagnoses = (encounter.codingDecision?.diagnoses as unknown as CodedDiagnosis[] | undefined) ?? [];
    const codedProcedures = (encounter.codingDecision?.procedures as unknown as CodedProcedure[] | undefined) ?? [];
    const codedCodeSet = new Set([...codedDiagnoses.map((d) => d.code), ...codedProcedures.map((p) => p.code)]);

    const confirmedFindings: ChartFinding[] = [];
    for (const dx of codedDiagnoses) {
      const code = await this.referencePrisma.icd10CmCode.findUnique({
        where: { code_fiscalYear: { code: dx.code, fiscalYear: CURRENT_FISCAL_YEAR } },
      });
      confirmedFindings.push({ code: dx.code, codeSystem: "ICD-10-CM", description: code?.longDescription ?? dx.code });
    }
    for (const px of codedProcedures) {
      const code = await this.referencePrisma.icd10PcsCode.findUnique({
        where: { code_fiscalYear: { code: px.code, fiscalYear: CURRENT_FISCAL_YEAR } },
      });
      confirmedFindings.push({ code: px.code, codeSystem: "ICD-10-PCS", description: code?.description ?? px.code });
    }

    const potentialFindings: ChartPotentialFinding[] = suggestions
      .filter((s) => !codedCodeSet.has(s.code))
      .map((s) => ({
        code: s.code,
        codeSystem: s.codeSystem,
        description: s.description,
        evidenceExcerpt: s.evidenceExcerpt,
        documentId: s.documentId,
        matchedVia: s.matchedVia,
      }));

    return {
      documentCount: encounter.documents.length,
      confirmedFindings,
      potentialFindings,
      documentationGapCount: gaps.length,
    };
  }
}
