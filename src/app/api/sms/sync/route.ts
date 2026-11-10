import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { indexSmsPlayers, isSmsSyncAuthorized, selectSyncedMessages } from "@/lib/sms-sync";

const MAX_BYTES = 2_000_000;
const headers = { "Cache-Control": "no-store" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });

function authorized(request: Request) {
  return isSmsSyncAuthorized(request.headers.get("authorization"), process.env.SMS_SYNC_TOKEN);
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Nieprawidłowy token synchronizacji." }, 401);
  try {
    const players = await getDb().player.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } });
    const entries = [...indexSmsPlayers(players)].sort(([a], [b]) => a.localeCompare(b));
    const revision = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    return json({ phones: entries.map(([phone]) => phone), revision });
  } catch {
    return json({ error: "Nie udało się pobrać listy numerów." }, 503);
  }
}

async function readBatch(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("Wymagany format JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Brak danych.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Paczka jest zbyt duża.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "Nieprawidłowy token synchronizacji." }, 401);
  let payload: unknown;
  try { payload = await readBatch(request); } catch { return json({ error: "Nieprawidłowa lub zbyt duża paczka JSON." }, 400); }

  try {
    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      const players = await tx.player.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } });
      const { rows, acknowledged } = selectSyncedMessages(payload, indexSmsPlayers(players));
      const inserted = rows.length ? (await tx.syncedSms.createMany({ data: rows, skipDuplicates: true })).count : 0;
      return { inserted, acknowledged };
    });
    return json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Paczka musi zawierać od 1 do 25 wiadomości.") return json({ error: error.message }, 400);
    return json({ error: "Nie udało się zapisać paczki. Spróbuj ponownie." }, 503);
  }
}
