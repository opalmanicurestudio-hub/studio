/**
 * coverage-plan — one provider cannot work. What happens to their day?
 *
 * WHY THIS IS NOT SIX TRIPS THROUGH THE RESOLVE SHEET
 * A call-out is not six independent problems, it is one problem with six
 * consequences, and the decisions interact: reassigning the 10am to Jasmine
 * changes whether Jasmine can also take the 11am. Handling them one at a time
 * means the fourth decision is made against a picture that the first three
 * already invalidated.
 *
 * So the plan is built in one pass, in start order, and every reassignment is
 * fed back into the busy set before the next appointment is considered. What a
 * manager sees is a plan, not a queue.
 *
 * It reuses the scheduling engine's own gates through findCoverageOptions, so
 * the shortlist can never contain somebody the booking engine would refuse.
 */

import { findCoverageOptions, type CoverageCandidate } from '@/lib/appointment-coverage';
import { isDeadAppointment } from '@/lib/booking-approval';

export type CoverageOutcome = 'reassign' | 'move' | 'no_cover';

export type CoverageRow = {
  appointment: any;
  serviceName: string;
  candidates: CoverageCandidate[];
  /** What the plan suggests. The manager can always choose differently. */
  suggested: CoverageOutcome;
  /** Pre-selected when the suggestion is to reassign. */
  pick: string | null;
};

export type CoveragePlan = {
  rows: CoverageRow[];
  covered: number;
  needsMoving: number;
  atRisk: number;
  valueAtRisk: number;
};

const toMs = (v: any): number => {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  return new Date(v).getTime();
};

const sameDay = (a: any, b: Date): boolean => {
  const d = new Date(toMs(a));
  return Number.isFinite(d.getTime())
    && d.getFullYear() === b.getFullYear()
    && d.getMonth() === b.getMonth()
    && d.getDate() === b.getDate();
};

export function buildCoveragePlan(input: {
  staffId: string;
  date: Date;
  appointments: any[];
  services: any[];
  staff: any[];
}): CoveragePlan {
  const { staffId, date, appointments, services, staff } = input;

  const affected = (appointments || [])
    .filter(a => a && String(a.staffId || '') === String(staffId))
    .filter(a => sameDay(a.startTime, date))
    .filter(a => !isDeadAppointment(a))
    .filter(a => !['completed', 'servicing'].includes(String(a.status || '')))
    .sort((a, b) => toMs(a.startTime) - toMs(b.startTime));

  /* Provisional bookings: as the plan assigns cover, those slots stop being
   * free for the next appointment in the list. Without this the plan happily
   * gives Jasmine three overlapping appointments and a manager finds out at
   * the third phone call. */
  const provisional: any[] = [];
  const rows: CoverageRow[] = [];

  for (const apt of affected) {
    const service = (services || []).find((s: any) => s.id === apt.serviceId) || null;
    const candidates = findCoverageOptions({
      appointment: apt,
      service,
      staff,
      appointments: [...(appointments || []), ...provisional],
    });

    const suggested: CoverageOutcome = candidates.length > 0 ? 'reassign' : 'no_cover';
    const pick = candidates.length > 0 ? candidates[0].id : null;

    if (pick) {
      provisional.push({
        id: `provisional-${apt.id}`,
        staffId: pick,
        status: 'confirmed',
        startTime: apt.startTime,
        endTime: apt.endTime,
      });
    }

    rows.push({
      appointment: apt,
      serviceName: service?.name || apt.serviceName || 'Service',
      candidates,
      suggested,
      pick,
    });
  }

  const priceOf = (apt: any): number => {
    const svc = (services || []).find((s: any) => s.id === apt.serviceId);
    const addOns = (apt.addOnIds || [])
      .map((id: string) => (services || []).find((s: any) => s.id === id))
      .filter(Boolean);
    return Number(svc?.price || 0)
      + addOns.reduce((sum: number, s: any) => sum + Number(s?.price || 0), 0);
  };

  return {
    rows,
    covered: rows.filter(r => r.suggested === 'reassign').length,
    needsMoving: rows.filter(r => r.suggested === 'move').length,
    atRisk: rows.filter(r => r.suggested === 'no_cover').length,
    /* Only the ones nobody can take. Everything else keeps its money. */
    valueAtRisk: rows
      .filter(r => r.suggested === 'no_cover')
      .reduce((sum, r) => sum + priceOf(r.appointment), 0),
  };
}
