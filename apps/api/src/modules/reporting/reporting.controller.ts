import { Controller, Get, UseGuards } from "@nestjs/common";
import { ReportingService } from "./reporting.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("reports")
@UseGuards(AuthGuard, RolesGuard)
@Roles("SUPERVISOR", "ADMIN")
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get("summary")
  getSummary(@CurrentUser() user: AuthTokenPayload) {
    return this.reportingService.getSummary(user.facilityId);
  }
}
