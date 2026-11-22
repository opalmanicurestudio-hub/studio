// Checks the register's menu tiles (design board "Tiles at the register", look B: photos; lib/register-tiles,
// lib/register-tiles-server, lib/counter-server soldCounts, api/counter 'lane', components/pos/RegisterTiles, on the
// counter and the drive-thru lane screen).
// - Most sold now first: what sells at this hour, counted by hour as orders are sent.
// - Find from any section; "3 left"; sold out; bigger tiles or more to a screen, kept on the device.
// - A photo tile for each item with a photo, its name alone for one without.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/register-tiles.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: any) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }), staffOrServer: async () => true });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const R = await import('../../src/lib/register-tiles');
  console.log('the rules');
  check('a price now: happy hour, and "from" its cheapest choices', R.priceOf({ price: 5, from: false, startPrice: 5, priceNow: 4, happy: true }) === 4 && R.priceOf({ price: 5, from: true, startPrice: 4.5 }) === 4.5 && R.fullOf({ price: 5, from: true, startPrice: 4.5 }) === 4.5);
  check('"3 left" once five or fewer can be made; none left is sold out, not "0 left"; not counted, nothing said', R.leftOf({ canMake: 3 }) === 3 && R.leftOf({ canMake: 5 }) === 5 && R.leftOf({ canMake: 6 }) === null && R.leftOf({ canMake: 0 }) === null && R.leftOf({ canMake: null }) === null);
  check('an hour’s count on the day: h08_latte (and the hour after 11 PM is midnight)', R.hourKey(8, 'latte') === 'h08_latte' && R.hourKey(24, 'x') === 'h00_x' && R.hourKey(-1, 'x') === 'h23_x');
  const on = new Set(['latte', 'brew', 'croissant', 'muffin', 'sandwich', 'soup']);
  const morning = [{ day: 'a', h08_latte: 20, h08_croissant: 9, h09_brew: 7, h12_sandwich: 30, h12_soup: 12, n_latte: 25, n_sandwich: 40 }, { h08_latte: 6, h09_muffin: 2, h08_gone: 99, h08_soup: 1 }];
  check('Most sold now at 8 AM: this hour and the next over the days, most sold first, each sold at least twice, only what’s on the menu', JSON.stringify(R.mostSoldOf(morning, 8, on)) === JSON.stringify(['latte', 'croissant', 'brew', 'muffin']), R.mostSoldOf(morning, 8, on));
  check('…at noon, lunch', R.mostSoldOf(morning, 12, on)[0] === 'sandwich' && R.mostSoldOf(morning, 12, on)[1] === 'soup');
  check('…too few counted by hour yet: the days’ best sellers whatever the hour', JSON.stringify(R.mostSoldOf([{ h15_soup: 3, n_latte: 25, n_sandwich: 40, n_soup: 3 }], 15, on)) === JSON.stringify(['sandwich', 'latte', 'soup']));
  check('…at most a screen of them', R.mostSoldOf([Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`h10_i${i}`, 5 + i]))], 10, new Set(Array.from({ length: 20 }, (_, i) => `i${i}`))).length === R.MOST_MAX);
  const items = [{ name: 'Oat latte', number: 3 }, { name: 'Iced coffee', number: 4 }, { name: 'Crème brûlée', number: null }, { name: 'Latte', number: 13 }];
  check('find: a few letters of each word, from any section; the number guests order by; accents typed or not; any script', R.findTiles([...items, { name: '아메리카노 아이스', number: null }, { name: 'Чай латте', number: null }], '아이').length === 1 && R.findTiles([...items, { name: 'Чай латте', number: null }], 'чай').length === 1 && R.findTiles(items, 'oat la').map((x) => x.name).join() === 'Oat latte' && R.findTiles(items, 'lat').length === 2 && R.findTiles(items, '3')[0].name === 'Oat latte' && R.findTiles(items, '3').length === 1 && R.findTiles(items, 'creme').length === 1 && R.findTiles(items, 'zz').length === 0 && R.findTiles(items, '  ').length === 0);
  check('tile size kept on the device: big unless compact', R.sizeOf('compact') === 'compact' && R.sizeOf(null) === 'big' && R.sizeOf('huge') === 'big');

  console.log('arranged by the business');
  const setup0 = R.tileSetupOf({});
  check('nothing set: photo tiles, the menu’s order, nothing pinned or hidden', setup0.look === 'photos' && !setup0.order.length && !setup0.pinned.length && !setup0.hidden.length);
  const ids = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  const c1: any = R.cleanTileSetup({ look: 'names', order: ['c', 'zz', 'a'], pinned: ['b'], hidden: ['b', 'd'] }, ids, setup0);
  check('a change: only the menu’s own items; pinning one shows it (the later word wins)', c1.look === 'names' && c1.order.join() === 'c,a' && c1.pinned.join() === 'b' && c1.hidden.join() === 'd', c1);
  const c2: any = R.cleanTileSetup({ hidden: ['b', 'd'] }, ids, c1);
  check('…hiding a pinned one unpins it', c2.pinned.length === 0 && c2.hidden.join() === 'b,d' && c2.order.join() === 'c,a' && c2.look === 'names', c2);
  check('…at most six pinned; the look is photos or names', 'error' in R.cleanTileSetup({ pinned: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, ids, setup0) && 'error' in R.cleanTileSetup({ look: 'color' }, ids, setup0));
  const menuOrder = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  check('the tiles in the business’s order: pinned first (in pin order), then the order set, then the rest as on the menu; hidden left out',
    R.arranged(menuOrder, { look: 'photos', order: ['d', 'b'], pinned: ['e', 'c'], hidden: ['a'] }).map((x) => x.id).join() === 'e,c,d,b' && R.arranged(menuOrder, null).length === 5);
  check('Most sold now: the pinned first, then what sells now (never one hidden), a screen at most', R.mostWithPinned(['x', 'e', 'h1'], { look: 'photos', order: [], pinned: ['e', 'c'], hidden: ['h1'] }).join() === 'e,c,x');

  console.log('counted by the hour as orders are sent');
  const tenant = { name: 'Linden', timezone: 'America/New_York', kitchenSettings: { targets: { 'drive-thru': 210 } } };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Coffee', price: 5.25, totalStock: 100 });
  const CS = await import('../../src/lib/counter-server');
  const who = { id: 'm1', name: 'Ana Ruiz' };
  const car = await CS.createCar(db, 't1', tenant, 'carkey00001', who, {});
  await CS.editOrder(db, 't1', tenant, car.orderId, { action: 'add', itemId: 'latte', quantity: 2 } as any);
  const sent: any = await CS.sendOrder(db, 't1', tenant, car.orderId, who);
  const { todayIn, hourIn } = await import('../../src/lib/tenant-time');
  const now = new Date(); const day = todayIn('America/New_York', now); const hour = hourIn(now, 'America/New_York');
  const sales = await get(`${T}/menuSales/${day}`);
  check('sent: the day’s count as before, and the hour’s, in the business’s time', sent.ok && sales?.n_latte === 2 && sales?.[R.hourKey(hour, 'latte')] === 2, sales);
  const car2 = await CS.createCar(db, 't1', tenant, 'carkey00002', who, {});
  await CS.editOrder(db, 't1', tenant, car2.orderId, { action: 'add', itemId: 'latte', quantity: 1 } as any);
  const noted: any = await CS.editOrder(db, 't1', tenant, car2.orderId, { action: 'add', itemId: 'latte', quantity: 1, note: 'Extra hot' } as any);
  check('pressed and held, added with a note: a line of its own, the note on it for the kitchen', noted.order?.lines?.length === 2 && noted.order.lines.some((l: any) => l.note === 'Extra hot' && l.quantity === 1) && noted.order.lines.some((l: any) => !l.note && l.quantity === 1), noted.order?.lines);
  const kiosk = src('src/lib/counter-server.ts');
  check('…a kiosk’s, counted once it’s paid, in the hour it was placed', /salesHour: hourIn\(now, tenantTimeZone\(tenant\)\)/.test(kiosk) && /soldCounts\(Array\.isArray\(o\.lines\) \? o\.lines : \[\], typeof o\.salesHour === 'number' \? o\.salesHour : null\)/.test(kiosk));

  console.log('read on the server');
  const S = await import('../../src/lib/register-tiles-server');
  await db.doc(`${T}/inventory/brew`).set({ type: 'refreshment', name: 'Cold brew', category: 'Coffee', price: 4.75, totalStock: 100 });
  await db.doc(`${T}/menuSales/${day}`).set({ [R.hourKey(hour, 'brew')]: 40, [R.hourKey(hour, 'croissant')]: 9 }, { merge: true });
  let most = await S.mostSoldNow(db, 't1', 'America/New_York', ['latte', 'brew'], now);
  check('what sells at this hour, from the last three weeks, among what’s on the menu', JSON.stringify(most) === JSON.stringify(['brew', 'latte']), most);
  await db.doc(`${T}/menuSales/${day}`).set({ [R.hourKey(hour, 'latte')]: 90 }, { merge: true });
  most = await S.mostSoldNow(db, 't1', 'America/New_York', ['latte', 'brew'], now);
  check('…read every ten minutes, however many screens poll', JSON.stringify(most) === JSON.stringify(['brew', 'latte']));
  most = await S.mostSoldNow(db, 't1', 'America/New_York', ['latte', 'brew'], new Date(now.getTime() + 11 * 60000));
  check('…and afresh after', most?.[0] === 'latte', most);
  check('…worked out once a minute per business, hour and menu, not on every look', /listCache\.get\(lk\)/.test(src('src/lib/register-tiles-server.ts')) && /now\.getTime\(\) - done\.at < 60000/.test(src('src/lib/register-tiles-server.ts')));
  check('the lane and the counter get it with the menu', /most: await \(await import\('@\/lib\/register-tiles-server'\)\)\.mostSoldNow\(db, tenantId, tz,/.test(src('src/app/api/counter/route.ts')));

  console.log('set on the Menu page');
  await db.doc(`${T}/inventory/cro`).set({ type: 'refreshment', name: 'Almond croissant', category: 'Pastries', price: 4.5, totalStock: 10 });
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const mreq = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;
  let r: any = await MENU(mreq({ tenantId: 't1', action: 'laneSettings', tiles: { pinned: ['cro', 'nope'], order: ['brew', 'latte'], look: 'names' } }));
  check('a manager pins, orders and picks the look: kept for every counter and lane', r.status === 200 && r.body.lane?.tiles?.pinned?.join() === 'cro' && (await get(T)).registerTiles?.order?.join() === 'brew,latte' && (await get(T)).registerTiles?.look === 'names', r.body);
  r = await MENU(mreq({ tenantId: 't1', action: 'laneSettings', tiles: { hidden: ['cro'] } }));
  check('…hiding one: the rest kept as they were', r.status === 200 && (await get(T)).registerTiles.pinned.length === 0 && (await get(T)).registerTiles.hidden.join() === 'cro' && (await get(T)).registerTiles.order.join() === 'brew,latte');
  r = await MENU(mreq({ tenantId: 't1', action: 'laneSettings', tiles: { look: 'color' } }));
  check('…only what’s offered', r.status === 400);
  r = await MENU(mreq({ tenantId: 't1', action: 'list' }));
  check('the Menu page gets it for the Register tiles card', r.status === 200 && r.body.tiles?.hidden?.join() === 'cro', r.body.tiles);
  r = await MENU(mreq({ tenantId: 't1', action: 'laneSettings', tiles: { order: ['latte', 'ghost', 'brew'] } }));
  check('…an item that isn’t the business’s is left out; those it has kept', r.status === 200 && (await get(T)).registerTiles.order.join() === 'latte,brew', [r.status, r.body, (await get(T)).registerTiles]);
  actor = { uid: 's1', name: 'Kai', role: 'staff', caps: [] };
  r = await MENU(mreq({ tenantId: 't1', action: 'laneSettings', tiles: { hidden: [] } }));
  check('…nobody else changes it', r.status === 403 && (await get(T)).registerTiles.hidden.join() === 'cro');
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  check('the lane and the counter get it with the menu (only ids on the menu now)', /const t = tileSetupOf\(tenant\);/.test(src('src/app/api/counter/route.ts')) && /order: t\.order\.filter\(\(x\) => onMenu\.has\(x\)\)/.test(src('src/app/api/counter/route.ts')));
  check('…a save looks up only items new to it (a drag reads nothing more)', /const asked = Array\.from/.test(src('src/app/api/menu/route.ts')) && /!known\.has\(x\)/.test(src('src/app/api/menu/route.ts')) && /db\.getAll\(\.\.\.asked\.map/.test(src('src/app/api/menu/route.ts')) && !/inventory`\)\.select\(\)\.limit\(3000\)/.test(src('src/app/api/menu/route.ts')));

  console.log('the screens');
  const tiles = src('src/components/pos/RegisterTiles.tsx');
  const cp = src('src/app/(app)/counter/page.tsx'), lp = src('src/app/drive-thru/[tenantId]/page.tsx');
  const card = src('src/components/menu/TilesCard.tsx');
  check('the Register tiles card: photo tiles or names, each section’s rows dragged into order (or moved with the arrow keys), pin and hide, saved as it goes', /<TilesCard start=\{tilesSet\} items=\{menu\} call=\{call\} \/>/.test(src('src/app/(app)/menu/page.tsx'))
    && /role="radiogroup" aria-label="Tiles"/.test(card) && /setPointerCapture\(e\.pointerId\)/.test(card) && /touchAction: 'none'/.test(card) && /e\.key !== 'ArrowUp' && e\.key !== 'ArrowDown'/.test(card)
    && /\{isPin \? 'Pinned' : 'Pin'\}/.test(card) && /onLostPointerCapture=\{onUp\}/.test(card) && /translateY\(\$\{dy\}px\)/.test(card) && /h-11 w-11 shrink-0 cursor-grab/.test(card) && /all\.splice\(at, 0, id\)/.test(card) && /\{isHid \? 'Hidden' : 'Hide'\}/.test(card) && /Up to \$\{PIN_MAX\} pinned\. Unpin one first\./.test(card) && /setSetup\(was\)/.test(card));
  check('…the tiles follow it: hidden left out, pinned first, names only when chosen; Find and a scan still reach a hidden one', /setup=\{lane\.tiles \|\| null\}/.test(cp) && /setup=\{lane\?\.tiles \|\| null\}/.test(lp)
    && /const shownItems = React\.useMemo\(\(\) => arranged\(items, setup\)/.test(tiles) && /mostWithPinned\(most, setup\)/.test(tiles) && /finding \? findTiles\(items, q\)/.test(tiles) && /setup\?\.look !== 'names' && items\.some/.test(tiles));
  check('the counter and the lane screen use the same tiles', /<RegisterTiles items=\{menu\} most=\{lane\.most \|\| null\}/.test(cp) && /place="counter"/.test(cp) && /<RegisterTiles items=\{menu\} most=\{lane\?\.most \|\| null\}/.test(lp) && /place="lane"/.test(lp));
  check('…back to Most sold now for each new order', /useEffect\(\(\) => \{ setSection\(null\); setCash\(null\);/.test(cp) && /setJust\(null\); setSection\(null\); \}, \[order\?\.id\]\)/.test(lp) && !/cf\.drivethru\.section/.test(lp));
  check('Most sold now first, once a few items have sold at this hour', /const tabs = mostItems\.length >= MOST_MIN \? \[MOST_ID, \.\.\.sections\] : sections;/.test(tiles) && /\{s === MOST_ID \? MOST_TAB : s\}/.test(tiles) && /const shown = section && tabs\.includes\(section\) \? section : tabs\[0\] \|\| null;/.test(tiles));
  check('a photo, its name and price under it; one without a photo, its name alone', /if \(photos && m\.imageUrl\) return \(/.test(tiles) && /Its name alone/.test(tiles) && /grayscale\(1\)/.test(tiles));
  check('Enter in Find puts the one item found on the order; a scan into the box clears it; arrow keys move along the tabs', /const scanned = e\.nativeEvent\.defaultPrevented; e\.preventDefault\(\);/.test(tiles) && /if \(scanned\) \{ setQ\(''\); return; \}/.test(tiles) && /hits\.length === 1 \? hits\[0\] : null/.test(tiles) && /\{ onTap\(one\); setQ\(''\); \}/.test(tiles) && /e\.key === 'ArrowRight'/.test(tiles) && /aria-controls=\{`tiles-\$\{place\}`\}/.test(tiles));
  check('find from any section, a scanner still scans', /findTiles\(items, q\)/.test(tiles) && /data-scan-field/.test(tiles) && /placeholder="Find, or scan"/.test(tiles) && /aria-label="Clear"/.test(tiles) && /Nothing on the menu matches\. Try fewer letters\./.test(tiles));
  check('"3 left" and sold out on the tile; the count on it', /\{left\} left/.test(tiles) && /const why = m\.off \|\| outWords\(m\)/.test(tiles) && /n \? `, \$\{n\} on the order` : ''/.test(tiles));
  check('press and hold (or right-click, or Shift and Enter): its choices and a note; a press that becomes a scroll is neither', R.HOLD_MS >= 300 && R.HOLD_MS <= 600 && /setTimeout\(\(\) => \{ timer\.current = null; armed\.current = true; setReady\(true\); \}, HOLD_MS\)/.test(tiles) && /Math\.hypot\(e\.clientX - from\.current\[0\], e\.clientY - from\.current\[1\]\) > 10\) disarm\(\)/.test(tiles)
    && /if \(armed\.current\) \{ disarm\(\); onHold\?\.\(\); return; \} onTap\(\);/.test(tiles) && /onPointerLeave: \(e: React\.PointerEvent\) => \{ if \(e\.pointerType === 'mouse'\) disarm\(\); else stop\(\); \}/.test(tiles)
    && /onContextMenu: \(e: React\.MouseEvent\) => \{ e\.preventDefault\(\); if \(!done\.current\) opened\(\); \}/.test(tiles) && /setTimeout\(\(\) => \{ done\.current = false; \}, 800\)/.test(tiles) && /if \(e\.nativeEvent\.defaultPrevented\) return; if \(e\.key === 'ContextMenu' \|\| \(e\.key === 'Enter' && e\.shiftKey\)\)/.test(tiles) && /else \{ done\.current = false; disarm\(\); \}/.test(tiles) && /onTouchEnd: \(e: React\.TouchEvent\) => \{ if \(!armed\.current\) return; e\.preventDefault\(\); opened\(\); \}/.test(tiles) && /WebkitTouchCallout: 'none'/.test(tiles) && /Press and hold a tile for its choices and a note \(or Shift and Enter\)\./.test(tiles));
  check('…on the counter and the lane: the choices sheet for any item, with a note for the kitchen, sent with the item (and with one weighed)', /const hold = \(m: Item\) => \{ if \(!order\)/.test(cp) && /onHold=\{hold\}/.test(cp) && /<NoteField id="counter-choice-note"/.test(cp) && /add\(choiceFor, p, q, choiceOffer \? 'item' : undefined, undefined, note\)/.test(cp) && /\.\.\.\(weighFor\.note\?\.trim\(\) \? \{ note: weighFor\.note\.trim\(\) \} : \{\}\)/.test(cp)
    && /const holdItem = \(m: LaneItem\) => \{ setChoiceOffer\(false\); setChoiceFor\(m\); \};/.test(lp) && /onHold=\{holdItem\}/.test(lp) && /<NoteField id="lane-choice-note"/.test(lp) && /add\(choiceFor, p, q, choiceOffer \? 'item' : undefined, note\)/.test(lp) && /\.\.\.\(said \? \{ note: said \} : \{\}\)/.test(lp) && /\.\.\.\(weighFor\.note \? \{ note: weighFor\.note \} : \{\}\)/.test(lp));
  check('…the sheet ignores the backdrop for a moment as it opens; one weighed is weighed next, no count to pick', [cp, lp].every((p) => /Date\.now\(\) - openedAt\.current > 400\) onClose\(\)/.test(p) && /\{!item\.byWeight && <div className="flex shrink-0 items-center rounded-full"/.test(p) && /Next, weigh it \(\$\{usd\(each\)\}\/\$\{item\.byWeight\}\)/.test(p)));
  check('bigger tiles or more to a screen, kept on this device', /localStorage\.setItem\(TILE_SIZE_KEY, s\)/.test(tiles) && /More tiles to a screen/.test(tiles) && /Bigger tiles/.test(tiles));
  check('every control a big enough tap', /h-11 w-11/.test(tiles) && /min-h-\[44px\]/.test(tiles) && /min-h-\[48px\]/.test(tiles));
  for (const f of ['src/lib/register-tiles.ts', 'src/lib/register-tiles-server.ts', 'src/components/pos/RegisterTiles.tsx', 'src/components/menu/TilesCard.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup, no red`, !/\buppercase\b|font-black| · |\{\/\*|b42318/.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
