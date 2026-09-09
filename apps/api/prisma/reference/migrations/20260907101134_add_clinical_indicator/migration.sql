-- CreateTable
CREATE TABLE "ClinicalIndicator" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "relatedDxPrefixes" TEXT[],
    "queryTemplate" TEXT NOT NULL,

    CONSTRAINT "ClinicalIndicator_pkey" PRIMARY KEY ("id")
);
