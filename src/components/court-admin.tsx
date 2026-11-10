"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { type Court, type CourtPayload } from "@/lib/scheduled-matches";

const EMPTY_COURT: CourtPayload = {
  name: "", location: "", openingTime: "07:00", closingTime: "22:00", isActive: true, notes: "",
};

export function CourtAdmin({ initialCourts }: { initialCourts: Court[] }) {
  const [courts, setCourts] = useState(initialCourts);
  const [draft, setDraft] = useState<CourtPayload>(EMPTY_COURT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  function reset() {
    setDraft(EMPTY_COURT);
    setEditingId(null);
  }

  function editCourt(court: Court) {
    const { name, location, openingTime, closingTime, isActive, notes } = court;
    setDraft({ name, location, openingTime, closingTime, isActive, notes });
    setEditingId(court.id);
    setFeedback(null);
    document.getElementById("court-editor")?.scrollIntoView({ block: "nearest" });
  }

  async function saveCourt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(editingId ? `/api/courts/${editingId}` : "/api/courts", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Nie udało się zapisać kortu.");
      const court: Court = result.court;
      setCourts((current) => [...current.filter((entry) => entry.id !== court.id), court]);
      setFeedback({ text: editingId ? "Zapisano zmiany kortu." : "Dodano kort." });
      reset();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Nie udało się zapisać kortu.", error: true });
    } finally {
      setSaving(false);
    }
  }

  const update = <K extends keyof CourtPayload>(key: K, value: CourtPayload[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="scheduler-layout">
      <div><Link href="/umawianie-meczow" className="button-secondary">Wróć do umawiania meczów</Link></div>
      <section className="panel-card" id="court-editor">
        <div className="panel-card__header"><h2>{editingId ? "Edytuj kort" : "Dodaj kort"}</h2></div>
        <form className="scheduler-form" onSubmit={saveCourt}>
          <label>Nazwa kortu<input value={draft.name} onChange={(e) => update("name", e.target.value)} required /></label>
          <label>Lokalizacja<input value={draft.location} onChange={(e) => update("location", e.target.value)} /></label>
          <label>Otwarcie<input type="time" step={1800} value={draft.openingTime} onChange={(e) => update("openingTime", e.target.value)} required /></label>
          <label>Zamknięcie<input type="time" step={1800} value={draft.closingTime} onChange={(e) => update("closingTime", e.target.value)} required /></label>
          <label className="scheduler-form__notes">Notatki<textarea rows={2} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label>
          <label className="court-admin__active"><input type="checkbox" checked={draft.isActive} onChange={(e) => update("isActive", e.target.checked)} />Aktywny kort</label>
          <div className="form-actions">
            <button type="submit" disabled={saving}>{editingId ? "Zapisz zmiany" : "Dodaj kort"}</button>
            {editingId && <button type="button" className="button-secondary" disabled={saving} onClick={() => { reset(); setFeedback(null); }}>Anuluj</button>}
          </div>
          {feedback && <p role={feedback.error ? "alert" : "status"} className={`form-message form-message--${feedback.error ? "error" : "success"}`}>{feedback.text}</p>}
        </form>
      </section>
      <section className="panel-card">
        <div className="panel-card__header"><h2>Korty</h2></div>
        <div className="scheduler-table-wrap">
          <table className="scheduler-table">
            <thead><tr><th>Kort</th><th>Godziny</th><th>Lokalizacja</th><th>Status</th><th>Akcje</th></tr></thead>
            <tbody>
              {[...courts].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "pl")).map((court) => (
                <tr key={court.id}>
                  <td><strong>{court.name}</strong></td><td>{court.openingTime} – {court.closingTime}</td>
                  <td>{court.location || "—"}</td><td>{court.isActive ? "Aktywny" : "Nieaktywny"}</td>
                  <td><button type="button" className="button-secondary" disabled={saving} onClick={() => editCourt(court)}>Edytuj</button></td>
                </tr>
              ))}
              {!courts.length && <tr><td colSpan={5} className="empty-cell">Brak kortów.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
