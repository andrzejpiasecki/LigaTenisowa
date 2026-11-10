import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { secretToken, tokenHash } from "@/lib/player-security";

const COOKIE = "liga_player_session";
export async function currentPlayer() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await getDb().playerSession.findUnique({ where: { tokenHash: tokenHash(token) }, include: { player: true } });
  return session && session.expiresAt > new Date() ? session.player : null;
}
export async function createPlayerSession(playerId: string, expectedPasswordHash: string) {
  const token = secretToken();
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await getDb().$transaction(async (tx) => {
    // A password reset must not race with a login that checked the old password.
    await tx.$queryRaw`SELECT "playerId" FROM "PlayerAccount" WHERE "playerId" = ${playerId} FOR UPDATE`;
    const account = await tx.playerAccount.findUnique({ where: { playerId } });
    if (account?.passwordHash !== expectedPasswordHash) throw new Error("Hasło zostało zmienione. Zaloguj się nowym hasłem.");
    await tx.playerSession.create({ data: { tokenHash: tokenHash(token), playerId, expiresAt } });
  });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}
export async function logoutPlayer() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().playerSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
  jar.delete(COOKIE);
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new Error("Niedozwolone źródło żądania.");
}
