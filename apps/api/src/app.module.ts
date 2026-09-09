import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ImportModule } from "./modules/import/import.module.js";
import { PatientsModule } from "./modules/patients/patients.module.js";
import { EncoderModule } from "./modules/encoder/encoder.module.js";
import { CodingModule } from "./modules/coding/coding.module.js";
import { GrouperModule } from "./modules/grouper/grouper.module.js";
import { SuggestionsModule } from "./modules/suggestions/suggestions.module.js";
import { QueriesModule } from "./modules/queries/queries.module.js";
import { QaModule } from "./modules/qa/qa.module.js";
import { ReportingModule } from "./modules/reporting/reporting.module.js";
import { FhirModule } from "./modules/fhir/fhir.module.js";
import { ClaimsModule } from "./modules/claims/claims.module.js";
import { TerminologyModule } from "./modules/terminology/terminology.module.js";
import { DocumentationGapsModule } from "./modules/documentation-gaps/documentation-gaps.module.js";
import { ChartIntelligenceModule } from "./modules/chart-intelligence/chart-intelligence.module.js";
import { ChartChangesModule } from "./modules/chart-changes/chart-changes.module.js";
import { DecisionExplanationModule } from "./modules/decision-explanation/decision-explanation.module.js";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ImportModule,
    PatientsModule,
    EncoderModule,
    CodingModule,
    GrouperModule,
    SuggestionsModule,
    QueriesModule,
    QaModule,
    ReportingModule,
    FhirModule,
    ClaimsModule,
    TerminologyModule,
    DocumentationGapsModule,
    ChartIntelligenceModule,
    ChartChangesModule,
    DecisionExplanationModule,
  ],
})
export class AppModule {}
