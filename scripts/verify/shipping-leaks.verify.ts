// Checks the shipping money leaks are plugged: insurance shared across boxes, the service the customer paid for,
// unused labels voided only when the carrier never scanned them, and the Needs you list.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shipping-leaks.verify.ts
import { insuredParcels, splitInsurance, protectionFor } from '../../src/lib/shipment-protection';
import { paidServiceRate, choseService } from '../../src/lib/paid-service';
import { labelState, sweepLabels, trackingCarrier, voidIfUnused } from '../../src/lib/label-sweep';
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

  // Unused labels: only voided when the carrier shows every box as created and nothing more.
  ok(trackingCarrier('USPS') === 'usps' && trackingCarrier('UPS') === 'ups' && trackingCarrier('DHL Express') === 'dhl_express' && trackingCarrier('DHL eCommerce') === 'dhl_ecommerce' && trackingCarrier('Some Courier') === null,
    'the carrier’s tracking code, and none for a carrier we don’t know (so it’s never voided by us)');
  const realFetch = globalThis.fetch;
  let refunds: string[] = [];
  const tracks = (map: Record<string, any>) => {
    refunds = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/tracks/')) { const n = decodeURIComponent(u.split('/').pop() || ''); const t = map[n]; if (t === 'fail' || t === undefined) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => t }; }
      if (u.endsWith('/refunds/')) { refunds.push(JSON.parse(init.body).transaction); return { ok: true, json: async () => ({ status: 'QUEUED' }) }; }
      return { ok: false, json: async () => ({}) };
    }) as any;
  };
  const pre = { tracking_status: { status: 'PRE_TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }] };
  const moving = { tracking_status: { status: 'TRANSIT' }, tracking_history: [{ status: 'PRE_TRANSIT' }, { status: 'TRANSIT' }] };
  const notFound = { tracking_status: { status: 'UNKNOWN' }, tracking_history: [] };
  const empty = { tracking_status: null, tracking_history: [] };
  tracks({ '1': pre });
  ok(await labelState('k', { carrier: 'USPS', trackingNumber: '1' }) === 'pre', 'label created, nothing more: unused');
  tracks({ '1': moving });
  ok(await labelState('k', { carrier: 'USPS', trackingNumber: '1' }) === 'moving', 'a carrier scan: moving');
  tracks({ '1': notFound });
  ok(await labelState('k', { carrier: 'USPS', trackingNumber: '1' }) === 'unknown', '“not found” is unknown, not unused');
  tracks({ '1': empty });
  ok(await labelState('k', { carrier: 'USPS', trackingNumber: '1' }) === 'unknown', 'no status at all is unknown');
  tracks({ '1': pre, '2': moving });
  ok(await labelState('k', { carrier: 'USPS', trackingNumber: '1', extraTrackingNumbers: ['2'] }) === 'moving', 'one box of two scanned: moving');
  tracks({ '1': pre, '2': 'fail' });
  ok(await labelState('k', { carrier: 'USPS', trackingNumber: '1', extraTrackingNumbers: ['2'] }) === 'unknown', 'one box couldn’t be checked: unknown');
  tracks({ '1': pre });
  ok(await labelState('k', { carrier: 'Some Courier', trackingNumber: '1' }) === 'unknown' && await labelState('k', { carrier: 'USPS', trackingNumber: '1', carrierTrail: { status: 'TRANSIT' } }) === 'moving', 'an unknown carrier, or a scan already on record, never reads as unused');

  // voidIfUnused against a small stand-in for the database.
  const mk = (init: any) => {
    const store: Record<string, any> = { ...init }; const events: any[] = [];
    const ref = { set: async (v: any) => { Object.assign(store, v); }, collection: () => ({ doc: () => ({ id: 'e1', set: async (v: any) => events.push(v) }) }) };
    const db = {
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), create: async () => {} }),
      runTransaction: async (fn: any) => fn({ get: async () => ({ data: () => ({ ...store }) }), set: (r: any, v: any) => { if (r === ref) Object.assign(store, v); else events.push(v); } }),
    };
    return { store, ref, db, events };
  };
  let t = mk({ shippoTransactionId: 't1', trackingNumber: '1', carrier: 'USPS', stage: 'cancelled', labelUrl: 'u', labelUnscannedOpen: true });
  tracks({ '1': pre });
  let r = await voidIfUnused(t.db, 'shop', t.ref, { ...t.store }, 'k', 'the order was cancelled');
  ok(r.ok && refunds.join() === 't1' && t.store.shippoTransactionId === '' && t.store.stage === 'cancelled' && t.store.labelUnscannedOpen === false && t.store.labelVoiding === null && t.store.voidedTracking !== undefined,
    'unused: voided and cleared, the stage untouched, the void marker cleared, its tracking number remembered as dead');
  t = mk({ shippoTransactionId: 't2', trackingNumber: '9', carrier: 'USPS', stage: 'packed', labelUrl: 'u' });
  tracks({ '9': moving });
  r = await voidIfUnused(t.db, 'shop', t.ref, { ...t.store }, 'k', 'test');
  ok(!r.ok && refunds.length === 0 && t.store.shippoTransactionId === 't2' && !!t.store.labelSeenMoving, 'scanned: nothing voided or cleared, and it’s remembered as moving');
  t = mk({ shippoTransactionId: 't3', trackingNumber: '5', carrier: 'USPS', stage: 'cancelled', manifestId: 'm1', labelUrl: 'u' });
  tracks({ '5': pre });
  r = await voidIfUnused(t.db, 'shop', t.ref, { ...t.store }, 'k', 'test');
  ok(!r.ok && refunds.length === 0, 'automatic: a label on a USPS form is left alone');
  t = mk({ shippoTransactionId: 't4', trackingNumber: '6', carrier: 'USPS', stage: 'packed', labelUrl: 'u' });
  tracks({ '6': notFound });
  r = await voidIfUnused(t.db, 'shop', t.ref, { ...t.store }, 'k', 'test');
  ok(!r.ok && refunds.length === 0, 'automatic: “not found” is left alone');
  r = await voidIfUnused(t.db, 'shop', t.ref, { ...t.store }, 'k', 'voided by hand', undefined, { byHand: true });
  ok(r.ok && refunds.join() === 't4', 'by hand at the box: voided unless the carrier has scanned it');
  t = mk({ shippoTransactionId: 't5', trackingNumber: '7', carrier: 'USPS', stage: 'cancelled', shippedWithOrderIds: ['x'], labelUrl: 'u' });
  tracks({ '7': pre });
  r = await voidIfUnused(t.db, 'shop', t.ref, { ...t.store }, 'k', 'test', undefined, { byHand: true });
  ok(!r.ok && refunds.length === 0, 'a label shared by orders in one box is never voided on its own');

  // The morning check: its order of work, and what it never touches.
  const day = 86400e3; const nowMs = Date.parse('2026-11-20T12:00:00Z'); const ago = (d: number) => new Date(nowMs - d * day).toISOString();
  const rows: Record<string, any> = {
    cancelled: { shippoTransactionId: 'c', trackingNumber: 'nc', carrier: 'USPS', stage: 'cancelled', shipmentProtection: { decidedAt: ago(2) } },
    oldPacked: { shippoTransactionId: 'o', trackingNumber: 'no', carrier: 'USPS', stage: 'packed', shipmentProtection: { decidedAt: ago(29) } },
    oldShipped: { shippoTransactionId: 's', trackingNumber: 'ns', carrier: 'USPS', stage: 'shipped', completedAt: ago(29), shipmentProtection: { decidedAt: ago(29) } },
    dismissed: { shippoTransactionId: 'd', trackingNumber: 'nd', carrier: 'USPS', stage: 'packed', labelUnscanned: { at: ago(20), dismissedAt: ago(20) }, shipmentProtection: { decidedAt: ago(29) } },
    fresh: { shippoTransactionId: 'f', trackingNumber: 'nf', carrier: 'USPS', stage: 'packed', shipmentProtection: { decidedAt: ago(4) } },
    interrupted: { shippoTransactionId: 'i', trackingNumber: 'ni', carrier: 'USPS', stage: 'packed', labelVoiding: { txn: 'i', why: 'voided by hand' }, shipmentProtection: { decidedAt: ago(5) } },
  };
  const docs = Object.entries(rows).map(([id, data]) => {
    const ref: any = { id, set: async (v: any) => { Object.assign(data, v); }, collection: () => ({ doc: () => ({ id: 'e', set: async () => {} }) }) };
    return { id, ref, data: () => data };
  });
  const fakeDb: any = {
    collection: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ startAfter: () => ({ get: async () => ({ docs: [], size: 0 }) }), get: async () => ({ docs, size: docs.length }) }) }) }) }),
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), create: async () => {} }),
    runTransaction: async (fn: any) => fn({ get: async (ref: any) => ({ data: () => ({ ...rows[ref.id] }) }), set: (ref: any, v: any) => { if (ref && rows[ref.id]) Object.assign(rows[ref.id], v); } }),
  };
  tracks({ nc: pre, no: pre, ns: pre, nd: pre, nf: pre, ni: notFound });
  const res = await sweepLabels(fakeDb, 'shop', 'k', { now: nowMs, deadline: Date.now() + 60000 });
  ok(refunds.includes('c') && refunds.includes('o') && refunds.includes('i'), 'voided: the cancelled order’s label, a packed label never scanned in 28 days, and the void that was interrupted');
  ok(!refunds.includes('s') && rows.oldShipped.shippoTransactionId === 's', 'a shipped order’s label is never voided by the morning check');
  ok(!refunds.includes('d'), 'a label someone said went out is left alone');
  ok(!refunds.includes('f') && rows.fresh.labelUnscannedOpen === true, 'a few days unused: listed under Needs you, not voided');
  ok(rows.oldShipped.labelUnscannedOpen === true, 'a shipped box with no scan is listed under Needs you');
  ok(res.voided === 3 && res.flagged === 2, 'the counts add up');
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
