// scripts/verify/outreach-pause.verify.ts — "Hold automatic offers today" (lib/outreach-pause) stops every automatic sender.
import { pausedNow, pauseUntil } from '../../src/lib/outreach-pause';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
const NOW = Date.parse('2026-10-14T12:00:00-04:00'); const ten = { timezone: 'America/New_York' };
const until = pauseUntil(ten, NOW);
ok(until.startsWith('2026-10-15T03:59'), `ends at local midnight (${until})`);
ok(pausedNow({ outreachPause: { until } }, NOW) && !pausedNow({ outreachPause: { until } }, Date.parse(until) + 1000) && !pausedNow({}, NOW), 'on today, off after midnight');
(async () => {
  const { makeDb } = await import('./fake-db'); const W = await import('../../src/lib/waitlist-server'); const L = await import('../../src/lib/loyalty-server');
  const db = makeDb(); const T = 'tenants/t1'; const S = '2026-10-16T18:00:00.000Z';
  const tenant = { name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' }, outreachPause: { until } };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/appointments/a`).set({ id: 'a', staffId: 'maya', staffName: 'Maya', serviceId: 'gel', startTime: S, endTime: '2026-10-16T19:00:00.000Z', status: 'cancelled', cancelledAt: new Date(NOW - 60000).toISOString() });
  await db.doc(`${T}/waitlist/w`).set({ id: 'w', status: 'waiting', name: 'Jen', phone: '+15550004', serviceId: 'gel', createdAt: '2026-10-01T12:00:00Z' });
  const sent: any[] = []; const deps: any = { send: async (_d: any, _t: string, to: string) => { sent.push(to); return { ok: true }; }, book: async () => ({ ok: false }),
    engine: async () => ({ services: [{ id: 'gel', name: 'Gel', duration: 60 }], staff: [] }), openTimes: () => [{ startIso: S }] };
  await W.waitlistSweep(db, 't1', tenant, NOW, deps);
  ok(sent.length === 0 && (await db.doc(`${T}/openings/op_a`).get()).exists, 'waitlist: the opening is found but nobody is texted');
  await W.waitlistSweep(db, 't1', { ...tenant, outreachPause: null }, NOW + 60000, deps);
  ok(sent.length === 1, 'turned back on: the offer goes');
  const r: any = await L.automationSweep(db, 't1', { ...tenant, loyalty: { on: true, auto: { rewardReady: true }, rewards: [] } }, NOW);
  ok(r.skipped === 'held today', 'reward texts held');
  const O = await import('../../src/lib/opportunities-server'); const o: any = await O.opportunitySweep(db, 't1', { ...tenant, opportunities: { on: true } }, NOW);
  ok(o.skipped === 'held today', `opportunities held (${o.skipped})`);
  if (bad) process.exit(1); console.log('outreach pause ok');
})().catch((e) => { console.error(e); process.exit(1); });
