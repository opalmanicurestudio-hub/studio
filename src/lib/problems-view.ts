// src/lib/problems-view.ts — THE PROBLEMS LIST. Everything about an order that needs a person, from every place it
// can come from (customer messages, problem reports, returns, refunds waiting to go, held orders, orders waiting on
// stock or not collected, customers outside), gathered under the order it belongs to. One order, one row, however
// many problems it has. Most urgent first, then whoever has waited longest. Pure, so it can be tested.
import { firstName, money, needsYou, orderNum } from './orders-view';
import { dayLabel, promisedDay } from './ship-promise';
import { carrierItem } from './ship-day';
import { claimSince, claimWaiting } from './claim-view';

export type ProblemKind = 'outside' | 'message' | 'claim' | 'refund' | 'return' | 'held' | 'backorder' | 'uncollected' | 'late' | 'address' | 'unconfirmed' | 'label' | 'voided' | 'relabel' | 'refundDenied' | 'charge' | 'carrier' | 'unshipped';
/** waiting: the shop asked and it waits for the customer's answer (Waiting on them, not in front of you). appeal: they
 *  asked for a declined report to be looked at again. */
export interface Problem { key: string; kind: ProblemKind; orderId: string; title: string; detail: string; at: number; urgent: boolean; ref: any; waiting?: boolean; appeal?: boolean }
export interface ProblemGroup { orderId: string; num: string; customerName: string; items: Problem[]; at: number; urgent: boolean; order: any | null }

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
const ago = (t: number, now: number) => { if (!t) return ''; const m = Math.max(0, Math.round((now - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const CLAIM_WORDS: Record<string, string> = { missing: 'is missing', damaged: 'arrived damaged', wrong_item: 'is the wrong item', not_received: 'never arrived', defective: 'doesn’t work' };
const RANK: Record<ProblemKind, number> = { outside: 0, message: 1, late: 2, carrier: 3, claim: 3, refund: 4, held: 5, address: 6, voided: 7, relabel: 7, refundDenied: 8, return: 8, uncollected: 9, unconfirmed: 10, label: 11, unshipped: 11, backorder: 12, charge: 13 };
const OPEN_CLAIM = new Set(['in_review', 'needs_info', 'info_requested', 'open']);

export function lastCustomerAt(t: any): number {
  const f = Array.isArray(t.followUps) ? t.followUps.map((x: any) => ms(x.at)) : [];
  return Math.max(ms(t.createdAt), ...f, ms(t.lastCustomerAt));
}

export function threadOf(t: any): { who: 'customer' | 'shop'; text: string; at: string; by?: string; via?: string }[] {
  const out: any[] = [{ who: 'customer', text: String(t.message || ''), at: t.createdAt }];
  (Array.isArray(t.followUps) ? t.followUps : []).forEach((f: any) => out.push({ who: 'customer', text: String(f.message || ''), at: f.at, via: f.kind === 'email' ? 'email' : undefined }));
  (Array.isArray(t.replies) ? t.replies : []).forEach((r: any) => out.push({ who: 'shop', text: String(r.text || ''), at: r.at, by: r.by }));
  return out.filter((m) => m.text).sort((a, b) => ms(a.at) - ms(b.at));
}

/** knownOrders: finished orders a return or report is on (not in the lists of active ones), only to name and open them. */
export function buildProblems(src: { orders: any[]; refundOrders?: any[]; knownOrders?: any[]; tickets?: any[]; claims?: any[]; returns?: any[]; now?: number; staleHours?: number; timeZone?: string }): ProblemGroup[] {
  const now = src.now ?? Date.now();
  const byOrder = new Map<string, any>();
  [...(src.knownOrders || []), ...(src.refundOrders || []), ...src.orders].forEach((o) => byOrder.set(o.id, o));
  const items: Problem[] = [];
  const push = (p: Omit<Problem, 'key'> & { key?: string }) => items.push({ key: p.key || `${p.orderId}-${p.kind}-${items.length}`, ...p } as Problem);

  for (const n of needsYou(src.orders, now, src.staleHours ?? 48)) {
    if (n.kind === 'refund' || n.kind === 'missing') continue;
    const o = byOrder.get(n.orderId) || {};
    const at = n.kind === 'outside' ? ms(o.curbside?.arrivedAt) : n.kind === 'uncollected' ? ms(o.readyAt) : n.kind === 'held' ? ms(o.heldAt || o.paidAt) : n.kind === 'late' ? ms(o.shipPromiseAt) || ms(o.paidAt)
      : n.kind === 'refundDenied' ? ms(o.labelRefundDenied?.at) : n.kind === 'charge' ? ms(o.labelCharge?.at) : ms(o.paidAt);
    const tz = String(o.promise?.timeZone || src.timeZone || 'UTC');
    const day = n.kind === 'late' ? (o.lateNeedsStaff?.missed || promisedDay(o, tz)) : null;
    const notices = Number(o.autoDelayNotices) || 0;
    const detail = n.kind === 'held' ? (o.idCheck?.status === 'verified' ? 'ID check passed · ready to release' : String((o.riskCheck?.reasons || [])[0] || o.holdReason || 'Not packed until someone releases it'))
      : n.kind === 'outside' ? `Waiting ${ago(at, now).replace(' ago', '')}`
      // A delivery isn't collected or shipped: brought back, or past its delivery time.
      : o.method === 'delivery' && n.kind === 'uncollected' ? `Brought back ${ago(ms(o.delivery?.failedAt) || at, now)}. Arrange another time with them, then send it out again.`
      : o.method === 'delivery' && n.kind === 'late' ? `Its delivery time ended ${ago(ms(o.delivery?.window?.end) || ms(o.delivery?.asap?.by) || at, now)}. Send it out now, or arrange a new time with them.`
      : n.kind === 'uncollected' ? `Ready ${ago(at, now)}${Number(o.uncollectedNotices) ? ` · ${o.uncollectedNotices >= 3 ? 'last-day notice sent' : `${o.uncollectedNotices} reminder${o.uncollectedNotices === 1 ? '' : 's'} sent`}` : ''}`
      : n.kind === 'late' ? (o.lateNeedsStaff?.open
        ? `Was due to ship ${day ? dayLabel(day, tz) : 'already'}${notices ? ` · told ${notices === 1 ? 'once' : `${notices} times`} it was running late` : ''}. Send a new date, or ship it today.`
        : `Promised by ${day ? dayLabel(day, tz) : 'an earlier date'}. They can cancel for a full refund until it ships.`)
      : n.kind === 'address' ? 'Approve it, or answer them, on the order'
      : n.kind === 'unconfirmed' ? 'Asked over a day ago, no answer yet'
      : n.kind === 'label' ? 'Find the box, or void the label to get the postage back'
      : n.kind === 'voided' ? (Array.isArray(o.labelTxns) && o.labelTxns.length ? 'Check the boxes on the ship sheet' : 'A voided box needs a new label, bought in Shippo')
      : n.kind === 'relabel' ? 'Buy its new label on the ship sheet, or take the box off the order'
      : n.kind === 'refundDenied' ? 'The carrier scanned a voided label. Check with them before sending anything else.'
      : n.kind === 'charge' ? 'Recorded in Money as shipping'
      : n.kind === 'carrier' ? (carrierItem(o, tz, now)?.detail || 'Check the tracking on the order')
      : n.kind === 'unshipped' ? 'The carrier scanned its label. Open the order and mark it shipped.'
      : 'Packs once the stock is in';
    push({ key: n.key, kind: n.kind as ProblemKind, orderId: n.orderId, title: n.text, detail, at, urgent: n.kind === 'outside', ref: o });
  }
  // Refunds to send: from the live lists only (a finished order read once to name a return could be out of date).
  const live = new Map<string, any>(); [...(src.refundOrders || []), ...src.orders].forEach((o) => live.set(o.id, o));
  for (const o of live.values()) {
    const c = Number(o.pendingRefundCents) || 0; if (c <= 0) continue;
    push({ key: `${o.id}-refund`, kind: 'refund', orderId: o.id, title: `Refund ${money(c)} to send`, detail: o.returnSummary?.restockingFeeCents ? `After a ${money(o.returnSummary.restockingFeeCents)} restocking fee` : 'Waiting for you to confirm', at: ms(o.returnSummary?.resolvedAt || o.updatedAt || o.paidAt), urgent: false, ref: o });
  }
  for (const t of src.tickets || []) {
    if (t.status === 'resolved' || !t.orderId) continue;
    const unanswered = Math.max(1, Number(t.customerMessagesSinceStaffReply) || (Array.isArray(t.replies) && t.replies.length ? 0 : 1));
    const th = threadOf(t); const last = [...th].reverse().find((m) => m.who === 'customer');
    const waiting = !(th.length && th[th.length - 1].who === 'shop');
    const at = lastCustomerAt(t);
    push({ key: `t-${t.id}`, kind: 'message', orderId: t.orderId, title: waiting ? `${firstName(t.customerName)} wrote` : `Waiting on ${firstName(t.customerName)}`, detail: `“${String(last?.text || '').slice(0, 90)}”${waiting && unanswered > 1 ? ` · ${unanswered} unanswered` : ''} · ${ago(at, now)}`, at, urgent: t.priority === 'urgent' && waiting, ref: t, waiting: !waiting });
  }
  for (const c of src.claims || []) {
    if (!OPEN_CLAIM.has(String(c.status || '')) || !c.orderId) continue;
    const what = `${c.lineName || (c.type === 'not_received' ? 'the order' : 'an item')} ${CLAIM_WORDS[String(c.type)] || 'has a problem'}`;
    const who = firstName(c.customerName);
    const waiting = claimWaiting(c); const appeal = !!c.appealedAt;
    const answered = !waiting && !!c.infoRequestText && !!c.infoResponseText;
    // Waited since it last came back to the shop (reported, appealed or answered); one waiting on them, since the ask.
    const at = waiting ? ms(c.infoRequestAt) : claimSince(c) || ms(c.openedAt);
    const extras = `${c.claimValueCents ? `${money(c.claimValueCents)} · ` : ''}${Array.isArray(c.photoUrls) && c.photoUrls.length ? `${c.photoUrls.length === 1 ? 'Photo' : `${c.photoUrls.length} photos`} attached · ` : ''}`;
    push({ key: `c-${c.id}`, kind: 'claim', orderId: c.orderId,
      title: waiting ? `Waiting on ${who}: ${what}` : appeal ? `Appeal: ${what}` : answered ? `${who} answered: ${what}` : `Says ${what}`,
      detail: waiting ? `You asked ${ago(at, now)}` : `${extras}${appeal ? 'appealed ' : answered ? 'answered ' : ''}${ago(at, now)}`,
      at, urgent: false, ref: c, waiting, appeal });
  }
  for (const r of src.returns || []) {
    if (!['open', 'received'].includes(String(r.status)) || !r.orderId) continue;
    const units = (r.lines || []).reduce((a: number, l: any) => a + (Number(l.qty) || 0), 0);
    const at = ms(r.openedAt);
    push({ key: `r-${r.id}`, kind: 'return', orderId: r.orderId, title: r.status === 'received' ? 'Return to finish checking in' : `${units} item${units === 1 ? '' : 's'} coming back`, detail: `${r.resolution === 'store_credit' ? 'Store credit' : r.resolution === 'replacement' ? 'Replacement' : 'Refund'} · started ${ago(at, now)}`, at, urgent: false, ref: r });
  }

  const groups = new Map<string, ProblemGroup>();
  for (const p of items) {
    const o = byOrder.get(p.orderId) || null;
    const g = groups.get(p.orderId) || { orderId: p.orderId, num: o ? orderNum(o) : `#${String(p.ref?.orderNumber ?? '').padStart(4, '0')}`, customerName: String(o?.customerName || p.ref?.customerName || 'Customer'), items: [], at: Infinity, urgent: false, order: o };
    g.items.push(p); g.at = Math.min(g.at, p.at || now); g.urgent = g.urgent || p.urgent;
    groups.set(p.orderId, g);
  }
  const out = [...groups.values()];
  out.forEach((g) => g.items.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.at - b.at));
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || RANK[a.items[0].kind] - RANK[b.items[0].kind] || a.at - b.at);
}

export type ProblemShow = 'all' | 'claims' | 'returns' | 'messages' | 'refunds' | 'waiting';
export const PROBLEM_SHOWS: { id: ProblemShow; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'claims', label: 'Claims' }, { id: 'returns', label: 'Returns' }, { id: 'messages', label: 'Messages' },
  { id: 'refunds', label: 'Refunds to send' }, { id: 'waiting', label: 'Waiting on them' },
];
const SHOW_KIND: Partial<Record<ProblemShow, ProblemKind>> = { claims: 'claim', returns: 'return', messages: 'message', refunds: 'refund' };
/** One filter of the queue (mockup 10F). Everything but Waiting on them leaves out what waits for the customer; Claims
 *  puts appeals first, then whoever has waited longest. Each order keeps every problem it has (the panel shows them all):
 *  only the rows are filtered. */
export function showProblems(groups: ProblemGroup[], show: ProblemShow): ProblemGroup[] {
  const kind = SHOW_KIND[show];
  const keep = (p: Problem) => (show === 'waiting' ? !!p.waiting : !p.waiting && (!kind || p.kind === kind));
  const out = groups.map((g) => { const items = g.items.filter(keep); return items.length ? { ...g, items, at: Math.min(...items.map((p) => p.at || g.at)), urgent: items.some((p) => p.urgent) } : null; })
    .filter(Boolean) as ProblemGroup[];
  if (show === 'claims') {
    out.forEach((g) => g.items.sort((a, b) => Number(!!b.appeal) - Number(!!a.appeal) || a.at - b.at));
    return out.sort((a, b) => Number(!!b.items[0].appeal) - Number(!!a.items[0].appeal) || a.at - b.at);
  }
  if (show === 'all') return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || RANK[a.items[0].kind] - RANK[b.items[0].kind] || a.at - b.at);
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.at - b.at);
}
export const isShow = (v: any): v is ProblemShow => PROBLEM_SHOWS.some((x) => x.id === v);

export function waitLabel(at: number, now = Date.now()): string { return ago(at, now); }
