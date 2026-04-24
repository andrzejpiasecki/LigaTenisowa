import { AppShell } from "@/components/app-shell";
import { SchedulerAdmin } from "@/components/scheduler-admin";
import { requireAdminUser } from "@/lib/admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SchedulingPage() {
  const access = await requireAdminUser();

  if (!access.userId) {
    return (
      <main className="auth-empty-state">
        <div className="auth-card">
          <h1>Logowanie admina</h1>
          <p>Ta sekcja jest dostępna tylko po zalogowaniu.</p>
          <Link href="/sign-in?redirect_url=%2Fumawianie-meczow" className="primary-link">
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
          <p>
            To konto nie ma w Clerk ustawionej roli <code>admin</code> w <code>publicMetadata.role</code>,
            więc nie ma dostępu do modułu umawiania meczów.
          </p>
          <Link href="/dashboard" className="primary-link">
            Wróć do dashboardu
          </Link>
        </div>
      </main>
    );
  }

  return (
    <AppShell
      title="Umawianie meczów"
      subtitle="Administracyjny moduł do planowania i aktualizacji terminów."
      isAdmin
      requireAuth
    >
      <SchedulerAdmin />
    </AppShell>
  );
}
