"use client";

import { useState } from "react";
import { MatchSmsDialog, MatchSmsRecipientStatus } from "@/components/match-sms-dialog";
import type { MatchSmsRecipient } from "@/lib/match-sms-types";
import { type LeagueRecordedMatch, type ScheduledMatch, type ScheduledMatchStatus } from "@/lib/scheduled-matches";

type MatchRow =
  | { kind: "booking"; match: ScheduledMatch }
  | { kind: "result"; match: LeagueRecordedMatch & { league: string } };

const PAGE_SIZE = 15;
const STATUS_LABELS: Record<ScheduledMatchStatus, string> = {
  propozycja: "Propozycja",
  oczekuje: "Oczekuje",
  potwierdzony: "Potwierdzony",
  anulowany: "Anulowany",
  rozegrany: "Rozegrany",
};

const dateTime = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short",
});

function displayName(name: string) {
  return name === name.toLocaleUpperCase("pl")
    ? name.toLocaleLowerCase("pl").replace(/(^|[\s-])\p{L}/gu, (initial) => initial.toLocaleUpperCase("pl"))
    : name;
}

export function LeagueMatchesTable({ rows, locatedMatchIds, loading, resultsError, busy, smsStatuses, onRefresh, onEdit, onDelete }: {
  rows: MatchRow[];
  locatedMatchIds: string[];
  loading: boolean;
  resultsError: string;
  busy: boolean;
  smsStatuses: Record<string, MatchSmsRecipient[]>;
  onRefresh: () => Promise<void>;
  onEdit: (match: ScheduledMatch) => void;
  onDelete: (id: string) => void;
}) {
  const [pagination, setPagination] = useState({ page: 0, locatedMatchIds: [] as string[] });
  const [smsMatchId, setSmsMatchId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  async function refreshStatuses() {
    setRefreshing(true);
    setRefreshError("");
    try { await onRefresh(); }
    catch { setRefreshError("Nie udało się odświeżyć statusów."); }
    finally { setRefreshing(false); }
  }
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const firstLocatedRow = pagination.locatedMatchIds === locatedMatchIds ? -1
    : rows.findIndex((row) => row.kind === "booking" && locatedMatchIds.includes(row.match.id));
  const currentPage = firstLocatedRow >= 0 ? Math.floor(firstLocatedRow / PAGE_SIZE) : Math.min(pagination.page, lastPage);
  const setPage = (page: number) => setPagination({ page, locatedMatchIds });
  const start = currentPage * PAGE_SIZE;

  return (
    <section className="panel-card league-matches" id="wszystkie-mecze">
      <div className="panel-card__header">
        <div><h2>Wszystkie mecze</h2><p>Umówione i jeszcze nierozegrane są na początku.</p></div>
        {rows.some((row) => row.kind === "booking") && <button type="button" className="scheduler-text-action" disabled={refreshing} onClick={refreshStatuses}>
          {refreshing ? "Odświeżanie…" : "Odśwież statusy SMS"}
        </button>}
      </div>
      {resultsError && <p role="alert">{resultsError}</p>}
      {refreshError && <p role="alert">{refreshError}</p>}
      <div className="scheduler-table-wrap">
        <table className="scheduler-table">
          <thead><tr><th scope="col">Termin</th><th scope="col">Mecz</th><th scope="col">Liga</th><th scope="col">Status</th><th scope="col">Wynik</th><th scope="col">Akcje</th></tr></thead>
          <tbody>
            {rows.slice(start, start + PAGE_SIZE).map((row, index) => {
              if (row.kind === "result") {
                const { match } = row;
                return (
                  <tr key={`result-${start + index}`}>
                    <td>{/^\d{4}-\d{2}-\d{2}$/.test(match.date) ? match.date.split("-").reverse().join(".") : match.date || "—"}</td>
                    <td><strong>{displayName(match.winner)} – {displayName(match.loser)}</strong></td>
                    <td>{match.league}</td>
                    <td><span className="status-pill status-pill--rozegrany">Rozegrany</span></td>
                    <td>{match.score || "—"}{match.sets.length > 0 && <div className="table-subtext">{match.sets.join(", ")}</div>}</td>
                    <td>—</td>
                  </tr>
                );
              }
              const { match } = row;
              const recipients = smsStatuses[match.id] ?? [];
              const canPropose = ["propozycja", "oczekuje"].includes(match.status) && Date.parse(match.scheduledAt) > Date.now();
              return (
                <tr key={match.id}>
                  <td>{dateTime.format(new Date(match.scheduledAt))}</td>
                  <td>
                    <strong>{displayName(match.playerOne)} – {displayName(match.playerTwo)}</strong>
                    {(match.courtName || match.location) && <div className="table-subtext">{match.courtName || match.location}</div>}
                  </td>
                  <td>{match.league}</td>
                  <td>
                    <span className={`status-pill status-pill--${match.status}`}>{STATUS_LABELS[match.status]}</span>
                    {recipients.filter((r) => r.status !== "not_sent" || r.reply).map((r) => <MatchSmsRecipientStatus key={r.playerId} recipient={r} />)}
                  </td>
                  <td>—</td>
                  <td><div className="league-match-actions">
                    {canPropose && <button type="button" className="scheduler-text-action" disabled={busy} onClick={() => setSmsMatchId(match.id)}>
                      {recipients.some((r) => ["sending", "submitted", "unknown", "failed"].includes(r.status)) ? "Status / wyślij SMS" : "Wyślij propozycję SMS"}
                    </button>}
                    <button type="button" className="scheduler-text-action" disabled={busy} onClick={() => onEdit(match)}>Edytuj</button>
                    <button type="button" className="scheduler-text-action scheduler-text-action--danger" disabled={busy} onClick={() => onDelete(match.id)}>Usuń</button>
                  </div></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="empty-cell">{loading ? "Ładowanie meczów…" : "Brak meczów w wybranym sezonie."}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <nav className="league-matches-pagination" aria-label="Stronicowanie meczów">
          <span role="status">{start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} z {rows.length}</span>
          {lastPage > 0 && <div className="table-actions">
            <button type="button" className="button-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Poprzednia</button>
            <span>Strona {currentPage + 1} z {lastPage + 1}</span>
            <button type="button" className="button-secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Następna</button>
          </div>}
        </nav>
      )}
      {smsMatchId && <MatchSmsDialog matchId={smsMatchId} onClose={() => setSmsMatchId(null)} onRefresh={onRefresh} />}
    </section>
  );
}
