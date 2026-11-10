"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MatchSmsRecipientStatus } from "@/components/match-sms-dialog";
import type { DayPlanBooking, DayPlanDraft } from "@/lib/day-plan-types";
import type { MatchSmsPreview, MatchSmsRecipient } from "@/lib/match-sms-types";
import type { ScheduledMatch } from "@/lib/scheduled-matches";
import { warsawParts } from "@/lib/scheduling-slots";

type PlanPreview = { drafts: DayPlanDraft[]; playerCount: number; rosterCount: number };
type BatchPreview = { booking: DayPlanBooking; sms: MatchSmsPreview | null; error?: string };
const time = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });

type BookingSnapshot = { matches: ScheduledMatch[]; smsStatuses: Record<string, MatchSmsRecipient[]> };

function planBookings(snapshot: BookingSnapshot, day: string, season: string): DayPlanBooking[] {
  return snapshot.matches.filter((match) => match.dayPlan && match.season === season
    && match.status !== "anulowany" && warsawParts(new Date(match.scheduledAt)).day === day)
    .map((match) => {
      const recipients = snapshot.smsStatuses[match.id] ?? [];
      const declined = recipients.some((r) => r.reply === "no" || r.reply === "alternative");
      return {
        id: match.id, league: match.league, court: match.courtName || match.location, startsAt: match.scheduledAt,
        playerOne: match.playerOne, playerTwo: match.playerTwo, status: match.status, recipients, declined,
        canSend: !declined && ["propozycja", "oczekuje"].includes(match.status) && Date.parse(match.scheduledAt) > Date.now()
          && recipients.some((r) => !r.reply && ["not_sent", "queued", "failed", "cancelled"].includes(r.status)),
      };
    }).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.court.localeCompare(b.court, "pl"));
}

async function jsonRequest<T>(url: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store", signal,
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Nie udało się wykonać operacji.");
  return data;
}

async function groups<T, R>(items: T[], run: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += 3) results.push(...await Promise.all(items.slice(i, i + 3).map(run)));
  return results;
}

function label(row: { startsAt: string; court: string }) {
  return `${time.format(new Date(row.startsAt))} · ${row.court}`;
}

export function DayPlanPanel({ seasonId, season, day, snapshot, onDateChange, onRefresh, onLocateMatches, onDelete }: {
  seasonId: string; season: string; day: string; snapshot: BookingSnapshot;
  onDateChange: (day: string) => void; onRefresh: (signal?: AbortSignal) => Promise<BookingSnapshot>;
  onLocateMatches: (ids: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [draft, setPreview] = useState<{ day: string; data: PlanPreview } | null>(null);
  const preview = draft?.day === day ? draft.data : null;
  const bookings = planBookings(snapshot, day, season);
  const declinedBookings = bookings.filter((booking) => booking.declined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<BatchPreview[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [autoPlanning, setAutoPlanning] = useState(false);
  const lastDeclines = useRef("");
  const dismissed = useRef(new Set<string>());
  const activeWork = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const ready = Boolean(seasonId && season && day);

  const generate = useCallback(async (signal?: AbortSignal) => {
    const next = await jsonRequest<PlanPreview>("/api/scheduler/day-plan", { action: "preview", day, seasonId }, signal);
    if (signal?.aborted) return;
    const drafts = next.drafts.filter((draft) => !dismissed.current.has(draft.key));
    setPreview({ day, data: { ...next, drafts } });
    setSelected(new Set(drafts.filter((draft) => !draft.replacementFor).map((draft) => draft.key)));
  }, [day, seasonId]);

  useEffect(() => {
    if (!opened || !ready) return;
    const controller = new AbortController();
    let checking = false;
    const tick = async () => {
      if (checking || activeWork.current) return;
      checking = true;
      try {
        const current = planBookings(await onRefresh(controller.signal), day, season);
        if (controller.signal.aborted || activeWork.current) return;
        const declined = current.filter((m) => m.declined && Date.parse(m.startsAt) > Date.now());
        const key = declined.map((m) => `${m.id}:${m.recipients.filter((r) => r.reply === "no" || r.reply === "alternative").map((r) => r.playerId).join(",")}`).join("|");
        if (key && key !== lastDeclines.current) {
          setAutoPlanning(true);
          await generate(controller.signal);
          if (!controller.signal.aborted) lastDeclines.current = key;
        } else if (!key) {
          lastDeclines.current = "";
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Nie udało się odświeżyć odpowiedzi.");
      } finally {
        checking = false;
        if (!controller.signal.aborted) setAutoPlanning(false);
      }
    };
    void tick();
    const timer = window.setInterval(tick, 20_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [opened, ready, onRefresh, generate, day, season]);

  useEffect(() => {
    if (batch && !dialog.current?.open) dialog.current?.showModal();
  }, [batch]);

  async function run(label: string, action: () => Promise<void>) {
    if (activeWork.current) return;
    activeWork.current = true;
    setBusy(label); setNotice(""); setError("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Nie udało się wykonać operacji."); }
    finally { activeWork.current = false; setBusy(""); }
  }

  function save(keys: string[]) {
    return run("Zapisywanie…", async () => {
      const result = await jsonRequest<{ saved: number; matchIds: string[] }>("/api/scheduler/day-plan", { action: "save", day, seasonId, keys });
      const savedKeys = new Set(keys);
      setPreview((current) => current && ({
        ...current,
        data: { ...current.data, drafts: current.data.drafts.filter((proposal) => !savedKeys.has(proposal.key)) },
      }));
      setSelected((current) => new Set([...current].filter((key) => !savedKeys.has(key))));
      lastDeclines.current = "";
      onLocateMatches(result.matchIds);
      await onRefresh();
      setNotice(`Zapisano mecze: ${result.saved}.`);
    });
  }

  function openSmsBatch() {
    return run("Przygotowywanie podglądu SMS…", async () => {
      const result = await groups(bookings.filter((m) => m.canSend), async (booking): Promise<BatchPreview> => {
        try {
          const sms = await jsonRequest<MatchSmsPreview>(`/api/scheduler/booking/${encodeURIComponent(booking.id)}/sms`);
          return { booking, sms };
        } catch (e) {
          return { booking, sms: null, error: e instanceof Error ? e.message : "Nie udało się pobrać podglądu." };
        }
      });
      setBatch(result);
    });
  }

  function sendBatch() {
    const toSend = (batch ?? []).filter((entry) => entry.sms?.configured && entry.sms.recipients.some((r) => r.canSend));
    return run("Przekazywanie planu do bramki…", async () => {
      const result = await groups(toSend, async (entry): Promise<BatchPreview> => {
        try {
          const sms = await jsonRequest<MatchSmsPreview>(`/api/scheduler/booking/${encodeURIComponent(entry.booking.id)}/sms`, {
            fingerprint: entry.sms!.fingerprint,
          });
          return { booking: entry.booking, sms };
        } catch (e) {
          return { booking: entry.booking, sms: null, error: e instanceof Error ? e.message : "Nieznany wynik wysyłki." };
        }
      });
      setBatch((current) => current?.map((entry) => result.find((item) => item.booking.id === entry.booking.id) ?? entry) ?? result);
      const accepted = result.reduce((count, item) => count + (item.sms?.recipients.filter((p) => p.status === "submitted").length ?? 0), 0);
      setNotice(`Przetworzono meczów: ${result.length}. SMS-y przyjęte przez bramkę w tych meczach: ${accepted}. Sprawdź statusy odbiorców.`);
      await onRefresh();
    });
  }

  const additions = preview?.drafts.filter((draft) => !draft.replacementFor) ?? [];
  const replacementById = new Map(preview?.drafts.filter((draft) => draft.replacementFor).map((draft) => [draft.replacementFor, draft]));
  const smsCount = batch?.reduce((n, entry) => n + (entry.sms?.configured ? entry.sms.recipients.filter((r) => r.canSend).length : 0), 0) ?? 0;

  return (
    <section className="panel-card day-plan" data-open={opened}>
      <div className="panel-card__header">
        <div><h2>Zaplanuj dzień</h2><p>{season ? `Wszystkie ligi · ${season}` : "Wybierz sezon."}</p></div>
        <button type="button" className="scheduler-text-action day-plan-toggle" aria-expanded={opened} onClick={() => setOpened(!opened)}>
          {opened ? "Zwiń plan" : "Otwórz plan dnia"}
          <span aria-hidden="true" />
        </button>
      </div>
      {opened && <>
        <div className="day-plan-actions">
          <label className="scheduler-inline-filter">Data planu
            <input type="date" value={day} disabled={Boolean(busy)} onChange={(e) => {
              if (!e.target.value) return;
              onDateChange(e.target.value); setPreview(null); setSelected(new Set()); lastDeclines.current = "";
              setError(""); setNotice(""); setAutoPlanning(false);
            }} />
          </label>
          <button type="button" className="button-primary" disabled={!ready || Boolean(busy) || autoPlanning} onClick={() => run("Układanie propozycji…", () => {
            dismissed.current.clear();
            return generate();
          })}>Zaproponuj pary</button>
          <button type="button" className="button-secondary" disabled={!bookings.some((m) => m.canSend) || Boolean(busy)} onClick={openSmsBatch}>Wyślij plan SMS</button>
        </div>
        {!ready && <p>Wybierz sezon u góry.</p>}
        {busy && <p role="status">{busy}</p>}
        {autoPlanning && <p role="status">Jest odmowa. Szukam nowej pary na ten sam kort i godzinę…</p>}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        {notice && <p className="form-message form-message--success" role="status">{notice}</p>}

        {!!bookings.length && (
          <a href="#wszystkie-mecze" className="button-secondary" onClick={() => onLocateMatches(bookings.map((booking) => booking.id))}>
            Pokaż zapisane propozycje w tabeli meczów
          </a>
        )}
        {!!declinedBookings.length && <div className="day-plan-list">
          <h3>Mecze do zastąpienia</h3>
          <div className="scheduler-table-wrap">
            <table className="scheduler-table day-plan-table" aria-label="Mecze do zastąpienia">
              <thead><tr><th>Termin i kort</th><th>Mecz</th><th>Liga</th><th>Status</th><th>Akcje</th></tr></thead>
              <tbody>{declinedBookings.map((booking) => {
                const replacement = replacementById.get(booking.id);
                return <tr key={booking.id}>
                  <td>{label(booking)}</td>
                  <td>
                    <strong>{booking.playerOne} – {booking.playerTwo}</strong>
                    <div className="day-plan-recipients">
                      {booking.recipients.map((recipient, index) => <MatchSmsRecipientStatus key={recipient.playerId || index} recipient={recipient} />)}
                    </div>
                    {replacement ? (
                      <div className="day-plan-replacement">
                        <p><strong>Zastępstwo na ten sam slot:</strong> {replacement.playerOne} – {replacement.playerTwo}</p>
                        <p>{replacement.rationale}</p>
                        <button type="button" className="button-secondary" disabled={Boolean(busy) || autoPlanning} onClick={() => save([replacement.key])}>Zapisz zastępstwo</button>
                      </div>
                    ) : !autoPlanning && preview && <p>Brak dostępnej pary na ten sam kort i godzinę.</p>}
                  </td>
                  <td>{booking.league}</td>
                  <td>Odmowa lub prośba o zmianę terminu</td>
                  <td><button type="button" className="scheduler-text-action scheduler-text-action--danger" disabled={Boolean(busy)} onClick={() => onDelete(booking.id)}>Usuń</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>}

        {preview && <div className="day-plan-list">
          <h3>Nowe propozycje</h3>
          <p>Do planu można włączyć {preview.playerCount} z {preview.rosterCount} zawodników z aktywnym profilem i unikalnym polskim numerem telefonu.</p>
          {!additions.length && <p>Brak nowych par na wolne sloty.</p>}
          {!!additions.length && <div className="scheduler-table-wrap">
            <table className="scheduler-table day-plan-table" aria-label="Nowe propozycje">
              <thead><tr><th>Zapisz</th><th>Termin i kort</th><th>Mecz</th><th>Liga</th><th>Akcje</th></tr></thead>
              <tbody>{additions.map((proposal) => <tr key={proposal.key}>
                <td><input type="checkbox" aria-label={`Zapisz propozycję: ${proposal.playerOne} – ${proposal.playerTwo}`} checked={selected.has(proposal.key)} disabled={Boolean(busy)} onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(proposal.key);
                    else next.delete(proposal.key);
                    return next;
                  });
                }} /></td>
                <td>{label(proposal)}</td>
                <td><strong>{proposal.playerOne} – {proposal.playerTwo}</strong><div className="table-subtext">{proposal.rationale}</div></td>
                <td>{proposal.league}</td>
                <td><button type="button" className="scheduler-text-action scheduler-text-action--danger" disabled={Boolean(busy)} onClick={() => {
                  dismissed.current.add(proposal.key);
                  setPreview((current) => current && ({
                    ...current,
                    data: { ...current.data, drafts: current.data.drafts.filter((draft) => draft.key !== proposal.key) },
                  }));
                  setSelected((current) => new Set([...current].filter((key) => key !== proposal.key)));
                }}>Usuń</button></td>
              </tr>)}</tbody>
            </table>
          </div>}
          {!!additions.length && <button type="button" className="button-primary" disabled={!selected.size || Boolean(busy) || autoPlanning} onClick={() => save([...selected])}>Zapisz wybrane ({selected.size})</button>}
        </div>}
      </>}

      {batch && <dialog ref={dialog} className="match-sms-dialog" aria-labelledby="day-sms-title"
        onCancel={(event) => { if (busy) event.preventDefault(); }}
        onClose={() => setBatch(null)}>
        <h2 id="day-sms-title">Wyślij plan SMS</h2>
        <p>Każdy z graczy otrzyma własny link do odpowiedzi.</p>
        {batch.map((entry) => <article className="player-match" key={entry.booking.id}>
          <strong>{label(entry.booking)} · {entry.booking.league} · {entry.booking.playerOne} – {entry.booking.playerTwo}</strong>
          {entry.sms?.recipients.map((recipient, index) => <div key={recipient.playerId || index}>
            <MatchSmsRecipientStatus recipient={recipient} />{recipient.canSend && <small>Odbiorca tej wysyłki: {recipient.phone}</small>}
          </div>)}
          {entry.sms && <p className="match-sms-preview">{entry.sms.text}</p>}
          {entry.sms && !entry.sms.configured && <p>Wysyłka wymaga konfiguracji JustSend.</p>}
          {entry.error && <p role="alert">{entry.error}</p>}
        </article>)}
        {busy && <p role="status">{busy}</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="form-actions">
          {smsCount > 0 && <button type="button" disabled={Boolean(busy)} onClick={sendBatch}>Zatwierdź i wyślij ({smsCount} SMS)</button>}
          <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => dialog.current?.close()}>Zamknij</button>
        </div>
      </dialog>}
    </section>
  );
}
