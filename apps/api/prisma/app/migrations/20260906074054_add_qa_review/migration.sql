-- CreateEnum
CREATE TYPE "QaReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');

-- CreateTable
CREATE TABLE "QaReview" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "status" "QaReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaReview_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "QaReview" ADD CONSTRAINT "QaReview_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
