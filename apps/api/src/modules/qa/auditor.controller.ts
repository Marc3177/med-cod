import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { QaService } from "./qa.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

/** Auditor-facing side of QA review — a minimal, separate, role-gated,
 *  facility-scoped view, same pattern as ProviderQueriesController: a
 *  coder or provider hitting these routes gets a 403, and an auditor at
 *  Facility A never sees or acts on Facility B's reviews. */
@Controller("audit")
@UseGuards(AuthGuard, RolesGuard)
@Roles("AUDITOR")
export class AuditorController {
  constructor(private readonly qaService: QaService) {}

  @Get("queue")
  listPending(@CurrentUser() user: AuthTokenPayload) {
    return this.qaService.listPendingForAuditor(user.facilityId);
  }

  @Post("reviews/:id/approve")
  approve(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.qaService.approve(id, user.sub, user.facilityId);
  }

  @Post("reviews/:id/return")
  returnToCoder(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: { reason: string }
  ) {
    return this.qaService.returnToCoder(id, user.sub, user.facilityId, body.reason);
  }
}
