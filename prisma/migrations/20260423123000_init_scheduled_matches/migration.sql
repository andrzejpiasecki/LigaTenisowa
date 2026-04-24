-- CreateEnum
CREATE TYPE "ScheduledMatchStatus" AS ENUM ('propozycja', 'oczekuje', 'potwierdzony', 'anulowany', 'rozegrany');

-- CreateTable
CREATE TABLE "ScheduledMatch" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "playerOne" TEXT NOT NULL,
    "playerTwo" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "status" "ScheduledMatchStatus" NOT NULL DEFAULT 'propozycja',
    "adminNotes" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledMatch_scheduledAt_idx" ON "ScheduledMatch"("scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduledMatch_league_season_idx" ON "ScheduledMatch"("league", "season");

-- CreateIndex
CREATE INDEX "ScheduledMatch_createdBy_idx" ON "ScheduledMatch"("createdBy");
