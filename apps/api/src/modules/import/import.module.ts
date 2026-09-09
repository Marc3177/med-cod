import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller.js";
import { ImportService } from "./import.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
