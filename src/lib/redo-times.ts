// src/lib/redo-times.ts — WHEN CAN THE REDO HAPPEN? The same availability engine the booking page and reschedules use
// (the provider's hours, shifts, days off, blocks, other bookings, rooms and equipment, and the business's normal client
// rules) for the FIX PLAN — the original service at its original length, or the services the team chose (e.g. a removal and
// a new service) at their combined length — over the next few days the business set.
// The original provider is asked first (when the business says so); "someone else" lists the other people who do that
// service and can see this client. bookRedo checks the time is still free at the moment it's booked.
import { clientOpenTimes } from '@/lib/reschedule-slots';
import { eligibleFor } from '@/lib/availability';
import { tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';
import { settingsOf } from '@/lib/making-it-right';

const T = (t: string) => `tenants/${t}`;
/** SHOULD THE FIX GO TO SOMEONE ELSE? Yes when the client asked for someone else, the complaint is about how they were
 *  treated, it's a safety case, there's a conduct report between them, or they're marked not to be booked together. A
 *  manager can still choose either way for a case (redoWith). The reason is for the team only — clients are just offered
 *  someone else. */
export async function providerAdvice(db: any, tenantId: string, c: any): Promise<{ avoidOriginal: boolean; why: string | null; override: 'original' | 'other' | null }> {
  const override = c.redoWith === 'original' || c.redoWith === 'other' ? c.redoWith : null;
  const orig = String(c.visit?.providerId || ''); let why: string | null = null;
  if (c.preferOther) why = 'They asked for someone else';
  else if (c.safety) why = 'A safety case';
  else if (/treat|rude|manner|attitude|behav/i.test(`${c.reasonId} ${c.reasonLabel}`)) why = 'The complaint is about how they were treated';
  if (!why && orig && c.clientId) {
    const cl: any = (await db.doc(`${T(tenantId)}/clients/${c.clientId}`).get()).data() || {};
    if ((cl.excludedStaffIds || []).includes(orig)) why = 'They’re marked not to be booked together';
    else { const rep = (await db.collection(`${T(tenantId)}/conductReports`).where('clientId', '==', c.clientId).get()).docs.some((d: any) => (d.data() || {}).staffId === orig); if (rep) why = 'There’s a conduct report between them'; }
  }
  const avoid = override === 'other' ? true : override === 'original' ? false : !!why;
  return { avoidOriginal: avoid, why: override === 'other' && !why ? 'A manager chose someone else' : why, override };
}

export type ProviderTimes = { staffId: string; name: string; original: boolean; days: { date: string; times: string[] }[] };

/** The fix plan: the services the team decided on (the same service again, or e.g. a removal and a new service), how long
 *  it takes in all, and what (if anything) the client pays. Without a plan it's the original service at the original length. */
export async function redoPlan(db: any, tenantId: string, c: any): Promise<{ serviceIds: string[]; primary: string; names: string[]; minutes: number; priceCents: number; note: string | null; same: boolean }> {
  const plan = c.fix?.redo?.plan;
  if (plan && Array.isArray(plan.serviceIds) && plan.serviceIds.length) {
    const svcs = await Promise.all(plan.serviceIds.map(async (id: string) => ({ id, ...((await db.doc(`${T(tenantId)}/services/${id}`).get()).data() || {}) })));
    const minutes = Number(plan.minutes) > 0 ? Number(plan.minutes) : svcs.reduce((x: number, s: any) => x + (Number(s.duration) || 30), 0);
    return { serviceIds: plan.serviceIds, primary: plan.serviceIds[plan.serviceIds.length - 1], names: svcs.map((s: any) => s.name || 'Service'), minutes: Math.min(600, Math.max(15, minutes)), priceCents: Math.max(0, Number(plan.priceCents) || 0), note: plan.note || null, same: false };
  }
  const a: any = c.visit?.appointmentId ? (await db.doc(`${T(tenantId)}/appointments/${c.visit.appointmentId}`).get()).data() || {} : {};
  const m = Math.round((Date.parse(a.endTime) - Date.parse(a.startTime)) / 60000);
  const minutes = Number(c.fix?.redo?.minutes) > 0 ? Number(c.fix.redo.minutes) : Number.isFinite(m) && m >= 15 ? Math.min(480, m) : Math.max(15, Number(a.duration) || 60);
  return { serviceIds: [c.visit?.serviceId].filter(Boolean), primary: c.visit?.serviceId, names: [c.visit?.serviceName || 'Service'], minutes, priceCents: 0, note: null, same: true };
}
export async function redoMinutes(db: any, tenantId: string, c: any): Promise<number> { return (await redoPlan(db, tenantId, c)).minutes; }

export async function redoTimes(db: any, tenantId: string, c: any, opts: { staffId?: string; from?: string; others?: boolean; days?: number } = {}): Promise<{ ok: boolean; providers: ProviderTimes[]; minutes: number; error?: string; advice?: { avoidOriginal: boolean; why: string | null; override: 'original' | 'other' | null } }> {
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = settingsOf(tenant); const tz = tenantTimeZone(tenant);
  const plan = await redoPlan(db, tenantId, c);
  if (!plan.primary) return { ok: false, providers: [], minutes: 0, error: 'Choose the services for the fix first.' };
  const minutes = plan.minutes;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || '')) ? String(opts.from) : todayIn(tz);
  const days = Math.max(1, Math.min(21, opts.days || S.redoLookDays));
  const advice = await providerAdvice(db, tenantId, c);
  const original = String(c.visit?.providerId || '');
  if (advice.avoidOriginal && !opts.staffId) opts = { ...opts, others: true };
  const staff = (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true && s.isActive !== false && !s.isRenter && s.role !== 'renter');
  let ids: string[];
  if (opts.staffId) ids = [opts.staffId];
  else if (!opts.others) ids = original ? [original] : [];
  else {
    // Someone who can do EVERY service in the plan, and who may see this client.
    const client: any = c.clientId ? (await db.doc(`${T(tenantId)}/clients/${c.clientId}`).get()).data() || {} : {};
    let pool = staff;
    for (const sid of plan.serviceIds) { const svc: any = (await db.doc(`${T(tenantId)}/services/${sid}`).get()).data() || {};
      if (Array.isArray(svc.staffIds) && svc.staffIds.length) pool = pool.filter((s: any) => svc.staffIds.includes(s.id)); pool = eligibleFor(svc, pool, client); }
    ids = pool.map((s: any) => s.id).filter((id: string) => id !== original).slice(0, 4);
  }
  const start = new Date(Date.now()).toISOString(); const end = new Date(Date.now() + minutes * 60000).toISOString();
  const providers: ProviderTimes[] = [];
  for (const id of ids) {
    const r = await clientOpenTimes(db, tenantId, '__redo__', { serviceId: plan.primary, staffId: id, startTime: start, endTime: end }, from, days);
    const s = staff.find((x: any) => x.id === id);
    if (r.ok) providers.push({ staffId: id, name: String(s?.name || c.visit.providerName || 'Provider'), original: id === original, days: r.days.filter((d) => d.times.length) });
  }
  return { ok: true, providers, minutes, advice };
}

/** Is that time still open for that provider right now? Returns the moment it starts. */
export async function redoSlotFree(db: any, tenantId: string, c: any, staffId: string, date: string, time: string): Promise<{ ok: boolean; start?: Date; minutes?: number; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: 'Pick a day and time.' };
  const r = await redoTimes(db, tenantId, c, { staffId, from: date, days: 1 });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.providers[0]?.days[0]?.times.includes(time)) return { ok: false, error: 'That time was just taken — pick another.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {};
  const [hh, mm] = time.split(':').map(Number);
  return { ok: true, start: wallToUtc(date, hh, mm, tenantTimeZone(tenant)), minutes: r.minutes };
}
