// Checks Part 6, round 3: a renter's visit runs on the RENTER's Before the visit — their services and questions, their
// rules and business name — and their decisions never reach the studio's desk, deposits or waitlist (lib/prep-ctx).
// Run: npx tsx scripts/verify/renter-prep.verify.ts
import { prepCtx } from '../../src/lib/prep-ctx';
import { prepInfo } from '../../src/lib/prep-check-server';
import { applyPrep, cancelFree } from '../../src/lib/prep-actions';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const store: Record<string, any> = {}; let n = 0;
const docRef = (p: string) => ({ id: p.split('/').pop(), get: async () => ({ exists: !!store[p], data: () => store[p] }), set: async (v: any, o?: any) => { store[p] = o?.merge ? { ...(store[p] || {}), ...v } : v; }, delete: async () => { delete store[p]; } });
const coll = (p: string) => { const rows = () => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: docRef(k) }));
  const q = (f: (d: any) => boolean) => ({ get: async () => { const docs = rows().filter((d) => f(d.data())); return { docs, empty: !docs.length }; }, limit: () => q(f), where: (g: string, _o: string, v: any) => q((d) => f(d) && d[g] === v) });
  return { get: async () => ({ docs: rows(), empty: !rows().length }), where: (f: string, _o: string, v: any) => q((d) => d[f] === v), doc: (id?: string) => docRef(`${p}/${id || `n${++n}`}`) }; };
const db: any = { doc: docRef, collection: coll };
(async () => {
  const start = new Date(Date.now() + 3 * 864e5).toISOString(); const end = new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString();
  store['tenants/t'] = { name: 'Opal Studio', prepCheck: { quote: 'about', onDayFeeCents: 2500 } };
  store['tenants/t/services/fill'] = { name: 'Studio fill', price: 55, duration: 60, prepCheck: { on: true, questions: [] } };
  store['tenants/t/staff/s1'] = { role: 'renter', renterId: 'R1', name: 'Dani Ruiz' }; store['tenants/t/renters/R1'] = { businessName: 'Brows by Dani' };
  store['tenants/t/renterSettings/s1'] = { prep: { quote: 'upto', autoMinutes: 0 } };
  const check = { on: true, version: 1, questions: [{ id: 'q1', label: 'Tinted elsewhere lately?', kind: 'choice', options: [{ id: 'no', label: 'No', effect: {} }, { id: 'yes', label: 'Yes', effect: { addOns: [{ id: 'patch', qty: 1 }], addMinutes: 10 } }] }] };
  store['tenants/t/renterServices/lam'] = { staffId: 's1', name: 'Brow lamination', price: 70, duration: 60, prepCheck: check };
  store['tenants/t/renterServices/patch'] = { staffId: 's1', name: 'Patch test', price: 10, duration: 10 };
  store['tenants/t/appointments/v'] = { staffId: 's1', isRenterBooking: true, serviceId: 'lam', serviceName: 'Brow lamination', clientName: 'Maya R', startTime: start, endTime: end, price: 70, status: 'confirmed', depositStatus: 'paid', depositAmountCents: 2000 };
  const ctx = await prepCtx(db, 't', store['tenants/t/appointments/v']);
  ok(ctx.renter && ctx.brand.name === 'Brows by Dani' && ctx.S.quote === 'upto' && ctx.services.map((x) => x.id).sort().join() === 'lam,patch', 'a renter’s visit: their services, their rules (Up to, not the studio’s About), their name');
  const sctx = await prepCtx(db, 't', { staffId: 'm', serviceId: 'fill' });
  ok(!sctx.renter && sctx.S.quote === 'about' && sctx.services.some((x) => x.id === 'fill'), 'a studio visit still runs on the studio’s rules');
  const info: any = await prepInfo(db, 't', { id: 'v', a: store['tenants/t/appointments/v'] });
  ok(info.brand.name === 'Brows by Dani' && info.check?.questions.length === 1 && info.catalog.some((x: any) => x.id === 'patch') && info.renter, 'the client’s page shows the renter’s business and the renter’s questions');
  ok(!info.goodToKnow.some((g: string) => /\$25 fee/.test(g)) && !info.goodToKnow.some((g: string) => /^Otherwise, changing/.test(g)), '“Good to know” never quotes the studio’s fee or cancellation policy');
  store['tenants/t/appointments/v'].prep = { answeredAt: 'x', status: 'agreed', fits: true, quote: { serviceId: 'lam', serviceName: 'Brow lamination', switched: false, addOns: [{ id: 'patch', name: 'Patch test', qty: 1, priceEach: 10 }], addMinutes: 10, oldPrice: 70, newPrice: 80, oldMinutes: 60, newMinutes: 70, changed: true, safety: null, lines: ['Patch test · $10', 'About 10 more minutes'] } };
  const r: any = await applyPrep(db, 't', 'v', { name: 'Dani' });
  ok(r.ok && store['tenants/t/appointments/v'].price === 80 && store['tenants/t/appointments/v'].priceIsCeiling === true, 'the renter approves → on the booking, up to $80');
  store['tenants/t/appointments/v2'] = { ...store['tenants/t/appointments/v'], prep: { status: 'answered' } };
  const c: any = await cancelFree(db, 't', 'v2', { name: 'Dani' });
  ok(c.ok && c.depositToRefund === 2000 && !Object.keys(store).some((k) => k.includes('/depositDecisions/')), 'cancelled with no fee → the renter refunds their own deposit; nothing goes to the studio’s deposit decisions');
  ok(!Object.keys(store).some((k) => k.includes('/waitlist/')) && !Object.values(store).some((v: any) => v?.type === 'prep_check' && !v.userId && /opened/.test(v.message || '')), 'and the freed time isn’t offered to the studio’s waitlist');
  console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
})();
