// src/lib/ops-tick.ts — THE HOUSEKEEPING STEP for stations, kits and linens (server only). For one business it:
//   1. reminds the right person about a station that still needs resetting (owner first, then managers),
//   2. closes out finished visits: a kit nobody scanned back goes to "needs cleaning"; the visit's linens go clean → dirty,
//   3. keeps the kit capacity on the business record up to date (booking reads it to avoid promising a kit that isn't there).
// It runs from the scheduled job AND from any open front desk (/api/desk/tick), so nothing depends on the schedule alone.
// Safe to run often and from several places: every step is once-per-visit or compares before it writes.
import { stageOf } from '@/lib/visit';
import { automationOn, noteAutomation } from '@/lib/automation-switches';

export async function opsTick(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<{ turnoverNudges: number; kitsReleased: number; linenVisits: number }> {
  const T = `tenants/${tenantId}`; const nowIso = new Date(now).toISOString(); const out = { turnoverNudges: 0, kitsReleased: 0, linenVisits: 0 };
  const rows = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() || {}) }));
  const [resources, kitsAll, linens] = await Promise.all([db.collection(`${T}/resources`).limit(200).get().then(rows), db.collection(`${T}/kits`).limit(400).get().then(rows), db.collection(`${T}/linens`).limit(100).get().then(rows)]);
  if (!resources.length && !kitsAll.length && !linens.length) return out;   // this business uses none of it
  const appts: any[] = rows(await db.collection(`${T}/appointments`).where('startTime', '>=', new Date(now - 18 * 3600000).toISOString()).where('startTime', '<=', new Date(now + 6 * 3600000).toISOString()).get());
  const stage = (a: any) => (['cancelled', 'no_show', 'declined'].includes(String(a.status)) ? 'cancelled' : stageOf(a));
  let servicesCache: any[] | null = null; const services = async () => (servicesCache ||= rows(await db.collection(`${T}/services`).get()));

  // 1) Turnover reminders
  if (resources.length && automationOn(tenant, 'turnover-notices')) { try {
    const { serviceEndedAt, stationReadiness } = await import('@/lib/readiness');
    if (appts.some((a: any) => Array.isArray(a.requiredResourceIds) && a.requiredResourceIds.length && serviceEndedAt(a) > now - 4 * 3600000)) {
      const [staff, protocols] = await Promise.all(['staff', 'protocols'].map((c) => db.collection(`${T}/${c}`).get().then(rows)));
      const { turnoverNotices } = await import('@/lib/turnover-notices');
      for (const n of turnoverNotices(stationReadiness(resources, appts, await services(), now, staff, protocols), resources, now, tenant?.timezone || tenant?.timeZone)) {
        const managers = staff.filter((m: any) => ['owner', 'admin', 'manager'].includes(String(m.role)) && m.active !== false).map((m: any) => m.id);
        const to: string[] = n.level === 1 ? (n.ownerId ? [n.ownerId] : []) : Array.from(new Set([...managers, ...(n.ownerId ? [n.ownerId] : [])]));
        const b = db.batch(); b.update(db.doc(`${T}/resources/${n.resourceId}`), { 'readiness.notice': { visitId: n.visitId, level: n.level, at: nowIso } });
        for (const uid of to) { const ref = db.collection(`${T}/notifications`).doc(); b.set(ref, { id: ref.id, userId: uid, type: n.level === 1 ? 'turnover_due' : 'turnover_escalation', priority: n.level === 1 ? 'high' : 'urgent', link: n.level === 1 ? '/staff-portal/' + tenantId : '/pos', resourceId: n.resourceId, appointmentId: n.visitId, message: n.message, createdAt: nowIso, read: false }); }
        await b.commit(); if (to.length) { out.turnoverNudges++; await noteAutomation(db, tenantId, 'turnover-notices'); }
      } }
  } catch (e) { console.error('[ops-tick] turnover', tenantId, e); } }

  // 2a) Kits left "in use" after their visit
  if (kitsAll.length) { try {
    const { kitsLeftOut, KIT_LABEL, kitCapacityOf } = await import('@/lib/kits'); const { logAuditAdmin } = await import('@/lib/audit');
    for (const k of kitsLeftOut(kitsAll as any, (id) => { const a = appts.find((x: any) => x.id === id); return a ? stage(a) : null; }, now)) {
      await db.doc(`${T}/kits/${k.id}`).update({ status: 'dirty', by: 'System', at: nowIso, visitId: null, clientName: null, stationName: null, history: [...((k as any).history || []), { at: nowIso, by: 'System', from: 'in_use', to: 'dirty', note: 'Visit finished' }].slice(-40) });
      await logAuditAdmin(db, tenantId, { action: 'kit.dirty', targetType: 'kit', targetId: k.id, actor: { type: 'system', name: 'visit close-out' }, before: { status: 'in_use' }, after: { status: 'dirty' }, summary: `${k.name} ${k.code}: ${KIT_LABEL.in_use} → ${KIT_LABEL.dirty} — visit finished${k.clientName ? ` (${k.clientName})` : ''}` });
      out.kitsReleased++; }
    // 3) Kit capacity for booking — written only when it changed.
    const types = rows(await db.collection(`${T}/kitTypes`).limit(100).get()); const cap = kitCapacityOf(kitsAll as any, types as any);
    if (JSON.stringify(cap) !== JSON.stringify(tenant?.kitCapacity || {})) await db.doc(T).set({ kitCapacity: cap }, { mergeFields: ['kitCapacity'] });
  } catch (e) { console.error('[ops-tick] kits', tenantId, e); } }
  else if (tenant?.kitCapacity && Object.keys(tenant.kitCapacity).length) { try { await db.doc(T).set({ kitCapacity: {} }, { mergeFields: ['kitCapacity'] }); } catch { /* next run */ } }

  // 2b) Linens used by finished visits (types counted by bundle scans are left alone)
  const auto = linens.filter((l: any) => !l.byBundle);
  if (auto.length) { try {
    const { linensForVisit, moveLinen, sameLinen } = await import('@/lib/linens');
    const done = appts.filter((a: any) => !a.linensCounted && ['ready_to_pay', 'complete'].includes(stage(a)));
    if (done.length) { const svc = await services(); const b = db.batch(); const touched = new Set<string>(); let any = false;
      for (const a of done) { const needs = linensForVisit(a, svc).filter((n) => auto.some((l: any) => sameLinen(l.name, n.name))); if (!needs.length) continue;
        for (const n of needs) { const l: any = auto.find((x: any) => sameLinen(x.name, n.name)); const r = moveLinen(l, 'use', n.qty); l.clean = r.clean; l.dirty = r.dirty; touched.add(l.id); }
        b.set(a.ref, { linensCounted: true }, { merge: true }); any = true; out.linenVisits++; }
      for (const l of auto) if (touched.has(l.id)) b.update(db.doc(`${T}/linens/${l.id}`), { clean: l.clean, dirty: l.dirty, by: 'System', at: nowIso });
      if (any) await b.commit(); }
  } catch (e) { console.error('[ops-tick] linens', tenantId, e); } }
  return out;
}
