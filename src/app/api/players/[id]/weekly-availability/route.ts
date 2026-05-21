import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { replacePlayerWeeklyAvailabilityInDb } from "@/lib/scheduled-matches-db";
import { type PlayerWeeklyAvailabilityPayload } from "@/lib/scheduled-matches";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const id = (await context.params).id;
    const payload = await request.json() as PlayerWeeklyAvailabilityPayload;
    const detail = await replacePlayerWeeklyAvailabilityInDb(id, payload);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zapisać tygodniowej dostępności." },
      { status: 400 },
    );
  }
}
