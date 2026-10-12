// Checks Before the visit, round 3: add-on counts and the "up to" price at checkout (lib/prep-checkout, lib/checkout-calc),
// and the change agreed in person on the day (lib/prep-day).
// Run: npx tsx scripts/verify/prep-day.verify.ts
import { addOnIdsOf, ceilingOf, overCeiling, workOf, prepAddOnsOf, usedQty } from '../../src/lib/prep-checkout';
import { computeCheckout } from '../../src/lib/checkout-calc';
import { dayQuote, dayChange, currentOf } from '../../src/lib/prep-day';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

const services = [
  { id: 'fill', name: 'Gel fill', price: 55, duration: 60, category: 'nails' },
  { id: 'set', name: 'New set', price: 85, duration: 90, category: 'nails', certifiedStaffIds: ['z'] },
  { id: 'rep', name: 'Repair', price: 5, duration: 10, type: 'addon' },
  { id: 'art', name: 'Nail art', price: 15, duration: 15, type: 'addon' },
];
const store: Record<string, any> = {};
const docRef = (p: string) => ({ get: async () => ({ exists: !!store[p], data: () => store[p] }), set: async (v: any, o?: any) => { store[p] = o?.merge ? deep(store[p] || {}, v) : v; }, delete: async () => { delete store[p]; } });
function deep(a: any, b: any): any { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deep(a[k], v) : v; return out; }
let n = 0;
const coll = (p: string) => { const rows = () => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: docRef(k) }));
  return { get: async () => ({ docs: rows() }), where: () => ({ get: async () => ({ docs: rows() }) }), doc: (id?: string) => docRef(`${p}/${id || `n${++n}`}`) }; };
const db: any = { doc: docRef, collection: coll };

(async () => {
  // ── add-on counts ──
  const a1 = { addOnIds: ['art', 'rep'], addOnIdsBeforePrep: ['art'], prepAddOns: [{ id: 'rep', qty: 2, priceEach: 5 }] };
  ok(addOnIdsOf(a1).join() === 'art,rep,rep', 'Repair × 2 is charged twice; the booked add-on once');
  ok(addOnIdsOf({ ...a1, checkoutState: { prepUsed: { rep: 1 } } }).join() === 'art,rep', 'lowered to 1 at checkout → charged once');
  ok(addOnIdsOf({ ...a1, checkoutState: { prepUsed: { rep: 9 } } }).join() === 'art,rep,rep', 'can’t raise past what they agreed');
  ok(addOnIdsOf({ ...a1, addOnIds: ['art'] }).join() === 'art', 'taken off the booking since → not charged');
  ok(addOnIdsOf({ addOnIds: ['rep'], addOnIdsBeforePrep: ['rep'], prepAddOns: [{ id: 'rep', qty: 1 }] }).join() === 'rep,rep', 'one booked + one more agreed = two');
  ok(addOnIdsOf({ addOnIds: ['art'] }).join() === 'art', 'no change agreed → as booked');
  ok(prepAddOnsOf({ prepAddOns: [{ id: 'rep', qty: 1, priceEach: 5 }, { id: 'rep', qty: 2 }] })[0].qty === 3 && usedQty({}, { id: 'rep', qty: 3, priceEach: 5 }) === 3, 'counts add up across changes');

  // ── the ceiling ──
  const visit = (a: any) => ({ appointment: { id: 'v', staffId: 'm', ...a }, service: services[0], addOnServices: addOnIdsOf(a).map((id) => services.find((s) => s.id === id)) });
  const calc = (a: any) => computeCheckout({ tenant: {}, visits: [visit(a)], staff: [{ id: 'm' }], items: [], fees: [], discounts: [], client: { id: 'c' }, memberships: [], tip: 0 } as any);
  const booked = { addOnIds: ['rep'], addOnIdsBeforePrep: [], prepAddOns: [{ id: 'rep', qty: 2, priceEach: 5 }], price: 65, priceIsCeiling: true };
  let c = calc(booked); ok(c.subtotal === 65 && workOf(c.visits[0]) === 65 && !overCeiling(booked, 65).over, 'checkout charges the agreed $65');
  c = calc({ ...booked, checkoutState: { prepUsed: { rep: 0 } } }); ok(c.subtotal === 55, 'no repairs needed → $55, less than agreed');
  c = calc({ ...booked, checkoutState: { adjustments: { rescheduleFee: 0, timeOverage: 20, materialOverage: 0 } } });
  ok(overCeiling(booked, workOf(c.visits[0])).over && overCeiling(booked, workOf(c.visits[0])).by === 20, 'extra time on top → $20 over what they agreed');
  ok(!overCeiling({ ...booked, checkoutState: { overAgreed: { at: 'x' } } }, 85).over, 'unless they agreed to more in person');
  ok(ceilingOf({ price: 65 }) === null && !overCeiling({ price: 65 }, 99).over, 'no "up to" price → no ceiling');
  c = calc({ ...booked, checkoutState: { adjustments: { rescheduleFee: 0, timeOverage: 0, materialOverage: 0, dayChangeFee: 10 } } });
  ok(c.subtotal === 75 && workOf(c.visits[0]) === 65 && c.visits[0].dayChangeFee === 10, 'the on-the-day fee is charged but isn’t part of the work');

  // ── on the day ──
  const start = new Date(Date.now() + 30 * 60000); const iso = (m: number) => new Date(start.getTime() + m * 60000).toISOString();
  store['tenants/t'] = { prepCheck: { onDay: 'fit_rebook', onDayFeeCents: 1000 } };
  services.forEach((s) => { store[`tenants/t/services/${s.id}`] = s; });
  store['tenants/t/appointments/k'] = { staffId: 'm', clientName: 'Kim Lee', serviceId: 'fill', serviceName: 'Gel fill', startTime: iso(0), endTime: iso(60), status: 'arrived', price: 55, addOnIds: [] };
  store['tenants/t/appointments/jo'] = { staffId: 'm', clientName: 'Jo', startTime: iso(90), endTime: iso(150), status: 'confirmed' };
  const k = () => store['tenants/t/appointments/k'];
  ok(currentOf(k(), services).price === 55 && currentOf(k(), services).minutes === 60, 'the visit as it stands: $55, 60 min');
  const q = dayQuote(k(), services, { addOns: [{ id: 'rep', qty: 3 }], addMinutes: 0 });
  ok(q.newPrice === 70 && q.newMinutes === 60 && q.lines[0].startsWith('Repair × 3'), 'Repair × 3 → up to $70');
  let r: any = await dayChange(db, 't', 'k', { name: 'Maya' }, { addOns: [{ id: 'rep', qty: 3 }], addMinutes: 20, answer: 'no' });
  ok(r.ok && r.outcome === 'kept' && k().price === 55 && k().dayChanges.length === 1 && k().dayChange.answer === 'no', 'they said no → kept as booked, and the answer is recorded');
  r = await dayChange(db, 't', 'k', { name: 'Maya', staffId: 'm' }, { addOns: [{ id: 'rep', qty: 3 }], addMinutes: 20, answer: 'yes', fee: true });
  ok(r.ok && r.outcome === 'applied' && k().price === 70 && k().priceIsCeiling === true && k().duration === 80 && k().endTime === iso(80), 'yes and it fits → on the booking: up to $70, until +80 min');
  ok(addOnIdsOf(k()).join() === 'rep,rep,rep' && k().checkoutState.adjustments.dayChangeFee === 10 && k().dayChanges.length === 2 && k().dayChanges[1].shownInPerson, 'three repairs to charge, the $10 fee, two records');
  r = await dayChange(db, 't', 'k', { name: 'Maya' }, { addMinutes: 30, answer: 'yes' });
  ok(r.ok && r.outcome === 'rebook_rest' && k().price === 70 && k().endTime === iso(80), 'doesn’t fit (Jo at +90) → do what fits and book the rest; nothing changes');
  ok(Object.values(store).some((v: any) => v?.type === 'prep_check' && /book the rest/.test(v.message || '')), 'the desk is told to book the rest');
  store['tenants/t'] = { prepCheck: { onDay: 'provider' } };
  r = await dayChange(db, 't', 'k', { name: 'Maya' }, { addMinutes: 30, answer: 'yes', runOver: true, fee: true });
  ok(r.ok && r.outcome === 'applied_over' && k().endTime === iso(110) && r.fee === 0, 'provider’s call: they can run over on purpose (no fee set → none)');
  r = await dayChange(db, 't', 'k', { name: 'Maya' }, { switchServiceId: 'set', answer: 'yes' });
  ok(!r.ok && /certified/.test(r.error), 'can’t switch to a service they aren’t certified for');
  r = await dayChange(db, 't', 'k', { name: 'Maya' }, { answer: 'yes' });
  ok(!r.ok, 'nothing picked → nothing to ask');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
