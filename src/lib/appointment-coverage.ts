/**
 * appointment-coverage — when a provider cannot take a booking, the first job
 * is to find someone who can. Not to cancel the client.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * This answers "who is plausibly able to cover this?" for a manager who is
 * about to make a decision — it is a shortlist, not a promise. It reuses the
 * scheduling engine's own eligibility rules (qualifiedFor, isCertified) so the
 * shortlist can never contain someone the booking engine would have refused,
 * and it drops anyone with an overlapping appointment on the day.
 *
 * It deliberately does NOT re-run the full availability engine: rosters, day
 * hours, approved time off, pads and resource contention all live in
 * buildDayContext, which needs a page's worth of inputs. Reassigning still
 * writes through the normal path, so a genuine conflict is caught there. The
 * shortlist exists to stop a manager phoning around, not to replace the check.
 */

import { qualifiedFor, isCertified, isExcludedPairing } from '@/lib/availability';

export type CoverageCandidate = {
  id: string;
  name: string;
  avatarUrl?: string;
  /** Why they are worth offering, in the manager's words. */
  note: string;
};

const toMs = (v: any): number => {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  const d = new Date(v);
  return d.getTime();
};

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  Number.isFinite(aStart) && Number.isFinite(aEnd) && Number.isFinite(bStart) && Number.isFinite(bEnd)
  && aStart < bEnd && bStart < aEnd;

const BLOCKING_STATUSES = ['confirmed', 'servicing', 'deposit_pending', 'pending_payment', 'requested', 'ready_for_checkout'];

export function findCoverageOptions(input: {
  appointment: any;
  service: any;
  staff: any[];
  appointments: any[];
  /** Optional. When given, anyone this client should not be paired with is dropped. */
  client?: any;
}): CoverageCandidate[] {
  const { appointment, service, staff, appointments, client } = input;
  if (!appointment) return [];

  const start = toMs(appointment.startTime);
  const end = toMs(appointment.endTime);
  const currentId = String(appointment.staffId || '');

  const active = (staff || []).filter((s: any) => s && s.id && s.active !== false && s.id !== currentId);
  /* The engine's own gates, in the engine's own order. Anyone it would refuse
   * never reaches the manager as an option. */
  /* A pairing the shop has already ruled out must never be offered as cover
   * — suggesting it puts a manager one tap from undoing their own decision. */
  const eligible = qualifiedFor(service, active)
    .filter((s: any) => isCertified(service, s.id))
    .filter((s: any) => !isExcludedPairing(client, s?.id));

  const out: CoverageCandidate[] = [];
  for (const s of eligible) {
    const clash = (appointments || []).some((a: any) => {
      if (!a || a.id === appointment.id) return false;
      if (String(a.staffId || '') !== String(s.id)) return false;
      if (!BLOCKING_STATUSES.includes(String(a.status || ''))) return false;
      return overlaps(start, end, toMs(a.startTime), toMs(a.endTime));
    });
    if (clash) continue;
    out.push({
      id: String(s.id),
      name: String(s.name || 'Unnamed'),
      avatarUrl: s.avatarUrl || undefined,
      note: 'Qualified and free at this time',
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}
