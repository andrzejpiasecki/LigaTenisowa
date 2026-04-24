import { type InboundSmsAvailabilityStatus } from "@/lib/scheduled-matches";

type ParsedSmsAvailability = {
  availability: InboundSmsAvailabilityStatus;
  summary: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  inactiveUntil: string;
};

const WEEKDAY_NAMES = new Map([
  ["poniedzialek", 1],
  ["pon", 1],
  ["wtorek", 2],
  ["wt", 2],
  ["sroda", 3],
  ["środa", 3],
  ["sr", 3],
  ["śr", 3],
  ["czwartek", 4],
  ["czw", 4],
  ["piatek", 5],
  ["piątek", 5],
  ["pt", 5],
  ["sobota", 6],
  ["sob", 6],
  ["niedziela", 0],
  ["nd", 0],
]);

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAvailability(text: string): InboundSmsAvailabilityStatus {
  const unavailablePatterns = [
    /\bnie moge\b/,
    /\bnie dam rady\b/,
    /\bnie pasuje\b/,
    /\bodpada\b/,
    /\bzajet[ya]\b/,
    /\bniedostepn/,
  ];

  if (unavailablePatterns.some((pattern) => pattern.test(text))) {
    return "niedostepny";
  }

  const proposalPatterns = [
    /\bmoze\b/,
    /\bmoge po\b/,
    /\bod \d{1,2}[:.]\d{2}\b/,
    /\bnajlepiej\b/,
    /\bproponu(j|e)\b/,
    /\bpasuje mi\b/,
  ];

  if (proposalPatterns.some((pattern) => pattern.test(text))) {
    return "propozycja";
  }

  const availablePatterns = [
    /\bmoge\b/,
    /\bpasuje\b/,
    /\bdostepn/,
    /\bwoln[ya]\b/,
    /\bbede mogl\b/,
    /\bbede mogla\b/,
  ];

  if (availablePatterns.some((pattern) => pattern.test(text))) {
    return "dostepny";
  }

  return "niejasne";
}

function detectReason(text: string) {
  if (/\bkontuzj|\bzlam|\bzłam|\buraz|\bnoga|\breka|\bręka/.test(text)) {
    return "kontuzja";
  }

  if (/\bpraca|\bdelegac|\bwyjazd/.test(text)) {
    return "praca lub wyjazd";
  }

  if (/\bchor|\bgoracz|\bgorącz/.test(text)) {
    return "choroba";
  }

  return "";
}

function parseInactiveUntil(text: string, receivedAt: Date) {
  if (/\bprzez miesiac\b|\bprzez miesiąc\b/.test(text)) {
    const date = new Date(receivedAt);
    date.setDate(date.getDate() + 30);
    return date.toISOString();
  }

  const weekMatch = text.match(/\bprzez (\d+) tyg/);
  if (weekMatch) {
    const date = new Date(receivedAt);
    date.setDate(date.getDate() + Number(weekMatch[1]) * 7);
    return date.toISOString();
  }

  const dayMatch = text.match(/\bprzez (\d+) dni/);
  if (dayMatch) {
    const date = new Date(receivedAt);
    date.setDate(date.getDate() + Number(dayMatch[1]));
    return date.toISOString();
  }

  return "";
}

function parseClock(text: string) {
  const match = text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function findUpcomingWeekday(baseDate: Date, targetDay: number) {
  const result = new Date(baseDate);
  const currentDay = result.getDay();
  let diff = targetDay - currentDay;

  if (diff < 0) {
    diff += 7;
  }

  result.setDate(result.getDate() + diff);
  return result;
}

function parseDateTime(text: string, receivedAt: Date) {
  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const date = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
    return applyTime(date, parseClock(text));
  }

  const shortDateMatch = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?\b/);
  if (shortDateMatch) {
    const year = shortDateMatch[3] ? Number(shortDateMatch[3]) : receivedAt.getFullYear();
    const date = new Date(year, Number(shortDateMatch[2]) - 1, Number(shortDateMatch[1]));
    return applyTime(date, parseClock(text));
  }

  for (const [weekdayName, weekday] of WEEKDAY_NAMES.entries()) {
    if (text.includes(weekdayName)) {
      return applyTime(findUpcomingWeekday(receivedAt, weekday), parseClock(text));
    }
  }

  const relativeOffset =
    (text.includes("jutro") && 1)
    || (text.includes("dzis") && 0)
    || (text.includes("dzisiaj") && 0)
    || null;

  if (relativeOffset !== null) {
    const date = new Date(receivedAt);
    date.setDate(date.getDate() + relativeOffset);
    return applyTime(date, parseClock(text));
  }

  return null;
}

function applyTime(baseDate: Date, time: { hours: number; minutes: number } | null) {
  const result = new Date(baseDate);
  result.setSeconds(0, 0);
  if (time) {
    result.setHours(time.hours, time.minutes, 0, 0);
  } else {
    result.setHours(12, 0, 0, 0);
  }

  return result.toISOString();
}

function buildSummary(text: string, availability: InboundSmsAvailabilityStatus, startsAt: string) {
  const labels: Record<InboundSmsAvailabilityStatus, string> = {
    dostepny: "Zawodnik deklaruje dostępność",
    niedostepny: "Zawodnik deklaruje brak dostępności",
    propozycja: "Zawodnik proponuje lub zawęża termin",
    niejasne: "Treść wymaga ręcznej interpretacji",
  };

  if (!startsAt) {
    return labels[availability];
  }

  const dateText = new Date(startsAt).toLocaleString("pl-PL");
  return `${labels[availability]}: ${dateText}`;
}

export function parseSmsAvailability(body: string, receivedAtInput?: string | Date): ParsedSmsAvailability {
  const normalized = normalizeText(body);
  const receivedAt = receivedAtInput ? new Date(receivedAtInput) : new Date();
  const availability = detectAvailability(normalized);
  const startsAt = parseDateTime(normalized, receivedAt) || "";
  const endsAt = "";
  const reason = detectReason(normalized);
  const inactiveUntil = reason ? parseInactiveUntil(normalized, receivedAt) : "";
  const summary = buildSummary(normalized, availability, startsAt);

  return {
    availability,
    summary,
    startsAt,
    endsAt,
    reason,
    inactiveUntil,
  };
}
