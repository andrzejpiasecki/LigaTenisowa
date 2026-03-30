const DEFAULT_PLAYER = "ANDRZEJ PIASECKI";
const API_FRAMES_URL = "/api/r_mecze.php";
const API_MATCHES_URL = "/api/mecze/mecze_lista.php";
const SHARE_DATA = typeof window !== "undefined" ? window.__SHARE_DATA || null : null;
const STORAGE_KEY = "liga-dashboard-selections";

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
};

const elements = {
  seasonSelect: document.getElementById("seasonSelect"),
  leagueSelect: document.getElementById("leagueSelect"),
  playerSelect: document.getElementById("playerSelect"),
  refreshButton: document.getElementById("refreshButton"),
  standingsBody: document.querySelector("#standingsTable tbody"),
  standingsHeaders: document.querySelectorAll("#standingsTable thead th[data-sort-key]"),
  playerMatchesBody: document.querySelector("#playerMatchesTable tbody"),
  remainingMatchesList: document.getElementById("remainingMatchesList"),
  playedCount: document.getElementById("playedCount"),
  playerPoints: document.getElementById("playerPoints"),
  remainingCount: document.getElementById("remainingCount"),
  statusText: document.getElementById("statusText"),
  seasonName: document.getElementById("seasonName"),
};

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
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    throw new Error(`Nie udalo sie pobrac danych (${response.status})`);
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
    throw new Error(`Nie udalo sie pobrac danych (${response.status})`);
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
  const totalPossibleMatches = participantsCount > 1 ? (participantsCount * (participantsCount - 1)) / 2 : 0;
  const leagueCompletion = totalPossibleMatches > 0 ? matches.length / totalPossibleMatches : 1;
  const leagueAvgPointsPerMatchPerPlayer = matches.length > 0
    ? (totalWinnerPoints + totalLoserPoints) / (2 * matches.length)
    : 2.5;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pointsPerMatch(entry) {
    return entry.played > 0 ? entry.points / entry.played : leagueAvgPointsPerMatchPerPlayer;
  }

  for (const entry of table.values()) {
    const playedOpponentsSet = opponentsMap.get(entry.player) || new Set();
    const playedOpponents = playedOpponentsSet.size;
    const remainingOpponents = Math.max(0, participantsCount - 1 - playedOpponents);

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
    const winChance = clamp(
      0.12 + playerWinRate * 0.7 + (playerStrength - opponentsStrength) * 0.35,
      0.03,
      0.97,
    );

    const seasonActivity = participantsCount > 1 ? playedOpponents / (participantsCount - 1) : 1;
    const completionFactor = clamp(0.1 + seasonActivity * 0.65 + leagueCompletion * 0.25, 0.1, 1);
    const expectedPointsPerFutureMatch = winChance * avgWinnerPoints + (1 - winChance) * avgLoserPoints;

    entry.maxPoints = entry.points + remainingOpponents * 5;
    entry.maxAvgPoints = entry.points + remainingOpponents * completionFactor * expectedPointsPerFutureMatch;
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

function playerMatchPoints(match, player) {
  const points = calculatePointsForMatch(match);
  return match.winner === player ? points.winnerPoints : points.loserPoints;
}

function matchSignature(match) {
  return `${match.date}|${match.winner}|${match.loser}|${match.result.winnerSets}:${match.result.loserSets}`;
}

function formatHistoryMatchForPlayer(match, player) {
  const isWinner = match.winner === player;
  const ownSets = isWinner ? match.result.winnerSets : match.result.loserSets;
  const oppSets = isWinner ? match.result.loserSets : match.result.winnerSets;
  return `${match.date} (${ownSets}:${oppSets})`;
}

function renderStandings(standings, selectedPlayer) {
  updateSortHeaders();
  const rows = standings
    .map((entry, index) => {
      const selectedClass = entry.player === selectedPlayer ? "is-selected" : "";
      return `
        <tr class="${selectedClass}">
          <td>${index + 1}</td>
          <td>${escapeHtml(titleCase(entry.player))}</td>
          <td>${entry.played}</td>
          <td>${entry.wins}</td>
          <td>${entry.losses}</td>
          <td>${entry.setsWon}:${entry.setsLost}</td>
          <td>${entry.gamesWon}:${entry.gamesLost}</td>
          <td><strong>${entry.points}</strong></td>
          <td><strong>${entry.maxPoints}</strong></td>
          <td><strong>${entry.maxAvgPoints.toFixed(1)}</strong></td>
        </tr>
      `;
    })
    .join("");

  elements.standingsBody.innerHTML = rows || '<tr><td colspan="10">Brak meczow.</td></tr>';
}

function renderPlayerMatches(matches, selectedPlayer) {
  const rows = matches
    .map((match) => {
      const isWinner = match.winner === selectedPlayer;
      const opponent = isWinner ? match.loser : match.winner;
      const playerSets = isWinner ? match.result.winnerSets : match.result.loserSets;
      const oppSets = isWinner ? match.result.loserSets : match.result.winnerSets;
      const gamesDetails = match.sets
        .map((set) => (isWinner ? `${set.first}:${set.second}` : `${set.second}:${set.first}`))
        .join(", ");
      const points = playerMatchPoints(match, selectedPlayer);
      return `
        <tr class="${isWinner ? "match-win" : "match-loss"}">
          <td>${match.date}</td>
          <td>${escapeHtml(titleCase(selectedPlayer))} - ${escapeHtml(titleCase(opponent))}</td>
          <td><span class="match-pill ${isWinner ? "win" : "loss"}">${isWinner ? "W" : "P"}</span> ${playerSets}:${oppSets}${gamesDetails ? ` (${gamesDetails})` : ""}</td>
          <td>${points}</td>
        </tr>
      `;
    })
    .join("");

  elements.playerMatchesBody.innerHTML = rows || '<tr><td colspan="4">Brak rozegranych meczow.</td></tr>';
}

function renderRemaining(remainingOpponents, selectedPlayer) {
  if (!remainingOpponents.length) {
    elements.remainingMatchesList.innerHTML = '<p class="hint">Brak zaleglych meczow w tej lidze.</p>';
    return;
  }

  const rows = remainingOpponents.map((opponent) => {
      const history = state.remainingHistoryByOpponent[opponent];
      let balance = '<span class="history-note">-</span>';
      let details = '<span class="history-note">Brak danych.</span>';

      if (history?.loading) {
        details = '<span class="history-note">Ladowanie...</span>';
      } else if (history?.error) {
        details = '<span class="history-note">Blad pobierania.</span>';
      } else if (history?.matches) {
        if (history.matches.length === 0) {
          balance = '0-0';
          details = "";
        } else {
          const wins = history.matches.filter((match) => match.winner === selectedPlayer).length;
          const losses = history.matches.length - wins;
          balance = `${wins}-${losses}`;

          const summary = history.matches
            .slice(0, 3)
            .map((match) => {
              return `<div class="history-line">${escapeHtml(formatHistoryMatchForPlayer(match, selectedPlayer))}</div>`;
            })
            .join("");
          details = `<div class="history-lines">${summary}</div>`;
        }
      }

      return `
        <tr>
          <td><strong>${escapeHtml(titleCase(opponent))}</strong></td>
          <td>${balance}</td>
          <td>${details}</td>
        </tr>
      `;
    })
    .join("");

  elements.remainingMatchesList.innerHTML = `
    <div class="table-wrap">
      <table class="remaining-table">
        <thead>
          <tr>
            <th>Przeciwnik</th>
            <th>Bilans H2H</th>
            <th>Ostatnie historyczne mecze</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function fillSelect(select, options, selectedValue) {
  select.innerHTML = options
    .map((option) => {
      const selectedAttr = option.value === selectedValue ? "selected" : "";
      return `<option value="${escapeHtml(option.value)}" ${selectedAttr}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
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

async function loadRemainingHistories(selectedPlayer, remainingOpponents) {
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
  }
}

async function initialize() {
  elements.statusText.textContent = "Ladowanie danych...";

  const context = await getInitialContext();
  state.playerIdByName = context.playerIdByName || {};
  const stored = loadSelections();
  state.seasons = context.allSeasons;

  const selectedSeason = state.seasons.find((season) => season.value === stored.seasonId) || context.latestSeason;
  state.season = selectedSeason;

  fillSelect(elements.seasonSelect, state.seasons, selectedSeason.value);
  elements.seasonName.textContent = selectedSeason.label;

  const primaryLeagueNames = new Set(["Extraliga", "1 Liga", "2 Liga", "3 Liga", "4 Liga"]);
  const primaryLeagues = context.allLeagues.filter((league) => primaryLeagueNames.has(league.label));
  state.leagues = (primaryLeagues.length ? primaryLeagues : context.allLeagues).map((league) => ({ ...league }));

  if (!state.leagues.length) {
    throw new Error("Brak lig z meczami w najnowszym sezonie.");
  }

  const defaultLeague = state.leagues.find((league) => /^2\s*Liga$/i.test(league.label));
  state.selectedLeagueId = state.leagues.some((league) => league.value === stored.leagueId)
    ? stored.leagueId
    : (defaultLeague || state.leagues[0]).value;
  fillSelect(elements.leagueSelect, state.leagues, state.selectedLeagueId);
  await refreshLeagueData(stored.player || "");
}

function chooseDefaultPlayer(players) {
  if (players.includes(DEFAULT_PLAYER)) {
    return DEFAULT_PLAYER;
  }
  return players[0] || "";
}

async function refreshLeagueData(preferredPlayer = "") {
  elements.statusText.textContent = "Pobieranie meczow...";
  const selectedLeague = state.leagues.find((league) => league.value === state.selectedLeagueId);
  elements.seasonName.textContent = state.season?.label || "-";

  state.matches = await fetchMatchesForLeague(state.season.value, state.selectedLeagueId);
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
}

function updateDashboard(leagueLabel) {
  const selectedPlayer = state.selectedPlayer;
  const matches = state.matches;

  const standings = sortStandings(buildStandings(matches));
  renderStandings(standings, selectedPlayer);

  const playerMatches = matches
    .filter((match) => match.winner === selectedPlayer || match.loser === selectedPlayer)
    .sort((a, b) => b.date.localeCompare(a.date));
  renderPlayerMatches(playerMatches, selectedPlayer);

  const participants = getParticipants(matches);
  const playedOpponents = new Set(
    playerMatches.map((match) => (match.winner === selectedPlayer ? match.loser : match.winner)),
  );
  const remainingOpponents = participants
    .filter((name) => name !== selectedPlayer)
    .filter((name) => !playedOpponents.has(name));
  state.remainingHistoryByOpponent = {};
  renderRemaining(remainingOpponents, selectedPlayer);
  loadRemainingHistories(selectedPlayer, remainingOpponents);

  const playerSummary = standings.find((entry) => entry.player === selectedPlayer);
  elements.playedCount.textContent = String(playerMatches.length);
  elements.playerPoints.textContent = String(playerSummary?.points ?? 0);
  elements.remainingCount.textContent = String(remainingOpponents.length);
  elements.statusText.textContent = `${state.season.label} | ${leagueLabel} | ${matches.length} meczow`;
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
    updateDashboard(league?.label || "");
  });
}

elements.seasonSelect.addEventListener("change", async (event) => {
  const nextSeason = state.seasons.find((season) => season.value === event.target.value);
  if (!nextSeason) {
    return;
  }

  state.season = nextSeason;
  const defaultLeague = state.leagues.find((league) => /^2\s*Liga$/i.test(league.label));
  if (!state.leagues.some((league) => league.value === state.selectedLeagueId)) {
    state.selectedLeagueId = (defaultLeague || state.leagues[0]).value;
    fillSelect(elements.leagueSelect, state.leagues, state.selectedLeagueId);
  }

  await refreshLeagueData(state.selectedPlayer);
});

elements.leagueSelect.addEventListener("change", async (event) => {
  state.selectedLeagueId = event.target.value;
  await refreshLeagueData(state.selectedPlayer);
});

elements.playerSelect.addEventListener("change", (event) => {
  state.selectedPlayer = event.target.value;
  saveSelections();
  const league = state.leagues.find((item) => item.value === state.selectedLeagueId);
  updateDashboard(league?.label || "");
});

elements.refreshButton.addEventListener("click", async () => {
  await refreshLeagueData(state.selectedPlayer);
});

initialize().catch((error) => {
  elements.statusText.textContent = `Blad: ${error.message}`;
  elements.standingsBody.innerHTML = '<tr><td colspan="10">Nie udalo sie pobrac danych.</td></tr>';
  elements.playerMatchesBody.innerHTML = '<tr><td colspan="4">Brak danych.</td></tr>';
  elements.remainingMatchesList.innerHTML = '<li class="hint">Sprawdz proxy /api i polaczenie z tenisv.pl.</li>';
});
