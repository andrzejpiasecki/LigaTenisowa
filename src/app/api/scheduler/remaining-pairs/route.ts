import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { fetchRemainingPairs } from "@/lib/results-matches";
import { listPlayersFromDb } from "@/lib/scheduled-matches-db";

export async function GET(request: NextRequest) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  const seasonId = request.nextUrl.searchParams.get("seasonId") || "";
  const leagueId = request.nextUrl.searchParams.get("leagueId") || "";

  if (!seasonId || !leagueId) {
    return NextResponse.json({ pairs: [] });
  }

  try {
    const players = await listPlayersFromDb();
    const pairs = await fetchRemainingPairs({
      seasonId,
      leagueId,
      players,
    });
    return NextResponse.json({ pairs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się pobrać par pozostałych do rozegrania." },
      { status: 400 },
    );
  }
}
