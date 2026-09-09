import { BadRequestException, Injectable } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";

/**
 * Ingests a real FHIR R4 Bundle (Patient + Encounter + DocumentReference
 * resources) — this is the "replace manual document entry with a real feed"
 * integration point from docs/ROADMAP.md Phase 7. There's no live EHR to
 * connect to in this environment, but the parsing here follows the actual
 * FHIR R4 spec (intra-bundle fullUrl references, base64 DocumentReference
 * attachment content) so a real EHR export — including Synthea's synthetic
 * FHIR output — would work against it unmodified.
 *
 * Deliberately NOT a full FHIR validator (no such library is installed) —
 * this is a pragmatic subset covering the fields this app actually uses,
 * with every resource validated before any DB write (same validate-then-
 * write discipline as the CMS bulk importers).
 */
@Injectable()
export class FhirService {
  constructor(private readonly prisma: AppPrismaService) {}

  async ingestBundle(bundle: unknown, facilityId: number) {
    const entries = extractEntries(bundle);

    // Build a reference-resolution map: FHIR intra-bundle references point
    // at an entry's fullUrl (e.g. "urn:uuid:abc") or "ResourceType/id".
    const byReference = new Map<string, FhirResource>();
    for (const entry of entries) {
      if (entry.fullUrl) byReference.set(entry.fullUrl, entry.resource);
      if (entry.resource.id) byReference.set(`${entry.resource.resourceType}/${entry.resource.id}`, entry.resource);
    }

    const patientResources = entries.filter((e) => e.resource.resourceType === "Patient");
    const encounterResources = entries.filter((e) => e.resource.resourceType === "Encounter");
    const documentResources = entries.filter((e) => e.resource.resourceType === "DocumentReference");

    if (patientResources.length === 0 || encounterResources.length === 0) {
      throw new BadRequestException("bundle must contain at least one Patient and one Encounter resource");
    }

    const parsedPatients = patientResources.map((e) => parsePatient(e.resource, e.fullUrl));
    const parsedEncounters = encounterResources.map((e) => parseEncounter(e.resource, e.fullUrl, byReference));
    const parsedDocuments = documentResources.map((e) => parseDocumentReference(e.resource, byReference));

    const created = { patients: 0, encounters: 0, documents: 0 };

    await this.prisma.$transaction(async (tx) => {
      const patientIdByRef = new Map<string, number>();

      for (const p of parsedPatients) {
        const patient = await tx.patient.upsert({
          where: { mrn: p.mrn },
          update: {},
          create: { mrn: p.mrn, dateOfBirth: p.dateOfBirth, sex: p.sex },
        });
        patientIdByRef.set(p.reference, patient.id);
        created.patients++;
      }

      const encounterIdByRef = new Map<string, number>();

      for (const e of parsedEncounters) {
        const patientId = patientIdByRef.get(e.patientReference);
        if (!patientId) {
          throw new BadRequestException(
            `Encounter references patient "${e.patientReference}" which is not in this bundle`
          );
        }
        const encounter = await tx.encounter.create({
          data: {
            patientId,
            facilityId,
            admissionDate: e.admissionDate,
            dischargeDate: e.dischargeDate,
            admittingDiagnosis: e.admittingDiagnosis,
            status: "NEW",
          },
        });
        encounterIdByRef.set(e.reference, encounter.id);
        created.encounters++;
      }

      for (const d of parsedDocuments) {
        const encounterId = encounterIdByRef.get(d.encounterReference);
        if (!encounterId) {
          throw new BadRequestException(
            `DocumentReference references encounter "${d.encounterReference}" which is not in this bundle`
          );
        }
        await tx.clinicalDocument.create({
          data: { encounterId, type: d.type, content: d.content },
        });
        created.documents++;
      }
    });

    return created;
  }
}

// ---- FHIR shape parsing (deliberately loose typing — resources are
// externally-supplied JSON we don't control the shape of) ----

type FhirResource = { resourceType: string; id?: string; [key: string]: unknown };
type FhirEntry = { fullUrl?: string; resource: FhirResource };

function extractEntries(bundle: unknown): FhirEntry[] {
  if (typeof bundle !== "object" || bundle === null) {
    throw new BadRequestException("bundle must be a JSON object");
  }
  const b = bundle as { resourceType?: unknown; entry?: unknown };
  if (b.resourceType !== "Bundle") {
    throw new BadRequestException('bundle.resourceType must be "Bundle"');
  }
  if (!Array.isArray(b.entry)) {
    throw new BadRequestException("bundle.entry must be an array");
  }
  return b.entry.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).resource !== "object") {
      throw new BadRequestException(`bundle.entry[${index}] is missing a resource`);
    }
    const entry = raw as { fullUrl?: unknown; resource: FhirResource };
    if (typeof entry.resource.resourceType !== "string") {
      throw new BadRequestException(`bundle.entry[${index}].resource.resourceType is required`);
    }
    return {
      ...(typeof entry.fullUrl === "string" ? { fullUrl: entry.fullUrl } : {}),
      resource: entry.resource,
    };
  });
}

function parsePatient(resource: FhirResource, fullUrl: string | undefined) {
  const identifiers = resource.identifier as { value?: string }[] | undefined;
  const mrn = identifiers?.[0]?.value;
  const dateOfBirth = resource.birthDate as string | undefined;
  const genderRaw = resource.gender as string | undefined;

  if (!mrn) throw new BadRequestException("Patient.identifier[0].value (MRN) is required");
  if (!dateOfBirth) throw new BadRequestException(`Patient ${mrn}: birthDate is required`);

  const sex = genderRaw === "male" ? "M" : genderRaw === "female" ? "F" : "U";
  // Other resources reference this Patient by whichever of these the bundle
  // actually used — fullUrl (the common case, e.g. "urn:uuid:...") takes
  // priority over "ResourceType/id", with the MRN itself as a last resort.
  const reference = fullUrl ?? (resource.id ? `Patient/${resource.id}` : mrn);

  return { reference, mrn, dateOfBirth: new Date(dateOfBirth), sex };
}

function parseEncounter(resource: FhirResource, fullUrl: string | undefined, byReference: Map<string, FhirResource>) {
  const subject = resource.subject as { reference?: string } | undefined;
  const patientReference = subject?.reference;
  if (!patientReference) throw new BadRequestException("Encounter.subject.reference is required");
  if (!byReference.has(patientReference)) {
    throw new BadRequestException(`Encounter.subject.reference "${patientReference}" not found in bundle`);
  }

  const period = resource.period as { start?: string; end?: string } | undefined;
  if (!period?.start) throw new BadRequestException("Encounter.period.start is required");

  const reasonCode = resource.reasonCode as { text?: string }[] | undefined;
  const admittingDiagnosis = reasonCode?.[0]?.text;

  // Same priority ordering as parsePatient — this is what a
  // DocumentReference.context.encounter[0].reference will actually match.
  const reference = fullUrl ?? (resource.id ? `Encounter/${resource.id}` : patientReference);

  return {
    reference,
    patientReference,
    admissionDate: new Date(period.start),
    dischargeDate: period.end ? new Date(period.end) : null,
    admittingDiagnosis: admittingDiagnosis ?? null,
  };
}

function parseDocumentReference(resource: FhirResource, byReference: Map<string, FhirResource>) {
  const context = resource.context as { encounter?: { reference?: string }[] } | undefined;
  const encounterReference = context?.encounter?.[0]?.reference;
  if (!encounterReference) throw new BadRequestException("DocumentReference.context.encounter[0].reference is required");
  if (!byReference.has(encounterReference)) {
    throw new BadRequestException(`DocumentReference.context.encounter reference "${encounterReference}" not found in bundle`);
  }

  const typeText = (resource.type as { text?: string } | undefined)?.text ?? "CLINICAL_NOTE";
  const content = resource.content as { attachment?: { data?: string; contentType?: string } }[] | undefined;
  const attachment = content?.[0]?.attachment;
  if (!attachment?.data) {
    throw new BadRequestException("DocumentReference.content[0].attachment.data (base64) is required");
  }

  let decoded: string;
  try {
    decoded = Buffer.from(attachment.data, "base64").toString("utf-8");
  } catch {
    throw new BadRequestException("DocumentReference.content[0].attachment.data is not valid base64");
  }
  if (decoded.trim().length === 0) {
    throw new BadRequestException("DocumentReference attachment decoded to empty content");
  }

  return {
    encounterReference,
    type: typeText.toUpperCase().replaceAll(" ", "_"),
    content: decoded,
  };
}
