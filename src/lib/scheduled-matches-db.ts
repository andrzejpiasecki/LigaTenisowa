import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { getDatabaseSchema, getScopedDatabaseUrl } from "@/lib/database-url";
import { formatImportedPlayerName, normalizePersonName } from "@/lib/results-directory";
import { buildSmartProposals } from "@/lib/smart-matchmaker";
import { parseSmsAvailabilityWithAi } from "@/lib/sms-ai-parser";
import {
  normalizeCourtPayload,
  normalizePlayerProfileUpdatePayload,
  normalizePlayerPayload,
  normalizeScheduledMatchPayload,
  type Court,
  type CourtPayload,
  type InboundSms,
  type InboundSmsAvailabilityStatus,
  type MatchHistory,
  type MatchProposal,
  type Player,
  type PlayerAvailability,
  type PlayerPayload,
  type PlayerProfileUpdatePayload,
  type PlayerResultsLinkPayload,
  type ResultsDirectoryEntry,
  type SchedulerOverview,
  type ScheduledMatch,
  type ScheduledMatchPayload,
} from "@/lib/scheduled-matches";

const DEFAULT_MATCH_DURATION_MINUTES = 90;

const globalForMatchesDb = globalThis as unknown as {
  scheduledMatchesPool?: Pool;
  scheduledMatchesConfigKey?: string;
};

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }

  return `"${value}"`;
}

function getPool() {
  const connectionString = getScopedDatabaseUrl({ unpooled: true });
  const schema = getDatabaseSchema();
  const configKey = `${connectionString}|${schema}`;

  if (
    globalForMatchesDb.scheduledMatchesPool
    && globalForMatchesDb.scheduledMatchesConfigKey === configKey
  ) {
    return {
      pool: globalForMatchesDb.scheduledMatchesPool,
      schema,
    };
  }

  const pool = new Pool({ connectionString });

  if (process.env.NODE_ENV !== "production") {
    globalForMatchesDb.scheduledMatchesPool = pool;
    globalForMatchesDb.scheduledMatchesConfigKey = configKey;
  }

  return { pool, schema };
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function durationEnd(startIso: string, fallbackMinutes = DEFAULT_MATCH_DURATION_MINUTES) {
  const date = new Date(startIso);
  return new Date(date.getTime() + fallbackMinutes * 60 * 1000).toISOString();
}

function overlapClause(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return `${leftStart} < ${rightEnd} AND ${leftEnd} > ${rightStart}`;
}

function mapRowToScheduledMatch(row: Record<string, unknown>): ScheduledMatch {
  return {
    id: String(row.id),
    season: String(row.season),
    league: String(row.league),
    playerOneId: String(row.playerOneId || ""),
    playerOne: String(row.playerOne),
    playerOnePhone: String(row.playerOnePhone || ""),
    playerTwoId: String(row.playerTwoId || ""),
    playerTwo: String(row.playerTwo),
    playerTwoPhone: String(row.playerTwoPhone || ""),
    courtId: String(row.courtId || ""),
    courtName: String(row.courtName || ""),
    scheduledAt: new Date(String(row.scheduledAt)).toISOString(),
    location: String(row.location || ""),
    status: String(row.status) as ScheduledMatch["status"],
    adminNotes: String(row.adminNotes || ""),
    createdAt: new Date(String(row.createdAt)).toISOString(),
    updatedAt: new Date(String(row.updatedAt)).toISOString(),
    createdBy: String(row.createdBy),
  };
}

function mapRowToInboundSms(row: Record<string, unknown>): InboundSms {
  return {
    id: String(row.id),
    provider: String(row.provider),
    externalId: String(row.externalId || ""),
    fromNumber: String(row.fromNumber),
    toNumber: String(row.toNumber || ""),
    body: String(row.body),
    matchedPlayer: String(row.matchedPlayer || ""),
    matchedPlayerId: String(row.matchedPlayerId || ""),
    parsedSummary: String(row.parsedSummary || ""),
    parsedAvailability: String(row.parsedAvailability) as InboundSmsAvailabilityStatus,
    parsedStartsAt: row.parsedStartsAt ? new Date(String(row.parsedStartsAt)).toISOString() : "",
    parsedEndsAt: row.parsedEndsAt ? new Date(String(row.parsedEndsAt)).toISOString() : "",
    parsedReason: String(row.parsedReason || ""),
    parsedInactiveUntil: row.parsedInactiveUntil ? new Date(String(row.parsedInactiveUntil)).toISOString() : "",
    receivedAt: new Date(String(row.receivedAt)).toISOString(),
    createdAt: new Date(String(row.createdAt)).toISOString(),
    scheduledMatchId: String(row.scheduledMatchId || ""),
  };
}

function mapRowToPlayer(row: Record<string, unknown>): Player {
  return {
    id: String(row.id),
    fullName: String(row.fullName),
    phone: String(row.phone || ""),
    league: String(row.league),
    season: String(row.season),
    resultsPlayerId: String(row.resultsPlayerId || ""),
    resultsPlayerName: String(row.resultsPlayerName || ""),
    skillLevel: Number(row.skillLevel || 5),
    preferences: String(row.preferences || ""),
    status: String(row.status) as Player["status"],
    inactiveUntil: row.inactiveUntil ? new Date(String(row.inactiveUntil)).toISOString() : "",
    notes: String(row.notes || ""),
  };
}

function mapRowToCourt(row: Record<string, unknown>): Court {
  return {
    id: String(row.id),
    name: String(row.name),
    location: String(row.location || ""),
    openingTime: String(row.openingTime || "07:00"),
    closingTime: String(row.closingTime || "22:00"),
    isActive: Boolean(row.isActive),
    notes: String(row.notes || ""),
  };
}

function mapRowToAvailability(row: Record<string, unknown>): PlayerAvailability {
  return {
    id: String(row.id),
    playerId: String(row.playerId),
    kind: String(row.kind) as PlayerAvailability["kind"],
    source: String(row.source) as PlayerAvailability["source"],
    startsAt: new Date(String(row.startsAt)).toISOString(),
    endsAt: new Date(String(row.endsAt)).toISOString(),
    summary: String(row.summary || ""),
    inboundSmsId: String(row.inboundSmsId || ""),
  };
}

function mapRowToHistory(row: Record<string, unknown>): MatchHistory {
  return {
    id: String(row.id),
    season: String(row.season),
    league: String(row.league),
    playerOneId: String(row.playerOneId),
    playerTwoId: String(row.playerTwoId),
    courtId: String(row.courtId || ""),
    playedAt: new Date(String(row.playedAt)).toISOString(),
    notes: String(row.notes || ""),
  };
}

function mapRowToProposal(row: Record<string, unknown>): MatchProposal {
  return {
    id: String(row.id),
    season: String(row.season),
    league: String(row.league),
    playerOneId: String(row.playerOneId),
    playerOneName: String(row.playerOneName || ""),
    playerTwoId: String(row.playerTwoId),
    playerTwoName: String(row.playerTwoName || ""),
    courtId: String(row.courtId || ""),
    courtName: String(row.courtName || ""),
    proposedStartsAt: new Date(String(row.proposedStartsAt)).toISOString(),
    proposedEndsAt: new Date(String(row.proposedEndsAt)).toISOString(),
    score: Number(row.score || 0),
    rationale: String(row.rationale || ""),
    status: String(row.status) as MatchProposal["status"],
    feedback: String(row.feedback || ""),
    sourceSmsId: String(row.sourceSmsId || ""),
  };
}

function scheduledMatchesSelect(schema: string) {
  const matchTable = `${quoteIdentifier(schema)}.${quoteIdentifier("ScheduledMatch")}`;
  const courtTable = `${quoteIdentifier(schema)}.${quoteIdentifier("Court")}`;
  return `
    SELECT
      match.*,
      court."name" AS "courtName"
    FROM ${matchTable} AS match
    LEFT JOIN ${courtTable} AS court ON court."id" = match."courtId"
  `;
}

function proposalsSelect(schema: string) {
  const proposalTable = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchProposal")}`;
  const playerTable = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const courtTable = `${quoteIdentifier(schema)}.${quoteIdentifier("Court")}`;
  return `
    SELECT
      proposal.*,
      player_one."fullName" AS "playerOneName",
      player_two."fullName" AS "playerTwoName",
      court."name" AS "courtName"
    FROM ${proposalTable} AS proposal
    INNER JOIN ${playerTable} AS player_one ON player_one."id" = proposal."playerOneId"
    INNER JOIN ${playerTable} AS player_two ON player_two."id" = proposal."playerTwoId"
    LEFT JOIN ${courtTable} AS court ON court."id" = proposal."courtId"
  `;
}

async function upsertPlayerAvailabilityFromSms(params: {
  pool: Pool;
  schema: string;
  playerId: string;
  inboundSmsId: string;
  kind: "dostepny" | "niedostepny";
  startsAt: string;
  endsAt: string;
  summary: string;
}) {
  const table = `${quoteIdentifier(params.schema)}.${quoteIdentifier("PlayerAvailability")}`;
  const kindEnum = `${quoteIdentifier(params.schema)}.${quoteIdentifier("AvailabilityKind")}`;
  const sourceEnum = `${quoteIdentifier(params.schema)}.${quoteIdentifier("AvailabilitySource")}`;

  await params.pool.query(
    `DELETE FROM ${table} WHERE "inboundSmsId" = $1`,
    [params.inboundSmsId],
  );

  await params.pool.query(
    `
      INSERT INTO ${table}
      ("id", "playerId", "kind", "source", "startsAt", "endsAt", "summary", "inboundSmsId", "createdAt")
      VALUES ($1, $2, $3::${kindEnum}, $4::${sourceEnum}, $5, $6, $7, $8, NOW())
    `,
    [
      randomUUID(),
      params.playerId,
      params.kind,
      "sms",
      params.startsAt,
      params.endsAt,
      params.summary,
      params.inboundSmsId,
    ],
  );
}

async function upsertPlayerStatusFromSms(params: {
  pool: Pool;
  schema: string;
  playerId: string;
  reason: string;
  inactiveUntil: string;
}) {
  const table = `${quoteIdentifier(params.schema)}.${quoteIdentifier("Player")}`;
  const statusEnum = `${quoteIdentifier(params.schema)}.${quoteIdentifier("PlayerStatus")}`;
  const notesSuffix = params.reason ? `Powód: ${params.reason}.` : "Status ustawiony automatycznie po SMS.";

  await params.pool.query(
    `
      UPDATE ${table}
      SET
        "status" = $2::${statusEnum},
        "inactiveUntil" = $3,
        "notes" = CASE
          WHEN "notes" = '' THEN $4
          ELSE CONCAT("notes", E'\\n', $4)
        END,
        "updatedAt" = NOW()
      WHERE "id" = $1
    `,
    [params.playerId, "nieaktywny", params.inactiveUntil || null, notesSuffix],
  );
}

async function syncMatchHistoryForCompletedMatch(pool: Pool, schema: string, match: ScheduledMatch) {
  if (match.status !== "rozegrany" || !match.playerOneId || !match.playerTwoId) {
    return;
  }

  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchHistory")}`;
  const existing = await pool.query(
    `
      SELECT "id"
      FROM ${table}
      WHERE "season" = $1
        AND "league" = $2
        AND "playerOneId" = $3
        AND "playerTwoId" = $4
        AND "playedAt" = $5
      LIMIT 1
    `,
    [match.season, match.league, match.playerOneId, match.playerTwoId, match.scheduledAt],
  );

  if (existing.rows.length) {
    return;
  }

  await pool.query(
    `
      INSERT INTO ${table}
      ("id", "season", "league", "playerOneId", "playerTwoId", "courtId", "playedAt", "notes", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
    [
      randomUUID(),
      match.season,
      match.league,
      match.playerOneId,
      match.playerTwoId,
      match.courtId || null,
      match.scheduledAt,
      match.adminNotes,
    ],
  );
}

export async function listScheduledMatchesFromDb() {
  const { pool, schema } = getPool();
  const result = await pool.query(`${scheduledMatchesSelect(schema)} ORDER BY match."scheduledAt" DESC`);
  return result.rows.map(mapRowToScheduledMatch);
}

export async function listInboundSmsFromDb(limit = 50) {
  const { pool, schema } = getPool();
  const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier("InboundSms")}`;
  const result = await pool.query(`SELECT * FROM ${qualifiedTable} ORDER BY "receivedAt" DESC LIMIT $1`, [limit]);
  return result.rows.map(mapRowToInboundSms);
}

export async function listPlayersFromDb() {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const result = await pool.query(`SELECT * FROM ${table} ORDER BY "league", "season", "fullName"`);
  return result.rows.map(mapRowToPlayer);
}

export async function createPlayerInDb(payload: PlayerPayload) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("PlayerStatus")}`;
  const normalized = normalizePlayerPayload(payload);
  const result = await pool.query(
    `
      INSERT INTO ${table}
      ("id", "fullName", "phone", "league", "season", "resultsPlayerId", "resultsPlayerName", "skillLevel", "preferences", "status", "inactiveUntil", "notes", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8::${statusEnum}, $9, $10, NOW(), NOW())
      RETURNING *
    `,
    [
      randomUUID(),
      normalized.fullName,
      normalizePhone(normalized.phone) || null,
      normalized.league,
      normalized.season,
      normalized.skillLevel,
      normalized.preferences,
      normalized.status,
      normalized.inactiveUntil || null,
      normalized.notes,
    ],
  );
  return mapRowToPlayer(result.rows[0]);
}

export async function updatePlayerResultsLinkInDb(id: string, payload: PlayerResultsLinkPayload) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const result = await pool.query(
    `
      UPDATE ${table}
      SET
        "resultsPlayerId" = $2,
        "resultsPlayerName" = $3,
        "updatedAt" = NOW()
      WHERE "id" = $1
      RETURNING *
    `,
    [id, payload.resultsPlayerId.trim() || null, payload.resultsPlayerName.trim() || null],
  );

  if (!result.rows.length) {
    throw new Error("Nie znaleziono zawodnika do aktualizacji.");
  }

  return mapRowToPlayer(result.rows[0]);
}

export async function updatePlayerProfileInDb(id: string, payload: PlayerProfileUpdatePayload) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("PlayerStatus")}`;
  const normalized = normalizePlayerProfileUpdatePayload(payload);
  const result = await pool.query(
    `
      UPDATE ${table}
      SET
        "fullName" = $2,
        "phone" = $3,
        "league" = $4,
        "season" = $5,
        "status" = $6::${statusEnum},
        "updatedAt" = NOW()
      WHERE "id" = $1
      RETURNING *
    `,
    [
      id,
      normalized.fullName,
      normalizePhone(normalized.phone) || null,
      normalized.league,
      normalized.season,
      normalized.status,
    ],
  );

  if (!result.rows.length) {
    throw new Error("Nie znaleziono zawodnika do aktualizacji.");
  }

  return mapRowToPlayer(result.rows[0]);
}

export async function syncPlayersLeagueAssignmentInDb(params: {
  season: string;
  league: string;
  participantIds: string[];
}) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("PlayerStatus")}`;
  const participantKeys = [...new Set(params.participantIds.filter(Boolean).map((value) => normalizePersonName(value)))];
  const playersResult = await pool.query(
    `SELECT "id", "resultsPlayerName", "fullName" FROM ${table} WHERE "resultsPlayerName" IS NOT NULL OR "fullName" <> ''`,
  );
  const matchedPlayerIds = playersResult.rows
    .filter((row) => participantKeys.includes(normalizePersonName(String(row.resultsPlayerName || row.fullName || ""))))
    .map((row) => String(row.id));

  await pool.query(
    `
      UPDATE ${table}
      SET
        "season" = '',
        "league" = '',
        "updatedAt" = NOW()
      WHERE "season" = $1
        AND "league" = $2
        AND NOT ("id" = ANY($3::text[]))
    `,
    [params.season, params.league, matchedPlayerIds],
  );

  if (!matchedPlayerIds.length) {
    return { updated: 0 };
  }

  const result = await pool.query(
    `
      UPDATE ${table}
      SET
        "season" = $1,
        "league" = $2,
        "status" = $3::${statusEnum},
        "updatedAt" = NOW()
      WHERE "id" = ANY($4::text[])
      RETURNING "id"
    `,
    [params.season, params.league, "aktywny", matchedPlayerIds],
  );

  return { updated: result.rows.length };
}

export async function importPlayersFromResultsDirectoryInDb(entries: ResultsDirectoryEntry[]) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  let imported = 0;
  let updated = 0;

  for (const entry of entries) {
    const existing = await pool.query(
      `SELECT * FROM ${table} WHERE "resultsPlayerId" = $1 LIMIT 1`,
      [entry.id],
    );

    if (existing.rows.length) {
      await pool.query(
        `
          UPDATE ${table}
          SET "resultsPlayerName" = $2, "updatedAt" = NOW()
          WHERE "id" = $1
        `,
        [existing.rows[0].id, entry.name],
      );
      updated += 1;
      continue;
    }

    await pool.query(
      `
        INSERT INTO ${table}
        ("id", "fullName", "phone", "league", "season", "resultsPlayerId", "resultsPlayerName", "skillLevel", "preferences", "status", "inactiveUntil", "notes", "createdAt", "updatedAt")
        VALUES ($1, $2, NULL, $3, $4, $5, $6, 5, '', 'aktywny', NULL, '', NOW(), NOW())
      `,
      [
        randomUUID(),
        formatImportedPlayerName(entry.name),
        "",
        "",
        entry.id,
        entry.name,
      ],
    );
    imported += 1;
  }

  return { imported, updated };
}

export async function listCourtsFromDb() {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Court")}`;
  const result = await pool.query(`SELECT * FROM ${table} ORDER BY "isActive" DESC, "name"`);
  return result.rows.map(mapRowToCourt);
}

export async function createCourtInDb(payload: CourtPayload) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Court")}`;
  const normalized = normalizeCourtPayload(payload);
  const result = await pool.query(
    `
      INSERT INTO ${table}
      ("id", "name", "location", "openingTime", "closingTime", "isActive", "notes", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `,
    [
      randomUUID(),
      normalized.name,
      normalized.location,
      normalized.openingTime,
      normalized.closingTime,
      normalized.isActive,
      normalized.notes,
    ],
  );
  return mapRowToCourt(result.rows[0]);
}

export async function listAvailabilitiesFromDb() {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("PlayerAvailability")}`;
  const result = await pool.query(`SELECT * FROM ${table} ORDER BY "startsAt" DESC`);
  return result.rows.map(mapRowToAvailability);
}

export async function listMatchHistoryFromDb(limit = 100) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchHistory")}`;
  const result = await pool.query(`SELECT * FROM ${table} ORDER BY "playedAt" DESC LIMIT $1`, [limit]);
  return result.rows.map(mapRowToHistory);
}

export async function listMatchProposalsFromDb() {
  const { pool, schema } = getPool();
  const result = await pool.query(`${proposalsSelect(schema)} ORDER BY proposal."score" DESC, proposal."proposedStartsAt" ASC`);
  return result.rows.map(mapRowToProposal);
}

async function findScheduledMatchForPhone(pool: Pool, schema: string, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  const result = await pool.query(
    `
      ${scheduledMatchesSelect(schema)}
      WHERE REGEXP_REPLACE(COALESCE(match."playerOnePhone", ''), '[^0-9+]', '', 'g') = REGEXP_REPLACE($1, '[^0-9+]', '', 'g')
         OR REGEXP_REPLACE(COALESCE(match."playerTwoPhone", ''), '[^0-9+]', '', 'g') = REGEXP_REPLACE($1, '[^0-9+]', '', 'g')
      ORDER BY match."scheduledAt" DESC
      LIMIT 1
    `,
    [normalizedPhone],
  );

  if (!result.rows.length) {
    return null;
  }

  return mapRowToScheduledMatch(result.rows[0]);
}

async function findPlayerByPhone(pool: Pool, schema: string, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("Player")}`;
  const result = await pool.query(
    `
      SELECT *
      FROM ${table}
      WHERE REGEXP_REPLACE("phone", '[^0-9+]', '', 'g') = REGEXP_REPLACE($1, '[^0-9+]', '', 'g')
      LIMIT 1
    `,
    [normalizedPhone],
  );

  if (!result.rows.length) {
    return null;
  }

  return mapRowToPlayer(result.rows[0]);
}

export async function createScheduledMatchInDb(payload: ScheduledMatchPayload, createdBy: string) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("ScheduledMatch")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("ScheduledMatchStatus")}`;
  const normalized = normalizeScheduledMatchPayload(payload);
  const result = await pool.query(
    `
      INSERT INTO ${table}
      ("id", "season", "league", "playerOneId", "playerOne", "playerOnePhone", "playerTwoId", "playerTwo", "playerTwoPhone", "courtId", "scheduledAt", "location", "status", "adminNotes", "createdBy", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::${statusEnum}, $14, $15, NOW(), NOW())
      RETURNING *
    `,
    [
      randomUUID(),
      normalized.season,
      normalized.league,
      normalized.playerOneId || null,
      normalized.playerOne,
      normalized.playerOnePhone,
      normalized.playerTwoId || null,
      normalized.playerTwo,
      normalized.playerTwoPhone,
      normalized.courtId || null,
      normalized.scheduledAt,
      normalized.location,
      normalized.status,
      normalized.adminNotes,
      createdBy,
    ],
  );

  const hydrated = await pool.query(
    `${scheduledMatchesSelect(schema)} WHERE match."id" = $1`,
    [result.rows[0].id],
  );
  const match = mapRowToScheduledMatch(hydrated.rows[0]);
  await syncMatchHistoryForCompletedMatch(pool, schema, match);
  return match;
}

export async function updateScheduledMatchInDb(id: string, payload: ScheduledMatchPayload) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("ScheduledMatch")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("ScheduledMatchStatus")}`;
  const normalized = normalizeScheduledMatchPayload(payload);
  const result = await pool.query(
    `
      UPDATE ${table}
      SET
        "season" = $2,
        "league" = $3,
        "playerOneId" = $4,
        "playerOne" = $5,
        "playerOnePhone" = $6,
        "playerTwoId" = $7,
        "playerTwo" = $8,
        "playerTwoPhone" = $9,
        "courtId" = $10,
        "scheduledAt" = $11,
        "location" = $12,
        "status" = $13::${statusEnum},
        "adminNotes" = $14,
        "updatedAt" = NOW()
      WHERE "id" = $1
      RETURNING *
    `,
    [
      id,
      normalized.season,
      normalized.league,
      normalized.playerOneId || null,
      normalized.playerOne,
      normalized.playerOnePhone,
      normalized.playerTwoId || null,
      normalized.playerTwo,
      normalized.playerTwoPhone,
      normalized.courtId || null,
      normalized.scheduledAt,
      normalized.location,
      normalized.status,
      normalized.adminNotes,
    ],
  );

  if (!result.rows.length) {
    throw new Error("Nie znaleziono meczu do aktualizacji.");
  }

  const hydrated = await pool.query(
    `${scheduledMatchesSelect(schema)} WHERE match."id" = $1`,
    [id],
  );
  const match = mapRowToScheduledMatch(hydrated.rows[0]);
  await syncMatchHistoryForCompletedMatch(pool, schema, match);
  return match;
}

export async function deleteScheduledMatchInDb(id: string) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("ScheduledMatch")}`;
  const result = await pool.query(`DELETE FROM ${table} WHERE "id" = $1 RETURNING "id"`, [id]);

  if (!result.rows.length) {
    throw new Error("Nie znaleziono meczu do usunięcia.");
  }
}

async function replaceProposalsForSms(params: {
  pool: Pool;
  schema: string;
  sourceSmsId: string;
  created: Awaited<ReturnType<typeof buildSmartProposals>>;
}) {
  const table = `${quoteIdentifier(params.schema)}.${quoteIdentifier("MatchProposal")}`;
  const statusEnum = `${quoteIdentifier(params.schema)}.${quoteIdentifier("MatchProposalStatus")}`;

  await params.pool.query(
    `DELETE FROM ${table} WHERE "sourceSmsId" = $1 AND "status" = $2::${statusEnum}`,
    [params.sourceSmsId, "draft"],
  );

  for (const proposal of params.created) {
    await params.pool.query(
      `
        INSERT INTO ${table}
        ("id", "season", "league", "playerOneId", "playerTwoId", "courtId", "proposedStartsAt", "proposedEndsAt", "score", "rationale", "status", "feedback", "sourceSmsId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::${statusEnum}, $12, $13, NOW(), NOW())
      `,
      [
        randomUUID(),
        proposal.season,
        proposal.league,
        proposal.playerOneId,
        proposal.playerTwoId,
        proposal.courtId || null,
        proposal.proposedStartsAt,
        proposal.proposedEndsAt,
        proposal.score,
        proposal.rationale,
        "draft",
        "",
        params.sourceSmsId,
      ],
    );
  }
}

export async function regenerateProposalsInDb() {
  const { pool, schema } = getPool();
  const [players, courts, availabilities, matches, history, inboundSms] = await Promise.all([
    listPlayersFromDb(),
    listCourtsFromDb(),
    listAvailabilitiesFromDb(),
    listScheduledMatchesFromDb(),
    listMatchHistoryFromDb(500),
    listInboundSmsFromDb(100),
  ]);

  const relevantSms = inboundSms.filter((sms) => sms.matchedPlayerId && sms.parsedStartsAt);

  for (const sms of relevantSms) {
    const proposals = await buildSmartProposals({
      sms,
      players,
      courts,
      availabilities,
      matches,
      history,
    });
    await replaceProposalsForSms({
      pool,
      schema,
      sourceSmsId: sms.id,
      created: proposals,
    });
  }

  return listMatchProposalsFromDb();
}

export async function acceptProposalInDb(id: string, adminUserId: string) {
  const { pool, schema } = getPool();
  const proposalTable = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchProposal")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchProposalStatus")}`;
  const result = await pool.query(
    `${proposalsSelect(schema)} WHERE proposal."id" = $1 LIMIT 1`,
    [id],
  );

  if (!result.rows.length) {
    throw new Error("Nie znaleziono propozycji.");
  }

  const proposal = mapRowToProposal(result.rows[0]);
  await pool.query(
    `
      UPDATE ${proposalTable}
      SET "status" = $2::${statusEnum}, "updatedAt" = NOW()
      WHERE "id" = $1
    `,
    [id, "accepted"],
  );

  const playerLookup = new Map((await listPlayersFromDb()).map((player) => [player.id, player]));
  const playerOne = playerLookup.get(proposal.playerOneId);
  const playerTwo = playerLookup.get(proposal.playerTwoId);

  await createScheduledMatchInDb(
    {
      season: proposal.season,
      league: proposal.league,
      playerOneId: proposal.playerOneId,
      playerOne: playerOne?.fullName || proposal.playerOneName,
      playerOnePhone: playerOne?.phone || "",
      playerTwoId: proposal.playerTwoId,
      playerTwo: playerTwo?.fullName || proposal.playerTwoName,
      playerTwoPhone: playerTwo?.phone || "",
      courtId: proposal.courtId,
      scheduledAt: proposal.proposedStartsAt,
      location: proposal.courtName || "",
      status: "oczekuje",
      adminNotes: `Zaakceptowano z AI draft. ${proposal.rationale}`,
    },
    adminUserId,
  );
}

export async function rejectProposalInDb(id: string, feedback: string) {
  const { pool, schema } = getPool();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchProposal")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("MatchProposalStatus")}`;
  const result = await pool.query(
    `
      UPDATE ${table}
      SET "status" = $2::${statusEnum}, "feedback" = $3, "updatedAt" = NOW()
      WHERE "id" = $1
      RETURNING "id"
    `,
    [id, "rejected", feedback.trim()],
  );

  if (!result.rows.length) {
    throw new Error("Nie znaleziono propozycji.");
  }
}

export async function getSchedulerOverviewFromDb(): Promise<SchedulerOverview> {
  const [matches, inboundSms, players, courts, availabilities, history, proposals] = await Promise.all([
    listScheduledMatchesFromDb(),
    listInboundSmsFromDb(),
    listPlayersFromDb(),
    listCourtsFromDb(),
    listAvailabilitiesFromDb(),
    listMatchHistoryFromDb(),
    listMatchProposalsFromDb(),
  ]);

  return {
    matches,
    inboundSms,
    players,
    courts,
    availabilities,
    history,
    proposals,
  };
}

export async function storeInboundSmsInDb(params: {
  provider: string;
  externalId?: string;
  fromNumber: string;
  toNumber?: string;
  body: string;
  receivedAt?: string;
  rawPayload: unknown;
}) {
  const { pool, schema } = getPool();
  const smsTable = `${quoteIdentifier(schema)}.${quoteIdentifier("InboundSms")}`;
  const statusEnum = `${quoteIdentifier(schema)}.${quoteIdentifier("InboundSmsAvailabilityStatus")}`;
  const receivedAt = params.receivedAt || new Date().toISOString();
  const externalId = params.externalId?.trim() || randomUUID();
  const [matchedMatch, matchedPlayer] = await Promise.all([
    findScheduledMatchForPhone(pool, schema, params.fromNumber),
    findPlayerByPhone(pool, schema, params.fromNumber),
  ]);
  const parsed = await parseSmsAvailabilityWithAi({
    body: params.body,
    receivedAt,
    match: matchedMatch,
  });

  const result = await pool.query(
    `
      INSERT INTO ${smsTable}
      ("id", "provider", "externalId", "fromNumber", "toNumber", "body", "matchedPlayer", "matchedPlayerId", "parsedSummary", "parsedAvailability", "parsedStartsAt", "parsedEndsAt", "parsedReason", "parsedInactiveUntil", "receivedAt", "createdAt", "rawPayload", "scheduledMatchId")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::${statusEnum}, $11, $12, $13, $14, $15, NOW(), $16::jsonb, $17)
      ON CONFLICT ("provider", "externalId")
      DO UPDATE SET
        "body" = EXCLUDED."body",
        "matchedPlayer" = EXCLUDED."matchedPlayer",
        "matchedPlayerId" = EXCLUDED."matchedPlayerId",
        "parsedSummary" = EXCLUDED."parsedSummary",
        "parsedAvailability" = EXCLUDED."parsedAvailability",
        "parsedStartsAt" = EXCLUDED."parsedStartsAt",
        "parsedEndsAt" = EXCLUDED."parsedEndsAt",
        "parsedReason" = EXCLUDED."parsedReason",
        "parsedInactiveUntil" = EXCLUDED."parsedInactiveUntil",
        "receivedAt" = EXCLUDED."receivedAt",
        "rawPayload" = EXCLUDED."rawPayload",
        "scheduledMatchId" = EXCLUDED."scheduledMatchId"
      RETURNING *
    `,
    [
      randomUUID(),
      params.provider,
      externalId,
      normalizePhone(params.fromNumber),
      params.toNumber ? normalizePhone(params.toNumber) : "",
      params.body,
      matchedPlayer?.fullName || matchedMatch?.playerOne || "",
      matchedPlayer?.id || null,
      parsed.summary,
      parsed.availability,
      parsed.startsAt || null,
      parsed.endsAt || null,
      parsed.reason || "",
      parsed.inactiveUntil || null,
      receivedAt,
      JSON.stringify(params.rawPayload ?? {}),
      matchedMatch?.id || null,
    ],
  );

  const saved = mapRowToInboundSms(result.rows[0]);

  if (matchedPlayer?.id && parsed.startsAt && (parsed.availability === "dostepny" || parsed.availability === "niedostepny")) {
    await upsertPlayerAvailabilityFromSms({
      pool,
      schema,
      playerId: matchedPlayer.id,
      inboundSmsId: saved.id,
      kind: parsed.availability,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt || durationEnd(parsed.startsAt),
      summary: parsed.summary,
    });
  }

  if (matchedPlayer?.id && parsed.inactiveUntil) {
    await upsertPlayerStatusFromSms({
      pool,
      schema,
      playerId: matchedPlayer.id,
      reason: parsed.reason,
      inactiveUntil: parsed.inactiveUntil,
    });
  }

  if (matchedPlayer?.id && parsed.startsAt) {
    const [players, courts, availabilities, matches, history] = await Promise.all([
      listPlayersFromDb(),
      listCourtsFromDb(),
      listAvailabilitiesFromDb(),
      listScheduledMatchesFromDb(),
      listMatchHistoryFromDb(500),
    ]);
    const proposals = await buildSmartProposals({
      sms: {
        ...saved,
        matchedPlayerId: matchedPlayer.id,
        matchedPlayer: matchedPlayer.fullName,
      },
      players,
      courts,
      availabilities,
      matches,
      history,
    });
    await replaceProposalsForSms({
      pool,
      schema,
      sourceSmsId: saved.id,
      created: proposals,
    });
  }

  return saved;
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return new Date(startA).getTime() < new Date(endB).getTime()
    && new Date(endA).getTime() > new Date(startB).getTime();
}

export function sqlOverlapExpression(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return overlapClause(leftStart, leftEnd, rightStart, rightEnd);
}
