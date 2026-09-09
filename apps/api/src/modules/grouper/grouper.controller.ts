import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { GrouperService } from "./grouper.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import type { CodedDiagnosis, CodedProcedure } from "@med-cod/shared";

/**
 * A dedicated endpoint (not tucked into the coding controller) so the coder's
 * screen can preview the DRG live from whatever is currently in the coding
 * form — including diagnoses/procedures not yet saved as a draft — without
 * that draft write becoming a side effect of just looking at the DRG.
 */
@Controller("grouper")
@UseGuards(AuthGuard)
export class GrouperController {
  constructor(private readonly grouperService: GrouperService) {}

  @Post("preview")
  preview(@Body() body: { diagnoses: CodedDiagnosis[]; procedures?: CodedProcedure[] }) {
    return this.grouperService.assignDrg(body.diagnoses ?? [], body.procedures ?? []);
  }
}
