-- CreateTable
CREATE TABLE "RejectedSuggestion" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "codeSystem" TEXT NOT NULL,
    "rejectedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RejectedSuggestion_encounterId_code_codeSystem_key" ON "RejectedSuggestion"("encounterId", "code", "codeSystem");

-- AddForeignKey
ALTER TABLE "RejectedSuggestion" ADD CONSTRAINT "RejectedSuggestion_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
