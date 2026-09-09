import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { SuggestionsService } from "../suggestions/suggestions.service.js";

const CURRENT_FISCAL_YEAR = 2026;

export type DecisionExplanation = {
  code: string;
  codeSystem: "ICD-10-CM" | "ICD-10-PCS";
  description: string;
  isBillable: boolean;
  checks: {
    /** false when the description itself says "unspecified" — a prompt to
     *  check whether the documentation actually supports something more
     *  specific, not proof that it doesn't. */
    specific: boolean;
    /** Only diagnoses carry CC/MCC severity in this simplified grouper —
     *  always null for ICD-10-PCS. */
    ccMcc: "MCC" | "CC" | null;
  };
  /** Every independent sentence/term match that supports this code across
   *  the whole chart — empty for a code a coder added directly via encoder
   *  search rather than accepting a suggestion, since there's nothing in
   *  the documentation matching it. More than one entry means more than
   *  one document or passage independently supports the same code (e.g.
   *  it's mentioned in both the H&P and the discharge summary). Reuses
   *  SuggestionsService rather than re-deriving evidence, same principle
   *  as Chart Intelligence: one source of truth for what counts as
   *  evidence, not two. */
  evidence: {
    excerpt: string;
    matchedVia: string;
    documentId: number;
    documentType: string;
  }[];
  /** Queries specifically raised about THIS candidate code (via Query's
   *  optional relatedCode/relatedCodeSystem link, set when a query is
   *  raised from a Suggestion) — not every open query on the encounter,
   *  which could easily be about something unrelated. Empty for a code
   *  nobody has queried, or one only ever coded/added directly. */
  relatedQueries: {
    id: number;
    question: string;
    status: string;
  }[];
};

@Injectable()
export class DecisionExplanationService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly referencePrisma: ReferencePrismaService,
    private readonly suggestionsService: SuggestionsService
  ) {}

  async explain(
    encounterId: number,
    facilityId: number,
    code: string,
    codeSystem: "ICD-10-CM" | "ICD-10-PCS"
  ): Promise<DecisionExplanation> {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }

    let description: string;
    let isBillable: boolean;
    let ccMcc: "MCC" | "CC" | null = null;

    if (codeSystem === "ICD-10-CM") {
      const found = await this.referencePrisma.icd10CmCode.findUnique({
        where: { code_fiscalYear: { code, fiscalYear: CURRENT_FISCAL_YEAR } },
      });
      if (!found) throw new BadRequestException(`diagnosis code ${code} does not exist in FY${CURRENT_FISCAL_YEAR} ICD-10-CM`);
      description = found.longDescription;
      isBillable = found.isBillable;

      const flag = await this.referencePrisma.ccMccFlag.findUnique({ where: { code } });
      if (flag) ccMcc = flag.severity as "MCC" | "CC";
    } else if (codeSystem === "ICD-10-PCS") {
      const found = await this.referencePrisma.icd10PcsCode.findUnique({
        where: { code_fiscalYear: { code, fiscalYear: CURRENT_FISCAL_YEAR } },
      });
      if (!found) throw new BadRequestException(`procedure code ${code} does not exist in FY${CURRENT_FISCAL_YEAR} ICD-10-PCS`);
      description = found.description;
      isBillable = found.isBillable;
    } else {
      throw new BadRequestException(`unknown codeSystem ${codeSystem}`);
    }

    const allEvidence = await this.suggestionsService.listAllEvidence(encounterId, facilityId);
    const matchingEvidence = allEvidence.filter((e) => e.code === code && e.codeSystem === codeSystem);

    const relatedQueries = await this.prisma.query.findMany({
      where: { encounterId, relatedCode: code, relatedCodeSystem: codeSystem },
      orderBy: { createdAt: "desc" },
    });

    return {
      code,
      codeSystem,
      description,
      isBillable,
      checks: {
        specific: !description.toLowerCase().includes("unspecified"),
        ccMcc,
      },
      evidence: matchingEvidence.map((e) => ({
        excerpt: e.evidenceExcerpt,
        matchedVia: e.matchedVia,
        documentId: e.documentId,
        documentType: e.documentType,
      })),
      relatedQueries: relatedQueries.map((q) => ({ id: q.id, question: q.question, status: q.status })),
    };
  }
}
