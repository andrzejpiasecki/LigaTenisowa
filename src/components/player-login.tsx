"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function PlayerLogin({ invitation = false }: { invitation?: boolean }) {
  const [phone, setPhone] = useState(""), [password, setPassword] = useState(""), [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (invitation) {
      setInvite(window.location.hash.slice(1));
      // Keep the invitation token out of referrers, server request logs and subsequent URLs.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [invitation]);
  return <main className="auth-empty-state"><div className="auth-card">
    <h1>{invitation ? "Dołącz do ligi" : "Logowanie gracza"}</h1>
    <p>{invitation ? "Ustaw hasło do swojego konta. Następnie dodaj dostępność i potwierdzaj mecze na stronie." : "Zaloguj się numerem telefonu podanym organizatorowi i swoim hasłem."}</p>
    <form className="player-form" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        if (invitation && !invite) throw new Error("Otwórz pełny link z zaproszenia SMS.");
        const response = await fetch("/api/player/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password, ...(invitation ? { invite } : {}) }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const match = new URLSearchParams(window.location.search).get("mecz");
        window.location.assign(match ? `/gracz?mecz=${encodeURIComponent(match)}` : "/gracz");
      } catch (e) { setError(e instanceof Error ? e.message : "Nie udało się zalogować."); }
      finally { setBusy(false); }
    }}>
      {!invitation && <label>Numer telefonu<input type="tel" autoComplete="tel" placeholder="+48 600 123 456" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>}
      <label>{invitation ? "Nowe hasło (minimum 6 znaków)" : "Hasło"}<input type="password" autoComplete={invitation ? "new-password" : "current-password"} minLength={invitation ? 6 : undefined} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="form-message--error">{error}</p>}
      <button className="button-primary" disabled={busy}>{busy ? "Proszę czekać…" : invitation ? "Ustaw hasło i przejdź do dostępności" : "Zaloguj się"}</button>
    </form>
    <p>{invitation ? <Link href="/gracz/logowanie">Mam już konto</Link> : "Nie masz hasła lub je zapomniałeś? Skontaktuj się z organizatorem ligi."}</p>
    <Link href="/dashboard">Wyniki ligi</Link>
  </div></main>;
}
