import { Module } from "@nestjs/common";
import { EncoderController } from "./encoder.controller.js";
import { EncoderService } from "./encoder.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { TerminologyModule } from "../terminology/terminology.module.js";

@Module({
  imports: [AuthModule, TerminologyModule],
  controllers: [EncoderController],
  providers: [EncoderService],
})
export class EncoderModule {}
