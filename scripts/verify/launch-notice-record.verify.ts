// Checks the renter notice record and texts through message settings (launch L15f, messaging):
// - Every attempt to message someone is on the message log, word for word: a text switched off in message settings,
//   held for quiet hours, with no texting set up (for a renter), or to a number that replied STOP, as well as one sent.
//   One entry per attempt, never two, each with a fingerprint of its exact words; the sender gets the entry's id back.
// - A renter's sign-in code is never readable in the log or the private text log.
// - Texts to renters (sign-in code, rent due, past due, paperwork, repairs, day swaps) go through message settings.
// - The record shows each notice once (its email and its text together), the conversation as itself with how each copy
//   went, a held text that went later once, and what didn't arrive and why; it holds only what was sent to them as a
//   renter.
// - Their portal shows everything that went to them and every formal notice even when it didn't get through; opening a
//   notice records the time on the record, once, for their own notices only.
// - The account timeline shows an owner's message once, and a bill paid by a payment line isn't counted twice.
// - The printed notice record carries the exact words, each copy's address and what happened, and a fingerprint.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-notice-record.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'ClarityFlow <hello@mail.example.com>';
const twilioOn = () => { process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+15550009999'; };
const twilioOff = () => { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM; };
let db: any = strictTransactions(makeDb());
const actorNow: any = { uid: 'm1', name: 'Max', role: 'manager', isManager: true, caps: [] };
class FakeResponse { status: number; body: any; headers: any; constructor(body?: any, init?: any) { this.body = body; this.status = init?.status || 200; this.headers = init?.headers; }
  static json(body: any, init?: any) { return new FakeResponse(body, init); } }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: FakeResponse };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/print-link' || /\/src\/lib\/print-link(\.ts)?$/.test(request)) return fake(request, { printLinkValid: () => true, printLinkExpired: () => FakeResponse.json({ ok: false }, { status: 410 }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async () => ({ actor: actorNow }), requireCan: async () => ({ actor: actorNow }), staffOrServer: async () => true });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const sent: { url: string; body: any }[] = [];
let twilioFails = false;
(globalThis as any).fetch = async (url: string, init: any) => {
  const u = String(url);
  if (u.includes('resend')) { sent.push({ url: u, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ id: `em${sent.length}` }), text: async () => '' }; }
  if (u.includes('twilio')) {
    const p = new URLSearchParams(String(init.body)); sent.push({ url: u, body: Object.fromEntries(p.entries()) });
    if (twilioFails) return { ok: false, status: 400, json: async () => ({ message: 'Unreachable number' }) };
    return { ok: true, status: 201, json: async () => ({ sid: `SM${sent.length}` }) };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};
const mails = () => sent.filter((x) => x.url.includes('resend'));
const texts = () => sent.filter((x) => x.url.includes('twilio'));
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => '' }, nextUrl: { origin: 'https://app.example.com', searchParams: new URLSearchParams() } } as any);
const getReq = (q: Record<string, string>) => ({ nextUrl: { searchParams: new URLSearchParams(q), origin: 'https://app.example.com' }, headers: { get: () => '' } } as any);
const fp = (s: any, b: any) => createHash('sha256').update(`${String(s || '')}\n${String(b || '')}`, 'utf8').digest('hex');
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

async function fresh(extra: any = {}) {
  db = strictTransactions(makeDb()); sent.length = 0; twilioFails = false; twilioOn();
  await db.doc(T).set({ name: 'Northside Studio', timezone: 'America/New_York', publicOrigin: 'https://northside.example.com', ...extra });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', phone: '(555) 010-2233', status: 'active' });
  await db.doc(`${T}/renters/rt2`).set({ firstName: 'Ben', lastName: 'Lee', email: 'ben@example.com', phone: '5550104455', status: 'active' });
  await db.doc(`${T}/private/renterSessions`).set({
    [createHash('sha256').update('tok').digest('hex')]: { contactKey: 'maya@example.com', name: 'Maya', renterId: 'rt1', expiresAt: Date.now() + 3600e3 },
    [createHash('sha256').update('tok2').digest('hex')]: { contactKey: 'ben@example.com', name: 'Ben', renterId: 'rt2', expiresAt: Date.now() + 3600e3 },
  });
}
const logs = async () => (await all(`${T}/messageLog`)).sort((a: any, b: any) => String(a.sentAt).localeCompare(String(b.sentAt)));

(async () => {
  const N = await import('../../src/lib/notify');
  const RT = await import('../../src/lib/renter-text');
  const NR = await import('../../src/lib/notice-record');
  const TL = await import('../../src/lib/renter-timeline');
  const Portal = await import('../../src/app/api/portal/renter/route');
  const Notify = await import('../../src/app/api/booths/notify/route');
  const Print = await import('../../src/app/api/booths/notice-record/route');
  const MP = await import('../../src/lib/message-policy');
  const renterSms = (o: any) => N.sendNotification(db, { tenantId: 't1', channel: 'sms', to: '(555) 010-2233', kind: 'renter_rent_due', text: 'Your rent of $900.00 is due on 2026-12-01.', recipientType: 'renter', recipientId: 'rt1', recipientName: 'Maya Ortiz', ...o });

  console.log('Every attempt is on the log, once');
  await fresh({ messagePolicy: { renter_rent_due: { smsEnabled: false } } });
  let r: any = await renterSms({});
  let L = await logs();
  check('a text switched off in message settings is logged as not sent, with why, and its id comes back', L.length === 1 && L[0].channel === 'sms' && L[0].status === 'skipped_by_policy' && /message settings/.test(L[0].error) && r.logId === L[0].id && texts().length === 0, L);
  check('word for word, to the number in full form, with a fingerprint of the words', L[0].body === 'Your rent of $900.00 is due on 2026-12-01.' && L[0].to === '+15550102233' && L[0].fingerprint === fp(null, L[0].body) && L[0].recipientId === 'rt1', L[0]);

  await fresh();
  const tz = 'America/New_York'; const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  await db.doc(T).set({ messageQuietHours: { enabled: true, startHour: h, endHour: (h + 1) % 24 } }, { merge: true });
  r = await renterSms({});
  L = await logs();
  check('a text held for quiet hours is logged as held, and it waits to go', r.held === true && L.length === 1 && L[0].held === true && /quiet hours/.test(L[0].error) && texts().length === 0 && (await all(`${T}/heldTexts`)).length === 1, { r, L });
  const held = (await all(`${T}/heldTexts`))[0];
  await db.doc(T).set({ messageQuietHours: { enabled: false } }, { merge: true });
  await N.releaseHeldTexts(db, 't1', (await get(T)));
  L = await logs();
  check('when quiet hours end it goes, and that is its own entry', texts().length === 1 && L.length === 2 && L[1].status === 'sent' && !L[1].held && L[1].body === L[0].body && !!held, L.map((x: any) => x.status));
  const items0 = NR.buildNoticeRecord({ rows: L, thread: [] });
  check('the record shows it once: the held entry gives way to the one that went', items0.length === 1 && items0[0].copies.length === 1 && items0[0].copies[0].state === 'sent', items0);

  await fresh(); twilioOff();
  r = await renterSms({});
  await N.sendNotification(db, { tenantId: 't1', channel: 'sms', to: '5550107777', kind: 'appointment_reminder', text: 'See you tomorrow', recipientType: 'client', recipientId: 'c1' });
  L = await logs();
  check('with no texting set up, a renter’s text is logged with why; a client’s reminder isn’t (no noise)', L.length === 1 && L[0].status === 'skipped_no_provider' && L[0].recipientId === 'rt1', L);

  await fresh();
  r = await renterSms({});
  L = await logs();
  check('a text that goes is logged once, by the texting layer, with its delivery tracking and id', r.ok && L.length === 1 && L[0].status === 'sent' && L[0].providerId && r.logId === L[0].id && !!(await get(`msgIndex/${L[0].providerId}`)) && L[0].fingerprint === fp(null, L[0].sentText), L);

  await fresh();
  await db.doc(`${T}/private/smsOptOuts`).set({ '15550102233': '2026-10-01T00:00:00Z' });
  r = await renterSms({});
  L = await logs();
  check('a number that replied STOP: not texted, and logged as not sent because of the STOP', !r.ok && r.status === 'skipped_by_policy' && L.length === 1 && /STOP/.test(L[0].error) && L[0].status === 'skipped_by_policy' && texts().length === 0 && r.logId === L[0].id, { r, L });

  await fresh();
  r = await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'maya@example.com', kind: 'rent_overdue', subject: 'Your rent is past due', text: 'Hi Maya,\n\nYour rent is 3 days late.', recipientType: 'renter', recipientId: 'rt1' });
  L = await logs();
  check('an email is logged once with its subject, words and fingerprint, and its id comes back', r.ok && L.length === 1 && r.logId === L[0].id && L[0].subject === 'Your rent is past due' && L[0].fingerprint === fp('Your rent is past due', L[0].body), L);
  r = await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: '', kind: 'rent_overdue', subject: 'x', text: 'y', recipientType: 'renter', recipientId: 'rt1' });
  check('no email address: not handed to the provider, logged as not sent and why', !r.ok && /No email address/.test(r.error) && mails().length === 1 && (await logs()).length === 2, r);

  console.log('Sign-in codes stay hidden');
  await fresh();
  await N.sendNotification(db, { tenantId: 't1', channel: 'sms', to: '5550102233', kind: 'renter_signin_code', essential: true, text: 'Your renter portal sign-in code is 482913. It expires in 10 minutes.', recipientType: 'renter', recipientId: 'rt1' });
  await N.sendNotification(db, { tenantId: 't1', channel: 'email', to: 'maya@example.com', kind: 'renter_signin_code', essential: true, subject: 'Your sign-in code', text: 'Your renter portal sign-in code is 482913.', recipientType: 'renter', recipientId: 'rt1' });
  L = await logs();
  const smsLog = await all(`${T}/private/smsLog/messages`);
  check('the code went to them', texts().some((x) => /482913/.test(x.body.Body)) && mails().some((m) => /482913/.test(m.body.text || '')));
  check('but the log the team reads and the private text log never show it', L.length === 2 && L.every((x: any) => !/482913/.test(JSON.stringify(x))) && smsLog.length === 1 && !/482913/.test(smsLog[0].body), { L, smsLog });
  const portalSrc = src('src/app/api/portal/renter/route.ts');
  check('the portal sends the code through message settings, at any hour, linked to the renter', /kind: 'renter_signin_code', essential: true, phone: contact\.trim\(\)/.test(portalSrc) && !/sendTenantSms/.test(portalSrc) && /recipientId: renterId \|\| null/.test(portalSrc));

  console.log('Renter texts go through message settings');
  await fresh({ messagePolicy: { renter_credential_expiring: {} , renter_ticket_update: { smsEnabled: false } } });
  let t: any = await RT.textRenter(db, { tenantId: 't1', renterId: 'rt1', renter: await get(`${T}/renters/rt1`), kind: 'renter_ticket_update', text: 'Work at Suite 4 today.', emailFallback: true, subject: 'x' });
  check('switched off: no text, and no email in its place', !t.ok && texts().length === 0 && mails().length === 0 && (await logs()).length === 1, t);
  await fresh();
  await db.doc(`${T}/private/smsOptOuts`).set({ '15550102233': 'x' });
  t = await RT.textRenter(db, { tenantId: 't1', renterId: 'rt1', renter: await get(`${T}/renters/rt1`), kind: 'renter_credential_expiring', text: 'Your insurance expires on 2026-12-01.', emailFallback: true, subject: 'Your insurance expires soon' });
  L = await logs();
  check('replied STOP: the same words by email when the sender asks for that, both on the record', t.ok && t.via === 'email' && mails().length === 1 && mails()[0].body.subject === 'Your insurance expires soon' && L.length === 2 && L.every((x: any) => x.recipientId === 'rt1' && x.recipientType === 'renter'), { t, L });
  await fresh();
  t = await RT.textRenter(db, { tenantId: 't1', renterId: 'rt1', renter: await get(`${T}/renters/rt1`), kind: 'renter_rent_due', text: 'Rent due.', tokens: { renter_first: 'Maya', amount: '$900.00', when: 'on 2026-12-01', link: '', studio: 'Northside Studio' } });
  check('a text that goes is one text', t.ok && t.via === 'sms' && texts().length === 1 && mails().length === 0, t);
  await fresh({ messagePolicy: { renter_rent_due: { smsBody: 'Hi {{renter_first}}, {{amount}} is due {{when}}.' } } });
  t = await RT.textRenter(db, { tenantId: 't1', renterId: 'rt1', renter: await get(`${T}/renters/rt1`), kind: 'renter_rent_due', text: 'Rent due.', tokens: { renter_first: 'Maya', amount: '$900.00', when: 'on 2026-12-01', link: '', studio: 'Northside Studio' } });
  check('the business’s own words for it are used', /Hi Maya, \$900\.00 is due on 2026-12-01\./.test(texts()[0]?.body?.Body || ''), texts()[0]?.body);
  const nightly = src('src/app/api/cron/nightly/route.ts');
  const maint = src('src/app/api/maintenance/route.ts');
  check('past due, rent due, missing and expiring paperwork, and work at their space go through it in the nightly run',
    /kind: 'rent_overdue',/.test(nightly) && /kind: 'renter_rent_due',/.test(nightly) && (nightly.match(/kind: 'renter_credential_expiring', emailFallback: true/g) || []).length === 1 && /kind: 'renter_paperwork_missing', emailFallback: true/.test(nightly) && /kind: 'renter_ticket_update',\n/.test(nightly)
    && !/sendTenantSms\(db, tDoc\.id, r\.phone/.test(nightly) && !/sendTenantSms\(db, tid, r\.phone/.test(nightly));
  check('repairs a renter reported, and day swaps, go through it too', (maint.match(/kind: 'renter_ticket_update'/g) || []).length === 2 && /kind: 'renter_day_swap', phone: target\.phone/.test(portalSrc));
  check('day swaps are in message settings, and repairs can be texted', !!MP.MESSAGE_KIND_BY_ID.renter_day_swap && MP.MESSAGE_KIND_BY_ID.renter_day_swap.canDisable === true && MP.MESSAGE_KIND_BY_ID.renter_ticket_update.channels.includes('sms'));

  console.log('The record');
  const row = (o: any) => ({ recipientType: 'renter', recipientId: 'rt1', status: 'sent', deliveredAt: null, openedAt: null, bouncedAt: null, ...o });
  const rows = [
    row({ id: 'e1', channel: 'email', kind: 'rent_overdue', to: 'maya@example.com', subject: 'Late rent notice', body: 'Your Dec 1 rent of $900.00 is 3 days late.', sentAt: '2026-12-04T13:00:00Z', bouncedAt: '2026-12-04T13:00:05Z', failureDetail: 'Mailbox full', fingerprint: 'abc' }),
    row({ id: 's1', channel: 'sms', kind: 'rent_overdue', to: '+15550102233', body: 'Your rent due 2026-12-01 is past due.', sentAt: '2026-12-04T13:00:02Z', deliveredAt: '2026-12-04T13:00:09Z', portalSeenAt: '2026-12-05T01:31:00Z' }),
    row({ id: 'e2', channel: 'email', kind: 'rent_receipt', to: 'maya@example.com', subject: 'Receipt', body: 'Autopay took $510.00.', sentAt: '2026-11-14T17:01:00Z', openedAt: '2026-11-14T18:00:00Z' }),
    row({ id: 'e3', channel: 'email', kind: 'rent_receipt', to: 'maya@example.com', subject: 'Receipt', body: 'Autopay took $90.00.', sentAt: '2026-11-14T18:30:00Z' }),
    row({ id: 'e4', channel: 'email', kind: 'renter_broadcast', to: 'maya@example.com', subject: 'Holiday hours', body: 'Closed Nov 26.', sentAt: '2026-11-18T14:00:00Z', status: 'skipped_by_policy', error: 'renter_broadcast is switched off in message settings' }),
    row({ id: 'e5', channel: 'email', kind: 'renter_message', to: 'maya@example.com', subject: 'A message from Northside Studio', body: 'Hi Maya, The sink is fixed.', sentAt: '2026-11-20T19:15:00Z', threadMessageId: 'm1' }),
    row({ id: 's5', channel: 'sms', kind: 'renter_message', to: '+15550102233', body: 'The sink is fixed. Reply in your portal: https://x', sentAt: '2026-11-20T19:15:01Z', threadMessageId: 'm1' }),
    row({ id: 'e6', channel: 'email', kind: 'renter_message', to: 'maya@example.com', subject: 'A message from Northside Studio', body: 'Old message', sentAt: '2026-10-01T12:00:00Z' }),
    row({ id: 's6', channel: 'sms', kind: 'renter_message', to: '+15550102233', body: 'Old message', sentAt: '2026-10-01T12:00:01Z', status: 'failed', error: 'Unreachable number' }),
    row({ id: 'e7', channel: 'email', kind: 'renter_signin_code', to: 'maya@example.com', subject: 'Your sign-in code', body: 'Code ••••••', sentAt: '2026-11-01T12:00:00Z' }),
    row({ id: 'e8', channel: 'email', kind: 'deposit_notice', to: 'maya@example.com', subject: 'Your deposit', body: '$80.00 was kept for the chair.', sentAt: '2026-11-02T12:00:00Z', status: 'failed', error: 'Provider error (500)' }),
  ];
  const thread = [
    { id: 'm1', direction: 'outbound', text: 'The sink is fixed.', byName: 'Dana Reyes', createdAt: '2026-11-20T19:15:03Z' },
    { id: 'm0', direction: 'outbound', text: 'Old message', byName: 'Dana Reyes', createdAt: '2026-10-01T12:00:02Z' },
    { id: 'm2', direction: 'inbound', text: 'Thanks!', byName: 'Maya Ortiz', createdAt: '2026-11-20T20:00:00Z' },
  ];
  const items = NR.buildNoticeRecord({ rows, thread, renterName: 'Maya Ortiz' });
  const byId = (id: string) => items.find((i) => i.id === id)!;
  check('the late rent notice is one item: its email and its text together, the email’s words first', !!byId('e1') && byId('e1').copies.map((c) => c.channel).join() === 'email,sms' && byId('e1').body === rows[0].body && byId('e1').subject === 'Late rent notice' && !items.some((i) => i.id === 's1'));
  check('it is a formal notice, it didn’t all arrive (the email bounced, and why), and it was seen in the portal', byId('e1').formal && byId('e1').trouble && byId('e1').copies[0].state === 'bounced' && byId('e1').copies[0].why === 'Mailbox full' && byId('e1').copies[1].state === 'delivered' && byId('e1').portalSeenAt === '2026-12-05T01:31:00Z');
  check('two receipts an hour and a half apart are two items', !!byId('e2') && !!byId('e3') && byId('e2').copies[0].state === 'opened' && byId('e2').category === 'money');
  check('a message in the conversation is the message itself, with its email and text as copies', byId('t_m1').copies.length === 2 && byId('t_m1').body === 'The sink is fixed.' && byId('t_m1').sentBy === 'Dana Reyes' && !items.some((i) => i.id === 'e5' || i.id === 's5'));
  check('an older one (before copies were linked) finds its copies by time', byId('t_m0').copies.map((c) => c.logId).sort().join() === 'e6,s6' && byId('t_m0').trouble && !items.some((i) => i.id === 'e6'));
  check('their reply is in it too', byId('t_m2').direction === 'in' && byId('t_m2').sentBy === 'Maya Ortiz');
  check('a message switched off is on the record as switched off, not as a delivery problem', byId('e4').switchedOff && !byId('e4').trouble && byId('e4').copies[0].why === 'renter_broadcast is switched off in message settings');
  check('newest first, and nothing counted twice', items.map((i) => i.id).join() === 'e1,t_m2,t_m1,e4,e3,e2,e8,e7,t_m0' && items.length === 9, items.map((i) => i.id));
  check('plain words for each copy', NR.copyWords(byId('e1').copies[0], () => 'x') === 'Email bounced' && NR.copyWords(byId('e1').copies[1], () => '8:00 AM') === 'Text delivered 8:00 AM');

  const r1 = await get(`${T}/renters/rt1`);
  check('only what was sent to them as a renter: by id, or to their email or phone with a renter message',
    NR.belongsToRenter({ recipientId: 'rt1', kind: 'x' }, 'rt1', r1)
    && NR.belongsToRenter({ to: 'MAYA@example.com', kind: 'rent_receipt', recipientType: 'other' }, 'rt1', r1)
    && NR.belongsToRenter({ to: '+15550102233', kind: 'renter_rent_due' }, 'rt1', r1)
    && !NR.belongsToRenter({ to: 'maya@example.com', kind: 'appointment_reminder', recipientType: 'client', recipientId: 'c9' }, 'rt1', r1)
    && !NR.belongsToRenter({ to: 'maya@example.com', kind: 'staff_agenda', recipientType: 'staff', recipientId: 'st1' }, 'rt1', r1)
    && !NR.belongsToRenter({ to: '+15550109999', kind: 'renter_client_reminder', renterId: 'rt1', recipientType: 'client', recipientId: 'c2' }, 'rt1', r1)
    && !NR.belongsToRenter({ to: 'maya@example.com', kind: 'rent_receipt', recipientType: 'renter', recipientId: 'rt2' }, 'rt1', r1)
    && !NR.belongsToRenter({ to: 'maya@example.com', kind: 'booking_confirmation' }, 'rt1', r1));

  const mine = NR.forRenter(items).map((i) => i.id);
  check('their portal: everything that went, and formal notices even when they failed', mine.includes('e1') && mine.includes('e2') && mine.includes('e8'), mine);
  check('not a message switched off, not a sign-in code, not the conversation (shown as itself)', !mine.includes('e4') && !mine.includes('e7') && !mine.some((id) => id.startsWith('t_')), mine);
  const v = NR.renterView(byId('e1'));
  check('their copy has the words and how it reached them, not addresses or provider details', v.body === rows[0].body && v.channels.join() === 'text' && !('copies' in v) && !JSON.stringify(v).includes('Mailbox full'), v);

  console.log('Their portal');
  await fresh();
  for (const x of rows) await db.doc(`${T}/messageLog/${x.id}`).set(x);
  for (const m of thread) await db.doc(`${T}/renterThreads/rt1/messages/${m.id}`).set(m);
  await db.doc(`${T}/messageLog/client1`).set({ id: 'client1', channel: 'email', kind: 'booking_confirmation', to: 'maya@example.com', recipientType: 'client', recipientId: 'c9', subject: 'Booked', body: 'Your nails', status: 'sent', sentAt: '2026-11-03T12:00:00Z' });
  await db.doc(`${T}/messageLog/bens`).set({ id: 'bens', channel: 'email', kind: 'rent_overdue', to: 'ben@example.com', recipientType: 'renter', recipientId: 'rt2', subject: 'Ben late', body: 'Ben', status: 'sent', sentAt: '2026-11-03T12:00:00Z' });
  r = await Portal.POST(req({ action: 'notices', tenantId: 't1', token: 'tok' }));
  const got = (r.body.items || []).map((i: any) => i.id);
  check('they see their notices and receipts, word for word, and nobody else’s (or their client mail)', r.body.ok && got.join() === 'e1,e3,e2,e8' && !got.includes('client1') && !got.includes('bens') && r.body.items[0].body === rows[0].body, r.body);
  const before = await get(`${T}/messageLog/e8`);
  r = await Portal.POST(req({ action: 'notice-seen', tenantId: 't1', token: 'tok', id: 'e8' }));
  const after = await get(`${T}/messageLog/e8`);
  check('opening a notice records the time on the record', r.body.ok && !!after.portalSeenAt && after.portalSeenAt === r.body.seenAt, { r: r.body, after });
  check('only the time: the words and fingerprint stay as sent', after.body === before.body && after.subject === before.subject && after.status === before.status && after.fingerprint === before.fingerprint);
  const first = after.portalSeenAt;
  await Portal.POST(req({ action: 'notice-seen', tenantId: 't1', token: 'tok', id: 'e8' }));
  check('opening it again keeps the first time', (await get(`${T}/messageLog/e8`)).portalSeenAt === first);
  r = await Portal.POST(req({ action: 'notice-seen', tenantId: 't1', token: 'tok', id: 'e1' }));
  check('a notice already seen keeps its time, on each copy that had it', r.body.ok && r.body.seenAt === '2026-12-05T01:31:00Z' && !(await get(`${T}/messageLog/e1`)).portalSeenAt);
  r = await Portal.POST(req({ action: 'notice-seen', tenantId: 't1', token: 'tok2', id: 'e8' }));
  const r9: any = await Portal.POST(req({ action: 'notice-seen', tenantId: 't1', token: 'tok', id: 'bens' }));
  check('nobody can mark someone else’s notice seen', r.status === 404 && r9.status === 404 && !(await get(`${T}/messageLog/bens`)).portalSeenAt);
  await db.doc(`${T}/messageLog/fresh1`).set({ id: 'fresh1', channel: 'email', kind: 'renter_charge_added', to: 'maya@example.com', recipientType: 'renter', recipientId: 'rt1', subject: 'A charge was added', body: 'Lost key $25.00', status: 'sent', sentAt: iso(3600e3) });
  r = await Portal.POST(req({ action: 'today', tenantId: 't1', token: 'tok' }));
  check('Today points them to a notice they haven’t opened', (r.body.items || []).some((i: any) => i.kind === 'notice' && /A notice to read/.test(i.title) && /A charge was added/.test(i.body)), r.body.items);

  console.log('An owner’s message is recorded once');
  await fresh();
  r = await Notify.POST(req({ action: 'renter-message', tenantId: 't1', renterId: 'rt1', text: 'The sink is fixed.', byName: 'Dana Reyes' }));
  const th = await all(`${T}/renterThreads/rt1/messages`);
  L = await logs();
  check('its email and its text both name the conversation message, and the message names its email', r.body.ok && th.length === 1 && L.length === 2 && L.every((x: any) => x.threadMessageId === th[0].id && x.recipientType === 'renter' && x.recipientId === 'rt1') && th[0].emailLogId === L.find((x: any) => x.channel === 'email')?.id, { th, L });
  const tl = TL.buildRenterTimeline({ renter: await get(`${T}/renters/rt1`), messages: L, thread: th });
  check('the timeline shows it once, as what was written, emailed and texted', tl.length === 1 && tl[0].kind === 'message_out' && tl[0].detail === 'The sink is fixed.' && tl[0].status === 'emailed · texted', tl);
  const tl2 = TL.buildRenterTimeline({ renter: r1, messages: rows, thread });
  check('older messages too, and an email and a text of one notice are one entry', tl2.filter((e) => e.ref?.type === 'thread' && e.kind === 'message_out').length === 2 && tl2.filter((e) => e.ref?.id === 'e1').length === 1 && !tl2.some((e) => ['e5', 's5', 'e6', 's6', 's1'].includes(String(e.ref?.id))), tl2.map((e) => e.ref?.id));
  const notifySrc = src('src/app/api/booths/notify/route.ts');
  check('broadcasts and replies to a concern carry the same link', (notifySrc.match(/threadMessageId: mRef\.id/g) || []).length === 6, (notifySrc.match(/threadMessageId: mRef\.id/g) || []).length);

  console.log('A bill paid by a payment line is counted once');
  const tl3 = TL.withRunningBalance(TL.buildRenterTimeline({ renter: r1,
    invoices: [{ id: 'i1', status: 'paid', amountCents: 90000, lateFeeCents: 0, dueDate: '2026-11-01', paidAt: '2026-11-02T12:00:00Z', paidVia: 'desk', ledgerEntryId: 'p1' },
      { id: 'i2', status: 'paid', amountCents: 50000, lateFeeCents: 0, dueDate: '2026-10-01', paidAt: '2026-10-01T12:00:00Z', paidVia: 'online' }],
    ledger: [{ id: 'p1', type: 'payment', amountCents: -90000, method: 'cash', paidAt: '2026-11-02T12:00:00Z' }] }));
  const pays = tl3.filter((e) => ['payment', 'autopay_ok', 'part_payment'].includes(e.kind));
  check('the payment line tells it; a bill paid online still shows its payment; the balance comes back to zero', pays.length === 2 && pays.some((e) => e.ref?.id === 'p1') && pays.some((e) => e.ref?.id === 'i2') && (tl3[0] as any).balanceCents === 0, tl3.map((e) => [e.kind, e.ref?.id, (e as any).balanceCents]));

  console.log('The printed record');
  await fresh();
  for (const x of rows) await db.doc(`${T}/messageLog/${x.id}`).set(x);
  for (const m of thread) await db.doc(`${T}/renterThreads/rt1/messages/${m.id}`).set(m);
  r = await Print.GET(getReq({ tenantId: 't1', renterId: 'rt1', id: 'e1' }));
  const html = String(r.body);
  check('one notice: its exact words, both copies with their addresses and what happened, and a fingerprint', r.status === 200 && html.includes('Your Dec 1 rent of $900.00 is 3 days late.') && html.includes('Your rent due 2026-12-01 is past due.') && html.includes('maya@example.com') && html.includes('+15550102233') && html.includes('Bounced') && html.includes('Mailbox full') && html.includes('Delivered') && html.includes('Fingerprint abc') && html.includes('Seen in their portal'), html.slice(0, 400));
  check('a copy without a stored fingerprint gets one from its exact words', html.includes(`Fingerprint ${fp(null, rows[1].body).slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ')}`));
  r = await Print.GET(getReq({ tenantId: 't1', renterId: 'rt1' }));
  check('the whole record has every item, the conversation included', String(r.body).includes('The sink is fixed.') && String(r.body).includes('Thanks!') && String(r.body).includes('9 items'));
  r = await Print.GET(getReq({ tenantId: 't1', renterId: 'rt1', view: 'renter' }));
  check('their own printed copy is what their portal shows', String(r.body).includes('4 items') && !String(r.body).includes('Holiday hours') && !String(r.body).includes('Thanks!'));
  r = await Print.GET(getReq({ tenantId: 't1', renterId: 'rt1', id: 'bens' }));
  check('a notice not on this record doesn’t print', r.status === 404);
  check('it opens from a signed link, and a renter only gets their own', /'\/api\/booths\/notice-record',\n\] as const;/.test(src('src/lib/print-link.ts')) && /path === '\/api\/booths\/notice-record'\) \{\n\s+if \(!mine\.includes\(String\(params\.renterId \|\| ''\)\)\) return no\(NOT_YOURS\);\n\s+params\.view = 'renter';/.test(src('src/app/api/print-link/route.ts')));

  console.log('What the review found');
  await fresh();
  t = await RT.textRenter(db, { tenantId: 't1', renterId: 'rt1', renter: await get(`${T}/renters/rt1`), kind: 'renter_rent_due', text: 'Rent due.' });
  L = await logs();
  check('a text to a renter isn’t marked as sent on their behalf, so a reply comes to the business', t.ok && L.length === 1 && !L[0].renterId && (await all(`${T}/renterInbox`)).length === 0 && (await all(`${T}/renterThreads`)).length === 0, L[0]);
  const RI = await import('../../src/lib/renter-inbox');
  check('their reply goes to the business', (await RI.replyOwner(db, 't1', '5550102233')).owner === 'studio');
  check('what reached their phone is on the record: the business’s name in front and the first-text opt-out line', L[0].sentText === 'Northside Studio: Rent due. Reply STOP to opt out.' && L[0].body === 'Rent due.' && L[0].fingerprint === fp(null, L[0].sentText)
    && NR.buildNoticeRecord({ rows: L, thread: [] })[0].copies[0].body === L[0].sentText, L[0]);
  await db.doc(`${T}/messageLog/skip1`).set({ id: 'skip1', channel: 'sms', kind: 'renter_client_reminder', to: '+15550102233', status: 'skipped_by_policy', error: 'held until your quiet hours end', held: true, renterId: 'rt2', sentAt: new Date().toISOString() });
  check('a text that never went can’t capture their reply', (await RI.replyOwner(db, 't1', '5550102233')).owner === 'studio');

  await fresh();
  await db.doc(T).set({ messageQuietHours: { enabled: true, startHour: h, endHour: (h + 1) % 24 } }, { merge: true });
  r = await Notify.POST(req({ action: 'renter-message', tenantId: 't1', renterId: 'rt1', text: 'Late night note.', byName: 'Dana Reyes' }));
  await db.doc(T).set({ messageQuietHours: { enabled: false } }, { merge: true });
  await N.releaseHeldTexts(db, 't1', (await get(T)));
  const th2 = await all(`${T}/renterThreads/rt1/messages`);
  let it = NR.buildNoticeRecord({ rows: await logs(), thread: th2 });
  check('a message texted after quiet hours shows one text copy, the one that went', it.length === 1 && it[0].copies.filter((c) => c.channel === 'sms').length === 1 && it[0].copies.find((c) => c.channel === 'sms')?.state === 'sent', it[0]?.copies);

  await fresh();
  await db.doc(T).set({ messageQuietHours: { enabled: true, startHour: h, endHour: (h + 1) % 24 } }, { merge: true });
  await renterSms({ kind: 'rent_overdue', text: 'Your rent is past due.' });
  await db.doc(T).set({ messageQuietHours: { enabled: false } }, { merge: true });
  await N.releaseHeldTexts(db, 't1', (await get(T)), Date.now() + 20 * 3600e3);
  L = await logs();
  it = NR.buildNoticeRecord({ rows: L, thread: [] });
  check('held too long: not sent, the record says why, and it keeps the held entry’s id', texts().length === 0 && L.length === 2 && L[1].heldExpired && it.length === 1 && it[0].id === L[0].id && it[0].copies[0].state === 'not_sent' && /too late/.test(String(it[0].copies[0].why)), { L, it });
  check('a formal one is still in their portal, as not sent', NR.forRenter(it).length === 1 && !NR.forRenter(it)[0].went);

  const shared = { ...r1 };
  check('a message to someone else at the same address (another renter, a prospect) isn’t theirs',
    !NR.belongsToRenter({ to: 'maya@example.com', kind: 'renter_message', recipientType: 'contact', recipientId: 'rt2' }, 'rt1', shared)
    && !NR.belongsToRenter({ to: 'maya@example.com', kind: 'rent_receipt', recipientType: 'other', recipientId: 'rt2' }, 'rt1', shared, new Set(['rt2']))
    && NR.belongsToRenter({ to: 'maya@example.com', kind: 'rent_receipt', recipientType: 'other', recipientId: 'inv_9' }, 'rt1', shared, new Set(['rt2'])));
  await fresh();
  await db.doc(`${T}/renters/rt3`).set({ firstName: 'Mo', lastName: 'Ortiz', email: 'maya@example.com', status: 'active' });
  await db.doc(`${T}/messageLog/other1`).set({ id: 'other1', channel: 'email', kind: 'rent_overdue', to: 'maya@example.com', recipientType: 'other', recipientId: 'rt3', subject: 'Mo is late', body: 'Mo', status: 'sent', sentAt: iso(3600e3) });
  r = await Portal.POST(req({ action: 'notices', tenantId: 't1', token: 'tok' }));
  check('their portal never shows another renter’s mail that shares their email', r.body.ok && !(r.body.items || []).some((i: any) => i.id === 'other1'), r.body);

  const twoCopies = [
    row({ id: 'x1', channel: 'sms', kind: 'renter_charge', to: '+15550102233', body: 'A', sentAt: '2026-11-05T12:00:00Z' }),
    row({ id: 'x2', channel: 'email', kind: 'renter_charge', to: 'maya@example.com', subject: 'Charge', body: 'A', sentAt: '2026-11-05T12:00:30Z' }),
  ];
  check('a notice keeps its id when its second copy lands', NR.buildNoticeRecord({ rows: twoCopies.slice(0, 1) })[0].id === 'x1' && NR.buildNoticeRecord({ rows: twoCopies })[0].id === 'x1');
  const noPhone = [{ id: 'q1', direction: 'outbound', text: 'First note', createdAt: '2026-10-01T12:00:00Z' }, { id: 'q2', direction: 'outbound', text: 'Second note', createdAt: '2026-10-01T12:00:30Z' }];
  const q2text = row({ id: 'qs', channel: 'sms', kind: 'renter_message', to: '+15550102233', body: 'Second note Reply in your portal: x', sentAt: '2026-10-01T12:00:29Z' });
  check('an older text is matched to the message whose words it carries, not just the nearest one', NR.threadCopies(noPhone, [q2text]).get('q2')?.[0]?.id === 'qs' && !NR.threadCopies(noPhone, [q2text]).has('q1'));

  await fresh({ messagePolicy: { renter_paperwork_missing: { smsBody: 'Hi {{renter_first}}, please add your {{document}}: {{link}}' } } });
  t = await RT.textRenter(db, { tenantId: 't1', renterId: 'rt1', renter: await get(`${T}/renters/rt1`), kind: 'renter_paperwork_missing', text: 'x', emailFallback: true, tokens: { renter_first: 'Maya', document: 'insurance', link: 'https://l', studio: 'Northside Studio' } });
  check('missing paperwork has its own message, so the business’s wording for expiring paperwork isn’t used for it', /please add your insurance: https:\/\/l/.test(texts()[0]?.body?.Body || '') && !!MP.MESSAGE_KIND_BY_ID.renter_paperwork_missing && /kind: 'renter_paperwork_missing', emailFallback: true/.test(nightly), texts()[0]?.body);
  check('repairs and day swaps carry the business’s name for its own wording', (maint.match(/studio: String\(\(\(await db\.doc/g) || []).length === 2 && /kind: 'renter_day_swap', phone: target\.phone, text: smsText, tokens: \{ studio: studioName \}/.test(portalSrc));
  check('a rent reminder switched off or refused (STOP) isn’t tried again every night', /else if \(sent\.final\) await inv\.ref\.set\(\{ renterDueNotifiedAt/.test(src('src/app/api/cron/nightly/route.ts')));
  const CR = await import('../../src/lib/code-redact');
  check('a personal portal link in a message is kept with its sign-in hidden', CR.hideCodes('rent_overdue', 'Pay here: https://n.example.com/rent/t1?rt=AbCdEfGhIjKlMnOpQrStUvWx&tab=rent') === 'Pay here: https://n.example.com/rent/t1?rt=••••&tab=rent');

  check('in their own copy that link still opens their portal (they’re signed in there)', NR.plainLinks('Pay: https://n.example.com/rent/t1?rt=••••&tab=rent or https://n.example.com/rent/t1?rt=••••') === 'Pay: https://n.example.com/rent/t1?tab=rent or https://n.example.com/rent/t1'
    && NR.renterView({ ...NR.buildNoticeRecord({ rows: [row({ id: 'k1', channel: 'email', kind: 'rent_overdue', to: 'maya@example.com', subject: 'Late', body: 'Pay: https://n.example.com/rent/t1?rt=••••', sentAt: '2026-11-05T12:00:00Z' })] })[0] }).body === 'Pay: https://n.example.com/rent/t1');
  const quoted = [{ id: 'qq', direction: 'outbound', text: 'Your "Suite 4" key & badge are ready', createdAt: '2026-10-01T12:00:00Z' }];
  check('an older email with quotes or an ampersand still finds its message', NR.threadCopies(quoted, [row({ id: 'qe', channel: 'email', kind: 'renter_message', to: 'maya@example.com', body: 'Hi Maya, Your &quot;Suite 4&quot; key &amp; badge are ready', sentAt: '2026-10-01T12:00:01Z' })]).get('qq')?.[0]?.id === 'qe');

  check('a short message or one in another alphabet matches its own words only', NR.threadCopies([{ id: 'sh', direction: 'outbound', text: 'ok', createdAt: '2026-10-01T12:00:00Z' }], [row({ id: 'sx', channel: 'sms', kind: 'renter_message', to: '+15550102233', body: 'Booking confirmed', sentAt: '2026-10-01T12:00:01Z' })]).size === 0
    && NR.threadCopies([{ id: 'jp', direction: 'outbound', text: 'ありがとう', createdAt: '2026-10-01T12:00:00Z' }], [row({ id: 'jx', channel: 'sms', kind: 'renter_message', to: '+15550102233', body: 'ありがとう Reply in your portal', sentAt: '2026-10-01T12:00:01Z' })]).get('jp')?.[0]?.id === 'jx');
  check('an encoded link keeps working too', NR.plainLinks('x?a=1&amp;rt=••••') === 'x?a=1');

  console.log('Locked');
  const rules = src('firestore.rules');
  check('the message log can only be written by the server', /match \/tenants\/\{tenantId\}\/messageLog\/\{id\} \{\n\s+allow read: if isTeam\(tenantId\);\n\s+allow write: if false;/.test(rules));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
