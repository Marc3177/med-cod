import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { GrouperService } from "../grouper/grouper.service.js";
import { QaService } from "../qa/qa.service.js";
import { CodingDecisionSchema, type CodingDecision, type CodedDiagnosis, type CodedProcedure } from "@med-cod/shared";

const CURRENT_FISCAL_YEAR = 2026;

@Injectable()
export class CodingService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly referencePrisma: ReferencePrismaService,
    private readonly grouperService: GrouperService,
    private readonly qaService: QaService
  ) {}

  /**
   * Validates and saves a coding decision as a draft (does not finalize).
   * Every code is checked against the reference DB — a code that doesn't
   * exist, or exists but isn't billable (e.g. a category header), is
   * rejected before anything is written. Nothing here silently accepts
   * a bad code just because the Zod shape check passed.
   */
  async saveDraft(encounterId: number, userId: number, facilityId: number, input: unknown) {
    const parsed = CodingDecisionSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const decision = parsed.data;

    if (decision.encounterId !== encounterId) {
      throw new BadRequestException("encounterId in body does not match URL");
    }

    await this.assertEncounterExists(encounterId, facilityId);
    await this.assertCodesAreValid(decision);

    const existing = await this.prisma.codingDecision.findUnique({ where: { encounterId } });

    const saved = await this.prisma.$transaction(async (tx) => {
      const codingDecision = await tx.codingDecision.upsert({
        where: { encounterId },
        create: {
          encounterId,
          diagnoses: decision.diagnoses,
          procedures: decision.procedures,
        },
        update: {
          diagnoses: decision.diagnoses,
          procedures: decision.procedures,
        },
      });

      await tx.auditEntry.create({
        data: {
          codingDecisionId: codingDecision.id,
          userId,
          action: existing ? "UPDATE_DRAFT" : "CREATE_DRAFT",
          ...(existing ? { before: { diagnoses: existing.diagnoses, procedures: existing.procedures } } : {}),
          after: { diagnoses: decision.diagnoses, procedures: decision.procedures },
        },
      });

      await tx.encounter.update({
        where: { id: encounterId },
        data: { status: "IN_PROGRESS" },
      });

      return codingDecision;
    });

    return saved;
  }

  async finalize(encounterId: number, userId: number, facilityId: number) {
    const encounter = await this.assertEncounterExists(encounterId, facilityId);
    const codingDecision = await this.prisma.codingDecision.findUnique({ where: { encounterId } });
    if (!codingDecision) {
      throw new BadRequestException("cannot finalize an encounter with no coding decision saved");
    }
    if (encounter.status === "FINALIZED") {
      throw new BadRequestException("encounter is already finalized");
    }

    const diagnoses = codingDecision.diagnoses as unknown as CodedDiagnosis[];
    const procedures = codingDecision.procedures as unknown as CodedProcedure[];
    const drgResult = await this.grouperService.assignDrg(diagnoses, procedures);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.codingDecision.update({
        where: { encounterId },
        data: {
          finalizedAt: new Date(),
          finalizedById: userId,
          msDrg: drgResult?.drg ?? null,
          msDrgDescription: drgResult?.description ?? null,
        },
      });

      await tx.auditEntry.create({
        data: {
          codingDecisionId: codingDecision.id,
          userId,
          action: "FINALIZE",
          after: { diagnoses: codingDecision.diagnoses, procedures: codingDecision.procedures },
        },
      });

      await tx.encounter.update({
        where: { id: encounterId },
        data: { status: "FINALIZED" },
      });

      return result;
    });

    // Runs after the finalize transaction commits — QA sampling is its own
    // concern with its own transaction (see QaService), not part of the
    // finalize write itself.
    await this.qaService.maybeSampleForReview(encounterId);

    return updated;
  }

  private async assertEncounterExists(encounterId: number, facilityId: number) {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }
    return encounter;
  }

  private async assertCodesAreValid(decision: CodingDecision) {
    const errors: string[] = [];

    for (const dx of decision.diagnoses) {
      const found = await this.referencePrisma.icd10CmCode.findUnique({
        where: { code_fiscalYear: { code: dx.code, fiscalYear: CURRENT_FISCAL_YEAR } },
      });
      if (!found) errors.push(`diagnosis code ${dx.code} does not exist in FY${CURRENT_FISCAL_YEAR} ICD-10-CM`);
      else if (!found.isBillable) errors.push(`diagnosis code ${dx.code} is a category header, not billable`);
    }

    for (const px of decision.procedures) {
      const found = await this.referencePrisma.icd10PcsCode.findUnique({
        where: { code_fiscalYear: { code: px.code, fiscalYear: CURRENT_FISCAL_YEAR } },
      });
      if (!found) errors.push(`procedure code ${px.code} does not exist in FY${CURRENT_FISCAL_YEAR} ICD-10-PCS`);
      else if (!found.isBillable) errors.push(`procedure code ${px.code} is a table header, not billable`);
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
  }
}
