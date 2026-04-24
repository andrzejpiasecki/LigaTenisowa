import { type Player, type PlayerResultsMatch, type ResultsDirectoryEntry } from "@/lib/scheduled-matches";

const TARGET_ORIGIN = "http://tenisv.pl";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizePersonName(value: string) {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.,;:/\\()[\]{}"'`_-]/g, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function formatImportedPlayerName(value: string) {
  return normalizePersonName(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tokenizeName(value: string) {
  return normalizePersonName(value)
    .split(" ")
    .filter(Boolean)
    .sort();
}

function diceCoefficient(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftBigrams = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const bigram = left.slice(index, index + 2);
    leftBigrams.set(bigram, (leftBigrams.get(bigram) || 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2);
    const count = leftBigrams.get(bigram) || 0;
    if (count > 0) {
      overlap += 1;
      leftBigrams.set(bigram, count - 1);
    }
  }

  return (2 * overlap) / Math.max(1, left.length + right.length - 2);
}

function tokenScore(left: string, right: string) {
  const leftTokens = tokenizeName(left);
  const rightTokens = tokenizeName(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  if (leftTokens.join(" ") === rightTokens.join(" ")) {
    return 1;
  }

  let common = 0;
  const remaining = [...rightTokens];
  for (const token of leftTokens) {
    const index = remaining.indexOf(token);
    if (index >= 0) {
      common += 1;
      remaining.splice(index, 1);
    }
  }

  return (2 * common) / (leftTokens.length + rightTokens.length);
}

export function scorePlayerNameMatch(left: string, right: string) {
  const normalizedLeft = normalizePersonName(left);
  const normalizedRight = normalizePersonName(right);
  const orderedTokenScore = tokenScore(normalizedLeft, normalizedRight);
  const stringScore = diceCoefficient(normalizedLeft.replace(/\s+/g, ""), normalizedRight.replace(/\s+/g, ""));

  return Number((orderedTokenScore * 0.7 + stringScore * 0.3).toFixed(4));
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

function extractSelectOptions(html: string, selectName: string) {
  const selectMatch = html.match(new RegExp(`<select[^>]+name=["']${selectName}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"));
  if (!selectMatch) {
    return [];
  }

  const options: ResultsDirectoryEntry[] = [];
  const optionPattern = /<option([^>]*)value=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/option>/gi;

  for (const match of selectMatch[1].matchAll(optionPattern)) {
    const id = normalizeWhitespace(decodeHtmlEntities(match[2] || ""));
    const name = normalizeWhitespace(decodeHtmlEntities((match[4] || "").replace(/<[^>]+>/g, "")));

    if (!id || !name) {
      continue;
    }

    options.push({
      id,
      name,
      normalizedName: normalizePersonName(name),
    });
  }

  return options;
}

export type ResultsFilterOption = {
  value: string;
  label: string;
};

export type ResultsFilters = {
  seasons: ResultsFilterOption[];
  leagues: ResultsFilterOption[];
  currentSeason: ResultsFilterOption | null;
};

export async function fetchResultsDirectory() {
  const { formHtml } = await fetchResultsFormHtml();
  const entries = extractSelectOptions(formHtml, "id_gracz");
  const uniqueByName = new Map<string, ResultsDirectoryEntry>();

  for (const entry of entries) {
    if (!uniqueByName.has(entry.normalizedName)) {
      uniqueByName.set(entry.normalizedName, entry);
    }
  }

  return [...uniqueByName.values()].sort((left, right) => left.name.localeCompare(right.name, "pl"));
}

async function fetchResultsFormHtml() {
  const framesResponse = await fetch(`${TARGET_ORIGIN}/r_mecze.php`, { cache: "no-store" });
  if (!framesResponse.ok) {
    throw new Error(`Nie udało się pobrać listy wyników (${framesResponse.status}).`);
  }

  const framesHtml = await framesResponse.text();
  const mainFrameSrc = extractMainFrameSrc(framesHtml).replace(/^\//, "");
  const formResponse = await fetch(`${TARGET_ORIGIN}/${mainFrameSrc}`, { cache: "no-store" });

  if (!formResponse.ok) {
    throw new Error(`Nie udało się pobrać katalogu graczy (${formResponse.status}).`);
  }

  const formHtml = await formResponse.text();
  return { formHtml };
}

export async function fetchResultsFilters(): Promise<ResultsFilters> {
  const { formHtml } = await fetchResultsFormHtml();
  const seasons = extractSelectOptions(formHtml, "id_sezon").map((entry) => ({ value: entry.id, label: entry.name }));
  const leagues = extractSelectOptions(formHtml, "id_liga").map((entry) => ({ value: entry.id, label: entry.name }));
  const currentSeasonMatch = formHtml.match(/<select[^>]+name=["']id_sezon["'][^>]*>([\s\S]*?)<\/select>/i);
  let currentSeason: ResultsFilterOption | null = null;

  if (currentSeasonMatch) {
    const selectedMatch = currentSeasonMatch[1].match(/<option[^>]*selected[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/i);
    if (selectedMatch) {
      currentSeason = {
        value: normalizeWhitespace(decodeHtmlEntities(selectedMatch[1] || "")),
        label: normalizeWhitespace(decodeHtmlEntities((selectedMatch[2] || "").replace(/<[^>]+>/g, ""))),
      };
    }
  }

  if (!currentSeason?.value) {
    currentSeason = seasons.find((option) => option.value) || null;
  }

  return {
    seasons,
    leagues,
    currentSeason,
  };
}

export function buildPlayerResultsMatches(players: Player[], directory: ResultsDirectoryEntry[]): PlayerResultsMatch[] {
  return players.map((player) => {
    const linkedEntry = player.resultsPlayerId
      ? directory.find((entry) => entry.id === player.resultsPlayerId) || null
      : null;

    let suggestedEntry: ResultsDirectoryEntry | null = null;
    let suggestionScore = 0;

    for (const entry of directory) {
      const score = scorePlayerNameMatch(player.fullName, entry.name);
      if (score > suggestionScore) {
        suggestionScore = score;
        suggestedEntry = entry;
      }
    }

    return {
      player,
      linkedEntry,
      suggestedEntry: suggestionScore >= 0.72 ? suggestedEntry : null,
      suggestionScore,
    };
  });
}
