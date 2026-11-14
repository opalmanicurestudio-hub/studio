// src/lib/popup.ts — A POP-UP TABLE: a day selling somewhere else (a market stall, a fair, a show), with the stock
// brought along. The team sets it up (popup screen, api/retail/popup): its name and place, the day, and how many of each
// product came. On the day the register sells from it (the front desk opened for the pop-up: api/checkout/complete
// counts each sale against it), and when the team turns on orders from the line, customers in the line scan the sign on
// the table, order and pay on their phone (shop/[tenantId]/popup/[popupId], the shop's own checkout), and get a number
// the team calls when it's bagged. What's left of each product is what came, less what the table sold and what the
// line ordered (paid, or being paid now).
//   tenants/{t}/popups/{id}: { id, name, place, day, status: 'open'|'closed', lineOrders, items: [{ id, qty }],
//     soldAtTable: { [productId]: n }, nextNumber, createdAt, updatedAt, closedAt? }
//   One open pop-up a day: the register and the sign each know which one they're for, and the register shows what's left
//   on each product's tile. A sale voided at the register goes back into the table's count (api/checkout/void); a
//   return made later doesn't: change how many came to put it back.
// Read and written only through the server (firestore.rules keeps it off the team's catch-all).
export type PopupItem = { id: string; qty: number };
export type Popup = {
  id: string; name: string; place: string; day: string; status: 'open' | 'closed'; lineOrders: boolean;
  items: PopupItem[]; soldAtTable: Record<string, number>; nextNumber: number;
  createdAt: string; updatedAt: string; closedAt?: string | null;
};

export const POPUP_MAX_ITEMS = 120;
export const POPUP_MAX_QTY = 9999;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const popupsOf = (db: any, t: string) => db.collection(`tenants/${t}/popups`);
/** An order unpaid this long no longer holds stock at the table (its payment page has long closed). */
export const HOLD_MS = 30 * 60_000;

/** What the team sends to set one up or change it, checked: the problem in words, or the fields to keep. */
export function checkPopupForm(b: any): { ok: true; fields: { name: string; place: string; day: string; items: PopupItem[] } } | { ok: false; message: string } {
  const name = s(b?.name, 60); const place = s(b?.place, 80); const day = String(b?.day || '').trim();
  if (!name) return { ok: false, message: 'Name the pop-up, like Saturday market.' };
  if (!DAY.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) return { ok: false, message: 'Pick the day.' };
  const raw = Array.isArray(b?.items) ? b.items.slice(0, 400) : [];
  const seen = new Set<string>(); const items: PopupItem[] = [];
  for (const x of raw) {
    const id = String(x?.id || '').trim(); const qty = Math.floor(Number(x?.qty));
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || seen.has(id) || !Number.isFinite(qty) || qty < 0) continue;
    seen.add(id); items.push({ id, qty: Math.min(POPUP_MAX_QTY, qty) });
  }
  if (items.length > POPUP_MAX_ITEMS) return { ok: false, message: `Up to ${POPUP_MAX_ITEMS} products at one pop-up.` };
  return { ok: true, fields: { name, place, day, items } };
}

/** Open for selling today (on the business's calendar). */
export const popupToday = (p: any, today: string) => !!p && p.status === 'open' && p.day === today;
/** Taking orders from the line right now. */
export const takingLineOrders = (p: any, today: string) => popupToday(p, today) && p.lineOrders === true;

/** How many of each product the line has ordered: paid ones, and ones being paid for now (not past HOLD_MS). */
export function lineOrdered(orders: any[], now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of orders || []) {
    const st = String(o?.stage || '');
    if (st === 'cancelled') continue;
    // (An order is stamped when it's placed: placedAt, the way checkout writes it.)
    if (st === 'placed' && !(Date.parse(String(o.placedAt || o.createdAt || '')) > now - HOLD_MS)) continue;
    for (const l of o.lines || []) {
      if (['refunded', 'cancelled'].includes(String(l?.status))) continue;
      const id = String(l?.productId || ''); const q = Math.max(0, Number(l?.qtyOrdered) || 0);
      if (id && q) out[id] = (out[id] || 0) + q;
    }
  }
  return out;
}

/** What's left of each product at the table: what came, less what the table sold and the line ordered. */
export function leftAt(p: any, line: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of (p?.items || []) as PopupItem[]) {
    out[it.id] = Math.max(0, (Number(it.qty) || 0) - (Number(p?.soldAtTable?.[it.id]) || 0) - (Number(line?.[it.id]) || 0));
  }
  return out;
}

/** The number a line order is called by: "No. 12". */
export const callWords = (n: any) => (Number(n) > 0 ? `No. ${Number(n)}` : '');
