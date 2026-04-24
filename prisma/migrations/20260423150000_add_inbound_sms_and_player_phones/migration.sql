-- CreateEnum
CREATE TYPE "InboundSmsAvailabilityStatus" AS ENUM ('dostepny', 'niedostepny', 'propozycja', 'niejasne');

-- AlterTable
ALTER TABLE "ScheduledMatch"
ADD COLUMN "playerOnePhone" TEXT,
ADD COLUMN "playerTwoPhone" TEXT;

-- CreateTable
CREATE TABLE "InboundSms" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT,
    "body" TEXT NOT NULL,
    "matchedPlayer" TEXT,
    "parsedSummary" TEXT NOT NULL,
    "parsedAvailability" "InboundSmsAvailabilityStatus" NOT NULL DEFAULT 'niejasne',
    "parsedStartsAt" TIMESTAMP(3),
    "parsedEndsAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    "scheduledMatchId" TEXT,

    CONSTRAINT "InboundSms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundSms_fromNumber_receivedAt_idx" ON "InboundSms"("fromNumber", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundSms_scheduledMatchId_receivedAt_idx" ON "InboundSms"("scheduledMatchId", "receivedAt");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "InboundSms_provider_externalId_key" ON "InboundSms"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "InboundSms" ADD CONSTRAINT "InboundSms_scheduledMatchId_fkey" FOREIGN KEY ("scheduledMatchId") REFERENCES "ScheduledMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
