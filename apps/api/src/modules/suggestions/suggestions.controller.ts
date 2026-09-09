import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { SuggestionsService } from "./suggestions.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/suggestions")
@UseGuards(AuthGuard)
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  @Get()
  list(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.suggestionsService.listActiveSuggestions(id, user.facilityId);
  }

  @Post("reject")
  async reject(
    @Param("id", ParseIntPipe) id: number,
    @Body("code") code: string,
    @Body("codeSystem") codeSystem: string,
    @CurrentUser() user: AuthTokenPayload
  ) {
    if (codeSystem !== "ICD-10-CM" && codeSystem !== "ICD-10-PCS") {
      throw new BadRequestException("codeSystem must be ICD-10-CM or ICD-10-PCS");
    }
    if (!code) {
      throw new BadRequestException("code is required");
    }
    await this.suggestionsService.rejectSuggestion(id, user.facilityId, user.sub, code, codeSystem);
    return { ok: true };
  }
}
