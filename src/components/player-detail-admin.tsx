"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  type PlayerBlockedPeriod,
  type PlayerDetail,
  type PlayerWeeklyAvailability,
} from "@/lib/scheduled-matches";

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Poniedziałek" },
  { value: 2, label: "Wtorek" },
  { value: 3, label: "Środa" },
  { value: 4, label: "Czwartek" },
  { value: 5, label: "Piątek" },
  { value: 6, label: "Sobota" },
  { value: 7, label: "Niedziela" },
];

type PlayerDetailAdminProps = {
  playerId: string;
};

type WeeklyDraft = {
  weekday: number;
  startTime: string;
  endTime: string;
  notes: string;
};

type BlockedDraft = {
  startsAt: string;
  endsAt: string;
  reason: string;
};

function emptyWeeklyDraft(): WeeklyDraft {
  return { weekday: 1, startTime: "17:00", endTime: "20:00", notes: "" };
}

function emptyBlockedDraft(): BlockedDraft {
  return { startsAt: "", endsAt: "", reason: "" };
}

function toLocalDateTimeInput(isoValue: string) {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoDateTime(localValue: string) {
  return localValue ? new Date(localValue).toISOString() : "";
}

export function PlayerDetailAdmin({ playerId }: PlayerDetailAdminProps) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [weeklyDrafts, setWeeklyDrafts] = useState<WeeklyDraft[]>([emptyWeeklyDraft()]);
  const [blockedDraft, setBlockedDraft] = useState<BlockedDraft>(emptyBlockedDraft());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  async function loadDetail() {
    const response = await fetch(`/api/players/${playerId}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nie udało się pobrać zawodnika.");
    }

    setDetail(payload);
    setWeeklyDrafts(
      payload.weeklyAvailability.length
        ? payload.weeklyAvailability.map((entry: PlayerWeeklyAvailability) => ({
          weekday: entry.weekday,
          startTime: entry.startTime,
          endTime: entry.endTime,
          notes: entry.notes,
        }))
        : [emptyWeeklyDraft()],
    );
  }

  useEffect(() => {
    startTransition(() => {
      loadDetail().catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać zawodnika.");
      });
    });
  }, [playerId]);

  function setWeeklyDraft(index: number, key: keyof WeeklyDraft, value: string | number) {
    setWeeklyDrafts((current) => current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, [key]: value } : entry
    )));
  }

  function addWeeklyDraft() {
    setWeeklyDrafts((current) => [...current, emptyWeeklyDraft()]);
  }

  function removeWeeklyDraft(index: number) {
    setWeeklyDrafts((current) => current.length === 1 ? current : current.filter((_, entryIndex) => entryIndex !== index));
  }

  function saveWeeklyAvailability() {
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch(`/api/players/${playerId}/weekly-availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyAvailability: weeklyDrafts,
        }),
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Nie udało się zapisać tygodniowej dostępności.");
          }

          setDetail(payload);
          setSuccess("Tygodniowa dostępność została zapisana.");
        })
        .catch((saveError: unknown) => {
          setError(saveError instanceof Error ? saveError.message : "Nie udało się zapisać tygodniowej dostępności.");
        });
    });
  }

  function addBlockedPeriod() {
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch(`/api/players/${playerId}/blocked-periods`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: toIsoDateTime(blockedDraft.startsAt),
          endsAt: toIsoDateTime(blockedDraft.endsAt),
          reason: blockedDraft.reason,
        }),
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Nie udało się dodać okresu niedostępności.");
          }

          await loadDetail();
          setBlockedDraft(emptyBlockedDraft());
          setSuccess("Okres niedostępności został dodany.");
        })
        .catch((saveError: unknown) => {
          setError(saveError instanceof Error ? saveError.message : "Nie udało się dodać okresu niedostępności.");
        });
    });
  }

  function deleteBlockedPeriod(period: PlayerBlockedPeriod) {
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch(`/api/players/${playerId}/blocked-periods/${period.id}`, { method: "DELETE" })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Nie udało się usunąć okresu niedostępności.");
          }

          await loadDetail();
          setSuccess("Okres niedostępności został usunięty.");
        })
        .catch((deleteError: unknown) => {
          setError(deleteError instanceof Error ? deleteError.message : "Nie udało się usunąć okresu niedostępności.");
        });
    });
  }

  if (!detail) {
    return <p className="scheduler-hint">Ładowanie zawodnika...</p>;
  }

  return (
    <div className="scheduler-layout">
      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>{detail.player.fullName}</h2>
            <p>{detail.player.phone || "Brak telefonu"} • status: {detail.player.status}</p>
          </div>
          <Link href="/baza-zawodnikow" className="button-secondary">
            Wróć do bazy
          </Link>
        </div>

        {error ? <p className="form-message form-message--error">{error}</p> : null}
        {success ? <p className="form-message form-message--success">{success}</p> : null}
      </section>

      <div className="scheduler-main-grid">
        <section className="panel-card">
          <div className="panel-card__header">
            <div>
              <h2>Stała dostępność</h2>
              <p>Dni tygodnia i godziny, w których zawodnik zwykle może grać.</p>
            </div>
          </div>

          <div className="scheduler-layout">
            {weeklyDrafts.map((entry, index) => (
              <div key={`${index}:${entry.weekday}:${entry.startTime}`} className="player-availability-row">
                <select value={entry.weekday} onChange={(event) => setWeeklyDraft(index, "weekday", Number(event.target.value))}>
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input type="time" value={entry.startTime} onChange={(event) => setWeeklyDraft(index, "startTime", event.target.value)} />
                <input type="time" value={entry.endTime} onChange={(event) => setWeeklyDraft(index, "endTime", event.target.value)} />
                <input value={entry.notes} onChange={(event) => setWeeklyDraft(index, "notes", event.target.value)} placeholder="Notatka" />
                <button type="button" className="button-secondary" onClick={() => removeWeeklyDraft(index)} disabled={weeklyDrafts.length === 1}>
                  Usuń
                </button>
              </div>
            ))}

            <div className="form-actions">
              <button type="button" className="button-secondary" onClick={addWeeklyDraft}>Dodaj okno</button>
              <button type="button" onClick={saveWeeklyAvailability} disabled={isPending}>Zapisz dostępność</button>
            </div>
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-card__header">
            <div>
              <h2>Okresy niedostępności</h2>
              <p>Przerwy, urlopy, kontuzje i inne pełne wyłączenia z gry.</p>
            </div>
          </div>

          <div className="scheduler-form">
            <label>
              Od
              <input type="datetime-local" value={blockedDraft.startsAt} onChange={(event) => setBlockedDraft((current) => ({ ...current, startsAt: event.target.value }))} />
            </label>
            <label>
              Do
              <input type="datetime-local" value={blockedDraft.endsAt} onChange={(event) => setBlockedDraft((current) => ({ ...current, endsAt: event.target.value }))} />
            </label>
            <label className="scheduler-form__notes">
              Powód
              <input value={blockedDraft.reason} onChange={(event) => setBlockedDraft((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <div className="form-actions">
              <button type="button" onClick={addBlockedPeriod} disabled={isPending}>Dodaj okres</button>
            </div>
          </div>

          <div className="scheduler-table-wrap">
            <table className="scheduler-table">
              <thead>
                <tr>
                  <th>Od</th>
                  <th>Do</th>
                  <th>Powód</th>
                  <th>Akcja</th>
                </tr>
              </thead>
              <tbody>
                {detail.blockedPeriods.length ? (
                  detail.blockedPeriods.map((period) => (
                    <tr key={period.id}>
                      <td>{new Date(period.startsAt).toLocaleString("pl-PL")}</td>
                      <td>{new Date(period.endsAt).toLocaleString("pl-PL")}</td>
                      <td>{period.reason || "Bez powodu"}</td>
                      <td>
                        <button type="button" className="button-danger" onClick={() => deleteBlockedPeriod(period)}>
                          Usuń
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty-cell">Brak zapisanych okresów niedostępności.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
