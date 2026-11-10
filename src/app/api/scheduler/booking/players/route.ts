import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { fetchSeasonResults } from "@/lib/results-matches";
import { getBookingLeague } from "@/lib/booking-league";

export async function GET(request: Request) {
  const { isAdmin } = await requireAdminUser();
  if (!isAdmin) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("seasonId") || "";
  const leagueId = searchParams.get("leagueId") || "";
  if (seasonId && searchParams.get("view") === "season-results") {
    try {
      return NextResponse.json({ matches: await fetchSeasonResults(seasonId) });
    } catch {
      return NextResponse.json({ error: "Nie udało się pobrać wyników sezonu." }, { status: 502 });
    }
  }
  if (!seasonId || !leagueId) return NextResponse.json({ players: [], results: { participants: [], playedPairKeys: [], fivePointPairKeys: [], recordedMatches: [] } });

  try {
    return NextResponse.json(await getBookingLeague(seasonId, leagueId));
  } catch {
    return NextResponse.json({ error: "Nie udało się pobrać zawodników i wyników tej ligi." }, { status: 502 });
  }
}
