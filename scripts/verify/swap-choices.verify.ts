// Checks WHEN SOMETHING'S OUT, EACH ITEM'S OWN CHOICE (lib/retail-swap, api/retail/checkout, api/retail/backups):
//   - at checkout the customer chooses for each item: best match, a backup they pick, or a refund; an item left as it is
//     follows the shop's choice in Setup; a product the shop never swaps is refunded; "ask me first" isn't offered;
//   - a swap never costs more than what was paid: matches and backups are the same price or less (up to 15% more only
//     when the shop chose to cover the difference itself), the same product's other colors first;
//   - a backup is checked against the catalog when it's chosen: sold online, in stock, not dearer, not for licensed
//     pros only on an item that isn't, never a product the shop never swaps;
//   - Setup's settings, the product's Never swap switch, and the customer's screen keep to the house style.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/swap-choices.verify.ts
import fs from 'fs';
import { check, failures, makeDb } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const S = await import('../../src/lib/retail-swap');

  // ── Each item's choice ──
  const order = { ifUnavailable: 'refund' };
  check('an item’s own choice wins over the order’s', S.lineIfOut(order, { ifOut: { how: 'match' } }).how === 'match' && S.lineIfOut({ ifUnavailable: 'similar' }, { ifOut: { how: 'refund' } }).how === 'refund');
  const b = S.lineIfOut(order, { ifOut: { how: 'backup', backupId: 'pb', backupName: 'Gel · Blush', backupPriceCents: 1200 } });
  check('a backup they picked carries its name and price', b.how === 'backup' && b.backup?.productId === 'pb' && b.backup?.unitPriceCents === 1200 && S.ifOutWords(b) === 'Gel · Blush instead', b);
  check('“this one instead” with nothing picked is a refund', S.lineIfOut(order, { ifOut: { how: 'backup' } }).how === 'refund');
  check('an item left as it is follows the order’s one choice', S.lineIfOut({ ifUnavailable: 'similar' }, {}).how === 'match' && S.lineIfOut({}, {}).how === 'refund');
  check('an order placed when customers could ask to be asked is still asked', S.lineIfOut({ ifUnavailable: 'ask' }, {}).how === 'ask');
  check('a product the shop never swaps is refunded, whatever was chosen', S.lineIfOut({ ifUnavailable: 'similar' }, { noSwap: true, ifOut: { how: 'match' } }).how === 'refund');
  check('a choice as checkout receives it: a known way, a backup only with a clean id', JSON.stringify(S.normaliseIfOut({ how: 'backup', backupId: 'p_1' })) === '{"how":"backup","backupId":"p_1"}'
    && S.normaliseIfOut({ how: 'backup', backupId: '../x' }) === null && S.normaliseIfOut({ how: 'ask' }) === null && JSON.stringify(S.normaliseIfOut({ how: 'refund', backupId: 'x' })) === '{"how":"refund"}' && S.normaliseIfOut('match') === null);
  check('the shop’s choice for items left as they are: best match unless it chose refunds', S.swapDefault({}) === 'match' && S.swapDefault({ swapDefault: 'refund' }) === 'refund' && S.perItemOn({}) && !S.perItemOn({ swapPerItem: false }));
  check('Ask me first is no longer one of the choices', !S.SWAP_HOWS.some((h: any) => /ask/i.test(h.label)) && S.SWAP_HOWS.map((h) => h.id).join() === 'match,backup,refund');

  // ── Never more than they paid ──
  check('a swap may cost the same or less; up to 15% more only when the shop covers it', S.swapCapCents(1200) === 1200 && S.swapCapCents(1200, { swapCoverMore: true }) === 1380 && S.swapCapCents(900, { swapCoverMore: true }) === 1035);
  const inv = [
    { id: 'rose', name: 'Gel · Rosewood', listingId: 'gel', category: 'gel', msrp: 12, showOnline: true, totalStock: 0 },
    { id: 'blush', name: 'Gel · Blush', listingId: 'gel', category: 'gel', msrp: 12, showOnline: true, totalStock: 5 },
    { id: 'fig', name: 'Gel · Fig', listingId: 'gel', category: 'gel', msrp: 13, showOnline: true, totalStock: 5 },
    { id: 'dusty', name: 'Gel polish, Dusty rose', category: 'gel', msrp: 11.5, showOnline: true, totalStock: 5 },
    { id: 'near', name: 'Gel polish, Coral', category: 'gel', msrp: 12, showOnline: true, totalStock: 5 },
    { id: 'custom', name: 'Custom set', category: 'gel', msrp: 10, showOnline: true, totalStock: 5, noSwap: true },
    { id: 'pricey', name: 'Gel polish, Pro', category: 'gel', msrp: 13.5, showOnline: true, totalStock: 5 },
    { id: 'oil', name: 'Cuticle oil', category: 'oil', msrp: 9, showOnline: true, totalStock: 5 },
  ];
  const m = S.similarItems(inv, { productId: 'rose', unitPriceCents: 1200, listingId: 'gel' });
  check('the same product’s other colors come first, then close matches', m[0]?.productId === 'blush' && m.map((x) => x.productId).join() === 'blush,near,dusty', m.map((x) => x.productId));
  check('…never dearer, never a product the shop never swaps, never another category', !m.some((x) => ['fig', 'pricey', 'custom', 'oil'].includes(x.productId)));
  const cov = S.similarItems(inv, { productId: 'rose', unitPriceCents: 1200, listingId: 'gel' }, 6, { swapCoverMore: true }).map((x) => x.productId);
  check('when the shop covers the difference, a little more is allowed (still the same product first)', cov[0] === 'blush' && cov.includes('fig') && cov.includes('pricey') && !cov.includes('custom'), cov);

  // ── A backup checked against the catalog ──
  const db: any = makeDb();
  const T = 'tenants/t1';
  const put = (id: string, v: any) => db.collection(`${T}/inventory`).doc(id).set(v);
  await db.doc(T).set({ name: 'Shop' });
  await put('gel', { name: 'Gel color', type: 'retail', status: 'active', showOnline: true, msrp: 12, optionGroups: [{ id: 'c', name: 'Color', variants: true, choices: [{ id: 'r', label: 'Rosewood', variantProductId: 'rose' }, { id: 'b', label: 'Blush', variantProductId: 'blush' }, { id: 'f', label: 'Fig', variantProductId: 'fig' }] }] });
  await put('rose', { name: 'Gel color, Rosewood', type: 'retail', status: 'active', parentId: 'gel', msrp: 12, totalStock: 0 });
  await put('blush', { name: 'Gel color, Blush', type: 'retail', status: 'active', parentId: 'gel', msrp: 12, totalStock: 4 });
  await put('fig', { name: 'Gel color, Fig', type: 'retail', status: 'active', parentId: 'gel', msrp: 13, totalStock: 4 });
  await put('custom', { name: 'Custom set', type: 'retail', status: 'active', showOnline: true, msrp: 10, totalStock: 4, noSwap: true });
  await put('pro', { name: 'Pro primer', type: 'retail', status: 'active', showOnline: true, msrp: 10, totalStock: 4, prosOnly: true });
  await put('gone', { name: 'Old gel', type: 'retail', status: 'active', showOnline: true, msrp: 10, totalStock: 1, stockReserved: 1 });
  await put('hidden', { name: 'Back room gel', type: 'retail', status: 'active', showOnline: false, msrp: 10, totalStock: 4 });
  const W = await import('../../src/lib/retail-swap-server');
  const line = { productId: 'rose', unitPriceCents: 1200 };
  const ok: any = await W.swapCandidate(db, 't1', 'blush', line, {}, {});
  check('another color at the same price can be their backup, named and priced as the shop sells it', ok.ok && ok.item.unitPriceCents === 1200 && /Blush/.test(ok.item.name), ok);
  const dear: any = await W.swapCandidate(db, 't1', 'fig', line, {}, {});
  check('a dearer one can’t, and says why', !dear.ok && /costs more than what was paid/.test(dear.message), dear);
  check('…unless the shop covers up to 15% more itself', (await W.swapCandidate(db, 't1', 'fig', line, {}, { swapCoverMore: true }) as any).ok);
  const why = async (id: string, l: any = line) => ((await W.swapCandidate(db, 't1', id, l, {}, {})) as any).message || 'ok';
  check('a product the shop never swaps isn’t a backup', /isn’t used as a swap/.test(await why('custom')));
  check('a product for licensed pros isn’t a backup for an item that isn’t', /licensed pros/.test(await why('pro')) && (await why('pro', { ...line, prosOnly: true })) === 'ok');
  check('one with none free is out too', /out too/.test(await why('gone')));
  check('one the shop doesn’t sell online isn’t a backup', /isn’t for sale online/.test(await why('hidden')));
  check('the same item, or nothing, isn’t a backup', /different item/.test(await why('rose')) && /different item/.test(await why('')));
  check('one that doesn’t exist says so', /isn’t for sale any more/.test(await why('nope')));

  // ── Checkout ──
  const co = src('src/app/api/retail/checkout/route.ts');
  check('checkout takes each item’s choice, and checks a backup against the catalog before the order is made',
    /const ifOut = normaliseIfOut\(\(it as any\)\.ifOut\)/.test(co) && /const c = await swapCandidate\(db, tenantId, String\(want\.backupId\), line,/.test(co) && /backup: true \}, \{ status: 409 \}/.test(co));
  check('…stamps it on the line, and a product never swapped is marked so', /\(line as any\)\.ifOut = \{ how: 'backup', backupId: c\.item\.productId, backupName: c\.item\.name, backupPriceCents: c\.item\.unitPriceCents/.test(co) && /\(line as any\)\.noSwap = true/.test(co));
  check('…not for a download or a pre-order, and not when the shop asks once per order', /if \(item\.digital !== true && line\.preorder !== true\)/.test(co) && /if \(want && perItemOn\(rsEarly\)\)/.test(co));
  check('an item left as it is gets the shop’s choice; an old page’s “ask me first” too', /ifUnavailable: body\.ifUnavailable === 'refund' \|\| body\.ifUnavailable === 'similar' \? body\.ifUnavailable : swapDefault\(rsEarly\) === 'refund' \? 'refund' : 'similar'/.test(co));
  const bk = src('src/app/api/retail/backups/route.ts');
  check('the backups offered are the shop’s own matches, never dearer, without downloads, gift cards or pros-only items', /similarItems\(pool, \{ productId: variant \? variant\.id : listing\.id, unitPriceCents: priceCents/.test(bk) && /i\.digital !== true && i\.giftCard !== true/.test(bk) && /if \(noSwap\) return/.test(bk) && /if \(n > 40\)/.test(bk));
  check('a listing the shop never swaps covers its variants', /if \(v\.noSwap !== true && l\.noSwap === true\) out\.noSwap = true/.test(src('src/lib/variants.ts')));
  const page = src('src/app/shop/[tenantId]/checkout/page.tsx');
  check('checkout sends each item’s choice, a backup only once one is picked, and a refused backup goes back to the shop’s choice',
    /\.\.\.\(!wholesale && ifOutFor\(key\) \? \{ ifOut: ifOutFor\(key\) \} : \{\}\)/.test(page) && /perItem=\{shop\?\.swaps\?\.perItem !== false && !wholesale\}/.test(page) && /c\.how === 'backup' && !c\.backupId\)\) return undefined/.test(page) && /if \(data\.backup && data\.productId\) setIfOut/.test(page) && !/IF_UNAVAILABLE/.test(page));
  check('the shop’s settings reach checkout', /swaps: \{ perItem: rs\.swapPerItem !== false, default: rs\.swapDefault === 'refund' \? 'refund' : 'match' \}/.test(src('src/app/api/retail/catalog/route.ts')));
  const sec = src('src/components/shop/IfOutSection.tsx');
  check('the customer’s picker: best match, a backup (the same product first) or a refund, kept on this device if they like', /SWAP_HOWS\.map/.test(sec) && /Other colors of this one/.test(sec) && /Use this backup next time too/.test(sec) && /cfshop-backups-/.test(sec) && /try \{/.test(sec));
  const setup = src('src/components/orders/SetupScreen.tsx');
  check('Setup: per item, the shop’s choice, covering a pricier swap, and the products never swapped', /'retailSettings\.swapPerItem': !perItem/.test(setup) && /'retailSettings\.swapDefault': h/.test(setup) && /'retailSettings\.swapCoverMore': !cover/.test(setup) && /i\?\.noSwap === true/.test(setup) && /<SwapsGroup /.test(setup));
  check('the product’s Never swap switch is on its online listing', /onSave\(\{ noSwap: v \}\)/.test(src('src/components/inventory/NoSwapSection.tsx')) && /<NoSwapSection product=\{product\} onSave=\{onSave\} \/>/.test(src('src/components/inventory/OnlineListingTab.tsx')));
  // ── At packing: the customer's choice, never dearer, nobody asked ──
  const L = (x: any = {}) => ({ lineId: 'a', productId: 'rose', name: 'Gel color, Rosewood', unitPriceCents: 1200, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, status: 'pending', ...x });
  const fresh = async (line: any, extra: any = {}) => { await db.doc(`${T}/retailOrders/o1`).set({ stage: 'picking', orderNumber: 42, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', subtotalCents: 2400, taxCents: 198, ifUnavailable: 'refund', lines: [line], ...extra }); };
  const offer = (pid: string) => W.offerSwap(db, 't1', 'o1', 'a', pid, { id: 'u1', name: 'Sam' }, '') as any;
  const read = async () => (await db.doc(`${T}/retailOrders/o1`).get()).data();
  await fresh(L({ ifOut: { how: 'refund' } }));
  const r1 = await offer('blush');
  check('an item they asked to have refunded isn’t swapped', !r1.ok && /asked for a refund if this is out/.test(r1.message) && (await read()).lines.length === 1, r1);
  await fresh(L({ ifOut: { how: 'backup', backupId: 'blush', backupName: 'Gel color · Blush', backupPriceCents: 1200 } }));
  const r2 = await offer('fig');
  check('with a backup picked, only that backup goes in', !r2.ok && /picked Gel color · Blush at checkout/.test(r2.message), r2);
  const r3 = await offer('blush'); const o3 = await read();
  check('…their backup goes in straight away, as its own line to scan, nobody asked', r3.ok && !r3.asked && o3.lines.length === 2 && o3.lines[1].productId === 'blush' && o3.lines[1].qtyScanned === 0 && o3.lines[0].status === 'refunded' && !o3.swapOffer && /hears what changed when packing is done/.test(r3.message), { r3, o3 });
  await fresh(L({ ifOut: { how: 'match' } }));
  const r4 = await offer('fig');
  check('a best match dearer than what they paid is refused', !r4.ok && /costs more than what was paid/.test(r4.message), r4);
  await fresh(L(), { ifUnavailable: 'ask', customerPhone: '+15555550123' });
  const r5 = await offer('fig');
  check('an order from when they could ask to be asked: still never dearer', !r5.ok && /costs more than what was paid/.test(r5.message), r5);
  const r6 = await offer('blush');
  check('…and still asked about one that isn’t', r6.ok && r6.asked === true && (await read()).swapOffer?.status === 'waiting', r6);

  // ── What changed, told once ──
  const PC = await import('../../src/lib/pack-changes');
  const packed = { subtotalCents: 4700, taxCents: 388, pendingRefundCents: 0, lines: [
    { lineId: 'r', productId: 'rose', name: 'Gel color, Rosewood', unitPriceCents: 1200, qtyOrdered: 2, qtyShorted: 2, status: 'refunded', shortReason: 'Swapped', swappedToLineId: 'b', ifOut: { how: 'backup', backupId: 'blush' } },
    { lineId: 'o', productId: 'almond', name: 'Cuticle oil, Almond', unitPriceCents: 900, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'Swapped', swappedToLineId: 'l' },
    { lineId: 't', productId: 'top', name: 'Top coat', unitPriceCents: 1400, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'Not on the shelf' },
    { lineId: 'f', productId: 'file', name: 'Nail file', unitPriceCents: 500, qtyOrdered: 1, qtyShorted: 1, status: 'backordered' },
    { lineId: 'b', productId: 'blush', name: 'Gel color · Blush', unitPriceCents: 1200, qtyOrdered: 2, qtyShorted: 0, status: 'picked', swapForLineId: 'r' },
    { lineId: 'l', productId: 'lav', name: 'Cuticle oil, Lavender', unitPriceCents: 800, qtyOrdered: 1, qtyShorted: 0, status: 'picked', swapForLineId: 'o' },
  ] };
  const cs = PC.packChanges(packed);
  check('each change once: their backup, a cheaper best match, a refund, one coming later', cs.map((c) => c.kind).join() === 'swap,swap,refund,later' && (cs[0] as any).backup === true && (cs[1] as any).backup === false && (cs[1] as any).lessCents === 108 && (cs[2] as any).cents === 1516, cs);
  const note = PC.changesNote(packed);
  check('…in the customer’s words, with one refund and when it shows', /^4 items were out:/.test(note.short) && /Gel color, Rosewood: your backup, Gel color · Blush\./.test(note.short) && /Lavender, \$1\.08 less\./.test(note.short) && /Top coat: refunded\./.test(note.short) && /Nail file: on its way on its own/.test(note.short) && /\$16\.24 is on its way back to your card in one refund\. It shows in 5 to 10 business days\./.test(note.short), note.short);
  check('…a refund still waiting for the shop says so', /once the shop sends it/.test(PC.changesNote({ ...packed, pendingRefundCents: 1624 }).short) && PC.changesNote({ lines: [L()] }).short === '');
  const ful = src('src/app/api/retail/fulfil/route.ts');
  check('a missing item isn’t told on its own while packing', /short: \(\) => \{\},/.test(ful) && !/sendMessage\('order_short'/.test(ful));
  check('packing done: one refund (within the shop’s automatic amount), and one message for a shipped or delivered order', /if \(\(Number\(po\.pendingRefundCents\) \|\| 0\) > 0\) await autoRefund\(db, tenantId, orderId, ctx\(\)\?\.base \|\| ''\)/.test(ful) && /if \(\(po\.method === 'ship' \|\| po\.method === 'delivery'\) && packChanges\(po\)\.length\) sendMessage\('order_changes', \{ orderId, key: changesKey\(packChanges\(po\)\) \}\)/.test(ful));
  check('…an order collected hears it in its ready message, by text or curbside', /const changed = changesNote\(o\);/.test(src('src/app/api/retail/ready-notify/route.ts')) && /const changed = forChanges \? changesNote\(forChanges\)\.short : '';/.test(src('src/app/api/retail/curbside-notify/route.ts')));
  const cn = src('src/app/api/retail/changes-notify/route.ts');
  check('the message on its own is sent once, says nothing when nothing changed, and is queued to try again', /tx\.set\(marker,/.test(cn) && /skipped: 'nothing_changed'/.test(cn) && /order_changes: \{ path: '\/api\/retail\/changes-notify'/.test(src('src/lib/order-outbox.ts')) && /case 'order_changes'/.test(src('src/lib/order-inbox.ts')));
  const ms = src('src/components/orders/MissingSheet.tsx');
  check('the packer sees what they chose: their backup first, the best matches never dearer, no swap for a refund, no refund sent mid-pack',
    /const pref = lineIfOut\(order, line\)/.test(ms) && /if \(pref\.how === 'refund'\) return \[\];/.test(ms) && /return similarItems\(soldAs\(inventory\), line, 6, rs\)/.test(ms) && !/\/api\/retail\/refund/.test(ms) && !/ask: askFirst/.test(ms));
  check('the customer’s order page shows what changed', /const note = changesNote\(order, /.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')));

  // ── After the review ──
  const inh = (io: any) => (S.swapLines({ subtotalCents: 2400, taxCents: 0, lines: [L({ ifOut: io })] }, 'a', { productId: 'blush', name: 'Blush', unitPriceCents: 1200 }, 'n') as any).newLine.ifOut;
  check('a replacement keeps to what they chose: their backup missing too is refunded, a best match may be matched again', inh({ how: 'backup', backupId: 'blush' })?.how === 'refund' && inh({ how: 'match' })?.how === 'match' && inh(undefined) === undefined);
  await fresh(L({ ifOut: { how: 'match' } }));
  const r7 = await W.offerSwap(db, 't1', 'o1', 'a', 'blush', { id: 'u1', name: 'Sam' }, '', true) as any;
  check('asking can’t be forced on an order whose customer chose at checkout', r7.ok && !r7.asked && !(await read()).swapOffer, r7);
  await db.collection(`${T}/inventory`).doc('blush').set({ name: 'Gel color, Blush', type: 'retail', status: 'active', parentId: 'gel', msrp: 12, totalStock: 0 });
  await fresh(L({ ifOut: { how: 'backup', backupId: 'blush', backupName: 'Gel color · Blush', backupPriceCents: 1200 } }));
  const r8 = await offer('blush');
  check('their backup out too tells the packer to refund it, as they chose', !r8.ok && /backup can’t go in: That backup is out too\. Refund it, as they chose\./.test(r8.message), r8);
  check('a listing that sells as its variants, or a non-shop product, is never a backup', /Pick one color or size/.test(await why('gel')));
  check('a refund the customer was told about at the time (an old ask-first order) isn’t told again', PC.packChanges({ lines: [{ lineId: 'x', name: 'Polish', unitPriceCents: 900, qtyOrdered: 1, qtyShorted: 1, status: 'refunded', shortReason: 'No answer about a swap' }] }).length === 0);
  check('a curbside customer already outside hears what changed on its own', /else if \(r\.autoArrived && packChanges\(o\)\.length\) sendMessage\('order_changes', \{ orderId: id, key: changesKey\(packChanges\(o\)\) \}\)/.test(ful));
  check('the message is queued before the refund call, so a slow refund can’t lose it', ful.indexOf("packChanges(po).length) sendMessage('order_changes'") > 0 && ful.indexOf("packChanges(po).length) sendMessage('order_changes'") < ful.indexOf('if ((Number(po.pendingRefundCents) || 0) > 0) await autoRefund('));
  check('the order page gives the refund’s timing only while it’s news', /money: !closedOut && Date\.now\(\) - when < 14 \* 86400e3/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')) && PC.changesNote(packed, { money: false }).lines.every((x) => !/refund\./.test(x) || /refunded\./.test(x)));

  for (const [name, text] of [['picker', sec], ['never-swap switch', src('src/components/inventory/NoSwapSection.tsx')], ['backups route', bk], ['missing sheet', ms], ['changes wording', src('src/lib/pack-changes.ts')], ['changes message', cn]] as [string, string][]) {
    check(`the ${name} has no all-caps, no heavy weight, no business words and the real apostrophe`, !/\buppercase\b|font-black/.test(text) && !/\b(studio|salon|stylist|booth|chair)\b/i.test(text.replace(/\/\/.*$/gm, ''))
      && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
