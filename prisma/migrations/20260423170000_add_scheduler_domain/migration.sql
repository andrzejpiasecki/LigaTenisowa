-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('aktywny', 'nieaktywny');

-- CreateEnum
CREATE TYPE "AvailabilityKind" AS ENUM ('dostepny', 'niedostepny');

-- CreateEnum
CREATE TYPE "AvailabilitySource" AS ENUM ('sms', 'reczne', 'ai', 'system');

-- CreateEnum
CREATE TYPE "MatchProposalStatus" AS ENUM ('draft', 'accepted', 'rejected');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "skillLevel" INTEGER NOT NULL DEFAULT 5,
    "preferences" TEXT NOT NULL DEFAULT '',
    "status" "PlayerStatus" NOT NULL DEFAULT 'aktywny',
    "inactiveUntil" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Court" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAvailability" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" "AvailabilityKind" NOT NULL,
    "source" "AvailabilitySource" NOT NULL DEFAULT 'reczne',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "inboundSmsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchHistory" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "playerOneId" TEXT NOT NULL,
    "playerTwoId" TEXT NOT NULL,
    "courtId" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchProposal" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "playerOneId" TEXT NOT NULL,
    "playerTwoId" TEXT NOT NULL,
    "courtId" TEXT,
    "proposedStartsAt" TIMESTAMP(3) NOT NULL,
    "proposedEndsAt" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "MatchProposalStatus" NOT NULL DEFAULT 'draft',
    "feedback" TEXT NOT NULL DEFAULT '',
    "sourceSmsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchProposal_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ScheduledMatch"
ADD COLUMN "playerOneId" TEXT,
ADD COLUMN "playerTwoId" TEXT,
ADD COLUMN "courtId" TEXT;

-- AlterTable
ALTER TABLE "InboundSms"
ADD COLUMN "matchedPlayerId" TEXT,
ADD COLUMN "parsedReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN "parsedInactiveUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Player_phone_key" ON "Player"("phone");

-- CreateIndex
CREATE INDEX "Player_league_season_status_idx" ON "Player"("league", "season", "status");

-- CreateIndex
CREATE INDEX "PlayerAvailability_playerId_startsAt_endsAt_idx" ON "PlayerAvailability"("playerId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "MatchHistory_season_league_playedAt_idx" ON "MatchHistory"("season", "league", "playedAt");

-- CreateIndex
CREATE INDEX "MatchProposal_season_league_status_idx" ON "MatchProposal"("season", "league", "status");

-- CreateIndex
CREATE INDEX "MatchProposal_proposedStartsAt_proposedEndsAt_idx" ON "MatchProposal"("proposedStartsAt", "proposedEndsAt");

-- AddForeignKey
ALTER TABLE "PlayerAvailability" ADD CONSTRAINT "PlayerAvailability_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAvailability" ADD CONSTRAINT "PlayerAvailability_inboundSmsId_fkey" FOREIGN KEY ("inboundSmsId") REFERENCES "InboundSms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchHistory" ADD CONSTRAINT "MatchHistory_playerOneId_fkey" FOREIGN KEY ("playerOneId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchHistory" ADD CONSTRAINT "MatchHistory_playerTwoId_fkey" FOREIGN KEY ("playerTwoId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchHistory" ADD CONSTRAINT "MatchHistory_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMatch" ADD CONSTRAINT "ScheduledMatch_playerOneId_fkey" FOREIGN KEY ("playerOneId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMatch" ADD CONSTRAINT "ScheduledMatch_playerTwoId_fkey" FOREIGN KEY ("playerTwoId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMatch" ADD CONSTRAINT "ScheduledMatch_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundSms" ADD CONSTRAINT "InboundSms_matchedPlayerId_fkey" FOREIGN KEY ("matchedPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchProposal" ADD CONSTRAINT "MatchProposal_playerOneId_fkey" FOREIGN KEY ("playerOneId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchProposal" ADD CONSTRAINT "MatchProposal_playerTwoId_fkey" FOREIGN KEY ("playerTwoId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchProposal" ADD CONSTRAINT "MatchProposal_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchProposal" ADD CONSTRAINT "MatchProposal_sourceSmsId_fkey" FOREIGN KEY ("sourceSmsId") REFERENCES "InboundSms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
