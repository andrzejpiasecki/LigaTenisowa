import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function normalizePlayerPhone(value: string) {
  let phone = value.replace(/[\s()-]/g, "");
  if (/^\d{9}$/.test(phone)) phone = `+48${phone}`;
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Podaj poprawny numer telefonu, np. +48 600 123 456.");
  return phone;
}
export function secretToken() { return randomBytes(32).toString("base64url"); }
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function hashPassword(password: string) {
  if (password.length < 6 || password.length > 128) throw new Error("Hasło musi mieć od 6 do 128 znaków.");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  if (password.length > 128) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !/^[a-f0-9]{128}$/.test(hash || "")) return false;
  return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(password, salt, 64));
}
export function matchRevision(match: { scheduledAt: Date | string; playerOneId: string | null; playerTwoId: string | null; courtId: string | null; location: string; confirmationVersion?: number }) {
  return tokenHash(JSON.stringify([new Date(match.scheduledAt).toISOString(), match.playerOneId, match.playerTwoId, match.courtId, match.location, match.confirmationVersion ?? 1]));
}
