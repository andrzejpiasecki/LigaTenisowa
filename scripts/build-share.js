const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const OUTPUT_FILE = path.join(DIST_DIR, "share.html");

const BASE_URL = "http://tenisv.pl";
const PRIMARY_LEAGUES = new Set(["Extraliga", "1 Liga", "2 Liga", "3 Liga", "4 Liga"]);

function normalize(text) {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseOptionsFromSelect(html, selectName) {
  const selectMatch = html.match(
    new RegExp(`<select[^>]*name=["']${selectName}["'][^>]*>([\\s\\S]*?)</select>`, "i"),
  );
  if (!selectMatch) {
    return [];
  }

  const optionsHtml = selectMatch[1];
  const options = [];
  const optionRegex = /<option([^>]*)value=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/option>/gi;
  let match = optionRegex.exec(optionsHtml);

  while (match) {
    const attrs = `${match[1]} ${match[3]}`.toLowerCase();
    options.push({
      value: match[2],
      label: normalize(match[4]),
      selected: attrs.includes("selected"),
    });
    match = optionRegex.exec(optionsHtml);
  }

  return options;
}

function getMainFrameSrc(framesHtml) {
  const frameMatch = framesHtml.match(/<frame[^>]*name=["']main["'][^>]*src=["']([^"']+)["']/i);
  return frameMatch ? frameMatch[1] : "mecze/start.php";
}

function getCurrentSeason(seasonOptions) {
  const selected = seasonOptions.find((option) => option.selected && option.value);
  if (selected) {
    return { value: selected.value, label: selected.label };
  }

  const first = seasonOptions.find((option) => option.value);
  if (!first) {
    throw new Error("Cannot find current season option.");
  }

  return { value: first.value, label: first.label };
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }
  return response.text();
}

async function fetchLeagueHtml(seasonId, leagueId) {
  const payload = new URLSearchParams();
  payload.append("show_strona", "1");
  payload.append("id_sezon", seasonId);
  payload.append("id_liga", leagueId);
  payload.append("id_gracz", "");
  payload.append("id_gracz2", "");
  payload.append("sort", "data DESC");
  payload.append("limit", "500");
  payload.append("show", "go");

  return fetchText(`${BASE_URL}/mecze/mecze_lista.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
  });
}

async function buildShareData() {
  const framesHtml = await fetchText(`${BASE_URL}/r_mecze.php`);
  const mainFrameSrc = getMainFrameSrc(framesHtml).replace(/^\//, "");
  const formHtml = await fetchText(`${BASE_URL}/${mainFrameSrc}`);

  const seasons = parseOptionsFromSelect(formHtml, "id_sezon").filter((option) => option.value);
  const leagues = parseOptionsFromSelect(formHtml, "id_liga")
    .filter((option) => option.value)
    .filter((option) => PRIMARY_LEAGUES.has(option.label));

  const latestSeason = getCurrentSeason(seasons);
  const leagueHtmlById = {};

  for (const league of leagues) {
    leagueHtmlById[league.value] = await fetchLeagueHtml(latestSeason.value, league.value);
  }

  return {
    generatedAt: new Date().toISOString(),
    latestSeason,
    leagues: leagues.map((league) => ({ value: league.value, label: league.label })),
    leagueHtmlById,
  };
}

async function buildSingleHtml(shareData) {
  const [indexHtml, appJs, styleCss] = await Promise.all([
    fs.readFile(path.join(ROOT, "index.html"), "utf8"),
    fs.readFile(path.join(ROOT, "js", "app.js"), "utf8"),
    fs.readFile(path.join(ROOT, "css", "style.css"), "utf8"),
  ]);

  let output = indexHtml;
  output = output.replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${styleCss}\n</style>`);

  const shareDataScript = `<script>window.__SHARE_DATA=${JSON.stringify(shareData)};</script>`;
  const appScript = `<script>\n${appJs}\n</script>`;
  output = output.replace('<script src="js/app.js"></script>', `${shareDataScript}\n${appScript}`);

  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, output, "utf8");
}

async function main() {
  const shareData = await buildShareData();
  await buildSingleHtml(shareData);
  process.stdout.write(`Generated ${OUTPUT_FILE}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
