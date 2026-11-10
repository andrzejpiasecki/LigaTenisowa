import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CourtAdmin } from "@/components/court-admin";
import { requireAdminUser } from "@/lib/admin";
import { listCourtsFromDb } from "@/lib/scheduled-matches-db";

export const dynamic = "force-dynamic";

export default async function CourtsPage() {
  const { userId, isAdmin } = await requireAdminUser();
  if (!userId) redirect("/sign-in?redirect_url=%2Fumawianie-meczow%2Fkorty");
  if (!isAdmin) {
    return <main className="auth-empty-state"><div className="auth-card">
      <h1>Brak uprawnień</h1>
      <Link href="/dashboard" className="primary-link">Wróć do dashboardu</Link>
    </div></main>;
  }

  const courts = await listCourtsFromDb();
  return (
    <AppShell title="Zarządzanie kortami" isAdmin requireAuth>
      <CourtAdmin initialCourts={courts} />
    </AppShell>
  );
}
