/**
 * useWaitlist
 *
 * Manages the waitlist queue in tenants/{id}/walkIns with status='waitlist'.
 * Provides:
 *   - waitlistClients: filtered + sorted waitlist entries
 *   - addToWaitlist: write a new waitlist entry
 *   - notifyWaitlistClient: SMS via your existing /api/notifications endpoint
 *   - bookFromWaitlist: promote a waitlist entry into a confirmed appointment
 *   - removeFromWaitlist: cancel/remove
 *   - autoFillOnCancellation: call when a slot opens to find the best match
 *
 * Firebase path: tenants/{tenantId}/walkIns (status: 'waitlist')
 * No new collection needed — re-uses your existing walkIns structure.
 */

import { useCallback, useMemo } from 'react';
import {
  doc,
  collection,
  writeBatch,
  increment,
} from 'firebase/firestore';
import { addMinutes, format, parseISO } from 'date-fns';
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

export type WaitlistEntry = {
  id: string;
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  serviceIds: string[];
  preferredStaffId?: string;
  preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'any';
  preferredDate?: string; // 'yyyy-MM-dd' or null = any day
  notes?: string;
  addedAt: string;
  notifiedAt?: string;
  holdExpiresAt?: string; // set when client is notified; slot held for N min
  status: 'waitlist' | 'notified' | 'booked' | 'expired' | 'cancelled';
};

export type AddToWaitlistInput = Omit<
  WaitlistEntry,
  'id' | 'addedAt' | 'status'
>;

const HOLD_MINUTES = 15; // how long a slot is held after notifying

export function useWaitlist(params: {
  tenantId: string | undefined;
  firestore: any;
  walkIns: any[];
  appointments: any[];
  services: any[];
  staff: any[];
  tenant: any;
  toast: (opts: { title: string; description?: string; variant?: string }) => void;
}) {
  const { tenantId, firestore, walkIns, appointments, services, staff, tenant, toast } = params;

  // ── Derived waitlist ───────────────────────────────────────────────────────
  const waitlistClients = useMemo<WaitlistEntry[]>(() => {
    return (walkIns || [])
      .filter((w: any) => w.status === 'waitlist' || w.status === 'notified')
      .sort(
        (a: any, b: any) =>
          new Date(a.addedAt || a.checkInTime).getTime() -
          new Date(b.addedAt || b.checkInTime).getTime(),
      )
      .map((w: any) => ({
        id: w.id,
        clientId: w.clientId,
        clientName: w.customerName,
        clientPhone: w.customerPhone,
        clientEmail: w.customerEmail,
        serviceIds: w.serviceIds || [],
        preferredStaffId: w.preferredStaffId,
        preferredTimeOfDay: w.preferredTimeOfDay,
        preferredDate: w.preferredDate,
        notes: w.notes,
        addedAt: w.addedAt || w.checkInTime,
        notifiedAt: w.notifiedTimestamp,
        holdExpiresAt: w.holdExpiresAt,
        status: w.status,
      }));
  }, [walkIns]);

  // ── Add to waitlist ────────────────────────────────────────────────────────
  const addToWaitlist = useCallback(
    async (input: AddToWaitlistInput) => {
      if (!firestore || !tenantId) return null;
      const id = nanoid();
      const now = new Date().toISOString();
      const entry = sanitize({
        id,
        tenantId,
        customerName: input.clientName,
        customerPhone: input.clientPhone || null,
        customerEmail: input.clientEmail || null,
        clientId: input.clientId || null,
        serviceIds: input.serviceIds,
        preferredStaffId: input.preferredStaffId || null,
        preferredTimeOfDay: input.preferredTimeOfDay || 'any',
        preferredDate: input.preferredDate || null,
        notes: input.notes || null,
        status: 'waitlist',
        checkInTime: now,
        addedAt: now,
        estimatedDuration: input.serviceIds.reduce((acc, sid) => {
          const svc = services.find((s: any) => s.id === sid);
          return acc + (svc?.duration || 0) + (svc?.padBefore || 0) + (svc?.padAfter || 0);
        }, 0),
        requiredSkills: [],
        groupId: id,
      });
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, `tenants/${tenantId}/walkIns`, id), entry);
      await batch.commit();
      toast({ title: 'Added to waitlist', description: `${input.clientName} · will be notified when a slot opens.` });
      return id;
    },
    [firestore, tenantId, services, toast],
  );

  // ── Notify a waitlist client (SMS) and start hold timer ───────────────────
  const notifyWaitlistClient = useCallback(
    async (entry: WaitlistEntry, slotDate: string, slotTime: string) => {
      if (!firestore || !tenantId) return;
      const holdExpiresAt = addMinutes(new Date(), HOLD_MINUTES).toISOString();
      const batch = writeBatch(firestore);
      batch.set(
        doc(firestore, `tenants/${tenantId}/walkIns`, entry.id),
        sanitize({ status: 'notified', notifiedTimestamp: new Date().toISOString(), holdExpiresAt }),
        { merge: true },
      );
      await batch.commit();

      // Fire SMS via existing notification endpoint
      if (entry.clientPhone || entry.clientEmail) {
        const svcName =
          services.find((s: any) => s.id === entry.serviceIds[0])?.name || 'your service';
        const slotLabel = format(
          new Date(`${slotDate}T${slotTime}`),
          'EEE MMM d · h:mm a',
        );
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
          // Non-fatal — slot is still marked notified in Firestore
        }
      }

      toast({
        title: 'Client notified',
        description: `${entry.clientName} has ${HOLD_MINUTES}m to confirm.`,
      });
    },
    [firestore, tenantId, services, tenant, toast],
  );

  // ── Book from waitlist — creates a confirmed appointment ──────────────────
  const bookFromWaitlist = useCallback(
    async (
      entry: WaitlistEntry,
      params: {
        staffId: string;
        date: string;
        time: string;
        sendLink?: boolean;
      },
    ) => {
      if (!firestore || !tenantId) return;
      const { nanoid: _nanoid } = await import('nanoid');
      const now = new Date().toISOString();
      const aptId = _nanoid();
      const checkInToken = _nanoid();
      const startTime = new Date(`${params.date}T${params.time}:00`);
      const primarySvc = services.find((s: any) => s.id === entry.serviceIds[0]);
      const endTime = addMinutes(startTime, primarySvc?.duration || 60);

      const batch = writeBatch(firestore);

      // Create appointment
      batch.set(
        doc(firestore, `tenants/${tenantId}/appointments`, aptId),
        sanitize({
          id: aptId,
          tenantId,
          clientId: entry.clientId || entry.id,
          clientName: entry.clientName,
          serviceId: entry.serviceIds[0],
          addOnIds: entry.serviceIds.slice(1),
          staffId: params.staffId,
          checkInToken,
          status: 'confirmed',
          source: 'waitlist',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          createdAt: now,
          reminderSent: false,
          autoCancelledNoShow: false,
          notes: entry.notes || null,
        }),
      );

      // Mark walkIn as booked
      batch.set(
        doc(firestore, `tenants/${tenantId}/walkIns`, entry.id),
        sanitize({ status: 'booked', bookedAppointmentId: aptId, bookedAt: now }),
        { merge: true },
      );

      // Update client's lastAppointment
      if (entry.clientId) {
        batch.set(
          doc(firestore, `tenants/${tenantId}/clients`, entry.clientId),
          { lastAppointment: now },
          { merge: true },
        );
      }

      await batch.commit();
      toast({
        title: 'Booked from waitlist',
        description: `${entry.clientName} · ${format(startTime, 'EEE MMM d · h:mm a')}`,
      });
      return aptId;
    },
    [firestore, tenantId, services, toast],
  );

  // ── Remove from waitlist ───────────────────────────────────────────────────
  const removeFromWaitlist = useCallback(
    async (entryId: string) => {
      if (!firestore || !tenantId) return;
      const batch = writeBatch(firestore);
      batch.set(
        doc(firestore, `tenants/${tenantId}/walkIns`, entryId),
        sanitize({ status: 'cancelled', cancelledAt: new Date().toISOString() }),
        { merge: true },
      );
      await batch.commit();
      toast({ title: 'Removed from waitlist' });
    },
    [firestore, tenantId, toast],
  );

  // ── Auto-fill on cancellation ──────────────────────────────────────────────
  // Call this when an appointment is cancelled or a slot opens.
  // Returns the best-matching waitlist entry (if any) for the freed slot.
  const autoFillOnCancellation = useCallback(
    (freedSlot: {
      staffId: string;
      date: string;
      time: string;
      serviceId: string;
    }): WaitlistEntry | null => {
      const slotHour = parseInt(freedSlot.time.split(':')[0], 10);
      const timeOfDay =
        slotHour < 12 ? 'morning' : slotHour < 17 ? 'afternoon' : 'evening';

      // Score each waitlist entry for this slot
      const scored = waitlistClients
        .filter((w) => w.status === 'waitlist')
        .map((w) => {
          let score = 0;
          // Service match
          if (w.serviceIds.includes(freedSlot.serviceId)) score += 10;
          // Staff preference
          if (!w.preferredStaffId || w.preferredStaffId === freedSlot.staffId) score += 5;
          // Time of day preference
          if (!w.preferredTimeOfDay || w.preferredTimeOfDay === 'any' || w.preferredTimeOfDay === timeOfDay) score += 3;
          // Date preference
          if (!w.preferredDate || w.preferredDate === freedSlot.date) score += 5;
          // Wait time (longer wait = higher priority)
          const waitMins =
            (Date.now() - new Date(w.addedAt).getTime()) / 60000;
          score += Math.min(waitMins / 60, 5); // up to 5 bonus pts for waiting > 5h
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
