import { parseSmsAvailability } from "@/lib/sms-parser";
import { type ScheduledMatch } from "@/lib/scheduled-matches";

const OPENAI_SMS_MODEL = process.env.OPENAI_SMS_MODEL || "gpt-4o-mini";

type SmsAiResult = {
  availability: "dostepny" | "niedostepny" | "propozycja" | "niejasne";
  summary: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  inactiveUntil: string;
};

function buildContext(match: ScheduledMatch | null) {
  if (!match) {
    return "Brak dopasowanego meczu. Rozpoznaj tylko ogólną dostępność i ewentualne propozycje terminu.";
  }

  return [
    `Dopasowany mecz: ${match.playerOne} vs ${match.playerTwo}.`,
    `Liga: ${match.league}.`,
    `Sezon: ${match.season}.`,
    `Obecnie zapisany termin: ${match.scheduledAt}.`,
    `Telefon gracza 1: ${match.playerOnePhone || "-"}.`,
    `Telefon gracza 2: ${match.playerTwoPhone || "-"}.`,
  ].join("\n");
}

function buildSchema() {
  return {
    type: "json_schema",
    json_schema: {
      name: "sms_availability",
      strict: true,
      schema: {
        type: "object",
        properties: {
          availability: {
            type: "string",
            enum: ["dostepny", "niedostepny", "propozycja", "niejasne"],
          },
          summary: {
            type: "string",
          },
          startsAt: {
            type: "string",
          },
          endsAt: {
            type: "string",
          },
          reason: {
            type: "string",
          },
          inactiveUntil: {
            type: "string",
          },
        },
        required: ["availability", "summary", "startsAt", "endsAt", "reason", "inactiveUntil"],
        additionalProperties: false,
      },
    },
  };
}

function normalizeResult(candidate: Partial<SmsAiResult>, fallbackBody: string, receivedAt: string) {
  const fallback = parseSmsAvailability(fallbackBody, receivedAt);

  const availability = candidate.availability;
  const normalizedAvailability =
    availability === "dostepny"
    || availability === "niedostepny"
    || availability === "propozycja"
    || availability === "niejasne"
      ? availability
      : fallback.availability;

  return {
    availability: normalizedAvailability,
    summary: typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.trim()
      : fallback.summary,
    startsAt: typeof candidate.startsAt === "string" ? candidate.startsAt : fallback.startsAt,
    endsAt: typeof candidate.endsAt === "string" ? candidate.endsAt : fallback.endsAt,
    reason: typeof candidate.reason === "string" && candidate.reason.trim()
      ? candidate.reason.trim()
      : fallback.reason,
    inactiveUntil: typeof candidate.inactiveUntil === "string"
      ? candidate.inactiveUntil
      : fallback.inactiveUntil,
  };
}

export async function parseSmsAvailabilityWithAi(params: {
  body: string;
  receivedAt: string;
  match: ScheduledMatch | null;
}) {
  if (!process.env.OPENAI_API_KEY) {
    return parseSmsAvailability(params.body, params.receivedAt);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_SMS_MODEL,
      response_format: buildSchema(),
      messages: [
        {
          role: "system",
          content: [
            "Jestes asystentem do umawiania meczow tenisowych.",
            "Twoim zadaniem jest zrozumiec SMS od zawodnika i zwrocic strukture JSON.",
            "Klasyfikacja:",
            "- dostepny: zawodnik potwierdza, ze moze grac",
            "- niedostepny: zawodnik odrzuca termin albo pisze, ze nie moze",
            "- propozycja: zawodnik proponuje inny termin, godzine albo zakres",
            "- niejasne: wiadomosc jest zbyt nieprecyzyjna",
            "Reason wypelnij tylko wtedy, gdy SMS podaje przyczyne typu kontuzja, choroba, wyjazd, praca.",
            "InactiveUntil wypelnij tylko gdy z wiadomosci wynika dluzsza niedostepnosc, np. miesiac przerwy.",
            "Jesli nie da sie ustalic czasu, zwroc pusty string w startsAt i endsAt.",
            "Jesli wykrywasz termin, zwroc ISO 8601 w strefie lokalnej interpretowanej dla Polski.",
            "Summary ma byc krotkie, po polsku, praktyczne dla admina.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Data odebrania SMS: ${params.receivedAt}`,
            buildContext(params.match),
            `Tresc SMS: ${params.body}`,
          ].join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    return parseSmsAvailability(params.body, params.receivedAt);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    return parseSmsAvailability(params.body, params.receivedAt);
  }

  try {
    const parsed = JSON.parse(content) as Partial<SmsAiResult>;
    return normalizeResult(parsed, params.body, params.receivedAt);
  } catch {
    return parseSmsAvailability(params.body, params.receivedAt);
  }
}
