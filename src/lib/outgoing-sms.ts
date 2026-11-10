import { getDb } from "@/lib/db";
import { matchRevision, normalizePlayerPhone, secretToken, tokenHash } from "@/lib/player-security";

export function gatewayConfigured() { return Boolean(process.env.SMS_GATEWAY_URL && ((process.env.SMS_GATEWAY_USERNAME && process.env.SMS_GATEWAY_PASSWORD) || process.env.SMS_GATEWAY_TOKEN)); }
function publicOrigin() {
  if (!process.env.APP_PUBLIC_URL) throw new Error("Ustaw APP_PUBLIC_URL, aby linki SMS prowadziły do strony ligi.");
  const origin = new URL(process.env.APP_PUBLIC_URL);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") throw new Error("APP_PUBLIC_URL musi być publicznym adresem HTTPS aplikacji.");
  return origin.origin;
}
export async function prepareInvitations() {
  const origin = publicOrigin();
  const db = getDb();
  const players = await db.player.findMany({ where: { status: "aktywny", phone: { not: null } } });
  let count = 0;
  for (const player of players) {
    let phone: string;
    try { phone = normalizePlayerPhone(player.phone!); } catch { continue; }
    const token = secretToken();
    try {
      await db.$transaction(async (tx) => {
        // Primary key ensures a player receives only one invitation even with concurrent clicks.
        await tx.playerAccount.create({ data: { playerId: player.id, inviteHash: tokenHash(token), inviteExpiresAt: new Date(Date.now() + 30 * 86400000) } });
        await tx.outgoingSms.create({ data: { dedupeKey: `invite:${player.id}`, playerId: player.id, phone, body: `Liga tenisowa: ustaw haslo i dodaj dostepnosc: ${origin}/gracz/zaproszenie#${token} . Link aktywny 30 dni. Dostepnosc mozesz zmieniac po zalogowaniu. Nie odpowiadaj SMS-em.` } });
      });
      count++;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  return count;
}
export async function prepareMatchMessages() {
  const origin = publicOrigin(), db = getDb();
  const matches = await db.scheduledMatch.findMany({ where: { status: { in: ["propozycja", "oczekuje"] }, scheduledAt: { gt: new Date() } }, include: { playerOneRef: true, playerTwoRef: true } });
  let count = 0;
  for (const match of matches) {
    const revision = matchRevision(match);
    const date = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" }).format(match.scheduledAt);
    for (const player of [match.playerOneRef, match.playerTwoRef]) {
      if (!player?.phone) continue;
      let phone: string;
      try { phone = normalizePlayerPhone(player.phone); } catch { continue; }
      const dedupeKey = `match:${match.id}:${revision}:${player.id}`;
      const result = await db.outgoingSms.createMany({ skipDuplicates: true, data: [{ dedupeKey, playerId: player.id, phone, body: `Liga tenisowa: ${match.playerOne} - ${match.playerTwo}, ${date}, ${match.location}. Potwierdz lub odrzuc termin: ${origin}/gracz?mecz=${encodeURIComponent(match.id)} . Zaloguj sie numerem i haslem. Nie odpowiadaj SMS-em.` }] });
      count += result.count;
    }
  }
  return count;
}
export async function sendQueuedSms(id: string) {
  if (!gatewayConfigured()) throw new Error("Skonfiguruj bramkę SMS na telefonie przed wysyłką.");
  const db = getDb();
  // Claim atomically before the external effect. Uncertain requests are never retried automatically.
  const claimed = await db.outgoingSms.updateMany({ where: { id, status: "queued" }, data: { status: "sending", error: "" } });
  if (!claimed.count) throw new Error("Wiadomość została już przekazana lub jest w trakcie wysyłki.");
  const message = await db.outgoingSms.findUniqueOrThrow({ where: { id } });
  const player = await db.player.findUniqueOrThrow({ where: { id: message.playerId } });
  let currentPhone = "";
  try { currentPhone = normalizePlayerPhone(player.phone || ""); } catch { /* Invalid phone cancels this prepared message. */ }
  if (currentPhone !== message.phone) {
    await db.outgoingSms.update({ where: { id }, data: { status: "cancelled", error: "Numer zawodnika zmienił się. Wiadomość anulowana." } });
    throw new Error("Numer zawodnika zmienił się. Wiadomość anulowana.");
  }
  if (message.dedupeKey.startsWith("match:")) {
    const [, matchId, revision] = message.dedupeKey.split(":");
    const match = await db.scheduledMatch.findUnique({ where: { id: matchId } });
    if (!match || matchRevision(match) !== revision || !["propozycja", "oczekuje"].includes(match.status) || match.scheduledAt <= new Date()) {
      await db.outgoingSms.update({ where: { id }, data: { status: "cancelled", error: "Propozycja nie jest już aktualna." } });
      throw new Error("Propozycja nie jest już aktualna. Wiadomość anulowana.");
    }
  }
  try {
    const response = await fetch(`${process.env.SMS_GATEWAY_URL!.replace(/\/$/, "")}/messages`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: process.env.SMS_GATEWAY_TOKEN ? `Bearer ${process.env.SMS_GATEWAY_TOKEN}` : `Basic ${Buffer.from(`${process.env.SMS_GATEWAY_USERNAME}:${process.env.SMS_GATEWAY_PASSWORD}`).toString("base64")}` },
      body: JSON.stringify({ textMessage: { text: message.body }, phoneNumbers: [message.phone], ...(process.env.SMS_GATEWAY_DEVICE_ID ? { deviceId: process.env.SMS_GATEWAY_DEVICE_ID } : {}) }),
    });
    if (!response.ok) {
      await db.outgoingSms.update({ where: { id }, data: { status: "failed", error: `Bramka odrzuciła żądanie: HTTP ${response.status}.` } });
      throw new Error(`Bramka odrzuciła żądanie: HTTP ${response.status}.`);
    }
    const result = await response.json();
    await db.outgoingSms.update({ where: { id }, data: { status: "submitted", gatewayId: typeof result.id === "string" ? result.id : null } });
  } catch (e) {
    await db.outgoingSms.updateMany({ where: { id, status: "sending" }, data: { status: "unknown", error: "Nie można potwierdzić przekazania SMS. Sprawdź bramkę przed ponowną wysyłką." } });
    throw e;
  }
}
