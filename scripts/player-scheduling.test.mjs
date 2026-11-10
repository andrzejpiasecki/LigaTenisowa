import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlayerPhone, hashPassword, verifyPassword, secretToken, tokenHash, matchRevision } from '../src/lib/player-security.ts';
import { commonSlots, warsawInstant, warsawParts, MATCH_MS, overlap } from '../src/lib/scheduling-slots.ts';
import { validateAvailabilityRanges, interpretAvailability } from '../src/lib/scheduling-ai.ts';

test('phone login normalizes Polish and international phone formats', () => {
  for (const phone of ['600 123 456', '+48 600-123-456', '0048 600 123 456']) assert.equal(normalizePlayerPhone(phone), '+48600123456');
  assert.throws(() => normalizePlayerPhone('1234'));
});
test('salted password verification and token fingerprints', () => {
  const hash = hashPassword('moje-dlugie-haslo');
  assert.notEqual(hash, hashPassword('moje-dlugie-haslo'));
  assert.equal(verifyPassword('moje-dlugie-haslo', hash), true);
  assert.equal(verifyPassword('inne-haslo', hash), false);
  assert.throws(() => hashPassword('abcde'));
  assert.equal(verifyPassword('abcdef', hashPassword('abcdef')), true);
  assert.equal(tokenHash(secretToken()).length, 64);
});
test('confirmations become stale on date, court or participant change', () => {
  const match = { scheduledAt: '2026-10-01T16:00:00Z', playerOneId: 'a', playerTwoId: 'b', courtId: 'kort-1', location: 'Klub' };
  for (const patch of [{ scheduledAt: '2026-10-01T17:00:00Z' }, { courtId: 'kort-2' }, { playerTwoId: 'c' }, { location: 'Inny klub' }, { confirmationVersion: 2 }]) assert.notEqual(matchRevision(match), matchRevision({ ...match, ...patch }));
});
test('availability intersection requires full 90 minutes, including boundary cases', () => {
  const now = Date.parse('2026-10-01T14:00:00Z');
  assert.deepEqual(commonSlots([[now, now+2*MATCH_MS]], [[now+3600000, now+7200000]], now, now+86400000), []);
  assert.deepEqual(commonSlots([[now, now+MATCH_MS]], [[now, now+MATCH_MS]], now, now+86400000), [now]);
  assert.equal(overlap(now, now+MATCH_MS, now+MATCH_MS, now+2*MATCH_MS), false);
});
test('Warsaw time conversion handles summer, winter and the DST gap', () => {
  assert.equal(new Date(warsawInstant('2026-10-01', '18:00')).toISOString(), '2026-10-01T16:00:00.000Z');
  assert.equal(new Date(warsawInstant('2026-11-01', '18:00')).toISOString(), '2026-11-01T17:00:00.000Z');
  assert.throws(() => warsawInstant('2026-03-29', '02:30'));
  assert.deepEqual(warsawParts(new Date('2026-10-25T17:00:00Z')), { day: '2026-10-25', time: '18:00' });
});
test('LLM outputs are checked before a player can save them', () => {
  const good = { kind: 'dostepny', startsAt: '2026-10-01T18:00:00+02:00', endsAt: '2026-10-01T20:00:00+02:00', summary: 'wieczorem' };
  assert.equal(validateAvailabilityRanges([good])[0].startsAt, '2026-10-01T16:00:00.000Z');
  for (const patch of [{ kind: 'dowolny' }, { startsAt: '2026-10-01T18:00:00' }, { endsAt: good.startsAt }, { endsAt: 'banana' }]) assert.throws(() => validateAvailabilityRanges([{ ...good, ...patch }]));
});
test('without a free LLM key, interpretation asks for manual availability', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try { await assert.rejects(interpretAvailability('jutro wieczorem'), /ręcznie/); }
  finally { if (old) process.env.GEMINI_API_KEY = old; }
});
