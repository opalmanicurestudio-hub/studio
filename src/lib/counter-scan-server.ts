// src/lib/counter-scan-server.ts — A BARCODE SCANNED AT THE COUNTER OR THE WINDOW (server; design board "Register tools",
// part 3). Any scanner that types (lib/use-wedge-scanner) sends the code; it's the menu item whose code it is (lib/
// code-index: the one index of every code), added to the order being taken like a tap on its tile. A case's code adds
// as many as are in it. An item with choices to pick opens its choices on the screen instead; a code on no item yet can
// be put on one (a manager's: lib/code-index learnCode), and it scans everywhere from then on. A scale's sticker on a bag
// weighed ahead (lib/scale-label), when the business uses them and the code isn't one already on an item, is the item
// with that number on the scale, at the weight or the price printed.
import { readCode, codeDocId } from '@/lib/code-form';
import { ensureCodeIndex, entryOwners, learnCode, indexCol } from '@/lib/code-index';
import { editOrder } from '@/lib/counter-server';
import { menuItemOf } from '@/lib/menu-server';
import { readScaleLabel, scaleSetOf, type ScaleRead } from '@/lib/scale-label';
import { byWeightOf, cleanWeight, convertWeight } from '@/lib/menu-weight';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number; code?: string; [k: string]: any };
const fail = (error: string, status: number, code?: string, more: Record<string, any> = {}): Fail => ({ ok: false, error, status, ...(code ? { code } : {}), ...more });

/** The menu item a scanned code is (and how many a scan of it is: a case's code is its case). */
export async function itemForCode(db: any, tenantId: string, raw: unknown): Promise<{ ok: true; itemId: string; item: any; pack: number } | Fail> {
  const r = readCode(String(raw ?? '').slice(0, 200));
  if (r.kind === 'empty') return fail('That scan was empty. Scan it again.', 400, 'empty');
  const T = `tenants/${tenantId}`;
  let ids: string[] = []; let pack = 1; let shown = '';
  if (r.kind === 'product') ids = [r.productId];
  else {
    shown = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 64);
    await ensureCodeIndex(db, tenantId).catch(() => null);
    const e: any = (await db.doc(`${indexCol(tenantId)}/${codeDocId(r.code)}`).get()).data();
    ids = e ? entryOwners(e) : [];
    pack = Math.max(1, Math.floor(Number(e?.pack) || 1));
  }
  if (!ids.length) return fail(`${shown || 'That code'} isn’t on anything yet.`, 404, 'unknown', { scanned: shown });
  const docs = await Promise.all(ids.filter((id) => ID.test(id)).slice(0, 5).map(async (id) => ({ id, d: (await db.doc(`${T}/inventory/${id}`).get()).data() })));
  const menu = docs.filter((x) => x.d && x.d.type === 'refreshment' && x.d.archived !== true && x.d.isActive !== false);
  if (!menu.length) return fail(`${docs[0]?.d?.name ? `${docs[0].d.name} isn’t` : 'That isn’t'} on the menu here.`, 409, 'not_menu');
  if (menu.length > 1) return fail(`That code is on ${menu.map((x) => x.d.name).slice(0, 3).join(' and ')}. Keep it on one of them under Inventory, then scan again.`, 409, 'many');
  return { ok: true, itemId: menu[0].id, item: menu[0].d, pack };
}

/** Scanned onto the order being taken: added like a tap (`tapKey`: once, however often it's sent). */
export async function scanToOrder(db: any, tenantId: string, tenant: any, orderId: string, raw: unknown, tapKey: unknown) {
  if (!ID.test(orderId)) return fail('Tap Next guest first, then scan.', 400, 'no_order');
  // (Every scan carries its own key, so one sent twice is added once.)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(tapKey || ''))) return fail('Scan it again.', 400, 'key');
  const f = await itemForCode(db, tenantId, raw);
  if (!f.ok) {
    // (Not a code on any item: a scale's sticker, when the business uses them.)
    const read = f.code === 'unknown' ? readScaleLabel(raw, scaleSetOf(tenant)) : null;
    return read ? scaleToOrder(db, tenantId, tenant, orderId, read, String(tapKey), f) : f;
  }
  // (An item with choices to pick: its choices open on the screen, as a tap on its tile does.)
  const m = menuItemOf(f.itemId, f.item);
  // (Sold by weight: the screen asks what the scale reads, lib/menu-weight.)
  if (m.byWeight) return fail(`Weigh ${m.name}.`, 409, 'weigh', { itemId: f.itemId, name: m.name });
  if (m.choices.length) return fail(`Pick ${m.name}’s choices.`, 409, 'choices', { itemId: f.itemId, name: m.name });
  // (A case of more than one line takes: added by hand, never short.)
  if (f.pack > 20) return fail(`That code is a case of ${f.pack}, more than one line takes. Add them from the menu instead.`, 409, 'case');
  const r: any = await editOrder(db, tenantId, tenant, orderId, { action: 'add', itemId: f.itemId, quantity: f.pack, tapKey: String(tapKey) } as any);
  if (r.error) return fail(r.error, r.status || 409, 'add');
  return { ok: true as const, order: r.order, line: r.line || null, name: m.name, pack: f.pack };
}

/** A scale's sticker onto the order: the menu item with that number on the scale (sold by weight), at the weight printed
 *  (priced from the menu) or at the price printed (its weight worked out from the menu's price, for stock). */
async function scaleToOrder(db: any, tenantId: string, tenant: any, orderId: string, read: ScaleRead, tapKey: string, unknown: Fail) {
  const T = `tenants/${tenantId}`;
  const snap = await db.collection(`${T}/inventory`).where('scaleNo', '==', read.itemNo).limit(20).get();
  const items = snap.docs.map((d: any) => ({ id: d.id, d: d.data() || {} })).filter((x: any) => ID.test(x.id) && x.d.type === 'refreshment' && x.d.archived !== true && x.d.isActive !== false);
  // (No item has that number: it may be any code that starts with a 2, so it's a code on nothing yet, as before, which
  // the screen offers to put on an item; it also says which scale number it would be.)
  if (!items.length) return { ...unknown, scaleNo: read.itemNo };
  if (items.length > 1) return fail(`Scale number ${read.itemNo} is on ${items.slice(0, 3).map((x: any) => String(x.d.name || 'an item')).join(' and ')}. Keep it on one of them on the Menu page.`, 409, 'many');
  const it = items[0]; const name = String(it.d.name || 'That item'); const unit = byWeightOf(it.d);
  if (!unit) return fail(`${name} isn’t sold by weight, so its scale label can’t ring it in. Add it from the menu.`, 409, 'not_weighed');
  let weight: number | null;
  if ('weight' in read) weight = cleanWeight(convertWeight(read.weight, read.unit, unit), unit);
  else {
    const per = Number(it.d.price);
    if (!(per > 0)) return fail(`${name} has no price on the menu yet.`, 409, 'no_price');
    // (Its weight for stock, from the menu's price; at least the least a weighing is.)
    const raw = read.cents / 100 / per; const step = unit === 'g' ? 1 : unit === 'kg' ? 0.001 : 0.01;
    weight = cleanWeight(Math.max(step, raw), unit);
  }
  if (weight === null) return fail('That label’s weight didn’t read right. Weigh it at the counter instead.', 400, 'scale_weight');
  const r: any = await editOrder(db, tenantId, tenant, orderId, { action: 'add', itemId: it.id, quantity: 1, weight, tapKey,
    label: 'cents' in read ? { kind: 'price', code: read.code, cents: read.cents } : { kind: 'weight', code: read.code } } as any);
  if (r.error) return fail(r.error, r.status || 409, 'add');
  return { ok: true as const, order: r.order, line: r.line || null, name: String(r.line?.name || name), pack: 1, label: true };
}

/** A code on no item yet, put on a menu item (a manager's: the route checks), then added. */
export async function codeOnItem(db: any, tenantId: string, tenant: any, orderId: string, raw: unknown, itemId: string, by: string, tapKey: unknown) {
  if (!ID.test(itemId)) return fail('Which item?', 400);
  const it: any = (await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get()).data();
  if (!it || it.type !== 'refreshment') return fail('Pick an item on the menu.', 409);
  const l = await learnCode(db, tenantId, itemId, String(raw ?? '').slice(0, 64), by);
  if (!l.ok) return fail(l.message, l.status || 409, 'learn');
  const said = `${String(raw ?? '').replace(/\s+/g, '').slice(-4)}`;
  if (!ID.test(orderId)) return { ok: true as const, learned: l.message, order: null, item: String(it.name || 'an item'), codeEnd: said };
  const s: any = await scanToOrder(db, tenantId, tenant, orderId, raw, tapKey);
  return s.ok ? { ...s, learned: l.message, item: String(it.name || 'an item'), codeEnd: said } : { ok: true as const, learned: l.message, order: null, after: s.error, item: String(it.name || 'an item'), codeEnd: said };
}
