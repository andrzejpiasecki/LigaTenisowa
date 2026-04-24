export const SCHEDULED_MATCH_STATUSES = [
  "propozycja",
  "oczekuje",
  "potwierdzony",
  "anulowany",
  "rozegrany",
] as const;

export type ScheduledMatchStatus = (typeof SCHEDULED_MATCH_STATUSES)[number];

export type ScheduledMatch = {
  id: string;
  season: string;
  league: string;
  playerOneId: string;
  playerOne: string;
  playerOnePhone: string;
  playerTwoId: string;
  playerTwo: string;
  playerTwoPhone: string;
  courtId: string;
  courtName: string;
  scheduledAt: string;
  location: string;
  status: ScheduledMatchStatus;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type ScheduledMatchPayload = {
  season: string;
  league: string;
  playerOneId: string;
  playerOne: string;
  playerOnePhone: string;
  playerTwoId: string;
  playerTwo: string;
  playerTwoPhone: string;
  courtId: string;
  scheduledAt: string;
  location: string;
  status: ScheduledMatchStatus;
  adminNotes: string;
};

export const INBOUND_SMS_AVAILABILITY_STATUSES = [
  "dostepny",
  "niedostepny",
  "propozycja",
  "niejasne",
] as const;

export type InboundSmsAvailabilityStatus = (typeof INBOUND_SMS_AVAILABILITY_STATUSES)[number];

export type InboundSms = {
  id: string;
  provider: string;
  externalId: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  matchedPlayer: string;
  matchedPlayerId: string;
  parsedSummary: string;
  parsedAvailability: InboundSmsAvailabilityStatus;
  parsedStartsAt: string;
  parsedEndsAt: string;
  parsedReason: string;
  parsedInactiveUntil: string;
  receivedAt: string;
  createdAt: string;
  scheduledMatchId: string;
};

export type PlayerStatus = "aktywny" | "nieaktywny";
export type AvailabilityKind = "dostepny" | "niedostepny";
export type AvailabilitySource = "sms" | "reczne" | "ai" | "system";
export type MatchProposalStatus = "draft" | "accepted" | "rejected";

export type Player = {
  id: string;
  fullName: string;
  phone: string;
  league: string;
  season: string;
  resultsPlayerId: string;
  resultsPlayerName: string;
  skillLevel: number;
  preferences: string;
  status: PlayerStatus;
  inactiveUntil: string;
  notes: string;
};

export type PlayerPayload = {
  fullName: string;
  phone: string;
  league: string;
  season: string;
  skillLevel: number;
  preferences: string;
  status: PlayerStatus;
  inactiveUntil: string;
  notes: string;
};

export type PlayerResultsLinkPayload = {
  resultsPlayerId: string;
  resultsPlayerName: string;
};

export type PlayerProfileUpdatePayload = {
  fullName: string;
  phone: string;
  league: string;
  season: string;
  status: PlayerStatus;
};

export type ResultsDirectoryEntry = {
  id: string;
  name: string;
  normalizedName: string;
};

export type PlayerResultsMatch = {
  player: Player;
  linkedEntry: ResultsDirectoryEntry | null;
  suggestedEntry: ResultsDirectoryEntry | null;
  suggestionScore: number;
};

export type Court = {
  id: string;
  name: string;
  location: string;
  openingTime: string;
  closingTime: string;
  isActive: boolean;
  notes: string;
};

export type CourtPayload = {
  name: string;
  location: string;
  openingTime: string;
  closingTime: string;
  isActive: boolean;
  notes: string;
};

export type PlayerAvailability = {
  id: string;
  playerId: string;
  kind: AvailabilityKind;
  source: AvailabilitySource;
  startsAt: string;
  endsAt: string;
  summary: string;
  inboundSmsId: string;
};

export type MatchHistory = {
  id: string;
  season: string;
  league: string;
  playerOneId: string;
  playerTwoId: string;
  courtId: string;
  playedAt: string;
  notes: string;
};

export type MatchProposal = {
  id: string;
  season: string;
  league: string;
  playerOneId: string;
  playerOneName: string;
  playerTwoId: string;
  playerTwoName: string;
  courtId: string;
  courtName: string;
  proposedStartsAt: string;
  proposedEndsAt: string;
  score: number;
  rationale: string;
  status: MatchProposalStatus;
  feedback: string;
  sourceSmsId: string;
};

export type SchedulerOverview = {
  matches: ScheduledMatch[];
  inboundSms: InboundSms[];
  players: Player[];
  courts: Court[];
  availabilities: PlayerAvailability[];
  history: MatchHistory[];
  proposals: MatchProposal[];
};

export type RemainingPair = {
  playerOneName: string;
  playerTwoName: string;
  playerOneId: string;
  playerTwoId: string;
  isMapped: boolean;
};

export function isScheduledMatchStatus(value: string): value is ScheduledMatchStatus {
  return SCHEDULED_MATCH_STATUSES.includes(value as ScheduledMatchStatus);
}

export function normalizeScheduledMatchPayload(payload: ScheduledMatchPayload) {
  const season = payload.season.trim();
  const league = payload.league.trim();
  const playerOneId = payload.playerOneId.trim();
  const playerOne = payload.playerOne.trim();
  const playerOnePhone = payload.playerOnePhone.trim();
  const playerTwoId = payload.playerTwoId.trim();
  const playerTwo = payload.playerTwo.trim();
  const playerTwoPhone = payload.playerTwoPhone.trim();
  const courtId = payload.courtId.trim();
  const location = payload.location.trim();
  const scheduledAt = payload.scheduledAt.trim();
  const adminNotes = payload.adminNotes.trim();

  if (!season || !league || !playerOne || !playerTwo || !scheduledAt) {
    throw new Error("Sezon, liga, obaj gracze i termin są wymagane.");
  }

  if (!courtId) {
    throw new Error("Wybór kortu jest wymagany.");
  }

  if (playerOne.localeCompare(playerTwo, "pl", { sensitivity: "base" }) === 0) {
    throw new Error("Gracze muszą być różni.");
  }

  if (Number.isNaN(Date.parse(scheduledAt))) {
    throw new Error("Termin meczu ma nieprawidłowy format.");
  }

  if (!isScheduledMatchStatus(payload.status)) {
    throw new Error("Nieprawidłowy status meczu.");
  }

  return {
    season,
    league,
    playerOneId,
    playerOne,
    playerOnePhone,
    playerTwoId,
    playerTwo,
    playerTwoPhone,
    courtId,
    scheduledAt,
    location,
    status: payload.status,
    adminNotes,
  };
}

export function normalizePlayerPayload(payload: PlayerPayload) {
  const fullName = payload.fullName.trim();
  const phone = payload.phone.trim();
  const league = payload.league.trim();
  const season = payload.season.trim();
  const preferences = payload.preferences.trim();
  const notes = payload.notes.trim();
  const inactiveUntil = payload.inactiveUntil.trim();
  const skillLevel = Number(payload.skillLevel);

  if (!fullName) {
    throw new Error("Imię i nazwisko jest wymagane.");
  }

  if (!Number.isFinite(skillLevel) || skillLevel < 1 || skillLevel > 10) {
    throw new Error("Poziom umiejętności musi być liczbą od 1 do 10.");
  }

  if (payload.status !== "aktywny" && payload.status !== "nieaktywny") {
    throw new Error("Nieprawidłowy status zawodnika.");
  }

  if (inactiveUntil && Number.isNaN(Date.parse(inactiveUntil))) {
    throw new Error("Data nieaktywności ma nieprawidłowy format.");
  }

  return {
    fullName,
    phone,
    league,
    season,
    skillLevel,
    preferences,
    status: payload.status,
    inactiveUntil,
    notes,
  };
}

export function normalizePlayerProfileUpdatePayload(payload: PlayerProfileUpdatePayload) {
  const fullName = payload.fullName.trim();
  const phone = payload.phone.trim();
  const league = payload.league.trim();
  const season = payload.season.trim();

  if (!fullName) {
    throw new Error("Imię i nazwisko jest wymagane.");
  }

  if (payload.status !== "aktywny" && payload.status !== "nieaktywny") {
    throw new Error("Nieprawidłowy status zawodnika.");
  }

  return {
    fullName,
    phone,
    league,
    season,
    status: payload.status,
  };
}

export function normalizeCourtPayload(payload: CourtPayload) {
  const name = payload.name.trim();
  const location = payload.location.trim();
  const openingTime = payload.openingTime.trim();
  const closingTime = payload.closingTime.trim();
  const notes = payload.notes.trim();

  if (!name) {
    throw new Error("Nazwa kortu jest wymagana.");
  }

  if (!/^\d{2}:\d{2}$/.test(openingTime) || !/^\d{2}:\d{2}$/.test(closingTime)) {
    throw new Error("Godziny otwarcia kortu muszą mieć format HH:MM.");
  }

  if (openingTime >= closingTime) {
    throw new Error("Godzina zamknięcia musi być późniejsza niż otwarcia.");
  }

  return {
    name,
    location,
    openingTime,
    closingTime,
    isActive: Boolean(payload.isActive),
    notes,
  };
}
