// /api/import — BRING YOUR RECORDS FROM ANOTHER APP (lib/import-records). Managers only. The page reads the file and
// cleans each row; this checks them against what's already here and saves.
//   { action: 'check',  tenantId, kind, rows }           → how many are new, how many match someone already here
//   { action: 'save',   tenantId, kind, rows, importId, app, keepMarketing } → saves a chunk (≤ 400 rows); call again per chunk
//   { action: 'undo',   tenantId, importId }             → removes what that import added (records no one has changed
//                                                           since), and takes back what it filled in on existing ones
//   { action: 'list',   tenantId }                       → recent imports
// Matching: a client by email, then mobile; a product by SKU, then name; a service by name. A match is filled in, never
// overwritten. A renter's own clients are never matched or touched.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { sameKeys, fillIn, type ImportKind } from '@/lib/import-records';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const KINDS: ImportKind[] = ['clients', 'services', 'products'];
const COL: Record<ImportKind, string> = { clients: 'clients', services: 'services', products: 'inventory' };
const now = () => new Date().toISOString();

async function existingIndex(db: any, tenantId: string, kind: ImportKind) {
  const snap = await db.collection(`tenants/${tenantId}/${COL[kind]}`).get(); const byKey = new Map<string, any>();
  for (const d of snap.docs) { const x = { id: d.id, ...(d.data() || {}) }; if (kind === 'clients' && (x as any).ownerRenterId) continue; if ((x as any).status === 'archived' && kind !== 'clients') continue;
    for (const k of sameKeys(kind, x)) if (!byKey.has(k)) byKey.set(k, x); }
  return byKey;
}

/** What we store for a new record of each kind. */
function newDoc(kind: ImportKind, id: string, d: any, meta: { importId: string; app: string; keepMarketing: boolean }) {
  const base = { id, importId: meta.importId, importedFrom: meta.app || null, importedAt: now(), createdVia: 'import' };
  if (kind === 'clients') {
    const o: any = { ...base, name: d.name, email: d.email || null, phone: d.phone || null, status: 'active', lifetimeValue: Number(d.spent) || 0, lastAppointment: d.lastVisit || null, createdAt: d.clientSince ? `${d.clientSince}T12:00:00.000Z` : now() };
    for (const k of ['firstName', 'lastName', 'birthday', 'address', 'notes', 'allergyNotes', 'tags', 'referral']) if (d[k] != null) o[k] = d[k];
    if (d.visits != null) o.importedVisits = d.visits;
    if (meta.keepMarketing) {
      if (d.emailOk === false) o.marketingOptIn = false; if (d.emailOk === true) { o.marketingOptIn = true; o.marketingOptInSource = `Imported from ${meta.app || 'another app'}`; o.marketingOptInAt = now(); }
      if (d.smsOk === false) o.smsMarketingOptIn = false; if (d.smsOk === true) { o.smsMarketingOptIn = true; o.smsMarketingOptInSource = `Imported from ${meta.app || 'another app'}`; o.smsMarketingOptInAt = now(); }
    }
    return o;
  }
  if (kind === 'services') {
    const price = Number(d.price) || 0;
    return { ...base, name: d.name, type: 'service', category: d.category || 'Imported', duration: Number(d.duration) || 60, price, cost: 0, profit: price, margin: price ? 100 : 0, description: d.description || '', status: 'active', isPrivate: true, createdAt: now() };
  }
  return { ...base, name: d.name, description: d.description || '', type: 'retail', category: d.category || 'Imported', status: 'active', totalStock: Number(d.stock) || 0, supplier: d.supplier || '', costPerUnit: d.cost ?? undefined, price: d.price ?? undefined, msrp: d.price ?? undefined, sku: d.sku || undefined, batches: [], createdAt: now() };
}
/** What a match gets filled in with (only its empty fields). */
function fillPatch(kind: ImportKind, cur: any, d: any) {
  const add: any = kind === 'clients' ? { email: d.email, phone: d.phone, firstName: d.firstName, lastName: d.lastName, birthday: d.birthday, address: d.address, notes: d.notes, allergyNotes: d.allergyNotes, tags: d.tags, referral: d.referral }
    : kind === 'services' ? { category: d.category, description: d.description }
    : { sku: d.sku, description: d.description, supplier: d.supplier, costPerUnit: d.cost, price: d.price };
  const merged = fillIn(cur, add); const patch: any = {};
  for (const k of Object.keys(add)) if (JSON.stringify(merged[k]) !== JSON.stringify(cur[k]) && merged[k] !== undefined) patch[k] = merged[k];
  return patch;
}
const clean = (o: any) => JSON.parse(JSON.stringify(o));

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '');
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  if (b.action === 'list') {
    const s = await db.collection(`${T}/imports`).orderBy('startedAt', 'desc').limit(10).get();
    return NextResponse.json({ ok: true, imports: s.docs.map((d: any) => { const x = d.data() || {}; return { id: d.id, kind: x.kind, app: x.app, startedAt: x.startedAt, by: x.by, added: x.added || 0, filled: x.filled || 0, undoneAt: x.undoneAt || null }; }) });
  }
  if (b.action === 'undo') {
    const ref = db.doc(`${T}/imports/${String(b.importId || '')}`); const imp: any = (await ref.get()).data();
    if (!imp) return NextResponse.json({ ok: false, error: 'That import wasn’t found.' }, { status: 404 });
    if (imp.undoneAt) return NextResponse.json({ ok: true, removed: 0, kept: 0 });
    const kind = imp.kind as ImportKind; const col = `${T}/${COL[kind]}`;
    const added = await db.collection(col).where('importId', '==', imp.id).get(); let removed = 0, kept = 0;
    let batch = db.batch(); let n = 0;
    for (const d of added.docs) {
      const x: any = d.data() || {};
      // Kept: anything used since (a visit booked, a sale, an edit) — removing it would lose real work.
      const since = imp.finishedAt || imp.startedAt; const edited = !!x.updatedAt && x.updatedAt > since;
      const touched = kind === 'clients' ? edited || Number(x.lifetimeValue || 0) !== Number(x.importedSpent || 0) || (x.lastAppointment || null) !== (x.importedLastVisit || null) : edited;
      if (touched) { kept++; continue; }
      batch.delete(d.ref); removed++; if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    // Filled-in fields on existing records go back to empty — only where they still hold what the import put there.
    const fills = await db.collection(`${T}/imports/${imp.id}/fills`).get();
    for (const f of fills.docs) { const x: any = f.data() || {}; const cur: any = (await db.doc(`${col}/${x.docId}`).get()).data(); if (!cur) continue;
      const back: any = {}; for (const [k, v] of Object.entries(x.patch || {})) if (JSON.stringify(cur[k]) === JSON.stringify(v)) back[k] = x.before?.[k] ?? null;
      if (Object.keys(back).length) { batch.set(db.doc(`${col}/${x.docId}`), back, { merge: true }); if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; } } }
    if (n) await batch.commit();
    await ref.set({ undoneAt: now(), undoneBy: g.actor?.name || null, removed, kept }, { merge: true });
    return NextResponse.json({ ok: true, removed, kept });
  }
  const kind = String(b.kind) as ImportKind; if (!KINDS.includes(kind)) return NextResponse.json({ ok: false, error: 'Choose what you’re bringing in.' }, { status: 400 });
  const rows: any[] = (Array.isArray(b.rows) ? b.rows : []).slice(0, 400).filter((r: any) => r && typeof r === 'object' && r.name);
  const idx = await existingIndex(db, tenantId, kind);
  const match = (d: any) => sameKeys(kind, d).map((k) => idx.get(k)).find(Boolean) || null;
  if (b.action === 'check') {
    let fresh = 0, matched = 0, fills = 0; const samples: any[] = [];
    for (const d of rows) { const m = match(d); if (!m) { fresh++; continue; } matched++; const p = fillPatch(kind, m, d); if (Object.keys(p).length) { fills++; if (samples.length < 5) samples.push({ name: m.name, adds: Object.keys(p) }); } }
    return NextResponse.json({ ok: true, fresh, matched, fills, samples, existing: idx.size });
  }
  if (b.action === 'save') {
    const importId = String(b.importId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40); if (!importId) return NextResponse.json({ ok: false, error: 'Missing the import.' }, { status: 400 });
    const iRef = db.doc(`${T}/imports/${importId}`); const imp: any = (await iRef.get()).data();
    if (imp && imp.kind !== kind) return NextResponse.json({ ok: false, error: 'That import is for something else.' }, { status: 400 });
    if (!imp) await iRef.set({ id: importId, kind, app: String(b.app || '').slice(0, 40) || null, startedAt: now(), by: g.actor?.name || null, byId: g.actor?.staffId || null, added: 0, filled: 0, skipped: 0 });
    const meta = { importId, app: String(b.appName || b.app || '').slice(0, 40), keepMarketing: b.keepMarketing !== false };
    let batch = db.batch(); let n = 0; let added = 0, filled = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
    for (const d of rows) {
      const m = match(d);
      if (!m) { const ref = db.collection(`${T}/${COL[kind]}`).doc(); const doc = clean(newDoc(kind, ref.id, d, meta)); if (kind === 'clients') { doc.importedSpent = doc.lifetimeValue; doc.importedLastVisit = doc.lastAppointment; } batch.set(ref, doc); added++; for (const k of sameKeys(kind, doc)) idx.set(k, doc); }
      else { const p = clean(fillPatch(kind, m, d)); if (!Object.keys(p).length) continue; const before: any = {}; for (const k of Object.keys(p)) before[k] = m[k] ?? null;
        batch.set(db.doc(`${T}/${COL[kind]}/${m.id}`), p, { merge: true }); batch.set(db.collection(`${T}/imports/${importId}/fills`).doc(), clean({ docId: m.id, patch: p, before })); n++; filled++; Object.assign(m, p); }
      if (++n >= 380) await flush();
    }
    await flush();
    const { FieldValue } = await import('firebase-admin/firestore');
    await iRef.set({ added: FieldValue.increment(added), filled: FieldValue.increment(filled), skipped: FieldValue.increment(Math.max(0, Number(b.skipped) || 0)), finishedAt: now() }, { merge: true });
    return NextResponse.json({ ok: true, added, filled });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
