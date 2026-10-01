// src/lib/assist.ts — STATION ASSIST (O4): one place to ask for, and answer, help from a station.
// A provider mid-service taps a request (towels, supplies, a hand, a drink for their client…) with urgency or a
// needed-by time; someone ACCEPTS it (so two people don't both go), DELIVERS it; a runner can propose a SUBSTITUTE,
// which the requester must approve; nobody accepting in time ESCALATES it to managers; a student's request goes to
// their instructors. The queue also shows the two older request kinds alongside — lounge orders (refreshmentRequests)
// and supply restocks (staffReplenishmentRequests) — each still handled by its own system underneath.
export type AssistKind = 'linen' | 'supplies' | 'help' | 'refreshment' | 'other';
export type AssistUrgency = 'now' | 'soon' | 'by';
export type AssistStatus = 'open' | 'accepted' | 'delivered' | 'cancelled';
export const ASSIST_PRESETS: { kind: AssistKind; label: string }[] = [
  { kind: 'linen', label: 'Towels / linens' }, { kind: 'supplies', label: 'Supplies' }, { kind: 'help', label: 'An extra hand' },
  { kind: 'refreshment', label: 'Drink for my client' }, { kind: 'other', label: 'Something else' },
];
export const URGENCY_LABEL: Record<AssistUrgency, string> = { now: 'Now', soon: 'In a few minutes', by: 'By a time' };
/** Minutes before an unaccepted request escalates. */
export const ESCALATE_AFTER: Record<'now' | 'soon', number> = { now: 2, soon: 6 };

export function escalateAt(r: { urgency: AssistUrgency; createdAt: string; neededBy?: string | null }): string {
  const t = Date.parse(r.createdAt) || Date.now();
  if (r.urgency === 'by' && r.neededBy) return new Date(Math.max(t, (Date.parse(r.neededBy) || t) - 5 * 60000)).toISOString();   // 5 min before it's needed
  return new Date(t + ESCALATE_AFTER[r.urgency === 'now' ? 'now' : 'soon'] * 60000).toISOString();
}

export interface QueueItem {
  source: 'assist' | 'lounge' | 'restock'; id: string; title: string; detail?: string | null; where?: string | null; forClient?: string | null;
  requester?: string | null; urgency: AssistUrgency; neededBy?: string | null; status: AssistStatus; acceptedBy?: string | null;
  createdAt: string; ageMin: number; escalated: boolean; sub?: { text: string; by: string; decision?: 'approved' | 'declined' | null } | null; raw: any;
}
const age = (iso: string, now: number) => Math.max(0, Math.round((now - (Date.parse(iso) || now)) / 60000));

/** Everything waiting for someone, newest problems first: escalated → urgent → oldest. */
export function assistQueue(assist: any[], lounge: any[], restock: any[], now = Date.now()): QueueItem[] {
  const out: QueueItem[] = [];
  for (const r of assist || []) { if (!r || ['delivered', 'cancelled'].includes(r.status)) continue;
    out.push({ source: 'assist', id: r.id, title: r.label || 'Request', detail: r.note || null, where: r.stationName || null, forClient: r.clientName || null, requester: r.requestedByName || null,
      urgency: r.urgency || 'soon', neededBy: r.neededBy || null, status: r.status || 'open', acceptedBy: r.acceptedByName || null, createdAt: r.createdAt, ageMin: age(r.createdAt, now),
      escalated: r.status === 'open' && Date.parse(r.escalateAt || escalateAt(r)) <= now, sub: r.sub || null, raw: r }); }
  for (const r of lounge || []) { if (!r || r.status !== 'pending') continue; const at = r.requestedAt || r.createdAt;
    out.push({ source: 'lounge', id: r.id, title: `${r.itemName || 'Refreshment'}${Number(r.quantity) > 1 ? ` ×${r.quantity}` : ''}`, detail: r.accessNote || null, where: r.stationName || null, forClient: r.clientName || null,
      requester: 'Client (lounge)', urgency: 'soon', status: r.bringingOutAt ? 'accepted' : 'open', acceptedBy: r.bringingOutBy || null, createdAt: at, ageMin: age(at, now),
      escalated: !r.bringingOutAt && age(at, now) >= ESCALATE_AFTER.soon, raw: r }); }
  for (const r of restock || []) { if (!r || String(r.status || 'pending') !== 'pending') continue; const at = r.requestedAt || r.createdAt; const q = Number(r.quantityRequested ?? r.quantity) || 1;
    out.push({ source: 'restock', id: r.id, title: `Restock: ${r.itemName || 'supplies'}${q > 1 ? ` ×${q}` : ''}`, detail: r.note || r.reason || null, where: r.stationName || null,
      requester: r.staffName || null, urgency: 'soon', status: 'open', createdAt: at, ageMin: age(at, now), escalated: false, raw: r }); }
  const rank = (q: QueueItem) => (q.escalated ? 0 : q.status === 'open' && q.urgency === 'now' ? 1 : q.status === 'open' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
}
export const openCount = (q: QueueItem[]) => q.filter((x) => x.status === 'open').length;
