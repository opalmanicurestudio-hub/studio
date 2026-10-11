// src/lib/welcome.ts — "WE'VE MOVED": the personal page a client lands on from the switch-over text (Moving in → Tell
// your clients). Private to that client (signed link). It reassures them nothing was lost — their history came over,
// their next visit is still booked, their gift card balance — and gives them a one-tap way to book their usual again.
// Shows only their first name, dates and amounts that are theirs; nothing about anyone else.
import { createHmac } from 'crypto';

const T = (t: string) => `tenants/${t}`;
export function helloKey(tenantId: string, clientId: string) {
  const secret = process.env.LINK_SECRET || process.env.GIFT_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'hello';
  return createHmac('sha256', secret).update(`hello:${tenantId}/${clientId}`).digest('base64url').slice(0, 16);
}
export const helloPath = (tenantId: string, clientId: string) => `/hello/${encodeURIComponent(tenantId)}/${encodeURIComponent(clientId)}?k=${helloKey(tenantId, clientId)}`;

export async function helloView(db: any, tenantId: string, clientId: string) {
  const [cs, ts] = await Promise.all([db.doc(`${T(tenantId)}/clients/${clientId}`).get(), db.doc(T(tenantId)).get()]);
  const c: any = cs.data(); const t: any = ts.data(); if (!c || !t) return null;
  const appts = (await db.collection(`${T(tenantId)}/appointments`).where('clientId', '==', clientId).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const now = Date.now(); const live = (a: any) => !['cancelled', 'canceled', 'no_show', 'no-show', 'declined'].includes(String(a.status || '').toLowerCase());
  const next = appts.filter((a: any) => live(a) && Date.parse(a.startTime) > now).sort((a: any, b: any) => Date.parse(a.startTime) - Date.parse(b.startTime))[0] || null;
  const past = appts.filter((a: any) => live(a) && Date.parse(a.startTime) <= now).sort((a: any, b: any) => Date.parse(b.startTime) - Date.parse(a.startTime));
  const last: any = past[0] || null;
  const [svc, st] = last ? await Promise.all([last.serviceId ? db.doc(`${T(tenantId)}/services/${last.serviceId}`).get() : null, last.staffId ? db.doc(`${T(tenantId)}/staff/${last.staffId}`).get() : null]) : [null, null];
  const sv: any = svc?.data?.() || null; const sf: any = st?.data?.() || null;
  const bookable = sv && sv.isActive !== false && !sv.isPrivate && sv.status !== 'archived';
  const staffOk = sf && !sf.archived && sf.status !== 'archived';
  const plan: any = c.subscription?.membershipId && ['active', 'past_due'].includes(c.subscription.status) ? (await db.doc(`${T(tenantId)}/memberships/${c.subscription.membershipId}`).get()).data() : null;
  const { brandAccent } = await import('@/lib/brand-accent');
  const book = `/book/${encodeURIComponent(tenantId)}`;
  return {
    brand: { name: t.name || 'Your studio', logo: t.logoUrl || t.logo || null, accent: brandAccent(t) },
    firstName: String(c.name || '').split(' ')[0] || null,
    history: past.length,
    next: next ? { at: next.startTime, service: next.serviceName || null } : null,
    giftCents: Number(c.giftBalanceCents) || 0,
    membership: plan ? plan.name : null,
    again: bookable ? { label: `${staffOk ? `Book with ${String(sf.name || '').split(' ')[0]} again` : 'Book it again'} — ${sv.name}`, href: `${book}?service=${encodeURIComponent(last.serviceId)}${staffOk ? `&staff=${encodeURIComponent(last.staffId)}` : ''}&src=moved` } : null,
    bookUrl: `${book}?src=moved`,
  };
}
