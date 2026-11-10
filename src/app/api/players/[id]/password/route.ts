import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { checkOrigin } from "@/lib/player-auth";
import { setPlayerPassword } from "@/lib/player-accounts";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();
  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    checkOrigin(request);
    const payload = await request.json();
    if (typeof payload.password !== "string") throw new Error("Podaj nowe hasło.");
    await setPlayerPassword((await context.params).id, payload.password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się ustawić hasła." },
      { status: 400 },
    );
  }
}
