import { normalizePersonName } from "@/lib/results-directory";
import { type Player, type RemainingPair } from "@/lib/scheduled-matches";

const TARGET_ORIGIN = "http://tenisv.pl";

type ResultsMatch = {
  winner: string;
  loser: string;
  leagueName: string;
};

type LeagueParticipant = {
  value: string;
  label: string;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractMainFrameSrc(html: string) {
  const match = html.match(/<frame[^>]+name=["']main["'][^>]+src=["']([^"']+)["']/i);
  return match?.[1] || "mecze/start.php";
}

function parseOptions(html: string, selectName: string) {
  const selectMatch = html.match(new RegExp(`<select[^>]+name=["']${selectName}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"));
  if (!selectMatch) {
    return [];
  }

  const options = [];
  const optionPattern = /<option[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  for (const match of selectMatch[1].matchAll(optionPattern)) {
    const value = normalizeWhitespace(decodeHtmlEntities(match[1] || ""));
    const label = normalizeWhitespace(decodeHtmlEntities((match[2] || "").replace(/<[^>]+>/g, "")));
    if (!value || !label) {
      continue;
    }
    options.push({ value, label });
  }
  return options;
}

function readFormDefaults(html: string) {
  const formMatch = html.match(/<form[\s\S]*?name=["']formularz["'][\s\S]*?<\/form>/i);
  const formHtml = formMatch?.[0] || "";
  const defaults: Record<string, string> = {};

  for (const match of formHtml.matchAll(/<(input|select|textarea)[^>]*name=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const name = match[2];

    if (defaults[name] !== undefined) {
      continue;
    }

    if (tag === "select") {
      const selectMatch = formHtml.match(new RegExp(`<select[^>]+name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"));
      const selectedMatch = selectMatch?.[1]?.match(/<option[^>]*selected[^>]*value=["']([^"']*)["']/i);
      defaults[name] = selectedMatch?.[1] || "";
      continue;
    }

    const fieldMatch = match[0].match(/value=["']([^"']*)["']/i);
    defaults[name] = fieldMatch?.[1] || "";
  }

  return defaults;
}

function buildMatchesPayload(defaults: Record<string, string>, seasonId: string, leagueId: string) {
  const payload = new URLSearchParams();
  payload.append("show_strona", defaults.show_strona || "1");
  payload.append("id_sezon", seasonId || defaults.id_sezon || "");
  payload.append("id_liga", leagueId || defaults.id_liga || "");
  payload.append("id_gracz", defaults.id_gracz || "");
  payload.append("id_gracz2", defaults.id_gracz2 || "");
  payload.append("sort", defaults.sort || "data DESC");
  payload.append("limit", "500");
  payload.append("show", defaults.show || "go");
  return payload;
}

async function fetchFormContext() {
  const framesResponse = await fetch(`${TARGET_ORIGIN}/r_mecze.php`, { cache: "no-store" });
  if (!framesResponse.ok) {
    throw new Error(`Nie udało się pobrać listy wyników (${framesResponse.status}).`);
  }

  const framesHtml = await framesResponse.text();
  const mainFrameSrc = extractMainFrameSrc(framesHtml).replace(/^\//, "");
  const formResponse = await fetch(`${TARGET_ORIGIN}/${mainFrameSrc}`, { cache: "no-store" });

  if (!formResponse.ok) {
    throw new Error(`Nie udało się pobrać formularza wyników (${formResponse.status}).`);
  }

  const formHtml = await formResponse.text();
  const seasonOptions = parseOptions(formHtml, "id_sezon");
  const leagueOptions = parseOptions(formHtml, "id_liga");
  const defaults = readFormDefaults(formHtml);

  return {
    formHtml,
    seasonOptions,
    leagueOptions,
    defaults,
  };
}

function parseMatches(html: string) {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const matches: ResultsMatch[] = [];

  for (const row of rows) {
    const cells = [...row[0].matchAll(/<td[^>]*class=["']tab_kom["'][^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => normalizeWhitespace(decodeHtmlEntities(cell[1].replace(/<[^>]+>/g, ""))));

    if (cells.length < 10) {
      continue;
    }

    const winner = cells[3];
    const loser = cells[4];
    const leagueName = cells[5];
    if (!winner || !loser || !leagueName) {
      continue;
    }

    matches.push({ winner, loser, leagueName });
  }

  return matches;
}

export async function fetchRemainingPairs(params: {
  seasonId: string;
  leagueId: string;
  players: Player[];
}) {
  const context = await fetchFormContext();
  const season = context.seasonOptions.find((option) => option.value === params.seasonId);
  const league = context.leagueOptions.find((option) => option.value === params.leagueId);

  if (!season || !league) {
    return [] as RemainingPair[];
  }

  const payload = buildMatchesPayload(context.defaults, season.value, league.value);
  const response = await fetch(`${TARGET_ORIGIN}/mecze/mecze_lista.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać listy meczów (${response.status}).`);
  }

  const html = await response.text();
  const matches = parseMatches(html).filter((match) => normalizeWhitespace(match.leagueName) === league.label);
  const participantNames = [...new Set(
    matches
      .flatMap((match) => [match.winner, match.loser])
      .map((name) => normalizeWhitespace(name))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "pl"));
  const playedPairs = new Set(
    matches.map((match) => [normalizePersonName(match.winner), normalizePersonName(match.loser)].sort().join("::")),
  );
  const playerByResultsName = new Map(
    params.players
      .filter((player) => player.resultsPlayerName || player.fullName)
      .map((player) => [normalizePersonName(player.resultsPlayerName || player.fullName), player]),
  );
  const remainingPairs: RemainingPair[] = [];

  for (let leftIndex = 0; leftIndex < participantNames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < participantNames.length; rightIndex += 1) {
      const playerOneName = participantNames[leftIndex];
      const playerTwoName = participantNames[rightIndex];
      const pairKey = [normalizePersonName(playerOneName), normalizePersonName(playerTwoName)].sort().join("::");

      if (playedPairs.has(pairKey)) {
        continue;
      }

      const playerOne = playerByResultsName.get(normalizePersonName(playerOneName));
      const playerTwo = playerByResultsName.get(normalizePersonName(playerTwoName));

      if (playerOne?.status === "nieaktywny" || playerTwo?.status === "nieaktywny") {
        continue;
      }

      remainingPairs.push({
        playerOneName,
        playerTwoName,
        playerOneId: playerOne?.id || "",
        playerTwoId: playerTwo?.id || "",
        isMapped: Boolean(playerOne?.id && playerTwo?.id),
      });
    }
  }

  return remainingPairs.slice(0, 250);
}

export async function fetchLeagueParticipants(params: {
  seasonId: string;
  leagueId: string;
}) {
  const context = await fetchFormContext();
  const season = context.seasonOptions.find((option) => option.value === params.seasonId);
  const league = context.leagueOptions.find((option) => option.value === params.leagueId);

  if (!season || !league) {
    return {
      seasonLabel: "",
      leagueLabel: "",
      participants: [] as Array<{ value: string; label: string }>,
    };
  }

  const payload = buildMatchesPayload(context.defaults, season.value, league.value);
  const response = await fetch(`${TARGET_ORIGIN}/mecze/mecze_lista.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać uczestników ligi (${response.status}).`);
  }

  const html = await response.text();
  const matches = parseMatches(html).filter((match) => normalizeWhitespace(match.leagueName) === league.label);
  const participantByName = new Map<string, LeagueParticipant>();

  for (const match of matches) {
    for (const rawName of [match.winner, match.loser]) {
      const label = normalizeWhitespace(rawName);
      const value = normalizePersonName(rawName);

      if (!label || !value || participantByName.has(value)) {
        continue;
      }

      participantByName.set(value, { value, label });
    }
  }

  return {
    seasonLabel: season.label,
    leagueLabel: league.label,
    participants: [...participantByName.values()].sort((left, right) => left.label.localeCompare(right.label, "pl")),
  };
}
