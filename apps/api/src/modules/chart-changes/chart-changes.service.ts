import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";

export type ChartChange =
  | { type: "NEW_DOCUMENT"; documentId: number; documentType: string; createdAt: string }
  | { type: "CODING_UPDATED"; action: string; byUserId: number; createdAt: string }
  | { type: "QUERY_RESPONDED"; queryId: number; respondedAt: string }
  | { type: "QA_RETURNED"; qaReviewId: number; reason: string | null; reviewedAt: string };

export type ChartChangeSummary = {
  isFirstView: boolean;
  changes: ChartChange[];
};

/**
 * "What's changed since I last looked at this chart" — tracked per user, per
 * encounter, via EncounterView.viewedAt. Reading the diff (getChanges) and
 * advancing the view timestamp (acknowledgeView) are deliberately separate
 * calls: an earlier version did both in one GET, which meant two concurrent
 * requests for the same user (React StrictMode's double effect invocation in
 * dev, a second browser tab, a retried request) could race — the second call
 * would see the first call's freshly-advanced timestamp and silently report
 * no changes, even though neither had actually been shown to the user yet.
 * Keeping getChanges a pure read makes it safe to call any number of times.
 */
@Injectable()
export class ChartChangesService {
  constructor(private readonly prisma: AppPrismaService) {}

  async getChanges(encounterId: number, userId: number, facilityId: number): Promise<ChartChangeSummary> {
    await this.assertEncounterInFacility(encounterId, facilityId);

    const priorView = await this.prisma.encounterView.findUnique({
      where: { encounterId_userId: { encounterId, userId } },
    });

    if (!priorView) {
      return { isFirstView: true, changes: [] };
    }

    const since = priorView.viewedAt;
    const changes: ChartChange[] = [];

    const newDocuments = await this.prisma.clinicalDocument.findMany({
      where: { encounterId, createdAt: { gt: since } },
      orderBy: { createdAt: "asc" },
    });
    for (const doc of newDocuments) {
      changes.push({
        type: "NEW_DOCUMENT",
        documentId: doc.id,
        documentType: doc.type,
        createdAt: doc.createdAt.toISOString(),
      });
    }

    const codingDecision = await this.prisma.codingDecision.findUnique({ where: { encounterId } });
    if (codingDecision) {
      const otherEdits = await this.prisma.auditEntry.findMany({
        where: { codingDecisionId: codingDecision.id, createdAt: { gt: since }, userId: { not: userId } },
        orderBy: { createdAt: "asc" },
      });
      for (const entry of otherEdits) {
        changes.push({
          type: "CODING_UPDATED",
          action: entry.action,
          byUserId: entry.userId,
          createdAt: entry.createdAt.toISOString(),
        });
      }
    }

    const respondedQueries = await this.prisma.query.findMany({
      where: { encounterId, status: "RESPONDED", respondedAt: { gt: since } },
      orderBy: { respondedAt: "asc" },
    });
    for (const query of respondedQueries) {
      changes.push({ type: "QUERY_RESPONDED", queryId: query.id, respondedAt: query.respondedAt!.toISOString() });
    }

    const returnedReviews = await this.prisma.qaReview.findMany({
      where: { encounterId, status: "RETURNED", reviewedAt: { gt: since } },
      orderBy: { reviewedAt: "asc" },
    });
    for (const review of returnedReviews) {
      changes.push({
        type: "QA_RETURNED",
        qaReviewId: review.id,
        reason: review.reason,
        reviewedAt: review.reviewedAt!.toISOString(),
      });
    }

    return { isFirstView: false, changes };
  }

  async acknowledgeView(encounterId: number, userId: number, facilityId: number): Promise<void> {
    await this.assertEncounterInFacility(encounterId, facilityId);

    await this.prisma.encounterView.upsert({
      where: { encounterId_userId: { encounterId, userId } },
      create: { encounterId, userId, viewedAt: new Date() },
      update: { viewedAt: new Date() },
    });
  }

  private async assertEncounterInFacility(encounterId: number, facilityId: number) {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }
  }
}
