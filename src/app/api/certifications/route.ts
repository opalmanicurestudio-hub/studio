// src/app/api/certifications/route.ts — CERTIFIED FOR A SERVICE (lib/certification, lib/certification-server). Called by
// the app and the staff app (lib/request-actor works out who is asking).
//   list     { staffId? }                       → services, records and steps (managers: everyone; others: themselves)
//   evaluate { staffId? }                       → certifies anyone who has now done everything (after signing a document)
// For people who manage documents (owner, managers, an educator role):
//   rule     { serviceId, rule }                → what certification for a service takes (or turns it off)
//   grant    { serviceId, staffIds[], how }     → already certified ("already") or renewed by a manager ("renewed")
//   watch    { serviceId, staffId, note? }      → a manager watched one and signs it off (also how a lapsed one is renewed)
//   remove   { serviceId, staffId }             → takes a certification away
// For people who change business settings:
//   mode     { mode: 'block' | 'warn' }         → what happens to someone who isn't certified
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { cleanRule, certId, certRuleOf, renewByFor } from '@/lib/certification';
import { syncService, syncAll, evaluateStaff, certificationData, todayFor } from '@/lib/certification-server';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  if (!tenantId) return j({ ok: false, error: 'Missing business.' }, 400);
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return j({ ok: false, error: who.error }, who.status);
  const a = who.actor; const caps = a.caps || [];
  const canManage = a.isOwner || caps.includes('documents.manage'); const canSettings = a.isOwner || caps.includes('settings.manage');
  const action = String(b.action || ''); const sid = (v: any) => String(v || '').slice(0, 120);

  if (action === 'list') {
    const target = canManage ? (b.staffId ? sid(b.staffId) : null) : a.staffId;
    return j({ ok: true, ...(await certificationData(db, tenantId, target)), canManage, canSettings });
  }
  if (action === 'evaluate') {
    const target = canManage && b.staffId ? sid(b.staffId) : a.staffId;
    return j({ ok: true, certified: await evaluateStaff(db, tenantId, target) });
  }
  if (action === 'mode') {
    if (!canSettings) return j({ ok: false, error: 'Your role doesn’t allow that — ask the owner.' }, 403);
    const mode = b.mode === 'block' ? 'block' : 'warn';
    await db.doc(`tenants/${tenantId}`).set({ certificationMode: mode }, { merge: true });
    const n = await syncAll(db, tenantId); return j({ ok: true, mode, services: n });
  }
  if (!canManage) return j({ ok: false, error: 'Your role doesn’t allow that — ask the owner.' }, 403);

  const serviceId = sid(b.serviceId); const svcRef = db.doc(`tenants/${tenantId}/services/${serviceId}`); const svcSnap = await svcRef.get();
  if (!svcSnap.exists) return j({ ok: false, error: 'That service isn’t there any more.' }, 404);
  const svc: any = svcSnap.data() || {}; const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const now = new Date().toISOString(); const today = todayFor(tenant);
  const staffName = async (id: string) => String(((await db.doc(`tenants/${tenantId}/staff/${id}`).get()).data() as any)?.name || 'Team member');

  if (action === 'rule') {
    const rule = cleanRule({ ...(b.rule || {}), required: b.rule?.required === true });
    await svcRef.set({ certification: rule, certManaged: true }, { merge: true });
    await syncService(db, tenantId, serviceId, tenant);
    if (rule.required) {   // anyone who has already done everything is certified now
      const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.filter((d: any) => { const s = d.data() || {}; return !s.archived && s.role !== 'renter' && !s.isRenter; });
      for (const s of staff) await evaluateStaff(db, tenantId, s.id);
    }
    return j({ ok: true, rule });
  }
  if (action === 'grant') {
    const ids = (Array.isArray(b.staffIds) ? b.staffIds : []).map(sid).filter(Boolean).slice(0, 60); const how = b.how === 'renewed' ? 'renewed' : 'already';
    const rule = certRuleOf(svc);
    for (const id of ids) await db.doc(`tenants/${tenantId}/certifications/${certId(id, serviceId)}`).set({ staffId: id, staffName: await staffName(id), serviceId, serviceName: svc.name || 'Service',
      status: 'certified', certifiedAt: now, how, by: a.name, renewBy: renewByFor(rule, today), lapsedAt: null, updatedAt: now }, { merge: true });
    await syncService(db, tenantId, serviceId, tenant); return j({ ok: true, granted: ids.length });
  }
  if (action === 'watch') {
    const id = sid(b.staffId); if (!id) return j({ ok: false, error: 'Who was it?' }, 400);
    const ref = db.doc(`tenants/${tenantId}/certifications/${certId(id, serviceId)}`); const rec: any = (await ref.get()).data() || null;
    await ref.set({ staffId: id, staffName: await staffName(id), serviceId, serviceName: svc.name || 'Service', watchedAt: now, watchedBy: a.name, watchedNote: String(b.note || '').trim().slice(0, 200) || null,
      ...(rec?.status === 'certified' ? {} : { status: 'working' }), updatedAt: now }, { merge: true });
    const certified = await evaluateStaff(db, tenantId, id);
    return j({ ok: true, certified: certified.includes(serviceId) });
  }
  if (action === 'remove') {
    const id = sid(b.staffId); await db.doc(`tenants/${tenantId}/certifications/${certId(id, serviceId)}`).set({ status: 'removed', removedAt: now, removedBy: a.name, updatedAt: now }, { merge: true });
    await syncService(db, tenantId, serviceId, tenant); return j({ ok: true });
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
