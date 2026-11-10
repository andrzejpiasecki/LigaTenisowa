import { createHash, timingSafeEqual } from "node:crypto";
import { normalizePlayerPhone } from "@/lib/player-security";

export function isSmsSyncAuthorized(authorization: string | null, secret: string | undefined) {
  if (!secret || !/^[A-Za-z0-9_-]{32,128}$/.test(secret) || !authorization?.startsWith("Bearer ")) return false;
  const actual = authorization.slice(7);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(actual)) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(secret));
}

export function indexSmsPlayers(players: Array<{ id: string; phone: string | null }>) {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const player of players) {
    if (!player.phone) continue;
    let phone: string;
    try { phone = normalizePlayerPhone(player.phone); } catch { continue; }
    if (ambiguous.has(phone)) continue;
    if (index.has(phone)) {
      index.delete(phone);
      ambiguous.add(phone);
    } else {
      index.set(phone, player.id);
    }
  }
  return index;
}

export function selectSyncedMessages(payload: unknown, players: Map<string, string>) {
  if (typeof payload !== "object" || payload === null || !("messages" in payload)
    || !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 25) {
    throw new Error("Paczka musi zawierać od 1 do 25 wiadomości.");
  }
  const acknowledged: number[] = [];
  const rows = [];
  for (const [index, message] of payload.messages.entries()) {
    if (!message || typeof message.phone !== "string" || message.phone.length > 64) continue;
    let phone: string;
    try { phone = normalizePlayerPhone(message.phone); } catch { continue; }
    const playerId = players.get(phone);
    if (!playerId) continue;
    const { direction, body, timestamp } = message;
    if ((direction !== "incoming" && direction !== "outgoing") || typeof body !== "string" || !body.trim()
      || body.includes("\u0000") || body.length > 12000 || !Number.isSafeInteger(timestamp)
      || timestamp <= 0 || timestamp > Date.now() + 86400000) continue;
    const id = createHash("sha256").update(JSON.stringify([playerId, phone, direction, timestamp, body])).digest("hex");
    rows.push({ id, playerId, phone, direction: direction as "incoming" | "outgoing", body, occurredAt: new Date(timestamp) });
    acknowledged.push(index);
  }
  return { rows, acknowledged };
}
