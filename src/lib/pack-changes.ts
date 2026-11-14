// src/lib/pack-changes.ts — WHAT CHANGED WHILE AN ORDER WAS PACKED, in the customer's words (lib/retail-swap). Each item
// that was out: swapped (their backup, or the best match, and what came back when it cost less), refunded, or sent on its
// own when it's back. Each change is told ONCE: when packing is done, inside the ready-for-pickup message or in its own
// message for an order that's shipped or delivered (api/retail/changes-notify); or, for an order set aside after
// something in it was found out, on its own after a while (cron/retail-payments), and then not again. An order where
// every item was out is closed instead, with one message and one refund. With what comes back to their card in one
// refund, and when it shows. Pure: the messages and the order page say the same thing.
import { effectiveUnitCents } from './retail-swap';
import { taxShareCents } from './restocking';

export type PackChange = { lineId: string; at: string } & (
  | { kind: 'swap'; from: string; to: string; backup: boolean; qty: number; lessCents: number }
  | { kind: 'refund'; name: string; qty: number; cents: number }
  | { kind: 'later'; name: string; qty: number });

/** Why an order is closed when nothing in it could be sent (lib/retail-fulfill cancelOrder's reason). */
export const EVERY_ITEM_OUT = 'Every item was out';
/** How long an order set aside with something found out waits before the customer is told anyway. */
export const TELL_AFTER_MS = 2 * 3600e3;

/** Refunds the customer was told about on their own, at the time (an old ask-first order's answer, or no answer). */
const TOLD_ALREADY = ['No answer about a swap', 'Customer chose a refund'];
const n0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(n0(c) / 100).toFixed(2)}`;
const named = (l: any) => `${l?.name || 'An item'}${l?.optionsLabel ? `, ${l.optionsLabel}` : ''}`;

/** The changes on an order, item by item, in the order they appear: those the customer hasn't been told about yet
 *  (`all`: every one, as their order page lists them). */
export function packChanges(order: any, opts: { all?: boolean } = {}): PackChange[] {
  const lines: any[] = Array.isArray(order?.lines) ? order.lines : [];
  const byId = new Map(lines.map((l) => [String(l?.lineId || ''), l]));
  const told = new Set((Array.isArray(order?.changesToldLines) ? order.changesToldLines : []).map(String));
  const out: PackChange[] = [];
  for (const l of lines) {
    if (!l) continue;
    if (!opts.all && told.has(String(l.lineId || ''))) continue;
    const qty = n0(l.qtyShorted);
    const id = { lineId: String(l.lineId || ''), at: String(l.shortedAt || '') };
    if (l.status === 'refunded' && l.shortReason === 'Swapped' && l.swappedToLineId) {
      const to = byId.get(String(l.swappedToLineId));
      if (!to) continue;
      const each = Math.max(0, effectiveUnitCents(l) - n0(to.unitPriceCents));
      const less = each * n0(to.qtyOrdered);
      out.push({ ...id, kind: 'swap', from: named(l), to: named(to), backup: !!l.ifOut?.backupId && String(l.ifOut.backupId) === String(to.productId), qty: n0(to.qtyOrdered), lessCents: less + taxShareCents(order, less) });
    } else if (l.status === 'refunded' && qty > 0) {
      // An order from when customers could ask to be asked: they answered (or didn't, and were told then).
      if (TOLD_ALREADY.includes(String(l.shortReason || ''))) continue;
      const items = qty * effectiveUnitCents(l);
      out.push({ ...id, kind: 'refund', name: named(l), qty, cents: items + taxShareCents(order, items) });
    } else if (l.status === 'backordered' && qty > 0) {
      out.push({ ...id, kind: 'later', name: named(l), qty });
    }
  }
  return out;
}

/** What comes back for the changes: the refunds and the swaps that cost less. */
export const changesBackCents = (cs: PackChange[]): number => cs.reduce((a, c) => a + (c.kind === 'refund' ? c.cents : c.kind === 'swap' ? c.lessCents : 0), 0);

/** One line per change, for a text or an email. */
export function changeLines(cs: PackChange[]): string[] {
  return cs.map((c) => c.kind === 'swap' ? `${c.from}: ${c.backup ? `your backup, ${c.to}` : c.to}${c.lessCents ? `, ${money(c.lessCents)} less` : ''}.`
    : c.kind === 'refund' ? `${c.name}: refunded.`
    : `${c.name}: on its way on its own when it’s back, at no cost to you.`);
}

/** The money sentence: one refund, sent now (it shows in 5 to 10 business days) or once the shop sends it. */
export function refundSentence(order: any, cs: PackChange[]): string {
  const back = changesBackCents(cs);
  if (!back) return '';
  return n0(order?.pendingRefundCents) > 0
    ? `${money(back)} comes back to your card in one refund once the shop sends it. You’ll get an email when it does.`
    : `${money(back)} is on its way back to your card in one refund. It shows in 5 to 10 business days.`;
}

/** The whole note for a message: how many were out, each change, and the money. '' when nothing changed. */
export function changesNote(order: any, opts: { money?: boolean; all?: boolean } = {}): { short: string; lines: string[] } {
  const cs = packChanges(order, { all: opts.all });
  if (!cs.length) return { short: '', lines: [] };
  const lines = changeLines(cs); const money = opts.money === false ? '' : refundSentence(order, cs);
  const head = `${cs.length} ${cs.length === 1 ? 'item was' : 'items were'} out:`;
  return { short: [head, ...lines, money].filter(Boolean).join(' '), lines: [head, ...lines, ...(money ? [money] : [])] };
}

/** Nothing in it can be sent: every item was out (refunded, not one unit of it scanned in), none coming later. */
export function everyItemOut(order: any): boolean {
  const lines: any[] = Array.isArray(order?.lines) ? order.lines.filter(Boolean) : [];
  return lines.length > 0 && lines.every((l) => l.status === 'refunded' && n0(l.qtyOrdered) - n0(l.qtyShorted) <= 0);
}

/** When the oldest change the customer hasn't heard about was made (ms), or 0. */
export function untoldSince(order: any): number {
  const at = packChanges(order).map((c) => Date.parse(c.at) || 0).filter((t) => t > 0);
  return at.length ? Math.min(...at) : 0;
}

/** A short, stable name for a set of changes, so the same changes are only ever told once. */
export function changesKey(cs: PackChange[]): string {
  const ids = cs.map((c) => c.lineId).sort().join('|');
  let h = 5381; for (let i = 0; i < ids.length; i++) h = ((h * 33) ^ ids.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
