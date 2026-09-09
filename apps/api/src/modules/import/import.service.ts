import { Injectable } from "@nestjs/common";
import { Icd10CmBulkImportSchema, type Icd10CmRow } from "@med-cod/shared";

/**
 * Bulk import never writes directly to the live reference table.
 *
 * Flow: PENDING -> VALIDATING (every row checked against the shared Zod schema,
 * bad rows collected into an error report, nothing written yet) -> STAGED (all
 * rows valid, written to a staging table) -> APPLIED (staged rows swapped into
 * the live table in one transaction). A file that fails validation never
 * touches live data — "no mistakes" is enforced here, not by careful clicking.
 */
@Injectable()
export class ImportService {
  validateIcd10Cm(rawRows: unknown[]): { valid: Icd10CmRow[]; errors: { index: number; message: string }[] } {
    const errors: { index: number; message: string }[] = [];
    const valid: Icd10CmRow[] = [];

    rawRows.forEach((row, index) => {
      const result = Icd10CmBulkImportSchema.element.safeParse(row);
      if (result.success) {
        valid.push(result.data);
      } else {
        errors.push({ index, message: result.error.message });
      }
    });

    return { valid, errors };
  }

  // stageIcd10Cm(...) and applyIcd10Cm(...) land in Phase 1 alongside the
  // Prisma reference-client wiring — kept out of this skeleton on purpose.
}
