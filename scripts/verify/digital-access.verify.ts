// scripts/verify/digital-access.verify.ts — who may open a purchased download (lib/digital-access) and the holes closed
// around it: refunds (whole order, part refund of the item, returns), chargebacks (open pauses, lost closes, won opens
// again), the access window, proof it's the buyer (the order pass, not the order link), stream links signed for ten
// minutes, every open counted, rate limits, no raw links in the receipt, and Stripe Tax on download-only carts.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/digital-access.verify.ts
import fs from 'fs';
import { digitalLineAccess, fullyRefunded, closedMessage, makeStreamToken, checkStreamToken, STREAM_MINUTES, holdDigitalForDispute } from '../../src/lib/digital-access';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } else console.log('  ✓', m); };

const now = Date.parse('2026-10-24T12:00:00Z');
const line = (x: any = {}) => ({ lineId: 'l1', productId: 'p1', name: 'Guide', digital: true, qtyOrdered: 1, ...x });
const order = (x: any = {}) => ({ stage: 'completed', paidAt: '2026-10-01T12:00:00Z', totalCents: 1800, lines: [line()], ...x });
const A = (o: any, l: any = o.lines[0]) => digitalLineAccess(o, l, now);

// ── the rule
ok(A(order()).open && A(order()).endsAt === null, 'a paid download with no window is open for good');
ok(A(order({ stage: 'placed' })).reason === 'inactive' && A(order({ stage: 'cancelled' })).reason === 'inactive', 'unpaid or cancelled orders open nothing');
ok(A(order(), line({ status: 'refunded' })).reason === 'refunded', 'a line marked refunded is closed');
ok(A(order(), line({ qtyRefunded: 1 })).reason === 'refunded', 'a part refund of the item closes it');
ok(A(order(), line({ qtyOrdered: 2, qtyRefunded: 1 })).open, 'refunding one of two copies leaves the other open');
ok(A(order(), line({ qtyReturned: 1 })).reason === 'refunded', 'a returned download is closed');
ok(fullyRefunded({ totalCents: 1800, refundedCents: 1800 }) && A(order({ refundedCents: 1800 })).reason === 'refunded', 'a full refund (in the app or the dashboard) closes it');
ok(A(order({ refundedCents: 1000, refundedOtherCents: 800 })).reason === 'refunded', 'card plus gift card or credit given back in full counts as a full refund');
ok(A(order({ refundedCents: 500 })).open, 'a goodwill partial refund leaves it open');
ok(!fullyRefunded({ totalCents: 0, refundedCents: 0 }), 'a free order is not "fully refunded"');
ok(A(order({ digitalHolds: { d1: { status: 'open' } } })).reason === 'disputed', 'an open chargeback pauses it');
ok(A(order({ digitalHolds: { d1: { status: 'lost' } } })).reason === 'disputed', 'a lost chargeback closes it');
ok(A(order({ digitalHolds: { d1: { status: 'won' } } })).open, 'a won chargeback opens it again');
ok(A(order({ digitalHolds: { d1: { status: 'lost' }, d2: { status: 'won' } } })).reason === 'disputed', 'one dispute won never reopens what another lost');
ok(A(order({ totalCents: 2000, tipCents: 200, refundedCents: 1800 })).reason === 'refunded', 'refunding everything but a kept tip counts as a full refund');
ok(A(order({ totalCents: 2000, tipCents: 200, refundedCents: 1700 })).open, 'short of that, it stays open');
ok(A(order({ cardRefundedInFull: true, refundedCents: 1000, totalCents: 3000 })).reason === 'refunded', 'a card refunded in full in the Stripe dashboard closes it, whatever else paid');
const windowed = order({ lines: [line({ digitalAccessDays: 10 })] });
ok(A(windowed).reason === 'expired' && !!A(windowed).endsAt, 'a window that has ended closes it, with its date');
ok(A(order({ lines: [line({ digitalAccessDays: 60 })] })).open, 'inside the window it is open');
ok(!A(order(), { ...line(), digital: false }).open, 'only digital lines open here');
ok(/extend/.test(closedMessage('expired', '2026-10-11T12:00:00Z')) && /refunded/.test(closedMessage('refunded', null)) && /mistake/.test(closedMessage('disputed', null)), 'every closed message says why and who to ask');

// ── chargeback holds, against a small stand-in database
function fakeDb(order: any) {
  const docs: Record<string, any> = { 'tenants/t1/retailOrders/o1': order };
  const ref = (path: string): any => ({ path, id: path.split('/').pop(), collection: (c: string) => ({ doc: (id: string) => ref(`${path}/${c}/${id}`) }) });
  const merge = (a: any, b: any): any => { const out = { ...(a || {}) }; for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v; return out; };
  return { docs, doc: ref, collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
    runTransaction: async (fn: any) => fn({ get: async (r: any) => ({ exists: !!docs[r.path], data: () => docs[r.path] }), set: (r: any, v: any) => { docs[r.path] = merge(docs[r.path], v); } }) };
}
async function holds() {
  const db: any = fakeDb({ lines: [{ digital: true }] });
  ok(await holdDigitalForDispute(db, 't1', { retailOrderId: 'o1' }, 'open', 'dp_1') === 'held' && db.docs['tenants/t1/retailOrders/o1'].digitalHolds.dp_1.status === 'open', 'a dispute pauses the order, kept under its own id');
  await holdDigitalForDispute(db, 't1', { retailOrderId: 'o1' }, 'lost', 'dp_1');
  ok(await holdDigitalForDispute(db, 't1', { retailOrderId: 'o1' }, 'open', 'dp_1') === 'none' && db.docs['tenants/t1/retailOrders/o1'].digitalHolds.dp_1.status === 'lost', 'a late “opened” notice never undoes a decided dispute');
  ok(!!db.docs['tenants/t1/retailOrders/o1/events/dispute_dp_1_lost'], 'the note on the order has a fixed id, so a resent notice writes it once');
  const plain: any = fakeDb({ lines: [{ digital: false }] });
  ok(await holdDigitalForDispute(plain, 't1', { retailOrderId: 'o1' }, 'open', 'dp_2') === 'none', 'orders with nothing digital are left alone');
  const broken: any = { doc: () => ({}), runTransaction: async () => { throw new Error('down'); } };
  ok(await holdDigitalForDispute(broken, 't1', { retailOrderId: 'o1' }, 'open', 'dp_3') === 'failed', 'a database error is reported, never thrown');
}

// ── stream links
const tok = makeStreamToken('t1', 'o1', 'p1', now);
ok(checkStreamToken('t1', 'o1', 'p1', tok, now + 60_000), 'a stream link works straight away');
ok(!checkStreamToken('t1', 'o1', 'p1', tok, now + STREAM_MINUTES * 60_000 + 1000), `a stream link stops after ${STREAM_MINUTES} minutes`);
ok(!checkStreamToken('t1', 'o1', 'p2', tok, now) && !checkStreamToken('t2', 'o1', 'p1', tok, now) && !checkStreamToken('t1', 'o2', 'p1', tok, now), 'a stream link opens only its own file, order and shop');
ok(!checkStreamToken('t1', 'o1', 'p1', 'garbage', now) && !checkStreamToken('t1', 'o1', 'p1', `${now + 1e6}.forged`, now), 'forged links are refused');

// ── the route
const route = fs.readFileSync('src/app/api/retail/digital-access/route.ts', 'utf8');
ok(route.includes("checkPass(tenantId, String(order.qrToken || ''), pass)") && route.includes('needsPass: true'), 'opening needs the order pass, not just the link');
ok(!/String\(order\.qrToken\) !== qrToken/.test(route) && !route.includes("q.get('t')"), 'the order link token no longer opens files');
ok(route.includes('checkStreamToken(tenantId, orderId, streamKey(productId, lineId), sig)') && route.includes('makeStreamToken(tenantId, orderId, streamKey(productId, lid), Date.now(), mode)'), 'files stream only through signed ten-minute links');
ok(route.includes("await logOpen(ref, order, line, productId, filePath ? 'file' : 'link');") && route.indexOf('await logOpen(') < route.indexOf('if (filePath) {\n      // What can'), 'file opens are counted, not only link opens');
ok(route.includes('digital_ip_') && route.includes('digital_order_') && (route.match(/tooMany\(req, tenantId, orderId, 'visitor'\)/g) || []).length === 2, 'both doors are rate limited per visitor');
ok(route.indexOf("tooMany(req, tenantId, orderId, 'order')", route.indexOf('export async function POST')) > route.indexOf('needsPass: true'), 'the order’s daily allowance is counted only after the pass, so the link alone can’t use it up');
ok(route.includes('showsInPage(') && route.includes("'attachment'"), 'files other than PDFs and pictures are saved, not shown blank in the page');
ok(route.includes('digitalLineAccess(order, line, Date.now(), ent)'), 'the route uses the one access rule');

// ── everywhere else reads the same rule
const acct = fs.readFileSync('src/app/api/retail/account/orders/route.ts', 'utf8');
ok(acct.includes('digitalLineAccess(o, l, Date.now(), ents[i])') && acct.includes('makePass(tenantId, String(o.qrToken))'), 'the account shelf uses the rule and hands its signed-in buyer a pass');
const status = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
ok(status.includes('digitalLineAccess(order, l, Date.now(),'), 'the order page learns whether each download is open');
const lib = fs.readFileSync('src/app/shop/[tenantId]/library/[orderId]/page.tsx', 'utf8');
ok(lib.includes('passMem.current') && lib.includes('Message the shop about this') && lib.includes('if (d.closed) load();'), 'the library keeps the pass for the visit, points closed items to a person, and refreshes when one closes');
ok(lib.includes("action: 'send'") && lib.includes("action: 'confirm'") && lib.includes('pass: readPass()'), 'the library asks for a code when this device hasn’t shown it’s them');
ok(lib.includes('No website can stop a screen being photographed'), 'the library is honest about what it can’t stop');
ok(!/\{\/\*/.test(lib) && !/call us/i.test(lib), 'house rules in the library');

// ── chargebacks
const wh = fs.readFileSync('src/lib/connect-webhook.ts', 'utf8');
ok(/holdDigitalForDispute\(db, tenant\.id, \{ retailOrderId, paymentIntentId: pi \}, 'open'/.test(wh) && wh.includes("'open', dispute.id)) === 'failed') throw new Error('download hold failed');\n        }\n        if (!made) break;"), 'a new dispute pauses the downloads on its order, on every notice (a failure is retried)');
ok(wh.includes("startsWith('warning')"), 'an inquiry pauses nothing');
ok(/outcome === 'lost' \? 'lost' : 'won'/.test(wh) && (wh.match(/=== 'failed'\) throw new Error\('download hold failed'\)/g) || []).length === 2, 'a closed dispute closes (lost) or reopens (won) them, and a failed hold makes Stripe resend');
ok(wh.includes("meta.type === 'retail_order' && charge.refunded === true") && wh.includes("rf?.metadata?.origin === 'app'"), 'a card refunded in full in the dashboard is marked on its order');

// ── the receipt
const receipt = fs.readFileSync('src/lib/retail-webhook.ts', 'utf8');
ok(!/href="\$\{l\.digitalUrl\}"/.test(receipt) && !receipt.includes('l.digitalUrl'), 'the receipt never carries a raw delivery link');
ok(receipt.includes("emailButton(`${origin}/shop/${tenantId}/library/${orderId}`, 'Open my library'") && receipt.includes('escHtml(String(l.name'), 'the receipt lists downloads by name and links to the library (no order code in the link)');

// ── tax on downloads
const co = fs.readFileSync('src/app/api/retail/checkout/route.ts', 'utf8');
ok(co.includes("(method === 'ship' || (digitalOnly && !paysWithOther)) && !taxExempt") && co.includes("withAutoTax && digitalOnly ? { billing_address_collection: 'required' }"), 'Stripe Tax covers download-only carts, from the billing address');

// ── the browser can't clear a hold or reset the counts
const fr = fs.readFileSync('firestore.rules', 'utf8');
ok(fr.includes("'digitalHolds', 'digitalOpens', 'cardRefundedInFull',"), 'dispute holds, open counts and the dashboard refund mark are locked to the server');

// ── storage rules, kept in the repo
const sr = fs.readFileSync('storage.rules', 'utf8');
ok(/match \/digital\/\{item\}\/\{file\} \{\s*allow write: if isTeam\(t\) && underMb\(45\);\s*allow read: if false;/.test(sr), 'purchased downloads: the team uploads, nobody reads from the browser');
ok(/match \/\{all=\*\*\} \{\s*allow read, write: if false;/.test(sr), 'everything not named is closed');
for (const f of ['avatars', 'uploads', 'branding', 'floorplans', 'renters', 'leases', 'contacts', 'staffThreads', 'evidence', 'products', 'shop-offers', 'creator-campaigns', 'referrals', 'circle', 'client-files', 'dispute-evidence']) ok(sr.includes(`'${f}'`), `the team can still upload to ${f}`);
ok(sr.includes('match /booking-inspiration/{file}') && sr.includes('match /reservation-docs/{file}') && sr.includes('match /applications/{file}') && !/: if true/.test(sr), 'public pages can add files, read back only just after uploading, and nothing can be listed');
ok(/function isTeam\(t\) \{\s*return signedIn\(\) && !isRenterSignIn\(\) && \(isPortalMember\(t\) \|\| isOwnerOf\(t\) \|\| \(hasDirectory\(\) && inDirectory\(t\)\)\);/.test(sr) && !sr.includes('/staff/$('), 'the team check reads at most two documents (claims first)');
ok(sr.includes('isThisRenter(t, renterId)'), 'renters write only their own folder');

holds().then(() => { console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0); });
