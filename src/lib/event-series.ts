// src/lib/event-series.ts — SAVING EVENTS ADDED TOGETHER, and changing or deleting the rest of a series.
//
// New event (components/planner/EventsDialog) can add a whole schedule at once. Each event is its own document, as
// before, so every calendar, availability check and booking rule reads them unchanged; events added together share a
// seriesId, with seriesIndex / seriesCount, the name they were given (seriesTitle) and the words each date added
// (rowLabel), so a later rename keeps "· vs Tigers" on each one.
//
// A block for a team member still answers to the block policy, one date at a time (lib/block-submit), and the managers
// hear about the lot once, not once per date.
import { collection, doc, writeBatch, type Firestore } from 'firebase/firestore';
import { submitCalendarBlock } from '@/lib/block-submit';
import { notifyStaff, managerIds } from '@/lib/staff-notify';
import type { NewEventsInput } from '@/components/planner/EventsDialog';

const toIso = (d: any): string => (d instanceof Date ? d.toISOString() : typeof d?.toDate === 'function' ? d.toDate().toISOString() : String(d || ''));
const ms = (d: any) => Date.parse(toIso(d)) || 0;

/** The documents a New event writes (not blocks for a team member, which go through the policy). */
export function eventDocs(input: NewEventsInput, ctx: { tenantId: string; ids: string[]; seriesId: string; nowIso: string; by?: string | null }): Record<string, any>[] {
  const many = input.occurrences.length > 1;
  return input.occurrences.map((o, i) => ({
    id: ctx.ids[i],
    tenantId: ctx.tenantId,
    title: o.title,
    type: input.type,
    startTime: o.startTime.toISOString(),
    endTime: o.endTime.toISOString(),
    allDay: !!o.allDay,
    notes: input.notes || '',
    location: o.location || '',
    checklist: (input.checklist || []).map((c, j) => ({ ...c, id: `${c.id || 'cl'}-${i}-${j}`, completed: false })),
    staffIds: input.staffIds || [],
    createdAt: ctx.nowIso,
    createdBy: ctx.by || null,
    ...(many ? { seriesId: ctx.seriesId, seriesIndex: i + 1, seriesCount: input.occurrences.length, seriesTitle: input.title, rowLabel: input.rowLabels[i] || '' } : {}),
  }));
}

export type SaveResult = { added: number; requested: number; refused: number; reason?: string };

export async function saveNewEvents(firestore: Firestore, tenantId: string, input: NewEventsInput, ctx: {
  by?: string | null; byName?: string | null; isManager?: boolean; staff: any[]; events: any[]; policy?: any; ownerUid?: string | null;
}): Promise<SaveResult> {
  const nowIso = new Date().toISOString();
  const seriesId = doc(collection(firestore, `tenants/${tenantId}/events`)).id;
  const many = input.occurrences.length > 1;

  // Blocking the whole calendar (nobody picked) is a manager's call.
  if (input.type === 'blocked' && !(input.staffIds || []).length && !ctx.isManager) {
    return { added: 0, requested: 0, refused: input.occurrences.length, reason: 'Only someone who manages bookings can block the whole calendar. Pick who it’s for.' };
  }

  if (input.type === 'blocked' && (input.staffIds || []).length > 0) {
    const subjectId = String(input.staffIds[0]);
    const subject = (ctx.staff || []).find((s: any) => s.id === subjectId);
    let added = 0; let requested = 0; let refused = 0; let reason: string | undefined; let told = false;
    const refusedOn: string[] = [];
    // Each block made counts toward the next one's daily limit (two on the same day add up).
    const seen = [...(ctx.events || [])];
    for (let i = 0; i < input.occurrences.length; i++) {
      const o = input.occurrences[i];
      const res = await submitCalendarBlock(firestore, tenantId, {
        blockType: 'personal', title: o.title, startTime: o.startTime, endTime: o.endTime, allDay: !!o.allDay, notes: input.notes,
        staffIds: input.staffIds,
        subject: { id: subjectId, name: subject?.name || null, employmentModel: subject?.employmentModel || null, role: subject?.role || null },
        actor: { uid: ctx.by || null, name: ctx.byName || null, isManager: !!ctx.isManager },
        policy: ctx.policy || null, events: seen, staff: ctx.staff || [], ownerUid: ctx.ownerUid || null,
        quiet: many,
        extra: {
          ...(o.location ? { location: o.location } : {}),
          ...((input.checklist || []).length ? { checklist: input.checklist.map((c, j) => ({ ...c, id: `${c.id || 'cl'}-${i}-${j}`, completed: false })) } : {}),
          ...(many ? { seriesId, seriesIndex: i + 1, seriesCount: input.occurrences.length, seriesTitle: input.title, rowLabel: input.rowLabels[i] || '' } : {}),
        },
      });
      if (!res.ok) { refused++; reason = reason || res.reason; refusedOn.push(o.startTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); continue; }
      if (res.outcome === 'requested') requested++;
      else { added++; seen.push({ type: 'blocked', blockType: 'personal', status: 'approved', staffIds: input.staffIds, startTime: o.startTime.toISOString(), endTime: o.endTime.toISOString() }); }
      if (res.told) told = true;
    }
    if (refusedOn.length && many) reason = `${reason} (${refusedOn.slice(0, 6).join(', ')}${refusedOn.length > 6 ? ', …' : ''})`;
    // Several at once: the managers hear about them together.
    if (many && (requested > 0 || told)) {
      const who = subject?.name || 'A provider';
      await notifyStaff(firestore, tenantId, managerIds(ctx.staff || [], ctx.by, ctx.ownerUid).map((id) => ({
        userId: id,
        type: 'appointment_issue_raised' as const,
        message: requested > 0 ? `${who} asked to block time on ${requested} date${requested === 1 ? '' : 's'} — ${input.title}.` : `${who} blocked time on ${added} dates — ${input.title}.`,
        link: requested > 0 ? '/schedule/requests' : '/planner',
      })));
    }
    return { added, requested, refused, reason };
  }

  const ids = input.occurrences.map(() => doc(collection(firestore, `tenants/${tenantId}/events`)).id);
  const docs = eventDocs(input, { tenantId, ids, seriesId, nowIso, by: ctx.by });
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(firestore);
    for (const d of docs.slice(i, i + 400)) batch.set(doc(firestore, `tenants/${tenantId}/events`, d.id), d);
    await batch.commit();
  }
  return { added: docs.length, requested: 0, refused: 0 };
}

/** The events after this one in its series. */
export function laterInSeries(events: any[], event: any): any[] {
  const sid = event?.seriesId; if (!sid) return [];
  const at = ms(event.startTime);
  return (events || []).filter((e) => e && e.seriesId === sid && e.id !== event.id && ms(e.startTime) > at).sort((a, b) => ms(a.startTime) - ms(b.startTime));
}

/** What to write on each later event for the changes made to one of them: only what changed, each keeping its own
 *  date (a new time of day lands on each event's own day). */
export function laterUpdates(later: any[], changed: {
  title?: string; type?: string; startClock?: string; endClock?: string; allDay?: boolean; staffIds?: string[]; location?: string; notes?: string;
}): { id: string; patch: Record<string, any> }[] {
  return later.map((e) => {
    const patch: Record<string, any> = {};
    if (changed.title != null) {
      const label = String(e.rowLabel || '');
      patch.seriesTitle = changed.title;
      patch.title = label ? `${changed.title} · ${label}` : changed.title;
    }
    if (changed.type) patch.type = changed.type;
    if (changed.staffIds) patch.staffIds = changed.staffIds;
    if (changed.location != null) patch.location = changed.location;
    if (changed.notes != null) patch.notes = changed.notes;
    const s = new Date(toIso(e.startTime)); const en = new Date(toIso(e.endTime));
    const at = (base: Date, clock: string) => { const [h, m] = clock.split(':').map(Number); return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m); };
    if (changed.allDay === true) { patch.allDay = true; patch.startTime = at(s, '00:00').toISOString(); patch.endTime = at(s, '23:59').toISOString(); }
    else if (changed.startClock || changed.endClock || changed.allDay === false) {
      const ns = changed.startClock ? at(s, changed.startClock) : s;
      let ne = changed.endClock ? at(s, changed.endClock) : new Date(ns.getTime() + Math.max(15 * 60000, en.getTime() - s.getTime()));
      if (ne <= ns && changed.endClock) { const nx = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1); ne = at(nx, changed.endClock); }   // ends after midnight
      if (ne <= ns) ne = new Date(ns.getTime() + 60 * 60000);
      patch.startTime = ns.toISOString(); patch.endTime = ne.toISOString();
      if (changed.allDay === false) patch.allDay = false;
    }
    return { id: String(e.id), patch };
  }).filter((u) => Object.keys(u.patch).length > 0);
}

export async function writeUpdates(firestore: Firestore, tenantId: string, updates: { id: string; patch: Record<string, any> }[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(firestore);
    for (const u of updates.slice(i, i + 400)) batch.set(doc(firestore, `tenants/${tenantId}/events`, u.id), u.patch, { merge: true });
    await batch.commit();
  }
}

export async function deleteEvents(firestore: Firestore, tenantId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(firestore);
    for (const id of ids.slice(i, i + 400)) batch.delete(doc(firestore, `tenants/${tenantId}/events`, id));
    await batch.commit();
  }
}
