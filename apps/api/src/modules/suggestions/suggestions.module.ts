import { Module } from "@nestjs/common";
import { SuggestionsController } from "./suggestions.controller.js";
import { SuggestionsService } from "./suggestions.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { TerminologyModule } from "../terminology/terminology.module.js";

@Module({
  imports: [AuthModule, TerminologyModule],
  controllers: [SuggestionsController],
  providers: [SuggestionsService],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
