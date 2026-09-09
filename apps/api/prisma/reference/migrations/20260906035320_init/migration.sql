-- CreateTable
CREATE TABLE "Icd10CmCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "longDescription" TEXT NOT NULL,
    "isBillable" BOOLEAN NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "Icd10CmCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Icd10PcsCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "Icd10PcsCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MsDrgWeight" (
    "id" SERIAL NOT NULL,
    "drg" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "relativeWeight" DOUBLE PRECISION NOT NULL,
    "fiscalYear" INTEGER NOT NULL,

    CONSTRAINT "MsDrgWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NcciEdit" (
    "id" SERIAL NOT NULL,
    "column1Code" TEXT NOT NULL,
    "column2Code" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "NcciEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Icd10CmCode_code_idx" ON "Icd10CmCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Icd10CmCode_code_fiscalYear_key" ON "Icd10CmCode"("code", "fiscalYear");

-- CreateIndex
CREATE INDEX "Icd10PcsCode_code_idx" ON "Icd10PcsCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Icd10PcsCode_code_fiscalYear_key" ON "Icd10PcsCode"("code", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "MsDrgWeight_drg_fiscalYear_key" ON "MsDrgWeight"("drg", "fiscalYear");

-- CreateIndex
CREATE INDEX "NcciEdit_column1Code_column2Code_idx" ON "NcciEdit"("column1Code", "column2Code");
