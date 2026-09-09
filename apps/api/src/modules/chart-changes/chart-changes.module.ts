import { Module } from "@nestjs/common";
import { ChartChangesController } from "./chart-changes.controller.js";
import { ChartChangesService } from "./chart-changes.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ChartChangesController],
  providers: [ChartChangesService],
})
export class ChartChangesModule {}
