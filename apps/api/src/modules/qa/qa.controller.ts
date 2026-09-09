import { Controller, Get, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { QaService } from "./qa.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

/** Coder-facing: view the QA review history (and any return reason) for an
 *  encounter. Any authenticated user at the same facility can view —
 *  approving/returning is the part that's auditor-only, in AuditorController. */
@Controller("encounters/:id/qa-reviews")
@UseGuards(AuthGuard)
export class QaController {
  constructor(private readonly qaService: QaService) {}

  @Get()
  listForEncounter(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.qaService.listForEncounter(id, user.facilityId);
  }
}
