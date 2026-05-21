import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { createPlayerBlockedPeriodInDb } from "@/lib/scheduled-matches-db";
import { type PlayerBlockedPeriodPayload } from "@/lib/scheduled-matches";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const id = (await context.params).id;
    const payload = await request.json() as PlayerBlockedPeriodPayload;
    const blockedPeriod = await createPlayerBlockedPeriodInDb(id, payload);
    return NextResponse.json({ blockedPeriod }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się dodać okresu niedostępności." },
      { status: 400 },
    );
  }
}
