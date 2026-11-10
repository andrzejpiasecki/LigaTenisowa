import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { checkOrigin } from "@/lib/player-auth";
import { updateCourtInDb } from "@/lib/scheduled-matches-db";
import { type CourtPayload } from "@/lib/scheduled-matches";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { isAdmin } = await requireAdminUser();
  if (!isAdmin) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  try {
    checkOrigin(request);
    const payload = await request.json() as CourtPayload;
    const court = await updateCourtInDb((await context.params).id, payload);
    if (!court) return NextResponse.json({ error: "Nie znaleziono kortu." }, { status: 404 });
    return NextResponse.json({ court });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zapisać kortu." }, { status: 400 },
    );
  }
}
