"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchSmsPreview, MatchSmsRecipient } from "@/lib/match-sms-types";

export const MATCH_SMS_STATUS: Record<string, string> = {
  not_sent: "Nie wysłano", queued: "Gotowy do wysyłki", sending: "Przekazywanie do bramki",
  submitted: "Przyjęty przez bramkę", failed: "Odrzucony przez bramkę",
  unknown: "Nieznany wynik wysyłki", cancelled: "Anulowany",
};

export function MatchSmsRecipientStatus({ recipient }: { recipient: MatchSmsRecipient }) {
  return (
    <span className="match-sms-recipient">
      <strong>{recipient.name}:</strong>{" "}
      {MATCH_SMS_STATUS[recipient.status] || recipient.status}
      {recipient.reply === "yes" && " · Tak"}
      {recipient.reply === "no" && " · Nie"}
      {recipient.reply === "alternative" && <> · Inny termin: {recipient.alternative}</>}
      {!recipient.reply && recipient.status === "submitted" && " · Czeka na odpowiedź"}
    </span>
  );
}

export function MatchSmsDialog({ matchId, onClose, onRefresh }: {
  matchId: string; onClose: () => void; onRefresh: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<MatchSmsPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const endpoint = `/api/scheduler/booking/${encodeURIComponent(matchId)}/sms`;

  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Nie udało się otworzyć podglądu.");
        setPreview(data);
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [endpoint]);

  async function send() {
    if (!preview || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Nie udało się wysłać propozycji.");
      setPreview(data);
      setAttempted(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Nie udało się wysłać propozycji.");
    } finally {
      try { await onRefresh(); } catch { /* Keep the gateway response visible. */ }
      setSending(false);
    }
  }

  const recipientCount = preview?.recipients.filter((recipient) => recipient.canSend).length ?? 0;

  return (
    <dialog ref={dialog} className="match-sms-dialog" aria-labelledby="match-sms-title"
      onClose={onClose} onCancel={(event) => { if (sending) event.preventDefault(); }}>
      <h2 id="match-sms-title">Wyślij propozycję SMS</h2>
      {!preview && !error && <p role="status">Ładowanie podglądu…</p>}
      {preview && (
        <>
          <p><strong>{preview.date}</strong>{preview.court && <> · {preview.court}</>}</p>
          <ul className="match-sms-recipients">{preview.recipients.map((recipient, index) => (
            <li key={recipient.playerId || index}>
              <MatchSmsRecipientStatus recipient={recipient} />
              <span>{recipient.phone || "Brak polskiego numeru w bazie zawodników"}</span>
              {recipient.canSend && <span>Odbiorca tej wysyłki</span>}
            </li>
          ))}</ul>
          <p>Nadawca: <strong>{preview.sender || "nieustawiony"}</strong></p>
          <p className="match-sms-preview">{preview.text}</p>
          <p>Każdy odbiorca dostanie własny link. Oba numery muszą być poprawne i różne.</p>
          {!preview.configured && <p className="form-message form-message--error">Wysyłka wymaga konfiguracji JustSend i publicznego adresu ligi.</p>}
          {attempted && <p role="status">Sprawdź status przy każdym odbiorcy. Przyjęcie przez bramkę nie oznacza doręczenia.</p>}
        </>
      )}
      {error && <p role="alert" className="form-message form-message--error">{error}</p>}
      <div className="form-actions">
        {preview?.configured && recipientCount > 0 && (
          <button type="button" disabled={sending} onClick={send}>
            {sending ? "Przekazywanie…" : `Zatwierdź i wyślij (${recipientCount})`}
          </button>
        )}
        <button type="button" className="button-secondary" disabled={sending} onClick={() => dialog.current?.close()}>Zamknij</button>
      </div>
    </dialog>
  );
}
