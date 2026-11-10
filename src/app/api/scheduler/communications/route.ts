import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { checkOrigin } from "@/lib/player-auth";
import { getDb } from "@/lib/db";
import { gatewayConfigured, prepareInvitations, prepareMatchMessages, sendQueuedSms } from "@/lib/outgoing-sms";
export async function GET() {
  const access = await requireAdminUser();
  if (!access.isAdmin) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  const messages = await getDb().outgoingSms.findMany({ take: 100, orderBy: { createdAt: "desc" }, include: { player: { select: { fullName: true } } } });
  return NextResponse.json({ messages, gatewayConfigured: gatewayConfigured() });
}
export async function POST(request: Request) {
  const access = await requireAdminUser();
  if (!access.isAdmin) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  try {
    checkOrigin(request);
    const p = await request.json();
    if (p.action === "invitations") return NextResponse.json({ count: await prepareInvitations() });
    if (p.action === "matches") return NextResponse.json({ count: await prepareMatchMessages() });
    if (p.action === "send" && typeof p.id === "string") { await sendQueuedSms(p.id); return NextResponse.json({ ok: true }); }
    throw new Error("Nieznana akcja.");
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Błąd SMS." }, { status: 400 }); }
}
