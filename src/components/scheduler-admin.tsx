"use client";

import Link from "next/link";
import type { MatchSmsRecipient } from "@/lib/match-sms-types";
import { DayPlanPanel } from "@/components/day-plan-panel";
import { LeagueMatchesTable } from "@/components/league-matches-table";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { normalizePersonName } from "@/lib/results-directory";
import {
  SCHEDULED_MATCH_STATUSES,
  type LeagueMatchMatrix,
  type LeagueRecordedMatch,
  type SchedulerOverview,
  type ScheduledMatch,
  type ScheduledMatchPayload,
} from "@/lib/scheduled-matches";

type LeagueResults = Pick<LeagueMatchMatrix, "participants" | "playedPairKeys" | "fivePointPairKeys" | "recordedMatches">;
const EMPTY_RESULTS: LeagueResults = { participants: [], playedPairKeys: [], fivePointPairKeys: [], recordedMatches: [] };

function pairKey(first: string, second: string) {
  return [normalizePersonName(first), normalizePersonName(second)].sort().join("::");
}

type BookingPlayer = { key: string; id: string; fullName: string; phone: string };

type SchedulerFilterOption = {
  value: string;
  label: string;
};

const EMPTY_MATCH_FORM: ScheduledMatchPayload = {
  season: "",
  league: "",
  playerOneId: "",
  playerOne: "",
  playerOnePhone: "",
  playerTwoId: "",
  playerTwo: "",
  playerTwoPhone: "",
  courtId: "",
  scheduledAt: "",
  location: "",
  status: "propozycja",
  adminNotes: "",
};

const EMPTY_TIMES: string[] = [];
const SLOT_MINUTES = 30;
const MATCH_DURATION_MINUTES = 90;
const APP_TIME_ZONE = "Europe/Warsaw";

function getZonedParts(dateValue: Date | string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(typeof dateValue === "string" ? new Date(dateValue) : dateValue);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function toWarsawDate(datePart: string, timePart: string) {
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let index = 0; index < 3; index += 1) {
    const actual = getZonedParts(new Date(timestamp));
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const diff = targetAsUtc - actualAsUtc;

    if (diff === 0) {
      break;
    }

    timestamp += diff;
  }

  return new Date(timestamp);
}

function toLocalDateTimeInput(isoValue: string) {
  if (!isoValue) {
    return "";
  }

  const parts = getZonedParts(isoValue);
  return `${parts.year}-${padTime(parts.month)}-${padTime(parts.day)}T${padTime(parts.hour)}:${padTime(parts.minute)}`;
}

function toIsoDateTime(localValue: string) {
  if (!localValue) {
    return "";
  }

  const [datePart, timePart] = localValue.split("T");
  return toWarsawDate(datePart, timePart).toISOString();
}

function toMinutes(timeValue: string) {
  const [hours, minutes] = timeValue.split(":").map(Number);
  return (hours * 60) + minutes;
}

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function formatSlotLabel(totalMinutes: number) {
  return `${padTime(Math.floor(totalMinutes / 60))}:${padTime(totalMinutes % 60)}`;
}

function toDateInputValue(date = new Date()) {
  const parts = getZonedParts(date);
  return `${parts.year}-${padTime(parts.month)}-${padTime(parts.day)}`;
}

function getLocalDatePart(localValue: string) {
  return localValue ? localValue.slice(0, 10) : "";
}

function getLocalTimePart(localValue: string) {
  return localValue ? localValue.slice(11, 16) : "";
}

function combineLocalDateTime(datePart: string, timePart: string) {
  return datePart && timePart ? `${datePart}T${timePart}` : "";
}

function formatWarsawDateTime(isoValue: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(isoValue));
}

function shiftDateValue(dateValue: string, days: number) {
  const baseDate = toWarsawDate(dateValue, "12:00");
  const shiftedDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  const parts = getZonedParts(shiftedDate);
  return `${parts.year}-${padTime(parts.month)}-${padTime(parts.day)}`;
}

const EMPTY_ROSTER = { players: [] as BookingPlayer[], results: EMPTY_RESULTS, loading: false, error: "" };

function useLeagueRoster(seasonId: string, leagueId: string) {
  const key = JSON.stringify([seasonId, leagueId]);
  const [loaded, setLoaded] = useState<{ key: string; roster: typeof EMPTY_ROSTER }>();
  useEffect(() => {
    if (!seasonId || !leagueId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ seasonId, leagueId });
    fetch(`/api/scheduler/booking/players?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!controller.signal.aborted) setLoaded({
          key, roster: { ...EMPTY_ROSTER, players: payload.players, results: payload.results },
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({
          key, roster: { ...EMPTY_ROSTER, error: error instanceof Error ? error.message : "Nie udało się pobrać zawodników." },
        });
      });
    return () => controller.abort();
  }, [key, seasonId, leagueId]);

  if (!seasonId || !leagueId) return EMPTY_ROSTER;
  return loaded?.key === key ? loaded.roster : { ...EMPTY_ROSTER, loading: true };
}

function leaguePairs(roster: typeof EMPTY_ROSTER, matches: ScheduledMatch[], season: string, league: string) {
  const scheduledByPair = new Map<string, ScheduledMatch>();
  const playedPairKeys = new Set(roster.results.playedPairKeys);
  const playerKeys = new Map(roster.players.filter((player) => player.id).map((player) => [player.id, player.key]));
  for (const match of matches) {
    if (match.season !== season || match.league !== league || match.status === "anulowany") continue;
    const key = pairKey(playerKeys.get(match.playerOneId) || match.playerOne, playerKeys.get(match.playerTwoId) || match.playerTwo);
    if (match.status === "rozegrany") playedPairKeys.add(key);
    else if (!scheduledByPair.has(key)) scheduledByPair.set(key, match);
  }
  return { scheduledByPair, playedPairKeys, fivePointPairKeys: new Set(roster.results.fivePointPairKeys) };
}

export function SchedulerAdmin() {
  const [overview, setOverview] = useState<Pick<SchedulerOverview, "matches" | "courts"> & { smsStatuses: Record<string, MatchSmsRecipient[]> }>({
    matches: [], courts: [], smsStatuses: {},
  });
  const [seasonOptions, setSeasonOptions] = useState<SchedulerFilterOption[]>([]);
  const [leagueOptions, setLeagueOptions] = useState<SchedulerFilterOption[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState("");
  const [activeLeagueId, setActiveLeagueId] = useState("");
  const [matrixLeagueId, setMatrixLeagueId] = useState("");
  const [seasonResults, setSeasonResults] = useState<Array<LeagueRecordedMatch & { league: string }>>([]);
  const [seasonResultsLoading, setSeasonResultsLoading] = useState(false);
  const [seasonResultsError, setSeasonResultsError] = useState("");
  const [matchForm, setMatchForm] = useState<ScheduledMatchPayload>(EMPTY_MATCH_FORM);
  const [matchTime, setMatchTime] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [occupancyDate, setOccupancyDate] = useState(() => shiftDateValue(toDateInputValue(), 1));
  const [selectedOccupancyMatchId, setSelectedOccupancyMatchId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [locatedMatchIds, setLocatedMatchIds] = useState<string[]>([]);
  const [matchToDelete, setMatchToDelete] = useState<ScheduledMatch | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const overviewRequests = useRef({ started: 0, applied: 0 });

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const request = ++overviewRequests.current.started;
    const response = await fetch("/api/scheduler/booking", { cache: "no-store", signal });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nie udało się pobrać danych modułu.");
    }

    if (!signal?.aborted && request > overviewRequests.current.applied) {
      overviewRequests.current.applied = request;
      setOverview(payload);
    }
    return payload as typeof overview;
  }, []);

  async function loadOptions() {
    const response = await fetch("/api/scheduler/options", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nie udało się pobrać listy sezonów i lig.");
    }

    const seasons = payload.seasons || [];
    const leagues = payload.leagues || [];
    setSeasonOptions(seasons);
    setLeagueOptions(leagues);
    setActiveSeasonId((current) => current || payload.currentSeason?.value || seasons[0]?.value || "");
    setActiveLeagueId((current) => current || leagues[0]?.value || "");
    setMatrixLeagueId((current) => current || leagues[0]?.value || "");
  }

  useEffect(() => {
    startTransition(async () => {
      await Promise.all([loadOverview(), loadOptions()]).catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać danych modułu.");
      });
    });
  }, []);

  const activeSeasonLabel = seasonOptions.find((option) => option.value === activeSeasonId)?.label || "";
  const activeLeagueLabel = leagueOptions.find((option) => option.value === activeLeagueId)?.label || "";

  const matrixRoster = useLeagueRoster(activeSeasonId, matrixLeagueId);
  const separateFormRoster = useLeagueRoster(activeSeasonId, activeLeagueId === matrixLeagueId ? "" : activeLeagueId);
  const formRoster = activeLeagueId === matrixLeagueId ? matrixRoster : separateFormRoster;
  const { players: filteredPlayers, loading: rosterLoading, error: rosterError } = formRoster;
  const matrixLeagueLabel = leagueOptions.find((option) => option.value === matrixLeagueId)?.label || "";
  const matrixPairs = useMemo(() => leaguePairs(matrixRoster, overview.matches, activeSeasonLabel, matrixLeagueLabel),
    [matrixRoster, overview.matches, activeSeasonLabel, matrixLeagueLabel]);
  const { playedPairKeys } = useMemo(() => leaguePairs(formRoster, overview.matches, activeSeasonLabel, activeLeagueLabel),
    [formRoster, overview.matches, activeSeasonLabel, activeLeagueLabel]);

  useEffect(() => {
    if (!activeSeasonId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ seasonId: activeSeasonId, view: "season-results" });
    setSeasonResultsLoading(true);
    setSeasonResultsError("");
    fetch(`/api/scheduler/booking/players?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!controller.signal.aborted) setSeasonResults(payload.matches);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSeasonResultsError("Nie udało się pobrać oficjalnych wyników sezonu.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSeasonResultsLoading(false);
      });
    return () => controller.abort();
  }, [activeSeasonId]);

  const selectedOne = filteredPlayers.find((p) => matchForm.playerOneId ? p.id === matchForm.playerOneId : p.fullName === matchForm.playerOne);
  const selectedTwo = filteredPlayers.find((p) => matchForm.playerTwoId ? p.id === matchForm.playerTwoId : p.fullName === matchForm.playerTwo);

  function changeFilter(kind: "season" | "league", value: string) {
    if (kind === "season") {
      setActiveSeasonId(value);
      setSeasonResults([]);
    }
    else setActiveLeagueId(value);
    setSelectedOccupancyMatchId(null);
    if (kind === "league" && !editingMatchId) {
      setMatchForm((current) => ({ ...EMPTY_MATCH_FORM, courtId: current.courtId, location: current.location }));
    } else {
      resetMatchForm();
    }
  }

  const allMatchRows = useMemo(() => {
    if (!activeSeasonLabel) return [];
    const recordedPairs = new Set(seasonResults.map((match) => JSON.stringify([match.league, pairKey(match.winner, match.loser)])));
    const playerKeys = new Map(filteredPlayers.filter((player) => player.id).map((player) => [player.id, player.key]));
    const bookings = overview.matches.filter((match) => {
      if (match.season !== activeSeasonLabel) return false;
      const key = pairKey(playerKeys.get(match.playerOneId) || match.playerOne, playerKeys.get(match.playerTwoId) || match.playerTwo);
      return match.dayPlan || match.status !== "rozegrany" || !recordedPairs.has(JSON.stringify([match.league, key]));
    });
    const upcoming = (match: ScheduledMatch) => match.status !== "rozegrany" && match.status !== "anulowany";
    const pending = bookings.filter(upcoming).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const history = [
      ...bookings.filter((match) => !upcoming(match)).map((match) => ({ kind: "booking" as const, match, date: match.scheduledAt })),
      ...seasonResults.map((match) => ({ kind: "result" as const, match, date: match.date })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return [...pending.map((match) => ({ kind: "booking" as const, match })), ...history];
  }, [activeSeasonLabel, filteredPlayers, seasonResults, overview.matches]);

  const editedMatch = editingMatchId ? overview.matches.find((match) => match.id === editingMatchId) : undefined;
  const editedPairKey = editedMatch && pairKey(
    filteredPlayers.find((player) => player.id && player.id === editedMatch.playerOneId)?.key || editedMatch.playerOne,
    filteredPlayers.find((player) => player.id && player.id === editedMatch.playerTwoId)?.key || editedMatch.playerTwo,
  );

  function isPlayedOpponent(first: BookingPlayer | undefined, second: BookingPlayer | undefined) {
    if (!first || !second) return false;
    const key = pairKey(first.key, second.key);
    return key !== editedPairKey && playedPairKeys.has(key);
  }

  function selectPlayer(side: "one" | "two", key: string) {
    const player = filteredPlayers.find((entry) => entry.key === key);
    if (side === "two" && isPlayedOpponent(selectedOne, player)) return;
    const clearOpponent = side === "one" && isPlayedOpponent(player, selectedTwo);
    setMatchForm((current) => side === "one"
      ? {
        ...current,
        playerOneId: player?.id || "", playerOne: player?.fullName || "", playerOnePhone: player?.phone || "",
        ...(clearOpponent ? { playerTwoId: "", playerTwo: "", playerTwoPhone: "" } : {}),
      }
      : { ...current, playerTwoId: player?.id || "", playerTwo: player?.fullName || "", playerTwoPhone: player?.phone || "" });
  }

  function choosePair(first: string, second: string) {
    const one = matrixRoster.players.find((player) => player.key === normalizePersonName(first));
    const two = matrixRoster.players.find((player) => player.key === normalizePersonName(second));
    if (!one || !two) return;
    setActiveLeagueId(matrixLeagueId);
    setEditingMatchId(null);
    setSelectedOccupancyMatchId(null);
    setMatchForm((current) => ({
      ...(editingMatchId ? EMPTY_MATCH_FORM : current),
      playerOneId: one.id, playerOne: one.fullName, playerOnePhone: one.phone,
      playerTwoId: two.id, playerTwo: two.fullName, playerTwoPhone: two.phone,
    }));
    if (editingMatchId) setMatchTime("");
  }

  const occupancyMatches = useMemo(
    () => overview.matches.filter((match) => match.status !== "anulowany"),
    [overview.matches],
  );

  const activeCourts = useMemo(
    () => overview.courts.filter((court) => court.isActive).sort((left, right) => left.name.localeCompare(right.name, "pl")),
    [overview.courts],
  );
  const selectedCourt = useMemo(
    () => activeCourts.find((court) => court.id === matchForm.courtId) || null,
    [activeCourts, matchForm.courtId],
  );
  const selectedMatchTime = matchTime;

  const occupancySlots = useMemo(() => {
    if (!activeCourts.length) {
      return [] as number[];
    }

    const earliest = Math.floor(Math.min(...activeCourts.map((court) => toMinutes(court.openingTime))) / SLOT_MINUTES) * SLOT_MINUTES;
    const latest = Math.max(...activeCourts.map((court) => toMinutes(court.closingTime)));
    const slots: number[] = [];

    for (let minutes = earliest; minutes < latest; minutes += SLOT_MINUTES) {
      slots.push(minutes);
    }

    return slots;
  }, [activeCourts]);

  const availableTimesByCourt = useMemo(() => {
    return new Map(activeCourts.map((court) => {
      const openAt = toMinutes(court.openingTime);
      const closeAt = toMinutes(court.closingTime);
      const reservations = occupancyMatches.filter((match) => match.courtId === court.id && match.id !== editingMatchId);
      const times = occupancySlots.filter((slot) => {
        if (slot < openAt || slot + MATCH_DURATION_MINUTES > closeAt) return false;
        const start = toWarsawDate(occupancyDate, formatSlotLabel(slot)).getTime();
        const end = start + MATCH_DURATION_MINUTES * 60_000;
        return !reservations.some((match) => {
          const booked = new Date(match.scheduledAt).getTime();
          return booked < end && booked + MATCH_DURATION_MINUTES * 60_000 > start;
        });
      }).map(formatSlotLabel);
      return [court.id, times];
    }));
  }, [activeCourts, editingMatchId, occupancyDate, occupancyMatches, occupancySlots]);

  const occupancyRows = useMemo(() => {
    const dayStart = toWarsawDate(occupancyDate, "00:00");
    const dayEnd = toWarsawDate(occupancyDate, "23:59");

    return activeCourts.map((court) => {
      const openAt = toMinutes(court.openingTime);
      const closeAt = toMinutes(court.closingTime);
      const courtMatches = occupancyMatches.filter((match) => {
        if (match.courtId !== court.id) {
          return false;
        }

        const scheduledAt = new Date(match.scheduledAt);
        return scheduledAt >= dayStart && scheduledAt <= dayEnd;
      });

      return {
        court,
        slots: occupancySlots.map((slotStart) => {
          const slotEnd = slotStart + SLOT_MINUTES;

          if (slotStart < openAt || slotEnd > closeAt) {
            return { type: "closed" as const, label: "zamknięte", match: null };
          }

          const match = courtMatches.find((entry) => {
            const matchStart = new Date(entry.scheduledAt);
            const matchEnd = new Date(matchStart.getTime() + MATCH_DURATION_MINUTES * 60 * 1000);
            const slotStartDate = toWarsawDate(occupancyDate, formatSlotLabel(slotStart));
            const slotEndDate = toWarsawDate(occupancyDate, formatSlotLabel(slotEnd));
            return matchStart < slotEndDate && matchEnd > slotStartDate;
          });

          if (!match) {
            return { type: "free" as const, label: "wolne", match: null };
          }

          const slotType = match.status === "propozycja" || match.status === "oczekuje"
            ? "tentative" as const
            : "busy" as const;

          return {
            type: slotType,
            label: `${match.playerOne} vs ${match.playerTwo} (${match.status})`,
            match,
          };
        }),
      };
    });
  }, [activeCourts, occupancyDate, occupancyMatches, occupancySlots]);

  const unassignedCourtMatches = useMemo(() => {
    const dayStart = toWarsawDate(occupancyDate, "00:00");
    const dayEnd = toWarsawDate(occupancyDate, "23:59");

    return occupancyMatches.filter((match) => {
      if (match.courtId) {
        return false;
      }

      const scheduledAt = new Date(match.scheduledAt);
      return scheduledAt >= dayStart && scheduledAt <= dayEnd;
    });
  }, [occupancyDate, occupancyMatches]);

  const selectedOccupancyMatch = useMemo(
    () => occupancyMatches.find((match) => match.id === selectedOccupancyMatchId) || null,
    [occupancyMatches, selectedOccupancyMatchId],
  );

  const availableMatchTimeOptions = selectedCourt ? availableTimesByCourt.get(selectedCourt.id) ?? EMPTY_TIMES : EMPTY_TIMES;

  useEffect(() => {
    if (!selectedMatchTime) {
      return;
    }

    if (availableMatchTimeOptions.includes(selectedMatchTime)) {
      return;
    }

    setMatchTime("");
  }, [availableMatchTimeOptions, selectedMatchTime]);

  function resetMatchForm() {
    setEditingMatchId(null);
    setMatchForm(EMPTY_MATCH_FORM);
    setMatchTime("");
  }

  function changeDate(date: string) {
    if (!date) return;
    setOccupancyDate(date);
    setMatchTime("");
    setSelectedOccupancyMatchId(null);
  }

  function applyFreeSlotToMatchForm(courtId: string, time: string) {
    const court = activeCourts.find((entry) => entry.id === courtId);
    setSelectedOccupancyMatchId(null);
    setMatchTime(time);
    setMatchForm((current) => ({
      ...current,
      courtId,
      location: court?.location || "",
    }));
  }

  function startEdit(match: ScheduledMatch) {
    const season = seasonOptions.find((option) => option.label === match.season);
    const league = leagueOptions.find((option) => option.label === match.league);
    if (!season || !league) return;
    if (season.value !== activeSeasonId) changeFilter("season", season.value);
    if (league.value !== activeLeagueId) changeFilter("league", league.value);
    setEditingMatchId(match.id);
    setMatchForm({
      season: match.season,
      league: match.league,
      playerOneId: match.playerOneId,
      playerOne: match.playerOne,
      playerOnePhone: match.playerOnePhone,
      playerTwoId: match.playerTwoId,
      playerTwo: match.playerTwo,
      playerTwoPhone: match.playerTwoPhone,
      courtId: match.courtId,
      scheduledAt: "",
      location: match.location,
      status: match.status,
      adminNotes: match.adminNotes,
    });
    setOccupancyDate(getLocalDatePart(toLocalDateTimeInput(match.scheduledAt)) || toDateInputValue());
    setMatchTime(getLocalTimePart(toLocalDateTimeInput(match.scheduledAt)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!canSaveMatch) return;

    const payload = {
      ...matchForm,
      season: activeSeasonLabel,
      league: activeLeagueLabel,
      scheduledAt: toIsoDateTime(combineLocalDateTime(occupancyDate, matchTime)),
    };

    const method = editingMatchId ? "PATCH" : "POST";
    const url = editingMatchId ? `/api/scheduled-matches/${editingMatchId}` : "/api/scheduled-matches";

    startTransition(async () => {
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(async (response) => {
          const responsePayload = await response.json();
          if (!response.ok) {
            throw new Error(responsePayload.error || "Nie udało się zapisać meczu.");
          }

          await loadOverview();
          resetMatchForm();
          setSuccess(editingMatchId ? "Mecz został zaktualizowany." : "Mecz został dodany.");
        })
        .catch((submitError: unknown) => {
          setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać meczu.");
        });
    });
  }

  useEffect(() => {
    const dialog = deleteDialog.current;
    if (matchToDelete && dialog && !dialog.open) dialog.showModal();
  }, [matchToDelete]);

  function requestDelete(id: string) {
    const match = overview.matches.find((entry) => entry.id === id);
    if (!match) return;
    setDeleteError("");
    setMatchToDelete(match);
  }

  function confirmDelete() {
    if (!matchToDelete || isPending) return;
    const { id } = matchToDelete;
    setError("");
    setSuccess("");
    setDeleteError("");

    startTransition(async () => {
      await fetch(`/api/scheduled-matches/${id}`, { method: "DELETE" })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Nie udało się usunąć meczu.");
          }

          deleteDialog.current?.close();
          if (editingMatchId === id) {
            resetMatchForm();
          }
          setSelectedOccupancyMatchId(null);
          await loadOverview().catch(() => setError("Mecz usunięto. Odśwież stronę, aby zaktualizować terminarz."));
          setSuccess("Mecz został usunięty.");
        })
        .catch((deleteError: unknown) => {
          setDeleteError(deleteError instanceof Error ? deleteError.message : "Nie udało się usunąć meczu.");
        });
    });
  }

  const canSaveMatch = Boolean(activeSeasonLabel && activeLeagueLabel && selectedCourt
    && availableMatchTimeOptions.includes(selectedMatchTime)
    && selectedOne && selectedTwo && selectedOne.key !== selectedTwo.key
    && !isPlayedOpponent(selectedOne, selectedTwo));

  return (
    <div className="scheduler-layout match-scheduler">
      <section className="panel-card">
        <div className="panel-card__header">
          <h2>Rozgrywki</h2>
        </div>

        <div className="scheduler-form">
          <label>
            Sezon
            <select value={activeSeasonId} onChange={(event) => changeFilter("season", event.target.value)}>
              <option value="">Wybierz sezon</option>
              {seasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p role="alert" className="form-message form-message--error">{error}</p> : null}
        {success ? <p role="status" className="form-message form-message--success">{success}</p> : null}
      </section>

      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Mecze w lidze</h2>

          </div>
          <label className="scheduler-inline-filter">
            Liga w siatce
            <select value={matrixLeagueId} onChange={(event) => setMatrixLeagueId(event.target.value)}>
              <option value="">Wybierz ligę</option>
              {leagueOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        {!!matrixRoster.results.participants.length && <div className="scheduler-table-wrap"><table className={`match-matrix${matrixRoster.results.participants.length > 12 ? " match-matrix--dense" : ""}`}>
          <thead>
            <tr>
              <th scope="col" className="match-matrix__corner">Gracz</th>
              {matrixRoster.results.participants.map((player) => (
                <th key={player.name} scope="col" title={player.name}><span className="match-matrix__column-name">{player.name}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixRoster.results.participants.map((row) => (
              <tr key={row.name}>
                <th scope="row">
                  {row.playerId ? <Link href={`/baza-zawodnikow/${row.playerId}`} className="player-detail-link">{row.name}</Link> : row.name}
                </th>
                {matrixRoster.results.participants.map((column) => {
                  if (row.name === column.name) {
                    return <td key={column.name} className="match-matrix__self" aria-label={`${row.name}: ten sam gracz`}>—</td>;
                  }

                  const key = pairKey(row.name, column.name);
                  const match = matrixPairs.scheduledByPair.get(key);
                  const played = matrixPairs.playedPairKeys.has(key);
                  const fivePoints = played && matrixPairs.fivePointPairKeys.has(key);
                  const inactive = !row.isActive || !column.isActive;
                  const label = fivePoints ? "Mecz za 5 punktów" : played ? "Rozegrany" : match ? match.status : inactive ? "Nieaktywny" : "Do umówienia";
                  const detail = match && !played ? formatWarsawDateTime(match.scheduledAt) : "";

                  return (
                    <td key={column.name} className={`match-matrix__cell match-matrix__cell--${fivePoints ? "five-points" : played ? "played" : match ? "scheduled" : inactive ? "inactive" : "open"}`}>
                      {played || inactive ? (
                        <span className="match-matrix__label" title={`${row.name} – ${column.name}: ${label}`} aria-label={`${row.name} i ${column.name}: ${label}`} />
                      ) : (
                        <button
                          type="button"
                          className="match-matrix__button"
                          title={`${row.name} – ${column.name}: ${label}${detail ? `, ${detail}` : ""}`}
                          aria-label={`${row.name} i ${column.name}: ${label}${detail ? `, ${detail}` : ""}`}
                          onClick={() => {
                            if (match) {
                              startEdit(match);
                            } else {
                              choosePair(row.name, column.name);
                            }
                            document.getElementById("scheduler-match-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table></div>}
        {matrixRoster.loading && <p role="status">Ładowanie wyników ligi…</p>}
        {matrixRoster.error && <p className="form-message form-message--error" role="alert">{matrixRoster.error}</p>}
        {!matrixRoster.loading && !matrixRoster.error && !matrixRoster.results.participants.length && (
          <p>{activeSeasonId && matrixLeagueId ? "Brak graczy w wybranym sezonie i lidze." : "Wybierz sezon i ligę."}</p>
        )}
      </section>

      <div className="scheduler-main-grid booking-grid">
        <section className="panel-card">
          <div className="panel-card__header booking-panel__header">
            <div>
              <h2>Zajętość kortów</h2>
              <p>Rezerwacje ze wszystkich lig. Mecz trwa 90 minut.</p>
            </div>
            <Link href="/umawianie-meczow/korty" className="button-secondary">Zarządzaj kortami</Link>
          </div>
          <div className="scheduler-date-nav booking-panel__date">
              <button
                type="button"
                className="button-secondary"
                aria-label="Poprzedni dzień"
                onClick={() => changeDate(shiftDateValue(occupancyDate, -1))}
              >
                ❮
              </button>
              <label className="scheduler-inline-filter">
                Dzień
                <input type="date" value={occupancyDate} onChange={(event) => changeDate(event.target.value)} />
              </label>
              <button
                type="button"
                className="button-secondary"
                aria-label="Następny dzień"
                onClick={() => changeDate(shiftDateValue(occupancyDate, 1))}
              >
                ❯
              </button>
          </div>

          {!!unassignedCourtMatches.length && (
            <details className="booking-panel__unassigned">
              <summary>Mecze bez kortu ({unassignedCourtMatches.length})</summary>
              {unassignedCourtMatches.map((match) => (
                <button key={match.id} type="button" className="button-secondary" onClick={() => setSelectedOccupancyMatchId(match.id)}>
                  {match.playerOne} – {match.playerTwo} · {formatWarsawDateTime(match.scheduledAt)}
                </button>
              ))}
            </details>
          )}

          {activeCourts.length ? <div className="court-occupancy" role="region" aria-label="Siatka zajętości kortów" tabIndex={0}>
            <div
              className="court-occupancy__grid"
              style={{ gridTemplateColumns: `148px repeat(${occupancySlots.length}, minmax(42px, 1fr))` }}
            >
              <div className="court-occupancy__corner">Kort</div>
              {occupancySlots.map((slot) => (
                <div key={slot} className="court-occupancy__time">{formatSlotLabel(slot)}</div>
              ))}

              {occupancyRows.flatMap((row) => ([
                <div key={`${row.court.id}-name`} className="court-occupancy__court">
                  <strong>{row.court.name}</strong>
                  <span>{row.court.openingTime} - {row.court.closingTime}</span>
                </div>,
                ...row.slots.map((slot, index) => {
                  const time = formatSlotLabel(occupancySlots[index]);
                  const bookable = slot.type === "free" && availableTimesByCourt.get(row.court.id)?.includes(time);
                  const booking = slot.match;
                  const label = `${row.court.name}, ${time}: ${slot.type === "free" && !bookable ? "mniej niż 90 minut bez rezerwacji" : slot.label}`;
                  const slotClass = `court-slot court-slot--${slot.type}${booking?.id === selectedOccupancyMatchId ? " court-slot--selected" : ""}${bookable && row.court.id === matchForm.courtId && selectedMatchTime === time ? " court-slot--free-selected" : ""}`;
                  const key = `${row.court.id}-${time}`;
                  return bookable || booking ? (
                    <button
                      key={key}
                      type="button"
                      className={slotClass}
                      aria-label={label}
                      title={label}
                      onClick={() => booking ? setSelectedOccupancyMatchId(booking.id) : applyFreeSlotToMatchForm(row.court.id, time)}
                    >
                      {slot.type === "busy" ? "●" : slot.type === "tentative" ? "◐" : null}
                    </button>
                  ) : <div key={key} className={slotClass} title={label} />;
                }),
              ]))}
            </div>
          </div> : <p>Brak aktywnych kortów.</p>}

          {selectedOccupancyMatch ? (
            <div className="occupancy-selection">
              <strong>{selectedOccupancyMatch.playerOne} vs {selectedOccupancyMatch.playerTwo}</strong>
              <span>
                {formatWarsawDateTime(selectedOccupancyMatch.scheduledAt)} • {selectedOccupancyMatch.courtName || "Bez kortu"}
              </span>
              <span>Status: {selectedOccupancyMatch.status}</span>
              <span>{selectedOccupancyMatch.season} · {selectedOccupancyMatch.league}</span>
              <div className="table-actions">
                <button type="button" className="button-secondary" onClick={() => startEdit(selectedOccupancyMatch)}>Edytuj</button>
                <button type="button" className="button-danger" disabled={isPending} onClick={() => requestDelete(selectedOccupancyMatch.id)}>Usuń</button>
              </div>
            </div>
          ) : (
            <p className="scheduler-hint">Kliknij wolny slot, aby wybrać termin, lub zajęty, aby zobaczyć mecz.</p>
          )}
        </section>

        <section className="panel-card" id="scheduler-match-form">
          <div className="panel-card__header">
            <div>
              <h2>{editingMatchId ? "Edytuj mecz" : "Nowy mecz"}</h2>
              <p>{new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeZone: APP_TIME_ZONE }).format(toWarsawDate(occupancyDate, "12:00"))}</p>
            </div>
          </div>

          <form className="scheduler-form" onSubmit={handleSubmit}>
            <label>
              Liga
              <select value={activeLeagueId} onChange={(event) => changeFilter("league", event.target.value)} required>
                <option value="">Wybierz ligę</option>
                {leagueOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Gracz 1
              <select value={selectedOne?.key || ""} onChange={(event) => selectPlayer("one", event.target.value)} required>
                <option value="">Wybierz gracza</option>
                {filteredPlayers.filter((p) => p.key !== selectedTwo?.key).map((p) => (
                  <option key={p.key} value={p.key}>{p.fullName}</option>
                ))}
              </select>
            </label>
            <label>
              Gracz 2
              <select value={selectedTwo?.key || ""} onChange={(event) => selectPlayer("two", event.target.value)} required>
                <option value="">Wybierz gracza</option>
                {filteredPlayers.filter((p) => p.key !== selectedOne?.key).map((p) => {
                  const played = isPlayedOpponent(selectedOne, p);
                  return <option key={p.key} value={p.key} disabled={played}>{p.fullName}{played ? " — już grali" : ""}</option>;
                })}
              </select>
            </label>
            {rosterLoading && <p className="scheduler-hint" role="status">Ładowanie graczy ligi…</p>}
            {!rosterLoading && !rosterError && activeSeasonId && activeLeagueId && !filteredPlayers.length && (
              <p className="scheduler-hint">Brak graczy w tym sezonie i lidze. Sprawdź <Link href="/baza-zawodnikow">bazę zawodników</Link>.</p>
            )}
            <label>
              Kort
              <select
                value={matchForm.courtId}
                onChange={(event) => {
                  const court = activeCourts.find((entry) => entry.id === event.target.value);
                  setMatchForm((current) => ({
                    ...current,
                    courtId: event.target.value,
                    location: court?.location || "",
                  }));
                }}
              >
                <option value="">Wybierz kort</option>
                {activeCourts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name} ({court.openingTime}-{court.closingTime})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Godzina
              <select
                value={selectedMatchTime}
                onChange={(event) =>
                  setMatchTime(event.target.value)
                }
                disabled={!selectedCourt}
                required
              >
                <option value="">{selectedCourt ? "Wybierz godzinę" : "Najpierw wybierz kort"}</option>
                {availableMatchTimeOptions.map((timeOption) => (
                  <option key={timeOption} value={timeOption}>
                    {timeOption}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={matchForm.status}
                onChange={(event) =>
                  setMatchForm((current) => ({ ...current, status: event.target.value as ScheduledMatchPayload["status"] }))
                }
              >
                {SCHEDULED_MATCH_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="submit" disabled={isPending || !canSaveMatch}>
                {editingMatchId ? "Zapisz zmiany" : "Dodaj mecz"}
              </button>
              {editingMatchId ? (
                <button type="button" className="button-secondary" onClick={resetMatchForm} disabled={isPending}>
                  Anuluj edycję
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
      <DayPlanPanel
        key={`plan:${activeSeasonId}`}
        seasonId={activeSeasonId}
        season={activeSeasonLabel}
        day={occupancyDate}
        snapshot={overview}
        onDateChange={changeDate}
        onRefresh={loadOverview}
        onLocateMatches={setLocatedMatchIds}
        onDelete={requestDelete}
      />
      <LeagueMatchesTable
        key={activeSeasonId}
        rows={allMatchRows}
        locatedMatchIds={locatedMatchIds}
        loading={seasonResultsLoading}
        resultsError={seasonResultsError}
        busy={isPending}
        smsStatuses={overview.smsStatuses}
        onRefresh={async () => { await loadOverview(); }}
        onEdit={(match) => {
          startEdit(match);
          document.getElementById("scheduler-match-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        onDelete={requestDelete}
      />
      {matchToDelete && (
        <dialog
          ref={deleteDialog}
          className="match-sms-dialog match-delete-dialog"
          aria-labelledby="match-delete-title"
          aria-describedby="match-delete-details"
          onCancel={(event) => { if (isPending) event.preventDefault(); }}
          onClose={() => setMatchToDelete(null)}
        >
          <h2 id="match-delete-title">Usunąć mecz?</h2>
          <p id="match-delete-details">
            <strong>{matchToDelete.playerOne} – {matchToDelete.playerTwo}</strong>
            <span>{formatWarsawDateTime(matchToDelete.scheduledAt)}{matchToDelete.courtName ? ` · ${matchToDelete.courtName}` : ""}</span>
          </p>
          {deleteError && <p className="form-message form-message--error" role="alert">{deleteError}</p>}
          <div className="form-actions">
            <button type="button" autoFocus className="button-secondary" disabled={isPending} onClick={() => deleteDialog.current?.close()}>Anuluj</button>
            <button type="button" className="button-danger" disabled={isPending} onClick={confirmDelete}>{isPending ? "Usuwanie…" : "Usuń mecz"}</button>
          </div>
        </dialog>
      )}
    </div>
  );
}
