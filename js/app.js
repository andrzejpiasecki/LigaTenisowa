const API_FRAMES_URL = "/api/r_mecze.php";
const API_MATCHES_URL = "/api/mecze/mecze_lista.php";
const SHARE_DATA = typeof window !== "undefined" ? window.__SHARE_DATA || null : null;
const STORAGE_KEY = "liga-dashboard-selections";
const MATCH_SNAPSHOTS_STORAGE_KEY = "liga-dashboard-match-snapshots";
const NEW_RESULTS_STORAGE_KEY = "liga-dashboard-new-results";
const AUTO_REFRESH_THROTTLE_MS = 2500;
const SEASON_START_MONTHS = [1, 4, 7, 10];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NEW_RESULTS_TTL_MS = 60 * 60 * 1000;

const state = {
  season: null,
  seasons: [],
  leagues: [],
  selectedLeagueId: "",
  selectedPlayer: "",
  matches: [],
  formDefaults: null,
  shareMode: Boolean(SHARE_DATA),
  leagueHtmlById: SHARE_DATA?.leagueHtmlById || {},
  playerIdByName: {},
  remainingHistoryByOpponent: {},
  historyRequestToken: 0,
  standingsSort: {
    key: "points",
    direction: "desc",
  },
  refreshInFlight: false,
  queuedRefresh: null,
  lastAutoRefreshAt: 0,
  matchSnapshotsByScope: loadJsonStorage(MATCH_SNAPSHOTS_STORAGE_KEY),
  newResultsByScope: loadJsonStorage(NEW_RESULTS_STORAGE_KEY),
  newDataBadgeTimeoutId: null,
};

const elements = {
  seasonSelect: document.getElementById("seasonSelect"),
  leagueSelect: document.getElementById("leagueSelect"),
  playerSelect: document.getElementById("playerSelect"),
  refreshButton: document.getElementById("refreshButton"),
  toggleControlsButton: document.getElementById("toggleControlsButton"),
  controlsContent: document.getElementById("controlsContent"),
  standingsBody: document.querySelector("#standingsTable tbody"),
  standingsHeaders: document.querySelectorAll("#standingsTable thead th[data-sort-key]"),
  playerMatchesBody: document.querySelector("#playerMatchesTable tbody"),
  allMatchesBody: document.querySelector("#allMatchesTable tbody"),
  remainingMatchesList: document.getElementById("remainingMatchesList"),
  playedCount: document.getElementById("playedCount"),
  playerPoints: document.getElementById("playerPoints"),
  remainingCount: document.getElementById("remainingCount"),
  playerPosition: document.getElementById("playerPosition"),
  playerSets: document.getElementById("playerSets"),
  leagueHeading: document.getElementById("leagueHeading"),
  headerPlayerName: document.getElementById("headerPlayerName"),
  heroTop: document.querySelector(".hero-top"),
  statusText: document.getElementById("statusText"),
  newDataBadge: document.getElementById("newDataBadge"),
};

function setLoadingState(isLoading, text = "Pobieranie meczów...") {
  if (!elements.statusText) {
    return;
  }

  elements.statusText.classList.toggle("is-loading", isLoading);
  if (isLoading) {
    elements.statusText.textContent = text;
  }

  if (elements.refreshButton) {
    elements.refreshButton.disabled = isLoading;
  }
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function loadJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota and privacy mode storage errors.
  }
}

function titleCase(text) {
  return normalize(text)
    .toLowerCase()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadSelections() {
  return loadJsonStorage(STORAGE_KEY);
}

function saveSelections() {
  const payload = {
    seasonId: state.season?.value || "",
    leagueId: state.selectedLeagueId || "",
    player: state.selectedPlayer || "",
    controlsCollapsed: Boolean(elements.controlsContent?.hidden),
  };
  saveJsonStorage(STORAGE_KEY, payload);
}

function setControlsCollapsed(collapsed) {
  if (!elements.controlsContent || !elements.toggleControlsButton) {
    return;
  }
  elements.controlsContent.hidden = collapsed;
  elements.toggleControlsButton.setAttribute("aria-expanded", String(!collapsed));
  elements.toggleControlsButton.setAttribute("aria-label", collapsed ? "Otwórz opcje" : "Zamknij opcje");
  elements.toggleControlsButton.classList.toggle("is-open", !collapsed);
}

function updateHeaderHeading(leagueLabel, playerName) {
  if (!elements.leagueHeading || !elements.headerPlayerName) {
    return;
  }
  elements.leagueHeading.textContent = leagueLabel || "-";
  elements.headerPlayerName.textContent = playerName ? titleCase(playerName) : "-";
}

function getLeagueScopeKey(seasonId = state.season?.value, leagueId = state.selectedLeagueId) {
  if (!seasonId || !leagueId) {
    return "";
  }

  return `${seasonId}::${leagueId}`;
}

function persistMatchSnapshots() {
  saveJsonStorage(MATCH_SNAPSHOTS_STORAGE_KEY, state.matchSnapshotsByScope);
}

function persistNewResults() {
  saveJsonStorage(NEW_RESULTS_STORAGE_KEY, state.newResultsByScope);
}

function cleanupExpiredNewResults(now = Date.now()) {
  let changed = false;

  for (const [scopeKey, marker] of Object.entries(state.newResultsByScope)) {
    if (!marker?.expiresAt || marker.expiresAt <= now) {
      delete state.newResultsByScope[scopeKey];
      changed = true;
    }
  }

  if (changed) {
    persistNewResults();
  }
}

function getMatchSignatures(matches) {
  return [...new Set(matches.map((match) => matchSignature(match)))].sort();
}

function markNewResultsVisible(scopeKey, now = Date.now()) {
  if (!scopeKey) {
    return;
  }

  state.newResultsByScope[scopeKey] = {
    detectedAt: now,
    expiresAt: now + NEW_RESULTS_TTL_MS,
  };
  persistNewResults();
}

function syncNewResultsMarker(scopeKey, matches) {
  if (!scopeKey) {
    return;
  }

  cleanupExpiredNewResults();
  const nextSnapshot = getMatchSignatures(matches);
  const previousSnapshot = Array.isArray(state.matchSnapshotsByScope[scopeKey])
    ? state.matchSnapshotsByScope[scopeKey]
    : null;

  if (previousSnapshot) {
    const previousSignatures = new Set(previousSnapshot);
    const hasNewMatch = nextSnapshot.some((signature) => !previousSignatures.has(signature));
    if (hasNewMatch) {
      markNewResultsVisible(scopeKey);
    }
  }

  state.matchSnapshotsByScope[scopeKey] = nextSnapshot;
  persistMatchSnapshots();
}

function formatTimeLabel(timestamp) {
  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function scheduleNewDataBadgeHide(expiresAt) {
  if (state.newDataBadgeTimeoutId) {
    window.clearTimeout(state.newDataBadgeTimeoutId);
    state.newDataBadgeTimeoutId = null;
  }

  if (!expiresAt || expiresAt <= Date.now()) {
    return;
  }

  state.newDataBadgeTimeoutId = window.setTimeout(() => {
    state.newDataBadgeTimeoutId = null;
    cleanupExpiredNewResults();
    updateNewDataBadge();
  }, expiresAt - Date.now());
}

function updateNewDataBadge() {
  if (!elements.newDataBadge) {
    return;
  }

  cleanupExpiredNewResults();
  const scopeKey = getLeagueScopeKey();
  const marker = scopeKey ? state.newResultsByScope[scopeKey] : null;

  if (!marker?.expiresAt || marker.expiresAt <= Date.now()) {
    scheduleNewDataBadgeHide(0);
    elements.newDataBadge.hidden = true;
    elements.newDataBadge.textContent = "";
    elements.newDataBadge.removeAttribute("title");
    return;
  }

  scheduleNewDataBadgeHide(marker.expiresAt);
  elements.newDataBadge.hidden = false;
  elements.newDataBadge.textContent = "Nowe wyniki!";
  elements.newDataBadge.title = `Wykryto nowe wyniki. Znacznik wygaśnie około ${formatTimeLabel(marker.expiresAt)}.`;
}

async function fetchHtml(url, params) {
  const config = params
    ? {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams(params).toString(),
      }
    : {};

  const response = await fetch(url, config);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać danych (${response.status})`);
  }
  return response.text();
}

async function postForm(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać danych (${response.status})`);
  }

  return response.text();
}

function htmlToDocument(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

function parseOptions(doc, name) {
  const select = doc.querySelector(`select[name="${name}"]`);
  if (!select) {
    return [];
  }

  return [...select.options]
    .map((option) => ({
      value: option.value,
      label: normalize(option.textContent || ""),
    }))
    .filter((option) => option.label.length > 0);
}

function buildPlayerIdMap(options) {
  const map = {};
  for (const option of options) {
    if (!option.value) {
      continue;
    }
    const key = normalize(option.label).toUpperCase();
    if (!key || map[key]) {
      continue;
    }
    map[key] = option.value;
  }
  return map;
}

function getPlayerIdByName(playerName) {
  return state.playerIdByName[normalize(playerName).toUpperCase()] || "";
}

function getCurrentSeasonFromSelect(doc) {
  const select = doc.querySelector('select[name="id_sezon"]');
  if (!select) {
    return null;
  }

  const selectedOption = select.querySelector("option[selected]");
  if (selectedOption && selectedOption.value) {
    return {
      value: selectedOption.value,
      label: normalize(selectedOption.textContent || ""),
    };
  }

  const firstSeasonOption = [...select.options].find((option) => option.value);
  if (!firstSeasonOption) {
    return null;
  }

  return {
    value: firstSeasonOption.value,
    label: normalize(firstSeasonOption.textContent || ""),
  };
}

function readFormDefaults(doc) {
  const form = doc.querySelector('form[name="formularz"]');
  if (!form) {
    return null;
  }

  const defaults = {};
  const fields = form.querySelectorAll("input[name], select[name], textarea[name]");

  for (const field of fields) {
    const name = field.getAttribute("name");
    if (!name || defaults[name] !== undefined) {
      continue;
    }

    if (field.tagName === "SELECT") {
      defaults[name] = field.value ?? "";
      continue;
    }

    const type = (field.getAttribute("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !field.checked) {
      continue;
    }

    defaults[name] = field.value ?? "";
  }

  return defaults;
}

function buildMatchesPayload(seasonId, leagueId) {
  const defaults = state.formDefaults || {};
  const payload = new URLSearchParams();

  payload.append("show_strona", defaults.show_strona || "1");
  payload.append("id_sezon", seasonId || defaults.id_sezon || "");
  payload.append("id_liga", leagueId ?? defaults.id_liga ?? "");
  payload.append("id_gracz", defaults.id_gracz || "");
  payload.append("id_gracz2", defaults.id_gracz2 || "");
  payload.append("sort", defaults.sort || "data DESC");
  payload.append("limit", "500");
  payload.append("show", defaults.show || "go");

  return payload;
}

function parseSetScore(scoreText) {
  const match = scoreText.match(/(\d+)\s*:\s*(\d+)/);
  if (!match) {
    return null;
  }
  return { first: Number(match[1]), second: Number(match[2]) };
}

function parseMatchResult(resultText) {
  const match = resultText.match(/(\d+)\s*:\s*(\d+)/);
  if (!match) {
    return null;
  }
  return { winnerSets: Number(match[1]), loserSets: Number(match[2]) };
}

function parseMatches(doc) {
  return [...doc.querySelectorAll("tr")]
    .map((row) => {
      const cells = [...row.querySelectorAll("td.tab_kom")].map((cell) => normalize(cell.textContent || ""));
      if (cells.length < 10) {
        return null;
      }

      const date = cells[1];
      const winner = cells[3];
      const loser = cells[4];
      const leagueName = cells[5];
      const result = parseMatchResult(cells[6]);
      const sets = [cells[7], cells[8], cells[9]]
        .map(parseSetScore)
        .filter((set) => set && (set.first > 0 || set.second > 0));

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !winner || !loser || !leagueName || !result) {
        return null;
      }

      return {
        date,
        winner,
        loser,
        leagueName,
        result,
        sets,
      };
    })
    .filter(Boolean);
}

function calculatePointsForMatch(match) {
  const { winnerSets, loserSets } = match.result;
  const winnerLostGames = match.sets.reduce((sum, set) => sum + set.second, 0);

  if (winnerSets === 2 && loserSets === 0) {
    if (winnerLostGames < 4) {
      return { winnerPoints: 5, loserPoints: 1 };
    }
    return { winnerPoints: 4, loserPoints: 1 };
  }

  if (winnerSets === 2 && loserSets === 1) {
    return { winnerPoints: 3, loserPoints: 2 };
  }

  return { winnerPoints: 0, loserPoints: 0 };
}

function parseIsoDate(dateText) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function getSeasonBoundsFromReferenceDate(referenceDate) {
  const month = referenceDate.getUTCMonth();
  const year = referenceDate.getUTCFullYear();
  let seasonStartMonth = 1;
  let seasonStartYear = year;

  for (const startMonth of SEASON_START_MONTHS) {
    const endMonth = (startMonth + 2) % 12;
    const wrapsYear = startMonth > endMonth;
    const inRange = wrapsYear
      ? month >= startMonth || month <= endMonth
      : month >= startMonth && month <= endMonth;
    if (inRange) {
      seasonStartMonth = startMonth;
      if (wrapsYear && month <= endMonth) {
        seasonStartYear = year - 1;
      }
      break;
    }
  }

  const seasonStart = new Date(Date.UTC(seasonStartYear, seasonStartMonth, 1));
  const seasonEndExclusive = new Date(Date.UTC(seasonStartYear, seasonStartMonth + 3, 1));

  return { seasonStart, seasonEndExclusive };
}

function getSeasonBounds(matches) {
  const matchDates = matches
    .map((match) => parseIsoDate(match.date))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!matchDates.length) {
    return getSeasonBoundsFromReferenceDate(new Date());
  }

  return getSeasonBoundsFromReferenceDate(matchDates[0]);
}

function estimatePlayableFutureMatches(entry, remainingMatchesLimit, seasonBounds, totalMatchesTarget) {
  if (remainingMatchesLimit <= 0) {
    return 0;
  }

  if (!seasonBounds) {
    return remainingMatchesLimit;
  }

  const today = new Date();
  const nowUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startUtc = seasonBounds.seasonStart.getTime();
  const endUtc = seasonBounds.seasonEndExclusive.getTime();

  if (nowUtc >= endUtc) {
    return 0;
  }

  if (nowUtc < startUtc) {
    return remainingMatchesLimit;
  }

  const elapsedDays = Math.max(1, Math.ceil((nowUtc - startUtc) / MS_PER_DAY));
  const remainingDays = Math.max(0, Math.ceil((endUtc - nowUtc) / MS_PER_DAY));
  if (remainingDays === 0) {
    return 0;
  }

  const seasonDays = Math.max(1, Math.ceil((endUtc - startUtc) / MS_PER_DAY));
  const progress = clampNumber(elapsedDays / seasonDays, 0, 1);
  const observedPacePerDay = entry.played / elapsedDays;
  const priorPacePerDay = 0.055;
  const paceConfidence = clampNumber(entry.played / 8, 0, 1);
  const baselinePacePerDay = priorPacePerDay * (1 - paceConfidence) + observedPacePerDay * paceConfidence;
  const matchesTarget = Number.isFinite(totalMatchesTarget)
    ? totalMatchesTarget
    : (entry.played + remainingMatchesLimit);
  const remainingLoadRatio = remainingMatchesLimit / Math.max(1, matchesTarget);
  const urgency = clampNumber((progress - 0.55) / 0.45, 0, 1);
  const mobilizationBoost = 1 + urgency * (0.24 + remainingLoadRatio * 0.55);
  const reportingLagBoost = 1.12;
  const catchUpBonus = urgency * remainingLoadRatio * 1.8;
  let projectedPlayable = Math.round(
    baselinePacePerDay * mobilizationBoost * reportingLagBoost * remainingDays + catchUpBonus,
  );

  if (urgency > 0.45 && remainingMatchesLimit >= 2) {
    projectedPlayable = Math.max(projectedPlayable, 2);
  }

  return clampNumber(projectedPlayable, 0, remainingMatchesLimit);
}

function calculateExpectedPointsPerFutureMatch(
  winChance,
  playerStrength,
  opponentsStrength,
  avgWinnerPoints,
  avgLoserPoints,
) {
  const strengthEdge = playerStrength - opponentsStrength;
  const dominance = clampNumber(0.5 + strengthEdge * 1.35, 0, 1);
  const winPointsModel = 3 + dominance * 2;
  const lossTightness = 1 - Math.min(1, Math.abs(strengthEdge) * 1.8);
  const lossPointsModel = 1 + lossTightness;
  const calibratedWinPoints = clampNumber(avgWinnerPoints * 0.4 + winPointsModel * 0.6, 3, 5);
  const calibratedLossPoints = clampNumber(avgLoserPoints * 0.4 + lossPointsModel * 0.6, 1, 2);
  return winChance * calibratedWinPoints + (1 - winChance) * calibratedLossPoints;
}

function calculateHeadToHeadAdjustment(selectedPlayer, opponent, pairMatches) {
  if (!selectedPlayer || !opponent || !pairMatches.length) {
    return {
      pointsAdjustment: 0,
      dominance: 0,
      confidence: 0,
    };
  }

  const now = new Date();
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let weightedOutcomeScore = 0;
  let weightedSetScore = 0;
  let weightedGameScore = 0;
  let totalWeight = 0;

  for (const match of pairMatches) {
    const matchDate = parseIsoDate(match.date);
    if (!matchDate) {
      continue;
    }

    const ageDays = Math.max(0, Math.floor((nowUtc - matchDate.getTime()) / MS_PER_DAY));
    const recencyWeight = Math.exp(-ageDays / 365);
    const outcome = match.winner === selectedPlayer ? 1 : (match.loser === selectedPlayer ? -1 : 0);
    if (outcome === 0) {
      continue;
    }

    const ownSets = outcome > 0 ? match.result.winnerSets : match.result.loserSets;
    const oppSets = outcome > 0 ? match.result.loserSets : match.result.winnerSets;
    const setDiff = clampNumber((ownSets - oppSets) / 2, -1, 1);
    const ownGames = (match.sets || []).reduce((sum, set) => sum + (outcome > 0 ? set.first : set.second), 0);
    const oppGames = (match.sets || []).reduce((sum, set) => sum + (outcome > 0 ? set.second : set.first), 0);
    const gamesTotal = Math.max(1, ownGames + oppGames);
    const gameDiff = clampNumber((ownGames - oppGames) / gamesTotal, -1, 1);

    weightedOutcomeScore += outcome * recencyWeight;
    weightedSetScore += setDiff * recencyWeight;
    weightedGameScore += gameDiff * recencyWeight;
    totalWeight += recencyWeight;
  }

  if (totalWeight <= 0) {
    return {
      pointsAdjustment: 0,
      dominance: 0,
      confidence: 0,
    };
  }

  const normalizedOutcome = weightedOutcomeScore / totalWeight;
  const normalizedSet = weightedSetScore / totalWeight;
  const normalizedGames = weightedGameScore / totalWeight;
  const dominance = clampNumber(
    normalizedOutcome * 0.6 + normalizedSet * 0.25 + normalizedGames * 0.15,
    -1,
    1,
  );
  const confidence = clampNumber(totalWeight / 2, 0, 1);
  const pointsAdjustment = dominance * confidence * 1.45;

  return {
    pointsAdjustment,
    dominance,
    confidence,
  };
}

function ensureStats(map, player) {
  if (!map.has(player)) {
    map.set(player, {
      player,
      played: 0,
      wins: 0,
      losses: 0,
      setsWon: 0,
      setsLost: 0,
      gamesWon: 0,
      gamesLost: 0,
      points: 0,
    });
  }
  return map.get(player);
}

function buildStandings(matches) {
  const table = new Map();
  const opponentsMap = new Map();
  const seasonBounds = getSeasonBounds(matches);
  let totalWinnerPoints = 0;
  let totalLoserPoints = 0;

  for (const match of matches) {
    const winner = ensureStats(table, match.winner);
    const loser = ensureStats(table, match.loser);
    const points = calculatePointsForMatch(match);
    totalWinnerPoints += points.winnerPoints;
    totalLoserPoints += points.loserPoints;

    if (!opponentsMap.has(match.winner)) {
      opponentsMap.set(match.winner, new Set());
    }
    if (!opponentsMap.has(match.loser)) {
      opponentsMap.set(match.loser, new Set());
    }
    opponentsMap.get(match.winner).add(match.loser);
    opponentsMap.get(match.loser).add(match.winner);

    winner.played += 1;
    winner.wins += 1;
    winner.setsWon += match.result.winnerSets;
    winner.setsLost += match.result.loserSets;
    winner.points += points.winnerPoints;

    loser.played += 1;
    loser.losses += 1;
    loser.setsWon += match.result.loserSets;
    loser.setsLost += match.result.winnerSets;
    loser.points += points.loserPoints;

    for (const set of match.sets) {
      winner.gamesWon += set.first;
      winner.gamesLost += set.second;
      loser.gamesWon += set.second;
      loser.gamesLost += set.first;
    }
  }

  const participantsCount = table.size;
  const avgWinnerPoints = matches.length > 0 ? totalWinnerPoints / matches.length : 4;
  const avgLoserPoints = matches.length > 0 ? totalLoserPoints / matches.length : 1.5;
  const leagueAvgPointsPerMatchPerPlayer = matches.length > 0
    ? (totalWinnerPoints + totalLoserPoints) / (2 * matches.length)
    : 2.5;

  function pointsPerMatch(entry) {
    return entry.played > 0 ? entry.points / entry.played : leagueAvgPointsPerMatchPerPlayer;
  }

  for (const entry of table.values()) {
    const playedOpponentsSet = opponentsMap.get(entry.player) || new Set();
    const playedOpponents = playedOpponentsSet.size;
    const totalMatchesTarget = Math.max(0, participantsCount - 1);
    const remainingOpponents = Math.max(0, totalMatchesTarget - playedOpponents);
    const remainingMatchesLimit = Math.max(0, totalMatchesTarget - entry.played);

    const remainingOpponentsList = [...table.keys()].filter(
      (name) => name !== entry.player && !playedOpponentsSet.has(name),
    );

    const avgRemainingOpponentStrength = remainingOpponentsList.length > 0
      ? remainingOpponentsList
          .map((name) => pointsPerMatch(table.get(name)))
          .reduce((sum, value) => sum + value, 0) / remainingOpponentsList.length
      : leagueAvgPointsPerMatchPerPlayer;

    const playerWinRate = (entry.wins + 1) / (entry.played + 2);
    const playerStrength = pointsPerMatch(entry) / 5;
    const opponentsStrength = avgRemainingOpponentStrength / 5;
    const winChance = clampNumber(
      0.12 + playerWinRate * 0.7 + (playerStrength - opponentsStrength) * 0.35,
      0.03,
      0.97,
    );

    const playableFutureMatches = estimatePlayableFutureMatches(
      entry,
      remainingMatchesLimit,
      seasonBounds,
      totalMatchesTarget,
    );
    const expectedPointsPerFutureMatch = calculateExpectedPointsPerFutureMatch(
      winChance,
      playerStrength,
      opponentsStrength,
      avgWinnerPoints,
      avgLoserPoints,
    );

    entry.maxPoints = entry.points + remainingMatchesLimit * 5;

    entry.maxAvgPoints = Math.round(entry.points + playableFutureMatches * expectedPointsPerFutureMatch);
    entry.remainingMatches = remainingMatchesLimit;
    entry.assumedPlayedMatches = playableFutureMatches;
  }

  return [...table.values()];
}

function defaultStandingsComparator(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  const setsDiffA = a.setsWon - a.setsLost;
  const setsDiffB = b.setsWon - b.setsLost;
  if (setsDiffB !== setsDiffA) return setsDiffB - setsDiffA;
  const gamesDiffA = a.gamesWon - a.gamesLost;
  const gamesDiffB = b.gamesWon - b.gamesLost;
  if (gamesDiffB !== gamesDiffA) return gamesDiffB - gamesDiffA;
  return a.player.localeCompare(b.player, "pl");
}

function compareByKey(a, b, key, direction) {
  const dir = direction === "asc" ? 1 : -1;

  if (key === "player") {
    return dir * a.player.localeCompare(b.player, "pl");
  }

  if (key === "setsDiff") {
    const diffA = a.setsWon - a.setsLost;
    const diffB = b.setsWon - b.setsLost;
    if (diffA !== diffB) return dir * (diffA - diffB);
    return dir * (a.setsWon - b.setsWon);
  }

  if (key === "gamesDiff") {
    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    if (diffA !== diffB) return dir * (diffA - diffB);
    return dir * (a.gamesWon - b.gamesWon);
  }

  return dir * ((a[key] || 0) - (b[key] || 0));
}

function sortStandings(standings) {
  const sorted = [...standings].sort(defaultStandingsComparator);
  const { key, direction } = state.standingsSort;
  if (!key) {
    return sorted;
  }

  return sorted.sort((a, b) => {
    const byKey = compareByKey(a, b, key, direction);
    if (byKey !== 0) {
      return byKey;
    }
    return defaultStandingsComparator(a, b);
  });
}

function buildPositionChangeByPlayer(matches) {
  if (matches.length < 2) {
    return {};
  }

  const matchesSortedByDateDesc = [...matches].sort((a, b) => b.date.localeCompare(a.date));
  const latestMatchDate = matchesSortedByDateDesc[0]?.date;
  const matchesBeforeLatestDate = matchesSortedByDateDesc.filter((match) => match.date !== latestMatchDate);
  if (!matchesBeforeLatestDate.length) {
    return {};
  }
  const currentStandings = buildStandings(matchesSortedByDateDesc).sort(defaultStandingsComparator);
  const previousStandings = buildStandings(matchesBeforeLatestDate).sort(defaultStandingsComparator);

  const previousPositionByPlayer = new Map(
    previousStandings.map((entry, index) => [entry.player, index + 1]),
  );

  const positionChangeByPlayer = {};
  for (const [index, entry] of currentStandings.entries()) {
    const currentPosition = index + 1;
    const previousPosition = previousPositionByPlayer.get(entry.player);
    if (!previousPosition) {
      positionChangeByPlayer[entry.player] = 0;
      continue;
    }
    positionChangeByPlayer[entry.player] = previousPosition - currentPosition;
  }

  return positionChangeByPlayer;
}

function updateSortHeaders() {
  for (const header of elements.standingsHeaders) {
    const key = header.getAttribute("data-sort-key");
    header.classList.remove("sorted-asc", "sorted-desc");
    if (key === state.standingsSort.key) {
      header.classList.add(state.standingsSort.direction === "asc" ? "sorted-asc" : "sorted-desc");
    }
  }
}

function getParticipants(matches) {
  return [...new Set(matches.flatMap((match) => [match.winner, match.loser]))].sort((a, b) =>
    a.localeCompare(b, "pl"),
  );
}

function buildRemainingPredictionByOpponent(matches, standings, selectedPlayer, remainingOpponents) {
  const result = {};
  if (!selectedPlayer || !remainingOpponents.length) {
    return result;
  }

  const playerEntry = standings.find((entry) => entry.player === selectedPlayer);
  if (!playerEntry) {
    return result;
  }

  const pointsByPlayer = new Map(standings.map((entry) => [entry.player, entry]));
  let totalWinnerPoints = 0;
  let totalLoserPoints = 0;
  for (const match of matches) {
    const points = calculatePointsForMatch(match);
    totalWinnerPoints += points.winnerPoints;
    totalLoserPoints += points.loserPoints;
  }

  const avgWinnerPoints = matches.length > 0 ? totalWinnerPoints / matches.length : 4;
  const avgLoserPoints = matches.length > 0 ? totalLoserPoints / matches.length : 1.5;
  const leagueAvgPointsPerMatchPerPlayer = matches.length > 0
    ? (totalWinnerPoints + totalLoserPoints) / (2 * matches.length)
    : 2.5;
  const playerPointsPerMatch = playerEntry.played > 0
    ? playerEntry.points / playerEntry.played
    : leagueAvgPointsPerMatchPerPlayer;
  const playerWinRate = (playerEntry.wins + 1) / (playerEntry.played + 2);
  const playerStrength = playerPointsPerMatch / 5;

  for (const opponent of remainingOpponents) {
    const opponentEntry = pointsByPlayer.get(opponent);
    const opponentPointsPerMatch = opponentEntry && opponentEntry.played > 0
      ? opponentEntry.points / opponentEntry.played
      : leagueAvgPointsPerMatchPerPlayer;
    const opponentsStrength = opponentPointsPerMatch / 5;
    const winChance = clampNumber(
      0.12 + playerWinRate * 0.7 + (playerStrength - opponentsStrength) * 0.35,
      0.03,
      0.97,
    );

    const expectedPoints = calculateExpectedPointsPerFutureMatch(
      winChance,
      playerStrength,
      opponentsStrength,
      avgWinnerPoints,
      avgLoserPoints,
    );
    const pairCurrentSeasonMatches = matches.filter(
      (match) =>
        (match.winner === selectedPlayer && match.loser === opponent)
        || (match.winner === opponent && match.loser === selectedPlayer),
    );
    const pairHistoricalMatches = state.remainingHistoryByOpponent[opponent]?.matches || [];
    const allPairMatchesBySignature = new Map();
    for (const match of [...pairCurrentSeasonMatches, ...pairHistoricalMatches]) {
      allPairMatchesBySignature.set(matchSignature(match), match);
    }
    const h2h = calculateHeadToHeadAdjustment(
      selectedPlayer,
      opponent,
      [...allPairMatchesBySignature.values()],
    );
    let adjustedExpected = expectedPoints + h2h.pointsAdjustment;
    if (h2h.confidence > 0.4 && h2h.dominance <= -0.65) {
      adjustedExpected = Math.min(adjustedExpected, 2.2);
    } else if (h2h.confidence > 0.3 && h2h.dominance <= -0.4) {
      adjustedExpected = Math.min(adjustedExpected, 2.6);
    } else if (h2h.confidence > 0.4 && h2h.dominance >= 0.65) {
      adjustedExpected = Math.max(adjustedExpected, 3.5);
    }
    result[opponent] = Math.round(clampNumber(adjustedExpected, 1, 5));
  }

  return result;
}

function matchSignature(match) {
  return `${match.date}|${match.winner}|${match.loser}|${match.result.winnerSets}:${match.result.loserSets}`;
}

function renderStandings(standings, selectedPlayer, positionChangeByPlayer = {}) {
  updateSortHeaders();
  const getPlaceWord = (value) => {
    const lastTwo = value % 100;
    if (lastTwo >= 12 && lastTwo <= 14) {
      return "miejsc";
    }
    const lastDigit = value % 10;
    if (lastDigit === 1) {
      return "miejsce";
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
      return "miejsca";
    }
    return "miejsc";
  };
  const rows = standings
    .map((entry, index) => {
      const selectedClass = entry.player === selectedPlayer ? "is-selected" : "";
      const positionChange = positionChangeByPlayer[entry.player] || 0;
      const positionShift = Math.abs(positionChange);
      const positionTrend = positionChange > 0
        ? `<span class="position-change up" aria-label="Pozycja poprawiła się o ${positionShift} ${getPlaceWord(positionShift)} względem poprzedniej kolejki">+${positionShift}</span>`
        : positionChange < 0
          ? `<span class="position-change down" aria-label="Pozycja pogorszyła się o ${positionShift} ${getPlaceWord(positionShift)} względem poprzedniej kolejki">-${positionShift}</span>`
          : "";
      return `
        <tr class="${selectedClass}" data-player="${escapeHtml(entry.player)}">
          <td><span class="position-cell"><span>${index + 1}</span>${positionTrend}</span></td>
          <td>${escapeHtml(titleCase(entry.player))}</td>
          <td><strong>${entry.points}</strong></td>
          <td><strong>${entry.maxAvgPoints}</strong></td>
          <td>${entry.wins}</td>
          <td>${entry.losses}</td>
        </tr>
      `;
    })
    .join("");

  elements.standingsBody.innerHTML = rows || '<tr><td colspan="6">Brak meczów.</td></tr>';
}

function renderMatchRow(match, selectedPlayer, showOpponent = true) {
  const isWinner = match.winner === selectedPlayer;
  const opponent = isWinner ? match.loser : match.winner;
  const playerSets = isWinner ? match.result.winnerSets : match.result.loserSets;
  const oppSets = isWinner ? match.result.loserSets : match.result.winnerSets;
  const gamesDetails = match.sets
    .map((set) => (isWinner ? `${set.first}:${set.second}` : `${set.second}:${set.first}`))
    .join(", ");
  return `
    <tr class="${isWinner ? "match-win" : "match-loss"}">
      <td>${match.date}</td>
      ${showOpponent ? `<td>${escapeHtml(titleCase(opponent))}</td>` : ""}
      <td>${playerSets}:${oppSets}${gamesDetails ? ` (${gamesDetails})` : ""}</td>
    </tr>
  `;
}

function renderPlayerMatches(matches, selectedPlayer) {
  const rows = matches
    .map((match) => renderMatchRow(match, selectedPlayer))
    .join("");

  elements.playerMatchesBody.innerHTML = rows || '<tr><td colspan="3">Brak rozegranych meczów.</td></tr>';
}

function renderAllMatches(matches) {
  const rows = [...matches]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((match) => {
      const setsDetails = match.sets
        .map((set) => `${set.first}:${set.second}`)
        .join(", ");
      const resultText = `${match.result.winnerSets}:${match.result.loserSets}${setsDetails ? ` (${setsDetails})` : ""}`;
      return `
        <tr>
          <td>${match.date}</td>
          <td>${escapeHtml(titleCase(match.winner))}</td>
          <td>${escapeHtml(titleCase(match.loser))}</td>
          <td>${resultText}</td>
        </tr>
      `;
    })
    .join("");

  elements.allMatchesBody.innerHTML = rows || '<tr><td colspan="4">Brak meczów w tej lidze.</td></tr>';
}

function renderRemaining(remainingOpponents, selectedPlayer, remainingPredictionByOpponent = {}, playerSummary = null) {
  const predictedPoints = playerSummary?.maxAvgPoints ?? 0;
  const currentPoints = playerSummary?.points ?? 0;
  const maxPoints = playerSummary?.maxPoints ?? 0;
  const remainingMatches = playerSummary?.remainingMatches ?? 0;
  const assumedPlayedMatches = playerSummary?.assumedPlayedMatches ?? 0;
  const summary = `
    <div class="remaining-summary">
      <p class="remaining-summary-title">Predykcja końcowej liczby punktów: ${predictedPoints} pkt</p>
      <p class="remaining-summary-details">Obecnie: ${currentPoints} pkt | Matematyczne maksimum: ${maxPoints} pkt | Pozostałe mecze: ${remainingMatches} ${formatMatchesWord(remainingMatches)} | Założone do rozegrania: ${assumedPlayedMatches} ${formatMatchesWord(assumedPlayedMatches)}</p>
    </div>
  `;

  if (!remainingOpponents.length) {
    elements.remainingMatchesList.innerHTML = `<p class="hint">Brak zaległych meczów w tej lidze.</p>${summary}`;
    return;
  }

  const rows = remainingOpponents.map((opponent) => {
    const history = state.remainingHistoryByOpponent[opponent];
    const prediction = remainingPredictionByOpponent[opponent] ?? 0;
    let h2hCell = '<span class="history-note">-</span>';

    if (history?.loading) {
      h2hCell = '<span class="history-note">Ładowanie...</span>';
    } else if (history?.error) {
      h2hCell = '<span class="hint">Błąd danych</span>';
    } else if (history?.matches) {
      const wins = history.matches.filter((match) => match.winner === selectedPlayer).length;
      const losses = history.matches.length - wins;
      if (history.matches.length === 0) {
        h2hCell = '<span class="history-note">Bilans 0-0</span>';
      } else {
        const historyItems = history.matches
          .map((match) => {
            const isWinner = match.winner === selectedPlayer;
            const ownSets = isWinner ? match.result.winnerSets : match.result.loserSets;
            const oppSets = isWinner ? match.result.loserSets : match.result.winnerSets;
            const gamesDetails = (match.sets || [])
              .map((set) => (isWinner ? `${set.first}:${set.second}` : `${set.second}:${set.first}`))
              .join(", ");
            const scoreText = `${ownSets}:${oppSets}${gamesDetails ? ` (${gamesDetails})` : ""}`;
            return `<li>${scoreText}</li>`;
          })
          .join("");
        h2hCell = `
          <span class="history-note">Bilans ${wins}-${losses}</span>
          <ul class="h2h-results">${historyItems}</ul>
        `;
      }
    }

    return `
      <tr>
        <td>${escapeHtml(titleCase(opponent))}</td>
        <td><strong>${prediction}</strong></td>
        <td>${h2hCell}</td>
      </tr>
    `;
  }).join("");

  const table = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Przeciwnik</th>
            <th>Prog.</th>
            <th>Bilans H2H</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  elements.remainingMatchesList.innerHTML = `${table}${summary}`;
}

function formatMatchesWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (count === 1) {
    return "mecz";
  }
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return "mecze";
  }
  return "meczów";
}

function fillSelect(select, options, selectedValue, placeholder = "") {
  const placeholderOption = placeholder
    ? `<option value="" ${selectedValue ? "" : "selected"}>${escapeHtml(placeholder)}</option>`
    : "";

  select.innerHTML = `${placeholderOption}${options
    .map((option) => {
      const selectedAttr = option.value === selectedValue ? "selected" : "";
      return `<option value="${escapeHtml(option.value)}" ${selectedAttr}>${escapeHtml(option.label)}</option>`;
    })
    .join("")}`;
}

function resetTablesForMissingSelection(message) {
  elements.statusText.textContent = message;
  updateNewDataBadge();
  updateHeaderHeading("", "");
  elements.standingsBody.innerHTML = '<tr><td colspan="6">Wybierz sezon i ligę.</td></tr>';
  elements.playerMatchesBody.innerHTML = '<tr><td colspan="3">Wybierz zawodnika.</td></tr>';
  elements.allMatchesBody.innerHTML = '<tr><td colspan="4">Wybierz sezon i ligę.</td></tr>';
  elements.remainingMatchesList.innerHTML = "";
  elements.playedCount.textContent = "0";
  elements.playerPoints.textContent = "0";
  elements.remainingCount.textContent = "0";
  elements.playerPosition.textContent = "-";
  elements.playerSets.textContent = "0:0";
}

async function getInitialContext() {
  if (state.shareMode && SHARE_DATA?.latestSeason && Array.isArray(SHARE_DATA?.leagues)) {
    return {
      latestSeason: SHARE_DATA.latestSeason,
      allSeasons: [SHARE_DATA.latestSeason],
      allLeagues: SHARE_DATA.leagues,
      playerIdByName: {},
    };
  }

  const framesHtml = await fetchHtml(API_FRAMES_URL);
  const framesDoc = htmlToDocument(framesHtml);
  const frameSrc = framesDoc.querySelector("frame[name='main']")?.getAttribute("src") || "mecze/start.php";

  const formHtml = await fetchHtml(`/api/${frameSrc.replace(/^\//, "")}`);
  const formDoc = htmlToDocument(formHtml);
  state.formDefaults = readFormDefaults(formDoc);
  const seasons = parseOptions(formDoc, "id_sezon").filter((season) => season.value);
  const leagues = parseOptions(formDoc, "id_liga").filter((league) => league.value);
  const players = parseOptions(formDoc, "id_gracz").filter((player) => player.value);
  const currentSeason = getCurrentSeasonFromSelect(formDoc);

  if (!currentSeason) {
    throw new Error("Brak aktualnego sezonu w select[name=id_sezon].");
  }

  if (!state.formDefaults) {
    throw new Error("Nie znaleziono formularza z parametrami zapytania.");
  }

  return {
    latestSeason: currentSeason,
    allSeasons: seasons,
    allLeagues: leagues,
    playerIdByName: buildPlayerIdMap(players),
  };
}

async function fetchMatchesForLeague(seasonId, leagueId) {
  if (state.shareMode) {
    const html = state.leagueHtmlById[leagueId] || "";
    return parseMatches(htmlToDocument(html));
  }

  const payload = buildMatchesPayload(seasonId, leagueId);

  const html = await postForm(API_MATCHES_URL, payload);

  return parseMatches(htmlToDocument(html));
}

async function fetchHeadToHeadHistory(playerAId, playerBId) {
  if (!playerAId || !playerBId) {
    return [];
  }

  const payload = new URLSearchParams();
  payload.append("show_strona", "1");
  payload.append("id_sezon", "");
  payload.append("id_liga", "");
  payload.append("id_gracz", playerAId);
  payload.append("id_gracz2", playerBId);
  payload.append("sort", "data DESC");
  payload.append("limit", "500");
  payload.append("show", "go");

  const html = await postForm(API_MATCHES_URL, payload);
  return parseMatches(htmlToDocument(html));
}

async function loadRemainingHistories(selectedPlayer, remainingOpponents, leagueLabel) {
  if (state.shareMode) {
    return;
  }

  const token = ++state.historyRequestToken;
  const nextHistory = {};
  for (const opponent of remainingOpponents) {
    nextHistory[opponent] = { loading: true, matches: [] };
  }
  state.remainingHistoryByOpponent = nextHistory;
  const standingsSnapshot = sortStandings(buildStandings(state.matches));
  const remainingPredictionByOpponent = buildRemainingPredictionByOpponent(
    state.matches,
    standingsSnapshot,
    selectedPlayer,
    remainingOpponents,
  );
  const playerSummary = standingsSnapshot.find((entry) => entry.player === selectedPlayer);
  renderRemaining(remainingOpponents, selectedPlayer, remainingPredictionByOpponent, playerSummary);

  const selectedPlayerId = getPlayerIdByName(selectedPlayer);
  const currentPairMatches = new Map();
  for (const match of state.matches) {
    if (match.winner === selectedPlayer || match.loser === selectedPlayer) {
      const opponent = match.winner === selectedPlayer ? match.loser : match.winner;
      if (!currentPairMatches.has(opponent)) {
        currentPairMatches.set(opponent, new Set());
      }
      currentPairMatches.get(opponent).add(matchSignature(match));
    }
  }

  await Promise.all(
    remainingOpponents.map(async (opponent) => {
      const opponentId = getPlayerIdByName(opponent);
      try {
        const allMatches = await fetchHeadToHeadHistory(selectedPlayerId, opponentId);
        const currentSigs = currentPairMatches.get(opponent) || new Set();
        const historicalOnly = allMatches.filter((match) => !currentSigs.has(matchSignature(match)));

        if (token !== state.historyRequestToken) {
          return;
        }

        state.remainingHistoryByOpponent[opponent] = {
          loading: false,
          error: false,
          matches: historicalOnly,
        };
      } catch {
        if (token !== state.historyRequestToken) {
          return;
        }

        state.remainingHistoryByOpponent[opponent] = {
          loading: false,
          error: true,
          matches: [],
        };
      }
    }),
  );

  if (token === state.historyRequestToken) {
    const latestStandingsSnapshot = sortStandings(buildStandings(state.matches));
    const latestRemainingPredictionByOpponent = buildRemainingPredictionByOpponent(
      state.matches,
      latestStandingsSnapshot,
      selectedPlayer,
      remainingOpponents,
    );
    const latestPlayerSummary = latestStandingsSnapshot.find((entry) => entry.player === selectedPlayer);
    renderRemaining(remainingOpponents, selectedPlayer, latestRemainingPredictionByOpponent, latestPlayerSummary);
    updateDashboard(leagueLabel, { skipHistoryLoad: true });
  }
}

async function initialize() {
  elements.statusText.textContent = "Ładowanie danych...";

  const context = await getInitialContext();
  state.playerIdByName = context.playerIdByName || {};
  const stored = loadSelections();
  const initialControlsCollapsed = stored.controlsCollapsed === undefined
    ? true
    : Boolean(stored.controlsCollapsed);
  setControlsCollapsed(initialControlsCollapsed);
  state.seasons = context.allSeasons;

  const selectedSeason = state.seasons.find((season) => season.value === stored.seasonId) || state.seasons[0] || null;
  state.season = selectedSeason;

  fillSelect(elements.seasonSelect, state.seasons, selectedSeason?.value || "");

  const primaryLeagueNames = new Set(["Extraliga", "1 Liga", "2 Liga", "3 Liga", "4 Liga"]);
  const primaryLeagues = context.allLeagues.filter((league) => primaryLeagueNames.has(league.label));
  state.leagues = (primaryLeagues.length ? primaryLeagues : context.allLeagues).map((league) => ({ ...league }));

  if (!state.leagues.length) {
    throw new Error("Brak lig z meczami w najnowszym sezonie.");
  }

  state.selectedLeagueId = state.leagues.some((league) => league.value === stored.leagueId)
    ? stored.leagueId
    : (state.leagues[0]?.value || "");
  fillSelect(elements.leagueSelect, state.leagues, state.selectedLeagueId);

  await refreshLeagueData(stored.player || "");
}

function chooseDefaultPlayer(players) {
  return players[0] || "";
}

async function refreshLeagueData(preferredPlayer = "", options = {}) {
  if (state.refreshInFlight) {
    state.queuedRefresh = { preferredPlayer, options };
    return;
  }

  state.refreshInFlight = true;

  if (!state.season?.value || !state.selectedLeagueId) {
    resetTablesForMissingSelection("Brak danych do wyświetlenia.");
    state.refreshInFlight = false;
    return;
  }

  setLoadingState(true, options.statusText || "Pobieranie meczów...");

  try {
    const selectedLeague = state.leagues.find((league) => league.value === state.selectedLeagueId);
    const scopeKey = getLeagueScopeKey(state.season?.value, state.selectedLeagueId);

    state.matches = await fetchMatchesForLeague(state.season.value, state.selectedLeagueId);
    syncNewResultsMarker(scopeKey, state.matches);
    const participants = getParticipants(state.matches);
    state.selectedPlayer = preferredPlayer && participants.includes(preferredPlayer)
      ? preferredPlayer
      : chooseDefaultPlayer(participants);

    fillSelect(
      elements.playerSelect,
      participants.map((player) => ({ value: player, label: titleCase(player) })),
      state.selectedPlayer,
    );

    updateDashboard(selectedLeague?.label || "");
    saveSelections();
  } finally {
    setLoadingState(false);
    state.refreshInFlight = false;

    if (state.queuedRefresh) {
      const queued = state.queuedRefresh;
      state.queuedRefresh = null;
      await refreshLeagueData(queued.preferredPlayer, queued.options);
    }
  }
}

function triggerAutoRefresh() {
  if (document.visibilityState === "hidden") {
    return;
  }

  const now = Date.now();
  if (now - state.lastAutoRefreshAt < AUTO_REFRESH_THROTTLE_MS) {
    return;
  }

  state.lastAutoRefreshAt = now;
  refreshLeagueData(state.selectedPlayer, { statusText: "Odświeżanie danych..." });
}

function updateDashboard(leagueLabel, options = {}) {
  const skipHistoryLoad = Boolean(options.skipHistoryLoad);
  const selectedPlayer = state.selectedPlayer;
  const matches = state.matches;
  updateHeaderHeading(leagueLabel, selectedPlayer);
  updateNewDataBadge();

  const standings = sortStandings(
    buildStandings(matches),
  );
  const positionChangeByPlayer = buildPositionChangeByPlayer(matches);
  renderStandings(standings, selectedPlayer, positionChangeByPlayer);

  const playerMatches = selectedPlayer
    ? matches
        .filter((match) => match.winner === selectedPlayer || match.loser === selectedPlayer)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  renderPlayerMatches(playerMatches, selectedPlayer || "");
  renderAllMatches(matches);

  const participants = getParticipants(matches);
  const playedOpponents = new Set(
    playerMatches.map((match) => (match.winner === selectedPlayer ? match.loser : match.winner)),
  );
  const remainingOpponents = participants
    .filter((name) => name !== selectedPlayer)
    .filter((name) => !playedOpponents.has(name));
  if (!selectedPlayer) {
    state.remainingHistoryByOpponent = {};
    elements.remainingMatchesList.innerHTML = '<p class="hint">Wybierz zawodnika, aby zobaczyć pozostałe mecze.</p>';
  } else {
    const playerSummaryForRemaining = standings.find((entry) => entry.player === selectedPlayer) || null;
    const remainingPredictionByOpponent = buildRemainingPredictionByOpponent(
      matches,
      standings,
      selectedPlayer,
      remainingOpponents,
    );
    if (!skipHistoryLoad) {
      state.remainingHistoryByOpponent = {};
    }
    renderRemaining(remainingOpponents, selectedPlayer, remainingPredictionByOpponent, playerSummaryForRemaining);
    if (!skipHistoryLoad) {
      loadRemainingHistories(selectedPlayer, remainingOpponents, leagueLabel);
    }
  }

  const playerSummary = standings.find((entry) => entry.player === selectedPlayer);
  const playerPosition = standings.findIndex((entry) => entry.player === selectedPlayer);
  const currentPoints = playerSummary?.points ?? 0;
  const totalMatchesForPlayer = (playerSummary?.played ?? 0) + (playerSummary?.remainingMatches ?? 0);
  elements.playedCount.textContent = String(playerMatches.length);
  elements.playerPoints.textContent = String(currentPoints);
  elements.remainingCount.textContent = String(totalMatchesForPlayer);
  elements.playerPosition.textContent = playerPosition >= 0 ? String(playerPosition + 1) : "-";
  elements.playerSets.textContent = `${playerSummary?.setsWon ?? 0}:${playerSummary?.setsLost ?? 0}`;
  elements.statusText.textContent = `${state.season.label} | ${leagueLabel} | ${matches.length} meczów`;
}

for (const header of elements.standingsHeaders) {
  header.addEventListener("click", () => {
    const key = header.getAttribute("data-sort-key");
    if (!key) {
      return;
    }

    if (state.standingsSort.key === key) {
      state.standingsSort.direction = state.standingsSort.direction === "desc" ? "asc" : "desc";
    } else {
      state.standingsSort.key = key;
      state.standingsSort.direction = key === "player" || key === "losses" ? "asc" : "desc";
    }

    const league = state.leagues.find((item) => item.value === state.selectedLeagueId);
    updateDashboard(league?.label || "", { skipHistoryLoad: true });
  });
}

elements.seasonSelect.addEventListener("change", async (event) => {
  const nextSeason = state.seasons.find((season) => season.value === event.target.value);
  state.season = nextSeason || null;
  saveSelections();

  await refreshLeagueData(state.selectedPlayer);
});

elements.leagueSelect.addEventListener("change", async (event) => {
  state.selectedLeagueId = event.target.value;
  saveSelections();

  await refreshLeagueData(state.selectedPlayer);
});

elements.playerSelect.addEventListener("change", (event) => {
  state.selectedPlayer = event.target.value;
  saveSelections();
  const league = state.leagues.find((item) => item.value === state.selectedLeagueId);
  updateDashboard(league?.label || "");
});

elements.standingsBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-player]");
  const nextPlayer = row?.dataset.player || "";
  if (!nextPlayer || nextPlayer === state.selectedPlayer) {
    return;
  }

  state.selectedPlayer = nextPlayer;
  elements.playerSelect.value = nextPlayer;
  saveSelections();
  const league = state.leagues.find((item) => item.value === state.selectedLeagueId);
  updateDashboard(league?.label || "");
});

if (elements.refreshButton) {
  elements.refreshButton.addEventListener("click", async () => {
    await refreshLeagueData(state.selectedPlayer);
  });
}

window.addEventListener("focus", () => {
  triggerAutoRefresh();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    triggerAutoRefresh();
  }
});

if (
  elements.toggleControlsButton
  && elements.controlsContent
  && elements.toggleControlsButton.dataset.toggleBound !== "1"
) {
  elements.toggleControlsButton.dataset.toggleBound = "1";
  elements.toggleControlsButton.addEventListener("click", () => {
    const nextCollapsed = !elements.controlsContent.hidden;
    setControlsCollapsed(nextCollapsed);
    saveSelections();
  });
}

if (
  elements.heroTop
  && elements.controlsContent
  && elements.heroTop.dataset.toggleBound !== "1"
) {
  elements.heroTop.dataset.toggleBound = "1";
  elements.heroTop.addEventListener("click", (event) => {
    if (
      elements.toggleControlsButton
      && event.target instanceof Element
      && elements.toggleControlsButton.contains(event.target)
    ) {
      return;
    }

    event.stopPropagation();
    const nextCollapsed = !elements.controlsContent.hidden;
    setControlsCollapsed(nextCollapsed);
    saveSelections();
  });
}

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape"
    && elements.controlsContent
    && !elements.controlsContent.hidden
  ) {
    setControlsCollapsed(true);
    saveSelections();
  }
});

document.addEventListener("click", (event) => {
  if (
    !elements.controlsContent
    || !elements.toggleControlsButton
    || elements.controlsContent.hidden
  ) {
    return;
  }

  const clickTarget = event.target;
  if (
    !(clickTarget instanceof Element)
    || elements.controlsContent.contains(clickTarget)
    || elements.toggleControlsButton.contains(clickTarget)
  ) {
    return;
  }

  setControlsCollapsed(true);
  saveSelections();
});

initialize().catch((error) => {
  elements.statusText.textContent = `Błąd: ${error.message}`;
  elements.standingsBody.innerHTML = '<tr><td colspan="10">Nie udało się pobrać danych.</td></tr>';
  elements.playerMatchesBody.innerHTML = '<tr><td colspan="3">Brak danych.</td></tr>';
  elements.allMatchesBody.innerHTML = '<tr><td colspan="4">Brak danych.</td></tr>';
  elements.remainingMatchesList.innerHTML = '<li class="hint">Sprawdź proxy /api i połączenie z tenisv.pl.</li>';
});
