import { Module } from "@nestjs/common";
import { ChartIntelligenceController } from "./chart-intelligence.controller.js";
import { ChartIntelligenceService } from "./chart-intelligence.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { SuggestionsModule } from "../suggestions/suggestions.module.js";
import { DocumentationGapsModule } from "../documentation-gaps/documentation-gaps.module.js";

@Module({
  imports: [AuthModule, SuggestionsModule, DocumentationGapsModule],
  controllers: [ChartIntelligenceController],
  providers: [ChartIntelligenceService],
})
export class ChartIntelligenceModule {}
