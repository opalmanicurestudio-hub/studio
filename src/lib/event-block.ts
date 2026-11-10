// src/lib/event-block.ts — AN EVENT HELD ON THE CALENDAR. An event (studioEvents) keeps the team on it away from their
// usual bookings, so it puts a block on the planner (tenants/{t}/events/studio_event_{id}, a 'blocked' time the
// planner and the booking pages already respect): its day and hours on the business's own clock, for the team on it
// (everyone, when nobody's named). With no start time, or one with no known length where it should hold the day (an
// event made from a quote with no hours, as its acceptance did), the whole day; otherwise three hours unless its
// length is set. Pure; the caller writes it (a new one whole; a change only in the fields here, so anything the planner
// keeps on it stays), and removes it when the event is deleted.

import { wallToUtc, dayKey } from '@/lib/tenant-time';

/** The fields a change to the event moves on its hold (written with merge). */
export const BLOCK_TIME_FIELDS = ['title', 'startTime', 'endTime', 'allDay', 'staffIds', 'isStudioEventBlock', 'linkedStudioEventId', 'type'] as const;
export const blockTimes = (b: Record<string, any>) => Object.fromEntries(BLOCK_TIME_FIELDS.filter((k) => k in b).map((k) => [k, b[k]]));

export const eventBlockId = (eventId: string) => `studio_event_${eventId}`;

/** "19:00", "7:00 PM", "7pm" → [19, 0]; anything else → null. */
export function readTime(t: any): [number, number] | null {
  const s = String(t || '').trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h <= 23 && min <= 59 ? [h, min] : null;
}

/** The event's day as YYYY-MM-DD: kept as the day itself, or as a moment read on the business's clock. */
export function eventDay(ev: any, timeZone: string | null): string | null {
  const v = String(ev?.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? dayKey(new Date(t), timeZone) : null;
}

export function eventBlockFor(ev: any, timeZone: string | null): Record<string, any> | null {
  if (!ev?.id) return null;
  const day = eventDay(ev, timeZone);
  if (!day) return null;
  const known = Number(ev.durationMinutes) > 0 ? Number(ev.durationMinutes) : Number(ev.durationHours) > 0 ? Math.round(Number(ev.durationHours) * 60) : 0;
  const hm = ev.holdAllDay === true && !known ? null : readTime(ev.time);
  const start = hm ? wallToUtc(day, hm[0], hm[1], timeZone) : wallToUtc(day, 0, 0, timeZone);
  const end = hm ? new Date(start.getTime() + (known || 180) * 60000) : wallToUtc(day, 23, 59, timeZone);
  const staff = (Array.isArray(ev.assignedStaffIds) ? ev.assignedStaffIds : []).map(String).filter(Boolean);
  const title = String(ev.title || ev.name || 'Event');
  return {
    id: eventBlockId(ev.id), title, type: 'blocked', status: 'confirmed',
    startTime: start.toISOString(), endTime: end.toISOString(), allDay: !hm,
    staffIds: staff.length ? staff : ['all'],
    notes: `Event: ${title}${ev.venue ? `, ${ev.venue}` : ''}`,
    color: '#7c3aed', isStudioEventBlock: true, linkedStudioEventId: ev.id,
    ...(ev.clientId ? { clientId: ev.clientId } : {}),
  };
}
