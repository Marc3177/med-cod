import { Injectable } from "@nestjs/common";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import type { CodedDiagnosis, CodedProcedure } from "@med-cod/shared";

export type DrgResult = {
  drg: string;
  description: string;
  severity: "MCC" | "CC" | "NONE";
  isSurgical: boolean;
  /** Which secondary diagnosis (if any) drove the severity tier — shown to
   *  the coder so the DRG isn't a black box, same principle as the encoder's
   *  matchedVia field. */
  severityDrivenBy?: string;
  /** Which procedure (if any) triggered the surgical-DRG override, so a
   *  coder can see why a diagnostic-looking case landed on a surgical DRG
   *  — or why it didn't, if they expected one to. */
  procedureDrivenBy?: string;
} | null;

const SEVERITY_RANK: Record<"MCC" | "CC" | "NONE", number> = { MCC: 2, CC: 1, NONE: 0 };

/**
 * Root operations (ICD-10-PCS position 3) treated as NOT counting as a
 * significant OR procedure in this simplified model: Inspection ('J', purely
 * diagnostic — e.g. a bronchoscopy with no therapeutic action) and Drainage
 * ('9', frequently done at bedside/endoscopically without a true surgical
 * approach in our seed scenarios). The real CMS OR-procedure designation is
 * a per-code list from the Definitions Manual, not a root-operation rule —
 * this is an approximation, not that list.
 */
const NON_OR_ROOT_OPERATIONS = new Set(["9", "J"]);

/** Only the Medical and Surgical section (position 1 = '0') can contain an
 *  OR procedure in this model — Administration, Measurement & Monitoring,
 *  Extracorporeal Assistance (e.g. dialysis), Imaging, etc. never do. */
function isOrProcedure(code: string): boolean {
  const section = code.charAt(0);
  const rootOperation = code.charAt(2);
  return section === "0" && !NON_OR_ROOT_OPERATIONS.has(rootOperation);
}

@Injectable()
export class GrouperService {
  constructor(private readonly referencePrisma: ReferencePrismaService) {}

  /**
   * A deliberately SIMPLIFIED DRG assignment — see seed-drg-reference.ts and
   * the DrgFamily/SurgicalDrgFamily/CcMccFlag schema comments for what this
   * does and does not cover. Returns null when the principal diagnosis
   * doesn't match any curated family, rather than guessing.
   */
  async assignDrg(diagnoses: CodedDiagnosis[], procedures: CodedProcedure[] = []): Promise<DrgResult> {
    const principal = diagnoses.find((d) => d.role === "principal");
    if (!principal) return null;

    const families = await this.referencePrisma.drgFamily.findMany();
    const medicalFamily = families.find((f) => f.dxPrefixes.some((prefix) => principal.code.startsWith(prefix)));
    if (!medicalFamily) return null;

    // A significant OR procedure within the same MDC overrides the medical
    // family — real MS-DRG structure: every MDC splits into a surgical and
    // a medical partition, and surgical always wins when both apply.
    const orProcedures = procedures.filter((p) => isOrProcedure(p.code));
    let selectedFamily: {
      mccDrg: string;
      mccDescription: string;
      ccDrg: string;
      ccDescription: string;
      noCcMccDrg: string;
      noCcMccDescription: string;
    } = medicalFamily;
    let isSurgical = false;
    let procedureDrivenBy: string | undefined;

    if (orProcedures.length > 0) {
      const surgicalFamilies = await this.referencePrisma.surgicalDrgFamily.findMany({
        where: { mdc: medicalFamily.mdc },
      });
      for (const surgicalFamily of surgicalFamilies) {
        const matchingProcedure = orProcedures.find((p) =>
          surgicalFamily.pcsPrefixes.some((prefix) => p.code.startsWith(prefix))
        );
        if (matchingProcedure) {
          selectedFamily = surgicalFamily;
          isSurgical = true;
          procedureDrivenBy = matchingProcedure.code;
          break;
        }
      }
    }

    const secondaryCodes = diagnoses.filter((d) => d.role === "secondary").map((d) => d.code);
    let severity: "MCC" | "CC" | "NONE" = "NONE";
    let severityDrivenBy: string | undefined;

    if (secondaryCodes.length > 0) {
      const flags = await this.referencePrisma.ccMccFlag.findMany({ where: { code: { in: secondaryCodes } } });
      for (const flag of flags) {
        const flagSeverity = flag.severity as "MCC" | "CC";
        if (SEVERITY_RANK[flagSeverity] > SEVERITY_RANK[severity]) {
          severity = flagSeverity;
          severityDrivenBy = flag.code;
        }
      }
    }

    const base = { severity, isSurgical, ...(severityDrivenBy ? { severityDrivenBy } : {}), ...(procedureDrivenBy ? { procedureDrivenBy } : {}) };

    if (severity === "MCC") {
      return { drg: selectedFamily.mccDrg, description: selectedFamily.mccDescription, ...base };
    }
    if (severity === "CC") {
      return { drg: selectedFamily.ccDrg, description: selectedFamily.ccDescription, ...base };
    }
    return { drg: selectedFamily.noCcMccDrg, description: selectedFamily.noCcMccDescription, ...base };
  }
}
