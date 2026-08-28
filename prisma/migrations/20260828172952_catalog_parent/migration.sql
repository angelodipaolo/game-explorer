-- AlterTable
ALTER TABLE "CatalogGame" ADD COLUMN "parentIgdbId" INTEGER;

-- CreateIndex
CREATE INDEX "CatalogGame_parentIgdbId_idx" ON "CatalogGame"("parentIgdbId");
