import { NextResponse } from "next/server";
import { storeInboundSmsInDb } from "@/lib/scheduled-matches-db";

function xmlResponse(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const payload = Object.fromEntries(formData.entries());

      await storeInboundSmsInDb({
        provider: "twilio",
        externalId: String(formData.get("MessageSid") || formData.get("SmsSid") || ""),
        fromNumber: String(formData.get("From") || ""),
        toNumber: String(formData.get("To") || ""),
        body: String(formData.get("Body") || ""),
        rawPayload: payload,
      });

      return xmlResponse("<Response></Response>");
    }

    const payload = await request.json();
    await storeInboundSmsInDb({
      provider: typeof payload.provider === "string" ? payload.provider : "generic",
      externalId: typeof payload.externalId === "string" ? payload.externalId : "",
      fromNumber: typeof payload.fromNumber === "string" ? payload.fromNumber : "",
      toNumber: typeof payload.toNumber === "string" ? payload.toNumber : "",
      body: typeof payload.body === "string" ? payload.body : "",
      receivedAt: typeof payload.receivedAt === "string" ? payload.receivedAt : "",
      rawPayload: payload,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się zapisać SMS." },
      { status: 400 },
    );
  }
}
