"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { warsawInstant } from "@/lib/scheduling-slots";
import type { AvailabilityRange } from "@/lib/scheduling-ai";

type Weekly = { weekday: number; startTime: string; endTime: string; notes: string };
type Overview = {
  player: { fullName: string; league: string; season: string };
  availabilities: Array<AvailabilityRange & { id: string }>;
  weeklyAvailability: Weekly[];
  matches: Array<{ id: string; playerOne: string; playerTwo: string; scheduledAt: string; location: string; status: string; revision: string; reply: boolean | null; confirmations: number }>;
};
const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];
function displayDate(value: string) { return new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
async function api(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, { method: body ? method : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Nie udało się wykonać operacji.");
  return result;
}
export function PlayerPortal({ highlightedMatch }: { highlightedMatch?: string }) {
  const [data, setData] = useState<Overview | null>(null), [weekly, setWeekly] = useState<Weekly[]>([]);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [text, setText] = useState(""), [preview, setPreview] = useState<AvailabilityRange[]>([]), [summary, setSummary] = useState("");
  const [day, setDay] = useState(""), [start, setStart] = useState("17:00"), [end, setEnd] = useState("20:00"), [kind, setKind] = useState("dostepny");
  const load = useCallback(async () => { const result = await api("/api/player/availability"); setData(result); setWeekly(result.weeklyAvailability); }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Wystąpił błąd."); } finally { setBusy(false); }
  }
  return <main className="app-shell player-portal">
    <header className="app-header"><div className="app-header-top"><div><h1>Moje mecze i dostępność</h1><p>{data?.player.fullName} · {data?.player.league} · {data?.player.season}</p></div><div className="scheduler-actions"><Link href="/dashboard">Wyniki ligi</Link><button className="button-secondary" disabled={busy} onClick={() => run(async () => { await api("/api/player/auth", {}, "DELETE"); window.location.assign("/gracz/logowanie"); })}>Wyloguj</button></div></div></header>
    <div className="app-content player-sections">
      <p>Wszystkie godziny podajemy w strefie Europe/Warsaw. Na SMS nie trzeba odpowiadać — wszystko załatwisz tutaj.</p>
      <div aria-live="polite">{error && <p role="alert" className="form-message--error">{error}</p>}{message && <p className="form-message--success">{message}</p>}</div>
      <section className="panel-card"><h2>Propozycje meczów</h2>{!data ? <p>Ładowanie…</p> : !data.matches.length ? <p>Nie masz aktualnych propozycji. Dodaj dostępność, aby organizator mógł umówić mecz.</p> : data.matches.map((m) => <article className={`player-match${m.id === highlightedMatch ? " player-match--highlight" : ""}`} key={m.id}>
        <h3>{m.playerOne} — {m.playerTwo}</h3><p>{displayDate(m.scheduledAt)} · {m.location}</p>
        <p>{m.confirmations === 2 && m.status === "potwierdzony" ? "Mecz potwierdzony przez obu graczy." : `Potwierdzenia graczy: ${m.confirmations}/2.`} {m.reply === true ? "Twoja odpowiedź: potwierdzam." : m.reply === false ? "Twoja odpowiedź: nie mogę." : "Czekamy na Twoją odpowiedź."}</p>
        <div className="scheduler-actions"><button className="button-primary" disabled={busy || m.reply === true} onClick={() => run(async () => { await api("/api/player/matches", { id: m.id, revision: m.revision, accepted: true }); await load(); setMessage("Termin potwierdzony."); })}>Potwierdzam termin</button><button className="button-secondary" disabled={busy || m.reply === false} onClick={() => run(async () => { await api("/api/player/matches", { id: m.id, revision: m.revision, accepted: false }); await load(); setMessage("Odmowa zapisana. Dodaj poniżej terminy, które Ci pasują."); })}>Nie mogę w tym terminie</button></div>
      </article>)}</section>
      <section className="panel-card"><h2>Dodaj dostępność</h2><form className="scheduler-form" onSubmit={(e) => { e.preventDefault(); run(async () => {
        const startsAt = new Date(warsawInstant(day, start)).toISOString(), endsAt = new Date(warsawInstant(day, end)).toISOString();
        await api("/api/player/availability", { action: "save", ranges: [{ kind, startsAt, endsAt, summary: "Termin dodany przez gracza" }] }); await load(); setMessage("Dostępność zapisana.");
      }); }}><label>Data<input type="date" required value={day} onChange={(e) => setDay(e.target.value)} /></label><label>Od<input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label><label>Do<input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></label><label>Dostępność<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="dostepny">Mogę grać</option><option value="niedostepny">Nie mogę grać</option></select></label><button className="button-primary" disabled={busy}>Dodaj termin</button></form>
        <h3>Opisz terminy własnymi słowami</h3><p>Na przykład: „W przyszły wtorek mogę od 17 do 20, w środę od 18 do 21”. Sprawdzisz rozpoznane daty przed zapisem.</p>
        <div className="player-form"><label>Wiadomość<textarea maxLength={2000} value={text} onChange={(e) => { setText(e.target.value); setPreview([]); setSummary(""); }} /></label><button className="button-secondary" disabled={busy || !text.trim()} onClick={() => run(async () => { setPreview([]); const result = await api("/api/player/availability", { action: "interpret", text }); setPreview(result.ranges); setSummary(result.summary); })}>Rozpoznaj terminy</button></div>
        {summary && <p>{summary}</p>}{preview.map((r, i) => <p key={i}>{r.kind === "dostepny" ? "Mogę" : "Nie mogę"}: {displayDate(r.startsAt)} — {displayDate(r.endsAt)}</p>)}
        {!!preview.length && <button className="button-primary" disabled={busy} onClick={() => run(async () => { await api("/api/player/availability", { action: "save", ranges: preview }); setPreview([]); setSummary(""); setText(""); await load(); setMessage("Rozpoznane terminy zapisane."); })}>Zatwierdź i zapisz te terminy</button>}
      </section>
      <section className="panel-card"><h2>Stałe terminy w tygodniu</h2><p>Wpisz regularne godziny, w których możesz grać. Jednorazowe blokady mają pierwszeństwo.</p>{weekly.map((w, index) => <div className="player-weekly-row" key={index}><select aria-label="Dzień tygodnia" value={w.weekday} onChange={(e) => setWeekly(weekly.map((v, i) => i === index ? { ...v, weekday: Number(e.target.value) } : v))}>{DAYS.map((d, i) => <option value={i + 1} key={d}>{d}</option>)}</select><input type="time" aria-label="Dostępny od" value={w.startTime} onChange={(e) => setWeekly(weekly.map((v, i) => i === index ? { ...v, startTime: e.target.value } : v))} /><input type="time" aria-label="Dostępny do" value={w.endTime} onChange={(e) => setWeekly(weekly.map((v, i) => i === index ? { ...v, endTime: e.target.value } : v))} /><button className="button-secondary" disabled={busy} onClick={() => setWeekly(weekly.filter((_, i) => i !== index))}>Usuń</button></div>)}<div className="scheduler-actions"><button className="button-secondary" disabled={busy || weekly.length >= 30} onClick={() => setWeekly([...weekly, { weekday: 1, startTime: "17:00", endTime: "20:00", notes: "" }])}>Dodaj dzień</button><button className="button-primary" disabled={busy} onClick={() => run(async () => { await api("/api/player/availability", { action: "weekly", weeklyAvailability: weekly }); await load(); setMessage("Stała dostępność zapisana."); })}>Zapisz stałe terminy</button></div></section>
      <section className="panel-card"><h2>Zapisane terminy i blokady</h2>{!data?.availabilities.length && <p>Brak zapisanych terminów.</p>}{data?.availabilities.map((a) => <article className="player-match" key={a.id}><p><strong>{a.kind === "dostepny" ? "Mogę grać" : "Nie mogę grać"}</strong> · {displayDate(a.startsAt)} — {displayDate(a.endsAt)}</p><p>{a.summary}</p><button className="button-secondary" disabled={busy} onClick={() => run(async () => { await api("/api/player/availability", { id: a.id }, "DELETE"); await load(); setMessage("Termin usunięty."); })}>Usuń termin</button></article>)}</section>
    </div>
  </main>;
}
