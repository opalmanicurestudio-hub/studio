'use client';

/**
 * useStudioEventBlocking
 * ─────────────────────────────────────────────────────────────────────────────
 * Call this hook in the event manifest page (or wherever you save a studioEvent).
 * When a studioEvent is created or activated, it writes a corresponding
 * `events` document (the same collection the planner uses for blocked time)
 * so the DayTimeline shows a block and prevents double-booking.
 *
 * It also exports `blockCalendarForEvent` and `unblockCalendarForEvent`
 * for manual call sites.
 *
 * COLLECTION MAPPING:
 *   tenants/{tenantId}/studioEvents/{eventId}   ← ticketed events
 *   tenants/{tenantId}/events/{blockId}          ← planner blocks (this is what blocks the calendar)
 *
 * The block document's id is deterministic: `studio_event_${eventId}`
 * so re-running the block is idempotent.
 */

import { useCallback } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { addMinutes, parseISO } from 'date-fns';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
export const getEventBlockId = (eventId: string) => `studio_event_${eventId}`;

/**
 * Build the calendar Event block document from a studioEvent.
 */
export const buildCalendarBlock = (studioEvent: any): Record<string, any> => {
  // Resolve start time
  let startTime: string;
  if (studioEvent.startTime) {
    startTime = typeof studioEvent.startTime === 'string'
      ? studioEvent.startTime
      : new Date(studioEvent.startTime).toISOString();
  } else if (studioEvent.date && studioEvent.time) {
    try {
      const d = new Date(studioEvent.date);
      const [timePart, meridian] = studioEvent.time.split(' ');
      const [h, m] = timePart.split(':').map(Number);
      let hours = h;
      if (meridian?.toUpperCase() === 'PM' && h !== 12) hours += 12;
      if (meridian?.toUpperCase() === 'AM' && h === 12) hours = 0;
      d.setHours(hours, m || 0, 0, 0);
      startTime = d.toISOString();
    } catch {
      const d = new Date(studioEvent.date);
      d.setHours(9, 0, 0, 0);
      startTime = d.toISOString();
    }
  } else {
    const d = studioEvent.date ? new Date(studioEvent.date) : new Date();
    d.setHours(9, 0, 0, 0);
    startTime = d.toISOString();
  }

  // Resolve end time
  let endTime: string;
  if (studioEvent.endTime) {
    endTime = typeof studioEvent.endTime === 'string'
      ? studioEvent.endTime
      : new Date(studioEvent.endTime).toISOString();
  } else {
    endTime = addMinutes(new Date(startTime), studioEvent.durationMinutes || 180).toISOString();
  }

  return {
    id:          getEventBlockId(studioEvent.id),
    title:       studioEvent.title || studioEvent.name || 'Studio Event',
    type:        'blocked',
    startTime,
    endTime,
    color:       '#7c3aed',               // violet — distinguishable from appointments
    notes:       `Studio event: ${studioEvent.title || studioEvent.name}`,
    staffIds:    ['all'],                 // blocks ALL staff columns
    isStudioEventBlock: true,
    linkedStudioEventId: studioEvent.id,
  };
};

/**
 * Write a calendar block for a studioEvent (idempotent — safe to call multiple times).
 */
export const blockCalendarForEvent = async (
  firestore: any,
  tenantId: string,
  studioEvent: any,
): Promise<void> => {
  if (!firestore || !tenantId || !studioEvent?.id) return;
  const blockId = getEventBlockId(studioEvent.id);
  const blockRef = doc(firestore, `tenants/${tenantId}/events`, blockId);
  const blockData = buildCalendarBlock(studioEvent);
  await setDoc(blockRef, blockData, { merge: false });
};

/**
 * Remove the calendar block when an event is cancelled or deleted.
 */
export const unblockCalendarForEvent = async (
  firestore: any,
  tenantId: string,
  eventId: string,
): Promise<void> => {
  if (!firestore || !tenantId || !eventId) return;
  const blockId = getEventBlockId(eventId);
  const blockRef = doc(firestore, `tenants/${tenantId}/events`, blockId);
  try {
    await deleteDoc(blockRef);
  } catch { /* already deleted — fine */ }
};

/**
 * React hook that provides helpers.
 */
export const useStudioEventBlocking = (firestore: any, tenantId: string) => {
  const block = useCallback(
    (studioEvent: any) => blockCalendarForEvent(firestore, tenantId, studioEvent),
    [firestore, tenantId]
  );

  const unblock = useCallback(
    (eventId: string) => unblockCalendarForEvent(firestore, tenantId, eventId),
    [firestore, tenantId]
  );

  return { blockCalendar: block, unblockCalendar: unblock };
};

export default useStudioEventBlocking;