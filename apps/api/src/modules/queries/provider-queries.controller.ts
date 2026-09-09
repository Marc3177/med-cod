import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { QueriesService } from "./queries.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

/** Provider-facing side of the query workflow — a deliberately minimal,
 *  separate view (per docs/ROADMAP.md Phase 4): a provider can see pending
 *  questions and respond, nothing else. Role-gated: a coder or auditor
 *  hitting these routes gets a 403, not just a differently-filtered 200.
 *  Also facility-scoped: a provider only ever sees their own facility's
 *  queries, never another facility's. */
@Controller("provider")
@UseGuards(AuthGuard, RolesGuard)
@Roles("PROVIDER")
export class ProviderQueriesController {
  constructor(private readonly queriesService: QueriesService) {}

  @Get("queries")
  listPending(@CurrentUser() user: AuthTokenPayload) {
    return this.queriesService.listPendingForProvider(user.facilityId);
  }

  @Post("queries/:id/respond")
  respond(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: { response: string }
  ) {
    return this.queriesService.respond(id, user.sub, user.facilityId, body.response);
  }
}
