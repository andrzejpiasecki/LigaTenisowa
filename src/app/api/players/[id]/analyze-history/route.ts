import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { checkOrigin } from "@/lib/player-auth";
import { interpretSchedulingHistory, redactSchedulingHistory } from "@/lib/scheduling-ai";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();
  if (!access.isAdmin) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  try { checkOrigin(request); } catch { return NextResponse.json({ error: "Niedozwolone źródło żądania." }, { status: 403 }); }

  try {
    const payload = await request.json();
    if (typeof payload?.text !== "string" || payload.text.length > 8000) {
      return NextResponse.json({ error: "Wklej maksymalnie 8000 znaków." }, { status: 400 });
    }

    let text = payload.text.trim();
    if (!text) {
      const { id } = await context.params;
      const messages = await getDb().syncedSms.findMany({
        where: { playerId: id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 30,
        select: { direction: true, body: true, occurredAt: true },
      });
      text = messages.reverse().map((message) => {
        const author = message.direction === "incoming" ? "Zawodnik" : "Organizator";
        return `${message.occurredAt.toISOString()} ${author}: ${message.body.slice(0, 240)}`;
      }).join("\n").slice(-8000);
    }
    if (!text) return NextResponse.json({ error: "Brak zsynchronizowanych SMS-ów. Wklej fragment rozmowy o terminach." }, { status: 400 });
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "Brak konfiguracji Gemini w tym środowisku." }, { status: 503 });
    return NextResponse.json({ windows: await interpretSchedulingHistory(redactSchedulingHistory(text)) });
  } catch {
    return NextResponse.json({ error: "Nie udało się przeanalizować historii. Sprawdź konfigurację Gemini i spróbuj ponownie." }, { status: 502 });
  }
}
