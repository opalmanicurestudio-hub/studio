// src/lib/change-rules.ts — CAN THIS BOOKING BE MOVED, AND WHICH DEADLINE COUNTS?
//
// One check, asked by every path that moves or cancels a booking (the client's
// visit link, the older manage page, the booking page's "move my visit", the
// client portal, the planner and the front desk) — so the business's rules from
// Booking policies apply the same way everywhere:
//   · no client changes inside the change cutoff
//   · N changes, then staff approval (or "please call us")
//   · the notice deadline stays with the ORIGINAL time (default), so moving a
//     booking can't push the cancellation deadline back
// Staff are never blocked — they're told the rule, and going past it is recorded.
// Pure: safe on the server and in the browser.

import { resolvePolicy } from '@/lib/booking-policies';

const ms = (v: any) => { const t = typeof v === 'string' ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN; return Number.isFinite(t) ? t : NaN; };

/** The start time deadlines are measured from: the earliest time this booking
 *  was ever at ('original' — the default), or simply its current time ('new'). */
export function deadlineStart(tenant: any, appt: any, service?: any): Date {
  const cur = ms(appt?.startTime);
  const orig = ms(appt?.originalStartTime);
  const mode = resolvePolicy(tenant, service).change.deadline.value;
  const t = mode === 'original' && Number.isFinite(orig) && (!Number.isFinite(cur) || orig < cur) ? orig : cur;
  return new Date(Number.isFinite(t) ? t : Date.now());
}

/** Hours until the deadline start (negative once it has passed). */
export const hoursToDeadline = (tenant: any, appt: any, service?: any, now = Date.now()) => (deadlineStart(tenant, appt, service).getTime() - now) / 3600000;

export interface ChangeCheck {
  allowed: boolean;               // can go ahead now
  needsApproval: boolean;         // over the limit and the business wants to approve
  blocked: boolean;               // over the limit and the business wants a call
  reason: string | null;          // plain words for the client or staff
  staffNote: string | null;       // what staff should know (they're never blocked)
  count: number; limit: number; cutoffHours: number;
}

/** May `who` move this booking now? */
export function checkChange(tenant: any, appt: any, who: 'client' | 'staff', service?: any, now = Date.now()): ChangeCheck {
  const P = resolvePolicy(tenant, service).change;
  const count = Math.max(0, Number(appt?.rescheduleCount) || 0), limit = Math.max(0, Number(P.limit.value) || 0), cutoffHours = Math.max(0, Number(P.cutoffHours.value) || 0);
  const start = ms(appt?.startTime);
  const insideCutoff = cutoffHours > 0 && Number.isFinite(start) && start - now < cutoffHours * 3600000;
  const overLimit = limit > 0 && count >= limit;
  const out: ChangeCheck = { allowed: true, needsApproval: false, blocked: false, reason: null, staffNote: null, count, limit, cutoffHours };
  if (who === 'staff') {
    const notes = [insideCutoff && `inside the ${cutoffHours}-hour change cutoff`, overLimit && `already moved ${count} time${count === 1 ? '' : 's'} (limit ${limit})`].filter(Boolean);
    out.staffNote = notes.length ? `Past your policy — ${notes.join(' and ')}. You can still move it; it’s recorded.` : null;
    return out;
  }
  if (insideCutoff) return { ...out, allowed: false, reason: `Changes online close ${cutoffHours} hour${cutoffHours === 1 ? '' : 's'} before your appointment — please call or message us.` };
  if (overLimit) {
    const approval = P.overLimit.value === 'approval';
    return { ...out, allowed: false, needsApproval: approval, blocked: !approval,
      reason: approval ? `This booking has already been moved ${count} time${count === 1 ? '' : 's'}, so the next change needs our OK — we’ll get back to you.` : `This booking has already been moved ${count} time${count === 1 ? '' : 's'} — please call or message us to change it again.` };
  }
  return out;
}

/** Fields to write on the moved (or replacement) booking: the chain's original time and the count. */
export function chainAfterMove(appt: any): { originalStartTime: string | null; rescheduleCount: number } {
  const orig = ms(appt?.originalStartTime), cur = ms(appt?.startTime);
  const earliest = [orig, cur].filter(Number.isFinite).sort((a, b) => a - b)[0];
  return { originalStartTime: Number.isFinite(earliest) ? new Date(earliest as number).toISOString() : null, rescheduleCount: Math.max(0, Number(appt?.rescheduleCount) || 0) + 1 };
}
