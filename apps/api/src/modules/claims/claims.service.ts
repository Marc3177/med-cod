import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import type { CodedDiagnosis, CodedProcedure } from "@med-cod/shared";

/**
 * The "replace finalize as a dead end with a real handoff" integration point
 * from docs/ROADMAP.md Phase 7. There's no live claims clearinghouse to send
 * to, so this produces the structured data a real one would consume — field
 * names follow standard UB-04/837I institutional-claim concepts (principal
 * vs. secondary diagnosis, POA, attending, DRG) — but this is NOT a
 * certified X12 837 generator; it's the JSON shape a billing system
 * integration would actually be built against as a first step.
 */
@Injectable()
export class ClaimsService {
  constructor(private readonly prisma: AppPrismaService) {}

  async getClaimExport(encounterId: number, facilityId: number) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { patient: true, facility: true, codingDecision: true },
    });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }
    if (encounter.status !== "FINALIZED" || !encounter.codingDecision?.finalizedAt) {
      throw new BadRequestException("only finalized encounters can be exported for claims");
    }

    const diagnoses = encounter.codingDecision.diagnoses as unknown as CodedDiagnosis[];
    const procedures = encounter.codingDecision.procedures as unknown as CodedProcedure[];
    const principal = diagnoses.find((d) => d.role === "principal");

    return {
      claimType: "institutional-inpatient",
      facility: { id: encounter.facility.id, name: encounter.facility.name },
      patient: {
        mrn: encounter.patient.mrn,
        dateOfBirth: encounter.patient.dateOfBirth.toISOString().slice(0, 10),
        sex: encounter.patient.sex,
      },
      admissionDate: encounter.admissionDate.toISOString().slice(0, 10),
      dischargeDate: encounter.dischargeDate?.toISOString().slice(0, 10) ?? null,
      dischargeDisposition: encounter.dischargeDisposition,
      principalDiagnosis: principal ? formatDiagnosis(principal) : null,
      secondaryDiagnoses: diagnoses.filter((d) => d.role === "secondary").map(formatDiagnosis),
      procedures: procedures.map((p) => ({ code: p.code, codeSystem: p.codeSystem })),
      drg: encounter.codingDecision.msDrg
        ? { code: encounter.codingDecision.msDrg, description: encounter.codingDecision.msDrgDescription }
        : null,
      finalizedAt: encounter.codingDecision.finalizedAt.toISOString(),
    };
  }
}

/** Inserts the decimal point real-world ICD-10-CM display uses (e.g. "J189"
 *  -> "J18.9") — codes are stored undotted (see docs/DESIGN.md), the dot is
 *  purely a display/export convention, applied here for the first time
 *  since it matters for a claim a human or downstream system will read. */
function formatDiagnosis(d: CodedDiagnosis) {
  const formattedCode = d.code.length > 3 ? `${d.code.slice(0, 3)}.${d.code.slice(3)}` : d.code;
  return { code: d.code, formattedCode, presentOnAdmission: d.presentOnAdmission };
}
