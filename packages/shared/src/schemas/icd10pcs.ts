import { z } from "zod";

/**
 * One row of an ICD-10-PCS reference row, as loaded from the CMS bulk file.
 * PCS codes are always alphanumeric (0-9, A-H, J-N, P-Z — no I/O to avoid
 * confusion with 1/0), fixed at 7 characters when billable; the order file
 * also carries 3-character "table" header rows (non-billable, structural only).
 */
export const Icd10PcsRowSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{3}([A-Z0-9]{4})?$/, "invalid ICD-10-PCS code format"),
  description: z.string().min(1).max(2000),
  isBillable: z.boolean(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable(),
  fiscalYear: z.number().int().min(2015).max(2100),
});

export type Icd10PcsRow = z.infer<typeof Icd10PcsRowSchema>;

export const Icd10PcsBulkImportSchema = z.array(Icd10PcsRowSchema).min(1);
