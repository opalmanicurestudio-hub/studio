// src/lib/certification-server.ts — CERTIFICATION ON THE SERVER (lib/certification has the rules). Keeps each service's
// certified list in step with the records and the business's block-or-warn choice, certifies people once they've done
// everything, and lets certifications that weren't renewed in time run out (daily, from the reminders cron).
import { certModeOf, certRuleOf, certId, certifiedIds, gateFields, certSteps, stepsDone, renewByFor, isCurrent, type CertRecord } from '@/lib/certification';
import { tenantTimeZone, dayKey } from '@/lib/tenant-time';

const T = (t: string) => `tenants/${t}`;
export const todayFor = (tenant: any) => dayKey(new Date(), tenantTimeZone(tenant));

/** Writes the service's certStaffIds (and, in block mode, the certifiedStaffIds the booking engine honours). */
export async function syncService(db: any, tenantId: string, serviceId: string, tenant?: any) {
  const tn = tenant || (await db.doc(T(tenantId)).get()).data() || {};
  const ref = db.doc(`${T(tenantId)}/services/${serviceId}`); const snap = await ref.get(); if (!snap.exists) return null;
  const svc: any = snap.data() || {}; const rule = certRuleOf(svc);
  if (!rule.required && !svc.certManaged) return null;   // never touched a list we don't own
  const recs = (await db.collection(`${T(tenantId)}/certifications`).where('serviceId', '==', serviceId).get()).docs.map((d: any) => d.data() || {});
  const renters = (await db.collection(`${T(tenantId)}/staff`).where('role', '==', 'renter').get()).docs.map((d: any) => d.id);
  const ids = certifiedIds(recs, serviceId, todayFor(tn)); const g = gateFields(rule, certModeOf(tn), ids, renters);
  const { FieldValue } = await import('firebase-admin/firestore');
  await ref.set({ certStaffIds: g.certStaffIds, certifiedStaffIds: g.certifiedStaffIds ?? FieldValue.delete(), certManaged: true }, { merge: true });
  return g;
}

export async function syncAll(db: any, tenantId: string, tenant?: any) {
  const tn = tenant || (await db.doc(T(tenantId)).get()).data() || {};
  const svcs = (await db.collection(`${T(tenantId)}/services`).get()).docs.filter((d: any) => { const x = d.data() || {}; return certRuleOf(x).required || x.certManaged; });
  for (const d of svcs) await syncService(db, tenantId, d.id, tn);
  return svcs.length;
}

/** Each person's sign-offs on the documents a rule needs, and those documents. */
async function docsAndAcks(db: any, tenantId: string, docIds: string[], staffIds: string[]) {
  const docs: Record<string, any> = {}; const acks: Record<string, Record<string, any>> = {};
  await Promise.all(docIds.map(async (id) => {
    const s = await db.doc(`${T(tenantId)}/documents/${id}`).get(); if (s.exists) docs[id] = { id, ...(s.data() || {}) };
    await Promise.all(staffIds.map(async (sid) => { const a = await db.doc(`${T(tenantId)}/documents/${id}/acks/${sid}`).get(); if (a.exists) (acks[sid] ||= {})[id] = a.data(); }));
  }));
  return { docs, acks };
}

/** Certifies a person for every service whose steps they've now finished. Lapsed or removed records wait for a manager. */
export async function evaluateStaff(db: any, tenantId: string, staffId: string) {
  const [tSnap, sSnap, svcSnap] = await Promise.all([db.doc(T(tenantId)).get(), db.doc(`${T(tenantId)}/staff/${staffId}`).get(), db.collection(`${T(tenantId)}/services`).get()]);
  const tenant: any = tSnap.data() || {}; const staff: any = sSnap.data() || {}; if (!sSnap.exists || staff.archived) return [];
  const today = todayFor(tenant); const now = new Date().toISOString(); const done: string[] = [];
  for (const sv of svcSnap.docs) {
    const svc: any = sv.data() || {}; const rule = certRuleOf(svc); if (!rule.required) continue;
    const ref = db.doc(`${T(tenantId)}/certifications/${certId(staffId, sv.id)}`); const rs = await ref.get(); const rec: any = rs.exists ? rs.data() : null;
    if (rec && (isCurrent(rec, today) || rec.status === 'lapsed' || rec.status === 'removed')) continue;
    const { docs, acks } = await docsAndAcks(db, tenantId, rule.docIds, [staffId]);
    if (!stepsDone(certSteps(rule, rec, acks[staffId] || {}, docs))) continue;
    await ref.set({ staffId, staffName: staff.name || 'Team member', serviceId: sv.id, serviceName: svc.name || 'Service', status: 'certified', certifiedAt: now, how: 'requirements', by: rec?.watchedBy || null,
      renewBy: renewByFor(rule, today), updatedAt: now }, { merge: true });
    const n = db.collection(`${T(tenantId)}/notifications`).doc();
    await n.set({ id: n.id, userId: staffId, type: 'certification', message: `You are now certified for ${svc.name || 'a service'}.${certModeOf(tenant) === 'block' ? ' Clients can now book this service with you.' : ''}`, link: 'documents', createdAt: now, read: false });
    await syncService(db, tenantId, sv.id, tenant); done.push(sv.id);
  }
  return done;
}

/** Daily: certifications past their renew-by date lapse (and come off the service in block mode). */
export async function certificationSweep(db: any, tenantId: string, tenant: any) {
  const today = todayFor(tenant);
  const snap = await db.collection(`${T(tenantId)}/certifications`).where('status', '==', 'certified').get();
  const lapsed = snap.docs.filter((d: any) => { const r = d.data() || {}; return r.renewBy && r.renewBy < today; });
  if (!lapsed.length) return 0;
  const now = new Date().toISOString(); const services = new Set<string>();
  for (const d of lapsed) { const r: CertRecord = d.data(); await d.ref.set({ status: 'lapsed', lapsedAt: now, watchedAt: null, watchedBy: null, watchedNote: null, updatedAt: now }, { merge: true }); services.add(r.serviceId);
    const n = db.collection(`${T(tenantId)}/notifications`).doc();
    await n.set({ id: n.id, userId: r.staffId, type: 'certification', message: `Action needed: your certification for ${r.serviceName || 'a service'} is due for renewal. Please speak with a manager.`, link: 'documents', createdAt: now, read: false }); }
  for (const s of services) await syncService(db, tenantId, s, tenant);
  return lapsed.length;
}

/** Everything the Certification screens show: services that need it (or did), records, and each person's steps. */
export async function certificationData(db: any, tenantId: string, onlyStaffId?: string | null) {
  const [tSnap, svcSnap, staffSnap, recSnap] = await Promise.all([db.doc(T(tenantId)).get(), db.collection(`${T(tenantId)}/services`).get(), db.collection(`${T(tenantId)}/staff`).get(),
    onlyStaffId ? db.collection(`${T(tenantId)}/certifications`).where('staffId', '==', onlyStaffId).get() : db.collection(`${T(tenantId)}/certifications`).get()]);
  const tenant: any = tSnap.data() || {}; const today = todayFor(tenant);
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => !s.archived && (!onlyStaffId || s.id === onlyStaffId))
    .map((s: any) => ({ id: s.id, name: String(s.name || 'Team member'), role: String(s.role || 'staff'), isRenter: s.role === 'renter' || s.isRenter === true }));
  const recs = recSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const services = svcSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true && s.status !== 'archived')
    .map((s: any) => ({ id: s.id, name: String(s.name || 'Service'), rule: certRuleOf(s), managed: !!s.certManaged, certStaffIds: Array.isArray(s.certStaffIds) ? s.certStaffIds : [] }))
    .sort((a: any, b: any) => Number(b.rule.required) - Number(a.rule.required) || a.name.localeCompare(b.name));
  const needed = services.filter((s: any) => s.rule.required);
  const allDocIds = [...new Set(needed.flatMap((s: any) => s.rule.docIds))] as string[];
  const people = staff.filter((s: any) => !s.isRenter);
  const { docs, acks } = await docsAndAcks(db, tenantId, allDocIds, people.map((p: any) => p.id));
  const progress: Record<string, any[]> = {};
  for (const s of needed) for (const p of people) { const rec = recs.find((r: any) => r.serviceId === s.id && r.staffId === p.id) || null; if (isCurrent(rec, today)) continue;
    progress[certId(p.id, s.id)] = certSteps(s.rule, rec, acks[p.id] || {}, docs); }
  const docList = Object.values(docs).map((d: any) => ({ id: d.id, title: d.title, version: d.version, status: d.status }));
  return { mode: certModeOf(tenant), today, services, staff: people, recs, progress, docs: docList };
}
