-- CreateTable
CREATE TABLE "DrgFamily" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "dxPrefixes" TEXT[],
    "mccDrg" TEXT NOT NULL,
    "mccDescription" TEXT NOT NULL,
    "ccDrg" TEXT NOT NULL,
    "ccDescription" TEXT NOT NULL,
    "noCcMccDrg" TEXT NOT NULL,
    "noCcMccDescription" TEXT NOT NULL,

    CONSTRAINT "DrgFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CcMccFlag" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,

    CONSTRAINT "CcMccFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CcMccFlag_code_key" ON "CcMccFlag"("code");
