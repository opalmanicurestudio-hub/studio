// src/lib/problems-view.ts — THE PROBLEMS LIST. Everything about an order that needs a person, from every place it
// can come from (customer messages, problem reports, returns, refunds waiting to go, held orders, orders waiting on
// stock or not collected, customers outside), gathered under the order it belongs to. One order, one row, however
// many problems it has. Most urgent first, then whoever has waited longest. Pure, so it can be tested.
import { firstName, money, needsYou, orderNum } from './orders-view';

export type ProblemKind = 'outside' | 'message' | 'claim' | 'refund' | 'return' | 'held' | 'backorder' | 'uncollected';
export interface Problem { key: string; kind: ProblemKind; orderId: string; title: string; detail: string; at: number; urgent: boolean; ref: any }
export interface ProblemGroup { orderId: string; num: string; customerName: string; items: Problem[]; at: number; urgent: boolean; order: any | null }

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
const ago = (t: number, now: number) => { if (!t) return ''; const m = Math.max(0, Math.round((now - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const CLAIM_WORDS: Record<string, string> = { missing: 'is missing', damaged: 'arrived damaged', wrong_item: 'is the wrong item', not_received: 'never arrived', defective: 'doesn’t work' };
const RANK: Record<ProblemKind, number> = { outside: 0, message: 1, claim: 2, refund: 3, held: 4, return: 5, uncollected: 6, backorder: 7 };
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

export function buildProblems(src: { orders: any[]; refundOrders?: any[]; tickets?: any[]; claims?: any[]; returns?: any[]; now?: number; staleHours?: number }): ProblemGroup[] {
  const now = src.now ?? Date.now();
  const byOrder = new Map<string, any>();
  [...(src.refundOrders || []), ...src.orders].forEach((o) => byOrder.set(o.id, o));
  const items: Problem[] = [];
  const push = (p: Omit<Problem, 'key'> & { key?: string }) => items.push({ key: p.key || `${p.orderId}-${p.kind}-${items.length}`, ...p } as Problem);

  for (const n of needsYou(src.orders, now, src.staleHours ?? 48)) {
    if (n.kind === 'refund' || n.kind === 'missing') continue;
    const o = byOrder.get(n.orderId) || {};
    const at = n.kind === 'outside' ? ms(o.curbside?.arrivedAt) : n.kind === 'uncollected' ? ms(o.readyAt) : n.kind === 'held' ? ms(o.heldAt || o.paidAt) : ms(o.paidAt);
    const detail = n.kind === 'held' ? String(o.holdReason || 'Not packed until someone releases it') : n.kind === 'outside' ? `Waiting ${ago(at, now).replace(' ago', '')}` : n.kind === 'uncollected' ? `Ready ${ago(at, now)}` : 'Packs once the stock is in';
    push({ key: n.key, kind: n.kind as ProblemKind, orderId: n.orderId, title: n.text, detail, at, urgent: n.kind === 'outside', ref: o });
  }
  for (const o of byOrder.values()) {
    const c = Number(o.pendingRefundCents) || 0; if (c <= 0) continue;
    push({ key: `${o.id}-refund`, kind: 'refund', orderId: o.id, title: `Refund ${money(c)} to send`, detail: o.returnSummary?.restockingFeeCents ? `After a ${money(o.returnSummary.restockingFeeCents)} restocking fee` : 'Waiting for you to confirm', at: ms(o.returnSummary?.resolvedAt || o.updatedAt || o.paidAt), urgent: false, ref: o });
  }
  for (const t of src.tickets || []) {
    if (t.status === 'resolved' || !t.orderId) continue;
    const unanswered = Math.max(1, Number(t.customerMessagesSinceStaffReply) || (Array.isArray(t.replies) && t.replies.length ? 0 : 1));
    const th = threadOf(t); const last = [...th].reverse().find((m) => m.who === 'customer');
    const waiting = !(th.length && th[th.length - 1].who === 'shop');
    const at = lastCustomerAt(t);
    push({ key: `t-${t.id}`, kind: 'message', orderId: t.orderId, title: waiting ? `${firstName(t.customerName)} wrote` : `Waiting on ${firstName(t.customerName)}`, detail: `“${String(last?.text || '').slice(0, 90)}”${waiting && unanswered > 1 ? ` · ${unanswered} unanswered` : ''} · ${ago(at, now)}`, at, urgent: t.priority === 'urgent' && waiting, ref: t });
  }
  for (const c of src.claims || []) {
    if (!OPEN_CLAIM.has(String(c.status || '')) || !c.orderId) continue;
    const at = ms(c.openedAt);
    push({ key: `c-${c.id}`, kind: 'claim', orderId: c.orderId, title: `Says ${c.lineName || 'an item'} ${CLAIM_WORDS[String(c.type)] || 'has a problem'}`, detail: `${c.claimValueCents ? `${money(c.claimValueCents)} · ` : ''}${Array.isArray(c.evidence?.photoUrls) && c.evidence.photoUrls.length ? 'Photo attached · ' : ''}${ago(at, now)}`, at, urgent: false, ref: c });
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

export function waitLabel(at: number, now = Date.now()): string { return ago(at, now); }
