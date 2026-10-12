// Checks lib/prep-actions: whether the extra time fits after a visit, and the booking fields a quote becomes.
// Run: npx tsx scripts/verify/prep-actions.verify.ts
import { fitsAfter, bookingFieldsFor, endOf } from '../../src/lib/prep-actions';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const docs = (rows: any[]) => ({ docs: rows.map((r) => ({ id: r.id, data: () => r })) });
const fake = (apps: any[], blocks: any[]) => ({ collection: (p: string) => ({ where: () => ({ get: async () => (p.endsWith('/appointments') ? docs(apps) : docs(blocks)) }) }) });
const kim = { id: 'k', staffId: 'm', startTime: '2026-10-15T18:00:00Z', endTime: '2026-10-15T19:00:00Z', status: 'confirmed' };
(async () => {
  ok(endOf(kim) === Date.parse('2026-10-15T19:00:00Z') && endOf({ startTime: '2026-10-15T18:00:00Z', duration: 45 }) === Date.parse('2026-10-15T18:45:00Z'), 'end of a visit');
  const jo = { id: 'j', staffId: 'm', startTime: '2026-10-15T19:30:00Z', endTime: '2026-10-15T20:30:00Z', status: 'confirmed' };
  let r = await fitsAfter(fake([kim, jo], []) as any, 't', 'k', kim, 10); ok(r.fits && r.freeMinutes === 30, '10 more minutes fit before Jo (30 free)');
  r = await fitsAfter(fake([kim, jo], []) as any, 't', 'k', kim, 40); ok(!r.fits, '40 more minutes don’t fit');
  r = await fitsAfter(fake([kim, { ...jo, status: 'cancelled' }], []) as any, 't', 'k', kim, 40); ok(r.fits, 'a cancelled visit doesn’t count');
  r = await fitsAfter(fake([kim], [{ id: 'prep_k', staffId: 'm', startTime: '2026-10-15T19:00:00Z', duration: 30 }]) as any, 't', 'k', kim, 20); ok(r.fits, 'our own hold doesn’t block us');
  r = await fitsAfter(fake([kim], [{ id: 'x', staffId: 'm', startTime: '2026-10-15T19:10:00Z', duration: 30 }]) as any, 't', 'k', kim, 20); ok(!r.fits && r.freeMinutes === 10, 'someone else’s block does');
  r = await fitsAfter(fake([kim, { ...jo, startTime: '2026-10-15T19:20:00Z', padBefore: 10 }], []) as any, 't', 'k', kim, 15); ok(!r.fits, 'the next visit’s set-up time counts');
  const q: any = { switched: true, serviceId: 'set', serviceName: 'New set', addOns: [{ id: 'rep', qty: 2, priceEach: 5 }], newMinutes: 100, newPrice: 95 };
  const f = bookingFieldsFor({ ...kim, addOnIds: ['x'], serviceId: 'fill' }, q);
  ok(f.serviceId === 'set' && f.previousServiceId === 'fill' && f.addOnIds.join() === 'x,rep' && f.duration === 100 && f.endTime === '2026-10-15T19:40:00.000Z' && f.price === 95 && f.priceIsCeiling, 'booking fields: service, add-ons, time, ceiling price');
  ok(bookingFieldsFor(kim, { ...q, switched: false }, Date.parse('2026-10-16T15:00:00Z')).endTime === '2026-10-16T16:40:00.000Z', 'a new time takes the new length');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
