// src/lib/quote-convert.ts — AN ACCEPTED QUOTE BECOMES AN EVENT, WITH EVERYTHING ON IT (the Quotes page's Convert to
// Event). Before, the event kept only a name and a date: the client, their address, the team, the start time, what was
// quoted and the deposit were all lost. Now the event carries them all, and its client is its first guest. Pure: the
// page writes it, holds its day on the calendar (lib/event-block) and tells the team on it.
import { quoteDay, quoteTotals, placeText } from '@/lib/quote-public';

export function eventFromQuote(q: any, client: any | null, dayOf: (d: Date) => string, now = new Date().toISOString()) {
  const t = quoteTotals(q);
  const loc = q?.eventLocation;
  const address = loc && typeof loc === 'object'
    ? { street: String(loc.street || ''), city: String(loc.city || ''), state: String(loc.state || ''), zip: String(loc.zip || ''), country: String(loc.country || '') }
    : null;
  const lines = (Array.isArray(q?.lineItems) ? q.lineItems : []).map((i: any) => ({ id: String(i?.id || ''), name: String(i?.name || 'Item'), quantity: Number(i?.quantity) || 1, price: Number(i?.price) || 0 }));
  const staff = (Array.isArray(q?.staffPayouts) ? q.staffPayouts : []).map((s: any) => String(s?.staffId || '')).filter(Boolean);
  const people = Number(q?.partySize) || Number(q?.guestCount) || null;
  const title = String(q?.eventName || 'Event');
  return {
    title, name: title,
    date: quoteDay(q, dayOf) || '',
    time: /^\d{2}:\d{2}$/.test(String(q?.startTime || '')) ? String(q.startTime) : '',
    durationHours: Number(q?.totalHours) > 0 ? Number(q.totalHours) : null,
    // A start time with no length holds the whole day, as accepting the quote did (lib/event-block).
    holdAllDay: !(Number(q?.totalHours) > 0),
    venue: placeText(loc) || null,
    address,
    capacity: people,
    description: lines.length ? lines.map((l: any) => `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`).join(', ') : null,
    // What was quoted, line by line, and the money on it, kept with the event.
    quoteLines: lines,
    quoteTotal: t.total,
    deposit: { amount: t.deposit, paid: q?.depositPaid === true, payments: Array.isArray(q?.payments) ? q.payments : [] },
    clientId: q?.clientId || null,
    clientName: client?.name || [client?.firstName, client?.lastName].filter(Boolean).join(' ') || null,
    clientEmail: client?.email || null,
    clientPhone: client?.phone || null,
    assignedStaffIds: staff,
    notes: String(q?.notes || '') || null,
    status: 'upcoming', quoteId: String(q?.id || ''), eventType: 'other', courses: [], menuItems: [], createdAt: now,
  };
}
