import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PlayerDatabaseAdmin } from "@/components/player-database-admin";
import { requireAdminUser } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function PlayerDatabasePage() {
  const access = await requireAdminUser();

  if (!access.userId) {
    return (
      <main className="auth-empty-state">
        <div className="auth-card">
          <h1>Logowanie admina</h1>
          <p>Ta sekcja jest dostępna tylko po zalogowaniu.</p>
          <Link href="/sign-in?redirect_url=%2Fbaza-zawodnikow" className="primary-link">
            Zaloguj się
          </Link>
        </div>
      </main>
    );
  }

  if (!access.isAdmin) {
    return (
      <main className="auth-empty-state">
        <div className="auth-card">
          <h1>Brak uprawnień</h1>
          <p>To konto nie ma roli admin w Clerk.</p>
          <Link href="/dashboard" className="primary-link">
            Wróć do dashboardu
          </Link>
        </div>
      </main>
    );
  }

  return (
    <AppShell
      title="Baza zawodników"
      subtitle="Twoja lista graczy z telefonami i powiązaniem do nazw z wyników."
      isAdmin
      requireAuth
    >
      <PlayerDatabaseAdmin />
    </AppShell>
  );
}
