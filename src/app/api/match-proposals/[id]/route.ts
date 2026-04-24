import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { acceptProposalInDb, rejectProposalInDb } from "@/lib/scheduled-matches-db";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const payload = await request.json() as { action?: string; feedback?: string };
    const { id } = await context.params;

    if (payload.action === "accept") {
      await acceptProposalInDb(id, access.userId);
      return NextResponse.json({ ok: true });
    }

    if (payload.action === "reject") {
      await rejectProposalInDb(id, payload.feedback || "");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Nieznana akcja." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zaktualizować propozycji." },
      { status: 400 },
    );
  }
}
