import { NextResponse } from "next/server";
import { checkOrigin } from "@/lib/player-auth";
import { getMatchSmsQuestion, MatchSmsError, submitMatchSmsAnswer } from "@/lib/match-sms";

const respond = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try { checkOrigin(request); } catch { return respond({ error: "Niedozwolone źródło żądania." }, 403); }
  const data = await request.json().catch(() => null);
  try {
    if (data?.action === "read") return respond(await getMatchSmsQuestion(data.token));
    if (data?.action === "reply") return respond(await submitMatchSmsAnswer(data.token, data.choice, data.text));
    return respond({ error: "Nieprawidłowe żądanie." }, 400);
  } catch (error) {
    if (error instanceof MatchSmsError) return respond({ error: error.message }, 400);
    return respond({ error: "Nie udało się obsłużyć odpowiedzi. Spróbuj ponownie." }, 500);
  }
}
