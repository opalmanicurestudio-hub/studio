// src/lib/pack-changes.ts — WHAT CHANGED WHILE AN ORDER WAS PACKED, in the customer's words (lib/retail-swap). Each item
// that was out: swapped (their backup, or the best match, and what came back when it cost less), refunded, or sent on its
// own when it's back. Told ONCE per order, when packing is done: inside the ready-for-pickup message, or in its own
// message for an order that's shipped or delivered (api/retail/changes-notify). With what comes back to their card in
// one refund, and when it shows. Pure: the messages and the order page say the same thing.
import { effectiveUnitCents } from './retail-swap';
import { taxShareCents } from './restocking';

export type PackChange =
  | { kind: 'swap'; from: string; to: string; backup: boolean; qty: number; lessCents: number }
  | { kind: 'refund'; name: string; qty: number; cents: number }
  | { kind: 'later'; name: string; qty: number };

/** Refunds the customer was told about on their own, at the time (an old ask-first order's answer, or no answer). */
const TOLD_ALREADY = ['No answer about a swap', 'Customer chose a refund'];
const n0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));
const money = (c: number) => `$${(n0(c) / 100).toFixed(2)}`;
const named = (l: any) => `${l?.name || 'An item'}${l?.optionsLabel ? `, ${l.optionsLabel}` : ''}`;

/** The changes on an order, item by item, in the order they appear. */
export function packChanges(order: any): PackChange[] {
  const lines: any[] = Array.isArray(order?.lines) ? order.lines : [];
  const byId = new Map(lines.map((l) => [String(l?.lineId || ''), l]));
  const out: PackChange[] = [];
  for (const l of lines) {
    if (!l) continue;
    const qty = n0(l.qtyShorted);
    if (l.status === 'refunded' && l.shortReason === 'Swapped' && l.swappedToLineId) {
      const to = byId.get(String(l.swappedToLineId));
      if (!to) continue;
      const each = Math.max(0, effectiveUnitCents(l) - n0(to.unitPriceCents));
      const less = each * n0(to.qtyOrdered);
      out.push({ kind: 'swap', from: named(l), to: named(to), backup: !!l.ifOut?.backupId && String(l.ifOut.backupId) === String(to.productId), qty: n0(to.qtyOrdered), lessCents: less + taxShareCents(order, less) });
    } else if (l.status === 'refunded' && qty > 0) {
      // An order from when customers could ask to be asked: they answered (or didn't, and were told then).
      if (TOLD_ALREADY.includes(String(l.shortReason || ''))) continue;
      const items = qty * effectiveUnitCents(l);
      out.push({ kind: 'refund', name: named(l), qty, cents: items + taxShareCents(order, items) });
    } else if (l.status === 'backordered' && qty > 0) {
      out.push({ kind: 'later', name: named(l), qty });
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
export function changesNote(order: any, opts: { money?: boolean } = {}): { short: string; lines: string[] } {
  const cs = packChanges(order);
  if (!cs.length) return { short: '', lines: [] };
  const lines = changeLines(cs); const money = opts.money === false ? '' : refundSentence(order, cs);
  const head = `${cs.length} ${cs.length === 1 ? 'item was' : 'items were'} out:`;
  return { short: [head, ...lines, money].filter(Boolean).join(' '), lines: [head, ...lines, ...(money ? [money] : [])] };
}
