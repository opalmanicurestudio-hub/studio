// src/lib/app-orders.ts — DELIVERY APP ORDERS, KEYED IN AT THE COUNTER (pure; design board "Delivery app orders").
// An order that comes in on a delivery app (DoorDash, Uber Eats, Grubhub, or another the business names) is rung in at
// the counter from the same menu (lib/app-orders-server), with the app's order code:
// - The kitchen gets it to go, ready for when the courier is due, named by the app and its code ("DoorDash 4F2A"), with
//   the next free spot on the pickup shelf. The same code from the same app can't go in twice in a day.
// - The ready board (lib/ready-board) shows the app, the code and the spot, so a courier finds it themselves.
// - Picked up by the courier: in the books then, as that app's sale. No sales tax is added (the app collects and pays
//   it), and nothing goes in the cash drawer; the app pays the business later, less its fees.
// - Cancelled on the app: taken off, what the kitchen hadn't started put back (lib/counter-server voidOrder), nothing in
//   the books. Anyone at the counter while the kitchen hasn't started on it; once it has, a manager okays it, as any void.
// - A courier who doesn't come: the counter shows it late, and the managers hear the night after (lib/app-orders-server
//   appNightly), so each one ends as picked up or cancelled.
//   tenants/{t}.appOrders = { on, apps: ('doordash' | 'ubereats' | 'grubhub' | 'other')[], otherName?, shelves }
//   tenants/{t}/counterOrders/{id}.app = { state: 'taking' | 'sending' | 'waiting' | 'picked' | 'cancelled', app, label,
//     code, shelf, courierAt, sentBy, claimId, pickedAt?, cancelledAt?, toldAt? }
//   tenants/{t}/private/appCode_{day}_{app}_{code} = { orderId, number, appCodeDay } (the same code once a day; read and
//     written only by the server, and cleared after a few days)

export const APPS = [
  { code: 'doordash', label: 'DoorDash' },
  { code: 'ubereats', label: 'Uber Eats' },
  { code: 'grubhub', label: 'Grubhub' },
] as const;
export type AppCode = 'doordash' | 'ubereats' | 'grubhub' | 'other';
export const SHELF_CHOICES = [4, 8, 12, 16] as const;
export const DEFAULT_SHELVES = 8;
/** When the courier gets here, as the counter picks it: now, or in this many minutes. */
export const COURIER_IN = [0, 10, 20, 30] as const;

/** A name the business typed for another app: tidied, short. */
export const cleanAppName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);

/** The business's delivery apps: on, which ones (by name, in order), and how many spots its pickup shelf has. */
export function appOrdersOf(tenant: any): { on: boolean; apps: { code: AppCode; label: string }[]; shelves: number } {
  const a = tenant?.appOrders || {};
  const picked: string[] = Array.isArray(a.apps) ? a.apps.map(String) : [];
  const other = cleanAppName(a.otherName);
  const apps: { code: AppCode; label: string }[] = [
    ...APPS.filter((x) => picked.includes(x.code)).map((x) => ({ code: x.code as AppCode, label: x.label })),
    ...(picked.includes('other') && other ? [{ code: 'other' as AppCode, label: other }] : []),
  ];
  const n = Number(a.shelves);
  return { on: a.on === true && apps.length > 0, apps, shelves: (SHELF_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_SHELVES };
}

/** An app's order code as the counter typed it: letters, numbers and dashes, upper case, 2 to 12 long; null otherwise. */
export function cleanAppCode(v: unknown): string | null {
  const c = String(v ?? '').replace(/\s+/g, '').replace(/^#/, '').toUpperCase();
  return /^[A-Z0-9-]{2,12}$/.test(c) ? c : null;
}

/** The pickup shelf's spots: A1, A2, … */
export const shelfName = (i: number) => `A${i + 1}`;
/** The next free spot on the shelf (null when every spot has an order on it: it waits at the counter). */
export function freeShelf(taken: (string | null | undefined)[], shelves: number): string | null {
  const used = new Set(taken.filter(Boolean));
  for (let i = 0; i < shelves; i++) if (!used.has(shelfName(i))) return shelfName(i);
  return null;
}

/** When the courier is due, from what the counter picked (now or in some minutes). Null: not one of the choices. */
export function courierDue(nowMs: number, inMin: unknown): string | null {
  const m = Number(inMin);
  return (COURIER_IN as readonly number[]).includes(m) ? new Date(nowMs + m * 60000).toISOString() : null;
}

/** Minutes after the courier was due before the counter shows them late. */
export const COURIER_LATE_MIN = 30;
/** How late the courier is, in whole minutes (0 when they aren't late yet, or there's no time). */
export function courierLate(courierAt: unknown, nowMs: number): number {
  const due = Date.parse(String(courierAt || ''));
  if (!Number.isFinite(due)) return 0;
  const m = Math.floor((nowMs - due) / 60000);
  return m >= COURIER_LATE_MIN ? m : 0;
}
/** The id of a code's claim for the day (tenants/{t}/private/{id}). */
export const appClaimId = (day: string, app: string, code: string) => `appCode_${day}_${app}_${code}`;

/** How an app order is named on the kitchen screen, the counter and the ready board: "DoorDash 4F2A". */
export const appName = (a: { label?: string; code?: string } | null | undefined) => [a?.label, a?.code].filter(Boolean).join(' ');
