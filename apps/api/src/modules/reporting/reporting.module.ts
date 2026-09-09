import { Module } from "@nestjs/common";
import { ReportingController } from "./reporting.controller.js";
import { ReportingService } from "./reporting.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
