// src/lib/renter-timeline.ts
//
// ONE ACCOUNT, ONE STORY.
//
// A renter's history is scattered across seven collections: invoices, the
// rent ledger, sent messages, maintenance tickets, leases, day bookings, and
// the renter record's own stamps (status changes, autopay flips, bars, leave).
// Each of those knows one kind of event. Nobody could read the whole story —
// "rent posted, autopay failed, notice sent, they replied, half paid, balance
// updated" — without opening five screens and a phone.
//
// This module reads them all and returns ONE chronological timeline, each
// entry with a kind, an actor, an amount where there is one, and a detail
// line. The renter card renders it live; the account statement prints it as
// the Full Account Record; the portal can show the renter their own copy.
//
// Pure. Give it the documents, get back the story. It writes nothing and
// decides nothing — every automation that could put an entry here is a
// switch the owner controls elsewhere; this only reports what happened.

export type TimelineKind =
  | 'invoice' | 'late_fee' | 'payment' | 'part_payment' | 'write_off' | 'credit' | 'charge'
  | 'autopay_ok' | 'autopay_failed' | 'autopay_on' | 'autopay_off'
  | 'notice' | 'message_in' | 'message_out'
  | 'ticket_opened' | 'ticket_note' | 'ticket_resolved'
  | 'lease_signed' | 'lease_started' | 'lease_ended' | 'status' | 'leave'
  | 'barred' | 'unbarred' | 'portal' | 'booking' | 'applied' | 'note';

export interface TimelineEntry {
  at: string;                 // ISO or YYYY-MM-DD
  kind: TimelineKind;
  title: string;
  detail?: string;
  amountCents?: number;       // positive = charge, negative = credit/payment
  actor?: string;             // 'system' | 'owner' | 'renter' | a name
  status?: string;            // delivered / opened / failed … for messages
  ref?: { type: string; id: string };
}

export interface TimelineInput {
  renter: any;
  leases?: any[];
  invoices?: any[];
  ledger?: any[];
  messages?: any[];        // messageLog rows for this renter
  tickets?: any[];
  reservations?: any[];
  /** renterThreads/{renterId}/messages — the conversation itself. */
  thread?: any[];
  boothById?: Map<string, any>;
}

const s10 = (v: any) => String(v || '').slice(0, 10);
const cents = (v: any) => Number(v) || 0;
const nameOf = (r: any) => `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || 'Renter';

export function buildRenterTimeline(input: TimelineInput): TimelineEntry[] {
  const { renter } = input;
  const out: TimelineEntry[] = [];
  const push = (e: TimelineEntry) => { if (e.at) out.push(e); };
  const booth = (id: any) => input.boothById?.get(String(id || ''))?.name;

  // ── Identity & lease ──────────────────────────────────────────────────────
  if (renter?.appliedAt) push({ at: s10(renter.appliedAt), kind: 'applied', title: 'Applied', detail: 'via the booking page', actor: 'renter' });
  for (const l of input.leases || []) {
    const sp = booth(l.boothId) || l.boothName || 'space';
    if (l.signedAt) push({ at: l.signedAt, kind: 'lease_signed', title: `Signed lease · ${sp}`, actor: 'renter', ref: { type: 'lease', id: l.id } });
    if (l.startDate) push({ at: l.startDate, kind: 'lease_started', title: `Lease started · ${sp}`, detail: `${l.frequency || 'monthly'} · $${(cents(l.rentAmountCents) / 100).toFixed(2)}`, ref: { type: 'lease', id: l.id } });
    if (l.status === 'ended' && (l.endedAt || l.endDate)) push({ at: l.endedAt || l.endDate, kind: 'lease_ended', title: `Lease ended · ${sp}`, actor: l.endedBy || 'owner', ref: { type: 'lease', id: l.id } });
    if (l.status === 'on_leave' && l.leaveStartedAt) push({ at: l.leaveStartedAt, kind: 'leave', title: `On leave · ${sp}`, detail: l.leaveReason || undefined });
  }
  for (const h of (Array.isArray(renter?.statusHistory) ? renter.statusHistory : [])) {
    if (h?.at && h?.to) push({ at: h.at, kind: 'status', title: `Status: ${h.from || '—'} → ${h.to}`, actor: h.by || 'owner' });
  }
  if (renter?.autopayChangedAt) push({ at: renter.autopayChangedAt, kind: renter.autopayEnabled ? 'autopay_on' : 'autopay_off', title: renter.autopayEnabled ? 'Autopay turned on' : 'Autopay turned off', actor: renter.autopayChangedBy || 'owner' });
  if (renter?.doNotRentAt && renter?.doNotRent) push({ at: renter.doNotRentAt, kind: 'barred', title: 'Barred from booking', detail: renter.doNotRentReason || undefined, actor: renter.doNotRentBy || 'owner' });
  if (renter?.portalFirstSeenAt) push({ at: renter.portalFirstSeenAt, kind: 'portal', title: 'First signed in to the portal', actor: 'renter' });
  if (renter?.portalInviteSentAt) push({ at: renter.portalInviteSentAt, kind: 'portal', title: 'Portal link sent', actor: 'owner' });

  // ── Money: invoices are the charges, the ledger is the movement ───────────
  const invoiceByLedger = new Map<string, any>();
  for (const i of input.invoices || []) {
    if (i.ledgerEntryId) invoiceByLedger.set(String(i.ledgerEntryId), i);
    if (i.status === 'void') {
      push({ at: i.voidedAt || i.updatedAt || i.dueDate, kind: 'write_off', title: `Invoice voided · due ${s10(i.dueDate)}`, detail: i.voidReason === 'written_off' ? 'written off' : undefined, actor: 'owner', ref: { type: 'invoice', id: i.id } });
      continue;
    }
    push({ at: s10(i.dueDate), kind: 'invoice', title: `Rent posted · ${i.boothName || booth(i.boothId) || 'space'}`, detail: `due ${s10(i.dueDate)}${i.source === 'imported' ? ' · from the old cycle' : ''}`, amountCents: cents(i.amountCents), actor: 'system', ref: { type: 'invoice', id: i.id } });
    if (cents(i.lateFeeCents) > 0) push({ at: i.lateFeeAppliedAt || s10(i.dueDate), kind: 'late_fee', title: 'Late fee applied', detail: `on rent due ${s10(i.dueDate)}`, amountCents: cents(i.lateFeeCents), actor: 'system', ref: { type: 'invoice', id: i.id } });
    if (i.status === 'late' && i.markedLateAt) push({ at: i.markedLateAt, kind: 'notice', title: 'Rent marked late', detail: 'past the grace period', actor: 'system', ref: { type: 'invoice', id: i.id } });
    for (const d of (Array.isArray(i.dunningSentDays) ? i.dunningSentDays : [])) {
      push({ at: i.dunningSentAt?.[String(d)] || i.updatedAt || s10(i.dueDate), kind: 'notice', title: `Escalation notice · ${d} days late`, actor: 'system', ref: { type: 'invoice', id: i.id } });
    }
    if (i.status === 'paid' && i.paidAt) push({ at: i.paidAt, kind: i.paidVia === 'autopay' ? 'autopay_ok' : 'payment', title: i.paidVia === 'autopay' ? 'Autopay went through' : `Invoice settled${i.paidVia ? ` · ${i.paidVia}` : ''}`, detail: `rent due ${s10(i.dueDate)}`, amountCents: -(cents(i.amountCents) + cents(i.lateFeeCents)), actor: i.paidVia === 'autopay' ? 'system' : 'owner', ref: { type: 'invoice', id: i.id } });
  }
  for (const e of input.ledger || []) {
    const at = e.paidAt || e.dueDate || e.createdAt;
    const c = cents(e.amountCents);
    if (e.type === 'rent_charge') {
      if (invoiceByLedger.has(e.id)) continue;                // the invoice told this story
      if (/declined/i.test(String(e.description || ''))) {
        push({ at: e.createdAt || at, kind: 'autopay_failed', title: 'Autopay declined', detail: (String(e.description).match(/declined \(([^)]+)\)/)?.[1]) || undefined, amountCents: c, actor: 'system', ref: { type: 'ledger', id: e.id } });
      } else if (e.status !== 'waived') {
        push({ at, kind: 'charge', title: e.description || 'Rent charge', detail: e.dueDate ? `due ${s10(e.dueDate)}` : undefined, amountCents: c, actor: e.createdBy || 'system', ref: { type: 'ledger', id: e.id } });
      }
    } else if (e.type === 'payment') {
      const isWriteOff = e.method === 'write_off' || /written off/i.test(String(e.description || ''));
      const settled = (input.invoices || []).filter((i) => i.ledgerEntryId === e.id);
      const partial = settled.some((i) => i.status !== 'paid');
      push({
        at, kind: isWriteOff ? 'write_off' : partial ? 'part_payment' : 'payment',
        title: isWriteOff ? 'Balance written off' : `Payment received · ${e.method || e.paymentMethod || 'recorded'}`,
        detail: e.note || (settled.length ? `applied to rent due ${settled.map((i) => s10(i.dueDate)).join(', ')}` : undefined),
        amountCents: c, actor: isWriteOff ? 'owner' : (e.createdBy || 'owner'), ref: { type: 'ledger', id: e.id },
      });
    } else if (e.type === 'late_fee') {
      push({ at, kind: 'late_fee', title: e.description || 'Late fee', amountCents: c, actor: 'system', ref: { type: 'ledger', id: e.id } });
    } else if (c !== 0) {
      push({ at, kind: c < 0 ? 'credit' : 'charge', title: e.description || (c < 0 ? 'Credit' : 'Charge'), detail: e.note || undefined, amountCents: c, actor: e.createdBy || 'owner', ref: { type: 'ledger', id: e.id } });
    }
  }

  // ── Communications: every message, with how far it got ───────────────────
  const threadLogIds = new Set((input.thread || []).map((m) => String(m.emailLogId || '')).filter(Boolean));
  for (const m of input.messages || []) {
    if (threadLogIds.has(String(m.id))) continue;          // shown as the message itself
    const got = m.bouncedAt ? 'bounced' : m.status === 'failed' ? 'failed' : String(m.status || '').startsWith('skipped') ? 'not sent' : m.clickedAt ? 'clicked' : m.openedAt ? 'opened' : m.deliveredAt ? 'delivered' : 'sent';
    push({
      at: m.sentAt || m.createdAt, kind: m.direction === 'inbound' ? 'message_in' : (String(m.kind || '').includes('notice') || /overdue|dunning|barred|late/i.test(String(m.kind || '')) ? 'notice' : 'message_out'),
      title: m.subject || String(m.kind || 'message').replace(/_/g, ' '),
      detail: `${m.channel || 'email'} · ${got}${m.openedAt ? ` ${s10(m.openedAt)}` : ''}`,
      actor: m.direction === 'inbound' ? 'renter' : 'system', status: got, ref: { type: 'message', id: m.id },
    });
  }

  // ── The conversation — what was actually said, both ways ──────────────────
  for (const m of input.thread || []) {
    const inbound = m.direction === 'inbound';
    push({
      at: m.createdAt, kind: inbound ? 'message_in' : 'message_out',
      title: inbound ? `Renter wrote` : `${m.byName || 'You'} wrote`,
      detail: String(m.text || '').slice(0, 200),
      actor: inbound ? 'renter' : 'owner',
      status: inbound ? undefined : [m.emailStatus === 'sent' ? 'emailed' : null, m.smsStatus === 'sent' ? 'texted' : null].filter(Boolean).join(' · ') || undefined,
      ref: { type: 'thread', id: m.id },
    });
  }

  // ── Waivers, from the invoice stamps ──────────────────────────────────────
  for (const i of input.invoices || []) {
    if (i.feeWaivedAt) push({ at: i.feeWaivedAt, kind: 'credit', title: 'Late fee waived', detail: [i.feeWaivedReason, `rent due ${s10(i.dueDate)}`].filter(Boolean).join(' · '), amountCents: -cents(i.feeWaivedCents), actor: i.feeWaivedBy || 'owner', ref: { type: 'invoice', id: i.id } });
    if (i.status === 'void' && i.voidReason === 'waived') push({ at: i.voidedAt || i.updatedAt, kind: 'credit', title: 'Invoice waived', detail: [i.voidNote, `rent due ${s10(i.dueDate)}`].filter(Boolean).join(' · '), actor: i.voidedBy || 'owner', ref: { type: 'invoice', id: i.id } });
  }

  // ── Maintenance ───────────────────────────────────────────────────────────
  for (const t of input.tickets || []) {
    push({ at: t.createdAt, kind: 'ticket_opened', title: `Maintenance: ${t.title || t.summary || 'ticket'}`, detail: [t.priority, t.location || booth(t.boothId)].filter(Boolean).join(' · ') || undefined, actor: t.createdBy || 'renter', ref: { type: 'ticket', id: t.id } });
    for (const n of (Array.isArray(t.notes) ? t.notes : [])) {
      if (n?.at) push({ at: n.at, kind: 'ticket_note', title: `Ticket note`, detail: String(n.text || '').slice(0, 160), actor: n.by || 'owner', ref: { type: 'ticket', id: t.id } });
    }
    if (t.resolvedAt) push({ at: t.resolvedAt, kind: 'ticket_resolved', title: `Resolved: ${t.title || 'ticket'}`, detail: t.resolution || undefined, actor: t.resolvedBy || 'owner', ref: { type: 'ticket', id: t.id } });
  }

  // ── Day bookings ──────────────────────────────────────────────────────────
  for (const r of input.reservations || []) {
    if (r.createdAt) push({ at: r.createdAt, kind: 'booking', title: `Booked ${r.boothName || 'a space'}`, detail: `${r.startDate}${r.endDate && r.endDate !== r.startDate ? ` → ${r.endDate}` : ''}`, amountCents: cents(r.amountCents), actor: 'renter', ref: { type: 'reservation', id: r.id } });
  }

  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Running balance walking the timeline oldest → newest (money entries only). */
export function withRunningBalance(entries: TimelineEntry[]): (TimelineEntry & { balanceCents?: number })[] {
  const oldestFirst = [...entries].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let bal = 0;
  const stamped = oldestFirst.map((e) => {
    if (typeof e.amountCents === 'number' && e.kind !== 'booking' && e.kind !== 'autopay_failed') {
      bal += e.amountCents;
      return { ...e, balanceCents: bal };
    }
    return e;
  });
  return stamped.reverse();
}

export const TIMELINE_ACTOR_LABEL: Record<string, string> = {
  system: 'Automatic', owner: 'You', renter: 'Renter',
};
