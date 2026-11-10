import { getDb } from "@/lib/db";
import { hashPassword, normalizePlayerPhone, tokenHash } from "@/lib/player-security";

export async function setPlayerPassword(playerId: string, password: string) {
  const passwordHash = hashPassword(password);
  await getDb().$transaction(async (tx) => {
    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw new Error("Nie znaleziono zawodnika.");
    if (!player.phone) throw new Error("Najpierw dodaj numer telefonu zawodnika w bazie.");
    const phone = normalizePlayerPhone(player.phone);
    const previousAccount = await tx.playerAccount.findUnique({ where: { playerId } });

    await tx.playerAccount.upsert({
      where: { playerId },
      create: { playerId, passwordHash },
      update: { passwordHash, inviteHash: null, inviteExpiresAt: null },
    });
    await tx.playerSession.deleteMany({ where: { playerId } });
    await tx.loginThrottle.deleteMany({
      where: { key: { in: [tokenHash(phone), ...(previousAccount?.inviteHash ? [previousAccount.inviteHash] : [])] } },
    });
    await tx.outgoingSms.updateMany({
      where: { playerId, dedupeKey: `invite:${playerId}`, status: "queued" },
      data: { status: "cancelled", error: "Administrator ustawił hasło. Zaproszenie nie jest już potrzebne." },
    });
  });
}
