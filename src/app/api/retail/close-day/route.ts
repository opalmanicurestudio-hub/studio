// src/app/api/retail/close-day/route.ts — CLOSE THE DAY. Staff only.
// POST { tenantId, action: 'manifest' } gathers every USPS label bought through Shippo that isn't on a manifest yet
// (stage packed or shipped, label from the last 7 days), groups them by carrier account and asks Shippo for one
// manifest per account: a single sheet the mail carrier scans instead of every box. Each order is stamped with the
// manifest so it is never put on two. Other carriers don't use manifests; they are counted and left alone.
// POST { tenantId, action: 'history' } lists the last 14 manifests.
import { SHIP_DENIED, mayShip } from '@/lib/fulfilment-guard';
import { shippoKeyFor } from '@/lib/retail-secrets';
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
async function shippo(apiKey: string, path: string, payload?: any) {
  const res = await fetch(`${SHIPPO}${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
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

  if (action === 'history') {
    const snap = await manifests.orderBy('createdAt', 'desc').limit(14).get();
    return NextResponse.json({ manifests: snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) });
  }

  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const rs = tenant.retailSettings || {};
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
  const candidates = all.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }))
    .filter((o: any) => ['packed', 'shipped'].includes(String(o.stage)))
    .filter((o: any) => o.shippoTransactionId && !o.manifestId && !o.labelVoidedAt)
    .filter((o: any) => { const at = Date.parse(o.shipmentProtection?.decidedAt || o.shippedAt || o.packedAt || ''); return !Number.isFinite(at) || at >= since; });
  const usps = candidates.filter((o: any) => isUsps(String(o.carrier || '')));
  const others = candidates.length - usps.length;
  if (usps.length === 0) return NextResponse.json({ ok: true, manifests: [], count: 0, others, message: others ? 'Nothing for USPS today. Other carriers scan each box at pickup.' : 'No labels waiting for a manifest.' });

  const groups = new Map<string, any[]>();
  const failed: { orderId: string; error: string }[] = [];
  // Looked up several at a time, so a busy day still finishes well inside the time limit.
  const lookup = async (o: any) => {
    try {
      const txn = await shippo(apiKey, `/transactions/${encodeURIComponent(o.shippoTransactionId)}`);
      const rateId = typeof txn.rate === 'string' ? txn.rate : txn.rate?.object_id;
      const rate = rateId ? await shippo(apiKey, `/rates/${encodeURIComponent(rateId)}`) : null;
      const acct = String(rate?.carrier_account || '');
      if (!acct) { failed.push({ orderId: o.id, error: 'No carrier account on this label' }); return; }
      groups.set(acct, [...(groups.get(acct) || []), o]);
    } catch (e: any) { failed.push({ orderId: o.id, error: String(e?.message || 'Lookup failed') }); }
  };
  for (let i = 0; i < usps.length; i += 8) await Promise.all(usps.slice(i, i + 8).map(lookup));

  const addressFrom = {
    name: from.name || String(tenant.businessName || tenant.name || 'Shop'),
    street1: from.street1, street2: from.street2 || '', city: from.city, state: from.state, zip: from.zip, country: 'US',
    phone: from.phone || '', email: from.email || '',
  };
  const now = new Date().toISOString();
  const out: any[] = [];
  for (const [acct, list] of groups) {
    try {
      const m = await shippo(apiKey, '/manifests/', {
        carrier_account: acct, shipment_date: now, address_from: addressFrom,
        transactions: list.map((o: any) => o.shippoTransactionId), async: false,
      });
      const docs: string[] = Array.isArray(m.documents) ? m.documents.map(String) : [];
      const ref = manifests.doc();
      const rec = {
        id: ref.id, createdAt: now, carrier: 'USPS', shippoManifestId: String(m.object_id || ''), status: String(m.status || ''),
        documents: docs, orderIds: list.map((o: any) => o.id),
        orderNumbers: list.map((o: any) => o.orderNumber ?? null), count: list.length, byId: auth.actor.uid, byName: auth.actor.name,
      };
      const batch = db.batch();
      batch.set(ref, rec);
      list.forEach((o: any) => {
        batch.set(o.ref, { manifestId: ref.id, manifestedAt: now }, { merge: true });
        const ev = o.ref.collection('events').doc();
        batch.set(ev, { id: ev.id, type: 'manifested', at: now, actorId: auth.actor.uid, actorName: auth.actor.name, meta: { manifestId: ref.id, carrier: 'USPS' } });
      });
      await batch.commit();
      out.push(rec);
    } catch (e: any) {
      list.forEach((o: any) => failed.push({ orderId: o.id, error: String(e?.message || 'Manifest failed') }));
    }
  }
  const count = out.reduce((a, m) => a + m.count, 0);
  return NextResponse.json({
    ok: out.length > 0 || failed.length === 0, manifests: out, count, others, failed,
    message: count ? `USPS manifest ready for ${count} box${count === 1 ? '' : 'es'}. Hand the carrier the sheet.` : 'The manifest didn’t go through. Your labels still work; the carrier can scan each box.',
  });
}
