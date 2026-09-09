-- CreateTable
CREATE TABLE "SynonymIndexEntry" (
    "id" SERIAL NOT NULL,
    "codeSystem" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "codeValue" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "SynonymIndexEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SynonymIndexEntry_term_idx" ON "SynonymIndexEntry"("term");

-- CreateIndex
CREATE INDEX "SynonymIndexEntry_codeSystem_fiscalYear_idx" ON "SynonymIndexEntry"("codeSystem", "fiscalYear");
