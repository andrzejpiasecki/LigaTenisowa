import type { MatchSmsRecipient } from "@/lib/match-sms-types";

export type DayPlanDraft = {
  key: string;
  courtId: string;
  court: string;
  league: string;
  startsAt: string;
  playerOneId: string;
  playerTwoId: string;
  playerOne: string;
  playerTwo: string;
  rationale: string;
  replacementFor: string | null;
};

export type DayPlanBooking = {
  id: string;
  court: string;
  league: string;
  startsAt: string;
  playerOne: string;
  playerTwo: string;
  status: string;
  recipients: MatchSmsRecipient[];
  declined: boolean;
  canSend: boolean;
};
