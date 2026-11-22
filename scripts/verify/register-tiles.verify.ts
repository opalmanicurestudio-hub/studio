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
M._load = function (request: string, ...rest: any[]) {
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

  console.log('the screens');
  const tiles = src('src/components/pos/RegisterTiles.tsx');
  const cp = src('src/app/(app)/counter/page.tsx'), lp = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('the counter and the lane screen use the same tiles', /<RegisterTiles items=\{menu\} most=\{lane\.most \|\| null\}/.test(cp) && /place="counter"/.test(cp) && /<RegisterTiles items=\{menu\} most=\{lane\?\.most \|\| null\}/.test(lp) && /place="lane"/.test(lp));
  check('…back to Most sold now for each new order', /useEffect\(\(\) => \{ setSection\(null\); setCash\(null\);/.test(cp) && /setJust\(null\); setSection\(null\); \}, \[order\?\.id\]\)/.test(lp) && !/cf\.drivethru\.section/.test(lp));
  check('Most sold now first, once a few items have sold at this hour', /const tabs = mostItems\.length >= MOST_MIN \? \[MOST_ID, \.\.\.sections\] : sections;/.test(tiles) && /\{s === MOST_ID \? MOST_TAB : s\}/.test(tiles) && /const shown = section && tabs\.includes\(section\) \? section : tabs\[0\] \|\| null;/.test(tiles));
  check('a photo, its name and price under it; one without a photo, its name alone', /if \(photos && m\.imageUrl\) return \(/.test(tiles) && /Its name alone/.test(tiles) && /grayscale\(1\)/.test(tiles));
  check('Enter in Find puts the one item found on the order; a scan into the box clears it; arrow keys move along the tabs', /const scanned = e\.nativeEvent\.defaultPrevented; e\.preventDefault\(\);/.test(tiles) && /if \(scanned\) \{ setQ\(''\); return; \}/.test(tiles) && /hits\.length === 1 \? hits\[0\] : null/.test(tiles) && /\{ onTap\(one\); setQ\(''\); \}/.test(tiles) && /e\.key === 'ArrowRight'/.test(tiles) && /aria-controls=\{`tiles-\$\{place\}`\}/.test(tiles));
  check('find from any section, a scanner still scans', /findTiles\(items, q\)/.test(tiles) && /data-scan-field/.test(tiles) && /placeholder="Find, or scan"/.test(tiles) && /aria-label="Clear"/.test(tiles) && /Nothing on the menu matches\. Try fewer letters\./.test(tiles));
  check('"3 left" and sold out on the tile; the count on it', /\{left\} left/.test(tiles) && /const why = m\.off \|\| outWords\(m\)/.test(tiles) && /n \? `, \$\{n\} on the order` : ''/.test(tiles));
  check('bigger tiles or more to a screen, kept on this device', /localStorage\.setItem\(TILE_SIZE_KEY, s\)/.test(tiles) && /More tiles to a screen/.test(tiles) && /Bigger tiles/.test(tiles));
  check('every control a big enough tap', /h-11 w-11/.test(tiles) && /min-h-\[44px\]/.test(tiles) && /min-h-\[48px\]/.test(tiles));
  for (const f of ['src/lib/register-tiles.ts', 'src/lib/register-tiles-server.ts', 'src/components/pos/RegisterTiles.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup, no red`, !/\buppercase\b|font-black| · |\{\/\*|b42318/.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
