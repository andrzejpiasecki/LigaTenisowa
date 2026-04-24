ALTER TABLE "liga_tenisowa"."ScheduledMatch"
ALTER COLUMN "scheduledAt"
TYPE TIMESTAMPTZ(3)
USING "scheduledAt" AT TIME ZONE 'Europe/Warsaw';
