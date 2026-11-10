-- AlterTable
ALTER TABLE "MatchReply" ADD COLUMN     "alternative" TEXT;

-- CreateTable
CREATE TABLE "MatchSmsOffer" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'queued',
    "gatewayId" TEXT,
    "error" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MatchSmsOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchSmsOffer_tokenHash_key" ON "MatchSmsOffer"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "MatchSmsOffer_matchId_playerId_revision_key" ON "MatchSmsOffer"("matchId", "playerId", "revision");

-- AddForeignKey
ALTER TABLE "MatchSmsOffer" ADD CONSTRAINT "MatchSmsOffer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "ScheduledMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSmsOffer" ADD CONSTRAINT "MatchSmsOffer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

