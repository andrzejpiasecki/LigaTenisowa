import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { checkOrigin } from "@/lib/player-auth";
import { getMatchSmsPreview, MatchSmsError, sendMatchSms } from "@/lib/match-sms";

const respond = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  if (!(await requireAdminUser()).isAdmin) return respond({ error: "Brak dostępu." }, 403);
  try {
    return respond(await getMatchSmsPreview((await params).id));
  } catch (error) {
    if (error instanceof MatchSmsError) return respond({ error: error.message }, 404);
    return respond({ error: "Nie udało się pobrać podglądu SMS." }, 500);
  }
}

export async function POST(request: Request, { params }: Context) {
  if (!(await requireAdminUser()).isAdmin) return respond({ error: "Brak dostępu." }, 403);
  try { checkOrigin(request); } catch { return respond({ error: "Niedozwolone źródło żądania." }, 403); }
  const data = await request.json().catch(() => null);
  if (typeof data?.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)) {
    return respond({ error: "Najpierw otwórz podgląd SMS." }, 400);
  }
  try {
    return respond(await sendMatchSms((await params).id, data.fingerprint));
  } catch (error) {
    if (error instanceof MatchSmsError) return respond({ error: error.message }, 409);
    return respond({ error: "Nie udało się potwierdzić wysyłki. Odśwież statusy przed ponowieniem." }, 500);
  }
}
