import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { createScheduledMatchInDb, listInboundSmsFromDb, listScheduledMatchesFromDb } from "@/lib/scheduled-matches-db";
import { type ScheduledMatchPayload } from "@/lib/scheduled-matches";

export async function GET() {
  const { userId } = await auth();
  const isAdmin = await isCurrentUserAdmin();

  if (!userId || !isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  const [matches, inboundSms] = await Promise.all([
    listScheduledMatchesFromDb(),
    listInboundSmsFromDb(),
  ]);

  return NextResponse.json({ matches, inboundSms });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  const isAdmin = await isCurrentUserAdmin();

  if (!userId || !isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as ScheduledMatchPayload;
    const match = await createScheduledMatchInDb(payload, userId);
    return NextResponse.json({ match }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się dodać meczu." },
      { status: 400 },
    );
  }
}
