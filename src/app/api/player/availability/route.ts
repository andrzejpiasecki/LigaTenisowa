import { NextResponse } from "next/server";
import { checkOrigin, currentPlayer } from "@/lib/player-auth";
import { getDb } from "@/lib/db";
import { playerOverview, saveAvailability, saveWeekly } from "@/lib/player-scheduling";
import { interpretAvailability } from "@/lib/scheduling-ai";
export async function GET() {
  const player = await currentPlayer();
  if (!player) return NextResponse.json({ error: "Zaloguj się." }, { status: 401 });
  return NextResponse.json(await playerOverview(player.id));
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ error: "Zaloguj się." }, { status: 401 });
    const p = await request.json();
    if (p.action === "interpret") {
      const key = `ai:${player.id}`;
      const db = getDb();
      await db.loginThrottle.deleteMany({ where: { key, expiresAt: { lt: new Date() } } });
      const throttle = await db.loginThrottle.upsert({ where: { key }, create: { key, expiresAt: new Date(Date.now() + 3600000) }, update: { attempts: { increment: 1 } } });
      if (throttle.attempts > 20) return NextResponse.json({ error: "Limit interpretacji: 20 na godzinę. Dodaj terminy ręcznie." }, { status: 429 });
      return NextResponse.json(await interpretAvailability(String(p.text || "")));
    }
    if (p.action === "weekly") await saveWeekly(player.id, p.weeklyAvailability);
    else if (p.action === "save") await saveAvailability(player.id, p.ranges);
    else throw new Error("Nieznana akcja.");
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Nie udało się zapisać dostępności." }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ error: "Zaloguj się." }, { status: 401 });
    const { id } = await request.json();
    if (typeof id !== "string") throw new Error("Podaj identyfikator terminu.");
    await getDb().playerAvailability.deleteMany({ where: { id, playerId: player.id } });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Błąd usuwania." }, { status: 400 }); }
}
