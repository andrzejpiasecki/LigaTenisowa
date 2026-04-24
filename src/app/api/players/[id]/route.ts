import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { updatePlayerProfileInDb, updatePlayerResultsLinkInDb } from "@/lib/scheduled-matches-db";
import { type PlayerProfileUpdatePayload, type PlayerResultsLinkPayload } from "@/lib/scheduled-matches";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = await request.json() as PlayerResultsLinkPayload & Partial<PlayerProfileUpdatePayload>;
    const id = (await context.params).id;

    const player = (
      "fullName" in payload
        ? await updatePlayerProfileInDb(id, {
          fullName: payload.fullName || "",
          phone: payload.phone || "",
          league: payload.league || "",
          season: payload.season || "",
          status: payload.status === "nieaktywny" ? "nieaktywny" : "aktywny",
        })
        : await updatePlayerResultsLinkInDb(id, payload)
    );
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zaktualizować powiązania zawodnika." },
      { status: 400 },
    );
  }
}
