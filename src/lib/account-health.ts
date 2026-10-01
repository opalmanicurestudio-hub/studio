// src/lib/account-health.ts — SERVER-SIDE ACCOUNT CHECK for one business (HQ "Run account check").
// The same kinds of findings the customer's own Account check shows, worked out from the database — no device needed:
// ownership, locations (missing / duplicates / records pointing at deleted ones), online orders stuck waiting for
// payment, Stripe connection, account status, and whether the scheduled tasks are actually running. What only the
// customer's device can show (what their login can read, saved data) still comes from their Account check.
import { isBusinessLocation, DEFAULT_LOCATION_DOC_ID } from '@/lib/location-kind';

export interface HealthFinding { key: string; level: 'ok' | 'warn' | 'info'; text: string }
const HEARTBEATS: [string, string, number][] = [['retail-payments', 'Online-order payment check', 20], ['no-shows', 'No-show check', 20]];   // [task, label, minutes before it counts as stopped]

/** A scheduled task records that it ran (HQ uses this to spot a task that has stopped). */
export async function heartbeat(db: any, task: string) { try { await db.doc('platformHealth/crons').set({ [task]: new Date().toISOString() }, { merge: true }); } catch { /* never block the task */ } }

export async function serverHealthCheck(db: any, tenantId: string) {
  const T = `tenants/${tenantId}`; const f: HealthFinding[] = []; const now = Date.now();
  const t: any = (await db.doc(T).get()).data();
  if (!t) return { summary: 'Business not found', findings: [{ key: 'missing', level: 'warn', text: 'No business with this id.' }] as HealthFinding[], details: {} };
  const safe = async (q: any) => { try { return (await q.get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })); } catch { return null; } };
  // Ownership
  const u: any = t.userId ? (await db.doc(`users/${t.userId}`).get().catch(() => null))?.data?.() || null : null;
  if (!t.userId) f.push({ key: 'no_owner', level: 'warn', text: 'No owner recorded on the business (userId missing) — the owner can’t load most areas until it’s set.' });
  else if (u && u.tenantId && u.tenantId !== tenantId) f.push({ key: 'owner_mismatch', level: 'warn', text: `The owner’s user record points at a different business (${u.tenantId}).` });
  else f.push({ key: 'owner', level: 'ok', text: `Owner recorded${u?.email ? ` (${u.email})` : ''}.` });
  if (t.accessLocked || t.suspended) f.push({ key: 'locked', level: 'warn', text: 'Account is paused or locked.' });
  if (t.subscriptionStatus && !['active', 'trialing', 'trial'].includes(String(t.subscriptionStatus))) f.push({ key: 'subscription', level: 'info', text: `Subscription status: ${t.subscriptionStatus}.` });
  // Locations
  const locs = (await safe(db.collection(`${T}/locations`))) || [];
  const biz = locs.filter(isBusinessLocation); const ids = new Set(locs.map((l: any) => l.id));
  const names = biz.map((l: any) => String(l.name || '').trim().toLowerCase()); const dupes = names.length - new Set(names).size;
  if (!biz.length) f.push({ key: 'no_location', level: 'warn', text: 'No business location — the owner can use “Restore my main location” on their Account check.' });
  else f.push({ key: 'locations', level: dupes ? 'info' : 'ok', text: `${biz.length} location${biz.length === 1 ? '' : 's'}${dupes ? ` — ${dupes + 1} share the same name (merge in Settings → Locations)` : ''}.` });
  if (t.primaryLocationId && !ids.has(t.primaryLocationId)) f.push({ key: 'primary_missing', level: 'warn', text: `Main location (${t.primaryLocationId}) no longer exists.` });
  const staff = (await safe(db.collection(`${T}/staff`))) || [];
  const staffStale = staff.filter((s: any) => (Array.isArray(s.locationIds) ? s.locationIds : []).some((x: string) => !ids.has(x))).length;
  if (staffStale) f.push({ key: 'staff_locations', level: 'warn', text: `${staffStale} team member${staffStale === 1 ? ' has' : 's have'} access to a location that no longer exists (Restore my main location fixes this).` });
  const appts = (await safe(db.collection(`${T}/appointments`).where('locationId', '>', '').limit(400))) || [];
  const apptStale = appts.filter((a: any) => typeof a.locationId === 'string' && a.locationId && !ids.has(a.locationId)).length;
  if (apptStale) f.push({ key: 'appointment_locations', level: 'info', text: `${apptStale} appointment${apptStale === 1 ? '' : 's'} point at a deleted location.` });
  // Online orders waiting for payment
  const placed = (await safe(db.collection(`${T}/retailOrders`).where('stage', '==', 'placed').limit(100))) || [];
  const stuck = placed.filter((o: any) => now - (Date.parse(o.placedAt || o.createdAt || '') || now) > 30 * 60000);
  if (stuck.length) f.push({ key: 'orders_waiting', level: 'warn', text: `${stuck.length} online order${stuck.length === 1 ? '' : 's'} waiting for payment confirmation over 30 min (oldest ${Math.round(Math.max(...stuck.map((o: any) => now - Date.parse(o.placedAt || o.createdAt || ''))) / 3600000)} h).` });
  // Stripe
  if (!t.stripeAccountId) f.push({ key: 'stripe', level: 'info', text: 'Stripe not connected — online payments are off.' });
  else if (t.stripeChargesEnabled === false) f.push({ key: 'stripe', level: 'warn', text: 'Stripe connected but charges are disabled (Stripe needs more information from the business).' });
  // Scheduled tasks (platform-wide)
  const hb: any = (await db.doc('platformHealth/crons').get().catch(() => null))?.data?.() || {};
  for (const [task, label, mins] of HEARTBEATS) { const at = Date.parse(hb[task] || '') || 0;
    if (!at) f.push({ key: `cron_${task}`, level: 'warn', text: `${label} has never reported running — check the Vercel cron and CRON_SECRET.` });
    else if (now - at > mins * 60000) f.push({ key: `cron_${task}`, level: 'warn', text: `${label} last ran ${Math.round((now - at) / 60000)} min ago — it may have stopped.` }); }
  const issues = f.filter((x) => x.level === 'warn').length;
  return { summary: issues ? `${issues} issue${issues === 1 ? '' : 's'} found` : 'No issues found', findings: f,
    details: { tenantId, name: t.name || null, ownerUid: t.userId || null, locations: biz.map((l: any) => ({ id: l.id, name: l.name })), duplicates: dupes, primaryLocationId: t.primaryLocationId || null, primaryExists: ids.has(DEFAULT_LOCATION_DOC_ID), staffWithDeletedLocations: staffStale, appointmentsWithDeletedLocations: apptStale, ordersWaiting: stuck.length, crons: hb } };
}
