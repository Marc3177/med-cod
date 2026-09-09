/*
  Warnings:

  - Added the required column `isBillable` to the `Icd10PcsCode` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Icd10PcsCode" ADD COLUMN     "isBillable" BOOLEAN NOT NULL;
