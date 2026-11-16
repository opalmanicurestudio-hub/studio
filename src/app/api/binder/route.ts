// src/app/api/binder/route.ts — READY FOR THE INSPECTOR (lib/food-safety, lib/food-safety-server; the page at /binder;
// design canvas "Food numbers": the binder). Managers and owners.
//   view          { tenantId, month? } → the month's food safety logs (with the closing temperatures and the dish
//                 machine's readings), the certificates and permits, equipment and service, the allergen chart, and the
//                 incidents; the team, to pick from
//   log           { tenantId, kind: 'delivery'|'hot'|'cold', item, tempF, supplier?, deliveryKind?, note? } → a reading,
//                 logged by the manager (the kitchen screen logs them too, api/kitchen 'safetyLog'; cooling is only logged
//                 there, since the screen asks for each check when it's due)
//   coolDone      { tenantId, logId, done } → what was done about a cooling batch that missed its mark with nothing
//                 written down (reheated, or thrown out), once
//   permit        { tenantId, id?, kind, label?, staffId?, expires?, note? } → a certificate or permit added or changed
//   permitRemove  { tenantId, id }
//   service       { tenantId, preset, lastDone? } → a usual service (hood cleaning, the fire suppression check…) added to
//                 Maintenance's plans, its first ticket when it's next due
//   incident      { tenantId, kind: 'guest'|'sent_home', what?, person?, ate?, done?, staffId? } → written down today
//   incidentClear { tenantId, id } → someone sent home cleared to work again
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { tonight } from '@/lib/night-close-server';
import { cleanMonth, monthOfDay } from '@/lib/records';
import { addIncident, addService, binderView, clearIncident, coolCheck, recordLog, SafetyStop, savePermit } from '@/lib/food-safety-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['view', 'log', 'coolDone', 'permit', 'permitRemove', 'service', 'incident', 'incidentClear'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  const by = String(g.actor?.name || 'A manager').slice(0, 60); const actor = { type: 'user', id: String(g.actor?.uid || ''), name: by };
  try {
    if (action === 'view') {
      const today = tonight(tenant); const month = cleanMonth(b.month) || monthOfDay(today);
      if (month > monthOfDay(today)) return bad('That month hasn’t started yet.');
      return ok({ ...(await binderView(db, tenantId, tenant, month)), business: String(tenant.name || '') });
    }
    if (action === 'log') {
      if (!['delivery', 'hot', 'cold'].includes(String(b.kind))) return bad('Cooling is logged on the kitchen screen, which asks for each check when it’s due.');
      return ok({ log: await recordLog(db, tenantId, tenant, b, { name: by, staffId: null }) });
    }
    if (action === 'coolDone') {
      // Only for a batch past its mark: with no reading, one still cooling is refused (its check is the kitchen's).
      if (!String(b.done || '').trim()) return bad('Say what was done: reheated, or thrown out.');
      const log = await coolCheck(db, tenantId, tenant, String(b.logId || ''), undefined, b.done, { name: by, staffId: null });
      await logAuditAdmin(db, tenantId, { action: 'binder.cool_done', targetType: 'safetyLog', targetId: log.id, summary: `${by} wrote down what was done about ${log.item} (${log.day}), after it missed its cooling mark: ${log.cooling?.done || ''}.`, actor } as any).catch(() => {});
      return ok({ log });
    }
    if (action === 'permit') {
      const r = await savePermit(db, tenantId, b, by);
      await logAuditAdmin(db, tenantId, { action: 'binder.permit', targetType: 'permit', targetId: r.id, summary: `${by} put ${String(b.label || b.kind || 'a permit').slice(0, 60)} on the binder${b.expires ? `, running out ${b.expires}` : ''}.`, actor } as any).catch(() => {});
      return ok(r);
    }
    if (action === 'permitRemove') {
      const id = String(b.id || ''); if (!ID.test(id)) return bad('Which one?');
      const ref = db.doc(`${T}/permits/${id}`); const x: any = (await ref.get()).data(); if (!x) return ok({ already: true });
      await ref.delete();
      await logAuditAdmin(db, tenantId, { action: 'binder.permit_remove', targetType: 'permit', targetId: id, summary: `${by} took ${String(x.label || 'a permit')} off the binder.`, actor } as any).catch(() => {});
      return ok({});
    }
    if (action === 'service') return ok(await addService(db, tenantId, tenant, b.preset, b.lastDone));
    if (action === 'incident') {
      const r = await addIncident(db, tenantId, tenant, b, by);
      await logAuditAdmin(db, tenantId, { action: b.kind === 'sent_home' ? 'binder.sent_home' : 'binder.incident', targetType: 'incident', targetId: r.id, summary: b.kind === 'sent_home' ? `${by} wrote down someone sent home sick.` : `${by} wrote down an incident.`, actor } as any).catch(() => {});
      return ok(r);
    }
    await clearIncident(db, tenantId, String(b.id || ''), by);
    return ok({});
  } catch (e: any) {
    if (e instanceof SafetyStop) return bad(e.msg, e.status);
    console.error('[binder]', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
