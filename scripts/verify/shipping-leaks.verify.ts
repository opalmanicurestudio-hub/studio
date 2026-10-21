// Checks the shipping money leaks are plugged: insurance shared across boxes, the service the customer paid for,
// unused labels voided only when the carrier never scanned them, and the Needs you list.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shipping-leaks.verify.ts
import { insuredParcels, splitInsurance, protectionFor } from '../../src/lib/shipment-protection';
import { paidServiceRate, choseService } from '../../src/lib/paid-service';
import { neverScanned, trackingCarrier, voidIfUnused } from '../../src/lib/label-sweep';
import { needsYou } from '../../src/lib/orders-view';

let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

(async () => {
  // Insurance shared across boxes.
  const s = splitInsurance(30000, [32, 16, 16]);
  ok(s.join() === '15000,7500,7500', 'a $300 order in three boxes: each box insured for its share by weight');
  ok(splitInsurance(10001, [1, 1, 1]).reduce((a, b) => a + b, 0) === 10001, 'the shares add up to the cent');
  ok(splitInsurance(9000, [0, 0, 0]).join() === '3000,3000,3000', 'no weights: shared evenly');
  ok(splitInsurance(5000, [12]).join() === '5000', 'one box keeps the whole amount');
  const decision = { signature: 'NONE' as const, insuranceCents: 30000, reasons: [] };
  const many = insuredParcels(decision, [{ weight: '32' }, { weight: '16' }, { weight: '16' }]);
  ok(!(many.extra as any)?.insurance && (many.parcels[0] as any).extra?.insurance?.amount === '150.00' && (many.parcels[2] as any).extra?.insurance?.amount === '75.00',
    'several boxes: each carries its own insurance, the shipment carries none (so nothing is paid three times)');
  const one = insuredParcels(decision, [{ weight: '20' }]);
  ok((one.extra as any)?.insurance?.amount === '300.00' && !(one.parcels[0] as any).extra, 'one box: insured on the shipment, as before');
  ok(!(insuredParcels({ ...decision, signature: 'STANDARD' as const }, [{ weight: '1' }, { weight: '1' }]).extra as any)?.insurance
    && (insuredParcels({ ...decision, signature: 'STANDARD' as const }, [{ weight: '1' }, { weight: '1' }]).extra as any)?.signature_confirmation === 'STANDARD', 'a signature stays on the shipment');
  const pol = { signatureEnabled: false, signatureOverCents: 15000, signatureType: 'STANDARD' as const, insuranceEnabled: true, insuranceOverCents: 10000, weightToleranceOz: 4 };
  const a = { lines: [{ qtyOrdered: 1, unitPriceCents: 6000 }] }, b = { lines: [{ qtyOrdered: 1, unitPriceCents: 7000 }] };
  ok(protectionFor(a, pol).insuranceCents === 0 && protectionFor({ ...a, lines: [...a.lines, ...b.lines] }, pol).insuranceCents === 13000, 'two orders in one box are insured together once their goods pass the threshold');

  // The service the customer paid for.
  const rates = [
    { id: 'g', provider: 'USPS', service: 'Ground Advantage', amountCents: 540 },
    { id: 'p', provider: 'USPS', service: 'Priority Mail', amountCents: 910 },
    { id: 'u', provider: 'UPS', service: 'Ground', amountCents: 1200 },
    { id: 'f', provider: 'FedEx', service: 'Ground', amountCents: 1100 },
  ];
  ok(paidServiceRate(rates, 'Priority Mail').rate?.id === 'p' && paidServiceRate(rates, 'Priority Mail').how === 'matched', 'paid for Priority Mail: Priority Mail is bought, not the cheaper Ground Advantage');
  ok(paidServiceRate(rates, 'Standard shipping').rate?.id === 'g' && paidServiceRate(rates, '').how === 'any', 'plain shipping: the cheapest');
  ok(paidServiceRate(rates, 'Priority Mail Express').rate === null && paidServiceRate(rates, 'Priority Mail Express').how === 'missing', 'their service isn’t offered: nothing is bought for them, someone chooses');
  ok(paidServiceRate(rates, 'Ground', 'UPS').rate?.id === 'u' && paidServiceRate(rates, 'Ground').rate?.id === 'f', 'the same service name: their carrier when known, else the cheaper');
  ok(paidServiceRate(rates, 'priority mail®').rate?.id === 'p' && !choseService('Free shipping'), 'names match however they’re written');

  // Unused labels: only voided when the carrier never scanned any box.
  ok(trackingCarrier('USPS') === 'usps' && trackingCarrier('DHL Express') === 'dhl_express' && trackingCarrier('UPS') === 'ups', 'the carrier’s name for tracking');
  const realFetch = globalThis.fetch;
  let refunds: string[] = [];
  const tracks = (map: Record<string, any>) => {
    refunds = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/tracks/')) { const n = decodeURIComponent(u.split('/').pop() || ''); const t = map[n]; if (t === 'fail') return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => t }; }
      if (u.endsWith('/refunds/')) { refunds.push(JSON.parse(init.body).transaction); return { ok: true, json: async () => ({ status: 'QUEUED' }) }; }
      return { ok: false, json: async () => ({}) };
    }) as any;
  };
  const pre = { tracking_status: { status: 'PRE_TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }] };
  const moving = { tracking_status: { status: 'TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }, { status: 'TRANSIT' }] };
  tracks({ '1': pre });
  ok(await neverScanned('k', { carrier: 'USPS', trackingNumber: '1' }) === true, 'no carrier scan: never scanned');
  tracks({ '1': moving });
  ok(await neverScanned('k', { carrier: 'USPS', trackingNumber: '1' }) === false, 'a carrier scan: left alone');
  tracks({ '1': pre, '2': moving });
  ok(await neverScanned('k', { carrier: 'USPS', trackingNumber: '1', extraTrackingNumbers: ['2'] }) === false, 'one box of two scanned: left alone');
  tracks({ '1': 'fail' });
  ok(await neverScanned('k', { carrier: 'USPS', trackingNumber: '1' }) === false, 'tracking couldn’t be checked: left alone');
  ok(await neverScanned('k', { carrier: 'USPS', trackingNumber: '1', carrierTrail: { status: 'TRANSIT' } }) === false, 'a scan already on record: left alone without asking');

  // voidIfUnused against a small stand-in for the database.
  const store: Record<string, any> = {};
  const events: any[] = [];
  const ref = { set: async (v: any) => { Object.assign(store, v); }, collection: () => ({ doc: () => ({ id: 'e1', set: async (v: any) => events.push(v) }) }) };
  const db = {
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), create: async () => {} }),
    runTransaction: async (fn: any) => fn({ get: async () => ({ data: () => ({ ...store }) }), set: (r: any, v: any) => { if (r === ref) Object.assign(store, v); else events.push(v); } }),
  };
  Object.assign(store, { shippoTransactionId: 't1', trackingNumber: '1', carrier: 'USPS', stage: 'shipped', completedAt: 'x', labelUrl: 'u', labelUnscannedOpen: true });
  tracks({ '1': pre });
  let r = await voidIfUnused(db, 'shop', ref, { ...store }, 'k', 'the carrier never scanned it');
  ok(r.ok && refunds.join() === 't1' && store.shippoTransactionId === '' && store.stage === 'packed' && store.completedAt === null && store.labelUnscannedOpen === false && (store.voidedTracking !== undefined),
    'never scanned: voided, cleared, back to packed, off Needs you, and its tracking number remembered as dead');
  Object.assign(store, { shippoTransactionId: 't2', trackingNumber: '9', stage: 'packed', labelUrl: 'u' });
  tracks({ '9': moving });
  r = await voidIfUnused(db, 'shop', ref, { ...store }, 'k', 'test');
  ok(!r.ok && refunds.length === 0 && store.shippoTransactionId === 't2', 'scanned: nothing voided, nothing cleared');
  globalThis.fetch = realFetch;

  // Needs you.
  const n = needsYou([
    { id: 'a', stage: 'packed', method: 'ship', customerName: 'Dana Whitfield', shippoTransactionId: 't', labelUnscannedOpen: true },
    { id: 'b', stage: 'shipped', method: 'ship', customerName: 'Marcus Tate', shippoTransactionId: 't', labelUnscannedOpen: true },
    { id: 'c', stage: 'packed', method: 'ship', customerName: 'Old', shippoTransactionId: '', labelUnscannedOpen: true },
  ], Date.now());
  ok(n.find((x) => x.orderId === 'a')?.text === 'Dana’s label hasn’t been used' && n.find((x) => x.orderId === 'b')?.text === 'The carrier hasn’t scanned Marcus’s box', 'unused and unscanned labels are listed');
  ok(!n.some((x) => x.orderId === 'c'), 'a voided label isn’t');

  if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
})();
