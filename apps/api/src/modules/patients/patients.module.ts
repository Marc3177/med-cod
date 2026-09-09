import { Module } from "@nestjs/common";
import { PatientsController } from "./patients.controller.js";
import { PatientsService } from "./patients.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
