// src/lib/tenant-private.ts — PERSONAL DETAILS THAT DON'T BELONG ON THE PUBLIC BUSINESS RECORD. The business record
// (tenants/{id}) can be read by anyone with a booking link, so the owner's own mobile, the ship-from address (often a
// home), the curbside alert number, the guest Wi-Fi password and the invite code live in tenants/{id}/private/settings
// instead, which only the server can read. The team reads and changes them through /api/tenant-private; the server
// reads them here.
//
// Businesses from before this still have some of them on the business record. Until they're moved (movePrivateFields,
// run by the nightly job and whenever the team opens them), the old copy is used as a fallback, so nothing stops working.
import { FieldValue } from 'firebase-admin/firestore';

export type ShipFrom = { name?: string; company?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string; phone?: string; email?: string };
export type TenantPrivate = {
  ownerPhone: string;            // where owner briefs and alerts are texted (was clientNotify.ownerPhone)
  curbsideAlertPhone: string;    // who's texted when a curbside customer arrives (was retailSettings.curbsideAlertPhone)
  shipFrom: ShipFrom;            // printed on labels and used for rates (was retailSettings.shipFrom)
  wifiNetwork: string;           // shown to a checked-in client (was wifiNetwork)
  wifiPassword: string;          // (was wifiPassword)
  inviteCode: string;            // the early-access invite the business signed up with (was inviteCode)
};

const str = (v: any, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ref = (db: any, tenantId: string) => db.doc(`tenants/${tenantId}/private/settings`);

/** The old place each one lived on the business record. */
const LEGACY: Record<keyof TenantPrivate, string[]> = {
  ownerPhone: ['clientNotify', 'ownerPhone'],
  curbsideAlertPhone: ['retailSettings', 'curbsideAlertPhone'],
  shipFrom: ['retailSettings', 'shipFrom'],
  wifiNetwork: ['wifiNetwork'],
  wifiPassword: ['wifiPassword'],
  inviteCode: ['inviteCode'],
};
const at = (o: any, path: string[]) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);

export function cleanShipFrom(v: any): ShipFrom {
  if (!v || typeof v !== 'object') return {};
  const out: ShipFrom = {};
  for (const k of ['name', 'company', 'street1', 'street2', 'city', 'state', 'zip', 'country', 'phone', 'email'] as const) { const s = str(v[k], 120); if (s) out[k] = s; }
  return out;
}

/** The private details, newest place first, then any old copy still on the business record. */
export async function tenantPrivate(db: any, tenantId: string, tenant?: any): Promise<TenantPrivate> {
  // A failed read throws rather than looking empty: an empty answer would quietly send alerts to the wrong number.
  const p: any = ((await ref(db, tenantId).get()).data()) || {};
  const t = tenant || {};
  const pick = (k: keyof TenantPrivate) => (p[k] !== undefined && p[k] !== null ? p[k] : at(t, LEGACY[k]));
  return {
    ownerPhone: str(pick('ownerPhone'), 30),
    curbsideAlertPhone: str(pick('curbsideAlertPhone'), 30),
    shipFrom: cleanShipFrom(pick('shipFrom')),
    wifiNetwork: str(pick('wifiNetwork'), 80),
    wifiPassword: str(pick('wifiPassword'), 120),
    inviteCode: str(pick('inviteCode'), 40),
  };
}

/** A copy of the business record with the private details put back where server code has always looked for them. */
export function withPrivate(tenant: any, p: TenantPrivate): any {
  const t = { ...(tenant || {}) };
  t.clientNotify = { ...(t.clientNotify || {}), ownerPhone: p.ownerPhone || null };
  t.retailSettings = { ...(t.retailSettings || {}), curbsideAlertPhone: p.curbsideAlertPhone || null, shipFrom: p.shipFrom };
  t.wifiNetwork = p.wifiNetwork || null; t.wifiPassword = p.wifiPassword || null; t.inviteCode = p.inviteCode || null;
  return t;
}

/** Loads the business record with its private details in place: for server code that reads the old paths. */
export async function tenantWithPrivate(db: any, tenantId: string): Promise<any> {
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data()) || null;
  if (!t) return null;
  return withPrivate(t, await tenantPrivate(db, tenantId, t));
}

/** What the public record may say about the ship-from address: that it's complete (shop setup's checklist), and its
 *  state (where a pickup is taxed, lib/wholesale-tax) — never the address itself. */
export const shipFromMarkers = (s: ShipFrom) => ({ 'retailSettings.shipFromSet': !!(s.street1 && s.city && s.state && s.zip), 'retailSettings.shipFromState': s.state || null });

/** The shop settings with the private ship-from and alert number in place, or null when they couldn't be read (the
 *  caller says "try again" rather than working from a missing address). */
export async function retailWithPrivate(db: any, tenantId: string, tenant: any): Promise<any | null> {
  try { return withPrivate(tenant, await tenantPrivate(db, tenantId, tenant)).retailSettings || {}; }
  catch (e) { console.error('[tenant-private] read', tenantId, e); return null; }
}

/** Saves some of the private details (only the ones given). */
export async function setTenantPrivate(db: any, tenantId: string, patch: Partial<TenantPrivate>): Promise<void> {
  const out: any = { updatedAt: new Date().toISOString() };
  if (patch.ownerPhone !== undefined) out.ownerPhone = str(patch.ownerPhone, 30);
  if (patch.curbsideAlertPhone !== undefined) out.curbsideAlertPhone = str(patch.curbsideAlertPhone, 30);
  if (patch.shipFrom !== undefined) out.shipFrom = cleanShipFrom(patch.shipFrom);
  if (patch.wifiNetwork !== undefined) out.wifiNetwork = str(patch.wifiNetwork, 80);
  if (patch.wifiPassword !== undefined) out.wifiPassword = str(patch.wifiPassword, 120);
  if (patch.inviteCode !== undefined) out.inviteCode = str(patch.inviteCode, 40);
  await ref(db, tenantId).set(out, { merge: true });
  if (out.shipFrom) await db.doc(`tenants/${tenantId}`).update(shipFromMarkers(out.shipFrom));
}

/** Moves any old copies off the business record into the private place (a value already there wins), and drops
 *  internal notes that never belonged on it. Returns true when something was moved. Safe to run again. */
export async function movePrivateFields(db: any, tenantId: string, tenant?: any): Promise<boolean> {
  const t: any = tenant || ((await db.doc(`tenants/${tenantId}`).get()).data()) || {};
  const legacy = (Object.keys(LEGACY) as (keyof TenantPrivate)[]).filter((k) => at(t, LEGACY[k]) !== undefined);
  const lockNote = t.accessLockedReason !== undefined;
  const grantedBy = Object.entries(t.addons || {}).filter(([, a]: any) => a && typeof a === 'object' && 'grantedBy' in a).map(([k]) => k);
  if (!legacy.length && !lockNote && !grantedBy.length) return false;
  let p: any = {};
  if (legacy.length) {
    // A failed read stops the move (nothing is deleted), so an old copy can never overwrite a newer private value.
    p = ((await ref(db, tenantId).get()).data()) || {};
    const keep: Partial<TenantPrivate> = {};
    const empty = (k: keyof TenantPrivate) => p[k] === undefined || p[k] === null || p[k] === '' || (k === 'shipFrom' && !Object.keys(cleanShipFrom(p[k])).length);
    for (const k of legacy) if (empty(k)) (keep as any)[k] = at(t, LEGACY[k]);
    if (Object.keys(keep).length) await setTenantPrivate(db, tenantId, keep);
  }
  const del: any = {};
  for (const k of legacy) del[LEGACY[k].join('.')] = FieldValue.delete();
  // The markers follow the address that's in use: the private one when there is one, else the old copy being moved.
  if (legacy.includes('shipFrom')) { const priv = cleanShipFrom(p.shipFrom); Object.assign(del, shipFromMarkers(Object.keys(priv).length ? priv : cleanShipFrom(at(t, LEGACY.shipFrom)))); }
  if (lockNote) del.accessLockedReason = FieldValue.delete();
  for (const k of grantedBy) del[`addons.${k}.grantedBy`] = FieldValue.delete();
  await db.doc(`tenants/${tenantId}`).update(del);
  return true;
}
