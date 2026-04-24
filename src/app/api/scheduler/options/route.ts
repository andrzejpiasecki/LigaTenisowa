import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { fetchResultsFilters } from "@/lib/results-directory";

export async function GET() {
  const access = await requireAdminUser();

  if (!access.userId || !access.isAdmin) {
    return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });
  }

  try {
    const options = await fetchResultsFilters();
    return NextResponse.json(options);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się pobrać listy sezonów i lig." },
      { status: 400 },
    );
  }
}
