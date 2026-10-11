// /api/import — BRING YOUR RECORDS FROM ANOTHER APP (lib/import-records). Managers only. The page reads the file and
// cleans each row; this checks them against what's already here and saves.
//   { action: 'check',  tenantId, kind, rows }           → how many are new, how many match someone already here
//   { action: 'save',   tenantId, kind, rows, importId, app, keepMarketing } → saves a chunk (≤ 400 rows); call again per chunk
//   { action: 'undo',   tenantId, importId }             → removes what that import added (records no one has changed
//                                                           since), and takes back what it filled in on existing ones
//   { action: 'list',   tenantId }                       → recent imports
//   { action: 'questions', kind: 'appointments', rows }   → staff and service names to match (lib/import-more)
// Appointments, gift card balances, packages, memberships, client balances, formula notes and discount codes are saved by lib/import-more.
// Matching: a client by email, then mobile; a product by SKU, then name; a service by name. A match is filled in, never
// overwritten. A renter's own clients are never matched or touched.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { sameKeys, fillIn, type ImportKind } from '@/lib/import-records';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const KINDS: ImportKind[] = ['clients', 'services', 'products', 'appointments', 'giftcards', 'packages', 'memberships', 'balances', 'formulas', 'discounts', 'sales', 'files'];
const COL: Record<ImportKind, string> = { clients: 'clients', services: 'services', products: 'inventory', appointments: 'appointments', giftcards: 'giftCards', packages: 'clients', memberships: 'clients', balances: 'depositCredits', formulas: 'clients', discounts: 'discounts', sales: 'salesHistory', files: 'clients' };
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
  if (b.action === 'status') {   // the Moving in checklist
    const [imps, t, st, sv] = await Promise.all([db.collection(`${T}/imports`).get(), db.doc(T).get(), db.collection(`${T}/staff`).get(), db.collection(`${T}/services`).where('createdVia', '==', 'import').get()]);
    const moved: Record<string, number> = {}; let owed = 0;
    for (const d of imps.docs) { const x: any = d.data() || {}; if (x.undoneAt) continue; moved[x.kind] = (moved[x.kind] || 0) + (Number(x.added) || 0) + (Number(x.filled) || 0); owed += Number(x.owedCents) || 0; }
    const td: any = t.data() || {};
    return NextResponse.json({ ok: true, moving: td.movingIn || {}, moved, owedCents: owed, imports: imps.size,
      servicesHidden: sv.docs.filter((d: any) => (d.data() as any)?.isPrivate === true && (d.data() as any)?.status !== 'archived').length, servicesImported: sv.size,
      team: st.docs.filter((d: any) => (d.data() as any)?.archived !== true && (d.data() as any)?.role !== 'renter').length,
      bookingPath: `/book/${encodeURIComponent(tenantId)}` });
  }
  if (b.action === 'clients-lite') {   // photos and files: who's who, to match file names to clients (lib/import-files)
    const s = await db.collection(`${T}/clients`).get();
    return NextResponse.json({ ok: true, clients: s.docs.map((d: any) => { const x: any = d.data() || {}; return x.ownerRenterId || x.status === 'archived' ? null : { id: d.id, name: x.name || '', email: x.email || null }; }).filter(Boolean) });
  }
  if (b.action === 'files-save') {   // photos and files uploaded from the page: recorded on each client (undoable)
    const importId = String(b.importId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40); if (!importId) return NextResponse.json({ ok: false, error: 'Missing the import.' }, { status: 400 });
    const iRef = db.doc(`${T}/imports/${importId}`); const imp: any = (await iRef.get()).data(); if (imp && imp.kind !== 'files') return NextResponse.json({ ok: false, error: 'That import is for something else.' }, { status: 400 });
    if (!imp) await iRef.set({ id: importId, kind: 'files', app: String(b.app || '').slice(0, 40) || null, startedAt: now(), by: g.actor?.name || null, byId: g.actor?.staffId || null, added: 0, filled: 0, skipped: 0 });
    const prefix = `tenants/${tenantId}/client-files/`; const items = (Array.isArray(b.files) ? b.files : []).slice(0, 100)
      .filter((x: any) => x && typeof x.clientId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x.clientId) && typeof x.url === 'string' && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(x.url) && decodeURIComponent(x.url).includes(prefix));
    const byClient = new Map<string, any[]>(); for (const x of items) byClient.set(x.clientId, [...(byClient.get(x.clientId) || []), x]); let added = 0;
    for (const [cid, list] of byClient) { const ref = db.doc(`${T}/clients/${cid}`); const cur: any = (await ref.get()).data(); if (!cur || cur.ownerRenterId) continue;
      const had: any[] = Array.isArray(cur.importedFiles) ? cur.importedFiles : [];
      const fresh = list.filter((x: any) => !had.some((h: any) => h.url === x.url)).map((x: any) => ({ url: x.url, name: String(x.name || 'File').slice(0, 160), kind: x.kind === 'photo' ? 'photo' : 'file', size: Number(x.size) || null, takenAt: x.takenAt || null, importId, importedFrom: String(b.appName || '').slice(0, 40) || null, at: now() }));
      if (!fresh.length) continue; const next = [...had, ...fresh].slice(-400);
      await ref.set({ importedFiles: next }, { merge: true }); await db.collection(`${T}/imports/${importId}/fills`).doc().set(clean({ docId: cid, patch: { importedFiles: next }, before: { importedFiles: had } })); added += fresh.length; }
    const { FieldValue } = await import('firebase-admin/firestore');
    await iRef.set({ added: FieldValue.increment(added), finishedAt: now() }, { merge: true });
    return NextResponse.json({ ok: true, added });
  }
  if (b.action === 'sales-history') {   // Reports: the same months a year earlier, from an old app's sales totals (lib/import-more saveSales)
    const from = String(b.from || '').slice(0, 7), to = String(b.to || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return NextResponse.json({ ok: false, error: 'Missing the dates.' }, { status: 400 });
    const back = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`; const lo = back(from), hi = back(to);
    const s = await db.collection(`${T}/salesHistory`).get(); const months: Record<string, number> = {}; let any = false;
    for (const d of s.docs) { const x: any = d.data() || {}; any = true; if (x.month >= lo && x.month <= hi) months[x.month] = (months[x.month] || 0) + (Number(x.total) || 0); }
    return NextResponse.json({ ok: true, any, months, total: Object.values(months).reduce((t, v) => t + v, 0), from: lo, to: hi });
  }
  if (b.action === 'moving') {   // where they're coming from, switch-over day and its list, or "I'm starting fresh"
    const patch: any = {}; const m = b.moving || {};
    if (typeof m.app === 'string') patch['movingIn.app'] = m.app.slice(0, 40);
    if (typeof m.switchDate === 'string') patch['movingIn.switchDate'] = /^\d{4}-\d{2}-\d{2}$/.test(m.switchDate) ? m.switchDate : null;
    if (typeof m.dismissed === 'boolean') patch['movingIn.dismissed'] = m.dismissed;
    if (m.switch && typeof m.switch === 'object') for (const [k, v] of Object.entries(m.switch)) if (/^[a-z]{2,20}$/.test(k)) patch[`movingIn.switch.${k}`] = !!v;
    if (Array.isArray(m.showServices)) { const ids = m.showServices.map(String).slice(0, 500); for (let i = 0; i < ids.length; i += 400) { const bt = db.batch(); for (const id of ids.slice(i, i + 400)) bt.set(db.doc(`${T}/services/${id}`), { isPrivate: false }, { merge: true }); await bt.commit(); } }
    if (Object.keys(patch).length) await db.doc(T).update(patch);
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'undo') {
    const ref = db.doc(`${T}/imports/${String(b.importId || '')}`); const imp: any = (await ref.get()).data();
    if (!imp) return NextResponse.json({ ok: false, error: 'That import wasn’t found.' }, { status: 404 });
    if (imp.undoneAt) return NextResponse.json({ ok: true, removed: 0, kept: 0 });
    const kind = imp.kind as ImportKind; const col = `${T}/${COL[kind]}`;
    const addedMain = await db.collection(col).where('importId', '==', imp.id).get();
    const addedClients = ['appointments', 'giftcards', 'balances'].includes(kind) ? (await db.collection(`${T}/clients`).where('importId', '==', imp.id).get()).docs : [];
    const addedPkgs = kind === 'packages' ? (await db.collection(`${T}/packages`).where('importId', '==', imp.id).get()).docs : kind === 'memberships' ? (await db.collection(`${T}/memberships`).where('importId', '==', imp.id).get()).docs : [];
    const added = { docs: [...addedMain.docs, ...addedClients, ...addedPkgs] }; let removed = 0, kept = 0;
    let batch = db.batch(); let n = 0; const gone = new Set<string>();
    for (const d of added.docs) {
      const x: any = d.data() || {};
      // Kept: anything used since (a visit booked, a sale, an edit) — removing it would lose real work.
      const since = imp.finishedAt || imp.startedAt; const edited = !!x.updatedAt && x.updatedAt > since;
      const isClient = d.ref.path.includes('/clients/'); const isAppt = d.ref.path.includes('/appointments/');
      const gcUsed = (d.ref.path.includes('/giftCards/') && (x.history || []).some((h: any) => h.type === 'spend')) || (d.ref.path.includes('/depositCredits/') && (Number(x.usedCents) > 0 || x.status !== 'available')) || (d.ref.path.includes('/discounts/') && Number(x.usageCount) > Number(x.importedUsed ?? x.usageCount));
      const apptTouched = isAppt && ((x.updatedAt && x.updatedAt > since) || !!x.checkoutSessionId || (x.reminderSentAt && x.reminderSentBy !== 'import'));
      const touched = gcUsed || apptTouched ? true : isClient ? edited || Number(x.lifetimeValue || 0) !== Number(x.importedSpent || 0) || (x.lastAppointment || null) !== (x.importedLastVisit || null) : edited;
      if (touched) { kept++; continue; }
      batch.delete(d.ref); gone.add(d.id); removed++; if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    // Filled-in fields on existing records go back to empty — only where they still hold what the import put there.
    const fills = await db.collection(`${T}/imports/${imp.id}/fills`).get();
    for (const f of fills.docs) { const x: any = f.data() || {}; if (gone.has(x.docId)) continue; const fcol = x.col ? `${T}/${x.col}` : col; const cur: any = (await db.doc(`${fcol}/${x.docId}`).get()).data(); if (!cur) continue;
      const back: any = {}; for (const [k, v] of Object.entries(x.patch || {})) if (JSON.stringify(cur[k]) === JSON.stringify(v)) back[k] = x.before?.[k] ?? null;
      if (Object.keys(back).length) { batch.set(db.doc(`${fcol}/${x.docId}`), back, { merge: true }); if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; } } }
    if (n) await batch.commit();
    await ref.set({ undoneAt: now(), undoneBy: g.actor?.name || null, removed, kept }, { merge: true });
    return NextResponse.json({ ok: true, removed, kept });
  }
  const kind = String(b.kind) as ImportKind; if (!KINDS.includes(kind)) return NextResponse.json({ ok: false, error: 'Choose what you’re bringing in.' }, { status: 400 });
  const rows: any[] = (Array.isArray(b.rows) ? b.rows : []).slice(0, 400).filter((r: any) => r && typeof r === 'object' && r.name);
  if (['appointments', 'giftcards', 'packages', 'memberships', 'balances', 'formulas', 'discounts', 'sales'].includes(kind)) {
    const more = await import('@/lib/import-more');
    if (b.action === 'questions' && kind === 'appointments') return NextResponse.json({ ok: true, ...(await more.appointmentQuestions(db, tenantId, rows)) });
    if (b.action === 'check') {
      if (kind === 'giftcards') { const { findByCode } = await import('@/lib/gift-cards'); let fresh = 0, matched = 0, owed = 0; for (const r of rows) { if (await findByCode(db, tenantId, r.code)) matched++; else { fresh++; if (!r.voided) owed += Math.round(Number(r.balance) * 100); } } return NextResponse.json({ ok: true, fresh, matched, fills: 0, samples: [], owedCents: owed }); }
      if (kind === 'discounts') { const have = new Set((await db.collection(`${T}/discounts`).get()).docs.map((d: any) => String((d.data() as any)?.code || '').toUpperCase())); let matched = 0; for (const r of rows) if (have.has(r.code)) matched++; return NextResponse.json({ ok: true, fresh: rows.length - matched, matched, fills: 0, samples: [] }); }
      if (kind === 'sales') { const here = await more.salesMonthsHere(db, tenantId); const months = new Set(rows.map((r) => r.month)); const total = rows.reduce((t, r) => t + (Number(r.total) || 0), 0);
        return NextResponse.json({ ok: true, fresh: rows.length, matched: 0, fills: 0, samples: [], months: [...months].sort(), overlap: [...months].filter((m) => here.has(m)).sort(), totalCents: Math.round(total * 100) }); }
      if (kind === 'balances') { const idx3 = await more.clientIndex(db, tenantId); let known = 0, credit = 0, owed = 0; for (const r of rows) { if (idx3.find(r)) known++; credit += Math.round(Number(r.credit || 0) * 100); owed += Math.round(Number(r.owed || 0) * 100); }
        return NextResponse.json({ ok: true, fresh: rows.length, matched: 0, fills: 0, samples: [], knownClients: known, newClients: rows.length - known, creditCents: credit, owedCents: owed }); }
      const idx2 = await more.clientIndex(db, tenantId); let known = 0; for (const r of rows) if (idx2.find(r)) known++;
      return NextResponse.json({ ok: true, fresh: rows.length, matched: 0, fills: 0, samples: [], knownClients: known, newClients: rows.length - known });
    }
    if (b.action === 'save') {
      const importId = String(b.importId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40); if (!importId) return NextResponse.json({ ok: false, error: 'Missing the import.' }, { status: 400 });
      const iRef = db.doc(`${T}/imports/${importId}`); const imp: any = (await iRef.get()).data();
      if (imp && imp.kind !== kind) return NextResponse.json({ ok: false, error: 'That import is for something else.' }, { status: 400 });
      if (!imp) await iRef.set({ id: importId, kind, app: String(b.app || '').slice(0, 40) || null, startedAt: now(), by: g.actor?.name || null, byId: g.actor?.staffId || null, added: 0, filled: 0, skipped: 0 });
      const app = String(b.appName || b.app || '').slice(0, 40); let out: any;
      if (kind === 'appointments') { const t: any = (await db.doc(T).get()).data() || {}; const staffMap = b.staffMap || {}, serviceMap = b.serviceMap || {};
        if (!imp) await more.rememberMaps(db, tenantId, staffMap, serviceMap);
        out = await more.saveAppointments(db, tenantId, t, rows, { importId, app, staffMap, serviceMap, reminders: b.reminders === true }); }
      else if (kind === 'giftcards') out = await more.saveGiftCards(db, tenantId, rows, { importId, app, by: g.actor?.name || 'Import' });
      else if (kind === 'discounts') out = await more.saveDiscounts(db, tenantId, rows, { importId, app });
      else if (kind === 'sales') out = await more.saveSales(db, tenantId, rows, { importId, app });
      else { out = kind === 'memberships' ? await more.saveMemberships(db, tenantId, rows, { importId, app }) : kind === 'balances' ? await more.saveBalances(db, tenantId, rows, { importId, app })
          : kind === 'formulas' ? await more.saveFormulas(db, tenantId, rows, { importId, app }) : await more.savePackages(db, tenantId, rows, { importId, app, packageMap: b.packageMap || {} });
        for (const f of out.fills) await db.collection(`${T}/imports/${importId}/fills`).doc().set(clean(f)); delete out.fills; }
      const { FieldValue } = await import('firebase-admin/firestore');
      await iRef.set({ added: FieldValue.increment(out.added || 0), skipped: FieldValue.increment((out.skipped || 0) + Math.max(0, Number(b.skipped) || 0)), clientsAdded: FieldValue.increment(out.clientsAdded || 0), ...(out.owedCents && kind === 'giftcards' ? { owedCents: FieldValue.increment(out.owedCents) } : {}), ...(kind === 'balances' ? { creditCents: FieldValue.increment(out.creditCents || 0), balanceOwedCents: FieldValue.increment(out.owedCents || 0) } : {}), finishedAt: now() }, { merge: true });
      return NextResponse.json({ ok: true, filled: 0, ...out });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }
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
