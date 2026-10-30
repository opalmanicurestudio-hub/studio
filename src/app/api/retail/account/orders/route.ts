import { digitalLineAccess } from '@/lib/digital-access';
import { makePass } from '@/lib/order-pass';
import { entitlementId, publicEntitlement } from '@/lib/entitlements';
import { NextRequest, NextResponse } from 'next/server';

import { normalizeEmail, verifyAccountToken } from '@/lib/retail-account';
import { STAGE_LABELS } from '@/lib/retail-orders';
import { customerDates, dayLabel } from '@/lib/ship-promise';

// ─── GET /api/retail/account/orders ───────────────────────────────────────────
// ?tenantId&e&x&s → { orders[], creditCents }
//
// Efficiency by construction:
//  - Token verification is pure crypto — an invalid token costs ZERO reads.
//  - Equality-only Firestore queries (no orderBy) + in-memory sort, so no
//    composite index is ever required and the first call can't fail with an
//    index-creation error.
//  - Both raw and lowercased email are queried and merged, so historic
//    orders survive any casing drift between Stripe and the webhook.
//  - Payload is deliberately minimal — no addresses; each order links to its
//    own qrToken-gated tracking page for the details.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-account';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const ACTIVE = ['placed', 'paid', 'picking', 'packed', 'ready', 'arrived'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim();
  const rawEmail = String(sp.get('e') || '');
  const email = normalizeEmail(rawEmail);
  const exp = Number(sp.get('x'));
  const sig = String(sp.get('s') || '');

  const check = verifyAccountToken(tenantId, email, exp, sig);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 });

  const db = getAdminDb();
  const ordersCol = db.collection(`tenants/${tenantId}/retailOrders`);
  const [lowerSnap, rawSnap, creditSnap] = await Promise.all([
    ordersCol.where('customerEmail', '==', email).limit(100).get(),
    rawEmail !== email
      ? ordersCol.where('customerEmail', '==', rawEmail).limit(100).get()
      : Promise.resolve({ docs: [] } as any),
    db.collection(`tenants/${tenantId}/depositCredits`).where('clientEmail', '==', email).limit(100).get(),
  ]);

  const seen = new Map<string, any>();
  [...lowerSnap.docs, ...rawSnap.docs].forEach((d: any) => seen.set(d.id, { id: d.id, ...d.data() }));

  const orders = [...seen.values()]
    .sort((a, b) => String(b.placedAt || '').localeCompare(String(a.placedAt || '')))
    .slice(0, 60)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      stage: o.stage,
      /* A resolved return changes what an order IS in the customer's history:
       * "Completed" on an order whose items came back and were refunded is a
       * status page lying by omission. The label carries the outcome. */
      stageLabel: o.returnSummary
        ? (o.returnSummary.resolution === 'refund' ? 'Returned \u2014 refunded'
          : o.returnSummary.resolution === 'store_credit' ? 'Returned \u2014 store credit'
          : o.returnSummary.resolution === 'replacement' ? 'Returned \u2014 replaced'
          : 'Returned')
        : (STAGE_LABELS[o.stage as keyof typeof STAGE_LABELS] || o.stage),
      returnSummary: o.returnSummary || null,
      active: ACTIVE.includes(o.stage),
      method: o.method,
      totalCents: o.totalCents || 0,
      placedAt: o.placedAt || '',
      // Ships by, on a shipped order still being packed, when they were shown the date.
      shipsBy: o.method === 'ship' && ['paid', 'picking', 'packed'].includes(o.stage)
        ? (() => { const d = customerDates(o); return d ? `Ships by ${dayLabel(d.shipBy, d.timeZone)}` : ''; })()
        : '',
      itemCount: Array.isArray(o.lines)
        ? o.lines.reduce((s: number, l: any) => s + (l.qtyOrdered - (l.qtyShorted || 0)), 0)
        : 0,
    }));

  // Store credit only (a booking's deposit isn't spendable in the shop), from what's left on it (lib/credit-pools).
  const { storeCreditBalance } = await import('@/lib/credit-pools');
  const creditCents = storeCreditBalance(creditSnap.docs.map((d: any) => d.data() || {}));

  // ── One shelf for everything they've ever bought that isn't a parcel.
  // Assembled across ALL their orders, newest first, deduped by product so
  // buying the same guide twice doesn't read as two entitlements. Each entry
  // carries the order it came from, because access is checked against that
  // order — the shelf is a directory, never a second door.
  // Every paid digital line first, then each one's access record (lib/entitlements) so the shop's own changes count:
  // a revoked item leaves the shelf, an extension moves the end date, the downloads left show. Then one entry per
  // product, the newest copy that still opens (a revoked or refunded older copy never hides a newer one).
  const lines: { o: any; l: any }[] = [];
  [...seen.values()]
    .sort((a, b) => String(b.paidAt || b.placedAt || '').localeCompare(String(a.paidAt || a.placedAt || '')))
    .forEach((o: any) => {
      if (['placed', 'cancelled'].includes(String(o.stage))) return;
      if (o.digitalGift) return;   // bought as a gift: it belongs to the person it was for, who opens it from their gift email
      (o.lines || []).forEach((l: any) => { if (l.digital === true) lines.push({ o, l }); });
    });
  let ents: any[] = lines.map(() => null);
  try {
    if (lines.length) {
      const refs = lines.map(({ o, l }) => db.doc(`tenants/${tenantId}/entitlements/${entitlementId(o.id, l.lineId || l.productId)}`));
      const snaps: any[] = [];
      for (let i = 0; i < refs.length; i += 100) snaps.push(...(await db.getAll(...refs.slice(i, i + 100))));
      ents = lines.map((_, i) => (snaps[i]?.exists ? snaps[i].data() : null));
    }
  } catch { /* the shelf still shows what was bought */ }
  const library: any[] = [];
  const byProduct = new Map<string, number>();
  lines.forEach(({ o, l }, i) => {
    // One rule for who may open what (lib/digital-access): refunded, returned, charged back or revoked drops off the
    // shelf; an ended window stays, marked, so they can ask for more time.
    const a = digitalLineAccess(o, l, Date.now(), ents[i]);
    if (!a.open && a.reason !== 'expired') return;
    const at = byProduct.get(l.productId);
    if (at !== undefined && (library[at].expired === false || a.reason === 'expired')) return;
    const pub = publicEntitlement(ents[i]);
    const entry = {
      lineId: String(l.lineId || l.productId),
      productId: l.productId,
      name: l.name,
      orderId: o.id,
      orderNumber: o.orderNumber ?? null,
      boughtAt: o.paidAt || o.placedAt || '',
      endsAt: a.endsAt,
      expired: a.reason === 'expired',
      downloadsLeft: pub?.downloadsLeft ?? null,
      license: pub?.license || null,
      // Signed in to their account is proof it's them: the library opens without asking for a code.
      pass: o.qrToken ? makePass(tenantId, String(o.qrToken)) : null,
    };
    if (at !== undefined) library[at] = entry;
    else { byProduct.set(l.productId, library.length); library.push(entry); }
  });

  /* THE PROFILE'S MESSAGE HISTORY. Every support conversation across every
   * order, under the proven email — so "where was that reply?" has one
   * answer. Same minimal shape the order page's thread renders. */
  let messages: any[] = [];
  try {
    const mSnap = await db.collection(`tenants/${tenantId}/retailSupport`)
      .where('customerEmail', '==', email).limit(30).get();
    messages = mSnap.docs
      .map((d: any) => {
        const t = d.data() || {};
        return {
          orderId: String(t.orderId || ''),
          orderNumber: t.orderNumber ?? null,
          message: String(t.message || ''),
          createdAt: t.createdAt || null,
          status: String(t.status || 'open'),
          replies: Array.isArray(t.replies) ? t.replies.length : 0,
          lastReplyBy: Array.isArray(t.replies) && t.replies.length ? String(t.replies[t.replies.length - 1].by || '') : null,
        };
      })
      .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch { messages = []; }

  return NextResponse.json({ email, orders, creditCents, library, messages });
}
