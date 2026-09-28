// src/lib/late-choices.ts — CHOICES FOR A CLIENT RUNNING LATE (server).
// When they're past the grace time and the full visit no longer fits before the
// provider's next booking, work out what still could:
//   condense   — a shorter visit: drop add-ons (last first), only as many as needed
//   switch     — another qualified provider who's free for the full visit from their ETA
//   reschedule — always
// Nothing here changes the booking. The client chooses (or staff decide).
import { providerFree } from '@/lib/provider-availability';

export type LateChoice = 'condense' | 'switch' | 'reschedule';
export type LateChoicesMode = 'off' | 'prepare' | 'send';
export const lateChoicesModeOf = (t: any): LateChoicesMode => (['prepare', 'send'].includes(t?.bookingPolicies?.lateChoices) ? t.bookingPolicies.lateChoices : 'off');
export const lateChoicesWaitOf = (t: any) => Math.max(5, Math.min(60, Number(t?.bookingPolicies?.lateChoicesWaitMinutes) || 10));

export interface LateChoicesPlan {
  needed: boolean; etaAt: string; options: LateChoice[];
  dropAddOnIds?: string[]; dropNames?: string[];
  toStaffId?: string; toStaffName?: string | null;
}

export async function planLateChoices(db: any, tenantId: string, apptId: string, a: any): Promise<LateChoicesPlan> {
  const T = `tenants/${tenantId}`;
  const start = Date.parse(a.startTime);
  const eta = Date.parse(a.etaAt || '') || (start + (Number(a.lateTimeMinutes) || 0) * 60000);
  const begin = Math.max(eta, start);
  const svc = async (id: string) => ((await db.doc(`${T}/services/${id}`).get()).data() as any) || null;
  const main = a.serviceId ? await svc(a.serviceId) : null;
  const mainMin = Number(main?.duration) || Math.max(15, Math.round((Date.parse(a.endTime || a.startTime) - start) / 60000) || 60);
  const addOns: { id: string; name: string; min: number }[] = [];
  for (const id of (Array.isArray(a.addOnIds) ? a.addOnIds : []).slice(0, 8)) { const s = await svc(id); if (s) addOns.push({ id, name: s.name || 'add-on', min: Number(s.duration) || 0 }); }
  const total = mainMin + addOns.reduce((m, x) => m + x.min, 0);
  // The provider's next booking after this one.
  const q = await db.collection(`${T}/appointments`).where('staffId', '==', a.staffId).get();
  const nextStart = q.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((x: any) => x.id !== apptId && !['cancelled', 'canceled', 'completed', 'no_show', 'declined', 'expired'].includes(String(x.status || '')) && Date.parse(x.startTime) >= start)
    .map((x: any) => Date.parse(x.startTime)).sort((p: number, r: number) => p - r)[0];
  const limit = Number.isFinite(nextStart) ? nextStart : Infinity;
  const base: LateChoicesPlan = { needed: false, etaAt: new Date(eta).toISOString(), options: [] };
  if (begin + total * 60000 <= limit) return base;                     // the full visit still fits — nothing to choose
  const options: LateChoice[] = [];
  // A shorter visit: drop add-ons (last first) until it fits — never the main service.
  let dropIds: string[] = []; let remaining = total;
  for (const x of [...addOns].reverse()) { if (begin + remaining * 60000 <= limit) break; dropIds.push(x.id); remaining -= x.min; }
  if (dropIds.length && begin + remaining * 60000 <= limit) options.push('condense'); else dropIds = [];
  // Another provider, free for the FULL visit from their arrival.
  let toStaffId: string | undefined; let toStaffName: string | null = null;
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((m: any) => m.id !== a.staffId && m.isActive !== false && !m.renterId && !m.isStudent && (!main?.staffIds?.length || main.staffIds.includes(m.id)));
  for (const m of staff.slice(0, 12)) if (await providerFree(db, T, m.id, begin, begin + total * 60000, apptId)) { toStaffId = m.id; toStaffName = m.name || null; break; }
  if (toStaffId) options.push('switch');
  options.push('reschedule');
  return { needed: true, etaAt: new Date(eta).toISOString(), options, ...(dropIds.length ? { dropAddOnIds: dropIds, dropNames: addOns.filter((x) => dropIds.includes(x.id)).map((x) => x.name) } : {}), ...(toStaffId ? { toStaffId, toStaffName } : {}) };
}

/** The client's message listing their choices. */
export function lateChoicesText(o: { first: string; lateMin: number; graceMin: number; plan: LateChoicesPlan; providerFirst?: string | null; when?: string | null }): string {
  const parts: string[] = [];
  if (o.plan.options.includes('condense')) parts.push(`a shorter visit today (without ${(o.plan.dropNames || []).join(' and ') || 'the add-ons'})`);
  if (o.plan.options.includes('switch')) parts.push(`${String(o.plan.toStaffName || 'another of our team').split(' ')[0]} can see you${o.when ? ` at ${o.when}` : ''}`);
  parts.push('pick a new time');
  return `Hi ${o.first} — thanks for letting us know you’re running about ${o.lateMin} minutes late. That’s past our ${o.graceMin}-minute grace, so your full visit won’t fit${o.providerFirst ? ` before ${o.providerFirst}’s next appointment` : ''}. Choose what works for you: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : parts[0]}.`;
}
