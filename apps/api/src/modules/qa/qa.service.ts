import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";

/** Fraction of newly-finalized encounters flagged for QA review. Set high
 *  for this MVP so the workflow is actually exercisable in a small seed
 *  dataset — a real deployment would tune this much lower (a few percent). */
const SAMPLING_RATE = 0.5;

@Injectable()
export class QaService {
  constructor(private readonly prisma: AppPrismaService) {}

  /**
   * Called right after an encounter is finalized (see CodingService.finalize).
   * Randomly samples it into QA — does nothing most of the time by design,
   * mirroring real QA sampling rather than reviewing every case.
   */
  async maybeSampleForReview(encounterId: number): Promise<void> {
    if (Math.random() >= SAMPLING_RATE) return;

    await this.prisma.$transaction([
      this.prisma.qaReview.create({ data: { encounterId } }),
      this.prisma.encounter.update({ where: { id: encounterId }, data: { status: "QA_REVIEW" } }),
    ]);
  }

  async listForEncounter(encounterId: number, facilityId: number) {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }
    return this.prisma.qaReview.findMany({ where: { encounterId }, orderBy: { createdAt: "desc" } });
  }

  /** Every review still awaiting an auditor's decision at their own facility
   *  — same "minimal shared queue, no per-auditor assignment" simplification
   *  used for the provider query queue, and same facility scoping. */
  listPendingForAuditor(facilityId: number) {
    return this.prisma.qaReview.findMany({
      where: { status: "PENDING", encounter: { facilityId } },
      include: { encounter: { include: { patient: true, codingDecision: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async approve(reviewId: number, reviewedById: number, facilityId: number) {
    const review = await this.assertReviewExists(reviewId, facilityId);
    if (review.status !== "PENDING") {
      throw new BadRequestException(`cannot approve a review in status ${review.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.qaReview.update({
        where: { id: reviewId },
        data: { status: "APPROVED", reviewedById, reviewedAt: new Date() },
      });
      // Sampling moved the encounter to QA_REVIEW (see maybeSampleForReview)
      // — approval restores it to FINALIZED, the state it was actually in
      // before sampling picked it up.
      await tx.encounter.update({
        where: { id: review.encounterId },
        data: { status: "FINALIZED" },
      });
      return updated;
    });
  }

  async returnToCoder(reviewId: number, reviewedById: number, facilityId: number, reason: string) {
    const review = await this.assertReviewExists(reviewId, facilityId);
    if (review.status !== "PENDING") {
      throw new BadRequestException(`cannot return a review in status ${review.status}`);
    }
    if (reason.trim().length === 0) {
      throw new BadRequestException("a reason is required to return an encounter to the coder");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.qaReview.update({
        where: { id: reviewId },
        data: { status: "RETURNED", reason, reviewedById, reviewedAt: new Date() },
      });
      await tx.encounter.update({
        where: { id: review.encounterId },
        data: { status: "IN_PROGRESS" },
      });
      return updated;
    });
  }

  private async assertReviewExists(reviewId: number, facilityId: number) {
    const review = await this.prisma.qaReview.findUnique({
      where: { id: reviewId },
      include: { encounter: true },
    });
    if (!review) throw new NotFoundException(`QA review ${reviewId} not found`);
    if (review.encounter.facilityId !== facilityId) {
      throw new ForbiddenException("QA review belongs to a different facility");
    }
    return review;
  }
}
