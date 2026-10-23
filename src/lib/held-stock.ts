// src/lib/held-stock.ts — UNITS HELD FOR PAID ONLINE ORDERS, AT THE DESK (pure; the desk screen and the server both
// use it). An online order that's paid holds its units (stockReserved) until it's packed. The desk can sell what's on
// the shelf beyond those; selling into them would leave a paid order short, so it takes a manager: signed in, or their
// PIN at the desk (an approval of kind 'held_stock', checked again by api/checkout/complete).
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type HeldShort = { id: string; name: string; want: number; free: number; held: number };

/** Units the shop can sell without touching what's held for online orders. */
export const freeUnits = (p: any) => Math.max(0, n(p?.totalStock) - Math.max(0, n(p?.stockReserved)));

/** Products in the sale that would dip into units held for online orders. */
export function heldShortfall(items: any[], inventory: any[]): HeldShort[] {
  const want = new Map<string, number>();
  for (const it of items || []) {
    const type = String(it?.type || 'product');
    if (type !== 'product' && type !== 'retail') continue;
    const id = String(it?.id || ''); if (!id) continue;
    want.set(id, (want.get(id) || 0) + Math.max(1, Math.round(n(it?.quantity) || 1)));
  }
  const out: HeldShort[] = [];
  for (const [id, q] of want) {
    const p = (inventory || []).find((x: any) => String(x?.id) === id);
    const held = Math.max(0, Math.round(n(p?.stockReserved)));
    if (!p || held <= 0) continue;
    const free = freeUnits(p);
    if (q > free) out.push({ id, name: String(p.name || 'An item'), want: q, free, held });
  }
  return out;
}

/** "Hand cream: 1 of the 3 on the shelf isn't held" — for the desk and the refusal. */
export function heldLine(h: HeldShort): string {
  return h.free > 0
    ? `${h.name}: only ${h.free} ${h.free === 1 ? 'isn’t' : 'aren’t'} held for paid online orders (${h.held} ${h.held === 1 ? 'is' : 'are'})`
    : `${h.name}: every one on the shelf is held for paid online orders`;
}
