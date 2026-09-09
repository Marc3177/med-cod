import { z } from "zod";

/**
 * One row of an ICD-10-CM reference row, as loaded from the CMS bulk file.
 * Used to validate every row during bulk import BEFORE it is staged —
 * a single malformed row fails validation, not the whole import.
 */
export const Icd10CmRowSchema = z.object({
  // Stored undotted, matching the CMS source file (e.g. "A000", not "A00.0") —
  // the decimal point is a display convention applied in the UI, not part of storage.
  // Position 3 isn't always a digit (e.g. "C4A2", Merkel cell carcinoma category),
  // so this only fixes the leading letter and an overall 3-7 char length.
  code: z.string().regex(/^[A-Z][A-Z0-9]{2,6}$/, "invalid ICD-10-CM code format"),
  shortDescription: z.string().min(1).max(255),
  longDescription: z.string().min(1).max(2000),
  isBillable: z.boolean(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable(),
  fiscalYear: z.number().int().min(2015).max(2100),
});

export type Icd10CmRow = z.infer<typeof Icd10CmRowSchema>;

export const Icd10CmBulkImportSchema = z.array(Icd10CmRowSchema).min(1);
