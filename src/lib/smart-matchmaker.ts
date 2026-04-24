import {
  type Court,
  type InboundSms,
  type MatchHistory,
  type Player,
  type PlayerAvailability,
  type ScheduledMatch,
} from "@/lib/scheduled-matches";

type ProposalDraft = {
  season: string;
  league: string;
  playerOneId: string;
  playerTwoId: string;
  courtId: string;
  proposedStartsAt: string;
  proposedEndsAt: string;
  score: number;
  rationale: string;
};

type MatchmakerCandidate = ProposalDraft & {
  candidateName: string;
  courtName: string;
  heuristicScore: number;
  pendingMatches: number;
  historyFit: string;
};

type MatchmakerAiChoice = {
  picks: Array<{
    playerTwoId: string;
    courtId: string;
    score: number;
    rationale: string;
  }>;
};

const OPENAI_MATCHMAKER_MODEL = process.env.OPENAI_MATCHMAKER_MODEL || process.env.OPENAI_SMS_MODEL || "gpt-4o-mini";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function hoursFromIso(value: string) {
  return new Date(value).getHours() + new Date(value).getMinutes() / 60;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return new Date(startA).getTime() < new Date(endB).getTime()
    && new Date(endA).getTime() > new Date(startB).getTime();
}

function getBehaviorPreference(playerId: string, history: MatchHistory[]) {
  const relevant = history.filter((entry) => entry.playerOneId === playerId || entry.playerTwoId === playerId);

  if (!relevant.length) {
    return null;
  }

  const averageHour = relevant.reduce((sum, entry) => sum + hoursFromIso(entry.playedAt), 0) / relevant.length;
  return averageHour;
}

function countPendingPairMatches(params: {
  playerOneId: string;
  playerTwoId: string;
  season: string;
  league: string;
  history: MatchHistory[];
  matches: ScheduledMatch[];
}) {
  const alreadyPlayed = params.history.some((entry) => {
    const samePair =
      (entry.playerOneId === params.playerOneId && entry.playerTwoId === params.playerTwoId)
      || (entry.playerOneId === params.playerTwoId && entry.playerTwoId === params.playerOneId);
    return samePair && entry.season === params.season && entry.league === params.league;
  });

  const alreadyScheduled = params.matches.some((match) => {
    const samePair =
      (match.playerOneId === params.playerOneId && match.playerTwoId === params.playerTwoId)
      || (match.playerOneId === params.playerTwoId && match.playerTwoId === params.playerOneId);
    return samePair && match.season === params.season && match.league === params.league && match.status !== "anulowany";
  });

  if (alreadyPlayed || alreadyScheduled) {
    return 0;
  }

  return 1;
}

function playerBlocked(params: {
  player: Player;
  start: string;
  end: string;
  availabilities: PlayerAvailability[];
  matches: ScheduledMatch[];
}) {
  if (params.player.status === "nieaktywny" && (!params.player.inactiveUntil || new Date(params.player.inactiveUntil).getTime() > new Date(params.start).getTime())) {
    return true;
  }

  const unavailableBlock = params.availabilities.some((entry) => {
    return entry.playerId === params.player.id
      && entry.kind === "niedostepny"
      && rangesOverlap(entry.startsAt, entry.endsAt, params.start, params.end);
  });

  if (unavailableBlock) {
    return true;
  }

  return params.matches.some((match) => {
    if (match.status === "anulowany") {
      return false;
    }

    const involved = match.playerOneId === params.player.id || match.playerTwoId === params.player.id;
    if (!involved) {
      return false;
    }

    const matchEnd = new Date(new Date(match.scheduledAt).getTime() + 90 * 60 * 1000).toISOString();
    return rangesOverlap(match.scheduledAt, matchEnd, params.start, params.end);
  });
}

function courtBlocked(courtId: string, start: string, end: string, matches: ScheduledMatch[]) {
  return matches.some((match) => {
    if (match.courtId !== courtId || match.status === "anulowany") {
      return false;
    }

    const matchEnd = new Date(new Date(match.scheduledAt).getTime() + 90 * 60 * 1000).toISOString();
    return rangesOverlap(match.scheduledAt, matchEnd, start, end);
  });
}

function playerExplicitlyAvailable(playerId: string, start: string, end: string, availabilities: PlayerAvailability[]) {
  const exactPositive = availabilities.find((entry) => {
    return entry.playerId === playerId
      && entry.kind === "dostepny"
      && rangesOverlap(entry.startsAt, entry.endsAt, start, end);
  });

  return Boolean(exactPositive);
}

function heuristicCandidates(params: {
  sms: InboundSms;
  players: Player[];
  courts: Court[];
  availabilities: PlayerAvailability[];
  matches: ScheduledMatch[];
  history: MatchHistory[];
}) {
  const sourcePlayer = params.players.find((player) => player.id === params.sms.matchedPlayerId);
  const start = params.sms.parsedStartsAt;
  const end = params.sms.parsedEndsAt || new Date(new Date(start).getTime() + 90 * 60 * 1000).toISOString();

  if (!sourcePlayer || !start) {
    return [];
  }

  const sourcePreference = getBehaviorPreference(sourcePlayer.id, params.history);

  return params.players
    .filter((candidate) => {
      return candidate.id !== sourcePlayer.id
        && candidate.league === sourcePlayer.league
        && candidate.season === sourcePlayer.season
        && candidate.status === "aktywny";
    })
    .flatMap((candidate) => {
      const pendingMatches = countPendingPairMatches({
        playerOneId: sourcePlayer.id,
        playerTwoId: candidate.id,
        season: sourcePlayer.season,
        league: sourcePlayer.league,
        history: params.history,
        matches: params.matches,
      });

      if (!pendingMatches) {
        return [];
      }

      if (playerBlocked({
        player: sourcePlayer,
        start,
        end,
        availabilities: params.availabilities,
        matches: params.matches,
      }) || playerBlocked({
        player: candidate,
        start,
        end,
        availabilities: params.availabilities,
        matches: params.matches,
      })) {
        return [];
      }

      const candidatePreference = getBehaviorPreference(candidate.id, params.history);
      const targetHour = hoursFromIso(start);
      const sourceFit = sourcePreference === null ? 0.5 : Math.max(0, 1 - Math.abs(sourcePreference - targetHour) / 8);
      const candidateFit = candidatePreference === null ? 0.5 : Math.max(0, 1 - Math.abs(candidatePreference - targetHour) / 8);
      const explicitAvailabilityBoost = playerExplicitlyAvailable(candidate.id, start, end, params.availabilities) ? 1 : 0;
      const preferencePenalty = normalizeText(candidate.preferences).includes("odpada") ? 0.2 : 0;

      return params.courts
        .filter((court) => court.isActive && !courtBlocked(court.id, start, end, params.matches))
        .map((court) => {
          const heuristicScore = (
            pendingMatches * 4
            + explicitAvailabilityBoost * 2
            + sourceFit * 1.5
            + candidateFit * 2
            - preferencePenalty
          );

          return {
            season: sourcePlayer.season,
            league: sourcePlayer.league,
            playerOneId: sourcePlayer.id,
            playerTwoId: candidate.id,
            courtId: court.id,
            proposedStartsAt: start,
            proposedEndsAt: end,
            score: heuristicScore,
            rationale: "",
            candidateName: candidate.fullName,
            courtName: court.name,
            heuristicScore,
            pendingMatches,
            historyFit: `Historia gry: ${candidatePreference === null ? "brak danych" : `najczęściej około ${candidatePreference.toFixed(1)}`}.`,
          };
        });
    })
    .sort((left, right) => right.heuristicScore - left.heuristicScore)
    .slice(0, 8);
}

async function rerankWithAi(params: {
  sms: InboundSms;
  sourcePlayer: Player;
  candidates: MatchmakerCandidate[];
}) {
  if (!process.env.OPENAI_API_KEY || !params.candidates.length) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MATCHMAKER_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "matchmaker_choices",
          strict: true,
          schema: {
            type: "object",
            properties: {
              picks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    playerTwoId: { type: "string" },
                    courtId: { type: "string" },
                    score: { type: "number" },
                    rationale: { type: "string" },
                  },
                  required: ["playerTwoId", "courtId", "score", "rationale"],
                  additionalProperties: false,
                },
              },
            },
            required: ["picks"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "Jestes AI matchmakerem dla ligi tenisowej.",
            "Wybierz najlepsze drafty meczu dla admina.",
            "Priorytety: zalegle pary w lidze, rzeczywista dostepnosc, preferencje z historii, brak konfliktu kortu.",
            "Zwracaj maksymalnie 5 pozycji.",
            "Rationale ma byc po polsku, praktyczne, jednozdaniowe.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            sms: {
              body: params.sms.body,
              parsedAvailability: params.sms.parsedAvailability,
              parsedSummary: params.sms.parsedSummary,
              parsedStartsAt: params.sms.parsedStartsAt,
              parsedEndsAt: params.sms.parsedEndsAt,
              parsedReason: params.sms.parsedReason,
            },
            sourcePlayer: params.sourcePlayer,
            candidates: params.candidates.map((candidate) => ({
              playerTwoId: candidate.playerTwoId,
              candidateName: candidate.candidateName,
              courtId: candidate.courtId,
              courtName: candidate.courtName,
              proposedStartsAt: candidate.proposedStartsAt,
              proposedEndsAt: candidate.proposedEndsAt,
              heuristicScore: candidate.heuristicScore,
              pendingMatches: candidate.pendingMatches,
              historyFit: candidate.historyFit,
            })),
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return null;
  }

  try {
    return JSON.parse(content) as MatchmakerAiChoice;
  } catch {
    return null;
  }
}

export async function buildSmartProposals(params: {
  sms: InboundSms;
  players: Player[];
  courts: Court[];
  availabilities: PlayerAvailability[];
  matches: ScheduledMatch[];
  history: MatchHistory[];
}) {
  if (!params.sms.matchedPlayerId || !params.sms.parsedStartsAt || params.sms.parsedAvailability === "niedostepny") {
    return [] as ProposalDraft[];
  }

  const sourcePlayer = params.players.find((player) => player.id === params.sms.matchedPlayerId);
  if (!sourcePlayer) {
    return [] as ProposalDraft[];
  }

  const candidates = heuristicCandidates(params);
  if (!candidates.length) {
    return [] as ProposalDraft[];
  }

  const aiChoice = await rerankWithAi({
    sms: params.sms,
    sourcePlayer,
    candidates,
  });

  if (aiChoice?.picks?.length) {
    const byKey = new Map(candidates.map((candidate) => [`${candidate.playerTwoId}:${candidate.courtId}`, candidate]));
    return aiChoice.picks
      .map((pick) => {
        const candidate = byKey.get(`${pick.playerTwoId}:${pick.courtId}`);
        if (!candidate) {
          return null;
        }

        return {
          season: candidate.season,
          league: candidate.league,
          playerOneId: candidate.playerOneId,
          playerTwoId: candidate.playerTwoId,
          courtId: candidate.courtId,
          proposedStartsAt: candidate.proposedStartsAt,
          proposedEndsAt: candidate.proposedEndsAt,
          score: pick.score,
          rationale: pick.rationale,
        };
      })
      .filter((value): value is ProposalDraft => Boolean(value))
      .slice(0, 5);
  }

  return candidates.slice(0, 5).map((candidate) => ({
    season: candidate.season,
    league: candidate.league,
    playerOneId: candidate.playerOneId,
    playerTwoId: candidate.playerTwoId,
    courtId: candidate.courtId,
    proposedStartsAt: candidate.proposedStartsAt,
    proposedEndsAt: candidate.proposedEndsAt,
    score: candidate.heuristicScore,
    rationale: `${sourcePlayer.fullName} i ${candidate.candidateName} są wolni w tym oknie, a kort ${candidate.courtName} nie ma konfliktu.`,
  }));
}
