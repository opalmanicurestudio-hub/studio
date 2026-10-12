// scripts/verify/tidy.verify.ts — checks Tidy my day (lib/tidy-engine + lib/tidy-server) against an in-memory
// database, with the booking engine stood in for.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/tidy.verify.ts
import { makeDb, check, failures } from './fake-db';

const MIN = 60000, H = 3600e3, DAY = 864e5;
const NY = (s: string) => Date.parse(`${s}-04:00`);          // New York wall time in October
const iso = (n: number) => new Date(n).toISOString();

(async () => {
  const E = await import('../../src/lib/tidy-engine');
  const X = await import('../../src/lib/tidy-server');
  const W = await import('../../src/lib/waitlist-server');
  console.log('Tidy my day — the rules');
  // Maya's Wednesday: Ana 12–1, (Kay cancelled 1–2), Lee 2–3 (already here — can't move), Ro 3–3:30, Bo 3:30–4:30, Cara 4:30–5:30
  const v = (id: string, a: string, b: string, x: any = {}) => ({ id, name: id, start: NY(`2026-10-14T${a}:00`), end: NY(`2026-10-14T${b}:00`), serviceId: 'svc', ...x });
  const day = [v('ana', '12:00', '13:00'), v('lee', '14:00', '15:00', { fixed: 'already here' }), v('ro', '15:00', '15:30'), v('bo', '15:30', '16:30'), v('cara', '16:30', '17:30')];
  const r = E.planDay({ visits: day, now: NY('2026-10-14T11:00:00') });
  check('the gap is found: 1:00–2:00', r.gap?.start === NY('2026-10-14T13:00:00') && r.gap?.end === NY('2026-10-14T14:00:00'));
  const best = r.plans[0];
  check('best plan: ask ONE person — Cara (the last of the day) into 1:00; you finish at 4:30', best?.asks === 1 && best.moves[0].id === 'cara' && best.moves[0].to === NY('2026-10-14T13:00:00') && best.finishTo === NY('2026-10-14T16:30:00'), r.plans);
  check('the other way: Bo into 1:00 and Cara slides up an hour (two asks) — ranked after', r.plans.some((p) => p.asks === 2 && p.moves.map((m) => m.id).sort().join() === 'bo,cara'), r.plans.map((p) => p.key));
  check('never suggested: Ro alone into 1:00 — it would leave a 30-minute hole', !r.plans.some((p) => p.moves.length === 1 && p.moves[0].id === 'ro'));
  check('never suggested: anything that moves Lee (already here)', !r.plans.some((p) => p.moves.some((m) => m.id === 'lee')));
  check('only earlier, never later', r.plans.every((p) => p.moves.every((m) => m.to < m.from)));
  const late = E.planDay({ visits: day, now: NY('2026-10-14T12:00:00') });
  check('at noon there isn’t 90 minutes’ notice for 1:00 → nobody is asked', late.plans.length === 0 && !!late.why);
  const tight = E.planDay({ visits: day, now: NY('2026-10-14T11:00:00'), settings: { maxEarlierMin: 120 } });
  check('“never more than 2 hours earlier” → Cara (3½ hours) isn’t asked — and with Lee here, nothing else works', !tight.plans.some((p) => p.moves.some((m) => m.id === 'cara')) && tight.plans.length === 0, tight.plans.map((p) => p.key));
  const nofit = E.planDay({ visits: day, now: NY('2026-10-14T11:00:00'), fits: (x) => x.id !== 'cara' });
  check('a move the booking engine says no to (rooms, shifts) is never planned', !nofit.plans.some((p) => p.moves.some((m) => m.id === 'cara')));
  const brk = E.planDay({ visits: [v('a', '12:00', '13:00'), v('b', '14:30', '15:30'), v('c', '15:30', '16:00')], blocks: [{ start: NY('2026-10-14T13:30:00'), end: NY('2026-10-14T14:30:00'), kind: 'break' }], now: NY('2026-10-14T10:00:00') });
  check('a gap against a break is left alone (it just makes the break longer)', brk.plans.length === 0);
  const keen = E.planDay({ visits: [v('a', '12:00', '13:00'), v('b', '14:00', '15:00'), v('c', '15:00', '16:00', { keen: true }), v('d', '16:00', '17:00')], now: NY('2026-10-14T10:00:00') });
  check('the person who asked to come in sooner is in the best plan when it ties', keen.plans[0]?.moves.length === 1);
  // clear a light day
  const mon = [{ id: 'ana', start: NY('2026-10-19T10:00:00'), end: NY('2026-10-19T11:00:00') }];
  const wed = [{ id: 'jo', start: NY('2026-10-21T12:00:00'), end: NY('2026-10-21T13:00:00') }, { id: 'lu', start: NY('2026-10-21T13:00:00'), end: NY('2026-10-21T14:00:00') }, { id: 'kim', start: NY('2026-10-21T15:00:00'), end: NY('2026-10-21T16:00:00') }];
  const slot = (s: string) => { const st = NY(`2026-10-21T${s}:00`); return { id: 'ana', date: '2026-10-21', start: st, end: st + H, ...E.touchOf(st, st + H, wed) }; };
  const moves = E.clearDay(mon, new Map([['ana', [slot('16:00'), slot('09:00'), slot('14:00'), slot('11:00')]]]));
  check('clear Monday: Ana’s one visit goes into Wednesday 2:00 — it fills the gap exactly', moves?.[0]?.to === NY('2026-10-21T14:00:00'), moves);
  check('a slot that touches nothing would just make a new hole — never used', E.touchOf(NY('2026-10-21T09:00:00'), NY('2026-10-21T10:00:00'), wed).touch === 0);

  console.log('Tidy my day — asking, all or nothing');
  const db = makeDb(); const T = 'tenants/t1'; const NOW = NY('2026-10-14T11:00:00');
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  await db.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes', role: 'stylist' });
  const appt = (id: string, a: string, b: string, x: any = {}) => db.doc(`${T}/appointments/${id}`).set({ id, clientName: `${id[0].toUpperCase()}${id.slice(1)} Client`, clientPhone: `+1555${String(id.length).padStart(3, '0')}${id.charCodeAt(0)}`, staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', serviceName: 'Gel fill', startTime: iso(NY(`2026-10-14T${a}:00`)), endTime: iso(NY(`2026-10-14T${b}:00`)), status: 'confirmed', ...x });
  await appt('ana', '12:00', '13:00'); await appt('lee', '14:00', '15:00', { status: 'arrived' }); await appt('ro', '15:00', '15:30'); await appt('bo', '15:30', '16:30'); await appt('cara', '16:30', '17:30', { checkInToken: 'ckCara' });
  await appt('kay', '13:00', '14:00', { status: 'cancelled', cancelledAt: iso(NOW - 10 * MIN) });
  const sent: any[] = [];
  const quarter = (date: string) => { const out: any[] = []; for (let m = 8 * 60; m <= 20 * 60; m += 15) out.push({ startIso: iso(NY(`${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`)) }); return out; };
  const deps: any = { send: async (_d: any, _t: string, to: string, body: string) => { sent.push({ to, body }); return { ok: true }; }, engine: async () => ({ services: [{ id: 'gel', name: 'Gel fill', duration: 60 }], staff: [{ id: 'maya', name: 'Maya Reyes' }] }), openTimes: (_e: any, o: any) => quarter(o.date) };
  const p: any = await X.tidyPlans(db, 't1', 'maya', '2026-10-14', NOW, deps);
  check('the server sees the same day: best plan asks Cara to come at 1 instead of 4:30, finishing at 4:30', p.plans[0]?.moves.length === 1 && p.plans[0].moves[0].name === 'Cara' && /^1\s?PM$/.test(p.plans[0].moves[0].toLabel.replace(' ', ' ')) && /4:30/.test(p.plans[0].finishLabel), p.plans[0]);
  check('Lee shows why she can’t move (already here)', p.day.find((x: any) => x.id === 'lee')?.fixed === 'already here');
  // the waitlist: a new gap waits for Maya's call (the default)
  const ten = (await db.doc(T).get()).data();
  const wdeps: any = { ...deps, book: async () => ({ ok: true, appointmentId: 'w1', status: 'confirmed' }), openTimes: () => [{ startIso: iso(NY('2026-10-14T13:00:00')) }] };
  await db.doc(`${T}/waitlist/wen`).set({ id: 'wen', status: 'waiting', name: 'Wen Li', phone: '+15559990001', serviceId: 'gel', noticeHours: 1, createdAt: '2026-10-01T12:00:00Z' });
  const n0 = sent.length; await W.waitlistSweep(db, 't1', ten, NOW, wdeps);
  const op: any = (await db.doc(`${T}/openings/op_kay`).get()).data(); const bell = (await db.collection(`${T}/notifications`).get()).docs.map((x: any) => x.data());
  check('a cancellation with “ask me” (the default): the waitlist waits, and Maya is asked — tidy (finish at 4:30) or waitlist', !!op?.awaitUntil && !sent.slice(n0).some((x) => x.to === '+15559990001') && bell.some((b: any) => b.userId === 'maya' && /finish at 4:30/.test(b.message) && /waitlist/.test(b.message)), { op, bell });
  const aw: any[] = await X.awaiting(db, 't1', 'maya', NOW);
  check('…and it shows on her card, with when it goes to the waitlist if she doesn’t choose', aw.length === 1 && aw[0].plans >= 1 && /11:30/.test(aw[0].until), aw);
  const ask: any = await X.askTidy(db, 't1', { staffId: 'maya', name: 'Maya Reyes' }, { staffId: 'maya', date: '2026-10-14', key: p.plans[0].key }, NOW + MIN, deps);
  const caraText = sent.find((x) => /earlier spot today/.test(x.body));
  check('“Ask Cara” → only Cara is texted: “an earlier spot today — could you come at 1 instead of 4:30?”', ask.ok && sent.filter((x) => /earlier spot/.test(x.body)).length === 1 && /instead of 4:30/.test(caraText?.body || '') && caraText.body.includes('https://opal.example/m/t1/'), { ask, caraText });
  const hold = (await db.collection(`${T}/staffBlocks`).get()).docs.map((x: any) => x.data()).find((b: any) => b.reason === 'tidy_hold');
  check('1:00 is held while she answers — online booking and the waitlist can’t take it', hold && hold.startTime === iso(NY('2026-10-14T13:00:00')) && hold.duration === 60 && Date.parse(hold.until) === NOW + 31 * MIN, hold);
  check('the waiting gap is now being tidied — the waitlist leaves it alone', (await db.doc(`${T}/openings/op_kay`).get()).data().decided === 'tidy');
  const tok = (await db.doc(`${T}/tidyAsks/${ask.askId}`).get()).data().moves[0].token;
  const view: any = await X.tidyView(db, 't1', tok, NOW + 2 * MIN);
  check('Cara’s link: today at 1 instead of 4:30, gel fill — and no one else’s name anywhere', view.ok && view.state === 'open' && view.sameDay && /1/.test(view.to) && /4:30/.test(view.from) && !/Kay|Lee|Ana|Ro |Bo /.test(JSON.stringify(view)), view);
  const yes: any = await X.tidyAnswer(db, 't1', tok, true, NOW + 3 * MIN, deps);
  const cara: any = (await db.doc(`${T}/appointments/cara`).get()).data();
  check('she says yes → (everyone has) → moved: 1:00–2:00, same booking, check-in link updated', yes.state === 'moved' && cara.startTime === iso(NY('2026-10-14T13:00:00')) && cara.endTime === iso(NY('2026-10-14T14:00:00')) && cara.previousStartTime === iso(NY('2026-10-14T16:30:00')) && (await db.doc(`${T}/appointmentCheckIns/ckCara`).get()).data()?.startTime === cara.startTime, cara);
  check('she gets “you’re all set”; the hold is gone; the gap is closed (not offered to the waitlist)', sent.some((x) => /all set, Cara/.test(x.body)) && !(await db.collection(`${T}/staffBlocks`).get()).docs.some((x: any) => x.data().reason === 'tidy_hold') && (await db.doc(`${T}/openings/op_kay`).get()).data().status === 'closed');
  check('Maya hears “Tidied — you finish at 4:30”', (await db.collection(`${T}/notifications`).get()).docs.some((x: any) => /Tidied/.test(x.data().message) && /4:30/.test(x.data().message)));

  // Two people: one yes, one no → nobody moves
  const db2 = makeDb(); await db2.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); await db2.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes' });
  const a2 = (id: string, a: string, b: string) => db2.doc(`${T}/appointments/${id}`).set({ id, clientName: `${id} X`, clientPhone: `+1555000${id.length}${id.charCodeAt(0)}`, staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', serviceName: 'Gel fill', startTime: iso(NY(`2026-10-14T${a}:00`)), endTime: iso(NY(`2026-10-14T${b}:00`)), status: 'confirmed' });
  await a2('amy', '12:00', '13:00'); await a2('bea', '14:00', '15:00'); await a2('cy', '15:00', '15:30');
  const p2: any = await X.tidyPlans(db2, 't1', 'maya', '2026-10-14', NOW, deps);
  const two = p2.plans.find((x: any) => x.moves.length === 2);
  check('a gap with no one-person fix (Cy’s 30 minutes would leave a hole): Bea and Cy both move up (two asks)', !!two && p2.plans[0].moves.length === 2, p2.plans.map((x: any) => x.key));
  const s0 = sent.length; const ask2: any = await X.askTidy(db2, 't1', { staffId: 'maya', name: 'Maya' }, { staffId: 'maya', date: '2026-10-14', key: two.key }, NOW, deps);
  const mv2 = (await db2.doc(`${T}/tidyAsks/${ask2.askId}`).get()).data().moves;
  check('both are asked at once', ask2.ok && sent.length - s0 === 2);
  const y1: any = await X.tidyAnswer(db2, 't1', mv2[0].token, true, NOW + MIN, deps);
  check('the first says yes → nothing moves yet (“we’ll confirm”)', y1.state === 'yes' && (await db2.doc(`${T}/appointments/${mv2[0].apptId}`).get()).data().startTime === mv2[0].from);
  const n1: any = await X.tidyAnswer(db2, 't1', mv2[1].token, false, NOW + 2 * MIN, deps);
  check('the second keeps their time → NOBODY moves; the first hears “no change needed”; holds lifted', n1.state === 'kept' && (await db2.doc(`${T}/appointments/${mv2[0].apptId}`).get()).data().startTime === mv2[0].from
    && sent.some((x) => x.to === mv2[0].phone && /don’t need to move you/.test(x.body)) && !(await db2.collection(`${T}/staffBlocks`).get()).docs.length && (await db2.doc(`${T}/tidyAsks/${ask2.askId}`).get()).data().status === 'declined');
  const p3: any = await X.tidyPlans(db2, 't1', 'maya', '2026-10-14', NOW + 3 * MIN, deps);
  check('whoever said no isn’t asked again today', !p3.plans.some((x: any) => x.moves.some((m: any) => m.id === mv2[1].apptId)) && p3.day.find((x: any) => x.id === mv2[1].apptId)?.fixed === 'said no today');
  // no answer in time
  const db3 = makeDb(); await db3.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); await db3.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes' });
  for (const [id, a, b] of [['amy', '12:00', '13:00'], ['bea', '14:00', '15:00']]) await db3.doc(`${T}/appointments/${id}`).set({ id, clientName: id, clientPhone: '+15550007777', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: iso(NY(`2026-10-14T${a}:00`)), endTime: iso(NY(`2026-10-14T${b}:00`)), status: 'confirmed' });
  const p4: any = await X.tidyPlans(db3, 't1', 'maya', '2026-10-14', NOW, deps); const ask3: any = await X.askTidy(db3, 't1', { staffId: 'maya', name: 'Maya' }, { staffId: 'maya', date: '2026-10-14', key: p4.plans[0].key }, NOW, deps);
  const ex = await X.expireTidy(db3, 't1', NOW + 40 * MIN, deps);
  check('no answer by the deadline → nobody moves, the ask closes', ask3.ok && ex === 1 && (await db3.doc(`${T}/tidyAsks/${ask3.askId}`).get()).data().status === 'expired' && (await db3.doc(`${T}/appointments/bea`).get()).data().startTime === iso(NY('2026-10-14T14:00:00')));
  const old = (await db3.doc(`${T}/tidyAsks/${ask3.askId}`).get()).data().moves[0].token;
  check('a late tap changes nothing', (await X.tidyAnswer(db3, 't1', old, true, NOW + 41 * MIN, deps)).state === 'nochange' && (await db3.doc(`${T}/appointments/bea`).get()).data().startTime === iso(NY('2026-10-14T14:00:00')));
  // the day changed while they answered
  const db6 = makeDb(); await db6.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); await db6.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes' });
  for (const [id, a, b] of [['amy', '12:00', '13:00'], ['bea', '14:00', '15:00']]) await db6.doc(`${T}/appointments/${id}`).set({ id, clientName: id, clientPhone: '+15550008888', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: iso(NY(`2026-10-14T${a}:00`)), endTime: iso(NY(`2026-10-14T${b}:00`)), status: 'confirmed' });
  const p6: any = await X.tidyPlans(db6, 't1', 'maya', '2026-10-14', NOW, deps); const ask6: any = await X.askTidy(db6, 't1', { staffId: 'maya', name: 'Maya' }, { staffId: 'maya', date: '2026-10-14', key: p6.plans[0].key }, NOW, deps);
  await db6.doc(`${T}/appointments/desk`).set({ id: 'desk', staffId: 'maya', startTime: iso(NY('2026-10-14T13:00:00')), endTime: iso(NY('2026-10-14T13:30:00')), status: 'confirmed' });
  const ch: any = await X.tidyAnswer(db6, 't1', (await db6.doc(`${T}/tidyAsks/${ask6.askId}`).get()).data().moves[0].token, true, NOW + MIN, deps);
  check('if the day changed meanwhile (someone was booked in), the move is checked again and nobody is moved', ch.state === 'nochange' && (await db6.doc(`${T}/appointments/bea`).get()).data().startTime === iso(NY('2026-10-14T14:00:00')) && (await db6.doc(`${T}/tidyAsks/${ask6.askId}`).get()).data().status === 'failed');
  check('a plan from the browser that no longer works is refused', !(await X.askTidy(db6, 't1', { staffId: 'maya', name: 'Maya' }, { staffId: 'maya', date: '2026-10-14', key: 'bea@1' }, NOW + 2 * MIN, deps)).ok);

  console.log('Tidy my day — clear a light day');
  const db4 = makeDb(); await db4.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); await db4.doc(`${T}/staff/maya`).set({ id: 'maya', name: 'Maya Reyes' });
  const a4 = (id: string, s: string, e: string) => db4.doc(`${T}/appointments/${id}`).set({ id, clientName: `${id} Q`, clientPhone: '+15550004444', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', serviceName: 'Gel fill', startTime: iso(NY(s)), endTime: iso(NY(e)), status: 'confirmed' });
  await a4('ana', '2026-10-19T10:00:00', '2026-10-19T11:00:00');
  await a4('jo', '2026-10-21T12:00:00', '2026-10-21T13:00:00'); await a4('lu', '2026-10-21T13:00:00', '2026-10-21T14:00:00'); await a4('kim', '2026-10-21T15:00:00', '2026-10-21T16:00:00');
  const c: any = await X.clearPlans(db4, 't1', 'maya', NOW, deps);
  check('Monday has one visit and it fits Wednesday’s 2:00 gap exactly → “Clear Monday?”', c.days.length === 1 && c.days[0].date === '2026-10-19' && c.days[0].moves[0].to === NY('2026-10-21T14:00:00') && c.days[0].moves[0].exact, c.days);
  check('Wednesday (a full day) is never the one cleared', !c.days.some((x: any) => x.date === '2026-10-21'));
  const s4 = sent.length; const ask4: any = await X.askTidy(db4, 't1', { staffId: 'maya', name: 'Maya' }, { staffId: 'maya', key: c.days[0].key, kind: 'clear' }, NOW, deps);
  check('Ana is asked to switch days — “could your gel fill move from Monday … to Wednesday …?”', ask4.ok && /Could your gel fill move from Monday, Oct 19 at 10/.test(sent[s4]?.body || '') && /Wednesday, Oct 21 at 2/.test(sent[s4]?.body || ''), sent[s4]);
  await X.tidyAnswer(db4, 't1', (await db4.doc(`${T}/tidyAsks/${ask4.askId}`).get()).data().moves[0].token, true, NOW + H, deps);
  check('she says yes → moved to Wednesday 2:00; Monday is empty', (await db4.doc(`${T}/appointments/ana`).get()).data().startTime === iso(NY('2026-10-21T14:00:00')));
  const bd: any = await X.blockDay(db4, 't1', ask4.askId, 'maya', NOW + H);
  const off = (await db4.doc(`${T}/staffBlocks/dayoff_${ask4.askId}`).get()).data();
  check('“Block Monday off” → the whole day is blocked for Maya', bd.ok && off.staffId === 'maya' && off.startTime === iso(NY('2026-10-19T00:00:00')) && off.duration === 1440, off);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
