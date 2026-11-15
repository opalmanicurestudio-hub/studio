// src/lib/event-sheet-server.ts — an event's sheet, put together (lib/event-sheet): the event and the quote it came from,
// its night (lib/event-night-server: the run of show, the menu from the guests' choices with the allergies, the seats),
// the team on it by name and job, and for a manager the money. Read by api/event-sheet.
import { eventNightFor } from '@/lib/event-night-server';
import { jobOf, JOB_WORD } from '@/lib/briefing';
import { includedWords, seatingWords, sheetMoney, whenWords } from '@/lib/event-sheet';
import { seatPickingOf } from '@/lib/event-seats';

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** `me`: the team member asking (their client contact and the notes are for managers and the team on the event). */
export async function sheetFor(db: any, T: string, tenant: any, eventId: string, manager: boolean, me: string[] = []) {
  const evSnap = await db.doc(`${T}/studioEvents/${eventId}`).get();
  if (!evSnap.exists) return null;
  const ev: any = evSnap.data() || {};
  const ids: string[] = Array.from(new Set<string>((Array.isArray(ev.assignedStaffIds) ? ev.assignedStaffIds : []).map(String))).filter((x) => /^[A-Za-z0-9_-]{1,160}$/.test(x)).slice(0, 40);
  const [night, staff] = await Promise.all([
    eventNightFor(db, T, tenant, eventId, true),
    Promise.all(ids.map((id) => db.doc(`${T}/staff/${id}`).get().then((d: any) => (d.exists ? { id, ...(d.data() || {}) } : null)).catch(() => null))),
  ]);
  const team = (staff.filter(Boolean) as any[]).filter((m) => m.archived !== true)
    .map((m) => ({ name: clip(String(m.name || m.displayName || 'Team member').split(/\s+/)[0], 40), job: JOB_WORD[jobOf(m)] }));
  const seating = seatingWords(ev);
  const onIt = manager || me.some((x) => ids.includes(x));
  return {
    business: clip(tenant?.name || tenant?.businessName, 80),
    title: clip(ev.title || ev.name, 120) || 'Event',
    when: whenWords(ev), date: String(ev.date || ''),
    where: clip(ev.venue, 160) || null,
    guests: { guaranteed: Number(ev.capacity) > 0 ? Number(ev.capacity) : null, onList: night?.prep?.guests ?? 0 },
    // The client's name for everyone; their number and email for managers and the team on the event.
    client: ev.clientName || ev.clientPhone || ev.clientEmail ? { name: clip(ev.clientName, 80) || null, phone: onIt ? clip(ev.clientPhone, 40) || null : null, email: onIt ? clip(ev.clientEmail, 120) || null : null } : null,
    included: includedWords(ev),
    show: night?.show || [], showSaved: !!night?.saved,
    menu: night?.prep || null,
    team,
    seating: seating ? `${seating}${seatPickingOf(ev).on ? ', guests choose their seats online' : ''}` : null,
    // The notes came from the quote (often the owner's own): managers only.
    notes: manager ? clip(ev.notes, 1200) || null : null,
    fromQuote: !!ev.quoteId,
    money: manager ? sheetMoney(ev) : null,
  };
}
