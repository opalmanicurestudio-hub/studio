// src/app/api/renters/policies/route.ts — RENTAL POLICIES, IN ONE PLACE. The rules a business's leases are written from,
// read and saved together for the Rental policies page (components/renters/RentalPolicies): the lease's own terms
// (tenant.leasePolicy, lib/lease-builder), late rent and reminders (collectionsPolicy), time away (leavePolicy) and the
// charges allowed to a renter's card (incidentalCategories). What comes with the space keeps its own route
// (api/renters/offers); repair promises and house rules are shown here and set where they live.
//   GET  ?tenantId → every section as it reads now, plus a summary of repairs and house rules.
//   POST { tenantId, section, values } → saves one section. A change applies to leases sent from now on: a signed lease
//        keeps its own terms (lib/renter-offers, lib/incidentals, lib/collections-policy, lib/leave-policy).
// Guarded by requireCan('settings.manage'), so a manager who can manage settings can save, not only the owner.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { resolveLeasePolicy, leasePolicyPatch } from '@/lib/lease-builder';
import { resolveLeavePolicy } from '@/lib/leave-policy';
import { resolveCollectionsPolicy } from '@/lib/collections-policy';
import { resolveIncidentalPolicy } from '@/lib/incidentals';
import { responseCommitments } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });

async function read(db: any, tenantId: string) {
  const T = `tenants/${tenantId}`;
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const docs = (await db.collection(`${T}/documents`).where('status', '==', 'published').get()).docs.map((d: any) => d.data() || {});
  const houseRules = docs.filter((x: any) => Array.isArray(x.assignedRoles) && x.assignedRoles.includes('renter')).map((x: any) => `${String(x.title || 'House rules')}, version ${Number(x.version || 1)}`);
  return {
    lease: resolveLeasePolicy(t),
    leave: resolveLeavePolicy(t),
    collections: resolveCollectionsPolicy(t),
    charges: resolveIncidentalPolicy(t),
    chargesSaved: Array.isArray(t.incidentalCategories) && t.incidentalCategories.length > 0,
    repairs: responseCommitments(t.maintenanceRules || null).map((x) => ({ label: x.label, respondHours: x.respondHours, fixHours: x.fixHours })),
    houseRules,
    businessName: String(t.name || t.businessName || ''),
  };
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  return j({ ok: true, ...(await read(getAdminDb(), tenantId)) });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80);
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tRef = db.doc(`tenants/${tenantId}`);
  const t: any = ((await tRef.get()).data() as any) || {};
  const by = String(g.actor?.name || 'The owner'); const uid = g.actor?.uid || '';
  const v: any = b.values && typeof b.values === 'object' ? b.values : {};
  let summary = ''; let patch: Record<string, any> = {};

  if (b.section === 'lease') {
    const r = leasePolicyPatch(v, t);
    if (!r.changed.length) return j({ ok: true, unchanged: true, ...(await read(db, tenantId)) });
    patch = r.patch;
    // Insurance and license requirements are also what the renter's papers are checked against (lib/compliance).
    // Only when the requirement itself changed, so changing an amount never turns a check set elsewhere off.
    const was = resolveLeasePolicy(t);
    if (r.next.insurance.required !== was.insurance.required) patch['bookingPageSettings.automationRules.requireInsurance'] = r.next.insurance.required;
    if (r.next.licenseRequired !== was.licenseRequired) patch['bookingPageSettings.automationRules.requireLicense'] = r.next.licenseRequired;
    summary = `${by} changed the lease settings (${r.changed.join(', ')}); leases sent from now on are written from version ${r.next.version}`;
  } else if (b.section === 'leave') {
    // None offered means renters can't ask for time away in their portal.
    const next = resolveLeavePolicy({ leavePolicy: v });
    patch = { leavePolicy: next };
    summary = `${by} changed the time-away rules`;
  } else if (b.section === 'collections') {
    const next = resolveCollectionsPolicy({ collectionsPolicy: v });
    patch = { collectionsPolicy: next };
    summary = `${by} changed late rent and reminders`;
  } else if (b.section === 'charges') {
    const rows = (Array.isArray(v.charges) ? v.charges : []).slice(0, 30)
      .map((c: any) => ({ label: String(c?.label || '').trim().slice(0, 60), capCents: Math.max(0, Math.min(1_000_000, Math.round(Number(c?.capCents) || 0))) }))
      .filter((c: any) => c.label);
    const seen = new Set<string>();
    for (const c of rows) { const k = c.label.toLowerCase(); if (seen.has(k)) return j({ ok: false, error: `“${c.label}” is listed twice.` }, 400); seen.add(k); }
    if (!rows.length) return j({ ok: false, error: 'Add at least one charge, with its most it can be.' }, 400);
    if (rows.some((c: any) => c.capCents <= 0)) return j({ ok: false, error: 'Give each charge the most it can be.' }, 400);
    patch = { incidentalCategories: rows };
    summary = `${by} changed the charges allowed to a renter’s card (${rows.map((c: any) => `${c.label} up to $${(c.capCents / 100).toFixed(2)}`).join('; ')})`;
  } else {
    return j({ ok: false, error: 'Unknown section.' }, 400);
  }
  await tRef.update({ ...patch, rentalPoliciesUpdatedAt: new Date().toISOString() });
  await logAuditAdmin(db, tenantId, { action: `renters.policies_${b.section}`, targetType: 'tenant', targetId: tenantId, summary, actor: { type: 'user', id: uid, name: by } } as any).catch(() => {});
  return j({ ok: true, ...(await read(db, tenantId)) });
}
