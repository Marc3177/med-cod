-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('DRAFT', 'SENT', 'RESPONDED', 'RESOLVED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Query" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "clinicalIndicators" TEXT,
    "status" "QueryStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Query_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Query" ADD CONSTRAINT "Query_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
