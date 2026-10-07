// src/lib/ops-tick.ts — THE HOUSEKEEPING STEP for stations, kits and linens (server only). For one business it:
//   1. reminds the right person about a station that still needs resetting (owner first, then managers),
//   2. closes out finished visits: a kit nobody scanned back goes to "needs cleaning"; the visit's linens go clean → dirty,
//   3. keeps the kit capacity on the business record up to date (booking reads it to avoid promising a kit that isn't there).
// It runs from the scheduled job AND from any open front desk (/api/desk/tick), so nothing depends on the schedule alone.
// Safe to run often and from several places: every step is once-per-visit or compares before it writes.
import { stageOf } from '@/lib/visit';
import { automationOn, noteAutomation } from '@/lib/automation-switches';
import { attendantIds } from '@/lib/attendant';

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
        // Where the business has named housekeeping people, the first reminder goes to them rather than the provider.
        const att = attendantIds(tenant).filter((id) => staff.some((m: any) => m.id === id && m.active !== false));
        const to: string[] = n.level === 1 ? (att.length ? att : n.ownerId ? [n.ownerId] : []) : Array.from(new Set([...managers, ...(n.ownerId ? [n.ownerId] : [])]));
        const b = db.batch(); b.update(db.doc(`${T}/resources/${n.resourceId}`), { 'readiness.notice': { visitId: n.visitId, level: n.level, at: nowIso } });
        for (const uid of to) { const ref = db.collection(`${T}/notifications`).doc(); b.set(ref, { id: ref.id, userId: uid, type: n.level === 1 ? 'turnover_due' : 'turnover_escalation', priority: n.level === 1 ? 'high' : 'urgent', link: n.level === 1 ? '/staff-portal/' + tenantId : '/pos', resourceId: n.resourceId, appointmentId: n.visitId, message: n.message, createdAt: nowIso, read: false }); }
        await b.commit(); if (to.length) { out.turnoverNudges++; await noteAutomation(db, tenantId, 'turnover-notices'); }
      } }
  } catch (e) { console.error('[ops-tick] turnover', tenantId, e); } }

  // 2a) Kits left "in use" after their visit
  if (kitsAll.length) { try {
    const { kitsLeftOut, KIT_LABEL } = await import('@/lib/kits'); const { logAuditAdmin } = await import('@/lib/audit');
    for (const k of kitsLeftOut(kitsAll as any, (id) => { const a = appts.find((x: any) => x.id === id); return a ? stage(a) : null; }, now)) {
      await db.doc(`${T}/kits/${k.id}`).update({ status: 'dirty', by: 'System', at: nowIso, visitId: null, clientName: null, stationName: null, history: [...((k as any).history || []), { at: nowIso, by: 'System', from: 'in_use', to: 'dirty', note: 'Visit finished' }].slice(-40) });
      await logAuditAdmin(db, tenantId, { action: 'kit.dirty', targetType: 'kit', targetId: k.id, actor: { type: 'system', name: 'visit close-out' }, before: { status: 'in_use' }, after: { status: 'dirty' }, summary: `${k.name} ${k.code}: ${KIT_LABEL.in_use} → ${KIT_LABEL.dirty} — visit finished${k.clientName ? ` (${k.clientName})` : ''}` });
      out.kitsReleased++; }
    await syncKits(db, tenantId, tenant, kitsAll, now);
    await kitTimers(db, tenantId, kitsAll, now);
  } catch (e) { console.error('[ops-tick] kits', tenantId, e); } }
  else if (tenant?.kitCapacity && Object.keys(tenant.kitCapacity).length) { try { await db.doc(T).set({ kitCapacity: {} }, { mergeFields: ['kitCapacity'] }); } catch { /* next run */ } }

  // 2b) Linens used by finished visits (types counted by bundle scans are left alone)
  const auto = linens;   // tagged-bundle types too: a finished visit's linens come off the floor first, so nothing is counted twice
  if (auto.length) { try {
    const { linensForVisit, moveLinen, sameLinen } = await import('@/lib/linens');
    const done = appts.filter((a: any) => !a.linensCounted && ['ready_to_pay', 'complete'].includes(stage(a)));
    if (done.length) { const svc = await services(); const b = db.batch(); const touched = new Set<string>(); let any = false;
      for (const a of done) { const needs = linensForVisit(a, svc).filter((n) => auto.some((l: any) => sameLinen(l.name, n.name))); if (!needs.length) continue;
        for (const n of needs) { const l: any = auto.find((x: any) => sameLinen(x.name, n.name)); const back = moveLinen(l, 'return', n.qty); l.inUse = back.inUse; l.dirty = back.dirty; if (back.moved < n.qty) { const r = moveLinen(l, 'use', n.qty - back.moved); l.clean = r.clean; l.dirty = r.dirty; } touched.add(l.id); }
        b.set(a.ref, { linensCounted: true }, { merge: true }); any = true; out.linenVisits++; }
      for (const l of auto) if (touched.has(l.id)) b.update(db.doc(`${T}/linens/${l.id}`), { clean: l.clean, dirty: l.dirty, inUse: Math.max(0, Number(l.inUse) || 0), by: 'System', at: nowIso });
      if (any) await b.commit(); }
    await washTimers(db, tenantId, linens, now);
  } catch (e) { console.error('[ops-tick] linens', tenantId, e); } }
  return out;
}

const managerIds = async (db: any, T: string): Promise<string[]> => (await db.collection(`${T}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs.filter((d: any) => d.data()?.active !== false).map((d: any) => d.id);
const notify = (db: any, b: any, T: string, userId: string, n: { type: string; priority?: string; message: string; at: string }) => { const ref = db.collection(`${T}/notifications`).doc(); b.set(ref, { id: ref.id, userId, type: n.type, priority: n.priority || 'high', link: '/pos', message: n.message, createdAt: n.at, read: false }); };

/** Keeps what depends on the kits in step with them, writing only what changed:
 *   • tenant.kitCapacity — booking reads it (how many kits of each type can be used, and their cleaning time);
 *   • each contents item's stock allocation — the products inside the kits are held as "in kits" in Inventory, so they
 *     aren't counted as spare or sold; (kits of the type × how many in each);
 *   • a one-a-day alert to managers when a kit type has none usable (booking for services needing it pauses near-term).
 * Called by the housekeeping step, and straight away when a kit is added, pulled out, put back or retired. */
export async function syncKits(db: any, tenantId: string, tenant: any, kitsAll?: any[], now = Date.now()): Promise<void> {
  const T = `tenants/${tenantId}`; const { kitCapacityOf, kitKey, sameKitType } = await import('@/lib/kits');
  const kits: any[] = kitsAll || (await db.collection(`${T}/kits`).limit(400).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const types: any[] = (await db.collection(`${T}/kitTypes`).limit(100).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const cap = kitCapacityOf(kits as any, types as any);
  if (JSON.stringify(cap) !== JSON.stringify(tenant?.kitCapacity || {})) await db.doc(T).set({ kitCapacity: cap }, { mergeFields: ['kitCapacity'] });
  // Stock held inside kits.
  const want: Record<string, Record<string, { type: 'kit'; id: string; name: string; qty: number }>> = {};   // itemId → allocation key → allocation
  for (const t of types) { const n = kits.filter((k) => k.status !== 'retired' && sameKitType(k.name, t.name)).length; if (!n) continue;
    for (const it of t.items || []) { if (!it?.inventoryItemId) continue; const key = `kit:${kitKey(t.name)}`; (want[it.inventoryItemId] ||= {})[key] = { type: 'kit', id: kitKey(t.name), name: `${t.name} (in kits)`, qty: n * Math.max(1, Number(it.qty) || 1) }; } }
  const mark = db.doc(`${T}/private/kitStock`); const prev: string[] = (await mark.get()).data()?.itemIds || []; const ids = Array.from(new Set([...prev, ...Object.keys(want)])).slice(0, 300);
  if (ids.length) { const snaps = await db.getAll(...ids.map((id) => db.doc(`${T}/inventory/${id}`))); const b = db.batch(); let any = false;
    for (const snap of snaps) { if (!snap.exists) continue; const cur: Record<string, any> = snap.data()?.allocations || {}; const next: Record<string, any> = {};
      for (const [k, v] of Object.entries(cur)) if (!k.startsWith('kit:')) next[k] = v;
      for (const [k, v] of Object.entries(want[snap.id] || {})) next[k] = v;
      if (JSON.stringify(next) !== JSON.stringify(cur)) { b.update(snap.ref, { allocations: next }); any = true; } }
    if (any) await b.commit();
    if (JSON.stringify(Object.keys(want).sort()) !== JSON.stringify([...prev].sort())) await mark.set({ itemIds: Object.keys(want) }, { merge: true }); }
  // No usable kit of a type → tell the managers (once a day per type).
  const today = new Date(now).toISOString().slice(0, 10); const told: Record<string, string> = (await db.doc(`${T}/private/opsTick`).get()).data()?.kitZero || {};
  const zero = Object.entries(cap).filter(([key, c]) => c.usable === 0 && told[key] !== today);
  if (zero.length) { const mgrs = await managerIds(db, T); const b = db.batch(); const at = new Date(now).toISOString();
    for (const [key, c] of zero) { told[key] = today; for (const uid of mgrs) notify(db, b, T, uid, { type: 'kit_none_usable', priority: 'urgent', at, message: `Every ${c.name} is pulled out — new bookings that need one are paused for today and tomorrow until one is back in service.` }); }
    b.set(db.doc(`${T}/private/opsTick`), { kitZero: told }, { merge: true }); await b.commit(); }
}
/** A kit's cleaning time is up → tell whoever started cleaning it (else the managers). Once per cleaning. */
async function kitTimers(db: any, tenantId: string, kits: any[], now: number): Promise<void> {
  const T = `tenants/${tenantId}`; const cleaning = kits.filter((k) => k.status === 'cleaning' && k.at && k.timerToldFor !== k.at); if (!cleaning.length) return;
  const { typeOf, secondsLeft } = await import('@/lib/kits'); const types: any[] = (await db.collection(`${T}/kitTypes`).limit(100).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const due = cleaning.filter((k) => { const m = Number(typeOf(types as any, k.name)?.cleanMinutes) || 0; return m > 0 && secondsLeft(k.at, m, now) <= 0; }); if (!due.length) return;
  let mgrs: string[] | null = null; const b = db.batch(); const at = new Date(now).toISOString();
  for (const k of due) { const to = k.byId ? [k.byId] : (mgrs ||= await managerIds(db, T)); for (const uid of to) notify(db, b, T, uid, { type: 'kit_timer', at, message: `${k.name} ${k.code} has finished its cleaning time — check its contents and mark it ready.` }); b.update(db.doc(`${T}/kits/${k.id}`), { timerToldFor: k.at }); }
  await b.commit();
}
/** A wash load's time is up → tell whoever started it (else the managers). Once per load. */
async function washTimers(db: any, tenantId: string, linens: any[], now: number): Promise<void> {
  const T = `tenants/${tenantId}`; const { secondsLeft } = await import('@/lib/kits');
  const due = linens.filter((l) => Number(l.washing) > 0 && l.washStartedAt && Number(l.washMinutes) > 0 && l.washToldFor !== l.washStartedAt && secondsLeft(l.washStartedAt, Number(l.washMinutes), now) <= 0); if (!due.length) return;
  let mgrs: string[] | null = null; const b = db.batch(); const at = new Date(now).toISOString();
  for (const l of due) { const to = l.washById ? [l.washById] : (mgrs ||= await managerIds(db, T)); for (const uid of to) notify(db, b, T, uid, { type: 'linen_timer', at, message: `The ${String(l.name).toLowerCase()} wash load should be done — ${l.washing} to put back as clean.` }); b.update(db.doc(`${T}/linens/${l.id}`), { washToldFor: l.washStartedAt }); }
  await b.commit();
}
