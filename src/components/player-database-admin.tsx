"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type Player,
  type PlayerResultsMatch,
  type ResultsDirectoryEntry,
} from "@/lib/scheduled-matches";

type SchedulerFilterOption = {
  value: string;
  label: string;
};

type PlayerDatabasePayload = {
  players: Player[];
  directory: ResultsDirectoryEntry[];
  matches: PlayerResultsMatch[];
};

type PlayerDraft = {
  fullName: string;
  phone: string;
  league: string;
  season: string;
  status: Player["status"];
  resultsPlayerId: string;
};

export function PlayerDatabaseAdmin() {
  const [payload, setPayload] = useState<PlayerDatabasePayload>({
    players: [],
    directory: [],
    matches: [],
  });
  const [draftsByPlayer, setDraftsByPlayer] = useState<Record<string, PlayerDraft>>({});
  const [seasonOptions, setSeasonOptions] = useState<SchedulerFilterOption[]>([]);
  const [leagueOptions, setLeagueOptions] = useState<SchedulerFilterOption[]>([]);
  const [syncSeasonId, setSyncSeasonId] = useState("");
  const [syncLeagueId, setSyncLeagueId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  function buildDrafts(nextPayload: PlayerDatabasePayload) {
    return Object.fromEntries(
      (nextPayload.matches || []).map((entry) => [
        entry.player.id,
        {
          fullName: entry.player.fullName,
          phone: entry.player.phone,
          league: entry.player.league,
          season: entry.player.season,
          status: entry.player.status,
          resultsPlayerId: entry.linkedEntry?.id || entry.player.resultsPlayerId || entry.suggestedEntry?.id || "",
        },
      ]),
    );
  }

  async function loadData() {
    const [databaseResponse, optionsResponse] = await Promise.all([
      fetch("/api/player-database", { cache: "no-store" }),
      fetch("/api/scheduler/options", { cache: "no-store" }),
    ]);
    const nextPayload = await databaseResponse.json();
    const optionsPayload = await optionsResponse.json();

    if (!databaseResponse.ok) {
      throw new Error(nextPayload.error || "Nie udało się pobrać bazy zawodników.");
    }

    if (!optionsResponse.ok) {
      throw new Error(optionsPayload.error || "Nie udało się pobrać listy sezonów i lig.");
    }

    setPayload(nextPayload);
    setDraftsByPlayer(buildDrafts(nextPayload));
    setSeasonOptions(optionsPayload.seasons || []);
    setLeagueOptions(optionsPayload.leagues || []);
    setSyncSeasonId((current) => current || optionsPayload.currentSeason?.value || optionsPayload.seasons?.[0]?.value || "");
    setSyncLeagueId((current) => current || optionsPayload.leagues?.[0]?.value || "");
  }

  useEffect(() => {
    startTransition(() => {
      loadData().catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać bazy zawodników.");
      });
    });
  }, []);

  const filteredMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return payload.matches;
    }

    return payload.matches.filter((entry) => {
      const currentTarget = entry.linkedEntry?.name || entry.suggestedEntry?.name || entry.player.resultsPlayerName || "";
      return [
        entry.player.fullName,
        entry.player.phone,
        entry.player.league,
        entry.player.season,
        entry.player.status,
        currentTarget,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [payload.matches, query]);

  function setDraftField(playerId: string, key: keyof PlayerDraft, value: string) {
    setDraftsByPlayer((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        [key]: value,
      },
    }));
  }

  function importFromResults() {
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch("/api/player-database", { method: "POST" })
        .then(async (response) => {
          const responsePayload = await response.json();
          if (!response.ok) {
            throw new Error(responsePayload.error || "Nie udało się wykonać importu.");
          }

          await loadData();
          setSuccess(`Import zakończony. Dodano ${responsePayload.imported}, zaktualizowano ${responsePayload.updated}.`);
        })
        .catch((importError: unknown) => {
          setError(importError instanceof Error ? importError.message : "Nie udało się wykonać importu.");
        });
    });
  }

  function syncLeagueAssignment() {
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch("/api/player-database", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          seasonId: syncSeasonId,
          leagueId: syncLeagueId,
        }),
      })
        .then(async (response) => {
          const responsePayload = await response.json();
          if (!response.ok) {
            throw new Error(responsePayload.error || "Nie udało się zsynchronizować ligi.");
          }

          await loadData();
          setSuccess(`Zaktualizowano przypisanie ligi dla ${responsePayload.updated} zawodników.`);
        })
        .catch((syncError: unknown) => {
          setError(syncError instanceof Error ? syncError.message : "Nie udało się zsynchronizować ligi.");
        });
    });
  }

  function savePlayer(entry: PlayerResultsMatch) {
    const draft = draftsByPlayer[entry.player.id];
    const selectedEntry = payload.directory.find((item) => item.id === draft.resultsPlayerId);

    setError("");
    setSuccess("");

    startTransition(() => {
      fetch(`/api/players/${entry.player.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: draft.fullName,
          phone: draft.phone,
          league: draft.league,
          season: draft.season,
          status: draft.status,
        }),
      })
        .then(async (response) => {
          const responsePayload = await response.json();
          if (!response.ok) {
            throw new Error(responsePayload.error || "Nie udało się zapisać danych zawodnika.");
          }

          return fetch(`/api/players/${entry.player.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resultsPlayerId: selectedEntry?.id || "",
              resultsPlayerName: selectedEntry?.name || "",
            }),
          });
        })
        .then(async (response) => {
          const responsePayload = await response.json();
          if (!response.ok) {
            throw new Error(responsePayload.error || "Nie udało się zapisać powiązania z wynikami.");
          }

          await loadData();
          setSuccess("Dane zawodnika zostały zapisane.");
        })
        .catch((saveError: unknown) => {
          setError(saveError instanceof Error ? saveError.message : "Nie udało się zapisać danych zawodnika.");
        });
    });
  }

  return (
    <div className="scheduler-layout">
      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Baza zawodników</h2>
            <p>Importujesz katalog z wyników, mapujesz zawodnika i synchronizujesz jego aktualną ligę z tenisv.</p>
          </div>
          <button type="button" onClick={importFromResults} disabled={isPending}>
            Importuj z wyników
          </button>
        </div>

        <div className="scheduler-kpis">
          <div className="scheduler-kpi">
            <strong>{payload.players.length}</strong>
            <span>Rekordy w bazie</span>
          </div>
          <div className="scheduler-kpi">
            <strong>{payload.directory.length}</strong>
            <span>Gracze w wynikach</span>
          </div>
          <div className="scheduler-kpi">
            <strong>{payload.matches.filter((entry) => entry.player.status === "aktywny").length}</strong>
            <span>Aktywni</span>
          </div>
          <div className="scheduler-kpi">
            <strong>{payload.matches.filter((entry) => entry.player.resultsPlayerId).length}</strong>
            <span>Powiązane z wynikami</span>
          </div>
        </div>

        <div className="scheduler-form">
          <label>
            Sezon do synchronizacji
            <select value={syncSeasonId} onChange={(event) => setSyncSeasonId(event.target.value)}>
              <option value="">Wybierz sezon</option>
              {seasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Liga do synchronizacji
            <select value={syncLeagueId} onChange={(event) => setSyncLeagueId(event.target.value)}>
              <option value="">Wybierz ligę</option>
              {leagueOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="button" onClick={syncLeagueAssignment} disabled={isPending || !syncSeasonId || !syncLeagueId}>
              Synchronizuj przypisanie ligi
            </button>
          </div>
        </div>

        <div className="player-database-toolbar">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj po nazwisku, telefonie, lidze, sezonie lub nazwie z wyników"
          />
        </div>

        {error ? <p className="form-message form-message--error">{error}</p> : null}
        {success ? <p className="form-message form-message--success">{success}</p> : null}
      </section>

      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Zawodnicy</h2>
            <p>Tu ustawiasz nazwę, telefon, aktualną ligę, sezon i aktywność zawodnika.</p>
          </div>
        </div>

        <div className="scheduler-table-wrap">
          <table className="scheduler-table">
            <thead>
              <tr>
                <th>Dane gracza</th>
                <th>Powiązanie z wynikami</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.length ? (
                filteredMatches.map((entry) => {
                  const draft = draftsByPlayer[entry.player.id] || {
                    fullName: entry.player.fullName,
                    phone: entry.player.phone,
                    league: entry.player.league,
                    season: entry.player.season,
                    status: entry.player.status,
                    resultsPlayerId: entry.player.resultsPlayerId || entry.suggestedEntry?.id || "",
                  };

                  return (
                    <tr key={entry.player.id}>
                      <td>
                        <div className="player-inline-grid">
                          <input
                            value={draft.fullName}
                            onChange={(event) => setDraftField(entry.player.id, "fullName", event.target.value)}
                            placeholder="Imię i nazwisko"
                          />
                          <input
                            value={draft.phone}
                            onChange={(event) => setDraftField(entry.player.id, "phone", event.target.value)}
                            placeholder="Telefon"
                          />
                          <input
                            value={draft.league}
                            onChange={(event) => setDraftField(entry.player.id, "league", event.target.value)}
                            placeholder="Aktualna liga"
                          />
                          <input
                            value={draft.season}
                            onChange={(event) => setDraftField(entry.player.id, "season", event.target.value)}
                            placeholder="Aktualny sezon"
                          />
                          <select
                            value={draft.status}
                            onChange={(event) => setDraftField(entry.player.id, "status", event.target.value)}
                          >
                            <option value="aktywny">aktywny</option>
                            <option value="nieaktywny">nieaktywny</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        {entry.suggestedEntry ? (
                          <div className="table-subtext">Sugestia: {entry.suggestedEntry.name}</div>
                        ) : null}
                        <select
                          value={draft.resultsPlayerId}
                          onChange={(event) => setDraftField(entry.player.id, "resultsPlayerId", event.target.value)}
                        >
                          <option value="">Brak powiązania</option>
                          {payload.directory.map((directoryEntry) => (
                            <option key={directoryEntry.id} value={directoryEntry.id}>
                              {directoryEntry.name}
                            </option>
                          ))}
                        </select>
                        {entry.player.resultsPlayerName ? (
                          <div className="table-subtext">Zapisane: {entry.player.resultsPlayerName}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button type="button" onClick={() => savePlayer(entry)} disabled={isPending}>
                            Zapisz
                          </button>
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => setDraftField(entry.player.id, "resultsPlayerId", entry.suggestedEntry?.id || "")}
                            disabled={isPending || !entry.suggestedEntry}
                          >
                            Użyj sugestii
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="empty-cell">Brak zawodników do wyświetlenia.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
