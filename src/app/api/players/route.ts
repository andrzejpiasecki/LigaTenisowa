import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { createPlayerInDb, listPlayersFromDb } from "@/lib/scheduled-matches-db";
import { type PlayerPayload } from "@/lib/scheduled-matches";

export async function GET() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  const players = await listPlayersFromDb();
  return NextResponse.json({ players });
}

export async function POST(request: Request) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as PlayerPayload;
    const player = await createPlayerInDb(payload);
    return NextResponse.json({ player }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się dodać zawodnika." },
      { status: 400 },
    );
  }
}
