import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseSchema, getScopedDatabaseUrl } from "../src/lib/database-url.ts";
import { interpretSchedulingHistory, redactSchedulingHistory } from "../src/lib/scheduling-ai.ts";

dotenv.config({ path: ".env.local", quiet: true });

const { values: options } = parseArgs({ options: {
  report: { type: "string" },
  count: { type: "boolean" },
  apply: { type: "boolean" },
} });
if ((!options.count && !options.report) || (options.count && options.apply)) {
  console.error("Użycie: npm run analyze:sms -- --count | --report /tmp/liga-sms.json [--apply]");
  process.exit(1);
}

const schema = getDatabaseSchema();
const connectionString = getScopedDatabaseUrl({ unpooled: Boolean(process.env.DATABASE_URL_UNPOOLED) });
const database = new URL(connectionString);
const source = `${database.host}${database.pathname}/${schema}`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }) });
const localDateTime = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});
const localWeekday = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "long" });
const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", dateStyle: "short" });

function loadReport() {
  if (!existsSync(options.report)) {
    if (options.apply) throw new Error("Najpierw wygeneruj raport.");
    return { version: 1, source, players: {} };
  }
  const report = JSON.parse(readFileSync(options.report, "utf8"));
  if (report.version !== 1 || report.source !== source || !report.players || typeof report.players !== "object") {
    throw new Error("Raport pochodzi z innej bazy lub ma nieobsługiwany format.");
  }
  return report;
}

function saveReport(report) {
  const temp = `${options.report}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temp, options.report);
}

async function analyze(report) {
  if (!process.env.GEMINI_API_KEY) throw new Error("Ustaw GEMINI_API_KEY w .env.local.");
  const players = await db.player.findMany({
    where: { syncedSms: { some: { direction: "incoming" } } },
    select: { id: true, fullName: true },
    orderBy: { id: "asc" },
  });
  let failed = 0;
  let processed = 0;
  for (const { id, fullName } of players) {
    if (report.players[id]?.status === "ok") continue;
    const messages = await db.syncedSms.findMany({
      where: { playerId: id },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { occurredAt: true, direction: true, body: true },
    });
    const transcript = messages.map((message) => {
      const author = message.direction === "incoming" ? "Zawodnik" : "Organizator";
      // The local calendar anchor is noon so crossing a DST boundary cannot shift the weekday.
      const date = localDate.format(message.occurredAt);
      const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000);
      return `${localDateTime.format(message.occurredAt)} (jutro: ${localWeekday.format(tomorrow)}) ${author}: ${message.body}`;
    }).join("\n");
    try {
      const windows = await interpretSchedulingHistory(redactSchedulingHistory(transcript), true);
      report.players[id] = { fullName, status: "ok", messageCount: messages.length, approved: false, windows };
    } catch {
      failed++;
      report.players[id] = { fullName, status: "error", messageCount: messages.length, approved: false, windows: [] };
    }
    processed++;
    saveReport(report);
    console.log(`Przetworzono ${processed}; błędy: ${failed}.`);
  }
  if (!existsSync(options.report)) saveReport(report);
  console.log(`Rozmowy z odpowiedziami graczy: ${players.length}. Raport: ${options.report}`);
  if (failed) process.exitCode = 1;
}

async function apply(report) {
  let applied = 0;
  let skipped = 0;
  for (const [playerId, entry] of Object.entries(report.players)) {
    if (entry.status !== "ok" || entry.approved !== true) continue;
    const validTime = (time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (!Array.isArray(entry.windows) || entry.windows.length > 14 || entry.windows.some((window) =>
      !window || !Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7
      || !validTime(window.startTime) || !validTime(window.endTime) || window.startTime >= window.endTime
    )) throw new Error("Raport zawiera niepoprawne godziny.");
    if (!entry.windows.length) continue;
    const inserted = await db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "PlayerWeeklyAvailability" IN SHARE ROW EXCLUSIVE MODE`;
      if (!await tx.player.findUnique({ where: { id: playerId }, select: { id: true } })
        || await tx.playerWeeklyAvailability.count({ where: { playerId } })) return false;
      await tx.playerWeeklyAvailability.createMany({ data: entry.windows.map(({ weekday, startTime, endTime }) => ({
        playerId, weekday, startTime, endTime, notes: "Analiza historii SMS zatwierdzona przez organizatora",
      })) });
      return true;
    });
    if (inserted) applied++;
    else skipped++;
  }
  console.log(`Zapisano dostępność: ${applied}. Pominięto istniejącą dostępność lub brak profilu: ${skipped}.`);
}

try {
  if (options.count) {
    const [messages, players] = await Promise.all([
      db.syncedSms.count(),
      db.player.count({ where: { syncedSms: { some: { direction: "incoming" } } } }),
    ]);
    console.log(`Zsynchronizowane SMS-y: ${messages}. Rozmowy z odpowiedziami graczy: ${players}.`);
  } else {
    const report = loadReport();
    if (options.apply) await apply(report);
    else await analyze(report);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operacja nie powiodła się.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
