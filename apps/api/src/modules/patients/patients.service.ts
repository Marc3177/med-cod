import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: AppPrismaService) {}

  /** Work queue: encounters the coder can actually act on right now —
   *  excludes FINALIZED (done) and QA_REVIEW (sitting with an auditor;
   *  nothing for the coder to do until it's returned or approved).
   *  Scoped to the requesting user's own facility — this was previously
   *  unscoped, meaning any coder could see every facility's queue, a real
   *  cross-tenant leak caught while exercising multi-facility for real. */
  listWorkQueue(facilityId: number) {
    return this.prisma.encounter.findMany({
      where: { facilityId, status: { notIn: ["FINALIZED", "QA_REVIEW"] } },
      include: { patient: true, facility: true },
      orderBy: { dischargeDate: "asc" },
    });
  }

  /** Same cross-tenant scoping as listWorkQueue — a user from Facility A
   *  requesting an encounter ID that belongs to Facility B gets a 403, not
   *  a 404 (404 would leak that the ID exists at all) and not silent access. */
  async getEncounter(id: number, facilityId: number) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id },
      include: { patient: true, facility: true, documents: true, codingDecision: true },
    });
    if (!encounter) throw new NotFoundException(`encounter ${id} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }
    return encounter;
  }
}
