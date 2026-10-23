// Checks the connected order workspace is the one place an order is worked (components/orders/workspace): the orders
// screen opens it for every order, the old panel, packing screen, bench and classic board are gone (their addresses
// land on the orders screen), and the jobs only they did happen inside the order now: the second scan at the box for
// an order picked at the shelf, the hint when a scan belongs to another order, scanning any item to take the order that
// needs it, box sizes, and the staff portal's second scan. Links that went to the old screens open the order instead.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-workspace.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');
const has = (p: string) => fs.existsSync(p);

const app = src('src/components/orders/OrdersApp.tsx');
const ws = src('src/components/orders/workspace/OrderWorkspace.tsx');
const pack = src('src/components/orders/workspace/PackPane.tsx');
const portal = src('src/components/fulfilment/FulfilmentPanel.tsx');

// ── One place for an order ──
check('the orders screen opens every order in the workspace', /<OrderWorkspace /.test(app) && !/OrderPanel|PackMode\b/.test(app.replace(/type PackMode/g, '')));
check('the old order panel and packing screen are gone', !has('src/components/orders/OrderPanel.tsx') && !has('src/components/orders/PackMode.tsx'));
check('the workspace has packing, shipping or handover, the customer and the record', /PackPane/.test(ws) && /ShipPane/.test(ws) && /PickupPane/.test(ws) && /CustomerPane/.test(ws) && /RecordPane/.test(ws));
check('a link can open an order on one part of it (?order=…&tab=…)', /q\.get\('tab'\)/.test(app) && /openOn\(id, t\)/.test(app));

// ── The old screens ──
for (const [name, p] of [['bench', 'src/app/(app)/retail-orders/bench/page.tsx'], ['classic board', 'src/app/(app)/retail-orders/classic/page.tsx']]) {
  const s = src(p);
  check(`the ${name}’s address opens the orders screen`, /redirect\('\/retail-orders'\)/.test(s) && s.split('\n').length < 15);
}
const setup = src('src/components/orders/SetupScreen.tsx');
check('setup no longer lists the bench or the classic board', !/retail-orders\/bench|retail-orders\/classic/.test(setup));
check('wave picking sends the totes to the orders screen to pack', /href="\/retail-orders">Pack them/.test(src('src/app/(app)/retail-orders/waves/page.tsx')) && !/retail-orders\/bench/.test(src('src/app/(app)/retail-orders/waves/page.tsx')));
check('the message inbox opens the order on its conversation', /\/retail-orders\?order=\$\{encodeURIComponent\(t\.orderId\)\}&tab=customer/.test(src('src/app/(app)/retail-orders/support/page.tsx')));
check('nothing links to the bench or the classic board any more',
  !/['"`]\/retail-orders\/(bench|classic)['"`]/.test([app, ws, pack, portal, setup, src('src/lib/modules.ts'), src('src/components/shared/AppSidebar.tsx'), src('src/components/orders/shell.tsx')].join('\n')));

// ── The second scan, inside the order ──
check('an order picked at the shelf is scanned again into the box when the shop asks for it, never a wave order',
  /const packCheck = active && rs\?\.requirePackScan === true && !order\.waveId && prog\.total > 0 && prog\.done >= prog\.total && !COUNTED_HERE\.has\(hereKey\) && !isPackComplete/.test(pack));
check('…each scan is the pack check (lib/retail-fulfill recordPackScan), and finishing waits for every unit', /if \(packCheck\) \{\s*const r = await recordPackScan\(fs, tenantId, order\.id, v, actor\)/.test(pack) && /const left = packCheck \? packLeft :/.test(pack));
check('…an order counted in at the box isn’t asked a second time, even after switching away and back', /const COUNTED_HERE = new Set<string>\(\)/.test(pack) && (pack.match(/COUNTED_HERE\.add\(hereKey\)/g) || []).length === 2 && /export function countedAtBox/.test(pack));
check('…and tapping can’t stand in for it', /const canTap = rs\?\.requireScan !== true && rs\?\.requirePackScan !== true/.test(pack) && /active && !packCheck && !closed && !full/.test(pack));
check('a scan of another order’s item says which order and tote it belongs to', /const whoseIs = \(v: string\)/.test(pack) && /lineMatchesScan\(l, v\)/.test(pack) && /toteOf\(o\)/.test(pack) && (pack.match(/r\.miss === 'elsewhere' \? whoseIs\(v\)/g) || []).length === 2);
check('the packing scanner only listens while packing (a tote or label scan otherwise reaches the orders screen)', /\{active && <PackScanner /.test(pack) || /active \? <PackScanner/.test(pack));

// ── Scan any item on the orders screen ──
check('an item scanned on the orders screen counts into your order that needs it, or takes the most urgent waiting order that does',
  /if \(!t\) \{[\s\S]{0,700}?await itemScan\(v\); return;\s*\}/.test(app) && /queue\.find\(\(o: any\) => o\.stage === 'paid' && wants\(o\)\)/.test(app) && /claim = startPacking\(fs, tenantId, waiting, actor\)/.test(app) && /if \(await claim\) await count\(waiting, true\)/.test(app));
check('…the count is the scan at the box, and the order opens on its Pack tab', /if \(r\.ok\) countedAtBox\(tenantId, o\.id\)/.test(app) && /openOn\(o\.id, 'pack'\)/.test(app));
check('…someone else’s order is named, not taken', /which \$\{theirs\.claimedByName/.test(app));
check('…a tote tag, an order slip or a label that matches nothing is named for what it is, and a product’s own QR code still counts as an item',
  /if \(tote\) \{ feel\(false\); setToast\(`Tote \$\{tote\} is empty\.`\)/.test(app) && /clarityflow:\\\/\\\/order\\\//.test(app) && !/clarityflow:\\\/\\\/\/i\.test/.test(app) && /if \(looksLikeTracking\(v\)\)/.test(app));

// ── Box sizes ──
check('managers set the box sizes from the order (the classic board’s job)', /BoxSizesSheet/.test(ws) && has('src/app/api/retail/box-sizes/route.ts') && /if \(!auth\.actor\.isManager\) return bad\('Managers set the box sizes\.', 403\)/.test(src('src/app/api/retail/box-sizes/route.ts')));

// ── The staff portal ──
check('the staff portal asks for the second scan before finishing an order picked at the shelf',
  /const needsCheck = \(o: BoardOrder\) => rs\.requirePackScan === true && !o\.waveId && !isPackComplete/.test(portal) && /if \(needsCheck\(o\)\) \{\s*setChecking\(o\.id\)/.test(portal));
check('…each scan at the box is the pack check, and the last one finishes the order', /const r = await recordPackScan\(fs, tenantId, checkOrder\.id, value, actor as any\)/.test(portal) && /if \(r\.packComplete\) \{\s*setChecking\(null\);\s*if \(await doFinish\(checkOrder\)\)/.test(portal));
check('…a tote or slip scan only says finished when it was', /if \(await finish\(held\)\) show/.test(portal) && /if \(await finish\(slip\)\) show/.test(portal));
check('the setting says where the second scan happens now', /scanned again as it’s packed/.test(src('src/app/(app)/retail-orders/settings/page.tsx')) && !/again at the bench/.test(src('src/app/(app)/retail-orders/settings/page.tsx')));

// ── House rules on these screens ──
const screens = [pack, ws, src('src/components/orders/workspace/CustomerPane.tsx'), src('src/components/orders/workspace/RecordPane.tsx'), src('src/components/orders/workspace/ShipPane.tsx'), src('src/components/orders/workspace/Attention.tsx'), src('src/components/orders/workspace/BoxSizes.tsx'), portal];
check('no comments inside the markup', !screens.some((s) => /\{\/\*/.test(s)));
check('no “call us”', !screens.some((s) => /call us/i.test(s)));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
