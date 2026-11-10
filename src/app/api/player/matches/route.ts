import { NextResponse } from "next/server";
import { checkOrigin, currentPlayer } from "@/lib/player-auth";
import { replyToMatch } from "@/lib/player-scheduling";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ error: "Zaloguj się." }, { status: 401 });
    const { id, revision, accepted } = await request.json();
    if (typeof id !== "string" || typeof revision !== "string" || typeof accepted !== "boolean") throw new Error("Niepoprawna odpowiedź.");
    return NextResponse.json(await replyToMatch(player.id, id, revision, accepted));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Błąd potwierdzenia." }, { status: 400 }); }
}
