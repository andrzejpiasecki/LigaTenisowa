// Integration test: creates and drops ONLY a unique scratch schema. No real SMS or LLM calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const Module = require('node:module');
const ts = require('typescript');
require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');
const schema = `liga_test_${Date.now()}_${process.pid}`;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  if (request.startsWith('@/')) request = path.join(process.cwd(), 'src', request.slice(2));
  return originalResolve.call(this, request, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
  const client = await pool.connect();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liga-db-test-'));
  let db;
  try {
    const beforeSchema = path.join(tempDir, 'before.prisma');
    const firstMigration = 'prisma/migrations/20260930120000_player_scheduling/migration.sql';
    const migrationCommit = execFileSync('git', ['log', '-1', '--format=%H', '--diff-filter=A', '--', firstMigration], { encoding: 'utf8' }).trim();
    const baselineRef = migrationCommit ? `${migrationCommit}^` : 'HEAD';
    fs.writeFileSync(beforeSchema, execFileSync('git', ['show', `${baselineRef}:prisma/schema.prisma`]));
    const baselineOutput = execFileSync('./node_modules/.bin/prisma', ['migrate', 'diff', '--from-empty', '--to-schema', beforeSchema, '--script'], { encoding: 'utf8' });
    const baseline = baselineOutput.slice(baselineOutput.indexOf('-- CreateEnum'));
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(baseline);
    await client.query(fs.readFileSync(firstMigration, 'utf8'));
    await client.query(fs.readFileSync('prisma/migrations/20261110120000_add_sms_sync/migration.sql', 'utf8'));
    await client.query(fs.readFileSync('prisma/migrations/20261110150000_add_match_sms_offers/migration.sql', 'utf8'));
    await client.query(fs.readFileSync('prisma/migrations/20261110160000_add_day_plan/migration.sql', 'utf8'));
    process.env.SMS_SYNC_TOKEN = require('node:crypto').randomBytes(32).toString('base64url');
    process.env.DATABASE_SCHEMA = schema;
    process.env.DATABASE_URL_UNPOOLED ||= process.env.DATABASE_URL;
    process.env.APP_PUBLIC_URL = 'https://liga.test';
    delete process.env.GEMINI_API_KEY;
    const { getDb } = require('../src/lib/db.ts');
    const { prepareInvitations, prepareMatchMessages, sendQueuedSms } = require('../src/lib/outgoing-sms.ts');
    const { generateWebsiteProposals, acceptWebsiteProposal, replyToMatch, playerOverview, saveWeekly } = require('../src/lib/player-scheduling.ts');
    const { matchRevision, verifyPassword, tokenHash } = require('../src/lib/player-security.ts');
    const { setPlayerPassword } = require('../src/lib/player-accounts.ts');
    db = getDb();
    const base = { league: 'Testowa', season: '2026', skillLevel: 5, preferences: '', notes: '' };
    const a = await db.player.create({ data: { ...base, fullName: 'Gracz A', phone: '+48600111111' } });
    const b = await db.player.create({ data: { ...base, fullName: 'Gracz B', phone: '600222222' } });
    const court = await db.court.create({ data: { name: 'Kort', location: 'Klub', openingTime: '07:00', closingTime: '22:00', notes: '' } });
    assert.equal(await prepareInvitations(), 2);
    assert.equal(await prepareInvitations(), 0);
    assert.equal(await db.outgoingSms.count(), 2);
    assert.equal(await db.playerAccount.count(), 2);
    console.log('PASS migration, schema scoping and invitation deduplication');
    if (process.env.TEST_SCHEDULING_HTTP === '1') {
      const listener = net.createServer();
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], { env: { ...process.env, NODE_ENV: 'production' }, stdio: 'ignore' });
      const origin = `http://localhost:${port}`;
      try {
        for (let i = 0; i < 40; i++) {
          try { await fetch(`${origin}/gracz/logowanie`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
        }
        const request = (route, body, cookie) => fetch(`${origin}${route}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const { getMatchSmsPreview, sendMatchSms, listMatchSmsStatuses } = require('../src/lib/match-sms.ts');
        process.env.JUSTSEND_APP_KEY = 'fake-key-for-tests';
        process.env.JUSTSEND_SENDER = 'LigaTenis';
        process.env.APP_PUBLIC_URL = origin;
        const realFetch = global.fetch;
        const gatewayMessages = [];
        global.fetch = async (url, init) => {
          if (String(url) !== 'https://justsend.io/api/sender/singlemessage/send') return realFetch(url, init);
          assert.equal(init.headers['App-Key'], 'fake-key-for-tests');
          const data = JSON.parse(init.body);
          assert.equal(data.bulkVariant, 'PRO');
          assert.equal(data.sender, 'LigaTenis');
          gatewayMessages.push(data);
          return Response.json({ id: String(gatewayMessages.length) });
        };
        const offerFixture = { ...{ season: base.season, league: base.league }, playerOneId: a.id, playerTwoId: b.id,
          playerOne: a.fullName, playerTwo: b.fullName, courtId: court.id, location: 'Klub',
          scheduledAt: new Date(Date.now() + 86400000), adminNotes: '', createdBy: 'test-admin' };
        const booking = await db.scheduledMatch.create({ data: offerFixture });
        const offerPreview = await getMatchSmsPreview(booking.id);
        assert.equal(offerPreview.configured, true);
        assert.equal(gatewayMessages.length, 0);
        assert.deepEqual(offerPreview.recipients.map((p) => p.phone), ['+48600111111', '+48600222222']);
        await assert.rejects(sendMatchSms(booking.id, '0'.repeat(64)), /podgląd/);
        const attempts = await Promise.allSettled([sendMatchSms(booking.id, offerPreview.fingerprint), sendMatchSms(booking.id, offerPreview.fingerprint)]);
        assert.ok(attempts.some((r) => r.status === 'fulfilled'));
        assert.equal(gatewayMessages.length, 2);
        const tokenFor = (phone, messages) => new URL(messages.find((m) => m.msisdn === phone).content.split(' ').at(-1)).hash.slice(1);
        const firstToken = tokenFor('48600111111', gatewayMessages);
        const secondToken = tokenFor('48600222222', gatewayMessages);
        assert.notEqual(firstToken, secondToken);
        const page = await request('/answer');
        assert.equal(page.status, 200);
        assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
        const html = await page.text();
        assert.match(html, /Pasuje Ci ten mecz/);
        assert.doesNotMatch(html, /clerk/i);
        const answer = (token, action, choice, text) => request('/api/match-sms-answer', { token, action, choice, text });
        assert.equal((await answer(firstToken, 'read')).status, 200);
        assert.equal((await answer(firstToken, 'read')).status, 200);
        const replies = await Promise.all([answer(firstToken, 'reply', 'yes'), answer(firstToken, 'reply', 'yes')]);
        assert.deepEqual(replies.map((r) => r.status).sort(), [200, 400]);
        assert.equal((await db.scheduledMatch.findUniqueOrThrow({ where: { id: booking.id } })).status, 'oczekuje');
        const confirmed = await answer(secondToken, 'reply', 'yes');
        assert.equal(confirmed.status, 200);
        assert.equal((await confirmed.json()).confirmed, true);
        assert.equal((await db.scheduledMatch.findUniqueOrThrow({ where: { id: booking.id } })).status, 'potwierdzony');
        await db.scheduledMatch.delete({ where: { id: booking.id } });

        const another = await db.scheduledMatch.create({ data: offerFixture });
        const anotherPreview = await getMatchSmsPreview(another.id);
        await sendMatchSms(another.id, anotherPreview.fingerprint);
        const nextFirst = tokenFor('48600111111', gatewayMessages.slice(2));
        const nextSecond = tokenFor('48600222222', gatewayMessages.slice(2));
        assert.equal((await answer(nextFirst, 'reply', 'alternative', '  ')).status, 400);
        assert.equal((await answer(nextFirst, 'reply', 'alternative', 'W czwartek po 18')).status, 200);
        const statuses = await listMatchSmsStatuses([another]);
        assert.equal(statuses[another.id][0].reply, 'alternative');
        assert.equal(statuses[another.id][0].alternative, 'W czwartek po 18');
        await db.scheduledMatch.update({ where: { id: another.id }, data: { confirmationVersion: { increment: 1 } } });
        assert.equal((await answer(nextSecond, 'read')).status, 400);
        assert.equal((await answer(nextSecond, 'reply', 'no')).status, 400);
        const forbidden = await fetch(`${origin}/api/scheduler/booking/${another.id}/sms`, {
          method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: origin },
          body: JSON.stringify({ fingerprint: anotherPreview.fingerprint }),
        });
        assert.notEqual(forbidden.status, 200);
        await db.scheduledMatch.delete({ where: { id: another.id } });
        global.fetch = realFetch;
        process.env.APP_PUBLIC_URL = 'https://liga.test';
        console.log('PASS SMS preview, JustSend request, no double sends, single-use links, two confirmations, alternative and stale links');
        const smsUrl = `${origin}/api/sms/sync`;
        const smsHeaders = { Authorization: `Bearer ${process.env.SMS_SYNC_TOKEN}`, "Content-Type": "application/json" };
        const unauthorized = await fetch(smsUrl, { headers: { Authorization: "Bearer " + "x".repeat(32) } });
        assert.equal(unauthorized.status, 401);
        const allowlist = await fetch(smsUrl, { headers: smsHeaders });
        assert.equal(allowlist.status, 200);
        assert.equal(allowlist.headers.get("cache-control"), "no-store");
        const listed = await allowlist.json();
        assert.deepEqual(listed.phones, ["+48600111111", "+48600222222"]);
        const time = Date.now();
        const smsBatch = { messages: [
          { phone: "600 111 111", direction: "incoming", body: "OK", timestamp: time },
          { phone: "0048600111111", direction: "outgoing", body: "Jutro o 16?", timestamp: time - 60000 },
          { phone: "600333333", direction: "incoming", body: "Private message", timestamp: time },
          { phone: "600111111", direction: "draft", body: "Do not import drafts", timestamp: time },
        ] };
        const sendSmsBatch = (body) => fetch(smsUrl, { method: "POST", headers: smsHeaders, body: JSON.stringify(body) });
        const upload = await sendSmsBatch(smsBatch);
        assert.equal(upload.status, 200);
        assert.deepEqual(await upload.json(), { inserted: 2, acknowledged: [0, 1] });
        const repeat = await sendSmsBatch(smsBatch);
        assert.deepEqual(await repeat.json(), { inserted: 0, acknowledged: [0, 1] });
        const saved = await db.syncedSms.findMany({ orderBy: { occurredAt: "asc" } });
        assert.deepEqual(saved.map(({ playerId, phone, direction, body }) => ({ playerId, phone, direction, body })), [
          { playerId: a.id, phone: "+48600111111", direction: "outgoing", body: "Jutro o 16?" },
          { playerId: a.id, phone: "+48600111111", direction: "incoming", body: "OK" },
        ]);
        await db.player.update({ where: { id: b.id }, data: { phone: null } });
        const staleUpload = await sendSmsBatch({ messages: [{ phone: "600222222", direction: "incoming", body: "Stale list", timestamp: time }] });
        assert.deepEqual(await staleUpload.json(), { inserted: 0, acknowledged: [] });
        await db.player.update({ where: { id: b.id }, data: { phone: b.phone } });
        assert.equal((await sendSmsBatch({ messages: Array(26).fill(smsBatch.messages[0]) })).status, 400);
        console.log("PASS SMS sync token, allowlist, both directions, idempotence and stale allowlist filtering");
        const invitation = await db.outgoingSms.findFirstOrThrow({ where: { playerId: a.id } });
        const invite = invitation.body.match(/#([A-Za-z0-9_-]+)/)[1];
        const password = 'test-password-12345';
        const signup = await request('/api/player/auth', { invite, password });
        assert.equal(signup.status, 200, await signup.text());
        const cookieHeader = signup.headers.getSetCookie().find((c) => c.startsWith('liga_player_session='));
        assert.match(cookieHeader, /HttpOnly/i);
        const cookie = cookieHeader.split(';')[0];
        assert.equal((await request('/api/player/auth', { invite, password })).status, 400);
        assert.equal((await request('/api/player/auth', { phone: '600111111', password: 'wrong-password' })).status, 401);
        assert.equal((await request('/api/player/auth', { phone: '600111111', password })).status, 200);
        assert.equal((await request('/api/player/availability')).status, 401);
        const overview = await request('/api/player/availability', undefined, cookie);
        assert.equal(overview.status, 200);
        assert.equal((await overview.json()).player.fullName, a.fullName);
        const day = new Date(Date.now() + 2*86400000).toISOString().slice(0,10);
        const payload = { action: 'save', ranges: [{ kind: 'dostepny', startsAt: `${day}T17:00:00+02:00`, endsAt: `${day}T20:00:00+02:00`, summary: 'API test' }] };
        assert.equal((await request('/api/player/availability', payload, cookie)).status, 200);
        const foreign = await db.playerAvailability.create({ data: { playerId: b.id, kind: 'dostepny', startsAt: new Date(`${day}T17:00:00Z`), endsAt: new Date(`${day}T20:00:00Z`), summary: 'other player' } });
        await fetch(`${origin}/api/player/availability`, { method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ id: foreign.id }) });
        assert.equal(await db.playerAvailability.count({ where: { id: foreign.id } }), 1);
        assert.notEqual((await fetch(`${origin}/api/player/availability`, { method: 'POST', headers: { Origin: 'https://untrusted.test', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) })).status, 200);
        assert.equal((await fetch(`${origin}/api/sms/inbound`, { method: 'POST', body: 'sms' })).status, 410);
        await fetch(`${origin}/api/player/auth`, { method: 'DELETE', headers: { Origin: origin, Cookie: cookie } });
        assert.equal((await request('/api/player/availability', undefined, cookie)).status, 401);
        const loginBeforeReset = await request('/api/player/auth', { phone: '600111111', password });
        const beforeResetCookie = loginBeforeReset.headers.getSetCookie().find((c) => c.startsWith('liga_player_session=')).split(';')[0];
        const replacement = 'replacement-password-12345';
        await setPlayerPassword(a.id, replacement);
        assert.equal((await request('/api/player/availability', undefined, beforeResetCookie)).status, 401);
        assert.equal((await request('/api/player/auth', { phone: '600111111', password })).status, 401);
        const afterReset = await request('/api/player/auth', { phone: '600111111', password: replacement });
        assert.equal(afterReset.status, 200);
        const afterResetCookie = afterReset.headers.getSetCookie().find((c) => c.startsWith('liga_player_session=')).split(';')[0];
        const denied = await fetch(`${origin}/api/players/${a.id}/password`, { method: 'PUT', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: afterResetCookie }, body: JSON.stringify({ password: 'unauthorized-new-password' }) });
        assert.notEqual(denied.status, 200);
        assert.equal(verifyPassword(replacement, (await db.playerAccount.findUniqueOrThrow({ where: { playerId: a.id } })).passwordHash), true);
        console.log('PASS HTTP password replacement, session revocation and rejection of non-admin password updates');
        await db.playerAvailability.deleteMany();
        console.log('PASS HTTP invitation consumption, phone/password login, session cookies, ownership, origin, logout and inbound SMS shutdown');
      } finally {
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
      }
    }

    const day = new Date(Date.now() + 86400000).toISOString().slice(0,10);
    const { warsawInstant } = require('../src/lib/scheduling-slots.ts');
    const start = new Date(warsawInstant(day, '17:00')), end = new Date(warsawInstant(day, '21:00'));
    await db.playerAvailability.createMany({ data: [a,b].map((p) => ({ playerId: p.id, kind: 'dostepny', startsAt: start, endsAt: end, summary: 'test' })) });
    await generateWebsiteProposals();
    assert.equal(await db.matchProposal.count({ where: { status: 'draft' } }), 3);
    await db.playerBlockedPeriod.create({ data: { playerId: b.id, startsAt: start, endsAt: end, reason: 'wyjazd' } });
    const stale = await db.matchProposal.findFirstOrThrow();
    await assert.rejects(acceptWebsiteProposal(stale.id, 'admin'), /Dostępność/);
    await generateWebsiteProposals();
    assert.equal(await db.matchProposal.count({ where: { status: 'draft' } }), 0);
    await db.playerBlockedPeriod.deleteMany();
    await generateWebsiteProposals();
    const proposal = await db.matchProposal.findFirstOrThrow({ orderBy: { proposedStartsAt: 'asc' } });
    const accepts = await Promise.allSettled([acceptWebsiteProposal(proposal.id, 'admin'), acceptWebsiteProposal(proposal.id, 'admin')]);
    assert.equal(accepts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db.scheduledMatch.count(), 1);
    const match = await db.scheduledMatch.findFirstOrThrow();
    console.log('PASS valid slots, blocked periods, stale proposals and concurrent acceptance');
    assert.equal(await prepareMatchMessages(), 2);
    assert.equal(await prepareMatchMessages(), 0);
    await assert.rejects(replyToMatch('not-a-player', match.id, matchRevision(match), true), /Brak dostępu/);
    await Promise.all([replyToMatch(a.id, match.id, matchRevision(match), true), replyToMatch(b.id, match.id, matchRevision(match), true)]);
    assert.equal((await db.scheduledMatch.findUniqueOrThrow({ where: { id: match.id } })).status, 'potwierdzony');
    assert.equal((await playerOverview(a.id)).matches[0].confirmations, 2);
    await replyToMatch(b.id, match.id, matchRevision(match), false);
    assert.equal((await db.scheduledMatch.findUniqueOrThrow({ where: { id: match.id } })).status, 'propozycja');
    const { updateScheduledMatchInDb } = require('../src/lib/scheduled-matches-db.ts');
    await updateScheduledMatchInDb(match.id, { season: match.season, league: match.league, playerOneId: a.id, playerOne: a.fullName, playerOnePhone: a.phone, playerTwoId: b.id, playerTwo: b.fullName, playerTwoPhone: b.phone, courtId: court.id, scheduledAt: new Date(start.getTime() + 1800000).toISOString(), location: match.location, status: 'potwierdzony', adminNotes: '' });
    const changedMatch = await db.scheduledMatch.findUniqueOrThrow({ where: { id: match.id } });
    assert.equal(changedMatch.status, 'oczekuje');
    assert.equal(changedMatch.confirmationVersion, 2);
    await assert.rejects(replyToMatch(a.id, match.id, matchRevision(match), true), /zmienił/);
    assert.equal((await playerOverview(a.id)).matches[0].confirmations, 0);
    console.log('PASS ownership, simultaneous confirmations, refusal and rescheduling');
    await assert.rejects(saveWeekly(a.id, [{ weekday: 1, startTime: '25:00', endTime: '26:00', notes: '' }]), /poprawne/);
    process.env.SMS_GATEWAY_URL = 'https://sms-gateway.test';
    process.env.SMS_GATEWAY_USERNAME = 'test'; process.env.SMS_GATEWAY_PASSWORD = 'test';
    let sends = 0;
    global.fetch = async () => { sends++; return new Response(JSON.stringify({ id: 'gateway-test' }), { status: 202 }); };
    const sms = await db.outgoingSms.findFirstOrThrow({ where: { dedupeKey: { startsWith: 'invite:' }, status: 'queued' } });
    await Promise.allSettled([sendQueuedSms(sms.id), sendQueuedSms(sms.id)]);
    assert.equal(sends, 1);
    assert.equal((await db.outgoingSms.findUniqueOrThrow({ where: { id: sms.id } })).status, 'submitted');
    const staleSms = await db.outgoingSms.findFirstOrThrow({ where: { dedupeKey: { startsWith: 'match:' } } });
    await assert.rejects(sendQueuedSms(staleSms.id), /aktualna/);
    assert.equal(sends, 1);
    const second = await db.outgoingSms.create({ data: { dedupeKey: 'test-unknown-delivery', playerId: a.id, phone: a.phone, body: 'test delivery' } });
    global.fetch = async () => { throw new Error('timeout'); };
    await assert.rejects(sendQueuedSms(second.id));
    assert.equal((await db.outgoingSms.findUniqueOrThrow({ where: { id: second.id } })).status, 'unknown');
    await assert.rejects(sendQueuedSms(second.id), /już/);
    await db.player.update({ where: { id: b.id }, data: { phone: 'invalid-phone' } });
    const invalidPhone = await db.outgoingSms.create({ data: { dedupeKey: 'test-invalid-phone', playerId: b.id, phone: '+48600222222', body: 'test' } });
    await assert.rejects(sendQueuedSms(invalidPhone.id), /Numer/);
    assert.equal((await db.outgoingSms.findUniqueOrThrow({ where: { id: invalidPhone.id } })).status, 'cancelled');
    console.log('PASS SMS claim deduplication, stale/invalid message cancellation and uncertain delivery');
    const c = await db.player.create({ data: { ...base, fullName: 'Gracz C', phone: '+48600333333' } });
    await setPlayerPassword(c.id, 'first-player-password');
    const firstAccount = await db.playerAccount.findUniqueOrThrow({ where: { playerId: c.id } });
    assert.notEqual(firstAccount.passwordHash, 'first-player-password');
    assert.equal(verifyPassword('first-player-password', firstAccount.passwordHash), true);
    const inviteHash = tokenHash('pending-invitation');
    await db.playerAccount.update({ where: { playerId: c.id }, data: { inviteHash, inviteExpiresAt: new Date(Date.now() + 86400000) } });
    await db.playerSession.createMany({ data: [1,2].map((i) => ({ playerId: c.id, tokenHash: tokenHash(`old-session-${i}`), expiresAt: new Date(Date.now() + 86400000) })) });
    await db.loginThrottle.createMany({ data: [tokenHash(c.phone), inviteHash].map((key) => ({ key, attempts: 10, expiresAt: new Date(Date.now() + 86400000) })) });
    const invitation = await db.outgoingSms.create({ data: { playerId: c.id, dedupeKey: `invite:${c.id}`, phone: c.phone, body: 'invitation' } });
    await assert.rejects(setPlayerPassword(c.id, 'short'), /6/);
    assert.equal(await db.playerSession.count({ where: { playerId: c.id } }), 2);
    await setPlayerPassword(c.id, 'replacement-player-password');
    const changedAccount = await db.playerAccount.findUniqueOrThrow({ where: { playerId: c.id } });
    assert.equal(verifyPassword('first-player-password', changedAccount.passwordHash), false);
    assert.equal(verifyPassword('replacement-player-password', changedAccount.passwordHash), true);
    assert.equal(changedAccount.inviteHash, null);
    assert.equal(changedAccount.inviteExpiresAt, null);
    assert.equal(await db.playerSession.count({ where: { playerId: c.id } }), 0);
    assert.equal(await db.loginThrottle.count({ where: { key: { in: [tokenHash(c.phone), inviteHash] } } }), 0);
    assert.equal((await db.outgoingSms.findUniqueOrThrow({ where: { id: invitation.id } })).status, 'cancelled');
    const missingPhone = await db.player.create({ data: { ...base, fullName: 'Bez telefonu' } });
    await assert.rejects(setPlayerPassword(missingPhone.id, 'replacement-player-password'), /numer telefonu/);
    assert.equal(await db.playerAccount.count({ where: { playerId: missingPhone.id } }), 0);
    console.log('PASS admin first password and reset, hash storage, invalid password/phone, invitation cancellation and session/throttle revocation');

    const planDay = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const planSeason = "Test planu sezonu";
    const planPlayers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => db.player.create({ data: {
      ...base, season: i <= 4 ? planSeason : base.season, league: i <= 4 ? 'Plan dnia' : base.league, fullName: `Plan ${i}`, phone: `+4860077000${i}`,
    } })));
    require('../src/lib/results-matches.ts').fetchSeasonResultsWithLabel = async () => ({
      season: planSeason,
      matches: planPlayers.slice(4).map((player) => ({
        league: 'Druga liga', date: '2025-01-01', winner: player.fullName, loser: 'Gracz bez profilu', score: '2 : 0', sets: [],
      })),
    });
    const { previewDayPlan, saveDayPlan, getDayPlanBookings } = require('../src/lib/day-plan.ts');
    const from = new Date(warsawInstant(planDay, '16:00'));
    const to = new Date(warsawInstant(planDay, '17:30'));
    await db.playerAvailability.createMany({ data: planPlayers.slice(0, 2).map((p) => ({
      playerId: p.id, kind: 'dostepny', startsAt: from, endsAt: to, summary: 'test planu',
    })) });
    const args = [planDay, 'test-season'];
    const initial = await previewDayPlan(...args);
    const selected = initial.drafts.find((draft) => draft.playerOneId === planPlayers[0].id || draft.playerTwoId === planPlayers[0].id);
    assert.ok(selected);
    assert.equal(selected.startsAt, from.toISOString());
    assert.equal(new Set(initial.drafts.flatMap((draft) => [draft.playerOneId, draft.playerTwoId])).size, initial.drafts.length * 2);
    const otherLeague = initial.drafts.find((draft) => draft.league === 'Druga liga');
    assert.ok(otherLeague);
    assert.equal(selected.league, 'Plan dnia');
    assert.ok(Math.abs(Date.parse(otherLeague.startsAt) - Date.parse(selected.startsAt)) >= 90 * 60000);
    const savedPlan = await saveDayPlan(...args, [selected.key, otherLeague.key], 'test-admin');
    await assert.rejects(saveDayPlan(...args, [selected.key], 'test-admin'), /Plan się zmienił/);
    const planBookings = await getDayPlanBookings(planDay, planSeason);
    const booking = planBookings.find((match) => match.league === 'Plan dnia');
    assert.ok(booking);
    assert.equal(savedPlan.saved, 2);
    assert.deepEqual(new Set(savedPlan.matchIds), new Set(planBookings.map((match) => match.id)));
    assert.ok(planBookings.some((match) => match.league === 'Druga liga'));
    const { listScheduledMatchesFromDb } = require('../src/lib/scheduled-matches-db.ts');
    const visibleBooking = (await listScheduledMatchesFromDb()).find((match) => match.id === booking.id);
    assert.equal(visibleBooking?.dayPlan, true);
    assert.equal(visibleBooking?.status, 'propozycja');
    assert.equal(visibleBooking?.scheduledAt, selected.startsAt);
    assert.equal(visibleBooking?.courtId, selected.courtId);
    assert.equal(booking.canSend, true);
    const original = await db.scheduledMatch.findUniqueOrThrow({ where: { id: booking.id } });
    await replyToMatch(planPlayers[0].id, original.id, matchRevision(original), false);
    const declined = (await getDayPlanBookings(planDay, planSeason)).find((match) => match.id === original.id);
    assert.equal(declined.declined, true);
    assert.equal(declined.canSend, false);
    const next = await previewDayPlan(...args);
    const replacement = next.drafts.find((draft) => draft.replacementFor === original.id);
    assert.ok(replacement);
    assert.equal(replacement.startsAt, selected.startsAt);
    assert.equal(replacement.courtId, selected.courtId);
    assert.equal(replacement.league, selected.league);
    assert.ok(![replacement.playerOneId, replacement.playerTwoId].includes(planPlayers[0].id));
    await saveDayPlan(...args, [replacement.key], 'test-admin');
    assert.equal((await db.scheduledMatch.findUniqueOrThrow({ where: { id: original.id } })).status, 'anulowany');
    const newBooking = (await getDayPlanBookings(planDay, planSeason)).find((match) => match.league === 'Plan dnia');
    assert.equal(newBooking.canSend, true);
    assert.notEqual(newBooking.id, original.id);
    console.log('PASS day plan preferences, stale drafts, refusal and same-slot replacement');

  } finally {
    if (db) await db.$disconnect();
    if (global.scheduledMatchesPool) await global.scheduledMatchesPool.end();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release(); await pool.end(); fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
