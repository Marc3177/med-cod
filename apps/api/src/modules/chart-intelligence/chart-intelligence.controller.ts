import { Controller, Get, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { ChartIntelligenceService } from "./chart-intelligence.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/chart-summary")
@UseGuards(AuthGuard)
export class ChartIntelligenceController {
  constructor(private readonly chartIntelligenceService: ChartIntelligenceService) {}

  @Get()
  getSummary(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.chartIntelligenceService.getSummary(id, user.facilityId);
  }
}
