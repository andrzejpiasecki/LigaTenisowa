export type MatchSmsRecipient = {
  playerId: string;
  name: string;
  status: string;
  reply: "yes" | "no" | "alternative" | null;
  alternative: string | null;
};

export type MatchSmsPreview = {
  fingerprint: string;
  date: string;
  court: string;
  sender: string;
  text: string;
  configured: boolean;
  recipients: Array<MatchSmsRecipient & { phone: string; canSend: boolean }>;
};

export type MatchSmsChoice = "yes" | "no" | "alternative";
