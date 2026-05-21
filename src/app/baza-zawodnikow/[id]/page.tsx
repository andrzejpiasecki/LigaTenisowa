import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PlayerDetailAdmin } from "@/components/player-detail-admin";
import { requireAdminUser } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminUser();
  const { id } = await params;

  if (!access.userId) {
    return (
      <main className="auth-empty-state">
        <div className="auth-card">
          <h1>Logowanie admina</h1>
          <p>Ta sekcja jest dostępna tylko po zalogowaniu.</p>
          <Link href={`/sign-in?redirect_url=%2Fbaza-zawodnikow%2F${id}`} className="primary-link">
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
      title="Szczegóły zawodnika"
      subtitle="Dostępność tygodniowa i okresy niedostępności wybranego zawodnika."
      isAdmin
      requireAuth
    >
      <PlayerDetailAdmin playerId={id} />
    </AppShell>
  );
}
