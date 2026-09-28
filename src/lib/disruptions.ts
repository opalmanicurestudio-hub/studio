// src/lib/disruptions.ts — WHEN APPOINTMENTS CAN'T GO AHEAD AS BOOKED.
//
// One workflow for two causes:
//   • a PROVIDER CALLOUT (illness, transport, family, other — no details kept)
//   • a BUSINESS INTERRUPTION (maintenance, flood, power, weather/safety,
//     closure…) — the existing interruptions record on /maintenance, linked to
//     the maintenance tickets that caused it.
// Every affected appointment gets the same care: the client is told why (in
// wording that fits the cause) and chooses — a new time (free, not counted),
// or cancel with no fee (deposit refunded or kept as credit — their choice);
// for a callout, staff can also offer another provider. Renter bookings: the
// renter is told (they're the renter's clients). Every outcome is recorded ON
// the disruption, so the insurance packet and renter reimbursements are built
// from what actually happened. Pure: server + browser.

export type DisruptionKind = 'callout' | 'interruption';
export type CalloutReason = 'illness' | 'transport' | 'family' | 'other';
export type Outcome = 'pending' | 'rescheduled' | 'reassigned' | 'kept' | 'moved_room' | 'cancelled';

export const CALLOUT_REASON_LABEL: Record<CalloutReason, string> = { illness: 'Illness', transport: 'Transport', family: 'Family', other: 'Other' };

/** Why — in words a client can read. No private details, ever. */
export function disruptionReason(kind: DisruptionKind, cause: string | null | undefined, providerFirst?: string | null): string {
  if (kind === 'callout') return `${providerFirst || 'Your provider'} is unexpectedly unavailable`;
  switch (String(cause || '')) {
    case 'maintenance': return 'because of unexpected maintenance at the studio';
    case 'flood': case 'water': return 'because of water damage at the studio';
    case 'power': return 'because of a power outage at the studio';
    case 'weather': return 'for everyone’s safety, because of the weather';
    case 'safety': return 'for everyone’s safety';
    case 'fire': return 'because the studio has had to close';
    default: return 'because the studio has had to close unexpectedly';
  }
}

/** The client's message. */
export function disruptionMessage(o: { kind: DisruptionKind; cause?: string | null; providerFirst?: string | null; first: string; when: string; service?: string | null; hasDeposit: boolean; studio: string }): string {
  const why = disruptionReason(o.kind, o.cause, o.providerFirst);
  const lead = o.kind === 'callout' ? `we’re sorry — ${why} ${o.when}, so we can’t go ahead with your ${o.service || 'appointment'} as booked.` : `we’re sorry — ${why}, we can’t go ahead with your ${o.service || 'appointment'} ${o.when}.`;
  return `Hi ${o.first} — ${lead} Choose what works for you: pick a new time (no fee), or cancel with no fee${o.hasDeposit ? ' — we’ll refund your deposit or keep it as credit, your choice' : ''}.`;
}

export interface AffectedEntry {
  appointmentId: string; clientName: string | null; clientId: string | null; startTime: string; serviceName: string | null;
  staffId: string | null; renterId: string | null; isRenterBooking: boolean;
  valueCents: number; depositCents: number;
  notifiedAt: string | null; outcome: Outcome; outcomeAt?: string | null; newStartTime?: string | null; newStaffId?: string | null;
  refundCents?: number; creditCents?: number; by?: string | null;
}

/** Totals for the owner, the insurance packet and renter reimbursements. */
export function disruptionTotals(affected: Record<string, AffectedEntry> | AffectedEntry[] | null | undefined) {
  const list = Array.isArray(affected) ? affected : Object.values(affected || {});
  const t = { appointments: list.length, studio: 0, renter: 0, bookedCents: 0, depositsCents: 0, refundsCents: 0, creditsCents: 0,
    rescheduled: 0, reassigned: 0, cancelled: 0, kept: 0, pending: 0, lostCents: 0 };
  for (const a of list) {
    if (a.isRenterBooking) t.renter++; else t.studio++;
    t.bookedCents += a.valueCents || 0; t.depositsCents += a.depositCents || 0; t.refundsCents += a.refundCents || 0; t.creditsCents += a.creditCents || 0;
    if (a.outcome === 'rescheduled') t.rescheduled++; else if (a.outcome === 'reassigned') t.reassigned++; else if (a.outcome === 'cancelled') { t.cancelled++; t.lostCents += a.valueCents || 0; }
    else if (a.outcome === 'kept' || a.outcome === 'moved_room') t.kept++; else t.pending++;
  }
  return t;
}
