import { Module } from "@nestjs/common";
import { DecisionExplanationController } from "./decision-explanation.controller.js";
import { DecisionExplanationService } from "./decision-explanation.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { SuggestionsModule } from "../suggestions/suggestions.module.js";

@Module({
  imports: [AuthModule, SuggestionsModule],
  controllers: [DecisionExplanationController],
  providers: [DecisionExplanationService],
})
export class DecisionExplanationModule {}
