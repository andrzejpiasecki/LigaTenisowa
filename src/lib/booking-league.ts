import { normalizePersonName } from "@/lib/results-directory";
import { fetchLeagueMatchMatrix } from "@/lib/results-matches";
import { listPlayersFromDb } from "@/lib/scheduled-matches-db";

export async function getBookingLeague(seasonId: string, leagueId: string) {
  const players = await listPlayersFromDb();
  const matrix = await fetchLeagueMatchMatrix({ seasonId, leagueId, players });
  const playersById = new Map(players.map((player) => [player.id, player]));
  const byName = new Map<string, (typeof players)[number] | null>();
  for (const player of players) {
    const key = normalizePersonName(player.resultsPlayerName || player.fullName);
    byName.set(key, byName.has(key) ? null : player);
  }
  const roster: Array<{ key: string; id: string; fullName: string; phone: string }> = [];
  const participants = matrix.participants.map((entry) => {
    const key = normalizePersonName(entry.name);
    const player = playersById.get(entry.playerId) ?? byName.get(key);
    const id = player?.id || "";
    roster.push({ key, id, fullName: player?.fullName || entry.name, phone: player?.phone || "" });
    return { ...entry, playerId: id, isActive: player ? player.status !== "nieaktywny" : entry.isActive };
  });
  return {
    season: matrix.seasonLabel,
    league: matrix.leagueLabel,
    players: roster.sort((a, b) => a.fullName.localeCompare(b.fullName, "pl")),
    results: { participants, playedPairKeys: matrix.playedPairKeys, fivePointPairKeys: matrix.fivePointPairKeys, recordedMatches: matrix.recordedMatches },
  };
}
