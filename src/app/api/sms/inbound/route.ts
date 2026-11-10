import { NextResponse } from "next/server";
// Players respond on the website; this endpoint deliberately stores no incoming SMS.
export async function POST() {
  return NextResponse.json({ error: "Odbieranie SMS jest wyłączone. Dostępność i potwierdzenia dodaj na stronie ligi." }, { status: 410 });
}
