// src/lib/prep-ctx.ts — WHOSE RULES? (Part 6, round 3) Before the visit runs on the business's own rules for the studio's
// visits, and on the RENTER's for a renter's visits: their services (renterServices) and the questions on them, their
// price word, deposit top-up and on-the-day rules (renterSettings/{staffId}.prep), and their business name. A renter is
// provider and desk at once, so nothing of theirs goes to the studio's desk, waitlist or deposit decisions.
import { prepSettingsOf, type PrepSettings } from '@/lib/prep-check';

const T = (t: string) => `tenants/${t}`;

export interface PrepCtx { renter: boolean; staffId: string | null; tenant: any; services: any[]; S: PrepSettings; raw: any; brand: { name: string; logo: string | null }; policyTenant: any | null }

/** The provider behind a visit is a renter (or it's booked as a renter's)? */
export async function renterVisit(db: any, tenantId: string, a: any): Promise<{ renter: boolean; staff: any | null; staffId: string | null }> {
  const sid = String(a?.renterProviderId || a?.staffId || '') || null;
  const staff = sid ? ((await db.doc(`${T(tenantId)}/staff/${sid}`).get()).data() || null) : null;
  const renter = a?.isRenterBooking === true || staff?.role === 'renter' || staff?.isRenter === true;
  return { renter, staff: staff ? { id: sid, ...staff } : null, staffId: sid };
}

export async function prepCtx(db: any, tenantId: string, a: any, tenantIn?: any): Promise<PrepCtx> {
  const tenant: any = tenantIn || (await db.doc(T(tenantId)).get()).data() || {};
  const v = await renterVisit(db, tenantId, a);
  if (!v.renter || !v.staffId) {
    const services = (await db.collection(`${T(tenantId)}/services`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    return { renter: false, staffId: v.staffId, tenant, services, S: prepSettingsOf(tenant), raw: tenant.prepCheck || null, brand: { name: String(tenant.name || tenant.businessName || 'Your visit'), logo: tenant.logoUrl || tenant.logo || null }, policyTenant: tenant };
  }
  return renterCtx(db, tenantId, v.staffId, tenant, v.staff);
}

export async function renterCtx(db: any, tenantId: string, staffId: string, tenantIn?: any, staffIn?: any): Promise<PrepCtx> {
  const tenant: any = tenantIn || (await db.doc(T(tenantId)).get()).data() || {};
  const staff = staffIn || { id: staffId, ...((await db.doc(`${T(tenantId)}/staff/${staffId}`).get()).data() || {}) };
  const [svc, set] = await Promise.all([db.collection(`${T(tenantId)}/renterServices`).where('staffId', '==', staffId).get(), db.doc(`${T(tenantId)}/renterSettings/${staffId}`).get()]);
  const services = svc.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((x: any) => x.isActive !== false);
  const raw = set.exists ? (set.data() || {}).prep || null : null;
  const { renterBrand } = await import('@/lib/renter-aftercare'); const brand = await renterBrand(db, tenantId, staff);
  return { renter: true, staffId, tenant, services, S: prepSettingsOf({ prepCheck: raw || {} }), raw, brand, policyTenant: null };
}
