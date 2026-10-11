// src/lib/training-proof.ts — PROOF OF TRAINING (server). Two read-only views made from the documents, sign-offs and the
// sterilization log, both opened by a signed link (no sign-in) so they can be printed or shown to an inspector:
//   Proof of training — one document: who it's for, who signed which version and when, their quick-check score and
//     signature, the version history, and this month's checklist runs. Link valid for a day (proofPath).
//   Inspector view — the business's current procedures in the collections the owner picked, how many are trained on
//     each, and the sterilization log for the month. Each link is a record (inspectorLinks/{id}) with an expiry the owner
//     chooses; it can be turned off early, and every time it's opened is noted.
import { createHmac, randomBytes } from 'crypto';
import { collectionsOf, collectionFor, assignedPeople } from '@/lib/doc-collections';
import { tenantTimeZone, dayKey } from '@/lib/tenant-time';

const secret = () => process.env.LINK_SECRET || process.env.GIFT_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'proof';
const sign = (s: string) => createHmac('sha256', secret()).update(s).digest('base64url').slice(0, 22);
const T = (t: string) => `tenants/${t}`;

export function proofPath(tenantId: string, documentId: string, hours = 24) {
  const e = Date.now() + hours * 3600e3;
  return `/print/training/${encodeURIComponent(tenantId)}/${encodeURIComponent(documentId)}?e=${e}&k=${sign(`proof:${tenantId}/${documentId}/${e}`)}`;
}
export function proofOk(tenantId: string, documentId: string, e: string, k: string) {
  const n = Number(e); return Number.isFinite(n) && n > Date.now() && k === sign(`proof:${tenantId}/${documentId}/${n}`);
}
export const inspectorPath = (tenantId: string, id: string) => `/inspect/${encodeURIComponent(tenantId)}/${encodeURIComponent(id)}?k=${sign(`inspect:${tenantId}/${id}`)}`;
export const inspectorKeyOk = (tenantId: string, id: string, k: string) => k === sign(`inspect:${tenantId}/${id}`);

export async function createInspectorLink(db: any, tenantId: string, o: { hours: number; collections: string[]; by: string; note?: string }) {
  const id = randomBytes(9).toString('base64url'); const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1, Math.min(24 * 14, o.hours)) * 3600e3).toISOString();
  const rec = { id, createdAt: now.toISOString(), createdBy: o.by, expiresAt, collections: (o.collections || []).slice(0, 20), note: String(o.note || '').slice(0, 140) || null, revokedAt: null, views: [] };
  await db.doc(`${T(tenantId)}/inspectorLinks/${id}`).set(rec);
  return { ...rec, path: inspectorPath(tenantId, id) };
}

async function base(db: any, tenantId: string) {
  const [tSnap, staffSnap] = await Promise.all([db.doc(T(tenantId)).get(), db.collection(`${T(tenantId)}/staff`).get()]);
  const tenant: any = tSnap.data() || {};
  const staff = staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true && s.role !== 'renter' && !s.isRenter);
  const business = { name: String(tenant.name || tenant.businessName || 'The business'), address: [tenant.address?.street || tenant.address || '', tenant.address?.city || ''].filter((x: any) => typeof x === 'string' && x).join(', ') || null,
    license: tenant.licenseNumber || tenant.establishmentLicense || null, logo: tenant.kioskSettings?.logoUrl || tenant.logoUrl || null, tz: tenantTimeZone(tenant) };
  return { tenant, staff, business };
}
const ackList = async (db: any, tenantId: string, docId: string) => (await db.collection(`${T(tenantId)}/documents/${docId}/acks`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));

/** Everything the proof-of-training page shows for one document. */
export async function proofData(db: any, tenantId: string, documentId: string) {
  const [{ tenant, staff, business }, dSnap] = await Promise.all([base(db, tenantId), db.doc(`${T(tenantId)}/documents/${documentId}`).get()]);
  const d: any = dSnap.exists ? { id: dSnap.id, ...dSnap.data() } : null; if (!d || d.status !== 'published') return null;
  const v = Number(d.version || 1); const acks = await ackList(db, tenantId, d.id); const people = assignedPeople(d, staff);
  const roster = people.map((p: any) => { const a = acks.find((x: any) => x.id === p.id) || null; return { name: String(p.name || 'Team member'), role: String(p.role || ''), ack: a, current: !!a && Number(a.version) === v }; })
    .sort((a: any, b: any) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  const month = dayKey(new Date(), business.tz).slice(0, 7);
  let runs: any[] = []; if ((d.sections || []).some((s: any) => s.type === 'checklist')) runs = (await db.collection(`${T(tenantId)}/documents/${d.id}/runs`).get()).docs.map((x: any) => x.data() || {}).filter((r: any) => String(r.date || '').startsWith(month));
  const col = collectionFor(d, collectionsOf(tenant));
  return { business, d, v, col, roster, signed: roster.filter((r: any) => r.current).length, total: roster.length,
    runs: { count: runs.length, complete: runs.filter((r) => r.completedAt).length, photos: runs.reduce((n, r) => n + Object.keys(r.photos || {}).length, 0), days: [...new Set(runs.map((r) => r.date))].length }, month };
}

/** Everything the inspector page shows: the documents in the chosen collections and this month's sterilization log. */
export async function inspectorData(db: any, tenantId: string, link: any) {
  const { tenant, staff, business } = await base(db, tenantId);
  const cols = collectionsOf(tenant); const want = new Set(link.collections?.length ? link.collections : cols.map((c) => c.id));
  const docs = (await db.collection(`${T(tenantId)}/documents`).where('status', '==', 'published').get()).docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) }))
    .filter((d: any) => want.has(collectionFor(d, cols).id) && d.category !== 'handbook');
  const rows = await Promise.all(docs.map(async (d: any) => { const acks = await ackList(db, tenantId, d.id); const people = assignedPeople(d, staff); const v = Number(d.version || 1);
    return { id: d.id, title: String(d.title || 'Document'), version: v, publishedAt: d.publishedAt || d.updatedAt || null, collection: collectionFor(d, cols).name,
      trained: people.filter((p: any) => acks.some((a: any) => a.id === p.id && Number(a.version) === v)).length, total: people.length }; }));
  const today = dayKey(new Date(), business.tz); const month = today.slice(0, 7);
  const cycles = (await db.collection(`${T(tenantId)}/sterilisationCycles`).where('startedAt', '>=', `${month}-01`).get().catch(() => ({ docs: [] }))).docs.map((x: any) => x.data() || {});
  const byDay: Record<string, { passed: number; failed: number; spore: boolean }> = {};
  for (const c of cycles) { const k = dayKey(new Date(c.startedAt), business.tz); if (!k.startsWith(month)) continue; const e = byDay[k] || { passed: 0, failed: 0, spore: false };
    if (c.type === 'spore') e.spore = true; else if (c.status === 'passed') e.passed++; else if (c.status === 'failed') e.failed++; byDay[k] = e; }
  return { business, rows: rows.sort((a, b) => a.collection.localeCompare(b.collection) || a.title.localeCompare(b.title)), month, today, byDay,
    cycleCount: cycles.filter((c: any) => c.type !== 'spore').length, collections: cols.filter((c) => want.has(c.id)).map((c) => c.name) };
}
