'use client'
/**
 * useWaitlist — v2
 *
 * v2 — THE TWO LISTS WERE THE SAME COLLECTION.
 *
 * v1's header said this out loud as though it were a feature:
 *
 *     "Firebase path: tenants/{tenantId}/walkIns (status: 'waitlist')
 *      No new collection needed — re-uses your existing walkIns structure."
 *
 * That one decision is the source of essentially every confusing thing on the
 * floor board, because `walkIns` is not a generic bucket — it is the live
 * queue of people physically standing in the studio right now, and the floor
 * board, the lobby wall screen, the staff portal and the planner all read it.
 *
 * The damage ran in both directions, through a single shared status word:
 *
 *     .filter(w => w.status === 'waitlist' || w.status === 'notified')
 *
 *   → A WALK-IN CALLED FORWARD appears in the waitlist panel. The desk calls
 *     a guest to a chair, her row flips to `notified`, and this filter picks
 *     her up as a waitlist entry. That is the guest showing up twice on one
 *     screen — once in the Called lane, once in the panel below it, tagged
 *     "NOTIFIED · WAITING".
 *
 *   → A WAITLIST CLIENT OFFERED A SLOT appears on the floor board. She is at
 *     home being told a Thursday slot opened, her row flips to `notified`, and
 *     the board renders her in the Called lane as though she were standing in
 *     the lobby waiting for a chair that was never meant for her.
 *
 * And because /api/waitlist writes the kiosk's "notify me when something
 * opens" rows to tenants/{id}/waitlist — a DIFFERENT collection, which the
 * planner's WaitlistSheet reads — the studio has been running two unconnected
 * waiting lists that cannot see each other. A guest who tapped notify-me at
 * the kiosk landed in the planner's sheet and never appeared in this panel;
 * a client added here appeared in this panel and never reached the planner.
 *
 * v2 moves this hook onto tenants/{id}/waitlist, where the other half of the
 * list already lives. That is the entire fix. The status vocabulary is
 * deliberately unchanged — `notified` was never the problem, sharing a
 * COLLECTION with the live floor queue was — so WaitlistManager needs no
 * changes at all.
 *
 * ONE CALL-SITE CHANGE. The hook now takes `waitlist` instead of `walkIns`:
 *
 *     const waitlist = useWaitlist({
 *       tenantId, firestore,
 *       waitlist: waitlistEntries,     // tenants/{id}/waitlist
 *       ...
 *     });
 *
 * The derived list now also includes rows with status `waiting`, which is what
 * /api/waitlist writes and what the planner's own count already treats as
 * open — so kiosk notify-me rows and desk-added rows finally appear in the
 * same list.
 *
 * ALSO FIXED
 *   - bookFromWaitlist wrote `clientId: entry.clientId || entry.id`, putting a
 *     waitlist entry's id into an appointment's clientId when the entry had no
 *     client attached. That is a reference to a client document that does not
 *     exist. Null now.
 *   - Timestamps were parsed with a bare `new Date(...)`, which yields Invalid
 *     Date on a Firestore Timestamp and sorts the list at random. safeDate.
 *   - checkInToken was a default 21-character nanoid; every other booking path
 *     mints nanoid(16). Matched, so tokens are one shape everywhere.
 *   - Field reads fall back across both writers (clientName/customerName,
 *     clientPhone/customerPhone), so rows from /api/waitlist and rows from
 *     this hook both render.
 *   - Unused imports (increment, parseISO) removed.
 *   - An expired hold is surfaced as `isHoldExpired` rather than silently
 *     continuing to look like a live offer.
 *
 * STILL OPEN — bookFromWaitlist does not write an appointmentCheckIns/{token}
 * index document, so an appointment booked from the waitlist cannot be found
 * by scanning its ticket. Every other booking path writes one. The exact
 * projection shape lives in /api/appointments/book; matching it is a small
 * follow-up, not a guess worth making here.
 */

import { useCallback, useMemo } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { addMinutes, format } from 'date-fns';
import { nanoid } from 'nanoid';

const sanitize = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitize(v)]),
  );
};

/**
 * Rows reach this list from two writers — /api/waitlist (ISO strings) and this
 * hook (ISO strings), with older rows possibly carrying Firestore Timestamps.
 * A bare `new Date(timestamp)` returns Invalid Date on the third shape, whose
 * getTime() is NaN, and a NaN comparator scrambles the sort silently.
 */
const safeDate = (val: any): Date => {
  if (!val) return new Date(0);
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date(0) : val;
  if (typeof val?.toDate === 'function') {
    try { const d = val.toDate(); return isNaN(d.getTime()) ? new Date(0) : d; } catch { return new Date(0); }
  }
  if (typeof val === 'number') { const d = new Date(val); return isNaN(d.getTime()) ? new Date(0) : d; }
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? new Date(0) : d;
};

export type WaitlistEntry = {
  id: string;
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  serviceIds: string[];
  preferredStaffId?: string;
  preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'any';
  preferredDate?: string;
  notes?: string;
  addedAt: string;
  notifiedAt?: string;
  holdExpiresAt?: string;
  isHoldExpired?: boolean;
  status: 'waitlist' | 'waiting' | 'notified' | 'booked' | 'expired' | 'cancelled';
};

export type AddToWaitlistInput = Omit<
  WaitlistEntry,
  'id' | 'addedAt' | 'status' | 'isHoldExpired'
>;

const HOLD_MINUTES = 15;

/** Statuses that mean "this person is still hoping for a slot". */
const OPEN_STATUSES = ['waitlist', 'waiting', 'notified'];

export function useWaitlist(params: {
  tenantId: string | undefined;
  firestore: any;
  /**
   * v2 — tenants/{id}/waitlist, NOT walkIns. See the header: reading walkIns
   * is what put called guests in this list and waitlist clients on the floor
   * board.
   */
  waitlist: any[];
  appointments: any[];
  services: any[];
  staff: any[];
  tenant: any;
  toast: (opts: { title: string; description?: string; variant?: string }) => void;
}) {
  const { tenantId, firestore, waitlist, services, tenant, toast } = params;

  const collectionPath = tenantId ? `tenants/${tenantId}/waitlist` : null;

  // ── Derived waitlist ───────────────────────────────────────────────────────
  const waitlistClients = useMemo<WaitlistEntry[]>(() => {
    const nowMs = Date.now();
    return (waitlist || [])
      .filter((w: any) => OPEN_STATUSES.includes(String(w?.status || 'waiting')))
      .sort(
        (a: any, b: any) =>
          safeDate(a.addedAt || a.createdAt || a.checkInTime).getTime() -
          safeDate(b.addedAt || b.createdAt || b.checkInTime).getTime(),
      )
      .map((w: any) => {
        const hold = w.holdExpiresAt ? safeDate(w.holdExpiresAt).getTime() : 0;
        return {
          id: w.id,
          clientId: w.clientId,
          clientName: w.clientName || w.customerName || 'Client',
          clientPhone: w.clientPhone || w.customerPhone,
          clientEmail: w.clientEmail || w.customerEmail,
          serviceIds: w.serviceIds || (w.serviceId ? [w.serviceId] : []),
          preferredStaffId: w.preferredStaffId,
          preferredTimeOfDay: w.preferredTimeOfDay,
          preferredDate: w.preferredDate,
          notes: w.notes || w.note,
          addedAt: safeDate(w.addedAt || w.createdAt || w.checkInTime).toISOString(),
          notifiedAt: w.notifiedAt || w.notifiedTimestamp,
          holdExpiresAt: w.holdExpiresAt,
          isHoldExpired: hold > 0 && hold < nowMs,
          status: w.status,
        };
      });
  }, [waitlist]);

  // ── Add to waitlist ────────────────────────────────────────────────────────
  const addToWaitlist = useCallback(
    async (input: AddToWaitlistInput) => {
      if (!firestore || !collectionPath) return null;
      const id = nanoid();
      const now = new Date().toISOString();
      const entry = sanitize({
        id,
        tenantId,
        // Both spellings, because /api/waitlist rows and desk-added rows are
        // now read side by side and different surfaces reach for different
        // field names.
        clientName: input.clientName,
        customerName: input.clientName,
        clientPhone: input.clientPhone || null,
        customerPhone: input.clientPhone || null,
        clientEmail: input.clientEmail || null,
        customerEmail: input.clientEmail || null,
        clientId: input.clientId || null,
        serviceIds: input.serviceIds,
        serviceId: input.serviceIds[0] || null,
        preferredStaffId: input.preferredStaffId || null,
        preferredTimeOfDay: input.preferredTimeOfDay || 'any',
        preferredDate: input.preferredDate || null,
        notes: input.notes || null,
        status: 'waiting',
        addedAt: now,
        createdAt: now,
        source: 'front-desk',
        estimatedDuration: input.serviceIds.reduce((acc, sid) => {
          const svc = services.find((s: any) => s.id === sid);
          return acc + (svc?.duration || 0) + (svc?.padBefore || 0) + (svc?.padAfter || 0);
        }, 0),
      });
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, collectionPath, id), entry);
      try {
        await batch.commit();
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Could not add to waitlist', description: e?.message || 'Nothing was saved.' });
        return null;
      }
      toast({ title: 'Added to waitlist', description: `${input.clientName} · will be notified when a slot opens.` });
      return id;
    },
    [firestore, tenantId, collectionPath, services, toast],
  );

  // ── Notify a waitlist client and start the hold timer ──────────────────────
  const notifyWaitlistClient = useCallback(
    async (entry: WaitlistEntry, slotDate: string, slotTime: string) => {
      if (!firestore || !collectionPath) return;
      const nowIso = new Date().toISOString();
      const holdExpiresAt = addMinutes(new Date(), HOLD_MINUTES).toISOString();
      const batch = writeBatch(firestore);
      batch.set(
        doc(firestore, collectionPath, entry.id),
        sanitize({
          status: 'notified',
          notifiedAt: nowIso,
          notifiedTimestamp: nowIso,
          holdExpiresAt,
        }),
        { merge: true },
      );
      try {
        await batch.commit();
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Could not notify', description: e?.message || 'Nothing was saved.' });
        return;
      }

      if (entry.clientPhone || entry.clientEmail) {
        const svcName =
          services.find((s: any) => s.id === entry.serviceIds[0])?.name || 'your service';
        const slotAt = safeDate(`${slotDate}T${slotTime}`);
        const slotLabel = slotAt.getTime() ? format(slotAt, 'EEE MMM d · h:mm a') : `${slotDate} ${slotTime}`;
        try {
          await fetch('/api/notifications/send-waitlist-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientName: entry.clientName,
              clientPhone: entry.clientPhone,
              clientEmail: entry.clientEmail,
              serviceName: svcName,
              slotLabel,
              holdMinutes: HOLD_MINUTES,
              studioName: tenant?.name || 'Studio',
            }),
          });
        } catch {
          // Non-fatal — the hold is already recorded.
        }
      }

      toast({
        title: 'Client notified',
        description: `${entry.clientName} has ${HOLD_MINUTES}m to confirm.`,
      });
    },
    [firestore, collectionPath, services, tenant, toast],
  );

  // ── Book from waitlist — creates a confirmed appointment ──────────────────
  const bookFromWaitlist = useCallback(
    async (
      entry: WaitlistEntry,
      bookParams: {
        staffId: string;
        date: string;
        time: string;
        sendLink?: boolean;
      },
    ) => {
      if (!firestore || !tenantId || !collectionPath) return;
      const now = new Date().toISOString();
      const aptId = nanoid();
      // nanoid(16) to match /api/appointments/book and the walk-in engine.
      const checkInToken = nanoid(16);
      const startTime = safeDate(`${bookParams.date}T${bookParams.time}:00`);
      if (!startTime.getTime()) {
        toast({ variant: 'destructive', title: 'Invalid date or time' });
        return;
      }
      const primarySvc = services.find((s: any) => s.id === entry.serviceIds[0]);
      const endTime = addMinutes(startTime, primarySvc?.duration || 60);

      const batch = writeBatch(firestore);

      batch.set(
        doc(firestore, `tenants/${tenantId}/appointments`, aptId),
        sanitize({
          id: aptId,
          tenantId,
          // Null, not entry.id. A waitlist entry id is not a client id, and
          // writing one here pointed the appointment at a client document
          // that has never existed.
          clientId: entry.clientId || null,
          clientName: entry.clientName,
          clientPhone: entry.clientPhone || null,
          clientEmail: entry.clientEmail || null,
          serviceId: entry.serviceIds[0],
          serviceName: primarySvc?.name || null,
          addOnIds: entry.serviceIds.slice(1),
          staffId: bookParams.staffId,
          checkInToken,
          status: 'confirmed',
          checkInStatus: 'pending',
          source: 'waitlist',
          waitlistEntryId: entry.id,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          estimatedDuration: primarySvc?.duration || 60,
          createdAt: now,
          updatedAt: now,
          reminderSent: false,
          autoCancelledNoShow: false,
          notes: entry.notes || null,
        }),
      );

      batch.set(
        doc(firestore, collectionPath, entry.id),
        sanitize({ status: 'booked', bookedAppointmentId: aptId, bookedAt: now }),
        { merge: true },
      );

      if (entry.clientId) {
        batch.set(
          doc(firestore, `tenants/${tenantId}/clients`, entry.clientId),
          { lastAppointment: now },
          { merge: true },
        );
      }

      try {
        await batch.commit();
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Booking failed', description: e?.message || 'Nothing was saved.' });
        return;
      }
      toast({
        title: 'Booked from waitlist',
        description: `${entry.clientName} · ${format(startTime, 'EEE MMM d · h:mm a')}`,
      });
      return aptId;
    },
    [firestore, tenantId, collectionPath, services, toast],
  );

  // ── Remove from waitlist ───────────────────────────────────────────────────
  const removeFromWaitlist = useCallback(
    async (entryId: string) => {
      if (!firestore || !collectionPath) return;
      const batch = writeBatch(firestore);
      batch.set(
        doc(firestore, collectionPath, entryId),
        sanitize({ status: 'cancelled', cancelledAt: new Date().toISOString() }),
        { merge: true },
      );
      try {
        await batch.commit();
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Could not remove', description: e?.message || 'Nothing was saved.' });
        return;
      }
      toast({ title: 'Removed from waitlist' });
    },
    [firestore, collectionPath, toast],
  );

  // ── Auto-fill on cancellation ──────────────────────────────────────────────
  const autoFillOnCancellation = useCallback(
    (freedSlot: {
      staffId: string;
      date: string;
      time: string;
      serviceId: string;
    }): WaitlistEntry | null => {
      const slotHour = parseInt(String(freedSlot.time).split(':')[0], 10);
      const timeOfDay =
        slotHour < 12 ? 'morning' : slotHour < 17 ? 'afternoon' : 'evening';

      const scored = waitlistClients
        // Someone already holding a live offer is not a candidate for a second
        // slot; someone whose hold lapsed is back in the running.
        .filter((w) => w.status !== 'notified' || w.isHoldExpired)
        .map((w) => {
          let score = 0;
          if (w.serviceIds.includes(freedSlot.serviceId)) score += 10;
          if (!w.preferredStaffId || w.preferredStaffId === freedSlot.staffId) score += 5;
          if (!w.preferredTimeOfDay || w.preferredTimeOfDay === 'any' || w.preferredTimeOfDay === timeOfDay) score += 3;
          if (!w.preferredDate || w.preferredDate === freedSlot.date) score += 5;
          const waitMins = (Date.now() - safeDate(w.addedAt).getTime()) / 60000;
          score += Math.min(waitMins / 60, 5);
          return { entry: w, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

      return scored.at(0)?.entry ?? null;
    },
    [waitlistClients],
  );

  return {
    waitlistClients,
    addToWaitlist,
    notifyWaitlistClient,
    bookFromWaitlist,
    removeFromWaitlist,
    autoFillOnCancellation,
  };
}
