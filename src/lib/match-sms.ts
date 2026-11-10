import { type Prisma, type ScheduledMatch } from "@prisma/client";
import { getDb } from "@/lib/db";
import { matchRevision, normalizePlayerPhone, secretToken, tokenHash } from "@/lib/player-security";
import { lockScheduledMatch, recordMatchReply } from "@/lib/player-scheduling";
import { type MatchSmsChoice, type MatchSmsPreview, type MatchSmsRecipient } from "@/lib/match-sms-types";

const DATE = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" });
const TEXT_DATE = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const UNSENT = ["queued", "failed", "cancelled"];
const LIVE_LINK = ["sending", "submitted", "unknown"];
type Client = Prisma.TransactionClient;
type MatchIdentity = Parameters<typeof matchRevision>[0] & { id: string; playerOne: string; playerTwo: string };

export class MatchSmsError extends Error {}

function settings() {
  let origin = "";
  try {
    const url = new URL(process.env.APP_PUBLIC_URL || "");
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) origin = url.origin;
  } catch { /* Display configuration error in the admin preview. */ }
  const sender = process.env.JUSTSEND_SENDER?.trim() || "";
  const key = process.env.JUSTSEND_APP_KEY?.trim() || "";
  return { origin, sender, key, configured: Boolean(origin && key && /^[A-Za-z0-9 ._-]{1,11}$/.test(sender)) };
}

function bodyFor(match: ScheduledMatch, origin: string, token: string) {
  return `Liga Tenisowa: ${TEXT_DATE.format(match.scheduledAt).replace(/\s+/g, " ")}. Odpowiedz: ${origin}/answer#${token}`;
}

function playerPhone(value: string | null | undefined) {
  try {
    const phone = normalizePlayerPhone(value || "");
    return /^\+48\d{9}$/.test(phone) ? phone : "";
  } catch { return ""; }
}

function canPropose(match: ScheduledMatch) {
  return ["propozycja", "oczekuje"].includes(match.status) && match.scheduledAt > new Date();
}

async function matchRecipients(tx: Client, match: ScheduledMatch) {
  const ids = [match.playerOneId, match.playerTwoId];
  const players = await tx.player.findMany({ where: { id: { in: ids.filter((id): id is string => Boolean(id)) } }, select: { id: true, phone: true } });
  const phones = new Map(players.map((player) => [player.id, playerPhone(player.phone)]));
  return [
    { playerId: match.playerOneId || "", name: match.playerOne, phone: phones.get(match.playerOneId || "") || "" },
    { playerId: match.playerTwoId || "", name: match.playerTwo, phone: phones.get(match.playerTwoId || "") || "" },
  ];
}

async function recipientStatuses(tx: Client, matches: MatchIdentity[]) {
  const ids = matches.map((match) => match.id);
  const [offers, replies] = await Promise.all([
    tx.matchSmsOffer.findMany({ where: { matchId: { in: ids } }, select: { matchId: true, playerId: true, revision: true, status: true } }),
    tx.matchReply.findMany({ where: { matchId: { in: ids } }, select: { matchId: true, playerId: true, revision: true, accepted: true, alternative: true } }),
  ]);
  const key = (row: { matchId: string; playerId: string; revision: string }) => JSON.stringify([row.matchId, row.playerId, row.revision]);
  const offerByKey = new Map(offers.map((row) => [key(row), row]));
  const replyByKey = new Map(replies.map((row) => [key(row), row]));
  return Object.fromEntries(matches.map((match) => {
    const revision = matchRevision(match);
    const recipients: MatchSmsRecipient[] = [
      { playerId: match.playerOneId || "", name: match.playerOne },
      { playerId: match.playerTwoId || "", name: match.playerTwo },
    ].map((player) => {
      const rowKey = key({ matchId: match.id, playerId: player.playerId, revision });
      const reply = replyByKey.get(rowKey);
      return { ...player, status: offerByKey.get(rowKey)?.status || "not_sent", reply: reply ? (reply.accepted ? "yes" : reply.alternative ? "alternative" : "no") : null, alternative: reply?.alternative || null };
    });
    return [match.id, recipients];
  }));
}

export async function listMatchSmsStatuses(matches: MatchIdentity[]): Promise<Record<string, MatchSmsRecipient[]>> {
  return matches.length ? recipientStatuses(getDb(), matches) : {};
}

async function preview(tx: Client, match: ScheduledMatch): Promise<MatchSmsPreview> {
  const { origin, sender, configured } = settings();
  const recipients = await matchRecipients(tx, match);
  const statuses = (await recipientStatuses(tx, [match]))[match.id];
  const court = match.courtId ? await tx.court.findUnique({ where: { id: match.courtId }, select: { name: true } }) : null;
  const distinct = Boolean(recipients[0].phone && recipients[1].phone
    && recipients[0].phone !== recipients[1].phone && recipients[0].playerId !== recipients[1].playerId);
  return {
    fingerprint: tokenHash(JSON.stringify([matchRevision(match), recipients, origin, sender, court?.name])),
    configured, sender,
    date: DATE.format(match.scheduledAt),
    court: [court?.name, match.location].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" · "),
    text: bodyFor(match, origin || "https://liga.example.pl", "[indywidualny-link]"),
    recipients: recipients.map((recipient, i) => ({
      ...statuses[i], phone: recipient.phone,
      canSend: canPropose(match) && distinct && !statuses[i].reply
        && !(match.dayPlan && statuses.some((r) => r.reply === "no" || r.reply === "alternative"))
        && (statuses[i].status === "not_sent" || UNSENT.includes(statuses[i].status)),
    })),
  };
}

export async function getMatchSmsPreview(id: string) {
  const db = getDb();
  const match = await db.scheduledMatch.findUnique({ where: { id } });
  if (!match) throw new MatchSmsError("Nie znaleziono meczu.");
  return preview(db, match);
}

async function sendOffer(id: string, fingerprint: string) {
  const db = getDb();
  const { origin, sender, key } = settings();
  const token = secretToken();
  const prepared = await db.$transaction(async (tx) => {
    const offer = await tx.matchSmsOffer.findUniqueOrThrow({ where: { id } });
    const match = await lockScheduledMatch(tx, offer.matchId);
    if (!match || !canPropose(match) || matchRevision(match) !== offer.revision) return null;
    const current = await preview(tx, match);
    const recipient = current.recipients.find((item) => item.playerId === offer.playerId);
    if (!current.configured || current.fingerprint !== fingerprint || !recipient?.canSend || recipient.phone !== offer.phone) return null;
    const expiresAt = new Date(Math.min(match.scheduledAt.getTime(), Date.now() + 7 * 86400000));
    const claim = await tx.matchSmsOffer.updateMany({
      where: { id, status: { in: UNSENT }, usedAt: null },
      data: { status: "sending", tokenHash: tokenHash(token), expiresAt, error: "" },
    });
    return claim.count ? { phone: offer.phone, body: bodyFor(match, origin, token) } : null;
  }, { timeout: 10000 });
  if (!prepared) return;
  try {
    const result = await fetch("https://justsend.io/api/sender/singlemessage/send", {
      method: "POST", signal: AbortSignal.timeout(10000), redirect: "error",
      headers: { "App-Key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender, msisdn: prepared.phone.slice(1), bulkVariant: "PRO", content: prepared.body }),
    });
    if (!result.ok) {
      const definiteFailure = result.status >= 400 && result.status < 500 && ![408, 409].includes(result.status);
      await db.matchSmsOffer.update({ where: { id }, data: {
        status: definiteFailure ? "failed" : "unknown", error: `JustSend: HTTP ${result.status}.`,
      } });
      return;
    }
    const data = await result.json();
    if (typeof data.id !== "string" && typeof data.id !== "number") throw new Error("Missing SMS ID");
    await db.matchSmsOffer.update({ where: { id }, data: { status: "submitted", gatewayId: String(data.id) } });
  } catch {
    await db.matchSmsOffer.updateMany({ where: { id, status: "sending" }, data: {
      status: "unknown", error: "Nie udało się potwierdzić przyjęcia SMS-a przez bramkę.",
    } });
  }
}

export async function sendMatchSms(id: string, fingerprint: string) {
  const db = getDb();
  const ids = await db.$transaction(async (tx) => {
    const match = await lockScheduledMatch(tx, id);
    if (!match || !canPropose(match)) throw new MatchSmsError("Termin nie przyjmuje nowych propozycji.");
    const current = await preview(tx, match);
    if (!current.configured) throw new MatchSmsError("Skonfiguruj JustSend i publiczny adres ligi.");
    if (current.fingerprint !== fingerprint) throw new MatchSmsError("Termin lub odbiorcy się zmienili. Otwórz podgląd ponownie.");
    const revision = matchRevision(match);
    const ids = [];
    for (const recipient of current.recipients.filter((r) => r.canSend)) {
      const key = { matchId: id, playerId: recipient.playerId, revision };
      const offer = await tx.matchSmsOffer.upsert({
        where: { matchId_playerId_revision: key },
        create: { ...key, phone: recipient.phone, expiresAt: match.scheduledAt },
        update: { phone: recipient.phone },
      });
      ids.push(offer.id);
    }
    return ids;
  }, { timeout: 10000 });
  if (!ids.length) throw new MatchSmsError("Brak odbiorców, do których można wysłać propozycję.");
  await Promise.all(ids.map((offerId) => sendOffer(offerId, fingerprint)));
  return getMatchSmsPreview(id);
}

function readHash(token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MatchSmsError("Link jest nieprawidłowy.");
  return tokenHash(token);
}

async function checkOffer(tx: Client, tokenHash: string) {
  const offer = await tx.matchSmsOffer.findUnique({ where: { tokenHash }, include: {
    match: { include: { court: { select: { name: true } } } },
    player: { select: { phone: true } },
  } });
  if (!offer || !LIVE_LINK.includes(offer.status)) throw new MatchSmsError("Link jest nieprawidłowy.");
  const { match } = offer;
  if (offer.expiresAt <= new Date() || match.scheduledAt <= new Date()
    || ["anulowany", "rozegrany"].includes(match.status) || matchRevision(match) !== offer.revision
    || ![match.playerOneId, match.playerTwoId].includes(offer.playerId) || playerPhone(offer.player.phone) !== offer.phone) {
    throw new MatchSmsError("Link wygasł lub termin się zmienił.");
  }
  if (offer.usedAt) throw new MatchSmsError("Odpowiedź została już zapisana.");
  return offer;
}

export async function getMatchSmsQuestion(token: unknown) {
  const offer = await checkOffer(getDb(), readHash(token));
  const { match } = offer;
  return { date: DATE.format(match.scheduledAt), court: match.court?.name || "", location: match.location,
    opponent: offer.playerId === match.playerOneId ? match.playerTwo : match.playerOne };
}

export async function submitMatchSmsAnswer(token: unknown, choice: unknown, text: unknown) {
  const hash = readHash(token);
  if (choice !== "yes" && choice !== "no" && choice !== "alternative") throw new MatchSmsError("Wybierz odpowiedź.");
  const alternative = choice === "alternative" && typeof text === "string" ? text.trim() : null;
  if (choice === "alternative" && (!alternative || alternative.length > 300 || alternative.includes("\u0000"))) {
    throw new MatchSmsError("Podaj inny termin (do 300 znaków).");
  }
  return getDb().$transaction(async (tx) => {
    const link = await tx.matchSmsOffer.findUnique({ where: { tokenHash: hash }, select: { matchId: true } });
    if (!link) throw new MatchSmsError("Link jest nieprawidłowy.");
    await lockScheduledMatch(tx, link.matchId);
    const offer = await checkOffer(tx, hash);
    const { confirmed } = await recordMatchReply(tx, offer.match, offer.playerId, offer.revision, choice === "yes", alternative);
    await tx.matchSmsOffer.update({ where: { id: offer.id }, data: { usedAt: new Date() } });
    return { confirmed, choice: choice as MatchSmsChoice };
  }, { timeout: 10000 });
}
