-- CreateTable
CREATE TABLE "OwnedGame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "completeness" TEXT,
    "condition" TEXT,
    "notes" TEXT,
    "catalogGameId" INTEGER,
    "matchConfidence" REAL,
    "matchSource" TEXT,
    "importBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OwnedGame_catalogGameId_fkey" FOREIGN KEY ("catalogGameId") REFERENCES "CatalogGame" ("igdbId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OwnedGame_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownedGameId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "note" TEXT,
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameFact_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogGame" (
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

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "problems" TEXT NOT NULL DEFAULT '[]',
    "dedupeKind" TEXT NOT NULL DEFAULT 'none',
    "dedupeTargetId" TEXT,
    "candidates" TEXT NOT NULL DEFAULT '[]',
    "decision" TEXT NOT NULL DEFAULT 'review',
    "holdReason" TEXT,
    "chosenIgdbId" INTEGER,
    "chosenConfidence" REAL,
    "decidedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportRow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ImportSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'committed',
    "committedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" DATETIME,
    CONSTRAINT "ImportBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ImportSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportEffect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownedGameId" TEXT NOT NULL,
    "delta" INTEGER,
    CONSTRAINT "ImportEffect_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportEffect_ownedGameId_fkey" FOREIGN KEY ("ownedGameId") REFERENCES "OwnedGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "summary" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "OwnedGame_platform_idx" ON "OwnedGame"("platform");

-- CreateIndex
CREATE INDEX "OwnedGame_catalogGameId_idx" ON "OwnedGame"("catalogGameId");

-- CreateIndex
CREATE INDEX "OwnedGame_importBatchId_idx" ON "OwnedGame"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnedGame_normalizedTitle_platform_key" ON "OwnedGame"("normalizedTitle", "platform");

-- CreateIndex
CREATE INDEX "GameFact_source_idx" ON "GameFact"("source");

-- CreateIndex
CREATE INDEX "GameFact_runId_idx" ON "GameFact"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "GameFact_ownedGameId_field_key" ON "GameFact"("ownedGameId", "field");

-- CreateIndex
CREATE INDEX "CatalogGame_name_idx" ON "CatalogGame"("name");

-- CreateIndex
CREATE INDEX "CatalogGame_detail_idx" ON "CatalogGame"("detail");

-- CreateIndex
CREATE INDEX "ImportRow_sessionId_decision_idx" ON "ImportRow"("sessionId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_sessionId_index_key" ON "ImportRow"("sessionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_sessionId_key" ON "ImportBatch"("sessionId");

-- CreateIndex
CREATE INDEX "ImportEffect_batchId_idx" ON "ImportEffect"("batchId");
