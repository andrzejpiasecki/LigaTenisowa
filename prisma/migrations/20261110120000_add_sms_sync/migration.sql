CREATE TYPE "SyncedSmsDirection" AS ENUM ('incoming', 'outgoing');

CREATE TABLE "SyncedSms" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" "SyncedSmsDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncedSms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SyncedSms_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SyncedSms_playerId_occurredAt_id_idx" ON "SyncedSms"("playerId", "occurredAt", "id");
