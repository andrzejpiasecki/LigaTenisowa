"use client";
import { useCallback, useEffect, useState } from "react";
import type { MatchProposal, PlayerAvailability, Player } from "@/lib/scheduled-matches";
type Sms = { id: string; body: string; phone: string; status: string; error: string; player: { fullName: string } };
const STATUSES: Record<string, string> = { queued: "Gotowy do wysyłki", sending: "Przekazywanie do bramki", submitted: "Przekazany do bramki", failed: "Odrzucony przez bramkę", unknown: "Wynik nieznany — sprawdź telefon", cancelled: "Anulowany" };
export function SchedulerCommunications({ proposals, availabilities, players, refresh }: { proposals: MatchProposal[]; availabilities: PlayerAvailability[]; players: Player[]; refresh: () => Promise<void> }) {
  const [messages, setMessages] = useState<Sms[]>([]), [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/scheduler/communications", { cache: "no-store" });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    setMessages(result.messages); setConfigured(result.gatewayConfigured);
  }, []);
  useEffect(() => { load().catch((e) => setNotice(e.message)); }, [load]);
  async function action(url: string, body: unknown, method = "POST") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setNotice(typeof result.count === "number" ? `Przygotowano ${result.count} nowych SMS.` : "Operacja zakończona.");
      await Promise.all([load(), refresh()]);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Błąd operacji."); await load().catch(() => {}); } finally { setBusy(false); }
  }
  return <>
    <section className="panel-card"><h2>Dostępność graczy i propozycje</h2><p>Propozycje powstają z dostępności na stronie i wolnych kortów. Po zaakceptowaniu terminu przygotuj SMS z linkiem do potwierdzenia.</p><button className="button-primary" disabled={busy} onClick={() => action("/api/scheduler/overview", {})}>Przelicz propozycje</button>
      {proposals.filter((p) => p.status === "draft").map((p) => <article className="player-match" key={p.id}><h3>{p.playerOneName} — {p.playerTwoName}</h3><p>{new Date(p.proposedStartsAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })} · {p.courtName}</p><p>{p.rationale}</p><div className="scheduler-actions"><button className="button-primary" disabled={busy} onClick={() => action(`/api/match-proposals/${p.id}`, { action: "accept" }, "PATCH")}>Zaproponuj graczom</button><button className="button-secondary" disabled={busy} onClick={() => action(`/api/match-proposals/${p.id}`, { action: "reject" }, "PATCH")}>Odrzuć</button></div></article>)}
      <details><summary>Zapisane przedziały dostępności ({availabilities.length})</summary>{availabilities.map((a) => <p key={a.id}>{players.find((p) => p.id === a.playerId)?.fullName}: {a.kind === "dostepny" ? "dostępny" : "niedostępny"}, {new Date(a.startsAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })} — {new Date(a.endsAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}</p>)}</details>
    </section>
    <section className="panel-card"><h2>SMS z telefonu</h2><p>Zaproszenie do ustawienia hasła i dodania dostępności wysyłamy raz na gracza. Kolejne SMS dotyczą propozycji meczów. Odpowiedzi przyjmujemy na stronie.</p><p>{configured ? "Bramka SMS skonfigurowana." : "Bramka SMS nie jest jeszcze połączona. Skonfiguruj połączenie z telefonem zgodnie z instrukcją projektu."}</p><div className="scheduler-actions"><button className="button-secondary" disabled={busy} onClick={() => action("/api/scheduler/communications", { action: "invitations" })}>Przygotuj jednorazowe zaproszenia</button><button className="button-secondary" disabled={busy} onClick={() => action("/api/scheduler/communications", { action: "matches" })}>Przygotuj SMS z terminami</button><button className="button-secondary" disabled={busy} onClick={async () => { try { await load(); } catch (e) { setNotice(String(e)); } }}>Odśwież kolejkę</button></div>
      {notice && <p role="status">{notice}</p>}{!messages.length && <p>Kolejka SMS jest pusta.</p>}{messages.map((m) => <article key={m.id} className="player-match"><h3>{m.player.fullName} · {m.phone}</h3><p className="sms-preview">{m.body}</p><p>{STATUSES[m.status] || m.status}{m.error ? `: ${m.error}` : ""}</p>{m.status === "queued" && <button className="button-primary" disabled={busy || !configured} onClick={() => action("/api/scheduler/communications", { action: "send", id: m.id })}>Wyślij SMS przez telefon</button>}</article>)}
    </section>
  </>;
}
