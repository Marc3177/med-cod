export type Encounter = {
  id: number;
  patientId: number;
  facilityId: number;
  admissionDate: string;
  dischargeDate: string | null;
  admittingDiagnosis: string | null;
  status: "NEW" | "IN_PROGRESS" | "QUERY_PENDING" | "QA_REVIEW" | "FINALIZED";
  patient: { id: number; mrn: string; dateOfBirth: string; sex: string };
  facility: { id: number; name: string };
};

export type ClinicalDocument = {
  id: number;
  encounterId: number;
  type: string;
  content: string;
  createdAt: string;
};

export type CodedDiagnosis = {
  code: string;
  codeSystem: "ICD-10-CM";
  codeVersion: string;
  role: "principal" | "secondary";
  presentOnAdmission: boolean;
};

export type CodedProcedure = {
  code: string;
  codeSystem: "ICD-10-PCS";
  codeVersion: string;
};

export type CodingDecision = {
  id: number;
  encounterId: number;
  diagnoses: CodedDiagnosis[];
  procedures: CodedProcedure[];
  msDrg: string | null;
  msDrgDescription: string | null;
  finalizedAt: string | null;
  finalizedById: number | null;
};

export type EncounterDetail = Encounter & {
  documents: ClinicalDocument[];
  codingDecision: CodingDecision | null;
};

export type Icd10CmResult = {
  code: string;
  shortDescription: string;
  longDescription: string;
  isBillable: boolean;
  matchedVia?: string;
};

export type Icd10PcsResult = {
  code: string;
  description: string;
  isBillable: boolean;
  matchedVia?: string;
};

export type AuthUser = {
  sub: number;
  email: string;
  role: string;
  facilityId: number;
};
