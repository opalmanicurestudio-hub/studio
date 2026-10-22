// src/app/api/retail/close-day/route.ts — CLOSE THE DAY. Staff only.
// POST { tenantId, action: 'manifest' } gathers every USPS label bought through Shippo that isn't on a manifest yet
// (stage packed or shipped, label from the last 7 days), every box's, and asks Shippo for the USPS form (SCAN form): a
// single sheet the mail carrier scans instead of every box. Shippo's rules, followed here:
//   - every label on one form shares a carrier account and a ship date, so there's one form per account per day
//     (a label bought yesterday gets yesterday's form instead of sinking today's)
//   - a label Shippo turns away is dropped and the form is made without it (it's listed, and the carrier scans that box)
//   - forms are made in the background: this waits a little for each one, and the history action fetches any still
//     being made, so the sheet to print always turns up
//   - at most 500 labels per form
// Each order is stamped with its form so it is never put on two. Other carriers don't use these; they're counted.
// POST { tenantId, action: 'history' } lists the last 14 forms (and finishes any still being made).
// POST { tenantId, action: 'summary' } is the day so far (lib/ship-run daySummary): today's boxes, postage, insurance,
// signatures and carriers from the label records, and the postage coming back for labels nobody used that the morning
// check voided this past week. Closing the day returns it too.
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { daySummary } from '@/lib/ship-run';
import { dayKey, startOfDay, tenantTimeZone } from '@/lib/tenant-time';
import { shippoKeyFor } from '@/lib/retail-secrets';
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { labelInDoubt } from '@/lib/label-doubt';
import { liveSlots } from '@/lib/label-boxes';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-close-day';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const SHIPPO = 'https://api.goshippo.com';
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };
async function shippo(apiKey: string, path: string, payload?: any) {
  const res = await fetch(`${SHIPPO}${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined, signal: timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || (Array.isArray(data?.messages) ? data.messages.map((m: any) => m.text).join('; ') : '') || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

const isUsps = (c: string) => /usps/i.test(c);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim();
  const action = String(b.action || 'manifest');
  if (!tenantId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!mayShip(auth.actor)) return NextResponse.json({ error: SHIP_DENIED }, { status: 403 });

  const db = getAdminDb();
  const manifests = db.collection(`tenants/${tenantId}/shipManifests`);

  // A form that failed: its orders come off it, so the next Close the day can include them. Done before the failure is
  // recorded, and allowed to fail loudly: a form is only marked failed once its labels are free, so a form whose orders
  // couldn't be freed is looked at again (history) instead of keeping its labels off every form after it.
  const unstamp = async (m: any) => {
    const ids: string[] = (Array.isArray(m.orderIds) ? m.orderIds.map(String) : []).filter(Boolean);
    if (!ids.length) return;
    const refs = ids.map((id) => db.doc(`tenants/${tenantId}/retailOrders/${id}`));
    const snaps: any[] = await db.getAll(...refs);
    const batch = db.batch(); let n = 0;
    snaps.forEach((snap: any, i: number) => { if (snap.exists && snap.data()?.manifestId === m.id) { batch.set(refs[i], { manifestId: null, manifestedAt: null }, { merge: true }); n++; } });
    if (n) await batch.commit();
  };
  const failedNow = (status: unknown) => String(status || '').toUpperCase() === 'ERROR';

  if (action === 'history') {
    const snap = await manifests.orderBy('createdAt', 'desc').limit(14).get();
    const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    // A form marked failed before its labels were freed (by an earlier version of this): they're freed now.
    for (const m of rows.filter((x: any) => failedNow(x.status) && !x.freedAt).slice(0, 5)) {
      try { await unstamp(m); const at = new Date().toISOString(); await manifests.doc(m.id).set({ freedAt: at }, { merge: true }); m.freedAt = at; } catch { /* next look */ }
    }
    // Forms still being made: ask Shippo once more and keep what comes back.
    const waiting = rows.filter((m: any) => m.shippoManifestId && !(m.documents || []).length && !['ERROR', 'FAILED'].includes(String(m.status || '').toUpperCase()));
    if (waiting.length) {
      const tSnap = await db.collection('tenants').doc(tenantId).get();
      const key = await shippoKeyFor(db, tenantId, tSnap.exists ? tSnap.data() : {});
      for (const m of waiting.slice(0, 5)) {
        try {
          const got = await shippo(key, `/manifests/${encodeURIComponent(m.shippoManifestId)}`);
          const docs: string[] = Array.isArray(got.documents) ? got.documents.map(String) : [];
          const status = String(got.status || m.status || '');
          // Shippo couldn't make it: its labels are freed for the next form first, then it's marked failed.
          const freed = failedNow(status) ? (await unstamp(m), { freedAt: new Date().toISOString() }) : {};
          await manifests.doc(m.id).set({ status, documents: docs, ...freed }, { merge: true });
          m.status = status; m.documents = docs; Object.assign(m, freed);
        } catch { /* next look */ }
      }
    }
    return NextResponse.json({ manifests: rows });
  }

  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const rs = tenant.retailSettings || {};
  // The day so far, from the label records (nothing asked of Shippo).
  const summaryNow = async () => {
    try {
      const tz = tenantTimeZone(tenant);
      const labels = db.collection(`tenants/${tenantId}/shippingLabels`);
      const [today, voided] = await Promise.all([
        labels.where('boughtAt', '>=', startOfDay(dayKey(new Date(), tz), tz).toISOString()).limit(500).get(),
        labels.where('voidedAt', '>=', new Date(Date.now() - 7 * 86400e3).toISOString()).limit(200).get(),
      ]);
      return daySummary(today.docs.map((d: any) => d.data()), voided.docs.map((d: any) => d.data()), Date.now(), tz);
    } catch { return null; }
  };
  if (action === 'summary') return NextResponse.json({ ok: true, summary: await summaryNow() });
  const apiKey = await shippoKeyFor(db, tenantId, tenant);
  if (!apiKey) return NextResponse.json({ error: 'Shipping labels aren’t connected yet. Add your Shippo key in Setup.' }, { status: 400 });
  const from = rs.shipFrom || {};
  if (!from.street1 || !from.city || !from.state || !from.zip) return NextResponse.json({ error: 'Add your ship-from address in Setup first.' }, { status: 400 });

  const since = Date.now() - 7 * 86400000;
  // Every order packed in the last two weeks, a page at a time (no silent cap), then narrowed to labels not yet on a
  // manifest. Packing always comes before a label, so packedAt bounds the search without a composite index.
  const packedSince = new Date(Date.now() - 14 * 86400000).toISOString();
  const all: any[] = []; let cursor: any = null;
  for (let page = 0; page < 50; page++) {
    let q = db.collection(`tenants/${tenantId}/retailOrders`).where('packedAt', '>', packedSince).orderBy('packedAt', 'asc').limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get(); all.push(...snap.docs);
    if (snap.size < 400) break; cursor = snap.docs[snap.docs.length - 1];
  }
  const waitingForForm = all.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }))
    .filter((o: any) => ['packed', 'shipped'].includes(String(o.stage)))
    // A relabelled order (its old label voided) has a new label to put on a form; manifestId is cleared with a void.
    .filter((o: any) => o.shippoTransactionId && !o.manifestId)
    .filter((o: any) => { const at = Date.parse(o.shipmentProtection?.decidedAt || o.shippedAt || o.packedAt || ''); return !Number.isFinite(at) || at >= since; });
  // A label that may no longer work (lib/label-doubt) stays off the form until that's sorted on the order.
  const held = waitingForForm.filter(labelInDoubt).length;
  const candidates = waitingForForm.filter((o: any) => !labelInDoubt(o));
  const heldLine = held ? ` ${held} label${held === 1 ? ' was' : 's were'} left off because ${held === 1 ? 'it isn’t' : 'they aren’t'} ready to go (a void that didn’t finish, or a box waiting for its new label); sort ${held === 1 ? 'that' : 'those'} out on the order before ${held === 1 ? 'it goes' : 'they go'} anywhere.` : '';
  const usps = candidates.filter((o: any) => isUsps(String(o.carrier || '')));
  const others = candidates.length - usps.length;
  if (usps.length === 0) return NextResponse.json({ ok: true, manifests: [], count: 0, others, held, summary: await summaryNow(), message: `${others ? 'Nothing for USPS today. Other carriers scan each box at pickup.' : 'No labels waiting for a manifest.'}${heldLine}` });

  // One form per carrier account per ship date (Shippo's rule), so each label is looked up for both.
  const groups = new Map<string, { acct: string; date: string; list: any[] }>();
  const failed: { orderId: string; error: string }[] = [];
  const lookup = async (o: any) => {
    try {
      const txn = await shippo(apiKey, `/transactions/${encodeURIComponent(o.shippoTransactionId)}`);
      const rateId = typeof txn.rate === 'string' ? txn.rate : txn.rate?.object_id;
      const rate = rateId ? await shippo(apiKey, `/rates/${encodeURIComponent(rateId)}`) : null;
      const acct = String(rate?.carrier_account || '');
      if (!acct) { liveSlots(o).forEach(() => failed.push({ orderId: o.id, error: 'No carrier account on this label' })); return; }
      const shipmentId = typeof rate?.shipment === 'string' ? rate.shipment : rate?.shipment?.object_id;
      const shipment = shipmentId ? await shippo(apiKey, `/shipments/${encodeURIComponent(shipmentId)}`) : null;
      const when = String(shipment?.shipment_date || txn.object_created || new Date().toISOString());
      const date = when.slice(0, 10);
      const key = `${acct}|${date}`;
      const g = groups.get(key) || { acct, date, list: [] as any[] };
      g.list.push({ ...o, shipmentDate: when });
      groups.set(key, g);
    } catch (e: any) { liveSlots(o).forEach(() => failed.push({ orderId: o.id, error: String(e?.message || 'Lookup failed') })); }
  };
  for (let i = 0; i < usps.length; i += 8) await Promise.all(usps.slice(i, i + 8).map(lookup));

  const addressFrom = {
    name: from.name || String(tenant.businessName || tenant.name || 'Shop'),
    street1: from.street1, street2: from.street2 || '', city: from.city, state: from.state, zip: from.zip, country: 'US',
    phone: from.phone || '', email: from.email || '',
  };
  const now = new Date().toISOString();
  const started = Date.now();
  // One entry per box: every box of an order goes on the form, each by its own label.
  type Entry = { o: any; txn: string };
  const already: Entry[] = [];   // boxes Shippo says are on a form already
  // Ask Shippo for one form; labels it turns away are dropped and the rest tried once more.
  const createForm = async (acct: string, shipmentDate: string, list: Entry[]): Promise<{ m: any; used: Entry[] } | null> => {
    let todo = list;
    for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
      const res = await fetch(`${SHIPPO}/manifests/`, {
        method: 'POST', headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier_account: acct, shipment_date: shipmentDate, address_from: addressFrom, transactions: todo.map((e) => e.txn), async: false }), signal: timeout(30000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) return { m: data, used: todo };
      const rejected = data?.transactions && typeof data.transactions === 'object' ? Object.keys(data.transactions) : [];
      const detail = String(data?.detail || (Array.isArray(data?.messages) ? data.messages.map((x: any) => x.text).join('; ') : '') || `HTTP ${res.status}`).slice(0, 200);
      if (!rejected.length) { todo.forEach((e) => failed.push({ orderId: e.o.id, error: detail })); return null; }
      const why = (e: Entry) => String(data.transactions[e.txn]?.reason || data.transactions[e.txn] || detail);
      for (const e of todo.filter((x) => rejected.includes(x.txn))) {
        // Already on a form (one made earlier that wasn't recorded): it's covered, so it's marked and not tried again.
        if (/already_manifested/i.test(why(e))) { already.push(e); continue; }
        failed.push({ orderId: e.o.id, error: `Shippo left it off the form: ${why(e).slice(0, 120)}` });
      }
      todo = todo.filter((x) => !rejected.includes(x.txn));
    }
    // Still turned away after the second try: listed, so nothing goes missing quietly.
    todo.forEach((e) => failed.push({ orderId: e.o.id, error: 'Shippo couldn’t make the form for it' }));
    return null;
  };
  // Shippo makes the form in the background: wait a little for the sheet (well inside the time limit).
  const settle = async (m: any) => {
    let cur = m;
    for (const wait of [3000, 5000, 8000, 12000]) {
      if ((Array.isArray(cur?.documents) && cur.documents.length) || ['ERROR', 'SUCCESS'].includes(String(cur?.status || '').toUpperCase()) || Date.now() - started > 40000) break;
      await new Promise((r) => setTimeout(r, wait));
      try { cur = await shippo(apiKey, `/manifests/${encodeURIComponent(String(m.object_id))}`); } catch { break; }
    }
    return cur;
  };

  const out: any[] = [];
  const stamped = new Set<string>();
  for (const g of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const entries: Entry[] = g.list.flatMap((o: any) => liveSlots(o).map((sl) => ({ o, txn: String(sl.txn || '') })).filter((e: Entry) => e.txn));
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      try {
        const made = await createForm(g.acct, chunk[0].o.shipmentDate, chunk);
        if (!made) continue;
        // Recorded and stamped the moment Shippo accepts it, before any waiting, so a form is never made and forgotten.
        const ref = manifests.doc();
        const orders = [...new Map(made.used.map((e) => [e.o.id, e.o])).values()];
        const rec: any = {
          id: ref.id, createdAt: now, carrier: 'USPS', shipmentDate: g.date, shippoManifestId: String(made.m.object_id || ''), status: String(made.m.status || ''),
          documents: Array.isArray(made.m.documents) ? made.m.documents.map(String) : [], orderIds: orders.map((o: any) => o.id),
          orderNumbers: orders.map((o: any) => o.orderNumber ?? null), txns: made.used.map((e) => e.txn), count: made.used.length, byId: auth.actor.uid, byName: auth.actor.name,
        };
        const batch = db.batch();
        batch.set(ref, rec);
        orders.forEach((o: any) => {
          stamped.add(o.id);
          batch.set(o.ref, { manifestId: ref.id, manifestedAt: now }, { merge: true });
          const ev = o.ref.collection('events').doc();
          batch.set(ev, { id: ev.id, type: 'manifested', at: now, actorId: auth.actor.uid, actorName: auth.actor.name, meta: { manifestId: ref.id, carrier: 'USPS', boxes: made.used.filter((e) => e.o.id === o.id).length } });
        });
        await batch.commit();
        // Then a little wait for the sheet.
        const m = await settle(made.m);
        const status = String(m.status || rec.status || '');
        const documents = Array.isArray(m.documents) ? m.documents.map(String) : rec.documents;
        if (failedNow(status)) {
          // Its labels are freed first; if that fails, the form stays as it was and history frees them later.
          await unstamp(rec);
          await ref.set({ status, documents, freedAt: new Date().toISOString() }, { merge: true });
          made.used.forEach((e) => failed.push({ orderId: e.o.id, error: 'Shippo couldn’t make the form' }));
          continue;
        }
        rec.status = status; rec.documents = documents;
        await ref.set({ status, documents }, { merge: true });
        out.push(rec);
      } catch (e: any) {
        chunk.forEach((x) => failed.push({ orderId: x.o.id, error: String(e?.message || 'Manifest failed') }));
      }
    }
  }
  const earlier = [...new Map(already.filter((e) => !stamped.has(e.o.id)).map((e) => [e.o.id, e.o])).values()];
  if (earlier.length) {
    const batch = db.batch();
    earlier.forEach((o: any) => batch.set(o.ref, { manifestId: 'earlier', manifestedAt: now }, { merge: true }));
    await batch.commit().catch(() => {});
  }
  const count = out.reduce((a, m) => a + m.count, 0);
  const making = out.some((m: any) => !(m.documents || []).length);
  const left = failed.length ? ` ${failed.length} box${failed.length === 1 ? '' : 'es'} couldn’t go on it; the carrier scans ${failed.length === 1 ? 'that one' : 'those'} at pickup.` : '';
  return NextResponse.json({
    ok: out.length > 0 || failed.length === 0, manifests: out, count, others, failed, making, held, summary: await summaryNow(),
    message: count
      ? `${out.length > 1 ? `${out.length} USPS forms` : 'USPS form'} ${making ? 'being made' : 'ready'} for ${count} box${count === 1 ? '' : 'es'}${out.length > 1 ? ', one for each day the labels were bought' : ''}. Hand the carrier the sheet${out.length > 1 ? 's' : ''}.${left}${heldLine}`
      : `The USPS form didn’t go through. Your labels still work; the carrier can scan each box.${left}${heldLine}`,
  });
}
