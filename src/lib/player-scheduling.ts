import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { matchRevision } from "@/lib/player-security";
import { normalizePlayerWeeklyAvailabilityPayload } from "@/lib/scheduled-matches";
import { validateAvailabilityRanges, schedulingJson } from "@/lib/scheduling-ai";
import { commonSlots, MATCH_MS, overlap, warsawInstant, warsawParts } from "@/lib/scheduling-slots";

export async function playerOverview(playerId: string) {
  const db = getDb();
  const [player, availabilities, weeklyAvailability, matches] = await Promise.all([
    db.player.findUniqueOrThrow({ where: { id: playerId }, select: { fullName: true, phone: true, league: true, season: true } }),
    db.playerAvailability.findMany({ where: { playerId, endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } }),
    db.playerWeeklyAvailability.findMany({ where: { playerId }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
    db.scheduledMatch.findMany({ where: { OR: [{ playerOneId: playerId }, { playerTwoId: playerId }], scheduledAt: { gt: new Date(Date.now() - MATCH_MS) }, status: { notIn: ["anulowany", "rozegrany"] } }, include: { replies: true }, orderBy: { scheduledAt: "asc" } }),
  ]);
  return { player, availabilities, weeklyAvailability, matches: matches.map((m) => ({ id: m.id, playerOne: m.playerOne, playerTwo: m.playerTwo, scheduledAt: m.scheduledAt, location: m.location, status: m.status, revision: matchRevision(m), reply: m.replies.find((r) => r.playerId === playerId && r.revision === matchRevision(m))?.accepted ?? null, confirmations: m.replies.filter((r) => r.revision === matchRevision(m) && r.accepted).length })) };
}
export async function saveAvailability(playerId: string, ranges: unknown) {
  const validated = validateAvailabilityRanges(ranges);
  await getDb().playerAvailability.createMany({ data: validated.map((r) => ({ playerId, kind: r.kind, startsAt: new Date(r.startsAt), endsAt: new Date(r.endsAt), summary: r.summary, source: "reczne" })) });
}
export async function saveWeekly(playerId: string, value: unknown) {
  if (!Array.isArray(value) || value.length > 30) throw new Error("Niepoprawna dostępność tygodniowa.");
  if (value.some((r) => !r || typeof r.startTime !== "string" || typeof r.endTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.endTime) || typeof r.notes !== "string")) throw new Error("Podaj poprawne godziny dostępności.");
  const normalized = normalizePlayerWeeklyAvailabilityPayload({ weeklyAvailability: value });
  await getDb().$transaction(async (tx) => {
    await tx.playerWeeklyAvailability.deleteMany({ where: { playerId } });
    await tx.playerWeeklyAvailability.createMany({ data: normalized.weeklyAvailability.map((r) => ({ ...r, playerId })) });
  });
}
export async function lockScheduledMatch(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "ScheduledMatch" WHERE "id" = ${id} FOR UPDATE`;
  return tx.scheduledMatch.findUnique({ where: { id } });
}

export async function recordMatchReply(
  tx: Prisma.TransactionClient, match: { id: string; playerOneId: string | null; playerTwoId: string | null },
  playerId: string, revision: string, accepted: boolean, alternative: string | null = null,
) {
  const matchId = match.id;
  await tx.matchReply.upsert({
    where: { matchId_playerId_revision: { matchId, playerId, revision } },
    create: { matchId, playerId, revision, accepted, alternative },
    update: { accepted, alternative, createdAt: new Date() },
  });
  const replies = await tx.matchReply.findMany({ where: { matchId, revision } });
  const both = match.playerOneId !== match.playerTwoId
    && [match.playerOneId, match.playerTwoId].every((pid) => replies.some((r) => r.playerId === pid && r.accepted));
  const refused = replies.some((reply) => !reply.accepted);
  await tx.scheduledMatch.update({
    where: { id: matchId }, data: { status: refused ? "propozycja" : both ? "potwierdzony" : "oczekuje" },
  });
  return { confirmed: both && !refused };
}

export async function replyToMatch(playerId: string, id: string, revision: string, accepted: boolean) {
  return getDb().$transaction(async (tx) => {
    const match = await lockScheduledMatch(tx, id);
    if (!match || ![match.playerOneId, match.playerTwoId].includes(playerId)) throw new Error("Brak dostępu do meczu.");
    if (["anulowany", "rozegrany"].includes(match.status) || match.scheduledAt <= new Date()) throw new Error("Ten mecz nie przyjmuje potwierdzeń.");
    if (matchRevision(match) !== revision) throw new Error("Termin zmienił się. Odśwież stronę i sprawdź nową propozycję.");
    return recordMatchReply(tx, match, playerId, revision, accepted);
  });
}

export async function generateWebsiteProposals() {
  const db = getDb();
  const now = Date.now(), horizon = now + 21 * 86400000;
  const [players, courts, matches, history] = await Promise.all([
    db.player.findMany({ where: { status: "aktywny" }, include: { availabilities: true, weeklyAvailability: true, blockedPeriods: true } }),
    db.court.findMany({ where: { isActive: true } }),
    db.scheduledMatch.findMany({ where: { status: { not: "anulowany" } } }),
    db.matchHistory.findMany(),
  ]);
  const windows = new Map<string, Array<[number, number]>>();
  for (const player of players) {
    const ranges: Array<[number, number]> = player.availabilities.filter((a) => a.kind === "dostepny").map((a) => [a.startsAt.getTime(), a.endsAt.getTime()]);
    for (let offset = 0; offset <= 21; offset++) {
      const day = warsawParts(new Date(now + offset * 86400000)).day;
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
      for (const w of player.weeklyAvailability.filter((w) => w.weekday === weekday)) {
        try { ranges.push([warsawInstant(day, w.startTime), warsawInstant(day, w.endTime)]); } catch { /* DST gap: skip. */ }
      }
    }
    windows.set(player.id, ranges);
  }
  const drafts: Prisma.MatchProposalCreateManyInput[] = [];
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    if (a.league !== b.league || a.season !== b.season) continue;
    const pair = (m: { playerOneId: string | null; playerTwoId: string | null; league: string; season: string }) => m.league === a.league && m.season === a.season && ((m.playerOneId === a.id && m.playerTwoId === b.id) || (m.playerOneId === b.id && m.playerTwoId === a.id));
    if (matches.some(pair) || history.some(pair)) continue;
    let added = 0;
    for (const start of commonSlots(windows.get(a.id) || [], windows.get(b.id) || [], now, horizon)) {
      const end = start + MATCH_MS;
      const blocked = [a, b].some((p) => (p.inactiveUntil && p.inactiveUntil.getTime() > start)
        || p.availabilities.some((r) => r.kind === "niedostepny" && overlap(start, end, r.startsAt.getTime(), r.endsAt.getTime()))
        || p.blockedPeriods.some((r) => overlap(start, end, r.startsAt.getTime(), r.endsAt.getTime()))
        || matches.some((m) => [m.playerOneId, m.playerTwoId].includes(p.id) && overlap(start, end, m.scheduledAt.getTime(), m.scheduledAt.getTime() + MATCH_MS)));
      if (blocked) continue;
      const localStart = warsawParts(new Date(start)), localEnd = warsawParts(new Date(end));
      const court = courts.find((c) => localStart.day === localEnd.day && localStart.time >= c.openingTime && localEnd.time <= c.closingTime
        && !matches.some((m) => m.courtId === c.id && overlap(start, end, m.scheduledAt.getTime(), m.scheduledAt.getTime() + MATCH_MS)));
      if (!court) continue;
      drafts.push({ season: a.season, league: a.league, playerOneId: a.id, playerTwoId: b.id, courtId: court.id, proposedStartsAt: new Date(start), proposedEndsAt: new Date(end), score: 100 - (start - now) / 86400000, rationale: "Wspólne 90 minut dostępności obu graczy; wolny kort w godzinach otwarcia.", feedback: "", status: "draft" });
      if (++added >= 3) break;
    }
  }
  // LLM may only rank existing, validated slots; it cannot invent a booking.
  const candidates = drafts.slice(0, 80);
  const ranked = candidates.length ? await schedulingJson(`Uszereguj propozycje meczu. Preferuj wcześniejsze terminy. Nie dodawaj nowych propozycji. Zwróć indeksy i krótkie uzasadnienia po polsku. Dane: ${JSON.stringify(candidates.map((d, index) => ({ index, startsAt: d.proposedStartsAt, score: d.score })))}`, { type: "object", properties: { picks: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, reason: { type: "string" } }, required: ["index", "reason"] } } }, required: ["picks"] }) as { picks?: Array<{ index: number; reason: string }> } | null : null;
  if (Array.isArray(ranked?.picks)) for (const [position, pick] of ranked.picks.entries()) {
    if (Number.isInteger(pick.index) && candidates[pick.index] && typeof pick.reason === "string") { candidates[pick.index].score = 200 - position; candidates[pick.index].rationale += ` ${pick.reason.slice(0, 300)}`; }
  }
  await db.$transaction(async (tx) => {
    await tx.matchProposal.deleteMany({ where: { status: "draft", sourceSmsId: null } });
    if (drafts.length) await tx.matchProposal.createMany({ data: drafts });
  });
  return drafts.length;
}

export async function acceptWebsiteProposal(id: string, adminUserId: string) {
  const db = getDb();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE "ScheduledMatch" IN EXCLUSIVE MODE`;
    const proposal = await tx.matchProposal.findUnique({ where: { id } });
    if (!proposal || proposal.status !== "draft") throw new Error("Propozycja nie istnieje lub została już rozpatrzona.");
    const start = proposal.proposedStartsAt.getTime(), end = proposal.proposedEndsAt.getTime();
    if (start <= Date.now() || end - start !== MATCH_MS || !proposal.courtId) throw new Error("Propozycja jest nieaktualna. Przelicz terminy ponownie.");
    const [players, court, matches, played] = await Promise.all([
      tx.player.findMany({ where: { id: { in: [proposal.playerOneId, proposal.playerTwoId] } }, include: { availabilities: true, weeklyAvailability: true, blockedPeriods: true } }),
      tx.court.findUnique({ where: { id: proposal.courtId } }),
      tx.scheduledMatch.findMany({ where: { status: { not: "anulowany" } } }),
      tx.matchHistory.findMany({ where: { season: proposal.season, league: proposal.league } }),
    ]);
    const localStart = warsawParts(new Date(start)), localEnd = warsawParts(new Date(end));
    const weekday = new Date(`${localStart.day}T12:00:00Z`).getUTCDay() || 7;
    if (!court?.isActive || localStart.day !== localEnd.day || localStart.time < court.openingTime || localEnd.time > court.closingTime) throw new Error("Kort nie jest dostępny w tym terminie.");
    if (players.length !== 2 || players.some((p) => p.status !== "aktywny" || p.season !== proposal.season || p.league !== proposal.league
      || (p.inactiveUntil && p.inactiveUntil.getTime() > start)
      || p.blockedPeriods.some((r) => overlap(start, end, r.startsAt.getTime(), r.endsAt.getTime()))
      || p.availabilities.some((r) => r.kind === "niedostepny" && overlap(start, end, r.startsAt.getTime(), r.endsAt.getTime()))
      || !(p.availabilities.some((r) => r.kind === "dostepny" && r.startsAt.getTime() <= start && r.endsAt.getTime() >= end)
        || p.weeklyAvailability.some((w) => w.weekday === weekday && w.startTime <= localStart.time && w.endTime >= localEnd.time)))) throw new Error("Dostępność graczy zmieniła się. Przelicz propozycje ponownie.");
    const samePair = (m: { playerOneId: string | null; playerTwoId: string | null }) => [m.playerOneId, m.playerTwoId].includes(proposal.playerOneId) && [m.playerOneId, m.playerTwoId].includes(proposal.playerTwoId);
    if (played.some(samePair) || matches.some((m) => (samePair(m) && m.season === proposal.season && m.league === proposal.league)
      || ((m.courtId === court.id || [m.playerOneId, m.playerTwoId].some((pid) => pid === proposal.playerOneId || pid === proposal.playerTwoId)) && overlap(start, end, m.scheduledAt.getTime(), m.scheduledAt.getTime() + MATCH_MS)))) throw new Error("Gracz lub kort ma już mecz w tym terminie albo ta para jest już umówiona.");
    const a = players.find((p) => p.id === proposal.playerOneId)!, b = players.find((p) => p.id === proposal.playerTwoId)!;
    const match = await tx.scheduledMatch.create({ data: { season: proposal.season, league: proposal.league, playerOneId: a.id, playerOne: a.fullName, playerOnePhone: a.phone, playerTwoId: b.id, playerTwo: b.fullName, playerTwoPhone: b.phone, courtId: court.id, scheduledAt: proposal.proposedStartsAt, location: court.location || court.name, status: "oczekuje", adminNotes: proposal.rationale, createdBy: adminUserId } });
    await tx.matchProposal.update({ where: { id }, data: { status: "accepted" } });
    return match;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
