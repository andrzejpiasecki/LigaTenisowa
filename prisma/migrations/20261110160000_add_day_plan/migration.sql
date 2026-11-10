ALTER TABLE "ScheduledMatch" ADD COLUMN "dayPlan" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ScheduledMatch_dayPlan_scheduledAt_idx" ON "ScheduledMatch"("dayPlan", "scheduledAt");
