/*
  Warnings:

  - Added the required column `mdc` to the `DrgFamily` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DrgFamily" ADD COLUMN     "mdc" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "SurgicalDrgFamily" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "mdc" TEXT NOT NULL,
    "pcsPrefixes" TEXT[],
    "mccDrg" TEXT NOT NULL,
    "mccDescription" TEXT NOT NULL,
    "ccDrg" TEXT NOT NULL,
    "ccDescription" TEXT NOT NULL,
    "noCcMccDrg" TEXT NOT NULL,
    "noCcMccDescription" TEXT NOT NULL,

    CONSTRAINT "SurgicalDrgFamily_pkey" PRIMARY KEY ("id")
);
