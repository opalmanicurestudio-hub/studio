// scripts/verify/entitlements.verify.ts — one access record per buyer per download (lib/entitlements): what's sold is
// copied onto it, downloads are limited (5 by default, views never), the shop's extend and revoke reach the one access
// rule, records are made once at payment (and on first open for older orders), and only the server writes them.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/entitlements.verify.ts
import fs from 'fs';
import { buildEntitlement, downloadsLeft, accessEndsAt, publicEntitlement, entitlementId, countUse, grantEntitlements, DEFAULT_DOWNLOADS, PERSONAL_LICENSE } from '../../src/lib/entitlements';
import { digitalLineAccess, makeStreamToken, checkStreamToken, streamTokenMode } from '../../src/lib/digital-access';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } else console.log('  ✓', m); };

const order = { id: 'o1', stage: 'completed', paidAt: '2026-10-01T12:00:00Z', customerEmail: 'Sam@Example.com', clientId: 'c1', totalCents: 1800, lines: [{ lineId: 'l1', productId: 'p1', name: 'Guide', digital: true, qtyOrdered: 1 }] };
const line = order.lines[0];

// ── what a record holds
const e = buildEntitlement('t1', order, line, {}, '2026-10-01T12:00:05Z');
ok(e.id === 'o1_l1' && entitlementId('o1', 'l1') === 'o1_l1', 'one record per order line, with a fixed id');
ok(e.email === 'sam@example.com' && e.clientId === 'c1' && e.productId === 'p1' && e.copies === 1, 'who bought what, email in lowercase');
ok(e.downloads.allowed === DEFAULT_DOWNLOADS && DEFAULT_DOWNLOADS === 5 && e.downloads.used === 0, 'five downloads by default');
ok(buildEntitlement('t1', order, line, { digitalDownloadLimit: 0 }).downloads.allowed === null, 'a product set to no limit has none');
ok(buildEntitlement('t1', order, line, { digitalDownloadLimit: 3 }).downloads.allowed === 3, 'a product’s own limit is used');
ok(buildEntitlement('t1', order, { ...line, qtyOrdered: 2 }, { digitalDownloadLimit: 3 }).downloads.allowed === 6, 'two copies bought, twice the downloads');
ok(e.license.id === PERSONAL_LICENSE.id && /personal use/i.test(e.license.terms), 'a personal license until the product has another');
ok(buildEntitlement('t1', order, line, { license: { id: 'pro', name: 'Professional', terms: 'Use with clients.' } }).license.id === 'pro', 'the product’s license is copied at sale');
ok(e.access.endsAt === null && accessEndsAt(e) === null, 'no window: access for good');
const w = buildEntitlement('t1', order, { ...line, digitalAccessDays: 30 }, {});
ok(w.access.endsAt === '2026-10-31T12:00:00.000Z', 'a window counts from payment');
ok(accessEndsAt({ access: { ...w.access, extendedUntil: '2027-01-01T00:00:00.000Z' } }) === '2027-01-01T00:00:00.000Z', 'an extension moves the end later');
ok(downloadsLeft({ downloads: { allowed: 5, used: 2, extra: 1 } }) === 4 && downloadsLeft({ downloads: { allowed: null, used: 9, extra: 0 } }) === null, 'downloads left counts extras the shop added; no limit stays no limit');
const pub: any = publicEntitlement(e);
ok(pub && pub.downloadsLeft === 5 && !('email' in pub) && !('history' in pub) && !('id' in pub), 'the customer sees what’s left and the license, nothing internal');

// ── the access rule reads the shop's changes
const now = Date.parse('2026-12-15T12:00:00Z');
const wl = { ...line, digitalAccessDays: 30 };
ok(digitalLineAccess({ ...order, lines: [wl] }, wl, now).reason === 'expired', 'past the window it is closed');
ok(digitalLineAccess({ ...order, lines: [wl] }, wl, now, { access: { extendedUntil: '2027-01-01T00:00:00Z' } }).open, 'the shop’s extension opens it again');
ok(digitalLineAccess(order, line, now, { status: 'revoked' }).reason === 'revoked', 'a record the shop revoked is closed');
ok(digitalLineAccess({ ...order, refundedCents: 1800 }, line, now, { access: { extendedUntil: '2030-01-01T00:00:00Z' } }).reason === 'refunded', 'an extension never reopens a refund');

// ── view and download links
const t0 = Date.parse('2026-10-24T12:00:00Z');
const v = makeStreamToken('t1', 'o1', 'p1', t0); const d = makeStreamToken('t1', 'o1', 'p1', t0, 'download');
ok(checkStreamToken('t1', 'o1', 'p1', v, t0) && streamTokenMode(v) === 'view', 'a view link');
ok(checkStreamToken('t1', 'o1', 'p1', d, t0) && streamTokenMode(d) === 'download', 'a download link');
ok(!checkStreamToken('t1', 'o1', 'p1', d.replace('.d.', '.v.'), t0) && !checkStreamToken('t1', 'o1', 'p1', v.replace('.v.', '.d.'), t0), 'the kind is signed: a view link can’t be turned into a download (or back)');

// ── counting, against a small stand-in database
function fakeDb(docs: Record<string, any>) {
  const ref = (path: string): any => ({ path, get: async () => ({ exists: !!docs[path], data: () => docs[path] }), create: async (v: any) => { if (docs[path]) throw new Error('ALREADY_EXISTS'); docs[path] = v; } });
  const merge = (a: any, b: any): any => { const out = { ...(a || {}) }; for (const [k, val] of Object.entries(b)) out[k] = val && typeof val === 'object' && !Array.isArray(val) ? merge(out[k], val) : val; return out; };
  return { docs, doc: ref, runTransaction: async (fn: any) => fn({ get: async (r: any) => ({ exists: !!docs[r.path], data: () => docs[r.path] }), set: (r: any, val: any) => { docs[r.path] = merge(docs[r.path], val); } }) };
}
(async () => {
  const db: any = fakeDb({ 'tenants/t1/retailOrders/o1': order, 'tenants/t1/inventory/p1': { digitalDownloadLimit: 2 } });
  ok(await grantEntitlements(db, 't1', 'o1') === 1 && await grantEntitlements(db, 't1', 'o1') === 0, 'payment makes the record once (a resent notice changes nothing)');
  const path = 'tenants/t1/entitlements/o1_l1';
  ok(db.docs[path].downloads.allowed === 2, 'the record carries the product’s limit');
  const a = await countUse(db, 't1', 'o1_l1', 'view'); const b = await countUse(db, 't1', 'o1_l1', 'view');
  ok(a.ok && b.ok && db.docs[path].views === 2 && db.docs[path].downloads.used === 0, 'views are counted but never limited');
  const d1 = await countUse(db, 't1', 'o1_l1', 'download'); const d2 = await countUse(db, 't1', 'o1_l1', 'download'); const d3 = await countUse(db, 't1', 'o1_l1', 'download');
  ok(d1.ok && d1.left === 1 && d2.ok && d2.left === 0 && !d3.ok, 'downloads stop when the allowance is used');
  db.docs[path].downloads = { allowed: 2, used: 0, extra: 0 };
  const l1 = await countUse(db, 't1', 'o1_l1', 'download', 'linkA'); const l2 = await countUse(db, 't1', 'o1_l1', 'download', 'linkA');
  ok(l1.ok && l2.ok && db.docs[path].downloads.used === 1, 'one download link fetched twice (a reload, a resumed download) counts once');
  let threw = false; try { await countUse(db, 't1', 'nope', 'download'); } catch { threw = true; }
  ok(threw, 'a missing record is an error, never unlimited');
  const unpaid: any = fakeDb({ 'tenants/t1/retailOrders/o2': { ...order, id: 'o2', paidAt: null, stage: 'placed' } });
  ok(await grantEntitlements(unpaid, 't1', 'o2') === 0, 'nothing is granted before payment');

  // ── wiring
  const route = fs.readFileSync('src/app/api/retail/digital-access/route.ts', 'utf8');
  ok(route.includes('ensureEntitlement(db, tenantId,') && route.includes('digitalLineAccess(order, line, Date.now(), ent)'), 'opening reads the record (made now for older orders) through the one rule');
  ok(route.includes("if (mode === 'view') await countUse(db, tenantId, ent.id, 'view');") && route.includes("countUse(db, tenantId, auth.ent.id, 'download', sig.slice(-32))") && route.includes("saving ? 'attachment' : 'inline'"), 'a view is counted once when its link is made; a download when the file is ready, and saved, not shown');
  ok(route.includes("const mode: 'view' | 'download' = inPage ? asked : 'download';") && route.includes("const saving = mode === 'download' || !showsInPage(name);"), 'a file that can’t be shown in the page is always counted as a download');
  ok(route.indexOf("countUse(db, tenantId, auth.ent.id, 'download'") > route.indexOf('watermarkPdf(bytes'), 'a download that fails to load costs nothing');
  ok(route.includes("mode === 'download' && left !== null && left <= 0"), 'a download link isn’t even made once the downloads are used');
  const wh = fs.readFileSync('src/lib/retail-webhook.ts', 'utf8');
  ok(wh.includes('grantEntitlements(db, tenantId, orderId)') && wh.indexOf('grantEntitlements(') < wh.indexOf("afterPaidAt: new Date().toISOString()"), 'records are made with the other after-payment steps, retried until done');
  const st = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
  ok(st.includes('entitlement: passOk ? publicEntitlement(') , 'the order page learns downloads left and the license, only with proof it’s the buyer');
  const acct = fs.readFileSync('src/app/api/retail/account/orders/route.ts', 'utf8');
  ok(acct.includes('digitalLineAccess(o, l, Date.now(), ents[i])') && acct.includes('downloadsLeft: pub?.downloadsLeft') && acct.indexOf('db.getAll(') < acct.indexOf('byProduct.get('), 'the account shelf reads each record before choosing one copy per product, so a revoked copy never hides a newer one');
  ok(st.includes("(reason === 'disputed' || reason === 'revoked') && !passOk ? null : reason"), 'only the buyer is told the shop closed an item');
  const lib = fs.readFileSync('src/app/shop/[tenantId]/library/[orderId]/page.tsx', 'utf8');
  ok(lib.includes("open(viewing.item, 'download')") && lib.includes('download${it.left === 1'), 'the library offers a saved copy with what’s left');
  const fr = fs.readFileSync('firestore.rules', 'utf8');
  ok(/match \/tenants\/\{tenantId\}\/entitlements\/\{entId\} \{\s*allow read: if isTeam\(tenantId\);\s*allow write: if false;/.test(fr) && fr.includes("'shopCache', 'entitlements',"), 'only the server writes access records; the team reads them');

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
