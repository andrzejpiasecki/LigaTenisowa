"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type CourtPayload,
  type RemainingPair,
  SCHEDULED_MATCH_STATUSES,
  type SchedulerOverview,
  type ScheduledMatch,
  type ScheduledMatchPayload,
} from "@/lib/scheduled-matches";

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

const EMPTY_COURT_FORM: CourtPayload = {
  name: "",
  location: "",
  openingTime: "07:00",
  closingTime: "22:00",
  isActive: true,
  notes: "",
};

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
    hour12: false,
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
    hour12: false,
  }).format(new Date(isoValue));
}

export function SchedulerAdmin() {
  const [overview, setOverview] = useState<SchedulerOverview>({
    matches: [],
    inboundSms: [],
    players: [],
    courts: [],
    availabilities: [],
    history: [],
    proposals: [],
  });
  const [seasonOptions, setSeasonOptions] = useState<SchedulerFilterOption[]>([]);
  const [leagueOptions, setLeagueOptions] = useState<SchedulerFilterOption[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState("");
  const [activeLeagueId, setActiveLeagueId] = useState("");
  const [remainingPairs, setRemainingPairs] = useState<RemainingPair[]>([]);
  const [matchForm, setMatchForm] = useState<ScheduledMatchPayload>(EMPTY_MATCH_FORM);
  const [matchDate, setMatchDate] = useState(() => toDateInputValue());
  const [matchTime, setMatchTime] = useState("");
  const [courtForm, setCourtForm] = useState<CourtPayload>(EMPTY_COURT_FORM);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [occupancyDate, setOccupancyDate] = useState(() => toDateInputValue());
  const [selectedOccupancyMatchId, setSelectedOccupancyMatchId] = useState<string | null>(null);
  const [selectedFreeSlotKey, setSelectedFreeSlotKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  async function loadOverview() {
    const response = await fetch("/api/scheduler/overview", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nie udało się pobrać danych modułu.");
    }

    setOverview(payload);
  }

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
  }

  async function loadRemainingPairs(seasonId: string, leagueId: string) {
    if (!seasonId || !leagueId) {
      setRemainingPairs([]);
      return;
    }

    const params = new URLSearchParams({ seasonId, leagueId });
    const response = await fetch(`/api/scheduler/remaining-pairs?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nie udało się pobrać par pozostałych do rozegrania.");
    }

    setRemainingPairs(payload.pairs || []);
  }

  useEffect(() => {
    startTransition(() => {
      Promise.all([loadOverview(), loadOptions()]).catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać danych modułu.");
      });
    });
  }, []);

  useEffect(() => {
    startTransition(() => {
      loadRemainingPairs(activeSeasonId, activeLeagueId).catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać par pozostałych do rozegrania.");
      });
    });
  }, [activeSeasonId, activeLeagueId]);

  const activeSeasonLabel = seasonOptions.find((option) => option.value === activeSeasonId)?.label || "";
  const activeLeagueLabel = leagueOptions.find((option) => option.value === activeLeagueId)?.label || "";

  const filteredPlayers = useMemo(
    () =>
      overview.players.filter((player) => {
        const seasonOk = !activeSeasonLabel || !player.season || player.season === activeSeasonLabel;
        const leagueOk = !activeLeagueLabel || !player.league || player.league === activeLeagueLabel;
        return seasonOk && leagueOk;
      }),
    [activeLeagueLabel, activeSeasonLabel, overview.players],
  );

  const playersById = useMemo(
    () => new Map(filteredPlayers.map((player) => [player.id, player])),
    [filteredPlayers],
  );

  const filteredMatches = useMemo(
    () =>
      overview.matches.filter((match) => {
        return (!activeSeasonLabel || match.season === activeSeasonLabel) && (!activeLeagueLabel || match.league === activeLeagueLabel);
      }),
    [activeLeagueLabel, activeSeasonLabel, overview.matches],
  );

  const activePairKeys = useMemo(
    () =>
      new Set(
        filteredMatches
          .filter((match) => match.status !== "anulowany" && match.status !== "rozegrany")
          .map((match) => [match.playerOne, match.playerTwo].map((value) => value.trim().toUpperCase()).sort().join("::")),
      ),
    [filteredMatches],
  );

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
  const selectedMatchDate = matchDate;
  const selectedMatchTime = matchTime;

  const occupancySlots = useMemo(() => {
    if (!activeCourts.length) {
      return [] as number[];
    }

    const earliest = Math.min(...activeCourts.map((court) => toMinutes(court.openingTime)));
    const latest = Math.max(...activeCourts.map((court) => toMinutes(court.closingTime)));
    const slots: number[] = [];

    for (let minutes = earliest; minutes < latest; minutes += SLOT_MINUTES) {
      slots.push(minutes);
    }

    return slots;
  }, [activeCourts]);

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

  const availableMatchTimeOptions = useMemo(() => {
    if (!selectedCourt || !selectedMatchDate) {
      return [] as string[];
    }

    const openAt = toMinutes(selectedCourt.openingTime);
    const closeAt = toMinutes(selectedCourt.closingTime);
      const relevantMatches = occupancyMatches.filter((match) => {
        if (match.courtId !== selectedCourt.id || match.id === editingMatchId) {
          return false;
        }

        const localValue = toLocalDateTimeInput(match.scheduledAt);
        return getLocalDatePart(localValue) === selectedMatchDate;
      });

    const options: string[] = [];

    for (let slotStart = openAt; slotStart + MATCH_DURATION_MINUTES <= closeAt; slotStart += SLOT_MINUTES) {
      const candidateStart = toWarsawDate(selectedMatchDate, formatSlotLabel(slotStart));
      const candidateEnd = new Date(candidateStart.getTime() + MATCH_DURATION_MINUTES * 60 * 1000);
      const blocked = relevantMatches.some((match) => {
        const matchStart = new Date(match.scheduledAt);
        const matchEnd = new Date(matchStart.getTime() + MATCH_DURATION_MINUTES * 60 * 1000);
        return matchStart < candidateEnd && matchEnd > candidateStart;
      });

      if (!blocked) {
        options.push(formatSlotLabel(slotStart));
      }
    }

    return options;
  }, [editingMatchId, occupancyMatches, selectedCourt, selectedMatchDate]);

  useEffect(() => {
    if (!selectedMatchTime) {
      return;
    }

    if (availableMatchTimeOptions.includes(selectedMatchTime)) {
      return;
    }

    setMatchForm((current) => ({
      ...current,
      scheduledAt: "",
    }));
    setMatchTime("");
  }, [availableMatchTimeOptions, selectedMatchDate, selectedMatchTime]);

  function resetMatchForm() {
    setEditingMatchId(null);
    setMatchForm(EMPTY_MATCH_FORM);
    setMatchDate(toDateInputValue());
    setMatchTime("");
  }

  function resetCourtForm() {
    setCourtForm(EMPTY_COURT_FORM);
  }

  function scheduleRemainingPair(pair: RemainingPair) {
    const playerOne = pair.playerOneId ? playersById.get(pair.playerOneId) : null;
    const playerTwo = pair.playerTwoId ? playersById.get(pair.playerTwoId) : null;

    setMatchForm({
      season: activeSeasonLabel,
      league: activeLeagueLabel,
      playerOneId: playerOne?.id || "",
      playerOne: playerOne?.fullName || pair.playerOneName,
      playerOnePhone: playerOne?.phone || "",
      playerTwoId: playerTwo?.id || "",
      playerTwo: playerTwo?.fullName || pair.playerTwoName,
      playerTwoPhone: playerTwo?.phone || "",
      courtId: "",
      scheduledAt: "",
      location: "",
      status: "propozycja",
      adminNotes: pair.isMapped ? "" : "Uzupełnij mapowanie zawodnika w bazie zawodników.",
    });
    setMatchDate(toDateInputValue());
    setMatchTime("");
    setEditingMatchId(null);
  }

  function applyFreeSlotToMatchForm(courtId: string, date: string, time: string) {
    const court = activeCourts.find((entry) => entry.id === courtId);
    setSelectedOccupancyMatchId(null);
    setSelectedFreeSlotKey(`${courtId}:${date}:${time}`);
    setMatchDate(date);
    setMatchTime(time);
    setMatchForm((current) => ({
      ...current,
      courtId,
      location: court?.location || current.location,
    }));
  }

  function startEdit(match: ScheduledMatch) {
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
    setMatchDate(getLocalDatePart(toLocalDateTimeInput(match.scheduledAt)) || toDateInputValue());
    setMatchTime(getLocalTimePart(toLocalDateTimeInput(match.scheduledAt)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const payload = {
      ...matchForm,
      season: activeSeasonLabel,
      league: activeLeagueLabel,
      scheduledAt: toIsoDateTime(combineLocalDateTime(matchDate, matchTime)),
    };

    const method = editingMatchId ? "PATCH" : "POST";
    const url = editingMatchId ? `/api/scheduled-matches/${editingMatchId}` : "/api/scheduled-matches";

    startTransition(() => {
      fetch(url, {
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
          await loadRemainingPairs(activeSeasonId, activeLeagueId);
          resetMatchForm();
          setSuccess(editingMatchId ? "Mecz został zaktualizowany." : "Mecz został dodany.");
        })
        .catch((submitError: unknown) => {
          setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać meczu.");
        });
    });
  }

  async function handleCourtSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch("/api/courts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(courtForm),
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Nie udało się dodać kortu.");
          }

          await loadOverview();
          resetCourtForm();
          setSuccess("Kort został dodany.");
        })
        .catch((submitError: unknown) => {
          setError(submitError instanceof Error ? submitError.message : "Nie udało się dodać kortu.");
        });
    });
  }

  function handleDelete(id: string) {
    setError("");
    setSuccess("");

    startTransition(() => {
      fetch(`/api/scheduled-matches/${id}`, { method: "DELETE" })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Nie udało się usunąć meczu.");
          }

          await loadOverview();
          await loadRemainingPairs(activeSeasonId, activeLeagueId);
          if (editingMatchId === id) {
            resetMatchForm();
          }
          setSuccess("Mecz został usunięty.");
        })
        .catch((deleteError: unknown) => {
          setError(deleteError instanceof Error ? deleteError.message : "Nie udało się usunąć meczu.");
        });
    });
  }

  return (
    <div className="scheduler-layout">
      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Filtr rozgrywek</h2>
            <p>Ten filtr steruje całym ekranem umawiania meczów.</p>
          </div>
        </div>

        <div className="scheduler-form">
          <label>
            Sezon
            <select value={activeSeasonId} onChange={(event) => setActiveSeasonId(event.target.value)}>
              <option value="">Wybierz sezon</option>
              {seasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Liga
            <select value={activeLeagueId} onChange={(event) => setActiveLeagueId(event.target.value)}>
              <option value="">Wybierz ligę</option>
              {leagueOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="form-message form-message--error">{error}</p> : null}
        {success ? <p className="form-message form-message--success">{success}</p> : null}
      </section>

      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Zajętość kortów</h2>
            <p>Globalny widok dzienny wszystkich rezerwacji kortów. Pomarańczowy oznacza propozycję, czerwony twardą rezerwację. Mecz zajmuje 3 sloty.</p>
          </div>
          <label className="scheduler-inline-filter">
            Dzień
            <input type="date" value={occupancyDate} onChange={(event) => setOccupancyDate(event.target.value)} />
          </label>
        </div>

        {unassignedCourtMatches.length ? (
          <p className="form-message form-message--error">
            {unassignedCourtMatches.length} mecze na ten dzień nie mają przypisanego kortu, więc nie pojawią się w siatce zajętości.
          </p>
        ) : null}

        <div className="court-occupancy">
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
              ...row.slots.map((slot, index) => (
                <div
                  key={`${row.court.id}-${occupancySlots[index]}`}
                  className={`court-slot court-slot--${slot.type}${
                    slot.match?.id && slot.match.id === selectedOccupancyMatchId ? " court-slot--selected" : ""
                  }${
                    slot.type === "free" && selectedFreeSlotKey === `${row.court.id}:${occupancyDate}:${formatSlotLabel(occupancySlots[index])}`
                      ? " court-slot--free-selected"
                      : ""
                  }`}
                  title={slot.match ? `${slot.label} • ${formatWarsawDateTime(slot.match.scheduledAt)}` : slot.label}
                  role={slot.type !== "closed" ? "button" : undefined}
                  tabIndex={slot.type !== "closed" ? 0 : -1}
                  onClick={slot.type === "free"
                    ? () => applyFreeSlotToMatchForm(row.court.id, occupancyDate, formatSlotLabel(occupancySlots[index]))
                    : slot.match
                      ? () => setSelectedOccupancyMatchId(slot.match.id)
                      : undefined}
                  onKeyDown={slot.type !== "closed" ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (slot.type === "free") {
                        applyFreeSlotToMatchForm(row.court.id, occupancyDate, formatSlotLabel(occupancySlots[index]));
                        return;
                      }
                      if (slot.match) {
                        setSelectedOccupancyMatchId(slot.match.id);
                      }
                    }
                  } : undefined}
                >
                  {slot.type === "busy" ? "●" : null}
                  {slot.type === "tentative" ? "◐" : null}
                </div>
              )),
            ]))}
          </div>
        </div>

        {selectedOccupancyMatch ? (
          <div className="occupancy-selection">
            <strong>{selectedOccupancyMatch.playerOne} vs {selectedOccupancyMatch.playerTwo}</strong>
            <span>
              {formatWarsawDateTime(selectedOccupancyMatch.scheduledAt)} • {selectedOccupancyMatch.courtName || "Bez kortu"}
            </span>
            <span>Status: {selectedOccupancyMatch.status}</span>
            <span>Miejsce: {selectedOccupancyMatch.location || "Bez miejsca"}</span>
          </div>
        ) : (
          <p className="scheduler-hint">Kliknij zajęty slot, aby zobaczyć kto zarezerwował kort.</p>
        )}
      </section>

      <div className="scheduler-main-grid">
        <section className="panel-card">
          <div className="panel-card__header">
            <div>
              <h2>Pary pozostałe do rozegrania</h2>
              <p>Lista dla wybranego sezonu i ligi. Kliknięcie w parę podstawia ją do formularza.</p>
            </div>
          </div>

          <div className="scheduler-table-wrap">
            <table className="scheduler-table">
              <thead>
                <tr>
                  <th>Para</th>
                  <th>Mapowanie</th>
                  <th>Akcja</th>
                </tr>
              </thead>
              <tbody>
                {remainingPairs.length ? (
                  remainingPairs.map((pair) => {
                    const pairKey = [pair.playerOneName, pair.playerTwoName]
                      .map((value) => value.trim().toUpperCase())
                      .sort()
                      .join("::");
                    const hasActiveMatch = activePairKeys.has(pairKey);

                    return (
                      <tr key={`${pair.playerOneName}:${pair.playerTwoName}`}>
                      <td>
                        <strong>{pair.playerOneName} vs {pair.playerTwoName}</strong>
                      </td>
                      <td>
                        <span className={`status-pill ${
                          hasActiveMatch ? "status-pill--propozycja" : pair.isMapped ? "status-pill--potwierdzony" : "status-pill--oczekuje"
                        }`}>
                          {hasActiveMatch ? "już umówione" : pair.isMapped ? "gotowe" : "brak mapowania"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button-primary"
                          onClick={() => scheduleRemainingPair(pair)}
                          disabled={hasActiveMatch}
                        >
                          Umów mecz
                        </button>
                      </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="empty-cell">Brak par do rozegrania dla wybranego filtra.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-card__header">
            <div>
              <h2>{editingMatchId ? "Edytuj mecz" : "Nowy mecz"}</h2>
              <p>Terminy są ustawiane co 30 minut. Kort automatycznie podpowiada lokalizację.</p>
            </div>
          </div>

          <form className="scheduler-form" onSubmit={handleSubmit}>
            <label>
              Sezon
              <select value={activeSeasonId} onChange={(event) => setActiveSeasonId(event.target.value)}>
                <option value="">Wybierz sezon</option>
                {seasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Liga
              <select value={activeLeagueId} onChange={(event) => setActiveLeagueId(event.target.value)}>
                <option value="">Wybierz ligę</option>
                {leagueOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gracz 1
              <input value={matchForm.playerOne} readOnly />
            </label>
            <label>
              Gracz 2
              <input value={matchForm.playerTwo} readOnly />
            </label>
            <label>
              Data
              <input
                type="date"
                value={selectedMatchDate}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  setMatchDate(nextDate);
                }}
                required
              />
            </label>
            <label>
              Kort
              <select
                value={matchForm.courtId}
                onChange={(event) => {
                  const court = activeCourts.find((entry) => entry.id === event.target.value);
                  setMatchForm((current) => ({
                    ...current,
                    courtId: event.target.value,
                    location: court?.location || current.location,
                  }));
                }}
              >
                <option value="">Bez kortu</option>
                {activeCourts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name} ({court.openingTime}-{court.closingTime})
                  </option>
                ))}
              </select>
            </label>
            {!matchForm.courtId ? (
              <p className="scheduler-hint">Bez wybranego kortu mecz nie pojawi się w widoku zajętości kortów.</p>
            ) : null}
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
            {selectedCourt ? (
              <p className="scheduler-hint">
                Pokazuję tylko wolne sloty co 30 minut. Propozycje i rezerwacje blokują wybór godziny na {selectedCourt.name}.
              </p>
            ) : null}
            <label>
              Miejsce
              <input
                value={matchForm.location}
                onChange={(event) => setMatchForm((current) => ({ ...current, location: event.target.value }))}
              />
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
            <label className="scheduler-form__notes">
              Notatki admina
              <textarea
                rows={4}
                value={matchForm.adminNotes}
                onChange={(event) => setMatchForm((current) => ({ ...current, adminNotes: event.target.value }))}
              />
            </label>

            <div className="form-actions">
              <button type="submit" disabled={isPending || !matchForm.playerOne || !matchForm.playerTwo || !matchForm.courtId || !selectedMatchTime}>
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

      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Zaplanowane mecze</h2>
            <p>{isPending ? "Odświeżanie..." : `${filteredMatches.length} wpisów dla wybranego filtra`}</p>
          </div>
        </div>

        <div className="scheduler-table-wrap">
          <table className="scheduler-table">
            <thead>
              <tr>
                <th>Termin</th>
                <th>Mecz</th>
                <th>Status</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.length ? (
                filteredMatches.map((match) => (
                  <tr key={match.id}>
                    <td>{formatWarsawDateTime(match.scheduledAt)}</td>
                    <td>
                      <strong>{match.playerOne} vs {match.playerTwo}</strong>
                      <div className="table-subtext">
                        {match.courtName ? `${match.courtName} • ` : "Bez kortu • "}
                        {match.location || "Bez miejsca"}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill status-pill--${match.status}`}>{match.status}</span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button type="button" className="button-secondary" onClick={() => startEdit(match)}>
                          Edytuj
                        </button>
                        <button type="button" className="button-danger" onClick={() => handleDelete(match.id)}>
                          Usuń
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-cell">Brak meczów dla wybranego filtra.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-card__header">
          <div>
            <h2>Korty</h2>
            <p>Ustawienia kortów i godzin otwarcia. To jest rzadziej używana sekcja administracyjna.</p>
          </div>
        </div>

        <form className="scheduler-form" onSubmit={handleCourtSubmit}>
          <label>
            Nazwa kortu
            <input
              value={courtForm.name}
              onChange={(event) => setCourtForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            Lokalizacja
            <input
              value={courtForm.location}
              onChange={(event) => setCourtForm((current) => ({ ...current, location: event.target.value }))}
            />
          </label>
          <label>
            Otwarcie
            <input
              type="time"
              step={1800}
              value={courtForm.openingTime}
              onChange={(event) => setCourtForm((current) => ({ ...current, openingTime: event.target.value }))}
              required
            />
          </label>
          <label>
            Zamknięcie
            <input
              type="time"
              step={1800}
              value={courtForm.closingTime}
              onChange={(event) => setCourtForm((current) => ({ ...current, closingTime: event.target.value }))}
              required
            />
          </label>
          <label className="scheduler-form__notes">
            Notatki
            <textarea
              rows={3}
              value={courtForm.notes}
              onChange={(event) => setCourtForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>

          <div className="form-actions">
            <button type="submit" disabled={isPending}>Dodaj kort</button>
          </div>
        </form>

        <div className="scheduler-table-wrap">
          <table className="scheduler-table">
            <thead>
              <tr>
                <th>Kort</th>
                <th>Godziny</th>
                <th>Lokalizacja</th>
              </tr>
            </thead>
            <tbody>
              {activeCourts.length ? (
                activeCourts.map((court) => (
                  <tr key={court.id}>
                    <td><strong>{court.name}</strong></td>
                    <td>{court.openingTime} - {court.closingTime}</td>
                    <td>{court.location || "Bez lokalizacji"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="empty-cell">Brak aktywnych kortów.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
