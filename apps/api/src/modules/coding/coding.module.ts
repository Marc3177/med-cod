import { Module } from "@nestjs/common";
import { CodingController } from "./coding.controller.js";
import { CodingService } from "./coding.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { GrouperModule } from "../grouper/grouper.module.js";
import { QaModule } from "../qa/qa.module.js";

@Module({
  imports: [AuthModule, GrouperModule, QaModule],
  controllers: [CodingController],
  providers: [CodingService],
})
export class CodingModule {}
