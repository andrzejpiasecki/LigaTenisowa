"use client";

import { useState } from "react";

export function PlayerPasswordAdmin({ playerId, phone }: { playerId: string; phone: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2>Hasło do konta gracza</h2>
          <p>Ustaw pierwsze hasło lub zmień obecne. Gracz loguje się swoim numerem telefonu. Zmiana wyloguje go na wszystkich urządzeniach.</p>
        </div>
      </div>
      {!phone && <p>Najpierw dodaj numer telefonu zawodnika w bazie.</p>}
      <form className="scheduler-form" onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSuccess("");
        if (password !== confirmation) {
          setError("Podane hasła różnią się.");
          return;
        }
        setIsSaving(true);
        try {
          const response = await fetch(`/api/players/${playerId}/password`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Nie udało się ustawić hasła.");
          setPassword("");
          setConfirmation("");
          setSuccess("Hasło ustawione. Przekaż je graczowi — może teraz zalogować się numerem telefonu. Poprzednie sesje i zaproszenie zostały unieważnione.");
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "Nie udało się ustawić hasła.");
        } finally {
          setIsSaving(false);
        }
      }}>
        <label>
          Nowe hasło (6–128 znaków)
          <input type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={password} disabled={!phone || isSaving} onChange={(event) => { setPassword(event.target.value); setSuccess(""); }} />
        </label>
        <label>
          Powtórz nowe hasło
          <input type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={confirmation} disabled={!phone || isSaving} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={!phone || isSaving}>{isSaving ? "Zapisywanie…" : "Ustaw hasło"}</button>
        </div>
      </form>
      <div aria-live="polite">
        {error && <p role="alert" className="form-message form-message--error">{error}</p>}
        {success && <p className="form-message form-message--success">{success}</p>}
      </div>
    </section>
  );
}
