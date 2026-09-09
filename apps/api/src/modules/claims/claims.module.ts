import { Module } from "@nestjs/common";
import { ClaimsController } from "./claims.controller.js";
import { ClaimsService } from "./claims.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
