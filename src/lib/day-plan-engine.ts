import { MATCH_MS, overlap, warsawInstant } from "@/lib/scheduling-slots";
import type { DayPlanDraft } from "@/lib/day-plan-types";

type Interval = [number, number];
export type DayCandidate = {
  id: string;
  name: string;
  league: string;
  skill: number;
  available: Interval[];
  blocked: Interval[];
  preferences: Array<{ weekday: number; minute?: number }>;
};
type CourtSlot = { courtId: string; court: string; start: number; minute: number; replacementFor: string | null; league?: string };
type Booking = { id: string; courtId: string | null; start: number; players: string[] };
export const MAX_PLAN_MATCHES = 16;

export function planPair(league: string, a: string, b: string) {
  return JSON.stringify([league, ...[a, b].sort()]);
}

export function dayPlanDrafts(input: {
  day: string;
  now: number;
  players: DayCandidate[];
  courts: Array<{ id: string; name: string; openingTime: string; closingTime: string }>;
  bookings: Booking[];
  blockedPairs: Set<string>;
  replacements: Array<{ id: string; courtId: string; start: number; minute: number; league: string }>;
}) {
  const weekday = new Date(`${input.day}T12:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const earliestStart = (weekend ? 10 : 16) * 60;
  const times = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const slots: CourtSlot[] = [];
  const replacements = new Map(input.replacements.map((item) => [item.id, item]));
  for (const court of input.courts) {
    const opening = Math.max(earliestStart, times(court.openingTime));
    for (let minute = Math.ceil(opening / 30) * 30; minute + 90 <= times(court.closingTime); minute += 30) {
      const hhmm = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      let start: number;
      try { start = warsawInstant(input.day, hhmm); } catch { continue; }
      if (start > input.now) slots.push({ courtId: court.id, court: court.name, start, minute, replacementFor: null });
    }
  }
  // A replaced reservation may begin off the half-hour grid; keep its exact time.
  for (const item of replacements.values()) {
    const court = input.courts.find((c) => c.id === item.courtId);
    if (court && item.start > input.now && item.minute >= Math.max(earliestStart, times(court.openingTime)) && item.minute + 90 <= times(court.closingTime)) {
      slots.push({ ...item, court: court.name, replacementFor: item.id });
    }
  }

  function score(player: DayCandidate, slot: CourtSlot) {
    const end = slot.start + MATCH_MS;
    if (player.blocked.some(([from, to]) => overlap(slot.start, end, from, to))) return null;
    const explicit = player.available.some(([from, to]) => from <= slot.start && to >= end);
    if (player.available.length && !explicit) return null;
    const sameDay = player.preferences.filter((p) => p.weekday === weekday);
    const close = player.preferences.filter((p) => p.minute !== undefined && Math.abs(p.minute - slot.minute) <= 90);
    const best = close.some((p) => p.weekday === weekday);
    return {
      explicit, history: best || close.length > 0 || sameDay.length > 0,
      value: (explicit ? 100 : 0) + (best ? 28 : 0) + Math.min(close.length, 5) * 3 + Math.min(sameDay.length, 5) * 2,
    };
  }

  const picked: DayPlanDraft[] = [];
  const reserved = [...input.bookings];
  const used = new Set<string>();
  function pick(pool: CourtSlot[]) {
    let best: { slot: CourtSlot; one: DayCandidate; two: DayCandidate; score: number; rationale: string } | null = null;
    for (const slot of pool) {
      if (best && slot.start > best.slot.start) break;
      const relevant = reserved.filter((r) => r.id !== slot.replacementFor && overlap(r.start, r.start + MATCH_MS, slot.start, slot.start + MATCH_MS));
      if (relevant.some((r) => r.courtId === slot.courtId)) continue;
      const busyPlayers = new Set(relevant.flatMap((r) => r.players));
      const eligible = input.players.filter((p) => !used.has(p.id) && !busyPlayers.has(p.id) && (!slot.league || p.league === slot.league))
        .map((p) => ({ p, score: score(p, slot) })).filter((p) => p.score !== null);
      for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i], b = eligible[j];
        if (a.p.league !== b.p.league) continue;
        const s1 = a.score!, s2 = b.score!;
        const rating = Math.min(s1.value, s2.value) * 2 + s1.value + s2.value - Math.abs(a.p.skill - b.p.skill) * 0.25;
        if ((best && rating <= best.score) || input.blockedPairs.has(planPair(a.p.league, a.p.id, b.p.id))) continue;
        const rationale = s1.explicit && s2.explicit ? "Oboje wpisali dostępność na ten slot."
          : s1.explicit || s2.explicit ? "Jeden gracz wpisał dostępność; drugi musi potwierdzić."
          : s1.history || s2.history ? "Dzień lub godzina pasują do historii; dostępność do potwierdzenia."
          : "Brak danych o preferencjach tej pary; dostępność do potwierdzenia.";
        best = { slot, one: a.p, two: b.p, score: rating, rationale };
      }
    }
    if (!best) return false;
    const { slot, one, two, rationale } = best;
    const startsAt = new Date(slot.start).toISOString();
    picked.push({
      key: JSON.stringify([slot.courtId, startsAt, one.id, two.id, slot.replacementFor, one.league]),
      courtId: slot.courtId, court: slot.court, league: one.league, startsAt, playerOneId: one.id, playerTwoId: two.id,
      playerOne: one.name, playerTwo: two.name, rationale, replacementFor: slot.replacementFor,
    });
    used.add(one.id); used.add(two.id);
    reserved.push({ id: "", courtId: slot.courtId, start: slot.start, players: [one.id, two.id] });
    return true;
  }

  for (const id of replacements.keys()) {
    if (picked.length >= MAX_PLAN_MATCHES) break;
    pick(slots.filter((slot) => slot.replacementFor === id));
  }
  const openSlots = slots.filter((slot) => !slot.replacementFor).sort((a, b) => a.start - b.start);
  while (picked.length < MAX_PLAN_MATCHES && pick(openSlots)) { /* Fill remaining capacity. */ }
  return picked.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.court.localeCompare(b.court, "pl"));
}
