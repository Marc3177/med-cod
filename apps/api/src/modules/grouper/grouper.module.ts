import { Module } from "@nestjs/common";
import { GrouperController } from "./grouper.controller.js";
import { GrouperService } from "./grouper.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [GrouperController],
  providers: [GrouperService],
  exports: [GrouperService],
})
export class GrouperModule {}
