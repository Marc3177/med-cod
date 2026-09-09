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

    const encounter = await this.assertEncounterExists(encounterId, facilityId);
    // A third, more severe instance of the same bug class as finalize()'s
    // and QueriesService's FINALIZED/QA_REVIEW guards — found while
    // investigating the QA lifecycle, not by manual testing. Without this
    // check, saveDraft() silently overwrote the coding decision an auditor
    // was actively reviewing AND unconditionally set encounter.status to
    // IN_PROGRESS below — bypassing the pending QaReview entirely, so the
    // review the auditor eventually acts on could reference stale, already-
    // replaced coding data. Same principle applied a third time: FINALIZED
    // and QA_REVIEW are not currently editable by the coder; the only
    // legitimate paths out are finalize()'s own re-finalization (after a
    // QA return moves the encounter back to IN_PROGRESS) or the auditor's
    // approve/return actions.
    if (encounter.status === "FINALIZED" || encounter.status === "QA_REVIEW") {
      throw new BadRequestException(`cannot save coding for an encounter in status ${encounter.status}`);
    }
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
    // FINALIZED and QA_REVIEW are both "already finalized, not currently
    // editable" from the coder's side — QA_REVIEW means it's actively
    // sitting with an auditor. Real bug found while writing P0 coverage
    // for this state machine: this check only excluded FINALIZED, so a
    // second finalize() call while an encounter sat in QA_REVIEW silently
    // succeeded — overwriting the coding decision the auditor was
    // reviewing and re-triggering QA sampling on top of the pending
    // review, rather than being rejected the way it should be. The only
    // legitimate way out of QA_REVIEW is the auditor's approve/return
    // (RETURNED moves the encounter back to IN_PROGRESS, where finalize()
    // is correctly allowed again for the recode-and-refinalize loop).
    if (encounter.status === "FINALIZED" || encounter.status === "QA_REVIEW") {
      throw new BadRequestException(`cannot finalize an encounter in status ${encounter.status}`);
    }

    // Business-rule decision (not a bug fix like the guard above — this is
    // a deliberate product choice, made explicitly rather than inferred):
    // an encounter cannot be finalized while any query on it is still
    // open. Deliberately checks the actual Query rows (DRAFT/SENT/
    // RESPONDED), not the encounter's derived QUERY_PENDING status — the
    // real invariant is about unresolved queries, not the status field
    // that happens to reflect them today; checking the rows directly also
    // means this stays correct even if encounter.status were ever wrong
    // (e.g. a future bug leaving it at IN_PROGRESS while a query is still
    // open). RESPONDED (not just DRAFT/SENT) is included on purpose: a
    // provider's response can contain documentation that changes the
    // coding decision, and the coder hasn't reviewed/resolved it yet.
    const openQueryCount = await this.prisma.query.count({
      where: { encounterId, status: { in: ["DRAFT", "SENT", "RESPONDED"] } },
    });
    if (openQueryCount > 0) {
      throw new BadRequestException(
        `cannot finalize an encounter with ${openQueryCount} unresolved ${openQueryCount === 1 ? "query" : "queries"}`
      );
    }

    const diagnoses = codingDecision.diagnoses as unknown as CodedDiagnosis[];
    const procedures = codingDecision.procedures as unknown as CodedProcedure[];
    const drgResult = await this.grouperService.assignDrg(diagnoses, procedures);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Race found by genuine-concurrency testing (Promise.all of two real
      // finalize() calls against the same encounter, not a constructed
      // state): the "already finalized" check above reads encounter.status
      // in a separate query, before this transaction starts — two
      // concurrent finalize() calls can both read IN_PROGRESS and both pass
      // that check before either commits, producing two FINALIZE audit
      // entries (and, worse, two independent maybeSampleForReview() calls
      // that could each sample and create their own QaReview). This
      // violates the exact invariant the sequential guard above already
      // establishes ("cannot finalize an already-finalized encounter"), so
      // it's a bug under that invariant, not a new business decision.
      // Fixed with a conditional update as the transaction's first
      // operation: updateMany's WHERE clause (status not already
      // FINALIZED/QA_REVIEW) is evaluated atomically by Postgres as part of
      // the single UPDATE statement, so exactly one concurrent caller can
      // ever flip it — the loser's count is 0, and it aborts the whole
      // transaction before writing anything, the same way the pre-check
      // above rejects the sequential case.
      const lockResult = await tx.encounter.updateMany({
        where: { id: encounterId, status: { notIn: ["FINALIZED", "QA_REVIEW"] } },
        data: { status: "FINALIZED" },
      });
      if (lockResult.count === 0) {
        throw new BadRequestException("cannot finalize an encounter in status FINALIZED or QA_REVIEW");
      }

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
