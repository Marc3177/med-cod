import { Module } from "@nestjs/common";
import { QaController } from "./qa.controller.js";
import { AuditorController } from "./auditor.controller.js";
import { QaService } from "./qa.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [QaController, AuditorController],
  providers: [QaService],
  exports: [QaService],
})
export class QaModule {}
