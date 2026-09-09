import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { QueriesService } from "./queries.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

/** Coder-facing side of the query workflow: raise a query, send it, and
 *  resolve it once a provider has responded. */
@Controller()
@UseGuards(AuthGuard)
export class QueriesController {
  constructor(private readonly queriesService: QueriesService) {}

  @Get("encounters/:id/queries")
  listForEncounter(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.queriesService.listForEncounter(id, user.facilityId);
  }

  @Post("encounters/:id/queries")
  create(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthTokenPayload,
    @Body()
    body: { question: string; clinicalIndicators?: string; relatedCode?: string; relatedCodeSystem?: string }
  ) {
    return this.queriesService.create(
      id,
      user.sub,
      user.facilityId,
      body.question,
      body.clinicalIndicators,
      body.relatedCode,
      body.relatedCodeSystem
    );
  }

  @Post("queries/:id/send")
  send(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.queriesService.send(id, user.facilityId);
  }

  @Post("queries/:id/resolve")
  resolve(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.queriesService.resolve(id, user.sub, user.facilityId);
  }
}
