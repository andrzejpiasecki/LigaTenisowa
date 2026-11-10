import { NextResponse } from "next/server";
import { listMatchSmsStatuses } from "@/lib/match-sms";
import { requireAdminUser } from "@/lib/admin";
import { listCourtsFromDb, listScheduledMatchesFromDb } from "@/lib/scheduled-matches-db";

export async function GET() {
  const { isAdmin } = await requireAdminUser();
  if (!isAdmin) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  try {
    const [matches, courts] = await Promise.all([
      listScheduledMatchesFromDb(), listCourtsFromDb(),
    ]);
    const smsStatuses = await listMatchSmsStatuses(matches.filter((match) => match.status !== "rozegrany" && match.status !== "anulowany"));
    return NextResponse.json({ matches, courts, smsStatuses });
  } catch {
    return NextResponse.json({ error: "Nie udało się pobrać terminarza." }, { status: 500 });
  }
}
