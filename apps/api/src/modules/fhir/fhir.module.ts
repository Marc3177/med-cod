import { Module } from "@nestjs/common";
import { FhirController } from "./fhir.controller.js";
import { FhirService } from "./fhir.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [FhirController],
  providers: [FhirService],
})
export class FhirModule {}
