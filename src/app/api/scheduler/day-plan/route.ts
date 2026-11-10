import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { DayPlanError, getDayPlanBookings, previewDayPlan, saveDayPlan } from "@/lib/day-plan";
import { checkOrigin } from "@/lib/player-auth";

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: unknown) => error instanceof DayPlanError ? json({ error: error.message }, 409)
  : json({ error: "Nie udało się obsłużyć planu. Spróbuj odświeżyć widok." }, 500);

export async function GET(request: Request) {
  if (!(await requireAdminUser()).isAdmin) return json({ error: "Brak dostępu." }, 403);
  const p = new URL(request.url).searchParams;
  try { return json({ bookings: await getDayPlanBookings(p.get("day") || "", p.get("season") || "") }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const access = await requireAdminUser();
  if (!access.isAdmin || !access.userId) return json({ error: "Brak dostępu." }, 403);
  try { checkOrigin(request); } catch { return json({ error: "Niedozwolone źródło żądania." }, 403); }
  const data = await request.json().catch(() => null);
  if (!data || typeof data.day !== "string" || typeof data.seasonId !== "string") {
    return json({ error: "Wybierz datę i sezon." }, 400);
  }
  try {
    if (data.action === "preview") return json(await previewDayPlan(data.day, data.seasonId));
    if (data.action === "save" && Array.isArray(data.keys) && data.keys.every((key: unknown) => typeof key === "string" && key.length <= 600)) {
      return json(await saveDayPlan(data.day, data.seasonId, data.keys, access.userId));
    }
    return json({ error: "Nieznana akcja planu." }, 400);
  } catch (error) { return failure(error); }
}
