"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth } from "@clerk/nextjs";

type AppShellProps = {
  title: string;
  subtitle?: string;
  isAdmin?: boolean;
  requireAuth?: boolean;
  children: React.ReactNode;
};

export function AppShell({ title, subtitle, isAdmin = false, requireAuth = false, children }: AppShellProps) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();

  if (requireAuth && !isLoaded) {
    return <main className="shell-loading">Ładowanie...</main>;
  }

  if (requireAuth && !isSignedIn) {
    return (
      <main className="auth-empty-state">
        <div className="auth-card">
          <h1>Zaloguj się</h1>
          <p>Aby korzystać z panelu ligi tenisowej.</p>
          <Link href="/sign-in" className="primary-link">
            Zaloguj
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-header-copy">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="app-header-actions">
            <details className="header-menu">
              <summary>Menu</summary>
              <div className="header-menu-panel">
                <Link href="/dashboard" className={pathname === "/dashboard" ? "is-active" : ""}>
                  Dashboard
                </Link>
                {isAdmin ? (
                  <>
                    <Link href="/umawianie-meczow" className={pathname === "/umawianie-meczow" ? "is-active" : ""}>
                      Umawianie meczów
                    </Link>
                    <Link href="/baza-zawodnikow" className={pathname === "/baza-zawodnikow" ? "is-active" : ""}>
                      Baza zawodników
                    </Link>
                  </>
                ) : (
                  <Link href="/sign-in" className={pathname.startsWith("/sign-in") ? "is-active" : ""}>
                    Admin
                  </Link>
                )}
              </div>
            </details>
            {isSignedIn ? (
              <div className="user-button-slot">
                <UserButton userProfileMode="navigation" userProfileUrl="/user-profile" />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="app-content">{children}</section>
    </main>
  );
}
