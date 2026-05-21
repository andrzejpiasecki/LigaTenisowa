CREATE TABLE "liga_tenisowa"."PlayerWeeklyAvailability" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlayerWeeklyAvailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "liga_tenisowa"."PlayerBlockedPeriod" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlayerBlockedPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerWeeklyAvailability_playerId_weekday_idx"
ON "liga_tenisowa"."PlayerWeeklyAvailability"("playerId", "weekday");

CREATE INDEX "PlayerBlockedPeriod_playerId_startsAt_endsAt_idx"
ON "liga_tenisowa"."PlayerBlockedPeriod"("playerId", "startsAt", "endsAt");

ALTER TABLE "liga_tenisowa"."PlayerWeeklyAvailability"
ADD CONSTRAINT "PlayerWeeklyAvailability_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "liga_tenisowa"."Player"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "liga_tenisowa"."PlayerBlockedPeriod"
ADD CONSTRAINT "PlayerBlockedPeriod_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "liga_tenisowa"."Player"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
