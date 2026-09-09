import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { TerminologyService } from "./terminology.service.js";
import { AuthGuard } from "../auth/auth.guard.js";

@Controller("terminology")
@UseGuards(AuthGuard)
export class TerminologyController {
  constructor(private readonly terminologyService: TerminologyService) {}

  @Get("expand")
  async expand(@Query("text") text: string = "") {
    return { original: text, expanded: await this.terminologyService.expandText(text) };
  }
}
