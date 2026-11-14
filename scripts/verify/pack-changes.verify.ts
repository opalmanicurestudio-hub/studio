// Checks WHAT CHANGED WHILE PACKING IS TOLD ONCE, EVEN WHEN AN ORDER IS SET ASIDE OR EVERY ITEM IS OUT (lib/pack-changes):
//   - an item marked out, or swapped, is stamped with when;
//   - each change is told once: what's been told isn't told again in the ready message or when it's packed later;
//   - an order set aside after something was found out: two hours on, it's refunded and told on its own;
//   - an order where every item was out isn't packed or put on a shelf: it's closed, everything paid comes back, and one
//     message says so (never when something from it is still to be sent later);
//   - the customer's order page says the same, without the shop's own words for a cancellation.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pack-changes.verify.ts
import fs from 'fs';
import { check, failures, makeDb } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const PC = await import('../../src/lib/pack-changes');
  const RO = await import('../../src/lib/retail-orders');
  const S = await import('../../src/lib/retail-swap');

  // ── When ──
  const l0: any = { lineId: 'a', productId: 'p', name: 'Top coat', unitPriceCents: 1400, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0, status: 'pending' };
  const sh: any = RO.shortLine([l0], 'a', 'Not on the shelf', 'refund').lines[0];
  check('an item marked out is stamped with when', sh.status === 'refunded' && Date.now() - Date.parse(sh.shortedAt) < 5000, sh);
  const sw: any = S.swapLines({ subtotalCents: 1400, taxCents: 0, lines: [l0] }, 'a', { productId: 'q', name: 'Top coat, gloss', unitPriceCents: 1400 }, 'b');
  check('…and a swapped one', Date.now() - Date.parse(sw.lines[0].shortedAt) < 5000);

  // ── Told once ──
  const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  const order: any = { subtotalCents: 2300, taxCents: 0, lines: [
    { lineId: 'a', name: 'Top coat', unitPriceCents: 1400, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'Not on the shelf', shortedAt: ago(3) },
    { lineId: 'b', name: 'Cuticle oil', unitPriceCents: 900, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'Not on the shelf', shortedAt: ago(0.5) },
  ] };
  check('every change, with its line and when', PC.packChanges(order).map((c) => c.lineId).join() === 'a,b' && PC.untoldSince(order) === Date.parse(order.lines[0].shortedAt));
  const told = { ...order, changesToldLines: ['a'] };
  check('what’s been told isn’t told again', PC.packChanges(told).map((c) => c.lineId).join() === 'b' && /^1 item was out: Cuticle oil: refunded\./.test(PC.changesNote(told).short) && PC.untoldSince(told) === Date.parse(order.lines[1].shortedAt));
  check('…though the order page lists every change', PC.packChanges(told, { all: true }).length === 2);
  check('a set of changes has its own short name, the same each time', PC.changesKey(PC.packChanges(order)) === PC.changesKey(PC.packChanges({ ...order })) && PC.changesKey(PC.packChanges(order)) !== PC.changesKey(PC.packChanges(told)));
  check('nothing changed: nothing to tell, nothing waiting', PC.changesNote({ lines: [l0] }).short === '' && PC.untoldSince({ lines: [l0] }) === 0);

  // ── Every item out ──
  check('every item refunded: nothing to send', PC.everyItemOut(order) && !PC.everyItemOut({ lines: [] }));
  check('…not when one is coming later, or a swap is going in, or something is still to pack', !PC.everyItemOut({ lines: [{ status: 'refunded' }, { status: 'backordered' }] }) && !PC.everyItemOut({ lines: sw.lines }) && !PC.everyItemOut({ lines: [{ status: 'refunded' }, { status: 'pending' }] })
    && !PC.everyItemOut({ lines: [{ status: 'refunded', qtyOrdered: 2, qtyScanned: 1, qtyShorted: 1 }] }));

  // ── Set aside: told on its own, in time ──
  const db: any = makeDb();
  const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Shop' });
  await db.doc(`${T}/retailOrders/old`).set({ ...order, stage: 'picking', orderNumber: 7, customerEmail: 'dana@example.com' });
  await db.doc(`${T}/retailOrders/new`).set({ ...order, stage: 'paid', orderNumber: 8, lines: [order.lines[1]] });
  await db.doc(`${T}/retailOrders/told`).set({ ...order, stage: 'picking', orderNumber: 9, changesToldLines: ['a', 'b'] });
  await db.doc(`${T}/retailOrders/packed`).set({ ...order, stage: 'packed', orderNumber: 10 });
  await db.doc(`${T}/retailOrders/busy`).set({ ...order, stage: 'picking', orderNumber: 11, batchId: 'b1', claimedBy: 'u1' });
  await db.doc(`${T}/fulfillmentBatches/b1`).set({ active: true, claimedAt: new Date().toISOString(), orderIds: ['busy'] });
  (globalThis as any).fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const W = await import('../../src/lib/retail-swap-server');
  const n = await W.sweepUntoldChanges(db, 't1', 'https://shop.example');
  const queued = ((await db.collection('messageOutbox').get()).docs || []).map((d: any) => ({ id: d.id, ...d.data() }));
  check('an order set aside two hours after something was found out is told; a newer one, one already told, one packed, or one someone is packing right now isn’t', n === 1 && queued.length === 1 && queued[0].kind === 'order_changes' && queued[0].orderId === 'old' && queued[0].id === `t1.order_changes.oold.${PC.changesKey(PC.packChanges(order))}`, { n, queued });
  check('…from the payments timer', /sweepUntoldChanges\(db, t\.id,/.test(src('src/app/api/cron/retail-payments/route.ts')) && PC.TELL_AFTER_MS === 2 * 3600e3);

  // ── The screens and the server ──
  const ful = src('src/app/api/retail/fulfil/route.ts');
  check('packing an order with every item out closes it instead, refunds everything and tells them once',
    /if \(\['picking', 'paid'\]\.includes\(String\(pre\.stage\)\) && everyItemOut\(pre\)/.test(ful) && /where\('parentOrderId', '==', orderId\)\.limit\(1\)\.get\(\)\)\.empty/.test(ful)
    && /const closedOut = await F\.cancelOrder\(db, tenantId, orderId, actor, EVERY_ITEM_OUT,/.test(ful) && /out = \{ ok: true, closed: true,/.test(ful));
  check('…closed only if every item is still out as it’s closed (else it’s packed as usual), and the packer’s batch is closed after',
    /F\.cancelOrder\(db, tenantId, orderId, actor, EVERY_ITEM_OUT, \{ onlyIfEveryItemOut: true \}\)/.test(ful) && /if \(closedOut\?\.ok\) \{[\s\S]{0,400}break;\s*\}\s*\}\s*out = await F\.markPacked\(/.test(ful)
    && /if \(opts\?\.onlyIfEveryItemOut && !\(\['picking', 'paid'\]\.includes\(order\.stage\) && everyItemOut\(order\)\)\)/.test(src('src/lib/retail-fulfill.ts')) && /if \(out\.ok && hadBatch\) await closeBatchIfDone\(fs, tenantId, hadBatch\)/.test(src('src/lib/retail-fulfill.ts')));
  check('changes carried in a ready message are marked told, so a retried message doesn’t tell them again',
    /if \(\(texted \|\| emailed\) && changed\.short\) await markTold\(ref, o\)/.test(src('src/app/api/retail/ready-notify/route.ts')) && /if \(res\.ok && changed && forChanges\) await db\.doc/.test(src('src/app/api/retail/curbside-notify/route.ts')));
  check('…and the packing screens say so, with no bag tag and no shelf', /if \(\(p as any\)\.closed\) return \{ ok: true, message: p\.message, closed: true \}/.test(src('src/lib/orders-flow.ts')) && /if \(\(r as any\)\.closed\) tagTab\.close\(\)/.test(src('src/components/orders/workspace/PackPane.tsx')) && /r\.ok && !\(r as any\)\.closed\) tagTab\.location\.href/.test(src('src/components/fulfilment/FulfilmentPanel.tsx')));
  const cn = src('src/app/api/retail/changes-notify/route.ts');
  check('each set of changes is its own message in the queue, so new ones after a first message still go', /sendMessage\('order_changes', \{ orderId, key: changesKey\(packChanges\(po\)\) \}\)/.test(ful) && /sendMessage\('order_changes', \{ orderId, key: 'closed' \}\)/.test(ful) && /sendMessage\('order_changes', \{ orderId: id, key: changesKey\(packChanges\(o\)\) \}\)/.test(ful));
  check('the message: one per set of changes, marked told once it goes; a closed order told once, with everything coming back',
    /doc\(`changes-notify-\$\{closed \? 'closed' : changesKey\(cs\)\}`\)/.test(cn) && /changesToldLines: FieldValue\.arrayUnion\(/.test(cn) && /every item in your order \$\{num\} from \$\{shop\} was out, so we’ve closed it/.test(cn) && /const backCents = Math\.max\(0, Number\(o\.refundedCents\) \|\| 0\) \+ Math\.max\(0, Number\(o\.pendingRefundCents\) \|\| 0\)/.test(cn));
  const st = src('src/app/api/retail/order-status/route.ts');
  check('the order page gets what it needs, never the shop’s own words for why', /shortReason: l\.shortReason === 'Swapped' \? 'Swapped' : l\.status === 'refunded' && \(Number\(l\.qtyShorted\) \|\| 0\) > 0 \? 'Out' : ''/.test(st) && /order\.cancelReason === EVERY_ITEM_OUT \? \{ cancelReason: EVERY_ITEM_OUT \}/.test(st));
  check('…and shows every change once packed, while it’s still being packed if they’ve been told, or when it was closed', /changesNote\(order, \{ all: true, money: !closedOut/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')));
  // ── Pop-ups: what's left at the table on the register, and a voided sale back into it ──
  const pr = src('src/app/api/retail/popup/route.ts');
  check('the register can read what’s left at today’s pop-up (anyone on the team), product by product', /if \(action === 'left'\)/.test(pr) && /action === 'list' \|\| action === 'left' \? 'staff' : 'manager'/.test(pr) && /return ok\(\{ left: leftAt\(p, lineOrdered\(orders, Date\.now\(\)\)\) \}\)/.test(pr) && /if \(!p \|\| !popupToday\(p, today\)\) return ok\(\{ left: null \}\)/.test(pr));
  const eng = src('src/components/pos/usePosEngine.tsx');
  check('…read when it starts, every half minute and after each sale, and shown on each tile', /action: 'left', id: popup\.id/.test(eng) && /setInterval\(\(\) => void refreshPopupLeft\(\), 30000\)/.test(eng) && /if \(payload\.popupId\) void refreshPopupLeft\(\);/.test(eng)
    && /\(leftPill\(i\) \|\| stockPill\(i\)\)/.test(src('src/components/pos/PosCatalog.tsx')) && /None left at the table/.test(src('src/components/pos/PosCatalog.tsx')) && /popupLeft=\{e\.popupLeft \|\| null\}/.test(src('src/components/pos/desk/Counter.tsx')) && /onScan=\{onPosScan \? \(c: string\) => onPosScan\(c\) : undefined\} popupLeft=\{popupLeft\} \/>/.test(src('src/components/pos/CheckoutHub.tsx')));
  check('a sale counted at a pop-up keeps what it sold there, and voiding it puts those back into what’s left',
    /popup: \{ id: String\(popupSale\.ref\.id\), items: items\.filter\(\(x\) => x\.type === 'product' && popupSale!\.ids\.has\(String\(x\.id\)\)\)\.reduce\(/.test(src('src/app/api/checkout/complete/route.ts')) && /\(await db\.doc\(`\$\{T\}\/popups\/\$\{String\(R\.popup\.id\)\}`\)\.get\(\)\)\.exists\) batch\.set/.test(src('src/app/api/checkout/void/route.ts')) && /soldAtTable: Object\.fromEntries\(back\.map\(\(\[pid, q\]\) => \[pid, FieldValue\.increment\(-num\(q\)\)\]\)\)/.test(src('src/app/api/checkout/void/route.ts')));
  for (const [name, text] of [['changes wording', src('src/lib/pack-changes.ts')], ['changes message', cn]] as [string, string][]) {
    check(`the ${name} has no business words and the real apostrophe`, !/\b(studio|salon|stylist|booth|chair)\b/i.test(text.replace(/\/\/.*$/gm, '')) && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
