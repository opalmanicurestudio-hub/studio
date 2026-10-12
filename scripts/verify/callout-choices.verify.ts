// scripts/verify/callout-choices.verify.ts — a provider can't come in: her clients choose first (lib/callout-choices).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/callout-choices.verify.ts
import { makeDb, check, failures } from './fake-db';
const H = 3600e3, MIN = 60000; const iso = (n: number) => new Date(n).toISOString(); const et = (s: string) => Date.parse(`${s}-04:00`);
(async () => {
  const C = await import('../../src/lib/callout-choices');
  const tz = 'America/New_York'; const now = et('2026-10-14T07:40:00');
  console.log('Choose-by time');
  check('a Thursday 9:00 visit, told Wednesday morning → choose by 6:00 PM Wednesday', C.chooseByFor(et('2026-10-15T09:00:00'), now, tz, 'evening') === et('2026-10-14T18:00:00'));
  check('“24 hours before” → Wednesday 9:00 AM', C.chooseByFor(et('2026-10-15T09:00:00'), now, tz, 24) === et('2026-10-14T09:00:00'));
  check('a visit 2 hours away → no waiting: straight to the call list', C.chooseByFor(now + 2 * H, now, tz, 'evening') === 0);
  check('never later than 3 hours before the visit', C.chooseByFor(et('2026-10-14T20:00:00'), now, tz, 2) === et('2026-10-14T17:00:00'));

  const slots: Record<string, Record<string, string[]>> = { maya: { '2026-10-17': ['2026-10-17T10:00:00-04:00', '2026-10-17T11:00:00-04:00'], '2026-10-20': ['2026-10-20T14:30:00-04:00'] }, jo: { '2026-10-15': ['2026-10-15T09:00:00-04:00'] } };
  const deps = { engine: async () => ({ services: [{ id: 'gel', name: 'Gel fill', duration: 60 }], staff: [{ id: 'maya', name: 'Maya Reyes' }, { id: 'jo', name: 'Jo Park' }, { id: 'rae', name: 'Rae', renterId: 'r1' }] }),
    openTimes: (_e: any, o: any) => (slots[o.staffId]?.[o.date] || []).map((s) => ({ startIso: new Date(s).toISOString(), staffId: o.staffId })) };
  const fresh = async () => {
    const db = makeDb(); await db.doc('tenants/t1').set({ name: 'Opal Nail Studio', timezone: tz });
    for (const [id, name, role] of [['maya', 'Maya Reyes', 'stylist'], ['jo', 'Jo Park', 'stylist'], ['desk', 'Kim', 'front_desk']]) await db.doc(`tenants/t1/staff/${id}`).set({ id, name, role });
    const ap = (id: string, name: string, start: string) => ({ id, status: 'confirmed', staffId: 'maya', staffName: 'Maya Reyes', clientName: name, serviceId: 'gel', serviceName: 'Gel fill', startTime: iso(et(start)), endTime: iso(et(start) + 60 * MIN), checkInToken: `tok_${id}`, disruption: { kind: 'callout', id: 'c1', status: 'pending' } });
    await db.doc('tenants/t1/appointments/a1').set(ap('a1', 'Ana Ruiz', '2026-10-15T09:00:00')); await db.doc('tenants/t1/appointments/a2').set(ap('a2', 'Dee King', '2026-10-15T13:30:00'));
    const en = (id: string, name: string, start: string) => ({ appointmentId: id, clientName: name, startTime: iso(et(start)), serviceName: 'Gel fill', isRenterBooking: false, outcome: 'pending' });
    await db.doc('tenants/t1/providerCallouts/c1').set({ id: 'c1', staffId: 'maya', staffName: 'Maya Reyes', createdAt: iso(now), affected: { a1: en('a1', 'Ana Ruiz', '2026-10-15T09:00:00'), a2: en('a2', 'Dee King', '2026-10-15T13:30:00') } });
    await db.doc('tenants/t1/shiftDayOffBlocks/callout_c1_2026-10-15').set({ staffId: 'maya', date: '2026-10-15', calloutId: 'c1' });
    return db;
  };
  const rec = async (db: any) => (await db.doc('tenants/t1/providerCallouts/c1').get()).data();
  const appt = async (db: any, id: string) => ({ id, ...(await db.doc(`tenants/t1/appointments/${id}`).get()).data() });

  console.log('Recording the callout');
  let db = await fresh(); const p = await C.prepareChoices(db, 't1', { calloutId: 'c1', staffId: 'maya', toMs: et('2026-10-15T23:59:59'), now }, deps);
  let r = await rec(db); const blocks = (await db.collection('tenants/t1/staffBlocks').get()).docs.map((d: any) => d.data());
  check('one of Maya’s next free times is kept per client still choosing (two), nothing extra', p.kept === 2 && r.choices.keptTimes.length === 2 && blocks.length === 2 && blocks.every((b: any) => b.reason === 'callout_hold'), r.choices);
  check('…hidden from booking until 6:00 PM Wednesday (inside the 12-hour limit)', blocks.every((b: any) => b.until === iso(et('2026-10-14T18:00:00'))));
  { const db9 = await fresh(); await db9.doc('tenants/t1').set({ name: 'Opal Nail Studio', timezone: tz, bookingPolicies: { calloutHoldHours: 4 } }); await C.prepareChoices(db9, 't1', { calloutId: 'c1', staffId: 'maya', toMs: et('2026-10-15T23:59:59'), now }, deps);
    check('the hold never runs past the shop’s limit (4 hours here)', (await rec(db9)).choices.holdUntil === iso(now + 4 * H)); }
  check('Ana can keep her time with Jo (free and does gel); a renter is never offered', r.affected.a1.others.length === 1 && r.affected.a1.others[0].staffId === 'jo');
  check('Dee has nobody free at 1:30', r.affected.a2.others.length === 0);
  check('both choose by Wednesday 6:00 PM; nobody is on the call list yet', r.affected.a1.chooseBy === iso(et('2026-10-14T18:00:00')) && !r.affected.a1.needsCall && p.call === 0);

  console.log('The client chooses');
  const o = await C.optionsFor(db, 't1', await appt(db, 'a1'), now);
  check('Ana sees: Jo at the same time, and the kept times', o.ok && (o as any).others[0]?.name === 'Jo' && (o as any).kept.length === 2 && (o as any).provider === 'Maya', o);
  const t1 = await C.takeKeptTime(db, 't1', await appt(db, 'a2'), 'k0', now + 5 * MIN);
  const a2 = await appt(db, 'a2'); r = await rec(db);
  check('Dee takes Saturday 10:00 → her visit moves, the hold goes, the record says rescheduled', t1.ok && a2.startTime === iso(et('2026-10-17T10:00:00')) && a2.disruption.status === 'resolved' && r.affected.a2.outcome === 'rescheduled'
    && !(await db.doc('tenants/t1/staffBlocks/co_c1_k0').get()).exists, { t1, a2 });
  const t2 = await C.takeKeptTime(db, 't1', { ...(await appt(db, 'a1')) }, 'k0', now + 6 * MIN);
  check('…and nobody else can take the same time', !t2.ok && /just been chosen/.test((t2 as any).error));
  const sw = await C.switchProvider(db, 't1', await appt(db, 'a1'), 'jo', now + 7 * MIN); const a1 = await appt(db, 'a1');
  check('Ana keeps 9:00 with Jo; Maya stays on record as her original provider', sw.ok && a1.staffId === 'jo' && a1.originalStaffId === 'maya' && a1.disruption.outcome === 'reassigned');
  check('…the last kept time goes back to normal booking now that nobody is choosing', (await rec(db)).choices.done === true && (await db.collection('tenants/t1/staffBlocks').get()).docs.length === 0);
  check('…and Jo gets a bell', (await db.collection('tenants/t1/notifications').get()).docs.some((d: any) => d.data().userId === 'jo' && /now booked with you/.test(d.data().message)));

  console.log('After the choose-by time');
  db = await fresh(); await C.prepareChoices(db, 't1', { calloutId: 'c1', staffId: 'maya', toMs: et('2026-10-15T23:59:59'), now }, deps);
  check('before 6:00 PM nothing changes', (await C.calloutSweep(db, 't1', et('2026-10-14T17:00:00'))).called === 0);
  const s1 = await C.calloutSweep(db, 't1', et('2026-10-14T18:05:00')); r = await rec(db);
  check('at 6:05 PM both undecided clients are on the call list, and the desk is asked to call', s1.called === 2 && r.affected.a1.needsCall && (await db.collection('tenants/t1/notifications').get()).docs.some((d: any) => d.data().userId === 'desk' && /Please call/.test(d.data().message)));
  check('…their visits stay on the schedule (nobody is cancelled by silence)', (await appt(db, 'a1')).status === 'confirmed');
  const ops = (await db.collection('tenants/t1/openings').get()).docs.map((d: any) => d.data());
  check('the two kept times nobody picked go to the waitlist, and their holds are gone', s1.released === 2 && ops.length === 2 && ops.every((x: any) => x.source === 'callout' && x.gapChecked) && (await db.collection('tenants/t1/staffBlocks').get()).docs.length === 0);
  check('told once', (await C.calloutSweep(db, 't1', et('2026-10-14T18:10:00'))).called === 0);

  console.log('First in line, and “back after all”');
  db = await fresh(); const wid = await C.firstInLine(db, 't1', await appt(db, 'a2'), now); const w = (await db.doc(`tenants/t1/waitlist/${wid}`).get()).data();
  check('first in line: a waitlist entry for Maya, owed priority for 14 days', w.staffId === 'maya' && w.serviceId === 'gel' && w.status === 'waiting' && Date.parse(w.priorityUntil) > now + 13 * 864e5);
  await C.prepareChoices(db, 't1', { calloutId: 'c1', staffId: 'maya', toMs: et('2026-10-15T23:59:59'), now }, deps);
  await C.takeKeptTime(db, 't1', await appt(db, 'a2'), 'k1', now);
  const b = await C.backAfterAll(db, 't1', 'c1', now + H);
  check('Maya can come in after all: Ana (undecided) keeps 9:00 as booked; Dee keeps her new time', b.ok && (b as any).kept === 1 && (await appt(db, 'a1')).disruption.outcome === 'kept' && (await appt(db, 'a2')).startTime === iso(et('2026-10-17T11:00:00')));
  check('…her day off and the kept times are cleared', !(await db.doc('tenants/t1/shiftDayOffBlocks/callout_c1_2026-10-15').get()).exists && (await db.collection('tenants/t1/staffBlocks').get()).docs.length === 0);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
