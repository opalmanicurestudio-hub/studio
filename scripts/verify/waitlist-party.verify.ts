// scripts/verify/waitlist-party.verify.ts — parties on the waitlist (lib/waitlist-party + the server half).
import { partySet, partyOf, partyOfferText } from '../../src/lib/waitlist-party';
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };
const o = (id: string, staffId: string, start: string) => ({ id, staffId, start });
ok(partyOf({ party: 3 }) === 3 && partyOf({}) === 1 && partyOf({ party: 9 }) === 1, 'party size');
const ops = [o('a', 'maya', '2026-10-16T18:00:00Z'), o('b', 'jo', '2026-10-16T18:15:00Z'), o('c', 'maya', '2026-10-16T18:30:00Z'), o('d', 'lee', '2026-10-16T19:30:00Z'), o('e', 'lee', '2026-10-17T18:00:00Z')];
ok(partySet(ops, 2)?.map((x) => x.id).join() === 'a,b', 'two people: two providers within 30 minutes');
ok(partySet(ops, 3) === null, 'three: nobody else close enough on that day');
ok(partySet([...ops, o('f', 'lee', '2026-10-16T18:20:00Z')], 3)?.map((x) => x.id).join() === 'a,b,f', 'three when a third opens nearby');
ok(partySet(ops, 2, (x) => x.id !== 'a')?.map((x) => x.id).join() === 'b,c', 'skips what does not fit');
ok(/all 3 of you/.test(partyOfferText({ first: 'Ana', size: 3, service: 'gel', when: 'Fri at 2', spread: true, link: 'L', holdMin: 30 })), 'text');

(async () => {
  const { makeDb } = await import('./fake-db'); const W = await import('../../src/lib/waitlist-server');
  const NOW = Date.parse('2026-10-14T12:00:00-04:00'); const A = '2026-10-16T18:00:00.000Z', B = '2026-10-16T18:15:00.000Z';
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', tidy: { gapMode: 'waitlist' } });
  const ap = (id: string, staffId: string, start: string) => db.doc(`${T}/appointments/${id}`).set({ id, staffId, staffName: staffId === 'maya' ? 'Maya Reyes' : 'Jo Park', serviceId: 'gel', startTime: start, endTime: new Date(Date.parse(start) + 3600e3).toISOString(), status: 'cancelled', cancelledAt: new Date(NOW - 5 * 60000).toISOString() });
  await ap('x1', 'maya', A); await ap('x2', 'jo', B);
  await db.doc(`${T}/waitlist/bride`).set({ id: 'bride', status: 'waiting', name: 'Bea Cole', phone: '+15550009', serviceId: 'gel', party: 2, createdAt: '2026-10-10T12:00:00Z' });
  await db.doc(`${T}/waitlist/solo`).set({ id: 'solo', status: 'waiting', name: 'Sol Diaz', phone: '+15550010', serviceId: 'gel', createdAt: '2026-10-01T12:00:00Z' });
  const sent: any[] = [], booked: any[] = [];
  const deps: any = { send: async (_d: any, _t: string, to: string, body: string) => { sent.push({ to, body }); return { ok: true }; },
    book: async (_t: any, body: any) => { booked.push(body); return { ok: true, appointmentId: `n${booked.length}`, checkInToken: `tok${booked.length}`, status: 'pending_payment', depositCents: 2000 }; },
    engine: async () => ({ services: [{ id: 'gel', name: 'Gel fill', duration: 60, price: 65 }], staff: [], tz: 'America/New_York' }),
    openTimes: (_e: any, q: any) => (q.staffId === 'maya' ? [{ startIso: A }] : [{ startIso: B }]) };
  const ten = async () => (await db.doc(T).get()).data();
  await W.waitlistSweep(db, 't1', await ten(), NOW, deps);
  const lead: any = (await db.doc(`${T}/openings/op_x1`).get()).data(); const other: any = (await db.doc(`${T}/openings/op_x2`).get()).data();
  ok(lead.party?.status === 'sent' && lead.party.openingIds.join() === 'op_x1,op_x2' && other.partyLock?.leadId === 'op_x1', 'both times held for the party', );
  ok(sent.length === 1 && sent[0].to === '+15550009' && /all 2 of you/.test(sent[0].body), 'only the organizer is texted, before the solo person');
  const view: any = await W.viewOffer(db, 't1', lead.party.token, NOW + 60000);
  ok(view.party && view.state === 'open' && view.times.length === 2, 'the party link shows both times');
  const r: any = await W.takeOffer(db, 't1', lead.party.token, NOW + 2 * 60000, deps, ['Mia']);
  ok(r.ok && r.booked === 2 && booked[1].client.name === 'Mia', 'organizer books everyone, guest named');
  const a1: any = (await db.doc(`${T}/appointments/n1`).get()).data(), a2: any = (await db.doc(`${T}/appointments/n2`).get()).data();
  ok(a1.depositAmountCents === 4000 && a2.depositAmountCents === 0 && a2.depositPaidBy === 'organizer', 'one deposit for the party, on the organizer');
  ok(((await db.doc(`${T}/openings/op_x2`).get()).data() as any).status === 'filled' && ((await db.doc(`${T}/waitlist/bride`).get()).data() as any).status === 'booked', 'both filled, bride booked');
  // A party that doesn't answer: the times go to individuals.
  const db2 = makeDb(); await db2.doc(T).set((await ten()) as any); const sent2: any[] = [];
  const d2 = { ...deps, send: async (_d: any, _t: string, to: string, body: string) => { sent2.push({ to, body }); return { ok: true }; } };
  for (const [id, st, s] of [['x1', 'maya', A], ['x2', 'jo', B]] as const) await db2.doc(`${T}/appointments/${id}`).set({ id, staffId: st, staffName: 'P', serviceId: 'gel', startTime: s, endTime: new Date(Date.parse(s) + 3600e3).toISOString(), status: 'cancelled', cancelledAt: new Date(NOW - 5 * 60000).toISOString() });
  await db2.doc(`${T}/waitlist/bride`).set({ id: 'bride', status: 'waiting', name: 'Bea Cole', phone: '+15550009', serviceId: 'gel', party: 2, createdAt: '2026-10-10T12:00:00Z' });
  await db2.doc(`${T}/waitlist/solo`).set({ id: 'solo', status: 'waiting', name: 'Sol Diaz', phone: '+15550010', serviceId: 'gel', createdAt: '2026-10-01T12:00:00Z' });
  await W.waitlistSweep(db2, 't1', await ten(), NOW, d2);
  await W.waitlistSweep(db2, 't1', await ten(), NOW + 31 * 60000, d2);
  ok(sent2.some((x) => x.to === '+15550010'), 'after the party hold ends, the solo person gets an offer');
  ok(sent2.filter((x) => x.to === '+15550009').length === 1, 'the party is not offered the same times twice');
  if (bad) process.exit(1); console.log('waitlist parties ok');
})().catch((e) => { console.error(e); process.exit(1); });
