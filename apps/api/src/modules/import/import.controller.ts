import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ImportService } from "./import.service.js";
import { AuthGuard } from "../auth/auth.guard.js";

// Missing AuthGuard until this pass's cross-module authorization audit — the
// only controller in the app without it, an inconsistency against every
// other controller's identical pattern rather than a deliberate exception
// (see docs/TEST_REPORT.md). Currently a pure schema-validation utility with
// no DB access, so the gap wasn't a data leak today, but it's the wrong
// default for an endpoint whose planned stage/apply follow-ups (see
// ImportService) will write to the reference tables.
@Controller("import")
@UseGuards(AuthGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post("icd-10-cm/validate")
  validateIcd10Cm(@Body() body: { rows: unknown[] }) {
    return this.importService.validateIcd10Cm(body.rows);
  }
}
