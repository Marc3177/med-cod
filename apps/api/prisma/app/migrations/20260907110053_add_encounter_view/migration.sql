-- CreateTable
CREATE TABLE "EncounterView" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EncounterView_encounterId_userId_key" ON "EncounterView"("encounterId", "userId");

-- AddForeignKey
ALTER TABLE "EncounterView" ADD CONSTRAINT "EncounterView_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
