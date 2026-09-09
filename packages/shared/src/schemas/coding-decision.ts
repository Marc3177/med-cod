import { z } from "zod";

export const DiagnosisRoleSchema = z.enum(["principal", "secondary"]);

export const CodedDiagnosisSchema = z.object({
  code: z.string().min(1),
  codeSystem: z.literal("ICD-10-CM"),
  codeVersion: z.string().min(1),
  role: DiagnosisRoleSchema,
  presentOnAdmission: z.boolean(),
  evidenceDocumentId: z.number().int().positive().optional(),
  evidenceExcerpt: z.string().max(2000).optional(),
});

export const CodedProcedureSchema = z.object({
  code: z.string().min(1),
  codeSystem: z.literal("ICD-10-PCS"),
  codeVersion: z.string().min(1),
  evidenceDocumentId: z.number().int().positive().optional(),
  evidenceExcerpt: z.string().max(2000).optional(),
});

export const CodingDecisionSchema = z.object({
  encounterId: z.number().int().positive(),
  diagnoses: z.array(CodedDiagnosisSchema).min(1)
    .refine((d) => d.filter((x) => x.role === "principal").length === 1, {
      message: "exactly one principal diagnosis is required",
    }),
  procedures: z.array(CodedProcedureSchema),
});

export type CodingDecision = z.infer<typeof CodingDecisionSchema>;
export type CodedDiagnosis = z.infer<typeof CodedDiagnosisSchema>;
export type CodedProcedure = z.infer<typeof CodedProcedureSchema>;
