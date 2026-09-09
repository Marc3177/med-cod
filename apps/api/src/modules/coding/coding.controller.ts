import { Body, Controller, Param, ParseIntPipe, Post, Put, UseGuards } from "@nestjs/common";
import { CodingService } from "./coding.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/coding")
@UseGuards(AuthGuard)
export class CodingController {
  constructor(private readonly codingService: CodingService) {}

  @Put()
  saveDraft(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: { decision: unknown }
  ) {
    return this.codingService.saveDraft(id, user.sub, user.facilityId, body.decision);
  }

  @Post("finalize")
  finalize(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.codingService.finalize(id, user.sub, user.facilityId);
  }
}
