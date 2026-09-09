import { Module } from "@nestjs/common";
import { QueriesController } from "./queries.controller.js";
import { ProviderQueriesController } from "./provider-queries.controller.js";
import { QueriesService } from "./queries.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [QueriesController, ProviderQueriesController],
  providers: [QueriesService],
})
export class QueriesModule {}
