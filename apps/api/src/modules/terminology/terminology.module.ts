import { Module } from "@nestjs/common";
import { TerminologyController } from "./terminology.controller.js";
import { TerminologyService } from "./terminology.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [TerminologyController],
  providers: [TerminologyService],
  exports: [TerminologyService],
})
export class TerminologyModule {}
