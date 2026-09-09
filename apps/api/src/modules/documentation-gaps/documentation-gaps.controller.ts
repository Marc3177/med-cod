import { Controller, Get, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { DocumentationGapsService } from "./documentation-gaps.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller("encounters/:id/documentation-gaps")
@UseGuards(AuthGuard)
export class DocumentationGapsController {
  constructor(private readonly documentationGapsService: DocumentationGapsService) {}

  @Get()
  list(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.documentationGapsService.listGaps(id, user.facilityId);
  }
}
