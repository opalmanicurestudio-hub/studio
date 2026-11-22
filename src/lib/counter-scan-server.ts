// src/lib/counter-scan-server.ts — A BARCODE SCANNED AT THE COUNTER OR THE WINDOW (server; design board "Register tools",
// part 3). Any scanner that types (lib/use-wedge-scanner) sends the code; it's the menu item whose code it is (lib/
// code-index: the one index of every code), added to the order being taken like a tap on its tile. A case's code adds
// as many as are in it. An item with choices to pick opens its choices on the screen instead; a code on no item yet can
// be put on one (a manager's: lib/code-index learnCode), and it scans everywhere from then on.
import { readCode, codeDocId } from '@/lib/code-form';
import { ensureCodeIndex, entryOwners, learnCode, indexCol } from '@/lib/code-index';
import { editOrder } from '@/lib/counter-server';
import { menuItemOf } from '@/lib/menu-server';

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
  const f = await itemForCode(db, tenantId, raw); if (!f.ok) return f;
  // (An item with choices to pick: its choices open on the screen, as a tap on its tile does.)
  const m = menuItemOf(f.itemId, f.item);
  if (m.choices.length) return fail(`Pick ${m.name}’s choices.`, 409, 'choices', { itemId: f.itemId, name: m.name });
  // (A case of more than one line takes: added by hand, never short.)
  if (f.pack > 20) return fail(`That code is a case of ${f.pack}, more than one line takes. Add them from the menu instead.`, 409, 'case');
  const r: any = await editOrder(db, tenantId, tenant, orderId, { action: 'add', itemId: f.itemId, quantity: f.pack, tapKey: String(tapKey) } as any);
  if (r.error) return fail(r.error, r.status || 409, 'add');
  return { ok: true as const, order: r.order, line: r.line || null, name: m.name, pack: f.pack };
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
