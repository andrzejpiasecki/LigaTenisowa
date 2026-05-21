import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { deletePlayerBlockedPeriodInDb } from "@/lib/scheduled-matches-db";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; periodId: string }> }) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const params = await context.params;
    await deletePlayerBlockedPeriodInDb(params.id, params.periodId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się usunąć okresu niedostępności." },
      { status: 400 },
    );
  }
}
