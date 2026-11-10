import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkOrigin, createPlayerSession, logoutPlayer } from "@/lib/player-auth";
import { hashPassword, normalizePlayerPhone, tokenHash, verifyPassword } from "@/lib/player-security";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const payload = await request.json();
    if (typeof payload.password !== "string") throw new Error("Podaj hasło.");
    const db = getDb();
    const phone = payload.invite ? null : normalizePlayerPhone(String(payload.phone || ""));
    // Persisted throttling works across application instances, without trusting IP headers.
    const key = tokenHash(String(payload.invite || phone));
    const attempts = await db.$transaction(async (tx) => {
      await tx.loginThrottle.deleteMany({ where: { key, expiresAt: { lt: new Date() } } });
      return tx.loginThrottle.upsert({ where: { key }, create: { key, expiresAt: new Date(Date.now() + 15 * 60000) }, update: { attempts: { increment: 1 } } });
    });
    if (attempts.attempts > 10) return NextResponse.json({ error: "Za dużo prób. Spróbuj za 15 minut." }, { status: 429 });
    let playerId: string;
    let expectedPasswordHash: string;
    if (typeof payload.invite === "string" && payload.invite.length <= 100) {
      const passwordHash = hashPassword(payload.password);
      expectedPasswordHash = passwordHash;
      playerId = await db.$transaction(async (tx) => {
        const account = await tx.playerAccount.findUnique({ where: { inviteHash: tokenHash(payload.invite) } });
        if (!account?.inviteExpiresAt || account.inviteExpiresAt < new Date() || account.passwordHash) throw new Error("Zaproszenie jest nieważne lub zostało już użyte.");
        const changed = await tx.playerAccount.updateMany({ where: { playerId: account.playerId, inviteHash: account.inviteHash, passwordHash: null }, data: { passwordHash, inviteHash: null, inviteExpiresAt: null } });
        if (!changed.count) throw new Error("Zaproszenie zostało już użyte.");
        return account.playerId;
      });
    } else {
      const players = await db.player.findMany({ where: { phone: { not: null } }, include: { account: true } });
      const matchingPlayers = players.filter((p) => { try { return normalizePlayerPhone(p.phone!) === phone; } catch { return false; } });
      if (matchingPlayers.length > 1) throw new Error("Numer jest przypisany do kilku graczy. Skontaktuj się z organizatorem.");
      const player = matchingPlayers[0];
      // Always perform scrypt to avoid distinguishing unknown phone numbers by timing.
      const valid = verifyPassword(payload.password, player?.account?.passwordHash || `00000000000000000000000000000000:${"0".repeat(128)}`);
      if (!valid || !player?.account?.passwordHash) return NextResponse.json({ error: "Niepoprawny numer lub hasło." }, { status: 401 });
      playerId = player.id;
      expectedPasswordHash = player.account.passwordHash;
    }
    await createPlayerSession(playerId, expectedPasswordHash);
    await db.loginThrottle.deleteMany({ where: { key } });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Nie udało się zalogować." }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  try { checkOrigin(request); await logoutPlayer(); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: "Brak dostępu." }, { status: 403 }); }
}
