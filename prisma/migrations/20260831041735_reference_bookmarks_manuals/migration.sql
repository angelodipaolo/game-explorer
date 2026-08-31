-- CreateTable
CREATE TABLE "GameBookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownedGameId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameBookmark_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameManual" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownedGameId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Manual',
    "sourceUrl" TEXT,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameManual_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManualPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "manualId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManualPage_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "GameManual" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GameBookmark_ownedGameId_idx" ON "GameBookmark"("ownedGameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameBookmark_ownedGameId_urlKey_key" ON "GameBookmark"("ownedGameId", "urlKey");

-- CreateIndex
CREATE INDEX "GameManual_ownedGameId_idx" ON "GameManual"("ownedGameId");

-- CreateIndex
CREATE INDEX "ManualPage_manualId_position_idx" ON "ManualPage"("manualId", "position");
