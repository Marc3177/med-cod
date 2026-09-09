import { Injectable } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import type { CodedDiagnosis } from "@med-cod/shared";

const CURRENT_FISCAL_YEAR = 2026;

export type ReportingSummary = {
  /**
   * The north-star metric from docs/OVERVIEW.md: % of currently-finalized
   * encounters that were never sent back by QA. This is a real, computed
   * proxy for "would pass billing edits without rework" — we don't have a
   * billing-edit system, but a QA return IS documented rework, so it's a
   * legitimate stand-in, not an invented number.
   */
  firstPassAcceptanceRate: number | null;
  finalizedEncounterCount: number;

  qa: {
    totalReviews: number;
    approved: number;
    returned: number;
    pending: number;
    returnRate: number | null;
  };

  queries: {
    total: number;
    byStatus: Record<string, number>;
    /** Average hours from sentAt to respondedAt, across queries that have
     *  actually been responded to. Null if none have. */
    avgTurnaroundHours: number | null;
  };

  /** Finalizations per coder — a real count from CodingDecision, not an
   *  invented productivity score. */
  coderProductivity: { userId: number; email: string; finalizedCount: number }[];

  /**
   * % of finalized diagnosis codes whose official description is NOT an
   * "unspecified" variant — a real, computed proxy for coding specificity
   * (e.g. J189 "Pneumonia, unspecified organism" counts against the rate;
   * a fully specified organism-coded pneumonia would not). Approximate —
   * "unspecified" in the text is a heuristic, not the official CMS
   * specificity-measurement methodology, which doesn't publicly exist as a
   * single number like this.
   */
  specificityCaptureRate: number | null;

  /** Simple pipeline workload view — count of encounters per status. Not a
   *  per-coder assignment view (no assignment concept exists in the schema
   *  yet — see docs/ROADMAP.md Phase 6 note), but real, current counts. */
  workloadByStatus: Record<string, number>;
};

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly referencePrisma: ReferencePrismaService
  ) {}

  /** Scoped to the requesting supervisor's own facility throughout — a
   *  supervisor at Facility A should never see Facility B's coder
   *  productivity or QA outcomes. */
  async getSummary(facilityId: number): Promise<ReportingSummary> {
    const [
      finalizedEncounters,
      qaReviews,
      queries,
      finalizedDecisions,
      encounterStatusCounts,
      users,
    ] = await Promise.all([
      this.prisma.encounter.findMany({ where: { status: "FINALIZED", facilityId }, select: { id: true } }),
      this.prisma.qaReview.findMany({
        where: { encounter: { facilityId } },
        select: { encounterId: true, status: true },
      }),
      this.prisma.query.findMany({
        where: { encounter: { facilityId } },
        select: { status: true, sentAt: true, respondedAt: true },
      }),
      this.prisma.codingDecision.findMany({
        where: { finalizedAt: { not: null }, encounter: { facilityId } },
        select: { diagnoses: true, finalizedById: true },
      }),
      this.prisma.encounter.groupBy({ by: ["status"], where: { facilityId }, _count: { _all: true } }),
      this.prisma.user.findMany({ where: { facilityId }, select: { id: true, email: true } }),
    ]);

    const firstPassAcceptanceRate = computeFirstPassAcceptanceRate(finalizedEncounters, qaReviews);
    const qa = summarizeQa(qaReviews);
    const queryStats = summarizeQueries(queries);
    const coderProductivity = summarizeCoderProductivity(finalizedDecisions, users);
    const specificityCaptureRate = await this.computeSpecificityCaptureRate(finalizedDecisions);
    const workloadByStatus = Object.fromEntries(
      encounterStatusCounts.map((row) => [row.status, row._count._all])
    );

    return {
      firstPassAcceptanceRate,
      finalizedEncounterCount: finalizedEncounters.length,
      qa,
      queries: queryStats,
      coderProductivity,
      specificityCaptureRate,
      workloadByStatus,
    };
  }

  private async computeSpecificityCaptureRate(
    finalizedDecisions: { diagnoses: unknown }[]
  ): Promise<number | null> {
    const allCodes = finalizedDecisions.flatMap((d) => (d.diagnoses as unknown as CodedDiagnosis[]).map((dx) => dx.code));
    if (allCodes.length === 0) return null;

    const uniqueCodes = Array.from(new Set(allCodes));
    const refRows = await this.referencePrisma.icd10CmCode.findMany({
      where: { code: { in: uniqueCodes }, fiscalYear: CURRENT_FISCAL_YEAR },
      select: { code: true, longDescription: true },
    });
    const descriptionByCode = new Map(refRows.map((r) => [r.code, r.longDescription]));

    let specificCount = 0;
    for (const code of allCodes) {
      const description = descriptionByCode.get(code);
      if (description && !description.toLowerCase().includes("unspecified")) {
        specificCount++;
      }
    }
    return specificCount / allCodes.length;
  }
}

function computeFirstPassAcceptanceRate(
  finalizedEncounters: { id: number }[],
  qaReviews: { encounterId: number; status: string }[]
): number | null {
  if (finalizedEncounters.length === 0) return null;
  const everReturned = new Set(qaReviews.filter((r) => r.status === "RETURNED").map((r) => r.encounterId));
  const cleanCount = finalizedEncounters.filter((e) => !everReturned.has(e.id)).length;
  return cleanCount / finalizedEncounters.length;
}

function summarizeQa(qaReviews: { status: string }[]) {
  const totalReviews = qaReviews.length;
  const approved = qaReviews.filter((r) => r.status === "APPROVED").length;
  const returned = qaReviews.filter((r) => r.status === "RETURNED").length;
  const pending = qaReviews.filter((r) => r.status === "PENDING").length;
  const decided = approved + returned;
  return { totalReviews, approved, returned, pending, returnRate: decided > 0 ? returned / decided : null };
}

function summarizeQueries(queries: { status: string; sentAt: Date | null; respondedAt: Date | null }[]) {
  const byStatus: Record<string, number> = {};
  for (const q of queries) {
    byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
  }

  const turnaroundHours = queries
    .filter((q) => q.sentAt && q.respondedAt)
    .map((q) => (q.respondedAt!.getTime() - q.sentAt!.getTime()) / (1000 * 60 * 60));

  const avgTurnaroundHours =
    turnaroundHours.length > 0 ? turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length : null;

  return { total: queries.length, byStatus, avgTurnaroundHours };
}

function summarizeCoderProductivity(
  finalizedDecisions: { finalizedById: number | null }[],
  users: { id: number; email: string }[]
) {
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const countByUserId = new Map<number, number>();
  for (const decision of finalizedDecisions) {
    if (decision.finalizedById === null) continue;
    countByUserId.set(decision.finalizedById, (countByUserId.get(decision.finalizedById) ?? 0) + 1);
  }
  return Array.from(countByUserId.entries())
    .map(([userId, finalizedCount]) => ({ userId, email: emailById.get(userId) ?? "(deleted user)", finalizedCount }))
    .sort((a, b) => b.finalizedCount - a.finalizedCount);
}
