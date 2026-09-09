import { Controller, Get, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { ClaimsService } from "./claims.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/claim-export")
@UseGuards(AuthGuard)
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get()
  getClaimExport(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.claimsService.getClaimExport(id, user.facilityId);
  }
}
