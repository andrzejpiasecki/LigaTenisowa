import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { createCourtInDb, listCourtsFromDb } from "@/lib/scheduled-matches-db";
import { type CourtPayload } from "@/lib/scheduled-matches";

export async function GET() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  const courts = await listCourtsFromDb();
  return NextResponse.json({ courts });
}

export async function POST(request: Request) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as CourtPayload;
    const court = await createCourtInDb(payload);
    return NextResponse.json({ court }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się dodać kortu." },
      { status: 400 },
    );
  }
}
