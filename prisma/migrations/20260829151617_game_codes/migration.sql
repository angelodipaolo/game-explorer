-- CreateTable
CREATE TABLE "GameCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownedGameId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "code" TEXT,
    "codeKey" TEXT NOT NULL,
    "howTo" TEXT,
    "sourceUrl" TEXT,
    "note" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameCode_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GameCode_ownedGameId_idx" ON "GameCode"("ownedGameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameCode_ownedGameId_kind_codeKey_key" ON "GameCode"("ownedGameId", "kind", "codeKey");
