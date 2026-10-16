// src/lib/agent-holds.ts — A TIME HELD BY AN ASSISTANT FOR A CLIENT TO CONFIRM (the agent plan, Phase 1). The assistant
// asks; the time is held for a few minutes (tenants/{t}/agentHolds/{id}); the client gets one text with a private link
// that opens the booking page on that time with their details filled in; they book it the normal way (policies,
// forms, deposit). A held time blocks everyone else until it is booked or runs out, so two people can't take it.
import { randomBytes } from 'crypto';

const ms = (v: any): number => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
export const holdKey = () => randomBytes(12).toString('base64url');

/** A hold still keeping its time: held, not run out. */
export const holdLive = (h: any, now = Date.now()) => !!h && h.status === 'held' && ms(h.expiresAt) > now;

/** Live holds as appointment-shaped rows, so every availability check sees them as busy. `except` = the client's own. */
export function holdsAsBusy(holds: any[], except?: string | null, now = Date.now()) {
  return (holds || []).filter((h) => holdLive(h, now) && h.id !== except)
    .map((h) => ({ id: `hold-${h.id}`, status: 'held', isAgentHold: true, staffId: h.staffId, staffIds: h.staffId ? [h.staffId] : [], serviceId: h.serviceId, addOnIds: h.addOnIds || [], startTime: h.startTime, endTime: h.endTime, duration: h.durationMinutes || null }));
}

/** Fake snapshot docs, for callers that read `.docs[i].data()` (lib/booking-data). */
export const asDocs = (rows: any[]) => rows.map((r) => ({ id: r.id, data: () => r }));

/** Load live holds for a business. Never throws: no holds read = no holds applied. */
export async function liveHolds(db: any, T: string, now = Date.now()): Promise<any[]> {
  try { const s = await db.collection(`${T}/agentHolds`).where('status', '==', 'held').get(); return s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((h: any) => holdLive(h, now)); }
  catch { return []; }
}

/** The one text the client gets. Plain, no pressure, says what happens if it wasn't them. */
export function holdText(o: { first: string; studio: string; service: string; when: string; minutes: number; link: string }) {
  return `Hi ${o.first}, your assistant asked ${o.studio} to hold ${o.when} for your ${o.service}. To book it, confirm here within ${o.minutes} minutes: ${o.link} If this wasn't you, you can ignore this message and the time will be released.`;
}
