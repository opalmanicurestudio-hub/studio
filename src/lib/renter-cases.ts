// src/lib/renter-cases.ts — RENTERS RUN THEIR OWN CASES. A booth renter is their own business: when one of their clients
// isn't happy, the case is theirs — it goes to their staff app, follows the Making it right settings THEY choose, and the
// salon's desk and managers don't see it in their list or act on it. The salon keeps what is the salon's: anything about
// safety in the space and equipment problems (those open as salon cases, with the renter told).
import { settingsOf, type MirSettings } from '@/lib/making-it-right';

const T = (t: string) => `tenants/${t}`;

/** Is this a matter for the salon even on a renter's visit? Safety and the building/equipment are. */
export const salonMatter = (o: { safety?: boolean; incidentType?: string | null }) => !!o.safety || o.incidentType === 'equipment';

/** The renter behind a visit's provider, if the provider is a renter. */
export function renterProvider(staff: any[], providerId?: string | null): any | null {
  if (!providerId) return null; const s = staff.find((m: any) => m.id === providerId);
  return s && (s.isRenter === true || s.role === 'renter') ? s : null;
}

/** A renter's own Making it right settings (raw), or null for "not set yet". */
export async function renterSettingsRaw(db: any, tenantId: string, staffId: string): Promise<any | null> {
  if (!staffId) return null; const s = await db.doc(`${T(tenantId)}/renterSettings/${staffId}`).get();
  return s.exists ? ((s.data() || {}).makingItRight || null) : null;
}

/** Settings for a renter: their own, filled from the business type's defaults — never the salon's choices. */
export function renterSettingsOf(tenant: any, raw: any | null): MirSettings {
  const S = settingsOf({ ...tenant, makingItRight: raw || {} });
  // Things that are the salon's alone stay off: cash refund pickups/apps, store credit (the salon's ledger), pay rules.
  return { ...S, fixes: { ...S.fixes, credit: false, replace: false, addon: false }, cashRefund: { ...S.cashRefund, pickup: false, credit: false, apps: { venmo: { on: false, from: '' }, zelle: { on: false, from: '' }, cashapp: { on: false, from: '' }, applecash: { on: false, from: '' } } } };
}

/** The settings that govern a case: the renter's for a renter's case, the salon's otherwise. */
export async function settingsForCase(db: any, tenantId: string, tenant: any, c: any): Promise<MirSettings> {
  if (c?.renterCase && c.renterStaffId) return renterSettingsOf(tenant, await renterSettingsRaw(db, tenantId, c.renterStaffId));
  return settingsOf(tenant);
}

/** Save a renter's settings (server). Only the parts a renter controls. */
export async function saveRenterSettings(db: any, tenantId: string, staffId: string, s: any) {
  const pick: any = {};
  if (Array.isArray(s?.reasons)) pick.reasons = s.reasons.slice(0, 20).map((r: any) => ({ id: String(r.id || '').slice(0, 40), label: String(r.label || '').slice(0, 80), safety: r.safety === true }));
  if (s?.fixes && typeof s.fixes === 'object') pick.fixes = { redo: s.fixes.redo !== false, refund: s.fixes.refund !== false, note: s.fixes.note !== false, credit: false };
  for (const k of ['redoWindowDays', 'replyHours', 'followUpDays']) if (s?.[k] !== undefined) pick[k] = s[k] === null ? null : Math.max(0, Math.min(365, Number(s[k]) || 0));
  if (s?.aftercare) pick.aftercare = { text: String(s.aftercare.text || '').slice(0, 1200), byService: {} };
  if (s?.fairUse) pick.fairUse = { requirePhotos: s.fairUse.requirePhotos !== false, maxFixes: Math.max(1, Math.min(10, Number(s.fairUse.maxFixes) || 2)), perMonths: Math.max(1, Math.min(24, Number(s.fairUse.perMonths) || 6)) };
  await db.doc(`${T(tenantId)}/renterSettings/${staffId}`).set({ makingItRight: pick, staffId, updatedAt: new Date().toISOString() }, { merge: true });
  return pick;
}
