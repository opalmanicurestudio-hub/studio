// src/lib/provider-suggest.ts — WHO COULD TAKE THIS CLIENT INSTEAD? (server)
// The first slice of Smart Capacity & Assignment. Eligibility first, then a fair turn:
//   eligible — active, not the current provider, qualified for the service, free for the WHOLE visit
//              (using THEIR OWN recorded time for this service when there's enough history), and — for
//              renters — only if they've opted in to front-desk offers (renter portal → notifications).
//   ranked   — "fit, then fair turn" (default): least booked time today first, with a boost for anyone who
//              lost a booking today; "fit only": whoever would finish soonest.
// Every suggestion carries a plain reason, so the desk can see why.
import { providerFree } from '@/lib/provider-availability';
import { channelFor } from '@/lib/renter-comms';

export type OfferSettings = { who: 'managers' | 'desk'; employees: 'assign' | 'ask'; answerMinutes: number; onNoAnswer: 'next' | 'manager'; rank: 'fair' | 'fit'; renters: boolean };
export function offerSettingsOf(t: any): OfferSettings {
  const o = t?.bookingPolicies?.providerOffers || {};
  return { who: o.who === 'desk' ? 'desk' : 'managers', employees: o.employees === 'ask' ? 'ask' : 'assign',
    answerMinutes: [5, 10, 15].includes(Number(o.answerMinutes)) ? Number(o.answerMinutes) : 10,
    onNoAnswer: o.onNoAnswer === 'manager' ? 'manager' : 'next', rank: o.rank === 'fit' ? 'fit' : 'fair', renters: o.renters !== false };
}
/** Renters are always asked first; employees only when the business chooses. */
export const mustAsk = (staff: any, s: OfferSettings) => !!(staff?.isRenter || staff?.renterId) || s.employees === 'ask';

export interface Suggestion { staffId: string; name: string; isRenter: boolean; minutes: number; ownTime: boolean; bookedMinutesToday: number; lostToday: boolean; reason: string }

export async function suggestProviders(db: any, tenantId: string, ap: any, apptId: string, startMs: number, exclude: string[] = []): Promise<Suggestion[]> {
  const T = `tenants/${tenantId}`;
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const s = offerSettingsOf(t);
  const svc: any = ap.serviceId ? (((await db.doc(`${T}/services/${ap.serviceId}`).get()).data() as any) || {}) : {};
  const bookedLen = Math.max(15, Math.round((Date.parse(ap.endTime || ap.startTime) - Date.parse(ap.startTime)) / 60000) || Number(svc.duration) || 60);
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((m: any) => m.isActive !== false && m.id !== ap.staffId && !exclude.includes(m.id) && !m.isStudent && (!svc.staffIds?.length || svc.staffIds.includes(m.id)));
  const all = (await db.collection(`${T}/appointments`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: t.timezone || undefined });
  const today = dayKey(startMs);
  const out: Suggestion[] = [];
  for (const m of staff) {
    const isRenter = !!(m.isRenter || m.renterId);
    if (isRenter) {
      if (!s.renters) continue;
      const r: any = m.renterId ? (((await db.doc(`${T}/renters/${m.renterId}`).get()).data() as any) || {}) : {};
      if (channelFor(r.renterNotify, 'offers') === 'off') continue;            // not opted in
    }
    // Their own recorded time for this service (median of their last completed visits), when there's enough history.
    const mine = all.filter((a: any) => a.staffId === m.id && a.serviceId === ap.serviceId && a.actualStartTime && a.actualEndTime)
      .map((a: any) => Math.round((Date.parse(a.actualEndTime) - Date.parse(a.actualStartTime)) / 60000)).filter((x: number) => x > 5 && x < 600).slice(-12).sort((x: number, y: number) => x - y);
    const ownTime = mine.length >= 3;
    const minutes = ownTime ? Math.max(bookedLen - 30, Math.min(bookedLen + 45, mine[Math.floor(mine.length / 2)])) : bookedLen;
    if (!(await providerFree(db, T, m.id, startMs, startMs + minutes * 60000, apptId))) continue;
    const theirs = all.filter((a: any) => a.staffId === m.id && dayKey(Date.parse(a.startTime)) === today);
    const booked = theirs.filter((a: any) => !['cancelled', 'canceled', 'no_show', 'declined', 'expired'].includes(String(a.status || '')))
      .reduce((mm: number, a: any) => mm + Math.max(0, Math.round((Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)) / 60000)), 0);
    const lostToday = theirs.some((a: any) => ['cancelled', 'canceled', 'no_show'].includes(String(a.status || '')));
    const first = String(m.name || 'They').split(' ')[0];
    const reason = [`free for the whole visit`, ownTime ? `usually ${minutes} min for this` : `${minutes} min booked length`,
      booked === 0 ? 'nothing booked yet today' : `${Math.round(booked / 60 * 10) / 10} h booked today`, lostToday ? 'lost a booking today' : '', isRenter ? 'renter — will be asked' : ''].filter(Boolean).join(' · ');
    out.push({ staffId: m.id, name: m.name || first, isRenter, minutes, ownTime, bookedMinutesToday: booked, lostToday, reason: `${first}: ${reason}` });
  }
  return out.sort((a, b) => s.rank === 'fit'
    ? a.minutes - b.minutes
    : (Number(b.lostToday) - Number(a.lostToday)) || (a.bookedMinutesToday - b.bookedMinutesToday) || (a.minutes - b.minutes));
}
