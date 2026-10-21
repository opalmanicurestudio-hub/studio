// Checks the shipping money leaks are plugged: insurance shared across boxes, the service the customer paid for,
// unused labels voided only when the carrier never scanned them, and the Needs you list.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shipping-leaks.verify.ts
import { insuredParcels, splitInsurance, protectionFor } from '../../src/lib/shipment-protection';
import { paidServiceRate, choseService } from '../../src/lib/paid-service';
import { AUTO_TRIES, formSince, labelState, retryDue, sweepLabels, trackingCarrier, voidIfUnused } from '../../src/lib/label-sweep';
import { togetherRefunds } from '../../src/lib/ship-together';
import { forEachTenant } from '../../src/lib/cron-fanout';
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
  let refunds: string[] = []; let lookups = 0;
  // Each tracking number's answer; each label's refund answer ('ok' unless set: 'no' is Shippo saying no, 'silent' no answer).
  let refundSays: Record<string, 'ok' | 'no' | 'silent'> = {};
  const tracks = (map: Record<string, any>, says: Record<string, 'ok' | 'no' | 'silent'> = {}) => {
    refunds = []; lookups = 0; refundSays = says;
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/tracks/')) { lookups++; const n = decodeURIComponent(u.split('/').pop() || ''); const t = map[n]; if (t === 'fail' || t === undefined) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => t }; }
      if (u.endsWith('/refunds/')) {
        const txn = JSON.parse(init.body).transaction; const say = refundSays[txn] || 'ok';
        if (say === 'silent') throw new Error('timed out');
        refunds.push(txn);
        if (say === 'no') return { ok: false, json: async () => ({ detail: 'Transaction is not eligible for a refund' }) };
        return { ok: true, json: async () => ({ status: 'QUEUED' }) };
      }
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

  // A small stand-in for the database: orders by id, shallow merges, events kept apart.
  const memDb = (rows: Record<string, any>) => {
    const events: any[] = [];
    const evRef = () => ({ __event: true, id: 'e', set: async (v: any) => { events.push(v); } });
    const refOf = (id: string): any => ({
      id,
      get: async () => ({ id, exists: !!rows[id], ref: refOf(id), data: () => (rows[id] ? { ...rows[id] } : undefined) }),
      set: async (v: any) => { rows[id] = { ...(rows[id] || {}), ...v }; },
      collection: () => ({ doc: evRef }),
    });
    const db: any = {
      collection: () => ({
        doc: (id: string) => refOf(id),
        where: () => ({ orderBy: () => ({ limit: () => ({
          startAfter: () => ({ get: async () => ({ docs: [], size: 0 }) }),
          get: async () => { const docs = Object.keys(rows).map((id) => ({ id, ref: refOf(id), data: () => rows[id] })); return { docs, size: docs.length }; },
        }) }) }),
      }),
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), create: async () => {} }),
      runTransaction: async (fn: any) => fn({ get: (r: any) => r.get(), set: (r: any, v: any) => { if (r?.__event) events.push(v); else rows[r.id] = { ...(rows[r.id] || {}), ...v }; } }),
    };
    return { rows, db, refOf, events };
  };
  const solo = (row: any) => { const m = memDb({ a: { ...row } }); return { ...m, ref: m.refOf('a'), row: () => m.rows.a }; };

  let t = solo({ shippoTransactionId: 't1', trackingNumber: '1', carrier: 'USPS', stage: 'cancelled', labelUrl: 'u', labelUnscannedOpen: true, autoVoid: { tries: 2 } });
  tracks({ '1': pre });
  let r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'the order was cancelled');
  ok(r.ok && refunds.join() === 't1' && t.row().shippoTransactionId === '' && t.row().stage === 'cancelled' && t.row().labelUnscannedOpen === false && t.row().labelVoiding === null && t.row().voidedTracking !== undefined && t.row().autoVoid === null,
    'unused: voided and cleared, the stage untouched, the void note and retries cleared, its tracking number remembered as dead');
  t = solo({ shippoTransactionId: 't2', trackingNumber: '9', carrier: 'USPS', stage: 'packed', labelUrl: 'u' });
  tracks({ '9': moving });
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'test');
  ok(!r.ok && r.refused === 'moving' && refunds.length === 0 && t.row().shippoTransactionId === 't2' && !!t.row().labelSeenMoving && !t.row().voidedLabelMoving, 'scanned: nothing voided or cleared, it’s remembered as moving, and no alarm (no void was under way)');
  t = solo({ shippoTransactionId: 't3', trackingNumber: '5', carrier: 'USPS', stage: 'cancelled', manifestId: 'm1', labelUrl: 'u' });
  tracks({ '5': pre });
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'test');
  ok(!r.ok && r.refused === 'form' && refunds.length === 0, 'automatic: a label on a USPS form is left alone');
  t = solo({ shippoTransactionId: 't4', trackingNumber: '6', carrier: 'USPS', stage: 'packed', labelUrl: 'u' });
  tracks({ '6': notFound });
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'test');
  ok(!r.ok && r.refused === 'unsure' && refunds.length === 0 && t.row().labelVoiding === undefined, 'automatic: “not found” is left alone, and nothing is written down');
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'voided by hand', undefined, { byHand: true });
  ok(r.ok && refunds.join() === 't4', 'by hand at the box: voided unless the carrier has scanned it');

  // Shippo answers no, or doesn't answer.
  t = solo({ shippoTransactionId: 'tn', trackingNumber: '11', carrier: 'USPS', stage: 'packed', labelUrl: 'u' });
  tracks({ '11': pre }, { tn: 'no' });
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'voided by hand', undefined, { byHand: true });
  ok(!r.ok && r.refused === 'shippo' && t.row().labelVoiding === null && t.row().shippoTransactionId === 'tn', 'Shippo says no: nothing is in doubt, so the void note comes off (it won’t be retried behind anyone’s back)');
  t = solo({ shippoTransactionId: 'ts', trackingNumber: '12', carrier: 'USPS', stage: 'packed', labelUrl: 'u' });
  tracks({ '12': pre }, { ts: 'silent' });
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'voided by hand', undefined, { byHand: true });
  ok(!r.ok && r.refused === 'uncertain' && t.row().labelVoiding?.txn === 'ts' && t.row().labelVoiding?.tries === 1 && /may already be voided/.test(String(r.error)),
    'no answer from Shippo: the note stays (it may have gone through), and the person is told not to use the label yet');
  const firstAt = t.row().labelVoiding.at;
  r = await voidIfUnused(t.db, 'shop', t.ref, t.row(), 'k', 'voided by hand', undefined, { byHand: true });
  ok(t.row().labelVoiding?.tries === 2 && t.row().labelVoiding?.at === firstAt, 'trying again counts the try and keeps when the void began');

  // Shared labels: never automatic; by hand, they come off every order in the box.
  let m = memDb({
    p: { shippoTransactionId: 'tp', trackingNumber: '21', carrier: 'USPS', stage: 'packed', labelUrl: 'u', orderNumber: 12, shippedWithOrderIds: ['q'] },
    q: { trackingNumber: '21', carrier: 'USPS', labelUrl: 'u', stage: 'packed', orderNumber: 13, labelFromOrderId: 'p', shippedWithOrderId: 'p', shipTogetherRefundCents: 800 },
  });
  tracks({ '21': pre });
  r = await voidIfUnused(m.db, 'shop', m.refOf('p'), { ...m.rows.p }, 'k', 'the order was cancelled');
  ok(!r.ok && r.refused === 'shared' && refunds.length === 0, 'a label shared by orders in one box is never voided automatically');
  r = await voidIfUnused(m.db, 'shop', m.refOf('p'), { ...m.rows.p }, 'k', 'voided by hand', undefined, { byHand: true });
  ok(r.ok && refunds.join() === 'tp' && m.rows.p.shippoTransactionId === '' && m.rows.p.shippedWithOrderIds === null && m.rows.q.trackingNumber === '' && m.rows.q.labelUrl === '' && m.rows.q.labelFromOrderId === null && m.rows.q.shippedWithOrderId === null && m.rows.q.shipTogetherRefundCents === 800,
    'by hand: the shared label is voided and comes off both orders (the shipping refunded for sharing a box stays on record)');
  m = memDb({
    p: { shippoTransactionId: 'tp', trackingNumber: '21', carrier: 'USPS', stage: 'packed', labelUrl: 'u', shippedWithOrderIds: ['q'] },
    q: { trackingNumber: '21', labelUrl: 'u', stage: 'shipped', orderNumber: 13, labelFromOrderId: 'p', shippedWithOrderId: 'p' },
  });
  tracks({ '21': pre });
  r = await voidIfUnused(m.db, 'shop', m.refOf('p'), { ...m.rows.p }, 'k', 'voided by hand', undefined, { byHand: true });
  ok(!r.ok && r.refused === 'shipped' && refunds.length === 0 && /#0013/.test(String(r.error)), 'by hand: refused when another order in the box is marked shipped');
  ok(togetherRefunds([{ id: 'a' }, { id: 'b', shippingCents: 800, shipTogetherRefundCents: 800 }, { id: 'c', shippingCents: 600 }], () => 5000).b === undefined
    && togetherRefunds([{ id: 'a' }, { id: 'b', shippingCents: 800, shipTogetherRefundCents: 800 }, { id: 'c', shippingCents: 600 }], () => 5000).c === 600,
    'put in one box again later: shipping already refunded for sharing a box isn’t refunded twice');

  // Retries for an automatic void that's turned down: after 1, 2, then 4 days, then it's left for someone.
  const day = 86400e3; const nowMs = Date.parse('2026-11-20T12:00:00Z'); const ago = (d: number) => new Date(nowMs - d * day).toISOString();
  ok(retryDue(undefined, nowMs) && !retryDue({ tries: 1, at: ago(0.2) }, nowMs) && retryDue({ tries: 1, at: ago(0.9) }, nowMs)
    && !retryDue({ tries: 2, at: ago(1) }, nowMs) && retryDue({ tries: 2, at: ago(1.9) }, nowMs) && !retryDue({ tries: 3, at: ago(3) }, nowMs) && retryDue({ tries: 3, at: ago(3.9) }, nowMs)
    && !retryDue({ tries: AUTO_TRIES, at: ago(30) }, nowMs), 'retries wait 1, 2, then 4 days, and stop after the fourth try');
  ok(formSince({ manifestId: 'm', manifestedAt: ago(1) }, ago(2)) && !formSince({ manifestId: 'm', manifestedAt: ago(3) }, ago(2)) && formSince({ manifestId: 'm' }, ago(2)) && !formSince({}, ago(2)),
    'a USPS form made since a void began is noticed (and one with no date counts as since)');

  // The morning check: its order of work, and what it never touches.
  const rows: Record<string, any> = {
    cancelled: { shippoTransactionId: 'c', trackingNumber: 'nc', carrier: 'USPS', stage: 'cancelled', shipmentProtection: { decidedAt: ago(2) } },
    oldPacked: { shippoTransactionId: 'o', trackingNumber: 'no', carrier: 'USPS', stage: 'packed', shipmentProtection: { decidedAt: ago(29) } },
    oldShipped: { shippoTransactionId: 's', trackingNumber: 'ns', carrier: 'USPS', stage: 'shipped', completedAt: ago(29), shipmentProtection: { decidedAt: ago(29) } },
    dismissed: { shippoTransactionId: 'd', trackingNumber: 'nd', carrier: 'USPS', stage: 'packed', labelUnscanned: { at: ago(20), dismissedAt: ago(20) }, shipmentProtection: { decidedAt: ago(29) } },
    fresh: { shippoTransactionId: 'f', trackingNumber: 'nf', carrier: 'USPS', stage: 'packed', shipmentProtection: { decidedAt: ago(4) } },
    // Voids whose outcome wasn't known.
    cutPacked: { shippoTransactionId: 'i', trackingNumber: 'ni', carrier: 'USPS', stage: 'packed', labelVoiding: { txn: 'i', why: 'voided by hand', at: ago(1), tries: 1 }, shipmentProtection: { decidedAt: ago(5) } },
    cutPackedLost: { shippoTransactionId: 'il', trackingNumber: 'nil', carrier: 'USPS', stage: 'packed', labelVoiding: { txn: 'il', why: 'voided by hand', at: ago(1) }, shipmentProtection: { decidedAt: ago(5) } },
    cutCancelled: { shippoTransactionId: 'ic', trackingNumber: 'nic', carrier: 'USPS', stage: 'cancelled', labelVoiding: { txn: 'ic', why: 'the order was cancelled', at: ago(1), tries: 1 }, shipmentProtection: { decidedAt: ago(5) } },
    cutShipped: { shippoTransactionId: 'ish', trackingNumber: 'nish', carrier: 'USPS', stage: 'shipped', completedAt: ago(0.5), labelVoiding: { txn: 'ish', why: 'voided by hand', at: ago(1), tries: 1 }, shipmentProtection: { decidedAt: ago(5) } },
    cutOnForm: { shippoTransactionId: 'if', trackingNumber: 'nif', carrier: 'USPS', stage: 'packed', manifestId: 'm9', manifestedAt: ago(0.5), labelVoiding: { txn: 'if', why: 'voided by hand', at: ago(1), tries: 1 }, shipmentProtection: { decidedAt: ago(5) } },
    cutTried: { shippoTransactionId: 'it', trackingNumber: 'nit', carrier: 'USPS', stage: 'packed', labelVoiding: { txn: 'it', why: 'voided by hand', at: ago(3), tries: 3 }, shipmentProtection: { decidedAt: ago(5) } },
    cutRefused: { shippoTransactionId: 'icn', trackingNumber: 'nicn', carrier: 'USPS', stage: 'cancelled', labelVoiding: { txn: 'icn', why: 'the order was cancelled', at: ago(1), tries: 1 }, shipmentProtection: { decidedAt: ago(5) } },
    cutMoving: { shippoTransactionId: 'im', trackingNumber: 'nim', carrier: 'USPS', stage: 'packed', labelVoiding: { txn: 'im', why: 'voided by hand', at: ago(1), tries: 1 }, shipmentProtection: { decidedAt: ago(5) } },
    // Cancelled labels that can't be voided automatically.
    cancelledOnForm: { shippoTransactionId: 'cf', trackingNumber: 'ncf', carrier: 'USPS', stage: 'cancelled', manifestId: 'm2', shipmentProtection: { decidedAt: ago(2) } },
    cancelledUnsure: { shippoTransactionId: 'cu', trackingNumber: 'ncu', carrier: 'USPS', stage: 'cancelled', shipmentProtection: { decidedAt: ago(2) } },
    cancelledWaiting: { shippoTransactionId: 'cw', trackingNumber: 'ncw', carrier: 'USPS', stage: 'cancelled', autoVoid: { tries: 2, at: ago(1) }, shipmentProtection: { decidedAt: ago(9) } },
    cancelledLastTry: { shippoTransactionId: 'cl', trackingNumber: 'ncl', carrier: 'USPS', stage: 'cancelled', autoVoid: { tries: 3, at: ago(4) }, shipmentProtection: { decidedAt: ago(9) } },
    sharedPacked: { shippoTransactionId: 'sp', trackingNumber: 'nsp', carrier: 'USPS', stage: 'packed', shippedWithOrderIds: ['x'], shipmentProtection: { decidedAt: ago(29) } },
  };
  const sweepDb = memDb(rows);
  tracks({ nc: pre, no: pre, ns: pre, nd: pre, nf: pre, ni: pre, nil: notFound, nic: notFound, nish: pre, nif: pre, nit: pre, nim: moving, ncf: pre, ncu: notFound, ncw: notFound, ncl: notFound, nsp: pre, nicn: pre }, { icn: 'no' });
  const res = await sweepLabels(sweepDb.db, 'shop', 'k', { now: nowMs, deadline: Date.now() + 60000, maxLookups: 100 });
  ok(refunds.includes('c') && refunds.includes('o'), 'voided: the cancelled order’s label, and a packed label never scanned in 28 days');
  ok(!refunds.includes('s') && rows.oldShipped.shippoTransactionId === 's', 'a shipped order’s label is never voided by the morning check');
  ok(!refunds.includes('d'), 'a label someone said went out is left alone');
  ok(!refunds.includes('f') && rows.fresh.labelUnscannedOpen === true, 'a few days unused: listed under Needs you, not voided');
  ok(rows.oldShipped.labelUnscannedOpen === true, 'a shipped box with no scan is listed under Needs you');
  ok(refunds.includes('i') && rows.cutPacked.shippoTransactionId === '' && refunds.includes('ic') && rows.cutCancelled.shippoTransactionId === '',
    'a void that was cut off is finished: on a packed box the carrier shows unused, and on a cancelled order');
  ok(!refunds.includes('il') && rows.cutPackedLost.shippoTransactionId === 'il' && rows.cutPackedLost.labelVoiding === null && rows.cutPackedLost.labelUnscanned?.why === 'void_unfinished' && rows.cutPackedLost.labelUnscannedOpen === true,
    'a packed box whose tracking can’t confirm it unused: not finished, listed under Needs you instead');
  ok(!refunds.includes('ish') && rows.cutShipped.shippoTransactionId === 'ish' && rows.cutShipped.labelVoiding === null && rows.cutShipped.labelUnscanned?.why === 'void_unfinished' && rows.cutShipped.labelUnscannedOpen === true,
    'a void that didn’t finish on an order since marked shipped: never retried, listed under Needs you');
  ok(!refunds.includes('if') && rows.cutOnForm.labelUnscanned?.why === 'void_unfinished', 'put on a USPS form after the void began: never retried, listed');
  ok(!refunds.includes('it') && rows.cutTried.labelUnscanned?.why === 'void_unfinished', 'three tries without an answer: listed for someone, not tried again');
  ok(rows.cutRefused.shippoTransactionId === 'icn' && rows.cutRefused.labelVoiding === null && rows.cutRefused.labelUnscanned?.why === 'void_refused' && rows.cutRefused.labelUnscannedOpen === true && rows.cutRefused.autoVoid?.tries === AUTO_TRIES,
    'finishing a void Shippo turns down: the label still works, so it’s listed as one that couldn’t be voided, and nothing retries it automatically');
  ok(!refunds.includes('im') && rows.cutMoving.voidedLabelMoving?.open === true && rows.cutMoving.voidedLabelMoving?.unsure === true && rows.cutMoving.labelVoiding === null,
    'finishing a void the carrier has since scanned: nothing voided, and the team is told the box is out on a label that may be refunded');
  ok(!refunds.includes('cf') && rows.cancelledOnForm.autoVoid === undefined, 'a cancelled order’s label on a USPS form isn’t looked at every morning');
  ok(!refunds.includes('cu') && rows.cancelledUnsure.autoVoid?.tries === 1 && !rows.cancelledUnsure.labelUnscannedOpen, 'a cancelled label the tracking can’t confirm unused: the try is counted, tried again later');
  ok(rows.cancelledWaiting.autoVoid?.tries === 2, 'a try two days ago that waits four: not looked up today');
  ok(rows.cancelledLastTry.autoVoid?.tries === 4 && rows.cancelledLastTry.labelUnscanned?.why === 'void_refused' && rows.cancelledLastTry.labelUnscannedOpen === true, 'the last try turned down: listed under Needs you for someone to void by hand or leave');
  ok(!refunds.includes('sp') && rows.sharedPacked.labelUnscannedOpen === true, 'a shared label is listed when unused, never voided automatically');
  ok(res.voided === 4 && !res.cutOff, 'the counts add up');
  const before = lookups;
  await sweepLabels(sweepDb.db, 'shop', 'k', { now: nowMs + 3600e3, deadline: Date.now() + 60000, maxLookups: 100 });
  ok(lookups - before === 0, 'an hour later nothing needs looking up again: done, listed, or waiting for its retry');
  const cut = await sweepLabels(memDb({ a: { shippoTransactionId: 'z', trackingNumber: 'nz', carrier: 'USPS', stage: 'cancelled', shipmentProtection: { decidedAt: ago(2) } } }).db, 'shop', 'k', { now: nowMs, deadline: Date.now() + 10000 });
  ok(cut.cutOff && cut.checked === 0, 'out of time with work left: it says so, so the next morning starts with this shop');
  globalThis.fetch = realFetch;

  // The morning run across shops: a shop cut off short is the first one next time.
  const cursors: Record<string, any> = {};
  const tenantsDb: any = {
    collection: () => ({ get: async () => ({ docs: ['s1', 's2', 's3', 's4'].map((id) => ({ id, data: () => ({}) })) }) }),
    doc: () => ({ get: async () => ({ data: () => ({ ...cursors }) }), set: async (v: any) => { Object.assign(cursors, v); } }),
  };
  const fan = await forEachTenant(tenantsDb, 'test', async (x) => (x.id === 's2' ? { again: true } : undefined), { concurrency: 1 });
  ok(fan.done === 4 && fan.nextStart === 1 && cursors.test === 1, 'every shop ran, and the one cut off short is where the next run starts');
  const fan2 = await forEachTenant(tenantsDb, 'test', async (x) => (x.id === 's2' ? { again: true } : undefined), { concurrency: 1 });
  ok(fan2.done === 4 && fan2.nextStart === 0, 'cut off again while it was first: no second head start, so a busy shop can’t hold the others back');
  const fan3 = await forEachTenant(tenantsDb, 'test', async () => undefined, { concurrency: 1 });
  ok(fan3.done === 4 && fan3.nextStart === 0, 'a run with nothing cut off starts from the top next time');

  // Needs you.
  const n = needsYou([
    { id: 'a', stage: 'packed', method: 'ship', customerName: 'Dana Whitfield', shippoTransactionId: 't', labelUnscannedOpen: true },
    { id: 'b', stage: 'shipped', method: 'ship', customerName: 'Marcus Tate', shippoTransactionId: 't', labelUnscannedOpen: true },
    { id: 'c', stage: 'packed', method: 'ship', customerName: 'Old', shippoTransactionId: '', labelUnscannedOpen: true },
  ], Date.now());
  ok(n.find((x) => x.orderId === 'a')?.text === 'Dana’s label hasn’t been used' && n.find((x) => x.orderId === 'b')?.text === 'The carrier hasn’t scanned Marcus’s box', 'unused and unscanned labels are listed');
  ok(!n.some((x) => x.orderId === 'c'), 'a voided label isn’t');
  const n2 = needsYou([
    { id: 'u', stage: 'packed', method: 'ship', customerName: 'Rae Kim', shippoTransactionId: 't', labelUnscannedOpen: true, labelUnscanned: { why: 'void_unfinished' } },
    { id: 'x', stage: 'cancelled', method: 'ship', customerName: 'Lee Ortiz', shippoTransactionId: 't', labelUnscannedOpen: true, labelUnscanned: { why: 'void_refused' } },
    { id: 'm', stage: 'shipped', method: 'ship', customerName: 'Ana Ruiz', voidedLabelMoving: { open: true, unsure: true } },
  ], Date.now());
  ok(n2.find((x) => x.orderId === 'u')?.text === 'Voiding Rae’s label didn’t finish' && n2.find((x) => x.orderId === 'x')?.text === 'Lee’s cancelled order still has a label'
    && n2.find((x) => x.orderId === 'm')?.text === 'A label being voided for Ana was scanned by the carrier', 'a void that didn’t finish, a cancelled order’s label left over, and a box out on a label being voided are listed');

  if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
})();
