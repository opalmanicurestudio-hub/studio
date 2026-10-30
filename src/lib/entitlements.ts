// src/lib/entitlements.ts — ONE ACCESS RECORD PER BUYER PER DIGITAL ITEM (server).
// Written when a digital line is paid for (and, for orders paid before these records existed, the first time the
// buyer opens it), under tenants/{tenant}/entitlements/{order}_{line}. It holds what was sold and what has been used:
//   · who bought it (email, client) and what (product, order, line, how many copies);
//   · the license and the access window sold, copied at sale, so a later change to the product never shortens it;
//   · downloads allowed and used (online viewing is never counted); owners can add more or extend access;
//   · its status (active, or revoked by the shop with a reason) and a short history.
// Whether it can be opened right now is still the one rule in lib/digital-access, which reads this record for the
// shop's own changes (revoked, extended) beside the order's refunds, chargebacks and window.

import { BUILT_IN_LICENSES, copyOf, licenseFor } from './licenses';

export const DEFAULT_DOWNLOADS = 5;
const c0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));

export type Entitlement = {
  id: string; tenantId: string; orderId: string; lineId: string; productId: string; name: string;
  email: string; clientId: string | null; copies: number;
  /** Bought as a gift (lib/digital-gift): the person it was for opens it from their gift library, not an order page. */
  gift?: boolean;
  license: { id: string; name: string; terms: string };
  access: { days: number; startsAt: string; endsAt: string | null; extendedUntil?: string | null };
  downloads: { allowed: number | null; used: number; extra: number; seen?: { id: string; at: number }[] };
  views: number;
  status: 'active' | 'revoked';
  revoked?: { at: string; by: string; reason: string } | null;
  createdAt: string;
  history: { at: string; what: string; by?: string }[];
};

/** The record's id: one per order line, so writing it twice (a retried payment notice) is still one record. */
export const entitlementId = (orderId: string, lineId: string) => `${String(orderId).replace(/[^A-Za-z0-9_-]/g, '')}_${String(lineId || 'line').replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 200);

/** The personal license every product has until the shop gives it another (lib/licenses). */
export const PERSONAL_LICENSE = copyOf(BUILT_IN_LICENSES[0]);

/**
 * What a paid digital line is entitled to, from the order and the product as sold. Download limit: the product's own
 * (0 = no limit), else 5. The license comes from the shop's licenses (`tenant`, lib/licenses). Pure.
 */
export function buildEntitlement(tenantId: string, order: any, line: any, item: any, now = new Date().toISOString(), tenant: any = null): Entitlement {
  const days = c0(line?.digitalAccessDays);
  const start = String(order?.paidAt || order?.placedAt || now);
  const limitRaw = item?.digitalDownloadLimit;
  const allowed = limitRaw === 0 || limitRaw === '0' ? null : c0(limitRaw) || DEFAULT_DOWNLOADS;
  // The license as the product sells it now (the shop's reusable license, else its own words), copied at sale.
  const lic = line?.license && line.license.id ? line.license : licenseFor(tenant, item);
  return {
    id: entitlementId(order?.id || '', line?.lineId || line?.productId || ''),
    tenantId, orderId: String(order?.id || ''), lineId: String(line?.lineId || ''), productId: String(line?.productId || ''),
    name: String(line?.name || item?.name || 'Download'),
    // A download bought as a gift belongs to the person it was for (lib/digital-gift).
    email: String(order?.digitalGift?.toEmail || order?.customerEmail || '').trim().toLowerCase(), clientId: order?.digitalGift ? null : order?.clientId || null, ...(order?.digitalGift ? { gift: true } : {}),
    copies: Math.max(1, c0(line?.qtyOrdered) || 1),
    license: { id: String(lic.id), name: String(lic.name || 'License'), terms: String(lic.terms || '') },
    access: { days, startsAt: start, endsAt: days > 0 ? new Date((Date.parse(start) || Date.now()) + days * 864e5).toISOString() : null, extendedUntil: null },
    downloads: { allowed: allowed === null ? null : allowed * Math.max(1, c0(line?.qtyOrdered) || 1), used: 0, extra: 0 },
    views: 0,
    status: 'active', revoked: null,
    createdAt: now,
    history: [{ at: now, what: 'Bought' }],
  };
}

/** Downloads left on a record: null means no limit. */
export function downloadsLeft(e: Pick<Entitlement, 'downloads'> | null | undefined): number | null {
  if (!e || e.downloads?.allowed == null) return null;
  return Math.max(0, c0(e.downloads.allowed) + c0(e.downloads.extra) - c0(e.downloads.used));
}

/** The end of access on a record, counting an extension the shop gave (null = for good). */
export function accessEndsAt(e: Pick<Entitlement, 'access'> | null | undefined): string | null {
  if (!e) return null;
  const ext = e.access?.extendedUntil ? Date.parse(e.access.extendedUntil) : NaN;
  const end = e.access?.endsAt ? Date.parse(e.access.endsAt) : NaN;
  if (!e.access?.endsAt) return null;
  if (Number.isFinite(ext) && ext >= Date.parse('9999-01-01T00:00:00.000Z')) return null;   // extended for good
  return new Date(Math.max(Number.isFinite(end) ? end : 0, Number.isFinite(ext) ? ext : 0)).toISOString();
}

/** What the customer may see of their record (no internal ids or history). */
export function publicEntitlement(e: Entitlement | null) {
  if (!e) return null;
  return { downloadsLeft: downloadsLeft(e), downloadsAllowed: e.downloads?.allowed == null ? null : c0(e.downloads.allowed) + c0(e.downloads.extra), license: e.license, endsAt: accessEndsAt(e), revoked: e.status === 'revoked' };
}

// ─── Reading and writing (firebase-admin) ────────────────────────────────────────

const ref = (db: any, tenantId: string, id: string) => db.doc(`tenants/${tenantId}/entitlements/${id}`);

/** Every digital line on a paid order gets its record, once. Safe to run again (existing records are kept as they are). */
export async function grantEntitlements(db: any, tenantId: string, orderId: string): Promise<number> {
  const snap = await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get();
  const order: any = snap.exists ? { ...snap.data(), id: orderId } : null;
  if (!order || !order.paidAt || ['placed', 'cancelled'].includes(String(order.stage))) return 0;
  // A failed read throws, so the after-payment step is tried again rather than recording the wrong license for good.
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tSnap?.exists ? tSnap.data() : null;
  let made = 0;
  for (const line of (order.lines || []).filter((l: any) => l?.digital === true)) {
    const itemSnap = await db.doc(`tenants/${tenantId}/inventory/${line.productId}`).get();
    let item: any = itemSnap.exists ? itemSnap.data() : {};
    // A variant sold inside its listing takes the listing's limit and license unless it has its own download.
    if (item?.parentId && item.digital !== true) {
      const ls = await db.doc(`tenants/${tenantId}/inventory/${item.parentId}`).get();
      if (ls.exists) { const { asSold } = await import('./variants'); item = asSold({ id: String(item.parentId), ...ls.data() }, { id: line.productId, ...item }); }
    }
    const e = buildEntitlement(tenantId, order, line, item, undefined, tenant);
    try { await ref(db, tenantId, e.id).create(e); made++; }
    catch (err: any) { if (!/ALREADY_EXISTS|already exists/i.test(String(err?.message || ''))) throw err; }
  }
  return made;
}

/** The record for one line, made now if the order was paid before records existed. Throws if it can't be read or made. */
export async function ensureEntitlement(db: any, tenantId: string, order: any, line: any, item: any): Promise<Entitlement> {
  const id = entitlementId(order.id, line.lineId || line.productId);
  const r = ref(db, tenantId, id);
  const s = await r.get();
  if (s.exists) return s.data() as Entitlement;
  const tSnap = await db.doc(`tenants/${tenantId}`).get();
  const e = buildEntitlement(tenantId, order, line, item, undefined, tSnap?.exists ? tSnap.data() : null);
  try { await r.create(e); return e; }
  catch (err) {
    // Made at the same moment by another open: use that one. Anything else is a real failure.
    const again = await r.get();
    if (again.exists) return again.data() as Entitlement;
    throw err;
  }
}

/**
 * Counts one use: a view (never limited) or a download (refused once the allowance is used). One transaction, so two
 * taps at once can't both take the last download. A download link is counted once however many times it's fetched
 * (`linkId`, unique to each link issued, is remembered for a while), so a reload or a resumed download costs nothing
 * more. A missing record is an error, never unlimited. Returns whether it may go ahead and what's left.
 */
export async function countUse(db: any, tenantId: string, id: string, kind: 'view' | 'download', linkId?: string): Promise<{ ok: boolean; left: number | null }> {
  const r = ref(db, tenantId, id);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(r);
    if (!s.exists) throw new Error('access record missing');
    const e = s.data() as Entitlement;
    if (kind === 'view') { tx.set(r, { views: c0(e.views) + 1 }, { merge: true }); return { ok: true, left: downloadsLeft(e) }; }
    const now = Date.now();
    const seen: { id: string; at: number }[] = (Array.isArray((e.downloads as any)?.seen) ? (e.downloads as any).seen : []).filter((x: any) => x && now - Number(x.at) < 15 * 60_000);
    const left = downloadsLeft(e);
    if (linkId && seen.some((x) => x.id === linkId)) return { ok: true, left };
    if (left !== null && left <= 0) return { ok: false, left: 0 };
    const nextSeen = linkId ? [...seen, { id: linkId, at: now }].slice(-10) : seen;
    tx.set(r, { downloads: { ...e.downloads, used: c0(e.downloads?.used) + 1, seen: nextSeen } }, { merge: true });
    return { ok: true, left: left === null ? null : left - 1 };
  });
}
