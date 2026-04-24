import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { buildPlayerResultsMatches, fetchResultsDirectory } from "@/lib/results-directory";
import { fetchLeagueParticipants } from "@/lib/results-matches";
import {
  importPlayersFromResultsDirectoryInDb,
  listPlayersFromDb,
  syncPlayersLeagueAssignmentInDb,
} from "@/lib/scheduled-matches-db";

export async function GET() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const [players, directory] = await Promise.all([
      listPlayersFromDb(),
      fetchResultsDirectory(),
    ]);

    return NextResponse.json({
      players,
      directory,
      matches: buildPlayerResultsMatches(players, directory),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się pobrać bazy zawodników." },
      { status: 400 },
    );
  }
}

export async function POST() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const directory = await fetchResultsDirectory();
    const summary = await importPlayersFromResultsDirectoryInDb(directory);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zaimportować zawodników z wyników." },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = await request.json() as { seasonId?: string; leagueId?: string };
    const participants = await fetchLeagueParticipants({
      seasonId: payload.seasonId || "",
      leagueId: payload.leagueId || "",
    });

    const summary = await syncPlayersLeagueAssignmentInDb({
      season: participants.seasonLabel,
      league: participants.leagueLabel,
      participantIds: participants.participants.map((participant) => participant.value),
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zsynchronizować przypisania ligi." },
      { status: 400 },
    );
  }
}
