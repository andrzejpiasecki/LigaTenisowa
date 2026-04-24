import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getSchedulerOverviewFromDb, regenerateProposalsInDb } from "@/lib/scheduled-matches-db";

export async function GET() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  const overview = await getSchedulerOverviewFromDb();
  return NextResponse.json(overview);
}

export async function POST() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const proposals = await regenerateProposalsInDb();
    return NextResponse.json({ proposals });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się odświeżyć propozycji." },
      { status: 400 },
    );
  }
}
