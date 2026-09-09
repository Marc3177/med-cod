import { Global, Module } from "@nestjs/common";
import { AppPrismaService } from "./app-prisma.service.js";
import { ReferencePrismaService } from "./reference-prisma.service.js";

@Global()
@Module({
  providers: [AppPrismaService, ReferencePrismaService],
  exports: [AppPrismaService, ReferencePrismaService],
})
export class PrismaModule {}
