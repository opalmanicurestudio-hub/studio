// src/lib/activity.ts — ACTIVITY: EVERYTHING THAT MOVED MONEY (pure; design boards "Who can do what" and "Activity";
// lib/activity-server writes it, the Activity page reads it). Each refund, void, item on the house, different price,
// discount, drawer opened with no sale, cash in or out, staff meal and refund the app sent on its own is one line in
// the business's audit log (tenants/{t}/auditLogs, append-only: lib/audit), with what kind it is, how much, where, who
// did it, who okayed it, why, and, when it's worth a second look, why that is.
// Lines written before these fields existed are read by their action's name, so the whole history shows.

export type ActivityKind = 'refund' | 'void' | 'comp' | 'price' | 'discount' | 'drawer' | 'cash' | 'staffMeal' | 'pin' | 'rules';
export type ActivityWhere = 'counter' | 'window' | 'desk' | 'online' | 'app';
export type ActivityWho = { id: string | null; name: string };

export const ACTIVITY_KINDS: { id: ActivityKind; label: string; one: string; many: string }[] = [
  { id: 'refund', label: 'Refunds', one: 'refund', many: 'refunds' },
  { id: 'void', label: 'Voids', one: 'void', many: 'voids' },
  { id: 'comp', label: 'On the house', one: 'on the house', many: 'on the house' },
  { id: 'price', label: 'Prices', one: 'different price', many: 'different prices' },
  { id: 'discount', label: 'Discounts', one: 'discount', many: 'discounts' },
  { id: 'drawer', label: 'Drawer', one: 'drawer opened, no sale', many: 'drawer opened, no sale' },
  { id: 'cash', label: 'Cash in and out', one: 'cash in or out', many: 'cash in or out' },
  { id: 'staffMeal', label: 'Staff meals', one: 'staff meal', many: 'staff meals' },
  { id: 'pin', label: 'PINs', one: 'wrong PINs', many: 'wrong PINs' },
  { id: 'rules', label: 'Rule changes', one: 'rule change', many: 'rule changes' },
];
const KINDS = new Set<string>(ACTIVITY_KINDS.map((k) => k.id));

/** Lines from before (and from parts of the app that write only an action's name): what kind each is. */
const BY_ACTION: Record<string, ActivityKind> = {
  'counter.refund': 'refund', 'counter.partBack': 'refund', 'counter.delivery_refunded': 'refund', 'checkout.extra_refunded': 'refund',
  'retail.refund': 'refund', 'money.refund': 'refund',
  'counter.void': 'void', 'counter.takeOff': 'void', 'checkout.voided': 'void',
  'counter.comp': 'comp', 'counter.uncomp': 'comp', 'checkout.fees_waived': 'comp',
  'counter.price': 'price', 'counter.priceBack': 'price',
  'counter.discount': 'discount',
  'counter.no_sale': 'drawer',
  'counter.drawer_in': 'cash', 'counter.drawer_out': 'cash', 'counter.drawer_safe': 'cash', 'counter.drawer_undo': 'cash',
  'counter.staff_meal': 'staffMeal',
  'counter.pin_lockout': 'pin',
  'rule.money': 'rules',
};

/** What kind of money moment an audit line is (null: not one the Activity page shows). */
export function kindOf(e: any): ActivityKind | null {
  if (e && KINDS.has(String(e.kind))) return e.kind as ActivityKind;
  return BY_ACTION[String(e?.action || '')] || null;
}

export type ActivityLine = { id: string; at: string; kind: ActivityKind; action: string; cents: number | null; where: ActivityWhere | null; by: string | null; okBy: string | null;
  reason: string | null; ref: string | null; summary: string; auto: boolean; flag: string | null };

const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : null);
const WHERE = new Set(['counter', 'window', 'desk', 'online', 'app']);

/** An audit line as the Activity page shows it, or null when it isn't a money moment. */
export function activityLine(id: string, e: any): ActivityLine | null {
  const kind = kindOf(e); if (!kind) return null;
  const cents = Number.isFinite(Number(e?.cents)) ? Math.round(Number(e.cents)) : Number.isFinite(Number(e?.amount)) && e?.amount !== null && e?.amount !== undefined ? Math.round(Number(e.amount) * 100) : null;
  const auto = e?.actor?.type === 'system' || e?.auto === true;
  return {
    id: String(id), at: String(e?.at || ''), kind, action: String(e?.action || '').slice(0, 60), cents, where: WHERE.has(String(e?.where)) ? e.where : null,
    by: auto ? null : s(e?.by?.name, 60) || s(e?.actor?.name, 60), okBy: s(e?.okBy?.name, 60), reason: s(e?.reason, 120), ref: s(e?.ref, 40),
    summary: s(e?.summary, 300) || '', auto, flag: s(e?.flag, 120),
  };
}

/** Today's totals by kind: how many, and how much. */
export function totalsOf(lines: ActivityLine[]): Record<ActivityKind, { n: number; cents: number }> {
  const out = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k.id, { n: 0, cents: 0 }])) as Record<ActivityKind, { n: number; cents: number }>;
  for (const l of lines) { const t = out[l.kind]; t.n += 1; t.cents += Math.max(0, l.cents || 0); }
  return out;
}

/** How often the same person may open the drawer with no sale before it's worth a look: twice within this long. */
export const NO_SALE_WINDOW_MS = 30 * 60000;
/** A refund this big or bigger is worth a look unless the owner sets their own amount (lib/money-rules alerts). */
export const BIG_REFUND_CENTS = 5000;

/** Why a new line is worth a second look, from what's known as it's written (null: it isn't). */
export function flagFor(e: { kind: ActivityKind; cents?: number | null; afterKitchen?: boolean; noSalesBefore?: number; bigRefundCents?: number | null; toCash?: boolean; sameAsPaid?: boolean }): string | null {
  if (e.kind === 'void' && e.afterKitchen) return 'After the kitchen started';
  if (e.kind === 'drawer' && (e.noSalesBefore || 0) >= 1) return `Drawer opened with no sale ${(e.noSalesBefore || 0) + 1} times in 30 minutes`;
  if (e.kind === 'refund' && e.toCash && e.sameAsPaid) return 'Refunded in cash by the person who took the payment';
  const big = e.bigRefundCents === null ? null : Math.max(100, Math.round(Number(e.bigRefundCents ?? BIG_REFUND_CENTS)));
  if (e.kind === 'refund' && big !== null && (e.cents || 0) >= big) return `A refund of $${(big / 100).toFixed(0)} or more`;
  if (e.kind === 'pin') return 'Too many wrong PINs';
  return null;
}

/** One line of the Activity page: "Refund, C18 Jordan", "Drawer opened, no sale". */
/** Cash in or out, by what it was. */
const NAMED: Record<string, string> = { 'rule.money': 'Who can do what changed' };
const CASH: Record<string, string> = { 'counter.drawer_in': 'Cash in', 'counter.drawer_out': 'Paid out', 'counter.drawer_safe': 'Cash to the safe', 'counter.drawer_undo': 'Cash move undone' };
export function lineTitle(l: ActivityLine): string {
  const k = ACTIVITY_KINDS.find((x) => x.id === l.kind)!;
  const head = l.auto ? `Automatic ${k.one}` : NAMED[l.action] || CASH[l.action] || (l.action === 'counter.uncomp' ? 'Charged again' : l.action === 'counter.price_back' ? 'Menu price again' : k.one.charAt(0).toUpperCase() + k.one.slice(1));
  return l.ref ? `${head}, ${l.ref}` : head;
}
/** Who did it and why: "Ana, okayed by Mo: Wrong order". */
export function lineWho(l: ActivityLine): string {
  const who = l.auto ? 'On its own' : l.by || 'Someone';
  const ok = l.okBy && l.okBy !== l.by ? `, okayed by ${l.okBy}` : '';
  return `${who}${ok}${l.reason ? `: ${l.reason}` : ''}`;
}

/** How the owner hears that something is worth a look: their phone buzzes, it waits in the app, or not at all. */
export type TellMode = 'push' | 'app' | 'off';
export const TELL_MODES: { id: TellMode; label: string }[] = [{ id: 'push', label: 'Buzz my phone' }, { id: 'app', label: 'In the app' }, { id: 'off', label: 'Not at all' }];
export const tellModeOf = (tenant: any): TellMode => { const v = tenant?.moneyRules?.alerts?.tell; return v === 'app' || v === 'off' ? v : 'push'; };

const PLACE: Record<string, string> = { counter: 'at the counter', window: 'at the window', desk: 'at the front desk', online: 'online', app: 'in the app' };
/** What the owner's notice says: why it's worth a look, then the line. */
export function lookMessage(l: ActivityLine): string {
  return `Worth a look: ${l.flag || 'a money moment'}. ${lineTitle(l)}${l.cents ? `, $${(l.cents / 100).toFixed(2)}` : ''}${l.where ? ` ${PLACE[l.where]}` : ''}. ${lineWho(l)}.`;
}

/** A night's lines worth a look, for the night report: why, what, who, how much. */
export type WorthRow = { at: string; flag: string; title: string; who: string; cents: number | null };
export function worthRows(lines: ActivityLine[], max = 20): WorthRow[] {
  return lines.filter((l) => l.flag).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, max)
    .map((l) => ({ at: l.at, flag: l.flag!, title: lineTitle(l), who: lineWho(l), cents: l.cents }));
}
