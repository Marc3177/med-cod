import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { EncoderService } from "./encoder.service.js";
import { AuthGuard } from "../auth/auth.guard.js";

@Controller("encoder")
@UseGuards(AuthGuard)
export class EncoderController {
  constructor(private readonly encoderService: EncoderService) {}

  @Get("icd-10-cm")
  searchIcd10Cm(@Query("q") q: string = "") {
    return this.encoderService.searchIcd10Cm(q);
  }

  @Get("icd-10-pcs")
  searchIcd10Pcs(@Query("q") q: string = "") {
    return this.encoderService.searchIcd10Pcs(q);
  }
}
