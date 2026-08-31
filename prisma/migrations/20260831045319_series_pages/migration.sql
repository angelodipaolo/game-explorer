-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "blurb" TEXT,
    "coverImageId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "seedCollectionId" INTEGER,
    "seenIgdbIds" TEXT NOT NULL DEFAULT '[]',
    "seedCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SeriesEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "igdbId" INTEGER,
    "title" TEXT,
    "position" INTEGER NOT NULL,
    "section" TEXT,
    "note" TEXT,
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeriesEntry_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CatalogGame" (
    "igdbId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT 'stub',
    "summary" TEXT,
    "storyline" TEXT,
    "firstReleaseDate" DATETIME,
    "coverImageId" TEXT,
    "coverWidth" INTEGER,
    "coverHeight" INTEGER,
    "rating" REAL,
    "ratingCount" INTEGER,
    "platformNames" TEXT NOT NULL DEFAULT '[]',
    "platformIds" TEXT NOT NULL DEFAULT '[]',
    "genres" TEXT NOT NULL DEFAULT '[]',
    "themes" TEXT NOT NULL DEFAULT '[]',
    "playerPerspectives" TEXT NOT NULL DEFAULT '[]',
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "developers" TEXT NOT NULL DEFAULT '[]',
    "publishers" TEXT NOT NULL DEFAULT '[]',
    "gameModes" TEXT NOT NULL DEFAULT '[]',
    "screenshots" TEXT NOT NULL DEFAULT '[]',
    "similarGameIds" TEXT NOT NULL DEFAULT '[]',
    "collections" TEXT NOT NULL DEFAULT '[]',
    "franchises" TEXT NOT NULL DEFAULT '[]',
    "parentIgdbId" INTEGER,
    "mpOfflineMax" INTEGER,
    "mpOfflineCoopMax" INTEGER,
    "mpOfflineCoop" BOOLEAN,
    "mpSplitscreen" BOOLEAN,
    "mpCampaignCoop" BOOLEAN,
    "mpDropIn" BOOLEAN,
    "mpLanCoop" BOOLEAN,
    "mpOnlineCoop" BOOLEAN,
    "mpOnlineMax" INTEGER,
    "ttbNormally" INTEGER,
    "ttbHastily" INTEGER,
    "ttbCompletely" INTEGER,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CatalogGame" ("coverHeight", "coverImageId", "coverWidth", "detail", "developers", "fetchedAt", "firstReleaseDate", "gameModes", "genres", "igdbId", "keywords", "mpCampaignCoop", "mpDropIn", "mpLanCoop", "mpOfflineCoop", "mpOfflineCoopMax", "mpOfflineMax", "mpOnlineCoop", "mpOnlineMax", "mpSplitscreen", "name", "parentIgdbId", "platformIds", "platformNames", "playerPerspectives", "publishers", "rating", "ratingCount", "screenshots", "similarGameIds", "slug", "storyline", "summary", "themes", "ttbCompletely", "ttbHastily", "ttbNormally") SELECT "coverHeight", "coverImageId", "coverWidth", "detail", "developers", "fetchedAt", "firstReleaseDate", "gameModes", "genres", "igdbId", "keywords", "mpCampaignCoop", "mpDropIn", "mpLanCoop", "mpOfflineCoop", "mpOfflineCoopMax", "mpOfflineMax", "mpOnlineCoop", "mpOnlineMax", "mpSplitscreen", "name", "parentIgdbId", "platformIds", "platformNames", "playerPerspectives", "publishers", "rating", "ratingCount", "screenshots", "similarGameIds", "slug", "storyline", "summary", "themes", "ttbCompletely", "ttbHastily", "ttbNormally" FROM "CatalogGame";
DROP TABLE "CatalogGame";
ALTER TABLE "new_CatalogGame" RENAME TO "CatalogGame";
CREATE INDEX "CatalogGame_name_idx" ON "CatalogGame"("name");
CREATE INDEX "CatalogGame_detail_idx" ON "CatalogGame"("detail");
CREATE INDEX "CatalogGame_parentIgdbId_idx" ON "CatalogGame"("parentIgdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");

-- CreateIndex
CREATE INDEX "Series_position_idx" ON "Series"("position");

-- CreateIndex
CREATE INDEX "SeriesEntry_seriesId_position_idx" ON "SeriesEntry"("seriesId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesEntry_seriesId_igdbId_key" ON "SeriesEntry"("seriesId", "igdbId");
