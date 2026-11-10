-- AlterTable
ALTER TABLE "ScheduledMatch" ADD COLUMN     "confirmationVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PlayerAccount" (
    "playerId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "inviteHash" TEXT,
    "inviteExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAccount_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "PlayerSession" (
    "tokenHash" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlayerSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MatchReply" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutgoingSms" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "gatewayId" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingSms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAccount_inviteHash_key" ON "PlayerAccount"("inviteHash");

-- CreateIndex
CREATE INDEX "PlayerSession_playerId_idx" ON "PlayerSession"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchReply_matchId_playerId_revision_key" ON "MatchReply"("matchId", "playerId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "OutgoingSms_dedupeKey_key" ON "OutgoingSms"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutgoingSms_status_createdAt_idx" ON "OutgoingSms"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PlayerAccount" ADD CONSTRAINT "PlayerAccount_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSession" ADD CONSTRAINT "PlayerSession_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchReply" ADD CONSTRAINT "MatchReply_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "ScheduledMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchReply" ADD CONSTRAINT "MatchReply_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingSms" ADD CONSTRAINT "OutgoingSms_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

