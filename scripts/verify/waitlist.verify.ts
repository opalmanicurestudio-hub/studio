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
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' } });
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
  check('26 hours away → offered to ONE person: Priya (asked for Maya, Thursday afternoons, waited longest)', s1.sent === 1 && sent[0]?.to === '+15550003' && /reserved for you for the next 30 minutes/.test(sent[0].body) && sent[0].body.includes('https://opal.example/w/t1/op_ana.'), { s1, sent });
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
  check('Sam gets “a sooner time opened … instead of …” — his time stays if he says no', !!samOffer && /earlier time has become available/.test(samOffer.body) && /your current appointment will stay exactly as it is/.test(samOffer.body), sent.slice(before));
  const samTok = (await db.doc(`${T}/openings/op_bo`).get()).data().offers.find((f: any) => f.kind === 'sooner').token;
  const mv: any = await W.takeOffer(db, 't1', samTok, NOW + 45 * MIN, deps);
  const samA: any = (await db.doc(`${T}/appointments/sam`).get()).data();
  check('Sam taps → his own visit moves to Friday 10:00 (same booking, same deposit)', mv.ok && mv.sooner && samA.startTime === '2026-10-16T14:00:00.000Z' && samA.previousStartTime === '2026-10-29T18:00:00.000Z', samA);
  const freed: any = (await db.collection(`${T}/openings`).get()).docs.map((d: any) => d.data()).find((o: any) => o.source === 'moveup');
  check('the time he left (Oct 29) becomes the next opening — one move along the chain', freed && freed.start === '2026-10-29T18:00:00.000Z' && freed.chainDepth === 1, freed);
  check('the check-in link shows his new time too', (await db.doc(`${T}/appointmentCheckIns/tokSam`).get()).data()?.startTime === '2026-10-16T14:00:00.000Z');

  // Same day → first to tap, three at once; under an hour → the desk; at night → nothing
  const db2 = makeDb(); await db2.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' } });
  await db2.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes', role: 'stylist' }); await db2.doc(`${T}/staff/jess`).set({ id: 'jess', name: 'Jessica', role: 'owner' });
  for (const [i, n] of ['a', 'b', 'c', 'd'].entries()) await db2.doc(`${T}/waitlist/${n}`).set({ id: n, status: 'waiting', name: `Person ${n}`, phone: `+1555010${i}`, serviceId: 'gel', noticeHours: 1, createdAt: `2026-10-0${i + 1}T12:00:00Z` });
  await db2.doc(`${T}/appointments/x`).set({ id: 'x', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: '2026-10-14T19:00:00.000Z', endTime: '2026-10-14T20:00:00.000Z', status: 'cancelled', cancelledAt: new Date(NOW).toISOString() });
  const n0 = sent.length; const t2 = (await db2.doc(T).get()).data();
  const f1: any = await W.waitlistSweep(db2, 't1', t2, NOW, deps);
  check('3 hours away → the top three at once, “whoever taps first”', f1.sent === 3 && sent.slice(n0).every((x) => /go to the first person to confirm/.test(x.body)), { f1, s: sent.slice(n0) });
  const db4 = makeDb(); await db4.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' } }); await db4.doc(`${T}/staff/jess`).set({ id: 'jess', name: 'Jessica', role: 'owner' });
  await db4.doc(`${T}/waitlist/a`).set({ id: 'a', status: 'waiting', name: 'A', phone: '+15550100', serviceId: 'gel', noticeHours: 1 });
  await db4.doc(`${T}/openings/op_soon`).set({ id: 'op_soon', staffId: 'maya', staffName: 'Maya Reyes', start: new Date(NOW + 40 * MIN).toISOString(), end: new Date(NOW + 100 * MIN).toISOString(), minutes: 60, status: 'open', offers: [], createdAt: new Date(NOW).toISOString() });
  const n1 = sent.length; const d1: any = await W.waitlistSweep(db4, 't1', (await db4.doc(T).get()).data(), NOW, deps);
  const bell = (await db4.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('under an hour → no texts; the desk is told', d1.desk === 1 && sent.length === n1 && bell.some((b: any) => b.type === 'waitlist_desk'), { d1, bell });
  await db4.doc(`${T}/openings/op_soon`).set({ start: new Date(NOW + 30 * H).toISOString(), end: new Date(NOW + 31 * H).toISOString(), deskAt: null }, { merge: true });
  const night: any = await W.waitlistSweep(db4, 't1', (await db4.doc(T).get()).data(), at('2026-10-14T22:30:00-04:00'), deps);
  check('at 10:30 pm nothing goes out — it waits for the morning', night.sent === 0 && sent.length === n1);
  check('joining keeps only real days and parts of the day', JSON.stringify(W.cleanWindows({ 4: ['afternoon', 'evening', 'bogus'], 9: ['morning'], x: 1 })) === '{"4":["afternoon","evening"]}');

  console.log('Waitlist — when someone else gets there first');
  const R = (lead: number, offers: any[], ranked: any[] = [{}, {}, {}, {}]) => E.planRound(NOW + lead, NOW, offers, ranked);
  const old = new Date(NOW - MIN).toISOString();
  check('a day+ away → one person, 30 minutes', JSON.stringify(R(26 * H, [])) === JSON.stringify({ count: 1, mode: 'one', holdMin: 30 }));
  check('later today → waves: the best fit alone for 10 minutes, then two at once, then three',
    R(6 * H, []).count === 1 && R(6 * H, []).mode === 'one' && R(6 * H, []).holdMin === 10
    && R(6 * H, [{ status: 'lapsed', mode: 'one', holdUntil: old }]).count === 2 && R(6 * H, [{ status: 'lapsed', mode: 'one', holdUntil: old }]).mode === 'first'
    && R(6 * H, [{ status: 'lapsed', mode: 'one' }, { status: 'lapsed', mode: 'first' }, { status: 'lapsed', mode: 'first' }]).count === 3);
  check('under 4 hours → three at once (speed matters more)', R(2 * H, []).count === 3 && R(2 * H, []).mode === 'first');
  check('someone owed one (missed out, or this time’s backup) gets it alone — even same day', R(2 * H, [], [{ pri: 'missed' }, {}]).mode === 'one' && R(2 * H, [], [{ pri: 'backup' }]).count === 1);
  check('nothing new while a round is still running', R(6 * H, [{ status: 'sent', mode: 'first', holdUntil: new Date(NOW + 5 * MIN).toISOString() }]).count === 0);
  const rk = E.rank([{ e: { id: 'long', createdAt: '2026-09-01' }, leftover: 0 }, { e: { id: 'missed', createdAt: '2026-10-12' }, leftover: 0, pri: 'missed' }, { e: { id: 'bk', createdAt: '2026-10-13' }, leftover: 0, pri: 'backup' }] as any);
  check('order: the backup, then whoever missed out, then everyone else', rk.map((x) => x.e.id).join() === 'bk,missed,long', rk.map((x) => x.e.id));

  // Today 6:00 pm with Maya (6 hours away): Lee, Kay and Ro all fit. Their link pages are checked for other people's names.
  const db5 = makeDb(); await db5.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' } }); await db5.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes', role: 'stylist' });
  const SIX = '2026-10-14T22:00:00.000Z', SEVEN = '2026-10-14T23:00:00.000Z';
  const people = [['lee', 'Lee Grant', '2026-10-01'], ['kay', 'Kay Moss', '2026-10-02'], ['ro', 'Ro Diaz', '2026-10-03'], ['uma', 'Uma Bell', '2026-10-04']];
  for (const [i, [id, name, c]] of people.entries()) await db5.doc(`${T}/waitlist/${id}`).set({ id, status: 'waiting', name, phone: `+1555020${i}`, serviceId: 'gel', noticeHours: 1, createdAt: `${c}T12:00:00Z`, ...(id === 'kay' ? { windows: { 3: ['evening'], 4: ['afternoon'], 5: ['morning', 'afternoon'] } } : {}) });
  await db5.doc(`${T}/appointments/z`).set({ id: 'z', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: SIX, endTime: SEVEN, status: 'cancelled', cancelledAt: new Date(NOW).toISOString() });
  // open times by day (New York): today 6 pm (the opening), Thursday 2 pm & 4 pm & 5 pm, Friday 10 am
  const daySlots: Record<string, string[]> = { '2026-10-14': [SIX], '2026-10-15': [THU2, '2026-10-15T20:00:00.000Z', '2026-10-15T21:00:00.000Z'], '2026-10-16': ['2026-10-16T14:00:00.000Z'] };
  const sent5: any[] = []; const booked5: any[] = [];
  const deps5: any = { ...deps, send: async (_d: any, _t: string, to: string, body: string) => { sent5.push({ to, body }); return { ok: true }; },
    book: async (_t: any, body: any) => { booked5.push(body); return { ok: true, appointmentId: `b${booked5.length}`, status: 'pending_payment', checkInToken: `ck${booked5.length}` }; },
    openTimes: (_e: any, o: any) => (daySlots[o.date] || []).map((startIso) => ({ startIso, staffId: 'maya', staffName: 'Maya Reyes' })) };
  const ten5 = (await db5.doc(T).get()).data();
  await W.waitlistSweep(db5, 't1', ten5, NOW, deps5);
  check('6 hours away → only the best fit (Lee) is texted, alone, for 10 minutes', sent5.length === 1 && sent5[0].to === '+15550200' && /reserved for you for the next 10 minutes/.test(sent5[0].body), sent5);
  const hold = (await db5.doc(`${T}/staffBlocks/wl_op_z`).get()).data();
  check('while it’s Lee’s, the time is held — gone from the public booking page until her 10 minutes end', hold?.reason === 'waitlist_hold' && hold.staffId === 'maya' && hold.startTime === SIX && hold.duration === 60 && Date.parse(hold.until) === NOW + 10 * MIN, hold);
  await W.waitlistSweep(db5, 't1', ten5, NOW + 11 * MIN, deps5);
  check('no answer → the hold lifts and the next two (Kay, Ro) get it, first to tap', !(await db5.doc(`${T}/staffBlocks/wl_op_z`).get()).exists && sent5.length === 3 && sent5.slice(1).every((x) => /go to the first person to confirm/.test(x.body)) && sent5.slice(1).map((x) => x.to).join() === '+15550201,+15550202', sent5);
  const ops5 = () => db5.doc(`${T}/openings/op_z`).get().then((s: any) => s.data());
  const tokOf = async (id: string) => (await ops5()).offers.find((f: any) => f.entryId === id).token;
  const roTok = await tokOf('ro'), kayTok = await tokOf('kay');
  const ro: any = await W.takeOffer(db5, 't1', roTok, NOW + 13 * MIN, deps5);
  check('Ro taps first → booked; a deposit gets 20 minutes before it goes to the next person', ro.ok && booked5[0]?.holdUntil === new Date(NOW + 33 * MIN).toISOString() && ro.payBy === booked5[0].holdUntil, { ro, b: booked5[0] });
  const kayE: any = (await db5.doc(`${T}/waitlist/kay`).get()).data();
  check('Kay was in that round and missed out → owed the next one (for 14 days)', Date.parse(kayE.priorityUntil) === NOW + 13 * MIN + 14 * DAY && kayE.missedCount === 1 && kayE.status === 'waiting', kayE);
  const kv: any = await W.viewOffer(db5, 't1', kayTok, NOW + 14 * MIN);
  check('Kay’s link: “that one just went”, and she can be its backup', kv.state === 'taken' && kv.canBackup && !kv.backup, kv);
  const kalt: any = await W.alternativesFor(db5, 't1', kayTok, NOW + 14 * MIN, deps5);
  check('…with other real times that fit HER (Thursday afternoon, Friday morning — her days), two a day at most, soonest first',
    kalt.times.length === 3 && kalt.times[0].startIso === THU2 && kalt.times[2].startIso === '2026-10-16T14:00:00.000Z' && kalt.times.every((x: any) => x.startIso !== SIX), kalt.times);
  const kayPage = JSON.stringify(kv) + JSON.stringify(kalt);
  check('nothing she sees names another client', !/Ro|Lee|Uma|Diaz|Grant|Bell/.test(kayPage.replace(/Room|Gel|Opal|Maya/g, '')), kayPage);
  const bad: any = await W.bookAlternative(db5, 't1', kayTok, '2026-10-15T15:00:00.000Z', 'maya', NOW + 14 * MIN, deps5);
  check('a time that isn’t one of hers can’t be booked from her link', !bad.ok && booked5.length === 1);
  const bk: any = await W.backupFor(db5, 't1', kayTok, NOW + 15 * MIN);
  check('Kay taps “back me up”', bk.ok && (await ops5()).backups.join() === 'kay');
  // Ro never pays: the appointment the booking made is released at her deadline → a new opening, Kay first, alone
  await db5.doc(`${T}/appointments/b1`).set({ id: 'b1', clientName: 'Ro Diaz', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: SIX, endTime: SEVEN, status: 'cancelled', cancellationReason: 'payment_not_received', cancelledAt: new Date(NOW + 34 * MIN).toISOString() }, { merge: true });
  const n5 = sent5.length; await W.waitlistSweep(db5, 't1', ten5, NOW + 35 * MIN, deps5);
  const fell: any = (await db5.doc(`${T}/openings/op_b1`).get()).data();
  check('the time comes back as an opening — and its backup (Kay) gets it alone, held for her', fell?.source === 'fell_through' && fell.backups.join() === 'kay' && sent5.length === n5 + 1 && sent5[n5].to === '+15550201' && /reserved for you for the next/.test(sent5[n5].body) && (await db5.doc(`${T}/staffBlocks/wl_op_b1`).get()).exists, { fell, s: sent5.slice(n5) });
  check('getting one of her own settles what she was owed', !(await db5.doc(`${T}/waitlist/kay`).get()).data().priorityUntil);
  const kayTok2 = (await db5.doc(`${T}/openings/op_b1`).get()).data().offers[0].token;
  const kt: any = await W.takeOffer(db5, 't1', kayTok2, NOW + 36 * MIN, deps5);
  check('Kay taps → the hold lifts and it’s booked for her', kt.ok && !(await db5.doc(`${T}/staffBlocks/wl_op_b1`).get()).exists && booked5.length === 2);
  // Uma missed nothing; Lee let hers lapse. Neither is owed anything.
  check('letting your own offer run out isn’t “missing out”', !(await db5.doc(`${T}/waitlist/lee`).get()).data().priorityUntil);
  const ua: any = await W.bookAlternative(db5, 't1', kayTok, '2026-10-16T14:00:00.000Z', 'maya', NOW + 37 * MIN, deps5);
  check('another time from the “missed it” screen books through the booking engine', ua.ok && booked5[2]?.startTime === '2026-10-16T14:00:00.000Z' && booked5[2]?.source === 'waitlist', { ua, b: booked5[2] });

  console.log('Waitlist — just book it, no double bookings, still hoping?');
  const mk = async () => { const x = makeDb(); await x.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' } }); await x.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes', role: 'stylist' }); return x; };
  const sent6: any[] = []; const booked6: any[] = [];
  const deps6: any = { ...deps, send: async (_d: any, _t: string, to: string, body: string) => { sent6.push({ to, body }); return { ok: true }; }, book: async (_t: any, body: any) => { booked6.push(body); return { ok: true, appointmentId: `a${booked6.length}`, status: 'confirmed' }; } };
  const cancelThu = (x: any, id: string) => x.doc(`${T}/appointments/${id}`).set({ id, staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: THU2, endTime: THU3, status: 'cancelled', cancelledAt: new Date(NOW).toISOString() });
  // Just book it for me
  const db6 = await mk(); await cancelThu(db6, 'c1');
  await db6.doc(`${T}/waitlist/ann`).set({ id: 'ann', status: 'waiting', name: 'Ann Lowe', phone: '+15550300', serviceId: 'gel', autoBook: true, createdAt: '2026-10-01T12:00:00Z' });
  await db6.doc(`${T}/waitlist/bo`).set({ id: 'bo', status: 'waiting', name: 'Bo Hart', phone: '+15550301', serviceId: 'gel', createdAt: '2026-10-02T12:00:00Z' });
  await W.waitlistSweep(db6, 't1', (await db6.doc(T).get()).data(), NOW, deps6);
  const o6: any = (await db6.doc(`${T}/openings/op_c1`).get()).data();
  check('first in line ticked “just book it for me” → booked straight away, no link to race for', booked6.length === 1 && booked6[0].startTime === THU2 && o6.status === 'filled' && o6.filledBy.auto && (await db6.doc(`${T}/waitlist/ann`).get()).data().status === 'booked', { booked6, o6 });
  check('…with a short heads-up text (the booking’s own confirmation follows); nobody else is texted', sent6.length === 1 && sent6[0].to === '+15550300' && /as you asked, we've booked it for you/.test(sent6[0].body), sent6);
  // Already booked for it later → a move-up of that visit, never a second booking
  const db7 = await mk(); await cancelThu(db7, 'c2'); sent6.length = 0; booked6.length = 0;
  await db7.doc(`${T}/waitlist/cy`).set({ id: 'cy', status: 'waiting', name: 'Cy Ford', phone: '(555) 030-0302', serviceId: 'gel', createdAt: '2026-10-01T12:00:00Z' });
  await db7.doc(`${T}/appointments/cyLater`).set({ id: 'cyLater', clientName: 'Cy Ford', clientPhone: '+15550300302'.slice(0, 12), staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: '2026-10-29T18:00:00.000Z', endTime: '2026-10-29T19:00:00.000Z', status: 'confirmed' });
  await db7.doc(`${T}/appointments/cyLater`).set({ clientPhone: '+15550300302' }, { merge: true });
  await W.waitlistSweep(db7, 't1', (await db7.doc(T).get()).data(), NOW, deps6);
  check('on the list AND booked for it later → offered as moving that visit up', sent6.length === 1 && /earlier time has become available/.test(sent6[0].body), sent6);
  const cyTok = (await db7.doc(`${T}/openings/op_c2`).get()).data().offers[0].token;
  const cyT: any = await W.takeOffer(db7, 't1', cyTok, NOW + MIN, deps6);
  check('…and tapping moves the visit they have — no second booking', cyT.ok && booked6.length === 0 && (await db7.doc(`${T}/appointments/cyLater`).get()).data().startTime === THU2, cyT);
  // Still hoping?
  const db8 = await mk(); sent6.length = 0;
  await db8.doc(`${T}/waitlist/di`).set({ id: 'di', status: 'offered', name: 'Di Shore', phone: '+15550303', serviceId: 'gel', serviceName: 'Gel fill', ignoredInARow: 2, createdAt: '2026-10-01T12:00:00Z' });
  await db8.doc(`${T}/waitlist/ed`).set({ id: 'ed', status: 'offered', name: 'Ed Moon', phone: '+15550304', serviceId: 'gel', ignoredInARow: 2, createdAt: '2026-10-02T12:00:00Z' });
  await db8.doc(`${T}/waitlist/fi`).set({ id: 'fi', status: 'waiting', name: 'Fi Rowe', phone: '+15550305', serviceId: 'gel', ignoredInARow: 3, stillAskedAt: new Date(NOW - 49 * H).toISOString(), stillToken: 'fi.x', createdAt: '2026-10-03T12:00:00Z' });
  await db8.doc(`${T}/openings/op_q`).set({ id: 'op_q', staffId: 'maya', staffName: 'Maya Reyes', start: '2026-10-20T18:00:00.000Z', end: '2026-10-20T19:00:00.000Z', minutes: 60, status: 'filled', offers: [] });
  await db8.doc(`${T}/openings/op_r`).set({ id: 'op_r', staffId: 'maya', staffName: 'Maya Reyes', start: '2026-10-21T18:00:00.000Z', end: '2026-10-21T19:00:00.000Z', minutes: 60, status: 'open', createdAt: new Date(NOW - H).toISOString(),
    offers: [{ token: 'op_r.di', entryId: 'di', status: 'sent', mode: 'one', holdUntil: new Date(NOW - MIN).toISOString(), kind: 'new' }, { token: 'op_r.ed', entryId: 'ed', status: 'sent', mode: 'one', holdUntil: new Date(NOW - 40 * MIN).toISOString(), kind: 'new', viewedAt: new Date(NOW - 50 * MIN).toISOString() }] });
  await W.waitlistSweep(db8, 't1', (await db8.doc(T).get()).data(), NOW, deps6);
  const di: any = (await db8.doc(`${T}/waitlist/di`).get()).data(), ed: any = (await db8.doc(`${T}/waitlist/ed`).get()).data();
  const still = sent6.find((x) => x.to === '+15550303');
  check('a third offer in a row never even opened → one “still hoping?” text with a keep-or-leave link', di.ignoredInARow === 3 && !!di.stillAskedAt && !!still && /still like to stay on our waitlist for a gel fill/.test(still.body) && still.body.includes(`/w/t1/keep/${di.stillToken}`), { di, sent6 });
  check('opening the link counts as interest — Ed isn’t asked', ed.ignoredInARow === 2 && !ed.stillAskedAt && !sent6.some((x) => x.to === '+15550304'), ed);
  check('…and while Di’s asked, she isn’t sent new offers', !sent6.some((x) => x.to === '+15550303' && /has become available/.test(x.body)));
  check('no answer in 48 hours → paused (off the offers; the desk still sees them)', (await db8.doc(`${T}/waitlist/fi`).get()).data().status === 'paused');
  const kv8: any = await W.keepView(db8, 't1', di.stillToken); const kept: any = await W.keepEntry(db8, 't1', di.stillToken, true, NOW + H);
  const di2: any = (await db8.doc(`${T}/waitlist/di`).get()).data();
  check('“Yes — keep my place” → back on the offers, count reset', kv8.ok && kept.ok && di2.status === 'waiting' && di2.ignoredInARow === 0 && !di2.stillAskedAt, di2);
  check('an old or guessed link does nothing', !(await W.keepView(db8, 't1', 'di.wrong')).ok);
  const left: any = await W.keepEntry(db8, 't1', 'fi.x', false, NOW + H);
  check('“No thanks” → off the list', left.ok && (await db8.doc(`${T}/waitlist/fi`).get()).data().status === 'closed');

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
