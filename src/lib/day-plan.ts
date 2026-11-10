import { type Prisma, type ScheduledMatch } from "@prisma/client";
import { fetchSeasonResultsWithLabel } from "@/lib/results-matches";
import { getDb } from "@/lib/db";
import { dayPlanDrafts, MAX_PLAN_MATCHES, planPair, type DayCandidate } from "@/lib/day-plan-engine";
import type { DayPlanBooking } from "@/lib/day-plan-types";
import { listMatchSmsStatuses } from "@/lib/match-sms";
import { matchRevision, normalizePlayerPhone } from "@/lib/player-security";
import { normalizePersonName } from "@/lib/results-directory";
import { MATCH_MS, overlap, warsawInstant, warsawParts } from "@/lib/scheduling-slots";

type Client = Prisma.TransactionClient;
type SeasonResults = Awaited<ReturnType<typeof fetchSeasonResultsWithLabel>>;
export class DayPlanError extends Error {}

function dayBounds(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "2000-01-01" || day > "2100-12-31") throw new DayPlanError("Nieprawidłowa data planu.");
  try {
    const midnight = Date.parse(`${day}T00:00:00Z`);
    const next = new Date(midnight + 86400000).toISOString().slice(0, 10);
    return [warsawInstant(day, "00:00"), warsawInstant(next, "00:00")] as const;
  } catch { throw new DayPlanError("Nieprawidłowa data planu."); }
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function polishPhone(raw: string | null) {
  try {
    const value = normalizePlayerPhone(raw || "");
    return /^\+48\d{9}$/.test(value) ? value : "";
  } catch { return ""; }
}

function seasonScope(season: string) {
  if (!season || season.length > 120) throw new DayPlanError("Wybierz sezon.");
  return { season };
}

export async function getDayPlanBookings(day: string, season: string): Promise<DayPlanBooking[]> {
  const [from, to] = dayBounds(day);
  const matches = await getDb().scheduledMatch.findMany({
    where: { ...seasonScope(season), dayPlan: true, scheduledAt: { gte: new Date(from), lt: new Date(to) }, status: { not: "anulowany" } },
    include: { court: { select: { name: true } } },
    orderBy: [{ scheduledAt: "asc" }, { courtId: "asc" }],
  });
  const statuses = await listMatchSmsStatuses(matches);
  return matches.map((match) => {
    const recipients = statuses[match.id];
    const declined = recipients.some((r) => r.reply === "no" || r.reply === "alternative");
    return {
      id: match.id, league: match.league, court: match.court?.name || match.location, startsAt: match.scheduledAt.toISOString(),
      playerOne: match.playerOne, playerTwo: match.playerTwo, status: match.status, recipients, declined,
      canSend: !declined && ["propozycja", "oczekuje"].includes(match.status) && match.scheduledAt > new Date()
        && recipients.some((r) => !r.reply && ["not_sent", "queued", "failed", "cancelled"].includes(r.status)),
    };
  });
}

async function prepareDay(tx: Client, day: string, results: SeasonResults) {
  const [from, to] = dayBounds(day);
  const now = Date.now();
  if (to <= now) throw new DayPlanError("Wybierz dzień w przyszłości.");
  const season = seasonScope(results.season);
  const earlier = new Date(now - 365 * 86400000);
  const players = await tx.player.findMany({
    include: {
      availabilities: { where: { startsAt: { lt: new Date(to) }, endsAt: { gt: new Date(from) } } },
      weeklyAvailability: true,
      blockedPeriods: { where: { startsAt: { lt: new Date(to) }, endsAt: { gt: new Date(from) } } },
    },
  });
  const playersById = new Map(players.map((player) => [player.id, player]));
  const byName = new Map<string, string | null>();
  const byLeagueName = new Map<string, string | null>();
  const leaguesByPlayer = new Map<string, Set<string>>();
  function rememberName(index: Map<string, string | null>, key: string, id: string) {
    index.set(key, index.has(key) && index.get(key) !== id ? null : id);
  }
  function addMembership(id: string, league: string) {
    const leagues = leaguesByPlayer.get(id) ?? new Set<string>();
    leagues.add(league);
    leaguesByPlayer.set(id, leagues);
  }
  for (const player of players) {
    for (const name of new Set([normalizePersonName(player.resultsPlayerName || player.fullName), normalizePersonName(player.fullName)])) {
      rememberName(byName, name, player.id);
      if (player.season === season.season && player.league) {
        rememberName(byLeagueName, JSON.stringify([player.league, name]), player.id);
      }
    }
    if (player.season === season.season && player.league) addMembership(player.id, player.league);
  }
  const findPlayer = (league: string, name: string) => {
    const normalized = normalizePersonName(name);
    const key = JSON.stringify([league, normalized]);
    return byLeagueName.has(key) ? byLeagueName.get(key) : byName.get(normalized);
  };
  const recorded = results.matches.map((match) => ({
    match,
    winner: findPlayer(match.league, match.winner),
    loser: findPlayer(match.league, match.loser),
  }));
  for (const { match, winner, loser } of recorded) {
    if (winner) addMembership(winner, match.league);
    if (loser) addMembership(loser, match.league);
  }
  const ids = [...leaguesByPlayer.keys()];
  const [courts, matches, history, confirmed] = await Promise.all([
    tx.court.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    tx.scheduledMatch.findMany({
      where: { OR: [season, { scheduledAt: { gt: new Date(from - MATCH_MS), lt: new Date(to) } }] },
      include: { replies: { where: { accepted: false } } }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    }),
    tx.matchHistory.findMany({
      where: { OR: [season, { playedAt: { gte: earlier, lt: new Date(now) }, OR: [{ playerOneId: { in: ids } }, { playerTwoId: { in: ids } }] }] },
      select: { playerOneId: true, playerTwoId: true, season: true, league: true, playedAt: true },
    }),
    tx.matchReply.findMany({
      where: { playerId: { in: ids }, accepted: true, match: { scheduledAt: { gte: earlier, lt: new Date(now) }, status: { not: "anulowany" } } },
      include: { match: true },
    }),
  ]);

  const matchPlayers = (m: ScheduledMatch) => [m.playerOneId || findPlayer(m.league, m.playerOne) || "",
    m.playerTwoId || findPlayer(m.league, m.playerTwo) || ""];
  const blockedPairs = new Set<string>();
  const preferences = new Map<string, DayCandidate["preferences"]>();
  const seen = new Set<string>();
  function addPreference(id: string, date: string, minute?: number) {
    const key = JSON.stringify([id, date, minute]);
    if (seen.has(key)) return;
    seen.add(key);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!Number.isFinite(weekday)) return;
    const entries = preferences.get(id) ?? [];
    entries.push({ weekday, minute });
    preferences.set(id, entries);
  }
  for (const { match, winner, loser } of recorded) {
    if (winner && loser) blockedPairs.add(planPair(match.league, winner, loser));
    if (winner) addPreference(winner, match.date);
    if (loser) addPreference(loser, match.date);
  }
  for (const m of history) {
    if (m.season === season.season) blockedPairs.add(planPair(m.league, m.playerOneId, m.playerTwoId));
    if (m.playedAt.getTime() < now && m.playedAt >= earlier) {
      const local = warsawParts(m.playedAt);
      for (const id of [m.playerOneId, m.playerTwoId]) addPreference(id, local.day, minutes(local.time));
    }
  }
  for (const reply of confirmed) {
    if (matchRevision(reply.match) !== reply.revision) continue;
    const local = warsawParts(reply.match.scheduledAt);
    addPreference(reply.playerId, local.day, minutes(local.time));
  }

  const refusals = new Map<string, Array<[number, number]>>();
  const replacements = [];
  const bookings = [];
  for (const m of matches) {
    const pair = matchPlayers(m);
    const start = m.scheduledAt.getTime();
    const inDay = overlap(start, start + MATCH_MS, from, to);
    const inSeason = m.season === season.season;
    const negative = m.replies.filter((r) => r.revision === matchRevision(m));
    if (inSeason && pair.every(Boolean) && (m.status !== "anulowany" || (inDay && negative.length))) {
      blockedPairs.add(planPair(m.league, pair[0], pair[1]));
    }
    if (!inDay) continue;
    if (m.status !== "anulowany") bookings.push({ id: m.id, courtId: m.courtId, start, players: pair.filter(Boolean) });
    for (const reply of negative) {
      const windows = refusals.get(reply.playerId) ?? [];
      windows.push([start, start + MATCH_MS]);
      refusals.set(reply.playerId, windows);
    }
    if (inSeason && m.dayPlan && m.courtId && negative.length && start >= from && start > now
      && ["propozycja", "oczekuje"].includes(m.status)) {
      replacements.push({ id: m.id, league: m.league, courtId: m.courtId, start, minute: minutes(warsawParts(m.scheduledAt).time) });
    }
  }
  const phoneCounts = new Map<string, number>();
  for (const row of players) {
    const phone = polishPhone(row.phone);
    if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
  }
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const candidates: DayCandidate[] = players
    .filter((p) => leaguesByPlayer.has(p.id) && p.status === "aktywny" && phoneCounts.get(polishPhone(p.phone)) === 1)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "pl") || a.id.localeCompare(b.id))
    .flatMap((p) => {
      const available: DayCandidate["available"] = p.availabilities.filter((a) => a.kind === "dostepny").map((a) => [a.startsAt.getTime(), a.endsAt.getTime()]);
      for (const w of p.weeklyAvailability.filter((w) => w.weekday === weekday)) {
        try { available.push([warsawInstant(day, w.startTime), warsawInstant(day, w.endTime)]); } catch { /* Ignore invalid local times. */ }
      }
      const blocked: DayCandidate["blocked"] = [
        ...p.availabilities.filter((a) => a.kind === "niedostepny").map((a): [number, number] => [a.startsAt.getTime(), a.endsAt.getTime()]),
        ...p.blockedPeriods.map((a): [number, number] => [a.startsAt.getTime(), a.endsAt.getTime()]),
        ...(refusals.get(p.id) ?? []),
      ];
      if (p.inactiveUntil) blocked.push([from, p.inactiveUntil.getTime()]);
      return [...leaguesByPlayer.get(p.id)!].map((league) => ({
        id: p.id, name: p.fullName, league, skill: p.skillLevel, available, blocked, preferences: preferences.get(p.id) ?? [],
      }));
    });
  return {
    drafts: dayPlanDrafts({ day, now, players: candidates, courts, bookings, blockedPairs, replacements }),
    playerCount: new Set(candidates.map((candidate) => candidate.id)).size, rosterCount: ids.length, season: season.season,
    players: playersById,
    courts: new Map(courts.map((court) => [court.id, court])),
  };
}

export async function previewDayPlan(day: string, seasonId: string) {
  dayBounds(day);
  const results = await fetchSeasonResultsWithLabel(seasonId);
  const { drafts, playerCount, rosterCount } = await prepareDay(getDb(), day, results);
  return { drafts, playerCount, rosterCount };
}

export async function saveDayPlan(day: string, seasonId: string, keys: string[], userId: string) {
  dayBounds(day);
  const selected = new Set(keys);
  if (!selected.size || selected.size > MAX_PLAN_MATCHES || selected.size !== keys.length) throw new DayPlanError("Wybierz propozycje do zapisania.");
  const results = await fetchSeasonResultsWithLabel(seasonId);
  const db = getDb();
  return db.$transaction(async (tx) => {
    // Keep booking writes and reply row locks outside the slot check and replacement.
    await tx.$executeRaw`LOCK TABLE "ScheduledMatch" IN EXCLUSIVE MODE`;
    const data = await prepareDay(tx, day, results);
    const drafts = data.drafts.filter((draft) => selected.has(draft.key));
    if (drafts.length !== selected.size) throw new DayPlanError("Plan się zmienił. Odśwież propozycje i zatwierdź ponownie.");
    for (const draft of drafts) {
      if (draft.replacementFor) {
        // Keep the original reservation until a replacement is approved.
        await tx.scheduledMatch.update({ where: { id: draft.replacementFor }, data: { status: "anulowany" } });
      }
    }
    const matches = await tx.scheduledMatch.createManyAndReturn({ select: { id: true }, data: drafts.map((draft) => {
      const a = data.players.get(draft.playerOneId)!;
      const b = data.players.get(draft.playerTwoId)!;
      const court = data.courts.get(draft.courtId)!;
      return {
        dayPlan: true, season: data.season, league: draft.league, playerOneId: a.id, playerOne: a.fullName,
        playerOnePhone: a.phone, playerTwoId: b.id, playerTwo: b.fullName, playerTwoPhone: b.phone,
        courtId: court.id, scheduledAt: new Date(draft.startsAt), location: court.location || court.name,
        status: "propozycja", adminNotes: draft.rationale, createdBy: userId,
      };
    }) });
    return { saved: matches.length, matchIds: matches.map((match) => match.id) };
  }, { timeout: 15000 });
}
