import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { DecisionExplanationService } from "./decision-explanation.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/decision-explanation")
@UseGuards(AuthGuard)
export class DecisionExplanationController {
  constructor(private readonly decisionExplanationService: DecisionExplanationService) {}

  @Get()
  explain(
    @Param("id", ParseIntPipe) id: number,
    @Query("code") code: string,
    @Query("codeSystem") codeSystem: string,
    @CurrentUser() user: AuthTokenPayload
  ) {
    if (codeSystem !== "ICD-10-CM" && codeSystem !== "ICD-10-PCS") {
      throw new BadRequestException("codeSystem must be ICD-10-CM or ICD-10-PCS");
    }
    if (!code) {
      throw new BadRequestException("code is required");
    }
    return this.decisionExplanationService.explain(id, user.facilityId, code, codeSystem);
  }
}
