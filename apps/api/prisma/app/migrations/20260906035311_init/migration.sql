-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CODER', 'ADMIN', 'PROVIDER', 'AUDITOR', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'QUERY_PENDING', 'QA_REVIEW', 'FINALIZED');

-- CreateTable
CREATE TABLE "Facility" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "facilityId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" SERIAL NOT NULL,
    "mrn" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "sex" TEXT NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "facilityId" INTEGER NOT NULL,
    "admissionDate" TIMESTAMP(3) NOT NULL,
    "dischargeDate" TIMESTAMP(3),
    "admittingDiagnosis" TEXT,
    "dischargeDisposition" TEXT,
    "status" "EncounterStatus" NOT NULL DEFAULT 'NEW',

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalDocument" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodingDecision" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "diagnoses" JSONB NOT NULL,
    "procedures" JSONB NOT NULL,
    "msDrg" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" SERIAL NOT NULL,
    "codingDecisionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkImportJob" (
    "id" SERIAL NOT NULL,
    "targetTable" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER,
    "errorReport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "BulkImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_mrn_key" ON "Patient"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "CodingDecision_encounterId_key" ON "CodingDecision"("encounterId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingDecision" ADD CONSTRAINT "CodingDecision_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_codingDecisionId_fkey" FOREIGN KEY ("codingDecisionId") REFERENCES "CodingDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
