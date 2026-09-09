import { Module } from "@nestjs/common";
import { DocumentationGapsController } from "./documentation-gaps.controller.js";
import { DocumentationGapsService } from "./documentation-gaps.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [DocumentationGapsController],
  providers: [DocumentationGapsService],
  exports: [DocumentationGapsService],
})
export class DocumentationGapsModule {}
