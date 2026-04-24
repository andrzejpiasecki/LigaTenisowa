import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { deleteScheduledMatchInDb, updateScheduledMatchInDb } from "@/lib/scheduled-matches-db";
import { type ScheduledMatchPayload } from "@/lib/scheduled-matches";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const isAdmin = await isCurrentUserAdmin();

  if (!userId || !isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as ScheduledMatchPayload;
    const match = await updateScheduledMatchInDb((await context.params).id, payload);
    return NextResponse.json({ match });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zaktualizować meczu." },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const isAdmin = await isCurrentUserAdmin();

  if (!userId || !isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    await deleteScheduledMatchInDb((await context.params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się usunąć meczu." },
      { status: 400 },
    );
  }
}
