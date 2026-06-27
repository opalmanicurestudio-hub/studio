'use client'
/**
 * useClientIntelligence
 *
 * Derives real-time insights for a selected client from data already
 * loaded by InventoryContext — no extra Firestore reads required.
 *
 * Usage (inside QuickBookForm or any POS component):
 *   const intel = useClientIntelligence(selectedClient, appointments, services);
 */

import { useMemo } from 'react';
import {
  differenceInDays,
  differenceInWeeks,
  parseISO,
  isWithinInterval,
  subDays,
  addDays,
  format,
} from 'date-fns';

export type ClientInsight = {
  type: 'rebooking_due' | 'no_show_risk' | 'birthday' | 'package_expiring' | 'membership_perk' | 'preferred_staff' | 'preferred_time';
  severity: 'info' | 'warning' | 'success';
  title: string;
  detail: string;
  actionLabel?: string;
  actionData?: Record<string, unknown>;
};

export type ClientIntelligence = {
  insights: ClientInsight[];
  preferredStaffId: string | null;
  preferredTimeOfDay: 'morning' | 'afternoon' | 'evening' | null;
  preferenceChips: string[];
  lastServiceId: string | null;
  lastServiceName: string | null;
  weeksSinceLastVisit: number | null;
  lifetimeVisits: number;
  isBirthdaySoon: boolean;
  birthdayInDays: number | null;
  hasNoShowHistory: boolean;
  depositRequired: boolean;
};

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  try {
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    return new Date(val);
  } catch {
    return null;
  }
};

const safeNum = (v: any) => (typeof v === 'number' && !isNaN(v) ? v : 0);

export function useClientIntelligence(
  client: any | null,
  allAppointments: any[],
  services: any[],
): ClientIntelligence {
  return useMemo<ClientIntelligence>(() => {
    const empty: ClientIntelligence = {
      insights: [],
      preferredStaffId: null,
      preferredTimeOfDay: null,
      preferenceChips: [],
      lastServiceId: null,
      lastServiceName: null,
      weeksSinceLastVisit: null,
      lifetimeVisits: 0,
      isBirthdaySoon: false,
      birthdayInDays: null,
      hasNoShowHistory: false,
      depositRequired: false,
    };

    if (!client) return empty;

    const now = new Date();
    const insights: ClientInsight[] = [];

    // ── Client appointments (completed + cancelled) ───────────────────────────
    const clientApts = (allAppointments || []).filter(
      (a) => a.clientId === client.id,
    );
    const completedApts = clientApts.filter((a) => a.status === 'completed');
    const noShowApts = clientApts.filter(
      (a) =>
        a.status === 'cancelled' &&
        (a.checkInStatus === 'no_show' || a.cancellationReason === 'no_show'),
    );

    const lifetimeVisits = completedApts.length;
    const hasNoShowHistory = noShowApts.length > 0;
    const depositRequired = noShowApts.length > 0 || safeNum(client.outstandingBalance) > 0;

    // ── Last visit & rebook cadence ───────────────────────────────────────────
    const lastApt = [...completedApts]
      .sort((a, b) => {
        const da = safeDate(a.endTime || a.startTime);
        const db = safeDate(b.endTime || b.startTime);
        return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
      })
      .at(0);

    const lastVisitDate = safeDate(lastApt?.endTime || lastApt?.startTime);
    const weeksSinceLastVisit = lastVisitDate
      ? differenceInWeeks(now, lastVisitDate)
      : null;

    const lastServiceId: string | null = client.lastServiceId ?? lastApt?.serviceId ?? null;
    const lastSvc = services.find((s) => s.id === lastServiceId);
    const lastServiceName = lastSvc?.name ?? null;

    // Rebooking cadence — use service's recommendedIntervalWeeks if set
    const recommendedWeeks: number = lastSvc?.recommendedIntervalWeeks ?? 8;
    if (
      weeksSinceLastVisit !== null &&
      weeksSinceLastVisit >= recommendedWeeks - 1 &&
      lastSvc
    ) {
      insights.push({
        type: 'rebooking_due',
        severity: weeksSinceLastVisit >= recommendedWeeks + 2 ? 'warning' : 'info',
        title: `Due for ${lastSvc.name} refresh`,
        detail: `Last visit was ${weeksSinceLastVisit}w ago — typical cycle is ${recommendedWeeks}–${recommendedWeeks + 2}w.`,
        actionLabel: 'Rebook now',
        actionData: { serviceId: lastServiceId },
      });
    }

    // ── No-show / risk flag ───────────────────────────────────────────────────
    if (hasNoShowHistory) {
      insights.push({
        type: 'no_show_risk',
        severity: 'warning',
        title: `No-show on record (${noShowApts.length}x)`,
        detail: `Deposit policy applies — ${safeNum(client.outstandingBalance) > 0 ? `$${safeNum(client.outstandingBalance).toFixed(2)} outstanding balance + ` : ''}deposit required to confirm.`,
      });
    }

    // ── Birthday ──────────────────────────────────────────────────────────────
    let isBirthdaySoon = false;
    let birthdayInDays: number | null = null;

    if (client.dateOfBirth || client.birthday) {
      try {
        const dob = safeDate(client.dateOfBirth || client.birthday);
        if (dob) {
          const thisYearBirthday = new Date(
            now.getFullYear(),
            dob.getMonth(),
            dob.getDate(),
          );
          const nextBirthday =
            thisYearBirthday < now
              ? new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate())
              : thisYearBirthday;
          birthdayInDays = differenceInDays(nextBirthday, now);
          isBirthdaySoon = birthdayInDays <= 14;

          if (isBirthdaySoon) {
            insights.push({
              type: 'birthday',
              severity: 'success',
              title:
                birthdayInDays === 0
                  ? "It's their birthday today!"
                  : `Birthday in ${birthdayInDays} day${birthdayInDays === 1 ? '' : 's'}`,
              detail: `${format(nextBirthday, 'MMMM d')} — eligible for loyalty birthday perk.`,
              actionLabel: 'Apply birthday perk',
              actionData: { perkType: 'birthday' },
            });
          }
        }
      } catch {
        // malformed date — skip
      }
    }

    // ── Package expiry ────────────────────────────────────────────────────────
    (client.activePackages || []).forEach((pkg: any) => {
      const expiry = safeDate(pkg.expiresAt);
      if (!expiry) return;
      const daysLeft = differenceInDays(expiry, now);
      if (daysLeft <= 30 && daysLeft > 0 && safeNum(pkg.sessionsRemaining) > 0) {
        insights.push({
          type: 'package_expiring',
          severity: daysLeft <= 7 ? 'warning' : 'info',
          title: `Package expiring in ${daysLeft}d`,
          detail: `${pkg.name || 'Package'} — ${pkg.sessionsRemaining} session${pkg.sessionsRemaining === 1 ? '' : 's'} left.`,
          actionLabel: 'Redeem session',
          actionData: { packageId: pkg.packageId, sessionsRemaining: pkg.sessionsRemaining },
        });
      }
    });

    // ── Membership perk ───────────────────────────────────────────────────────
    if (
      client.activeMembershipId &&
      client.subscription?.status === 'active'
    ) {
      const perksUsed = safeNum(
        Object.values(client.subscription?.perkUsage ?? {}).reduce(
          (a: number, b: any) => a + safeNum(b),
          0,
        ),
      );
      if (perksUsed === 0) {
        insights.push({
          type: 'membership_perk',
          severity: 'success',
          title: 'Membership perk available',
          detail: 'No perks used this cycle — remind them to redeem before renewal.',
          actionLabel: 'Apply perk',
        });
      }
    }

    // ── Preferred staff (most common staffId in completed apts) ──────────────
    const staffCounts: Record<string, number> = {};
    completedApts.forEach((a) => {
      if (a.staffId) staffCounts[a.staffId] = (staffCounts[a.staffId] ?? 0) + 1;
    });
    const preferredStaffId =
      Object.entries(staffCounts).sort((a, b) => b[1] - a[1]).at(0)?.[0] ?? null;

    // ── Preferred time of day ─────────────────────────────────────────────────
    let morning = 0, afternoon = 0, evening = 0;
    completedApts.forEach((a) => {
      const d = safeDate(a.startTime);
      if (!d) return;
      const h = d.getHours();
      if (h < 12) morning++;
      else if (h < 17) afternoon++;
      else evening++;
    });
    const preferredTimeOfDay =
      morning === 0 && afternoon === 0 && evening === 0
        ? null
        : morning >= afternoon && morning >= evening
        ? 'morning'
        : afternoon >= evening
        ? 'afternoon'
        : 'evening';

    // ── Preference chips (from stored fields) ─────────────────────────────────
    const preferenceChips: string[] = [];
    if (preferredStaffId && staffCounts[preferredStaffId] >= 2) {
      // resolved to name outside this hook
      preferenceChips.push(`__staff:${preferredStaffId}`);
    }
    if (client.sensoryNeeds) preferenceChips.push(client.sensoryNeeds);
    if (client.colorNotes) preferenceChips.push('Colour notes on file');
    if (client.allergies) preferenceChips.push('Allergy alert');
    if (preferredTimeOfDay) preferenceChips.push(`Prefers ${preferredTimeOfDay}`);

    return {
      insights,
      preferredStaffId,
      preferredTimeOfDay,
      preferenceChips,
      lastServiceId,
      lastServiceName,
      weeksSinceLastVisit,
      lifetimeVisits,
      isBirthdaySoon,
      birthdayInDays,
      hasNoShowHistory,
      depositRequired,
    };
  }, [client, allAppointments, services]);
}
