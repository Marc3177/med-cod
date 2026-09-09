import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { ChartChangesService } from "./chart-changes.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/chart-changes")
@UseGuards(AuthGuard)
export class ChartChangesController {
  constructor(private readonly chartChangesService: ChartChangesService) {}

  @Get()
  getChanges(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.chartChangesService.getChanges(id, user.sub, user.facilityId);
  }

  @Post("ack")
  async acknowledgeView(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    await this.chartChangesService.acknowledgeView(id, user.sub, user.facilityId);
    return { ok: true };
  }
}
