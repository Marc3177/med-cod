import { Controller, Get, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { PatientsService } from "./patients.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

@Controller()
@UseGuards(AuthGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get("work-queue")
  listWorkQueue(@CurrentUser() user: AuthTokenPayload) {
    return this.patientsService.listWorkQueue(user.facilityId);
  }

  @Get("encounters/:id")
  getEncounter(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthTokenPayload) {
    return this.patientsService.getEncounter(id, user.facilityId);
  }
}
