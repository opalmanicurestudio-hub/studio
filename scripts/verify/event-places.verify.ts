// Checks a guest's own place at a free event (lib/event-places, api/public/event), and what the team sees:
// - Reserving sends a confirmation with a private link to the place (signed; a changed link opens nothing). Reserving
//   again with the same email sends it again to that email (twice an hour at most), adds nothing, and is answered the
//   same as a new reservation, so nobody can test who's coming. An entry from before places had links gets one.
// - The place page shows the event, how many places and a first name, nothing else; no PIN needed (the link is proof).
// - Cancel one place or all of them: the count goes down, the owner is told, and the first person waiting whose party
//   fits gets the place (a bigger party keeps its turn), straight onto the list, emailed with their own link.
// - Give a place to a friend: theirs, with their own link; the meal and allergy answers are cleared; someone already on
//   the list can't be given one; the last place given away ends the giver's link.
// - The waitlist: only for a free event that's full; once per email; a guest already going isn't added; told their
//   number; the waitlist link shows where they are, leaves, or, once their place came through, opens the place.
// - A paid event's tickets aren't changed from a link. A paused business still lets guests see, cancel and leave.
// - The hourly sweep: a reminder the day before (from the business's sending hour, once per party, ticket buyers and
//   older entries too), and waitlists filled from places freed some other way.
// - The pages read through the server only, and the writing rules hold.
// Known and accepted: giving a place to an email already on the list is refused (it would be a second place), so a
// guest with a link could learn that someone is going, a few tries a day per party.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/event-places.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.LINK_SECRET = 'test-link-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
let db: any = strictTransactions(makeDb());
let mails: any[] = []; let mailFails = new Set<string>();
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { if (mailFails.has(m.to)) return { ok: false }; mails.push(m); return { ok: true }; } });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (c: string) => (await db.collection(c).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const guestsOf = async (e: string) => (await all(`${T}/eventGuests`)).filter((g: any) => g.eventId === e);
const linkIn = (m: any) => { const u = String(m?.text || '').match(/https:\/\/app\.test\/event\/t1\/[^\s]+/); return u ? new URL(u[0]) : null; };

(async () => {
  const { POST } = await import('../../src/app/api/public/event/route');
  const { eventGuestSweep } = await import('../../src/lib/event-places');
  const { eventToday } = await import('../../src/lib/studio-page');
  const { addDays } = await import('../../src/lib/tenant-time');
  let ip = '10.1.0.1';
  const call = async (body: any) => { const r: any = await POST({ json: async () => body, headers: { get: (k: string) => (k === 'x-forwarded-for' ? ip : null) }, nextUrl: { origin: 'https://app.test' } } as any); return { status: r.status, ...r.body }; };

  const tenant: any = { name: 'Fern & Co', timezone: 'America/New_York', userId: 'owner1', subscriptionStatus: 'active' };
  await db.doc(T).set(tenant);
  const today = eventToday(tenant); const soon = addDays(today, 5);
  await db.doc(`${T}/studioEvents/ev1`).set({ title: 'Harvest dinner', date: soon, time: '19:00', venue: 'Back garden', capacity: 4, status: 'upcoming', accessPin: '4821' });
  await db.doc(`${T}/eventMenuItems/m1`).set({ id: 'm1', eventId: 'ev1', name: 'Soup', courseNumber: 1 });
  await db.doc(`${T}/studioEvents/ev3`).set({ title: 'Gala', date: soon, status: 'upcoming', capacity: 2, ticketingConfig: { type: 'paid', price: 25 } });

  console.log('Reserving, and the confirmation');
  let r = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Ana Ruiz', email: 'ana@example.com', places: 3 });
  let gs = await guestsOf('ev1');
  const party = gs[0]?.partyId;
  check('three places, one party: the same party on each, the first one hers', r.ok && gs.length === 3 && /^p[a-f0-9]{24}$/.test(party) && gs.every((g: any) => g.partyId === party) && gs.filter((g: any) => g.partyLead).length === 1 && gs.find((g: any) => g.partyLead).email === 'ana@example.com', gs);
  const conf = mails.find((m) => m.to === 'ana@example.com');
  const link = linkIn(conf);
  check('a confirmation goes to her email, with a private link to her place and the meal link', conf?.kind === 'event_place' && /You’re on the list for Harvest dinner/.test(conf.subject) && link?.pathname === '/event/t1/ev1/place' && link?.searchParams.get('p') === party && (link?.searchParams.get('k') || '').length === 32 && /\/rsvp/.test(conf.text) && /3 places under your name/.test(conf.text), conf);
  const k = link!.searchParams.get('k')!;
  mails = [];
  const again = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Someone', email: 'ANA@example.com' });
  const strip = (x: any) => JSON.stringify({ ...x, places: undefined });
  check('the same email again: answered exactly like a new reservation, nothing added, and her confirmation goes again to her', again.ok && again.status === r.status && strip(again) === strip({ ...r, places: undefined }) && (await guestsOf('ev1')).length === 3 && mails.length === 1 && mails[0].to === 'ana@example.com' && linkIn(mails[0])?.searchParams.get('p') === party, { again, mails });
  await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'x', email: 'ana@example.com' });
  await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'x', email: 'ana@example.com' });
  check('…but at most twice an hour, so nobody can fill her inbox', mails.length === 2, mails.length);
  await db.doc(`${T}/eventGuests/old1`).set({ id: 'old1', eventId: 'ev1', tenantId: 't1', name: 'Old Timer', email: 'old@example.com' });
  mails = [];
  await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Old Timer', email: 'old@example.com' });
  const old = await get(`${T}/eventGuests/old1`);
  check('an entry from before places had links gets one, and its link in the email', /^p[a-f0-9]{24}$/.test(old.partyId) && old.partyLead === true && linkIn(mails[0])?.searchParams.get('p') === old.partyId, { old, mails });

  console.log('Her place page');
  let p = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p: party, k });
  check('the link opens her place without the PIN: the event, three places, her first name, and the meal is open', p.ok && p.event.title === 'Harvest dinner' && p.party.places === 3 && p.party.firstName === 'Ana' && p.mealOpen === true && p.block === null, p);
  check('…and nothing about anyone else (no emails, no other names)', !/@|Old Timer|Ruiz/.test(JSON.stringify(p)), p);
  p = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p: party, k: k.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) });
  check('a changed link opens nothing', p.status === 404 && p.gone === true && !p.party, p);
  p = await call({ action: 'cancel', tenantId: 't1', eventId: 'ev1', p: party, k: 'x'.repeat(32), all: true });
  check('…and changes nothing', p.status === 404 && (await guestsOf('ev1')).length === 4, p);

  console.log('The waitlist');
  ip = '10.1.0.9';
  const fullNew = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'New Person', email: 'new@example.com' });
  const fullOld = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'New Person', email: 'old@example.com' });
  check('a full event answers the same for someone already going and someone new (nobody can test who’s coming)', fullNew.status === 409 && JSON.stringify(fullNew) === JSON.stringify(fullOld), { fullNew, fullOld });
  ip = '10.1.0.1';
  await db.doc(`${T}/studioEvents/ev0`).set({ title: 'Open house', date: soon, status: 'upcoming' });
  r = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev0', name: 'Kim', email: 'kim@example.com' });
  check('an event with no set number of places has no waitlist', r.status === 409, r);
  await db.doc(`${T}/studioEvents/ev9`).set({ title: 'Small table', date: soon, status: 'upcoming', capacity: 2 });
  await db.doc(`${T}/eventGuests/s1`).set({ id: 's1', eventId: 'ev9', name: 'A' }); await db.doc(`${T}/eventGuests/s2`).set({ id: 's2', eventId: 'ev9', name: 'B' });
  r = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev9', name: 'Big Group', email: 'big@example.com', places: 3 });
  check('a party bigger than the whole event can’t join its waitlist (it could never get in)', r.status === 400 && !(await all(`${T}/eventWaitlist`)).length, r);
  r = await call({ action: 'load', tenantId: 't1', eventId: 'ev1', pin: '4821' });
  check('full now (four of four): the event page offers the waitlist', r.reserve.placesLeft === 0 && r.reserve.waitlist === true, r.reserve);
  mails = [];
  r = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev1', name: 'Kim Ode', email: 'kim@example.com', places: 2 });
  check('a private event’s waitlist needs its PIN too', r.status === 403 && r.needsPin, r);
  r = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Kim Ode', email: 'kim@example.com', places: 2 });
  ip = '10.1.0.2';
  await new Promise((res) => setTimeout(res, 5));
  const r2 = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Lee Park', email: 'lee@example.com', places: 1 });
  let wl = (await all(`${T}/eventWaitlist`)).sort((a: any, b: any) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  const wmail = mails.find((m) => m.to === 'lee@example.com');
  check('two join: Kim (2 places) then Lee (1), each told their number with a link to leave', r.ok && r2.ok && r.waitlisted && wl.length === 2 && wl[0].name === 'Kim Ode' && wl[1].places === 1
    && /number 2/.test(wmail?.text || '') && linkIn(wmail)?.searchParams.get('w') === wl[1].id, { wl, wmail });
  r = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Kim', email: 'kim@example.com' });
  const r3 = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Ana', email: 'ana@example.com' });
  check('the same email again, or someone already going: answered the same, nothing added', r.ok && r3.ok && (await all(`${T}/eventWaitlist`)).length === 2, null);
  r = await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev3', name: 'Kim', email: 'kim@example.com' });
  check('a paid event has no waitlist here', r.status === 409 && (await all(`${T}/eventWaitlist`)).length === 2, r);
  const wk = linkIn(wmail)!.searchParams.get('k')!;
  r = await call({ action: 'waitspot', tenantId: 't1', eventId: 'ev1', w: wl[1].id, k: wk });
  check('Lee’s waitlist link: number 2, one place, first name only', r.ok && r.waiting.position === 2 && r.waiting.places === 1 && r.waiting.firstName === 'Lee' && !/lee@/.test(JSON.stringify(r)), r);

  console.log('Cancelling, and the next person in');
  mails = [];
  r = await call({ action: 'cancel', tenantId: 't1', eventId: 'ev1', p: party, k, all: false });
  gs = await guestsOf('ev1');
  const lee = gs.find((g: any) => g.name === 'Lee Park');
  check('one of Ana’s places canceled (a guest’s, not hers): two left, and her link still works', r.ok && r.cancelled === 1 && r.remaining === 2 && gs.filter((g: any) => g.partyId === party).length === 2 && gs.some((g: any) => g.partyId === party && g.partyLead), r);
  check('the freed place goes to Lee (Kim’s party of two doesn’t fit, and keeps her turn), with his own place and link', !!lee && lee.source === 'waitlist' && lee.partyLead === true && /^p[a-f0-9]{24}$/.test(lee.partyId)
    && (await all(`${T}/eventWaitlist`)).filter((w: any) => w.status !== 'moved').map((w: any) => w.name).join() === 'Kim Ode'
    && /A place opened up/.test(mails.find((m) => m.to === 'lee@example.com')?.subject || '') && linkIn(mails.find((m) => m.to === 'lee@example.com'))?.searchParams.get('p') === lee.partyId, { lee, mails });
  check('the count is the real number on the list, and the owner is told both', (await get(`${T}/studioEvents/ev1`)).rsvpCount === (await guestsOf('ev1')).length && (await all(`${T}/notifications`)).some((n: any) => /Ana Ruiz canceled one of their places/.test(n.message)) && (await all(`${T}/notifications`)).some((n: any) => /Lee Park moved from the waitlist/.test(n.message)), await all(`${T}/notifications`));
  r = await call({ action: 'waitspot', tenantId: 't1', eventId: 'ev1', w: wl[1].id, k: wk });
  check('Lee’s old waitlist link now opens his place', r.ok && r.moved?.p === lee.partyId && (r.moved?.k || '').length === 32, r);

  console.log('Giving a place to a friend');
  await db.doc(`${T}/eventGuests/${gs.find((g: any) => g.partyId === party && !g.partyLead).id}`).set({ mealChoiceId: 'm1', mealChoiceName: 'Soup', allergies: [{ id: 'nuts', label: 'Tree nuts' }], allergyNote: 'severe', checkedIn: true, notes: 'VIP, Ana’s sister', clientId: 'c9', tableNumber: 'Table 2', seatNumber: 'B' }, { merge: true });
  r = await call({ action: 'give', tenantId: 't1', eventId: 'ev1', p: party, k, name: 'Lee Park', email: 'lee@example.com' });
  check('someone already on the list can’t be given a place (said without saying they’re going)', r.status === 409 && /couldn’t give the place to that email/.test(r.error) && !/already/.test(r.error), r);
  mails = [];
  r = await call({ action: 'give', tenantId: 't1', eventId: 'ev1', p: party, k, name: 'Mo Diaz', email: 'mo@example.com', phone: '555-0199' });
  gs = await guestsOf('ev1');
  const mo = gs.find((g: any) => g.email === 'mo@example.com');
  check('one of Ana’s places becomes Mo’s: his name, his own party, and none of the last person’s meal or allergy answers', r.ok && r.friend === 'Mo' && r.remaining === 1 && mo && mo.partyId !== party && mo.partyLead === true
    && mo.mealChoiceId === null && (mo.allergies || []).length === 0 && mo.allergyNote === null && mo.givenBy === 'Ana Ruiz', mo);
  check('…nor the last person’s check-in, the host’s notes about them or their client record; the host’s seat stays', mo.checkedIn === false && mo.notes === '' && mo.clientId === null && mo.tableNumber === 'Table 2' && mo.seatNumber === 'B', mo);
  check('…Mo gets his confirmation with his own link', /You have a place at Harvest dinner/.test(mails[0]?.subject || '') && mails[0].to === 'mo@example.com' && linkIn(mails[0])?.searchParams.get('p') === mo.partyId && /Ana gave you their place/.test(mails[0].text), mails);
  r = await call({ action: 'give', tenantId: 't1', eventId: 'ev1', p: party, k, name: 'Zoe', email: 'zoe@example.com' });
  gs = await guestsOf('ev1');
  check('her last place given away: it’s Zoe’s now, and Ana’s link opens nothing', r.ok && r.remaining === 0 && gs.some((g: any) => g.email === 'zoe@example.com' && g.partyLead) && !gs.some((g: any) => g.partyId === party), r);
  p = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p: party, k });
  check('…her page says so', p.ok && p.gone === true, p);

  console.log('Cancelling everything, leaving the waitlist');
  const moLink = linkIn(mails[0])!;
  r = await call({ action: 'cancel', tenantId: 't1', eventId: 'ev1', p: moLink.searchParams.get('p'), k: moLink.searchParams.get('k'), all: true });
  check('Mo cancels his place; Kim’s party of two still doesn’t fit (one free), so she keeps waiting', r.ok && r.remaining === 0 && (await all(`${T}/eventWaitlist`)).some((w: any) => w.name === 'Kim Ode' && w.status !== 'moved'), r);
  r = await call({ action: 'cancel', tenantId: 't1', eventId: 'ev1', p: moLink.searchParams.get('p'), k: moLink.searchParams.get('k'), all: true });
  check('cancelling again changes nothing', r.ok && r.cancelled === 0, r);
  const kim = (await all(`${T}/eventWaitlist`)).find((w: any) => w.name === 'Kim Ode');
  const { waitKey } = await import('../../src/lib/event-places');
  r = await call({ action: 'leave', tenantId: 't1', eventId: 'ev1', w: kim.id, k: waitKey('t1', 'ev1', kim.id) });
  check('Kim leaves the waitlist from her link', r.ok && r.left && !(await all(`${T}/eventWaitlist`)).some((w: any) => w.id === kim.id), r);

  console.log('A paid event, and a paused business');
  await db.doc(`${T}/eventGuests/t9`).set({ id: 't9', eventId: 'ev3', tenantId: 't1', name: 'Tia', email: 'tia@example.com', partyId: 'p' + 'a'.repeat(24), partyLead: true, source: 'ticket' });
  const { placeKey } = await import('../../src/lib/event-places');
  r = await call({ action: 'cancel', tenantId: 't1', eventId: 'ev3', p: 'p' + 'a'.repeat(24), k: placeKey('t1', 'ev3', 'p' + 'a'.repeat(24)), all: true });
  check('tickets for a paid event aren’t changed from a link', r.status === 409 && /changed by the business/.test(r.error) && !!(await get(`${T}/eventGuests/t9`)), r);
  await db.doc(T).set({ accessLocked: true, accessLockedAt: new Date().toISOString() }, { merge: true });
  const zoe = (await guestsOf('ev1')).find((g: any) => g.email === 'zoe@example.com');
  p = await call({ action: 'place', tenantId: 't1', eventId: 'ev1', p: zoe.partyId, k: placeKey('t1', 'ev1', zoe.partyId) });
  const gz = await call({ action: 'give', tenantId: 't1', eventId: 'ev1', p: zoe.partyId, k: placeKey('t1', 'ev1', zoe.partyId), name: 'Q', email: 'q@example.com' });
  check('a paused business: a guest can still see their place, but not give it away', p.ok && p.party?.firstName === 'Zoe' && gz.status === 403, { p, gz });
  // Cancelled while paused: the place is freed, but nobody is moved in or emailed until the business is open again.
  await db.doc(`${T}/eventWaitlist/w${'d'.repeat(24)}`).set({ id: `w${'d'.repeat(24)}`, eventId: 'ev1', tenantId: 't1', name: 'Pat Moe', email: 'pat@example.com', places: 1, joinedAt: new Date().toISOString(), status: 'waiting' });
  mails = [];
  r = await call({ action: 'cancel', tenantId: 't1', eventId: 'ev1', p: zoe.partyId, k: placeKey('t1', 'ev1', zoe.partyId), all: true });
  check('a paused business: a guest can still cancel, but nobody is moved in from the waitlist meanwhile', r.ok && r.cancelled === 1 && !(await guestsOf('ev1')).some((g: any) => g.name === 'Pat Moe') && !mails.some((m) => m.to === 'pat@example.com'), r);
  const lockedSweep = await eventGuestSweep(db, 't1', { ...tenant, accessLocked: true, accessLockedAt: 'x' });
  check('…and the hourly sweep does nothing for a paused business', lockedSweep.promoted === 0 && lockedSweep.reminded === 0, lockedSweep);
  await db.doc(T).set({ accessLocked: false, accessLockedAt: null }, { merge: true });
  const openSweep = await eventGuestSweep(db, 't1', tenant);
  check('…once it’s open again, the sweep moves the next person in', openSweep.promoted === 1 && (await guestsOf('ev1')).some((g: any) => g.name === 'Pat Moe' && g.source === 'waitlist'), openSweep);
  check('the event’s count is the real number on the list', (await get(`${T}/studioEvents/ev1`)).rsvpCount === (await guestsOf('ev1')).length, [(await get(`${T}/studioEvents/ev1`)).rsvpCount, (await guestsOf('ev1')).length]);

  // Someone waiting who got on the list another way (the team added them) comes off the waitlist, never a second place.
  await db.doc(`${T}/eventWaitlist/w${'e'.repeat(24)}`).set({ id: `w${'e'.repeat(24)}`, eventId: 'ev1', tenantId: 't1', name: 'Kai Ro', email: 'kai@example.com', places: 1, joinedAt: new Date().toISOString(), status: 'waiting' });
  await db.doc(`${T}/eventGuests/kai`).set({ id: 'kai', eventId: 'ev1', tenantId: 't1', name: 'Kai Ro', email: 'kai@example.com' });
  const pat = (await guestsOf('ev1')).find((g: any) => g.name === 'Pat Moe');
  await call({ action: 'cancel', tenantId: 't1', eventId: 'ev1', p: pat.partyId, k: placeKey('t1', 'ev1', pat.partyId), all: true });
  check('someone waiting who is already on the list comes off the waitlist instead of getting a second place', (await guestsOf('ev1')).filter((g: any) => g.email === 'kai@example.com').length === 1 && !(await all(`${T}/eventWaitlist`)).some((w: any) => w.email === 'kai@example.com'), null);

  // Places freed while people wait: someone new reserving waits behind them.
  await db.doc(`${T}/eventWaitlist/w${'f'.repeat(24)}`).set({ id: `w${'f'.repeat(24)}`, eventId: 'ev1', tenantId: 't1', name: 'Ivy Fox', email: 'ivy@example.com', places: 1, joinedAt: new Date().toISOString(), status: 'waiting' });
  const free = 4 - (await guestsOf('ev1')).length;
  ip = '10.1.0.20';
  r = await call({ action: 'load', tenantId: 't1', eventId: 'ev1', pin: '4821' });
  check('the event page counts the places the people waiting are next in line for', r.reserve.placesLeft === Math.max(0, free - 1), { free, reserve: r.reserve });
  r = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev1', pin: '4821', name: 'Walk Up', email: 'walk@example.com', places: free });
  check('…and a new reservation for every free place: Ivy gets hers first, and the reservation is told how many are left', r.status === 409 && (await guestsOf('ev1')).some((g: any) => g.name === 'Ivy Fox') && !(await guestsOf('ev1')).some((g: any) => g.name === 'Walk Up'), r);
  ip = '10.1.0.1';

  console.log('The hourly sweep');
  mails = [];
  const tomorrow = addDays(today, 1);
  await db.doc(`${T}/studioEvents/ev7`).set({ title: 'Tasting', date: tomorrow, time: '18:00', status: 'upcoming', capacity: 3 });
  await db.doc(`${T}/eventGuests/r1`).set({ id: 'r1', eventId: 'ev7', name: 'Rae Lin', email: 'rae@example.com', partyId: 'p' + 'b'.repeat(24), partyLead: true });
  await db.doc(`${T}/eventGuests/r2`).set({ id: 'r2', eventId: 'ev7', name: 'Rae Lin (guest 1)', email: '', partyId: 'p' + 'b'.repeat(24), partyLead: false });
  await db.doc(`${T}/eventGuests/r3`).set({ id: 'r3', eventId: 'ev7', name: 'Tom Old', email: 'tom@example.com' });
  await db.doc(`${T}/eventGuests/r4`).set({ id: 'r4', eventId: 'ev7', name: 'Tia Buy', email: 'tia@example.com', source: 'ticket' });
  mailFails = new Set(['tia@example.com']);
  const at = (h: number) => { const d = new Date(`${today}T00:00:00Z`); const off = -new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime() + new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime(); return new Date(d.getTime() - off + h * 3600000); };
  let sw = await eventGuestSweep(db, 't1', tenant, at(7));
  check('before the sending hour: no reminders', sw.reminded === 0 && mails.length === 0, sw);
  sw = await eventGuestSweep(db, 't1', tenant, at(10));
  check('the day before, after the sending hour: one reminder per party (and the older entry), none for her guest', sw.reminded === 2 && !(await get(`${T}/eventGuests/r4`)).reminderSentAt && mails.filter((m) => m.to === 'rae@example.com').length === 1 && mails.some((m) => m.to === 'tom@example.com') && /See you tomorrow/.test(mails[0].subject), mails);
  check('…Rae’s has her place link; Tom’s, from before links, doesn’t', linkIn(mails.find((m) => m.to === 'rae@example.com'))?.searchParams.get('p') === 'p' + 'b'.repeat(24) && !linkIn(mails.find((m) => m.to === 'tom@example.com')), null);
  mailFails = new Set();
  sw = await eventGuestSweep(db, 't1', tenant, at(11));
  check('…only once each, and a reminder that didn’t go (a ticket buyer’s) goes on the next run', sw.reminded === 1 && mails.filter((m) => m.to === 'rae@example.com').length === 1 && mails.some((m) => m.to === 'tia@example.com'), sw);
  sw = await eventGuestSweep(db, 't1', tenant, at(20));
  check('…and nothing after 8pm', sw.reminded === 0, sw);
  // A place freed some other way (the team removed someone): filled within the hour.
  await db.doc(`${T}/eventGuests/r3`).delete(); await db.doc(`${T}/eventGuests/r4`).delete();
  await db.doc(`${T}/eventWaitlist/w${'c'.repeat(24)}`).set({ id: `w${'c'.repeat(24)}`, eventId: 'ev7', tenantId: 't1', name: 'Uma Sol', email: 'uma@example.com', places: 1, joinedAt: new Date().toISOString(), status: 'waiting' });
  mails = [];
  sw = await eventGuestSweep(db, 't1', tenant, at(12));
  check('a place freed some other way goes to the next person waiting, who’s emailed', sw.promoted === 1 && (await guestsOf('ev7')).some((g: any) => g.name === 'Uma Sol' && g.source === 'waitlist') && mails.some((m) => m.to === 'uma@example.com' && /A place opened up/.test(m.subject)), sw);

  console.log('Edge cases from review');
  // Someone waiting reserves in the very call that moves them in: one place, theirs, and their waitlist link still works.
  await db.doc(`${T}/studioEvents/ev10`).set({ title: 'Duo', date: soon, status: 'upcoming', capacity: 2 });
  await db.doc(`${T}/eventGuests/d1`).set({ id: 'd1', eventId: 'ev10', name: 'First One', email: 'first@example.com' });
  await db.doc(`${T}/eventGuests/d2`).set({ id: 'd2', eventId: 'ev10', name: 'Second One', email: 'second@example.com' });
  const wid = `w${'1'.repeat(24)}`;
  await db.doc(`${T}/eventWaitlist/${wid}`).set({ id: wid, eventId: 'ev10', tenantId: 't1', name: 'Gia Wren', email: 'gia@example.com', places: 1, joinedAt: new Date().toISOString(), status: 'waiting' });
  await db.doc(`${T}/eventGuests/d2`).delete();
  ip = '10.5.0.1';
  r = await call({ action: 'reserve', tenantId: 't1', eventId: 'ev10', name: 'Gia Wren', email: 'gia@example.com' });
  check('someone waiting who reserves in the call that moves them in: one place, theirs, and their waitlist entry marked moved', r.ok && (await guestsOf('ev10')).filter((g: any) => g.email === 'gia@example.com').length === 1 && (await get(`${T}/eventWaitlist/${wid}`))?.status === 'moved', { r, list: await guestsOf('ev10') });
  r = await call({ action: 'leave', tenantId: 't1', eventId: 'ev10', w: wid, k: waitKey('t1', 'ev10', wid) });
  check('…leaving the waitlist after the place came through: told it did, with the place’s own link', r.ok && /^p[a-f0-9]{24}$/.test(r.moved?.p || '') && !r.left, r);
  // A reminder still reaches someone whose address was typed in a lot today.
  const { createHash: ch } = await import('crypto');
  await db.doc(`rateLimits/event-mail_${ch('sha256').update('t1|rae2@example.com').digest('hex').slice(0, 32)}_${Math.floor(Date.now() / 86400000)}`).set({ count: 99 });
  await db.doc(`${T}/studioEvents/ev11`).set({ title: 'Brunch', date: tomorrow, status: 'upcoming' });
  await db.doc(`${T}/eventGuests/b1`).set({ id: 'b1', eventId: 'ev11', name: 'Rae Two', email: 'rae2@example.com', partyId: 'p' + 'c'.repeat(24), partyLead: true });
  mails = [];
  await eventGuestSweep(db, 't1', tenant, at(14));
  check('a reminder isn’t held back by emails other people typed that address into', mails.some((m) => m.to === 'rae2@example.com' && /See you tomorrow/.test(m.subject)), mails.map((m) => m.to));
  ip = '10.1.0.1';

  console.log('Links on a live site, and emails per address');
  process.env.VERCEL_ENV = 'preview'; const keep = process.env.LINK_SECRET; delete process.env.LINK_SECRET;
  const { placeKeyOk } = await import('../../src/lib/event-places');
  const forged = (await import('../../src/lib/portal-key')).portalKey('t1', `event-place:ev1:p${'b'.repeat(24)}`);
  check('on a live site without the real secret, no place link is made or accepted (a stand-in secret would be guessable)', placeKey('t1', 'ev1', 'p' + 'b'.repeat(24)) === null && !placeKeyOk('t1', 'ev1', 'p' + 'b'.repeat(24), forged), forged);
  delete process.env.VERCEL_ENV; process.env.LINK_SECRET = keep;
  mails = [];
  for (let i = 0; i < 4; i++) { ip = `10.2.0.${i}`; await call({ action: 'reserve', tenantId: 't1', eventId: 'ev0', name: `Spam ${i}`, email: 'victim@example.com' }); }
  for (let i = 0; i < 4; i++) { ip = `10.3.0.${i}`; await call({ action: 'waitlist', tenantId: 't1', eventId: 'ev1', pin: '4821', name: `Spam ${i}`, email: 'victim@example.com' }); }
  await db.doc(`${T}/studioEvents/ev8`).set({ title: 'Another', date: soon, status: 'upcoming' });
  for (let i = 0; i < 4; i++) { ip = `10.4.0.${i}`; await call({ action: 'reserve', tenantId: 't1', eventId: 'ev8', name: `Spam ${i}`, email: 'victim@example.com' }); }
  check('one address gets at most five of these emails a day from a business, whoever types it', mails.filter((m) => m.to === 'victim@example.com').length <= 5, mails.filter((m) => m.to === 'victim@example.com').length);

  console.log('The pages');
  const place = readFileSync('src/app/event/[tenantId]/[eventId]/place/page.tsx', 'utf8');
  const evPage = readFileSync('src/app/event/[tenantId]/[eventId]/page.tsx', 'utf8');
  const manifest = readFileSync('src/app/(app)/events/[eventId]/manifest/page.tsx', 'utf8');
  const lib = readFileSync('src/lib/event-places.ts', 'utf8');
  check('the place page reads and changes only through the server', /askEvent\(/.test(place) && !/firebase/.test(place) && /action: 'cancel'/.test(place) && /action: 'give'/.test(place) && /action: 'leave'/.test(place));
  check('the event page offers the waitlist when full, and says the confirmation is coming', /action: full \? 'waitlist' : 'reserve'/.test(evPage) && /Join the waitlist/.test(evPage) && /Your confirmation is on its way by email/.test(evPage));
  check('the team sees the waitlist on the guest list, in order, and can take someone off', /eventWaitlist/.test(manifest) && /aria-label="Waitlist"/.test(manifest) && /setRemovingWait/.test(manifest));
  const section = manifest.slice(manifest.indexOf('aria-label="Waitlist"') - 200, manifest.indexOf('aria-label="Waitlist"') + 3200);
  const strs = (x: string) => (x.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) || []).map((q) => q.slice(1, -1)).filter((q) => q !== 'cancelled' && !/^@\//.test(q));
  const words = /\b(studio|salon|stylist|chair|booth)\b/i;
  check('writing rules in the new parts: no uppercase, no comment blocks in markup, no “call us”, US spelling, no business-type words',
    ![place, section].some((x) => /\buppercase\b|\{\/\*|call us|contact us/i.test(x)) && ![place, lib, section].some((x) => strs(x).some((q) => /cancelled/i.test(q) || words.test(q))),
    [place, lib, section].flatMap((x) => strs(x).filter((q) => /cancelled/i.test(q) || words.test(q))));
  const tools = [['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join(''));
  check('names no outside tool', !new RegExp(tools.join('|'), 'i').test(place + lib + evPage));

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('event-places ok');
})();
