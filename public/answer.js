"use strict";

const token = window.location.hash.slice(1);
const status = document.getElementById("status");
const details = document.getElementById("details");
const form = document.getElementById("reply");
const alternativeField = document.getElementById("alternative-field");
const alternative = form.elements.alternative;
const fieldset = form.querySelector("fieldset");

async function request(action, data = {}) {
  const response = await fetch("/api/match-sms-answer", {
    method: "POST", credentials: "omit", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token, ...data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Nie udało się otworzyć propozycji.");
  return result;
}

if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  status.textContent = "Otwórz pełny link z wiadomości SMS.";
} else {
  request("read").then((question) => {
    for (const key of ["date", "opponent"]) document.getElementById(key).textContent = question[key];
    document.getElementById("court").textContent = [...new Set([question.court, question.location].filter(Boolean))].join(" · ") || "—";
    status.textContent = "";
    details.hidden = false;
    form.hidden = false;
  }).catch((error) => { status.textContent = error.message; });
}

form.addEventListener("change", () => {
  const proposing = form.elements.choice.value === "alternative";
  alternativeField.hidden = !proposing;
  alternative.required = proposing;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const choice = form.elements.choice.value;
  const text = alternative.value;
  fieldset.disabled = true;
  status.textContent = "Zapisywanie odpowiedzi…";
  try {
    const result = await request("reply", { choice, text });
    form.hidden = true;
    history.replaceState(null, "", window.location.pathname);
    status.textContent = result.confirmed ? "Mecz potwierdzony przez obu graczy."
      : choice === "yes" ? "Zapisano Twoją zgodę. Czekamy na drugiego gracza."
      : choice === "alternative" ? "Twoja propozycja została przekazana organizatorowi."
      : "Zapisano Twoją odmowę.";
  } catch (error) {
    status.textContent = error.message;
    fieldset.disabled = false;
  }
});
