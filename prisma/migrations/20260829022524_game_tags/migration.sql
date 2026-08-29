-- CreateTable
CREATE TABLE "GameTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownedGameId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "note" TEXT,
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameTag_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GameTag_key_idx" ON "GameTag"("key");

-- CreateIndex
CREATE INDEX "GameTag_runId_idx" ON "GameTag"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "GameTag_ownedGameId_key_source_key" ON "GameTag"("ownedGameId", "key", "source");
