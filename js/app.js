const API_FRAMES_URL = "/api/r_mecze.php";
const API_MATCHES_URL = "/api/mecze/mecze_lista.php";
const SHARE_DATA = typeof window !== "undefined" ? window.__SHARE_DATA || null : null;
const STORAGE_KEY = "liga-dashboard-selections";
const AUTO_REFRESH_THROTTLE_MS = 2500;
const NEW_DATA_BADGE_DURATION_MS = 7000;

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
  remainingPointsPredictionByOpponent: {},
  historyRequestToken: 0,
  standingsSort: {
    key: "points",
    direction: "desc",
  },
  refreshInFlight: false,
  queuedRefresh: null,
  lastAutoRefreshAt: 0,
  loadedContext: {
    seasonId: "",
    leagueId: "",
  },
  newDataBadgeTimeoutId: null,
  historicalStrengthByLeagueId: {},
  historicalLeagueStrengthByPlayer: {},
  historicalLeagueAvgPointsPerMatch: 2.5,
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
  predictionInfoBox: document.getElementById("predictionInfoBox"),
  playedCount: document.getElementById("playedCount"),
  playerPoints: document.getElementById("playerPoints"),
  remainingCount: document.getElementById("remainingCount"),
  playerPosition: document.getElementById("playerPosition"),
  playerSets: document.getElementById("playerSets"),
  selectedPlayerHeading: document.getElementById("selectedPlayerHeading"),
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

function hideNewDataBadge() {
  if (state.newDataBadgeTimeoutId) {
    clearTimeout(state.newDataBadgeTimeoutId);
    state.newDataBadgeTimeoutId = null;
  }
  if (!elements.newDataBadge) {
    return;
  }
  elements.newDataBadge.hidden = true;
  elements.newDataBadge.textContent = "";
}

function showNewDataBadge(newMatchesCount) {
  if (!elements.newDataBadge || newMatchesCount <= 0) {
    return;
  }

  if (state.newDataBadgeTimeoutId) {
    clearTimeout(state.newDataBadgeTimeoutId);
  }

  const suffix = newMatchesCount === 1 ? "nowy wynik" : "nowe wyniki";
  elements.newDataBadge.textContent = `+${newMatchesCount} ${suffix}`;
  elements.newDataBadge.hidden = false;

  state.newDataBadgeTimeoutId = setTimeout(() => {
    hideNewDataBadge();
  }, NEW_DATA_BADGE_DURATION_MS);
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
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

function loadSelections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveSelections() {
  const payload = {
    seasonId: state.season?.value || "",
    leagueId: state.selectedLeagueId || "",
    player: state.selectedPlayer || "",
    controlsCollapsed: Boolean(elements.controlsContent?.hidden),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function setControlsCollapsed(collapsed) {
  if (!elements.controlsContent || !elements.toggleControlsButton) {
    return;
  }
  elements.controlsContent.hidden = collapsed;
  elements.toggleControlsButton.setAttribute("aria-expanded", String(!collapsed));
  elements.toggleControlsButton.textContent = collapsed ? "Rozwiń" : "Zwiń";
}

function updateSelectedPlayerHeading(playerName) {
  if (!elements.selectedPlayerHeading) {
    return;
  }
  const label = playerName ? titleCase(playerName) : "-";
  elements.selectedPlayerHeading.textContent = label;
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

function buildHistoricalLeagueStrengthModel(matches) {
  if (!matches.length) {
    return {
      byPlayer: {},
      avgPointsPerMatchPerPlayer: 2.5,
    };
  }

  const statsByPlayer = new Map();
  let totalWinnerPoints = 0;
  let totalLoserPoints = 0;

  for (const match of matches) {
    const winner = ensureStats(statsByPlayer, match.winner);
    const loser = ensureStats(statsByPlayer, match.loser);
    const points = calculatePointsForMatch(match);

    winner.played += 1;
    winner.points += points.winnerPoints;
    loser.played += 1;
    loser.points += points.loserPoints;

    totalWinnerPoints += points.winnerPoints;
    totalLoserPoints += points.loserPoints;
  }

  const byPlayer = {};
  for (const entry of statsByPlayer.values()) {
    byPlayer[entry.player] = entry.played > 0 ? entry.points / entry.played : 0;
  }

  return {
    byPlayer,
    avgPointsPerMatchPerPlayer: (totalWinnerPoints + totalLoserPoints) / (2 * matches.length),
  };
}

function buildPointsOutcomeProfile(matches) {
  const counts = {
    win: { 3: 1, 4: 1, 5: 1 },
    loss: { 1: 1, 2: 1 },
  };

  for (const match of matches) {
    const points = calculatePointsForMatch(match);
    if (points.winnerPoints >= 3 && points.winnerPoints <= 5) {
      counts.win[points.winnerPoints] += 1;
    }
    if (points.loserPoints === 1 || points.loserPoints === 2) {
      counts.loss[points.loserPoints] += 1;
    }
  }

  const winTotal = counts.win[3] + counts.win[4] + counts.win[5];
  const lossTotal = counts.loss[1] + counts.loss[2];

  return {
    win: {
      3: counts.win[3] / winTotal,
      4: counts.win[4] / winTotal,
      5: counts.win[5] / winTotal,
    },
    loss: {
      1: counts.loss[1] / lossTotal,
      2: counts.loss[2] / lossTotal,
    },
  };
}

function pickMostLikelyPointsForMatch(winChance, pointsProfile) {
  const probabilities = {
    1: (1 - winChance) * pointsProfile.loss[1],
    2: (1 - winChance) * pointsProfile.loss[2],
    3: winChance * pointsProfile.win[3],
    4: winChance * pointsProfile.win[4],
    5: winChance * pointsProfile.win[5],
  };

  let bestPoints = 1;
  for (const candidate of [2, 3, 4, 5]) {
    if (probabilities[candidate] > probabilities[bestPoints]) {
      bestPoints = candidate;
    } else if (probabilities[candidate] === probabilities[bestPoints] && candidate > bestPoints) {
      bestPoints = candidate;
    }
  }

  return bestPoints;
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

function buildStandings(matches, options = {}) {
  const historicalStrengthByPlayer = options.historicalStrengthByPlayer || {};
  const historicalLeagueAvgPointsPerMatch = options.historicalLeagueAvgPointsPerMatch || 2.5;
  const table = new Map();
  const opponentsMap = new Map();
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
  const pointsProfile = buildPointsOutcomeProfile(matches);
  const leagueAvgPointsPerMatchPerPlayer = matches.length > 0
    ? (totalWinnerPoints + totalLoserPoints) / (2 * matches.length)
    : 2.5;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pointsPerMatch(entry) {
    const currentPpm = entry.played > 0 ? entry.points / entry.played : leagueAvgPointsPerMatchPerPlayer;
    const historicalPpm = historicalStrengthByPlayer[entry.player];
    const leagueBaseline = leagueAvgPointsPerMatchPerPlayer * 0.7 + historicalLeagueAvgPointsPerMatch * 0.3;

    if (typeof historicalPpm !== "number" || Number.isNaN(historicalPpm)) {
      return currentPpm;
    }

    if (entry.played === 0) {
      return leagueBaseline * 0.45 + historicalPpm * 0.55;
    }

    return currentPpm * 0.72 + historicalPpm * 0.28;
  }

  for (const entry of table.values()) {
    const playedOpponentsSet = opponentsMap.get(entry.player) || new Set();
    const playedOpponents = playedOpponentsSet.size;
    const remainingOpponents = Math.max(0, participantsCount - 1 - playedOpponents);

    const remainingOpponentsList = [...table.keys()].filter(
      (name) => name !== entry.player && !playedOpponentsSet.has(name),
    );

    const playerWinRate = (entry.wins + 1) / (entry.played + 2);
    const playerStrength = pointsPerMatch(entry) / 5;
    const projectedPointsFromRemaining = remainingOpponentsList.reduce((sum, opponentName) => {
      const opponentStrength = pointsPerMatch(table.get(opponentName)) / 5;
      const winChance = clamp(
        0.12 + playerWinRate * 0.7 + (playerStrength - opponentStrength) * 0.35,
        0.03,
        0.97,
      );
      return sum + pickMostLikelyPointsForMatch(winChance, pointsProfile);
    }, 0);

    entry.maxPoints = entry.points + remainingOpponents * 5;
    entry.maxAvgPoints = entry.points + projectedPointsFromRemaining;
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

function buildPositionChangeByPlayer(matches, standingsOptions = {}) {
  if (matches.length < 2) {
    return {};
  }

  const matchesSortedByDateDesc = [...matches].sort((a, b) => b.date.localeCompare(a.date));
  const currentStandings = buildStandings(matchesSortedByDateDesc, standingsOptions).sort(defaultStandingsComparator);
  const previousStandings = buildStandings(matchesSortedByDateDesc.slice(1), standingsOptions)
    .sort(defaultStandingsComparator);

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

function matchSignature(match) {
  return `${match.date}|${match.winner}|${match.loser}|${match.result.winnerSets}:${match.result.loserSets}`;
}

function countNewMatches(previousMatches, nextMatches) {
  if (!previousMatches.length || !nextMatches.length) {
    return 0;
  }

  const previousSignatures = new Set(previousMatches.map(matchSignature));
  let newMatchesCount = 0;
  for (const match of nextMatches) {
    if (!previousSignatures.has(matchSignature(match))) {
      newMatchesCount += 1;
    }
  }
  return newMatchesCount;
}

function formatHistoryMatchForPlayer(match, player) {
  const isWinner = match.winner === player;
  const ownSets = isWinner ? match.result.winnerSets : match.result.loserSets;
  const oppSets = isWinner ? match.result.loserSets : match.result.winnerSets;
  return `${match.date} (${ownSets}:${oppSets})`;
}

function renderStandings(standings, selectedPlayer, positionChangeByPlayer = {}) {
  updateSortHeaders();
  const rows = standings
    .map((entry, index) => {
      const selectedClass = entry.player === selectedPlayer ? "is-selected" : "";
      const positionChange = positionChangeByPlayer[entry.player] || 0;
      const positionTrend = positionChange > 0
        ? '<span class="position-change up" aria-label="Pozycja poprawiła się od poprzedniego meczu">▲</span>'
        : positionChange < 0
          ? '<span class="position-change down" aria-label="Pozycja pogorszyła się od poprzedniego meczu">▼</span>'
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

function renderRemaining(remainingOpponents, selectedPlayer) {
  if (!remainingOpponents.length) {
    elements.remainingMatchesList.innerHTML = '<p class="hint">Brak zaległych meczów w tej lidze.</p>';
    return;
  }

  const items = remainingOpponents.map((opponent) => {
      const history = state.remainingHistoryByOpponent[opponent];
      const predictedPoints = state.remainingPointsPredictionByOpponent[opponent];
      const predictionLabel = typeof predictedPoints === "number"
        ? `Pred pkt: ${predictedPoints}`
        : "Pred pkt: -";
      let balanceLabel = '<span class="history-note">-</span>';
      let content = '<span class="history-note">Brak danych.</span>';

      if (history?.loading) {
        content = '<div class="panel-head"><p id="statusText">Ładowanie danych historycznych...</p></div>';
      } else if (history?.error) {
        content = '<p class="hint">Błąd pobierania danych historycznych.</p>';
      } else if (history?.matches) {
        if (history.matches.length === 0) {
          balanceLabel = 'Bilans H2H: 0-0';
          content = '<p class="history-note">Brak wcześniejszych meczów z tym graczem w systemie.</p>';
        } else {
          const wins = history.matches.filter((match) => match.winner === selectedPlayer).length;
          const losses = history.matches.length - wins;
          balanceLabel = `Bilans H2H: ${wins}-${losses}`;

          const historyRows = history.matches
            .map((match) => renderMatchRow(match, selectedPlayer, false))
            .join("");

          content = `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Wynik</th>
                  </tr>
                </thead>
                <tbody>${historyRows}</tbody>
              </table>
            </div>
          `;
        }
      }

      return `
        <div class="remaining-item">
          <div class="remaining-header" onclick="this.parentElement.classList.toggle('open')">
            <strong>${escapeHtml(titleCase(opponent))}</strong>
            <div class="remaining-header-metrics">
              <span class="remaining-pred-points">${predictionLabel}</span>
              <span class="h2h-balance">${balanceLabel}</span>
            </div>
          </div>
          <div class="remaining-content">
            ${content}
          </div>
        </div>
      `;
    })
    .join("");

  elements.remainingMatchesList.innerHTML = `<div class="remaining-accordion">${items}</div>`;
}

function renderPredictionInfo(playerSummary, selectedPlayer, remainingOpponentsCount) {
  if (!elements.predictionInfoBox) {
    return;
  }

  if (!selectedPlayer || !playerSummary) {
    elements.predictionInfoBox.innerHTML = '<p class="hint">Wybierz zawodnika, aby zobaczyć predykcję punktów końcowych.</p>';
    return;
  }

  const predicted = String(Math.round(Number(playerSummary.maxAvgPoints || 0)));
  const current = String(Math.round(Number(playerSummary.points || 0)));
  const maximum = String(Math.round(Number(playerSummary.maxPoints || 0)));
  const endsWithOne = remainingOpponentsCount % 10 === 1 && remainingOpponentsCount % 100 !== 11;
  const endsWithFew = [2, 3, 4].includes(remainingOpponentsCount % 10)
    && ![12, 13, 14].includes(remainingOpponentsCount % 100);
  const remainingLabel = endsWithOne ? "mecz" : (endsWithFew ? "mecze" : "meczów");

  elements.predictionInfoBox.innerHTML = `
    <p class="prediction-main">
      Predykcja końcowej liczby punktów: <strong>${predicted} pkt</strong>
    </p>
    <p class="prediction-details">
      Obecnie: ${current} pkt | Matematyczne maksimum: ${maximum} pkt | Pozostałe mecze: ${remainingOpponentsCount} ${remainingLabel}
    </p>
  `;
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
  hideNewDataBadge();
  state.remainingPointsPredictionByOpponent = {};
  updateSelectedPlayerHeading("");
  elements.standingsBody.innerHTML = '<tr><td colspan="6">Wybierz sezon i ligę.</td></tr>';
  elements.playerMatchesBody.innerHTML = '<tr><td colspan="3">Wybierz zawodnika.</td></tr>';
  elements.allMatchesBody.innerHTML = '<tr><td colspan="4">Wybierz sezon i ligę.</td></tr>';
  elements.remainingMatchesList.innerHTML = "";
  if (elements.predictionInfoBox) {
    elements.predictionInfoBox.innerHTML = '<p class="hint">Wybierz sezon, ligę i zawodnika.</p>';
  }
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

async function fetchHistoricalLeagueStrength(leagueId) {
  if (!leagueId) {
    return {
      byPlayer: {},
      avgPointsPerMatchPerPlayer: 2.5,
    };
  }

  if (state.historicalStrengthByLeagueId[leagueId]) {
    return state.historicalStrengthByLeagueId[leagueId];
  }

  if (state.shareMode) {
    const fallback = {
      byPlayer: {},
      avgPointsPerMatchPerPlayer: 2.5,
    };
    state.historicalStrengthByLeagueId[leagueId] = fallback;
    return fallback;
  }

  try {
    const defaults = state.formDefaults || {};
    const payload = new URLSearchParams();
    payload.append("show_strona", defaults.show_strona || "1");
    payload.append("id_sezon", "");
    payload.append("id_liga", leagueId);
    payload.append("id_gracz", "");
    payload.append("id_gracz2", "");
    payload.append("sort", defaults.sort || "data DESC");
    payload.append("limit", "2500");
    payload.append("show", defaults.show || "go");

    const html = await postForm(API_MATCHES_URL, payload);
    const model = buildHistoricalLeagueStrengthModel(parseMatches(htmlToDocument(html)));
    state.historicalStrengthByLeagueId[leagueId] = model;
    return model;
  } catch {
    return {
      byPlayer: {},
      avgPointsPerMatchPerPlayer: 2.5,
    };
  }
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
  renderRemaining(remainingOpponents, selectedPlayer);

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
    renderRemaining(remainingOpponents, selectedPlayer);
    updateDashboard(leagueLabel, { skipHistoryLoad: true });
  }
}

async function initialize() {
  elements.statusText.textContent = "Ładowanie danych...";

  const context = await getInitialContext();
  state.playerIdByName = context.playerIdByName || {};
  const stored = loadSelections();
  setControlsCollapsed(Boolean(stored.controlsCollapsed));
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

  hideNewDataBadge();
  setLoadingState(true, options.statusText || "Pobieranie meczów...");

  try {
    const seasonId = state.season.value;
    const leagueId = state.selectedLeagueId;
    const isSameContextAsLastLoad = state.loadedContext.seasonId === seasonId
      && state.loadedContext.leagueId === leagueId;
    const previousMatches = state.matches;
    const selectedLeague = state.leagues.find((league) => league.value === state.selectedLeagueId);

    const [nextMatches, historicalLeagueStrength] = await Promise.all([
      fetchMatchesForLeague(seasonId, leagueId),
      fetchHistoricalLeagueStrength(leagueId),
    ]);
    const newMatchesCount = isSameContextAsLastLoad ? countNewMatches(previousMatches, nextMatches) : 0;

    state.matches = nextMatches;
    state.loadedContext = { seasonId, leagueId };
    state.historicalLeagueStrengthByPlayer = historicalLeagueStrength.byPlayer || {};
    state.historicalLeagueAvgPointsPerMatch = historicalLeagueStrength.avgPointsPerMatchPerPlayer || 2.5;
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
    if (newMatchesCount > 0) {
      showNewDataBadge(newMatchesCount);
    }
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

function getStandingsModelOptions() {
  return {
    historicalStrengthByPlayer: state.historicalLeagueStrengthByPlayer,
    historicalLeagueAvgPointsPerMatch: state.historicalLeagueAvgPointsPerMatch,
  };
}

function calculateExpectedPointsByOpponent(matches, standings, selectedPlayer, remainingOpponents, modelOptions = {}) {
  const result = {};
  if (!selectedPlayer || !remainingOpponents.length) {
    return result;
  }

  const historicalStrengthByPlayer = modelOptions.historicalStrengthByPlayer || {};
  const historicalLeagueAvgPointsPerMatch = modelOptions.historicalLeagueAvgPointsPerMatch || 2.5;
  const pointsProfile = buildPointsOutcomeProfile(matches);
  const standingsByPlayer = new Map(standings.map((entry) => [entry.player, entry]));
  const selectedEntry = standingsByPlayer.get(selectedPlayer);
  if (!selectedEntry) {
    return result;
  }

  const totalByMatch = matches.reduce((sum, match) => {
    const points = calculatePointsForMatch(match);
    return sum + points.winnerPoints + points.loserPoints;
  }, 0);
  const leagueAvgPointsPerMatchPerPlayer = matches.length > 0
    ? totalByMatch / (2 * matches.length)
    : 2.5;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function blendedPointsPerMatch(player) {
    const entry = standingsByPlayer.get(player);
    const currentPpm = entry?.played > 0 ? entry.points / entry.played : leagueAvgPointsPerMatchPerPlayer;
    const historicalPpm = historicalStrengthByPlayer[player];
    const leagueBaseline = leagueAvgPointsPerMatchPerPlayer * 0.7 + historicalLeagueAvgPointsPerMatch * 0.3;

    if (typeof historicalPpm !== "number" || Number.isNaN(historicalPpm)) {
      return currentPpm;
    }
    if (!entry || entry.played === 0) {
      return leagueBaseline * 0.45 + historicalPpm * 0.55;
    }
    return currentPpm * 0.72 + historicalPpm * 0.28;
  }

  const playerWinRate = (selectedEntry.wins + 1) / (selectedEntry.played + 2);
  const playerStrength = blendedPointsPerMatch(selectedPlayer) / 5;

  for (const opponent of remainingOpponents) {
    const opponentStrength = blendedPointsPerMatch(opponent) / 5;
    const winChance = clamp(
      0.12 + playerWinRate * 0.7 + (playerStrength - opponentStrength) * 0.35,
      0.03,
      0.97,
    );
    result[opponent] = pickMostLikelyPointsForMatch(winChance, pointsProfile);
  }

  return result;
}

function updateDashboard(leagueLabel, options = {}) {
  const skipHistoryLoad = Boolean(options.skipHistoryLoad);
  const selectedPlayer = state.selectedPlayer;
  const matches = state.matches;
  updateSelectedPlayerHeading(selectedPlayer);

  const standings = sortStandings(
    buildStandings(matches, getStandingsModelOptions()),
  );
  const positionChangeByPlayer = buildPositionChangeByPlayer(matches, getStandingsModelOptions());
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
  state.remainingPointsPredictionByOpponent = calculateExpectedPointsByOpponent(
    matches,
    standings,
    selectedPlayer,
    remainingOpponents,
    getStandingsModelOptions(),
  );
  if (!selectedPlayer) {
    state.remainingHistoryByOpponent = {};
    state.remainingPointsPredictionByOpponent = {};
    elements.remainingMatchesList.innerHTML = '<p class="hint">Wybierz zawodnika, aby zobaczyć pozostałe mecze.</p>';
  } else {
    if (!skipHistoryLoad) {
      state.remainingHistoryByOpponent = {};
    }
    renderRemaining(remainingOpponents, selectedPlayer);
    if (!skipHistoryLoad) {
      loadRemainingHistories(selectedPlayer, remainingOpponents, leagueLabel);
    }
  }

  const playerSummary = standings.find((entry) => entry.player === selectedPlayer);
  const playerPosition = standings.findIndex((entry) => entry.player === selectedPlayer);
  renderPredictionInfo(playerSummary, selectedPlayer, remainingOpponents.length);
  elements.playedCount.textContent = String(playerMatches.length);
  elements.playerPoints.textContent = String(playerSummary?.points ?? 0);
  elements.remainingCount.textContent = String(remainingOpponents.length);
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

elements.refreshButton.addEventListener("click", async () => {
  await refreshLeagueData(state.selectedPlayer);
});

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

initialize().catch((error) => {
  elements.statusText.textContent = `Błąd: ${error.message}`;
  elements.standingsBody.innerHTML = '<tr><td colspan="10">Nie udało się pobrać danych.</td></tr>';
  elements.playerMatchesBody.innerHTML = '<tr><td colspan="3">Brak danych.</td></tr>';
  elements.allMatchesBody.innerHTML = '<tr><td colspan="4">Brak danych.</td></tr>';
  elements.remainingMatchesList.innerHTML = '<li class="hint">Sprawdź proxy /api i połączenie z tenisv.pl.</li>';
});
