-- CreateTable
CREATE TABLE "GameMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownedGameId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "sourceUrl" TEXT,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameMap_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MapMarker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "note" TEXT,
    "sourceUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MapMarker_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GameMap_ownedGameId_idx" ON "GameMap"("ownedGameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameMap_ownedGameId_slug_key" ON "GameMap"("ownedGameId", "slug");

-- CreateIndex
CREATE INDEX "MapMarker_mapId_idx" ON "MapMarker"("mapId");

-- CreateIndex
CREATE UNIQUE INDEX "MapMarker_mapId_name_key" ON "MapMarker"("mapId", "name");
