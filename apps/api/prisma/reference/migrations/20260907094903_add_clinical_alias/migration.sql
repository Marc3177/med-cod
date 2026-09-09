-- CreateTable
CREATE TABLE "ClinicalAlias" (
    "id" SERIAL NOT NULL,
    "alias" TEXT NOT NULL,
    "expansion" TEXT NOT NULL,

    CONSTRAINT "ClinicalAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalAlias_alias_key" ON "ClinicalAlias"("alias");
