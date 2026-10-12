// scripts/verify/waitlist.verify.ts — checks the waitlist v2 rules (lib/waitlist-engine) and the server half
// (lib/waitlist-server) against an in-memory database, with the booking engine stood in for.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/waitlist.verify.ts
import { makeDb, check, failures } from './fake-db';

const DAY = 864e5, H = 3600e3, MIN = 60000;
const at = (s: string) => Date.parse(s);
const NOW = at('2026-10-14T12:00:00-04:00');            // Wednesday noon, New York
const THU2 = '2026-10-15T18:00:00.000Z';                 // Thursday 2:00 pm New York — 26 hours away
const THU3 = '2026-10-15T19:00:00.000Z';

(async () => {
  const E = await import('../../src/lib/waitlist-engine');
  const W = await import('../../src/lib/waitlist-server');
  console.log('Waitlist — the rules');
  check('more than a day away → one at a time; later today → first to tap; under an hour → the desk',
    E.offerModeFor(NOW + 26 * H, NOW) === 'one' && E.offerModeFor(NOW + 3 * H, NOW) === 'first' && E.offerModeFor(NOW + 40 * MIN, NOW) === 'desk');
  check('the days and times they gave (none = any time)', E.windowFits({ 4: ['afternoon'] }, 4, 14) && !E.windowFits({ 4: ['afternoon'] }, 4, 10) && !E.windowFits({ 4: ['afternoon'] }, 5, 14) && E.windowFits(null, 2, 9));
  const op = { id: 'o', staffId: 'maya', start: THU2, end: THU3, minutes: 60, chainDepth: 0 };
  const base = { now: NOW, tz: { weekday: 4, hour: 14, date: '2026-10-15' }, serviceMinutes: 60, shortest: 30, bookable: true, sameDayBooked: false };
  check('a 45-minute service in a 60-minute opening would leave 15 nobody can book → not offered', !E.fitFor({ id: 'i', status: 'waiting' }, op, { ...base, serviceMinutes: 45 }).ok);
  check('a 30-minute service leaves 30 — something else can still go there → fine', E.fitFor({ id: 'i', status: 'waiting' }, op, { ...base, serviceMinutes: 30 }).ok);
  check('wants someone else, needs more notice, past their date, booked that day → not offered',
    !E.fitFor({ id: 'a', status: 'waiting', staffId: 'jo' }, op, base).ok && !E.fitFor({ id: 'b', status: 'waiting', noticeHours: 48 } as any, op, base).ok
    && !E.fitFor({ id: 'c', status: 'waiting', until: '2026-10-14' }, op, base).ok && !E.fitFor({ id: 'd', status: 'waiting' }, op, { ...base, sameDayBooked: true }).ok);
  check('someone who misses visits isn’t offered a same-day time — but is with more notice',
    !E.fitFor({ id: 'e', status: 'waiting', reliability: 'misses' }, { ...op, start: new Date(NOW + 5 * H).toISOString() }, base).ok && E.fitFor({ id: 'e', status: 'waiting', reliability: 'misses' }, op, base).ok);
  check('move up: only if the time it frees is 3+ days away or someone new wants it, and two moves at most',
    E.moveUpOk(op, NOW + 15 * DAY, NOW, false).ok && !E.moveUpOk(op, NOW + 2 * DAY, NOW, false).ok && E.moveUpOk(op, NOW + 2 * DAY, NOW, true).ok && !E.moveUpOk({ ...op, chainDepth: 2 }, NOW + 15 * DAY, NOW, false).ok);
  const r = E.rank([{ e: { id: 'sam', kind: 'sooner', createdAt: '2026-09-01' }, leftover: 0 }, { e: { id: 'jen', createdAt: '2026-10-10' }, leftover: 0 }, { e: { id: 'priya', staffId: 'maya', createdAt: '2026-10-05' }, leftover: 0 }, { e: { id: 'old', createdAt: '2026-09-20' }, leftover: 30 }] as any);
  check('order: asked for that provider → no leftover → waited longest → someone moving up last', r.map((x) => x.e.id).join() === 'priya,jen,old,sam', r.map((x) => x.e.id));

  console.log('Waitlist — the server');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  for (const sv of [{ id: 'gel', name: 'Gel fill', duration: 60, price: 65 }]) await db.doc(`${T}/services/${sv.id}`).set(sv);
  await db.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes', role: 'stylist' }); await db.doc(`${T}/staff/jo`).set({ id: 'jo', name: 'Jo Park', role: 'front_desk' });
  const services = [{ id: 'gel', name: 'Gel fill', duration: 60, price: 65 }, { id: 'polish', name: 'Polish change', duration: 30, price: 25 }, { id: 'express', name: 'Express fill', duration: 45, price: 45 }];
  const sent: any[] = []; const booked: any[] = [];
  const deps: any = { send: async (_d: any, _t: string, to: string, body: string) => { sent.push({ to, body }); return { ok: true }; },
    book: async (_t: any, body: any) => { booked.push(body); return { ok: true, appointmentId: `new${booked.length}`, status: 'confirmed' }; },
    engine: async () => ({ services, staff: [{ id: 'maya', name: 'Maya Reyes' }], tz: 'America/New_York' }),
    openTimes: (_e: any, o: any) => [{ startIso: THU2 }, { startIso: '2026-10-16T14:00:00.000Z' }, { startIso: '2026-10-14T15:00:00.000Z' }, { startIso: '2026-10-14T16:40:00.000Z' }, { startIso: '2026-10-14T19:00:00.000Z' }] };
  // Ana cancels Thursday 2:00 with Maya
  await db.doc(`${T}/appointments/ana`).set({ id: 'ana', clientId: 'ana', clientName: 'Ana Ruiz', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: THU2, endTime: THU3, status: 'cancelled', cancelledAt: new Date(NOW - 10 * MIN).toISOString() });
  // Sam is booked Oct 29 and tapped "come in sooner"
  await db.doc(`${T}/appointments/sam`).set({ id: 'sam', clientId: 'sam', clientName: 'Sam Taylor', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: '2026-10-29T18:00:00.000Z', endTime: '2026-10-29T19:00:00.000Z', status: 'confirmed', checkInToken: 'tokSam' });
  await db.doc(`${T}/clients/sam`).set({ name: 'Sam Taylor', phone: '+15550002' });
  const so = await W.soonerFor(db, 't1', 'tokSam', true, false, NOW);
  check('“come in sooner” from the visit link puts them on the same list', so.ok && (await db.collection(`${T}/waitlist`).get()).docs.some((d: any) => d.data().kind === 'sooner'));
  const wl = (id: string, d: any) => db.doc(`${T}/waitlist/${id}`).set({ id, status: 'waiting', ...d });
  await wl('priya', { name: 'Priya Shah', phone: '+15550003', serviceId: 'gel', staffId: 'maya', windows: { 4: ['afternoon'] }, noticeHours: 3, createdAt: '2026-10-05T12:00:00Z' });
  await wl('jen', { name: 'Jen Alvarez', phone: '+15550004', serviceId: 'gel', createdAt: '2026-10-10T12:00:00Z' });
  await wl('ivy', { name: 'Ivy Chen', phone: '+15550005', serviceId: 'express', createdAt: '2026-10-01T12:00:00Z' });
  await wl('dana', { name: 'Dana Kim', phone: '+15550006', serviceId: 'gel', windows: { 6: ['morning'] }, createdAt: '2026-09-28T12:00:00Z' });
  const ten = (await db.doc(T).get()).data();
  const s1: any = await W.waitlistSweep(db, 't1', ten, NOW, deps);
  const op1: any = (await db.doc(`${T}/openings/op_ana`).get()).data();
  check('Ana’s cancel became an opening', op1 && op1.minutes === 60 && op1.staffId === 'maya');
  check('26 hours away → offered to ONE person: Priya (asked for Maya, Thursday afternoons, waited longest)', s1.sent === 1 && sent[0]?.to === '+15550003' && /yours for the next 30 minutes/.test(sent[0].body) && sent[0].body.includes('https://opal.example/w/t1/op_ana.'), { s1, sent });
  const m1 = await W.matchesFor(db, 't1', op1, NOW, deps);
  check('Ivy’s 45-minute service isn’t offered — it would leave a 15-minute scrap', m1.not.some((x: any) => x.e.id === 'ivy' && /15 min/.test(x.why)), m1.not);
  check('Dana only comes Saturday mornings — not offered', m1.not.some((x: any) => x.e.id === 'dana'));
  check('Sam (move up) is on the list too, after people with no booking', m1.fits.map((f: any) => f.e.kind === 'sooner' ? 'sam' : f.e.id).join() === 'jen,sam', m1.fits.map((f: any) => f.e.id));
  const s2: any = await W.waitlistSweep(db, 't1', ten, NOW + 10 * MIN, deps);
  check('while Priya’s 30 minutes run, nobody else is texted', s2.sent === 0 && sent.length === 1);
  const s3: any = await W.waitlistSweep(db, 't1', ten, NOW + 31 * MIN, deps);
  check('her time ran out → the next person (Jen) gets it', s3.sent === 1 && sent[1]?.to === '+15550004', sent);
  const priyaTok = (await db.doc(`${T}/openings/op_ana`).get()).data().offers.find((f: any) => f.entryId === 'priya').token;
  const jenTok = (await db.doc(`${T}/openings/op_ana`).get()).data().offers.find((f: any) => f.entryId === 'jen').token;
  const late: any = await W.takeOffer(db, 't1', priyaTok, NOW + 35 * MIN, deps);
  check('Priya taps after her time — it’s being held for Jen now; she stays on the list', !late.ok && /held for someone else/.test(late.error));
  const v: any = await W.viewOffer(db, 't1', jenTok, NOW + 36 * MIN);
  check('Jen’s link shows the time, the service, the price, and that it’s hers', v.ok && v.state === 'open' && v.service === 'Gel fill' && v.price === '$65' && /Thursday/.test(v.when), v);
  const take: any = await W.takeOffer(db, 't1', jenTok, NOW + 37 * MIN, deps);
  const op2: any = (await db.doc(`${T}/openings/op_ana`).get()).data();
  check('Jen taps → booked through the booking engine for Maya, Thursday 2:00, from the waitlist', take.ok && booked[0]?.source === 'waitlist' && booked[0]?.staffId === 'maya' && booked[0]?.startTime === THU2 && op2.status === 'filled', { take, booked });
  check('her list entry is booked', (await db.doc(`${T}/waitlist/jen`).get()).data()?.status === 'booked');
  const again: any = await W.takeOffer(db, 't1', priyaTok, NOW + 38 * MIN, deps);
  check('anyone else tapping now hears it’s gone — before any card is touched', !again.ok && again.taken && booked.length === 1);

  // Moving up: Maya's Friday 10:00 opens (Bo cancels); only Sam fits (he wants Maya; Priya and Jen don't fit Friday morning / are booked)
  await db.doc(`${T}/waitlist/priya`).set({ status: 'closed' }, { merge: true });
  await db.doc(`${T}/appointments/bo`).set({ id: 'bo', clientId: 'bo', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: '2026-10-16T14:00:00.000Z', endTime: '2026-10-16T15:00:00.000Z', status: 'cancelled', cancelledAt: new Date(NOW).toISOString() });
  const before = sent.length;
  await W.waitlistSweep(db, 't1', ten, NOW + 40 * MIN, deps);
  const samOffer = sent.slice(before).find((x) => x.to === '+15550002');
  check('Sam gets “a sooner time opened … instead of …” — his time stays if he says no', !!samOffer && /sooner time opened/.test(samOffer.body) && /your time stays/.test(samOffer.body), sent.slice(before));
  const samTok = (await db.doc(`${T}/openings/op_bo`).get()).data().offers.find((f: any) => f.kind === 'sooner').token;
  const mv: any = await W.takeOffer(db, 't1', samTok, NOW + 45 * MIN, deps);
  const samA: any = (await db.doc(`${T}/appointments/sam`).get()).data();
  check('Sam taps → his own visit moves to Friday 10:00 (same booking, same deposit)', mv.ok && mv.sooner && samA.startTime === '2026-10-16T14:00:00.000Z' && samA.previousStartTime === '2026-10-29T18:00:00.000Z', samA);
  const freed: any = (await db.collection(`${T}/openings`).get()).docs.map((d: any) => d.data()).find((o: any) => o.source === 'moveup');
  check('the time he left (Oct 29) becomes the next opening — one move along the chain', freed && freed.start === '2026-10-29T18:00:00.000Z' && freed.chainDepth === 1, freed);
  check('the check-in link shows his new time too', (await db.doc(`${T}/appointmentCheckIns/tokSam`).get()).data()?.startTime === '2026-10-16T14:00:00.000Z');

  // Same day → first to tap, three at once; under an hour → the desk; at night → nothing
  const db2 = makeDb(); await db2.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  await db2.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes', role: 'stylist' }); await db2.doc(`${T}/staff/jess`).set({ id: 'jess', name: 'Jessica', role: 'owner' });
  for (const [i, n] of ['a', 'b', 'c', 'd'].entries()) await db2.doc(`${T}/waitlist/${n}`).set({ id: n, status: 'waiting', name: `Person ${n}`, phone: `+1555010${i}`, serviceId: 'gel', noticeHours: 1, createdAt: `2026-10-0${i + 1}T12:00:00Z` });
  await db2.doc(`${T}/appointments/x`).set({ id: 'x', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: '2026-10-14T19:00:00.000Z', endTime: '2026-10-14T20:00:00.000Z', status: 'cancelled', cancelledAt: new Date(NOW).toISOString() });
  const n0 = sent.length; const t2 = (await db2.doc(T).get()).data();
  const f1: any = await W.waitlistSweep(db2, 't1', t2, NOW, deps);
  check('3 hours away → the top three at once, “whoever taps first”', f1.sent === 3 && sent.slice(n0).every((x) => /whoever taps first/.test(x.body)), { f1, s: sent.slice(n0) });
  const db4 = makeDb(); await db4.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); await db4.doc(`${T}/staff/jess`).set({ id: 'jess', name: 'Jessica', role: 'owner' });
  await db4.doc(`${T}/waitlist/a`).set({ id: 'a', status: 'waiting', name: 'A', phone: '+15550100', serviceId: 'gel', noticeHours: 1 });
  await db4.doc(`${T}/openings/op_soon`).set({ id: 'op_soon', staffId: 'maya', staffName: 'Maya Reyes', start: new Date(NOW + 40 * MIN).toISOString(), end: new Date(NOW + 100 * MIN).toISOString(), minutes: 60, status: 'open', offers: [], createdAt: new Date(NOW).toISOString() });
  const n1 = sent.length; const d1: any = await W.waitlistSweep(db4, 't1', (await db4.doc(T).get()).data(), NOW, deps);
  const bell = (await db4.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('under an hour → no texts; the desk is told', d1.desk === 1 && sent.length === n1 && bell.some((b: any) => b.type === 'waitlist_desk'), { d1, bell });
  await db4.doc(`${T}/openings/op_soon`).set({ start: new Date(NOW + 30 * H).toISOString(), end: new Date(NOW + 31 * H).toISOString(), deskAt: null }, { merge: true });
  const night: any = await W.waitlistSweep(db4, 't1', (await db4.doc(T).get()).data(), at('2026-10-14T22:30:00-04:00'), deps);
  check('at 10:30 pm nothing goes out — it waits for the morning', night.sent === 0 && sent.length === n1);
  check('joining keeps only real days and parts of the day', JSON.stringify(W.cleanWindows({ 4: ['afternoon', 'evening', 'bogus'], 9: ['morning'], x: 1 })) === '{"4":["afternoon","evening"]}');

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
