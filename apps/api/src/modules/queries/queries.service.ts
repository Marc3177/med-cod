import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";

@Injectable()
export class QueriesService {
  constructor(private readonly prisma: AppPrismaService) {}

  async listForEncounter(encounterId: number, facilityId: number) {
    await this.assertEncounterExists(encounterId, facilityId);
    return this.prisma.query.findMany({ where: { encounterId }, orderBy: { createdAt: "desc" } });
  }

  /** Everything a provider at their facility currently has to answer — every
   *  SENT query on an encounter at their facility. There's no per-provider
   *  assignment concept yet (see docs/ROADMAP.md Phase 4) — every provider
   *  at a facility sees the same queue, but never another facility's. */
  async listPendingForProvider(facilityId: number) {
    return this.prisma.query.findMany({
      where: { status: "SENT", encounter: { facilityId } },
      include: { encounter: { include: { patient: true } } },
      orderBy: { sentAt: "asc" },
    });
  }

  async create(
    encounterId: number,
    createdById: number,
    facilityId: number,
    question: string,
    clinicalIndicators?: string,
    relatedCode?: string,
    relatedCodeSystem?: string
  ) {
    const encounter = await this.assertEncounterExists(encounterId, facilityId);
    // Real bug found while writing P0 coverage for this state machine (see
    // docs/TEST_REPORT.md): neither create() nor send() checked the
    // encounter's own status, only the query's. send() unconditionally set
    // encounter.status = QUERY_PENDING — on a FINALIZED or QA_REVIEW
    // encounter, that silently un-finalized it / made it reappear in the
    // coder's work queue (which excludes QA_REVIEW) while an auditor's
    // PENDING QaReview for it still existed, i.e. the same chart visible in
    // two queues at once. The CDI query workflow (see the Query model's own
    // schema comment) is part of active coding, not something that starts
    // against a locked, already-reviewed chart — same "not currently
    // editable" principle already enforced by CodingService.finalize()'s
    // FINALIZED/QA_REVIEW guard, applied consistently here.
    if (encounter.status === "FINALIZED" || encounter.status === "QA_REVIEW") {
      throw new BadRequestException(`cannot raise a query on an encounter in status ${encounter.status}`);
    }
    if (question.trim().length === 0) {
      throw new BadRequestException("question cannot be empty");
    }
    return this.prisma.query.create({
      data: {
        encounterId,
        createdById,
        question,
        ...(clinicalIndicators ? { clinicalIndicators } : {}),
        ...(relatedCode && relatedCodeSystem ? { relatedCode, relatedCodeSystem } : {}),
      },
    });
  }

  async send(queryId: number, facilityId: number) {
    const query = await this.assertQueryExists(queryId, facilityId);
    if (query.status !== "DRAFT") {
      throw new BadRequestException(`cannot send a query in status ${query.status}`);
    }
    // Covers a DRAFT query created before the encounter was finalized /
    // sampled into QA_REVIEW — create()'s own guard (see above) only
    // catches the case where the encounter was already locked at draft
    // time, not one that becomes locked while a draft sits unsent.
    if (query.encounter.status === "FINALIZED" || query.encounter.status === "QA_REVIEW") {
      throw new BadRequestException(`cannot send a query on an encounter in status ${query.encounter.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.query.update({
        where: { id: queryId },
        data: { status: "SENT", sentAt: new Date() },
      });
      await tx.encounter.update({
        where: { id: query.encounterId },
        data: { status: "QUERY_PENDING" },
      });
      return updated;
    });
  }

  async respond(queryId: number, respondedById: number, facilityId: number, response: string) {
    const query = await this.assertQueryExists(queryId, facilityId);
    if (query.status !== "SENT") {
      throw new BadRequestException(`cannot respond to a query in status ${query.status}`);
    }
    if (response.trim().length === 0) {
      throw new BadRequestException("response cannot be empty");
    }
    return this.prisma.query.update({
      where: { id: queryId },
      data: { status: "RESPONDED", response, respondedById, respondedAt: new Date() },
    });
  }

  async resolve(queryId: number, resolvedById: number, facilityId: number) {
    const query = await this.assertQueryExists(queryId, facilityId);
    if (query.status !== "RESPONDED") {
      throw new BadRequestException(`cannot resolve a query in status ${query.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.query.update({
        where: { id: queryId },
        data: { status: "RESOLVED", resolvedById, resolvedAt: new Date() },
      });

      // Only move the encounter back to IN_PROGRESS if no other query on it
      // is still open — otherwise resolving one query would wrongly clear
      // QUERY_PENDING while a second query is still awaiting a response.
      const stillOpen = await tx.query.count({
        where: { encounterId: query.encounterId, status: { in: ["DRAFT", "SENT", "RESPONDED"] } },
      });
      if (stillOpen === 0) {
        await tx.encounter.update({
          where: { id: query.encounterId },
          data: { status: "IN_PROGRESS" },
        });
      }

      return updated;
    });
  }

  private async assertEncounterExists(encounterId: number, facilityId: number) {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }
    return encounter;
  }

  private async assertQueryExists(queryId: number, facilityId: number) {
    const query = await this.prisma.query.findUnique({
      where: { id: queryId },
      include: { encounter: true },
    });
    if (!query) throw new NotFoundException(`query ${queryId} not found`);
    if (query.encounter.facilityId !== facilityId) {
      throw new ForbiddenException("query belongs to a different facility");
    }
    return query;
  }
}
