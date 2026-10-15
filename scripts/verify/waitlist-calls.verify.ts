import { callSettingsOf, callWindow, mayCall, nextCallStep, unanswered, callsAllowed, callTask } from '../../src/lib/waitlist-calls';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
const H = 3600e3, now = Date.parse('2026-10-15T15:00:00Z');
ok(callSettingsOf({}).on === false, 'off by default');
ok(callSettingsOf({ waitlistCalls: { on: true, capDollars: 30 } }).capDollars === 30, 'cap kept');
ok(callsAllowed({ on: true, capDollars: 15 }) === 100, 'cap to calls');
ok(callWindow(now + 2 * H, now, 11), 'under 3h in hours');
ok(!callWindow(now + 4 * H, now, 11), 'not 4h away');
ok(!callWindow(now + 2 * H, now, 19), 'not at 7pm');
ok(!callWindow(now + 2 * H, now, 8), 'not before 9');
ok(!callWindow(now + 10 * 60000, now, 12), 'not 10 minutes away');
ok(mayCall({ callOk: true }, {}) && mayCall({}, { openingCalls: true }) && !mayCall({}, {}) && !mayCall({ callOk: true }, { doNotCall: true }), 'consent');
const at = (m: number) => new Date(now - m * 60000).toISOString();
let s = nextCallStep([{ status: 'calling', at: at(2) }], now); ok(s.wait && s.room === 2, 'wait on a live call');
s = nextCallStep([{ status: 'calling', at: at(6) }, { status: 'declined', at: at(20) }], now); ok(!s.wait && s.settle.length === 1 && s.room === 1, 'settle');
s = nextCallStep([{}, {}, {}].map(() => ({ status: 'no_answer', at: at(30) })), now); ok(s.room === 0, 'three max');
ok(unanswered(null) && unanswered({ disconnectionReason: 'voicemail_reached', durationSeconds: 40 }) && unanswered({ durationSeconds: 6 }) && !unanswered({ disconnectionReason: 'user_hangup', durationSeconds: 70 }), 'unanswered');
const t = callTask({ first: 'Maria', business: 'Opal', service: 'gel manicure', provider: 'Jess', when: 'today at 2:30' });
ok(/Never take a card number/.test(t) && /without leaving a message/.test(t), 'task rules');
console.log('waitlist-calls rules checked');

// The sweep, with an in-memory database: call → no answer → text; then the next person is called and books on the call.
(async () => {
  const { makeDb } = await import('./fake-db'); const W = await import('../../src/lib/waitlist-server');
  const MIN = 60000; const NOW = Date.parse('2026-10-14T12:00:00-04:00'); const TWO = '2026-10-14T18:00:00.000Z', THREE = '2026-10-14T19:00:00.000Z';
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' }, voiceAgent: { phoneNumber: '+15550000' }, waitlistCalls: { on: true, capDollars: 20 } });
  await db.doc(`${T}/appointments/ana`).set({ id: 'ana', staffId: 'maya', staffName: 'Maya Reyes', serviceId: 'gel', startTime: TWO, endTime: THREE, status: 'cancelled', cancelledAt: new Date(NOW - 5 * MIN).toISOString() });
  const wl = (id: string, d: any) => db.doc(`${T}/waitlist/${id}`).set({ id, status: 'waiting', serviceId: 'gel', noticeHours: 1, ...d });
  await wl('priya', { name: 'Priya Shah', phone: '+15550003', staffId: 'maya', createdAt: '2026-10-01T12:00:00Z' });            // no call consent
  await wl('jen', { name: 'Jen Alvarez', phone: '+15550004', callOk: true, createdAt: '2026-10-05T12:00:00Z' });
  await wl('kim', { name: 'Kim Lee', phone: '+15550005', callOk: true, createdAt: '2026-10-08T12:00:00Z' });
  const sent: any[] = [], calls: any[] = []; let open = true;
  const deps: any = { send: async (_d: any, _t: string, to: string, body: string) => { sent.push({ to, body }); return { ok: true }; }, book: async () => ({ ok: false }),
    engine: async () => ({ services: [{ id: 'gel', name: 'Gel fill', duration: 60, price: 65 }], staff: [{ id: 'maya', name: 'Maya Reyes' }], tz: 'America/New_York' }),
    openTimes: () => (open ? [{ startIso: TWO }] : []), call: async (o: any) => { calls.push(o); return { ok: true, callId: `call${calls.length}` }; }, vars: async () => ({ tenant_id: 't1' }) };
  const ten = async () => (await db.doc(T).get()).data();
  const opOf = async () => (await db.doc(`${T}/openings/op_ana`).get()).data() as any;
  await W.waitlistSweep(db, 't1', await ten(), NOW, deps);
  ok(calls.length === 1 && calls[0].toNumber === '+15550004' && sent.length === 0, 'calls Jen first (said yes to calls), no texts while the call is live');
  ok(/without leaving a message/.test(calls[0].dynamicVariables.outbound_task), 'no voicemail');
  await W.waitlistSweep(db, 't1', await ten(), NOW + 2 * MIN, deps);
  ok(calls.length === 1 && sent.length === 0, 'waits for the live call');
  await db.doc(`${T}/voiceCalls/call1`).set({ disconnectionReason: 'dial_no_answer', durationSeconds: 0 });
  await W.waitlistSweep(db, 't1', await ten(), NOW + 6 * MIN, deps);
  let op = await opOf();
  ok(op.calls[0].status === 'no_answer' && sent.some((x) => x.to === '+15550004'), 'no answer → Jen gets the text instead');
  ok(calls.length === 2 && calls[1].toNumber === '+15550005', 'then Kim is called');
  await db.doc(`${T}/appointments/kimbook`).set({ id: 'kimbook', staffId: 'maya', clientPhone: '+15550005', startTime: TWO, status: 'confirmed' }); open = false;
  await W.waitlistSweep(db, 't1', await ten(), NOW + 12 * MIN, deps);
  op = await opOf();
  ok(op.status === 'filled' && op.filledBy?.byCall && op.calls[1].status === 'booked', 'Kim booked on the call → filled');
  ok(((await db.doc(`${T}/waitlist/kim`).get()).data() as any).status === 'booked', 'Kim off the list');
  ok(calls.length === 2, 'never more calls after it fills');
  ok(((await ten()) as any).waitlistCallsUsed?.['2026-10'] === 2, 'counted toward the monthly limit');
  if (bad) process.exit(1); console.log('waitlist-calls sweep ok');
})().catch((e) => { console.error(e); process.exit(1); });
