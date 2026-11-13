// Checks pop-up tables (lib/popup, lib/popup-server, api/retail/popup, the register's count in api/checkout/complete,
// components/orders/PopupScreen).
// - The rules: what's set up is checked (a name, a real day, products once each with a count), a pop-up is on only on
//   its own day and while open, what the line ordered (paid, or being paid for now) and what's left of each product.
// - Its products as the table sells them: a variant by its listing and choice, with the cart it goes in as; archived,
//   unpriced or not-a-product ones left out; a listing with variants sold by its variants.
// - The team: anyone sees the pop-ups with what's left; only managers set one up, change it, take orders from the line
//   (only on its day) or close it; products are checked against the records; a renter gets none of it; each change in
//   the team's log.
// - The register: a sale at a pop-up that's on today is counted against what the table brought, in the same write; the
//   desk opened for a pop-up says so and can stop.
// - The screen, the menu, the rules and the house rules.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/popup.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db: any = makeDb();
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, t: string, e: any) => { audits.push({ t, ...e }); }, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const src = (p: string) => readFileSync(p, 'utf8');
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer x' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const P = await import('../../src/lib/popup');
  const S = await import('../../src/lib/popup-server');
  const { POST } = await import('../../src/app/api/retail/popup/route');

  console.log('the rules');
  const f: any = P.checkPopupForm({ name: '  Saturday   market ', place: 'Stall 14', day: '2026-11-14', items: [{ id: 'a', qty: 5 }, { id: 'a', qty: 9 }, { id: 'b/c', qty: 1 }, { id: 'c', qty: -2 }, { id: 'd', qty: 12000 }, { id: 'e', qty: '3' }] });
  check('set up: a name, a real day, each product once with a count (none below 0, at most 9999)', f.ok && f.fields.name === 'Saturday market' && f.fields.items.map((x: any) => `${x.id}:${x.qty}`).join() === 'a:5,d:9999,e:3'
    && !P.checkPopupForm({ name: '', day: '2026-11-14' }).ok && !P.checkPopupForm({ name: 'X', day: '2026-02-30' }).ok && !P.checkPopupForm({ name: 'X', day: 'Saturday' }).ok, f);
  check('…up to 120 products', !P.checkPopupForm({ name: 'X', day: '2026-11-14', items: Array.from({ length: 121 }, (_, i) => ({ id: `p${i}`, qty: 1 })) }).ok);
  check('on only on its own day, while open; taking line orders only then too', P.popupToday({ status: 'open', day: '2026-11-14' }, '2026-11-14') && !P.popupToday({ status: 'closed', day: '2026-11-14' }, '2026-11-14') && !P.popupToday({ status: 'open', day: '2026-11-15' }, '2026-11-14')
    && P.takingLineOrders({ status: 'open', day: '2026-11-14', lineOrders: true }, '2026-11-14') && !P.takingLineOrders({ status: 'open', day: '2026-11-14', lineOrders: false }, '2026-11-14'));
  const now = Date.parse('2026-11-14T15:00:00Z'); const mins = (m: number) => new Date(now - m * 60000).toISOString();
  const line = P.lineOrdered([
    { stage: 'paid', lines: [{ productId: 'a', qtyOrdered: 2 }, { productId: 'e', qtyOrdered: 1, status: 'refunded' }] },
    { stage: 'placed', placedAt: mins(5), lines: [{ productId: 'a', qtyOrdered: 1 }] },
    { stage: 'placed', placedAt: mins(45), lines: [{ productId: 'a', qtyOrdered: 4 }] },
    { stage: 'placed', lines: [{ productId: 'a', qtyOrdered: 6 }] },
    { stage: 'cancelled', lines: [{ productId: 'a', qtyOrdered: 3 }] },
    { stage: 'completed', lines: [{ productId: 'd', qtyOrdered: 1 }] },
  ], now);
  check('what the line ordered: paid ones and ones being paid for now (by when they were placed); not cancelled, refunded, long-abandoned or unstamped', line.a === 3 && line.d === 1 && !line.e, line);
  const left = P.leftAt({ items: [{ id: 'a', qty: 5 }, { id: 'd', qty: 2 }, { id: 'e', qty: 1 }], soldAtTable: { a: 1, d: 4 } }, line);
  check('what’s left: what came, less the table’s sales and the line’s orders, never below 0', left.a === 1 && left.d === 0 && left.e === 1, left);
  check('the number a line order is called by', P.callWords(12) === 'No. 12' && P.callWords(0) === '' && P.callWords(null) === '');

  console.log('its products');
  await db.doc(T).set({ name: 'Rooted Loc Co.', timezone: 'UTC', modules: { retail: true } });
  await db.doc(`${T}/inventory/gel`).set({ type: 'retail', name: 'Retwist gel', msrp: 18, totalStock: 20, stockReserved: 4, imageUrl: 'https://img.test/gel.webp' });
  await db.doc(`${T}/inventory/bon`).set({ type: 'retail', name: 'Satin bonnet', msrp: 22, totalStock: 0, optionGroups: [{ id: 'g', name: 'Color', choices: [{ id: 'bg', label: 'Burgundy', deltaCents: 0, variantProductId: 'bon-bg' }] }], imageUrl: 'https://img.test/bon.webp' });
  await db.doc(`${T}/inventory/bon-bg`).set({ type: 'retail', name: 'Satin bonnet · Burgundy', totalStock: 6, parentId: 'bon' });
  await db.doc(`${T}/inventory/old`).set({ type: 'retail', name: 'Old', msrp: 5, status: 'archived', totalStock: 9 });
  await db.doc(`${T}/inventory/free`).set({ type: 'retail', name: 'Sample', msrp: 0, totalStock: 9 });
  await db.doc(`${T}/inventory/chair`).set({ type: 'equipment', name: 'Folding table', msrp: 40 });
  const prods = await S.popupProducts(db, 't1', {}, ['gel', 'bon-bg', 'bon', 'old', 'free', 'chair', 'nope'], { numbers: false });
  const v: any = prods.get('bon-bg'); const g: any = prods.get('gel');
  check('a product as the table sells it: name, price, photo, what’s on hand (less what’s held)', g?.name === 'Retwist gel' && g.priceCents === 1800 && g.imageUrl === 'https://img.test/gel.webp' && g.onHand === 16 && g.cart.productId === 'gel', g);
  check('a variant by its listing and choice, the listing’s price and photo, going in the cart as its listing and choice', v?.name === 'Satin bonnet, Burgundy' && v.priceCents === 2200 && v.imageUrl === 'https://img.test/bon.webp' && v.cart.productId === 'bon' && v.cart.selections?.g === 'bg', v);
  check('left out: archived, no price, not a product, unknown, and a listing with variants (sold by its variants)', [...prods.keys()].sort().join() === 'bon-bg,gel', [...prods.keys()]);
  const cat = await S.popupCatalog(db, 't1');
  check('what could come along: the same products, by name', cat.map((p) => p.id).join() === 'gel,bon-bg', cat.map((p) => p.name));

  console.log('the team');
  let r: any = await POST(req({ tenantId: 't1', action: 'save', name: 'Saturday market', place: 'Stall 14', day: day(0), items: [{ id: 'gel', qty: 16 }, { id: 'bon-bg', qty: 3 }] }));
  const pid = r.body.id; let p: any = await get(`${T}/popups/${pid}`);
  check('a manager sets one up: open, not yet taking line orders, nothing sold, numbering from the start', r.status === 200 && p?.name === 'Saturday market' && p.status === 'open' && p.lineOrders === false && p.nextNumber === 0 && JSON.stringify(p.soldAtTable) === '{}' && p.items.length === 2, [r.body, p]);
  const refused: any[] = await Promise.all([POST(req({ tenantId: 't1', action: 'save', name: 'X', day: day(-1), items: [] })), POST(req({ tenantId: 't1', action: 'save', name: 'X', day: day(0), items: [{ id: 'old', qty: 1 }] })), POST(req({ tenantId: 't1', action: 'nope' }))]);
  check('refused: a new one on a day gone by, a product that isn’t for sale (checked on the record), an unknown action', refused[0].status === 400 && refused[1].status === 409 && refused[2].status === 400, refused.map((x: any) => [x.status, x.body.error]));
  await db.doc(`${T}/popups/${pid}`).set({ soldAtTable: { gel: 2 }, nextNumber: 4 }, { merge: true });
  r = await POST(req({ tenantId: 't1', action: 'save', id: pid, name: 'Saturday market', place: 'Stall 15', day: day(0), items: [{ id: 'gel', qty: 20 }] }));
  p = await get(`${T}/popups/${pid}`);
  check('changed: what the table sold and the numbers called stay as they are', r.status === 200 && p.place === 'Stall 15' && p.items.length === 1 && p.soldAtTable.gel === 2 && p.nextNumber === 4, p);
  r = await POST(req({ tenantId: 't1', action: 'lineOrders', id: pid, on: true }));
  check('taking orders from the line, on its day', r.status === 200 && (await get(`${T}/popups/${pid}`)).lineOrders === true);
  const twice: any = await POST(req({ tenantId: 't1', action: 'save', name: 'Evening fair', day: day(0), items: [] }));
  check('one open pop-up a day: a second on the same day is refused, naming the first', twice.status === 409 && /Saturday market is already on that day/.test(twice.body.error), twice.body);
  const later: any = await POST(req({ tenantId: 't1', action: 'save', name: 'Sunday fair', day: day(2), items: [{ id: 'gel', qty: 5 }] }));
  r = await POST(req({ tenantId: 't1', action: 'lineOrders', id: later.body.id, on: true }));
  check('…not before its day', r.status === 409 && (await get(`${T}/popups/${later.body.id}`)).lineOrders === false, r.body);
  await db.doc(`${T}/retailOrders/l1`).set({ popupId: pid, stage: 'paid', lines: [{ productId: 'gel', qtyOrdered: 3 }] });
  actor = { uid: 's1', name: 'Sam', role: 'staff', caps: [] };
  r = await POST(req({ tenantId: 't1', action: 'list' }));
  const today: any = r.body.popups?.find((x: any) => x.id === pid);
  const gelRow = today?.items?.find((x: any) => x.id === 'gel');
  check('anyone on the team sees them, today’s first, with what’s left (what came, less the table and the line)', r.status === 200 && r.body.popups[0].id === pid && today.today === true && gelRow.qty === 20 && gelRow.soldAtTable === 2 && gelRow.ordered === 3 && gelRow.left === 15 && today.lineCount === 1 && r.body.canEdit === false, [r.body.popups?.map((x: any) => x.id), gelRow]);
  const staffTries: any[] = await Promise.all([POST(req({ tenantId: 't1', action: 'save', name: 'X', day: day(0), items: [] })), POST(req({ tenantId: 't1', action: 'close', id: pid })), POST(req({ tenantId: 't1', action: 'lineOrders', id: pid, on: false })), POST(req({ tenantId: 't1', action: 'catalog' }))]);
  check('…but only managers set one up, close it, switch line orders or see what could come along', staffTries.every((x: any) => x.status === 403), staffTries.map((x: any) => x.status));
  await db.doc(`${T}/popups/old1`).set({ id: 'old1', name: 'Friday night', day: day(-1), status: 'open', lineOrders: true, items: [], soldAtTable: {}, nextNumber: 7 });
  r = await POST(req({ tenantId: 't1', action: 'list' }));
  const old1 = await get(`${T}/popups/old1`);
  check('one left open after its day is closed when the pop-ups are read (and the day markers aren’t pop-ups)', old1.status === 'closed' && old1.lineOrders === false && !!old1.closedAt && r.body.popups.every((x: any) => !String(x.id).startsWith('day-')) && r.body.popups.find((x: any) => x.id === 'old1')?.called === 7, [old1, r.body.popups.map((x: any) => x.id)]);
  check('the day is claimed in the same step as the save', !!(await get(`${T}/popups/day-${day(0)}`))?.marker && (await get(`${T}/popups/day-${day(0)}`)).popupId === pid);
  actor = { uid: 'r1', name: 'Rae', role: 'staff', isRenter: true, caps: [] };
  r = await POST(req({ tenantId: 't1', action: 'list' }));
  check('a renter gets none of it', r.status === 403);
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await POST(req({ tenantId: 't1', action: 'catalog' }));
  check('a manager sees what could come along', r.status === 200 && r.body.products.map((x: any) => x.id).join() === 'gel,bon-bg' && !('cart' in r.body.products[0]), r.body);
  r = await POST(req({ tenantId: 't1', action: 'close', id: pid }));
  p = await get(`${T}/popups/${pid}`);
  const again: any = await POST(req({ tenantId: 't1', action: 'save', id: pid, name: 'X', day: day(0), items: [] }));
  check('closed: no more line orders, it can’t be changed, and it’s not on today', r.status === 200 && p.status === 'closed' && p.lineOrders === false && !!p.closedAt && again.status === 409 && !P.popupToday(p, day(0)), [p, again.body]);
  check('each change in the team’s log', ['popup.set_up', 'popup.changed', 'popup.line_on', 'popup.closed'].every((a) => audits.some((x) => x.action === a)), audits.map((a) => a.action));
  await db.doc('tenants/t2').set({ name: 'No shop', modules: { retail: false } });
  r = await POST(req({ tenantId: 't2', action: 'list' }));
  check('a business without the shop has none', r.status === 403);

  console.log('the register');
  const reg = src('src/app/api/checkout/complete/route.ts');
  check('a sale at a pop-up that’s on today, on the business’s calendar, is counted against what came, in the same write as the sale', /popupToday\(pp, popupDay\(popupZone\(tenant\)\)\)/.test(reg)
    && /if \(popupSale\?\.ids\.has\(String\(it\.id\)\)\) batch\.set\(popupSale\.ref, \{ soldAtTable: \{ \[String\(it\.id\)\]: FieldValue\.increment\(it\.quantity\) \}/.test(reg));
  check('…the pop-up read is tried twice, and the desk is told whether the sale counted and why not', /for \(let i = 0; i < 2 && pp === undefined; i\+\+\)/.test(reg) && /popupCounted: !!popupSale, \.\.\.\(popupMiss \? \{ popupMiss \} : \{\}\)/.test(reg));
  const eng = src('src/components/pos/usePosEngine.tsx');
  check('the desk sends the pop-up it was opened for (this tab only), says when a sale didn’t count, and stops when the pop-up is over', /popupId: popup\?\.id \|\| null/.test(eng) && /sessionStorage\.getItem\(key\)/.test(eng) && /const stopPopup = useCallback/.test(eng)
    && /if \(payload\.popupId && out\?\.popupCounted === false\)/.test(eng) && /if \(out\.popupMiss === 'off'\) \{ stopPopup\(\);/.test(eng) && !/p\.day === today/.test(eng)
    && /Selling at <span className="font-semibold">\{e\.popup\.name\}<\/span>/.test(src('src/components/pos/desk/DeskPOS.tsx')));

  console.log('the screen');
  const scr = src('src/components/orders/PopupScreen.tsx');
  check('open the register for it: the desk, for this pop-up', /sessionStorage\.setItem\(popupSessionKey\(tenantId\)/.test(scr) && /`\/pos\?popup=\$\{encodeURIComponent\(p\.id\)\}`/.test(scr) && /cf-popup-\$\{t\}/.test(scr) && /`cf-popup-\$\{tenantId\}`/.test(eng));
  check('what’s left, read again every half minute while one is on; the line’s orders live, by their number', /setInterval\(\(\) => void load\(\), 30000\)/.test(scr) && /where\('popupId', '==', live\.id\)/.test(scr));
  check('calling a number marks it called (not the Pickups one-tap message)', /called: true \}\) \}\);/.test(scr) && /o\.popupCalledAt \? ', called'/.test(scr) && /if \(b\.called === true && o\.popupId\) await ref\.set\(\{ popupCalledAt: now \}/.test(src('src/app/api/retail/order-message/route.ts')));
  check('bagging a line order opens it on Pickups; calling and handing over follow the role', /\/retail-orders\/pickups\?open=/.test(scr) && /new URLSearchParams\(window\.location\.search\)\.get\('open'\)/.test(src('src/components/orders/PickupsScreen.tsx')) && (scr.match(/perms\.canPack === false/g) || []).length === 2);
  check('the switch for line orders is a real switch, 44px, named', /role="switch" aria-checked=\{live\.lineOrders\} aria-label="Orders from the line"/.test(scr) && /h-11 w-\[72px\]/.test(scr));
  const bar = src('src/components/shared/AppSidebar.tsx');
  check('in the shop’s menu and pages, and the app’s own look', /href: '\/popup', +icon: Tent, +label: 'Pop-ups'/.test(bar) && /'\/window', '\/popup'/.test(src('src/lib/modules.ts')) && /'popup'/.test(src('src/lib/app-theme.ts')) && /<PopupScreen \/>/.test(src('src/app/(app)/popup/page.tsx')));
  const rules = src('firestore.rules');
  check('the browser can’t read or write a pop-up (what it sold is the server’s count)', /'proLicenses', 'popups',/.test(rules) && !/match \/tenants\/\{tenantId\}\/popups/.test(rules));
  const copy = [scr, src('src/lib/popup.ts'), src('src/app/api/retail/popup/route.ts')].join('\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const words = [...(copy.match(/>[^<>{}]{3,}</g) || []), ...(copy.match(/'[A-Z][^']{3,}'|`[A-Z][^`]{3,}`/g) || [])].join(' ');
  check('house rules: no business-type words, no “call us”, no emoji, the real apostrophe, no all-caps or heaviest weight', !/\b(studio|salon|stylist|booth|chair)\b/i.test(words) && !/(call|contact) us/i.test(words) && !/[\u{1F300}-\u{1FAFF}]/u.test(copy)
    && !/\b(we|they|it|you|don|isn|can|that)'(ll|re|s|t|ve)\b/i.test(words) && !/\buppercase\b|font-black/.test(scr), words.match(/\b(studio|salon|stylist|booth|chair)\b/i));
  const banned = [['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join(''));
  check('no tool names', ![scr, src('src/lib/popup.ts'), src('src/lib/popup-server.ts'), src('src/app/api/retail/popup/route.ts')].some((t) => banned.some((b) => t.toLowerCase().includes(b))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
