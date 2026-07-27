// src/app/api/guest-lounge/route.ts
//
// The guest lounge data + action path for /check-in/[token].
//
// WHY THIS EXISTS
// ---------------
// The check-in portal is opened by a client who is NOT signed in to Firebase.
// That is by design (it's a link they get by text), but it means the browser
// is denied most of what the lounge screen needs:
//
//   firestore.rules:70-73   inventory        -> get, list: if isStaff()   DENIED
//   firestore.rules:77-79   clients/{id}     -> read: if isStaff()        DENIED
//   (catch-all at the end)  memberships                                   DENIED
//   firestore.rules:98      refreshmentRequests -> update: if isStaff()   DENIED
//
// So on the live site the amenity menu came back as an empty array, the client
// document came back null, the membership perk counter always computed 0, the
// "Recall" button silently failed, and the footer link to the studio portal
// resolved to /portal/{tenantId}/undefined. The lounge screen rendered a large
// empty band with nothing in it.
//
// Rather than open those collections up in firestore.rules (which would expose
// every tenant's cost prices, stock levels and full client list to anyone on the
// internet), this route reads them with the Admin SDK — which bypasses rules by
// design — and returns only a narrow, sanitized projection keyed off the
// check-in token the client already holds. Cost, supplier, margin, stock counts
// and every other client's data never leave the server.
//
// GET  ?token=...                      -> lounge payload (see LoungePayload)
// POST { token, action: 'request' }    -> place an amenity request
// POST { token, action: 'recall' }     -> cancel an amenity request
// POST { token, action: 'interest' }   -> tell staff the guest wants a service
//
// Every branch resolves the token first and derives tenantId/clientId/
// appointmentId from the stored record — the caller never gets to name them,
// so one guest can't read or write another tenant's data.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const MAX_AMENITIES = 60;
const MAX_UPSELL = 8;
const MAX_QTY = 6;

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const str = (v: any, cap = 200): string => (typeof v === 'string' ? v.slice(0, cap) : '');

const firstName = (full: any): string => {
  const s = str(full, 80).trim();
  if (!s) return '';
  return s.split(/\s+/)[0];
};

/** Resolve the check-in token to its tenant / client / appointment. */
async function resolveToken(db: any, token: string, tenantHint?: string | null) {
  // The portal page reads the top-level mirror, so that is the record that is
  // guaranteed to exist for any link a client actually received.
  let snap = await db.doc(`appointmentCheckIns/${token}`).get();
  if (!snap.exists && tenantHint) {
    snap = await db.doc(`tenants/${tenantHint}/appointmentCheckIns/${token}`).get();
  }
  if (!snap.exists) return null;
  const d = (snap.data() as any) || {};
  if (!d.tenantId) return null;
  if (tenantHint && d.tenantId !== tenantHint) return null;
  return {
    tenantId: String(d.tenantId),
    clientId: d.clientId ? String(d.clientId) : '',
    appointmentId: d.appointmentId ? String(d.appointmentId) : '',
    checkIn: d,
  };
}

/**
 * Light per-tenant rate limit, same shape as /api/checkins. Amenity ordering is
 * a handful of taps per visit, so 200 actions / 10 min across a whole studio is
 * generous while still capping abuse of a public endpoint.
 */
async function rateLimit(db: any, tenantId: string, key: string, max: number) {
  const ref = db.doc(`tenants/${tenantId}/private/${key}`);
  const cur = ((await ref.get()).data() as any) || {};
  const stamps: number[] = (cur.at || []).filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  if (stamps.length >= max) return false;
  await ref.set({ at: [...stamps, Date.now()].slice(-400) }, { merge: true });
  return true;
}

/**
 * Membership perk allowance per item, computed here because the browser cannot
 * read `memberships` or the client document.
 *
 * Mirrors the arithmetic the page used to do client-side: the allowance resets
 * on the billing cycle boundary, and every non-cancelled request for that item
 * inside the current cycle counts against it.
 */
function perkAllowance(membership: any, client: any, requests: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  const included: any[] = Array.isArray(membership?.includedProducts) ? membership.includedProducts : [];
  if (!included.length) return out;

  const nextBilling = client?.subscription?.nextBillingDate
    ? new Date(client.subscription.nextBillingDate)
    : new Date();
  const anchor = Number.isFinite(nextBilling.getTime()) ? nextBilling : new Date();
  const back = new Date(anchor);
  if (membership?.interval === 'yearly') back.setFullYear(back.getFullYear() - 1);
  else back.setMonth(back.getMonth() - 1);
  const cycleStart = new Date(back.getFullYear(), back.getMonth(), 1).getTime();

  for (const perk of included) {
    const id = str(perk?.id, 120);
    if (!id) continue;
    const limit = num(perk?.quantity);
    const used = requests
      .filter(r => r.itemId === id && r.status !== 'cancelled')
      .filter(r => {
        const t = new Date(r.requestedAt || 0).getTime();
        return Number.isFinite(t) && t >= cycleStart;
      })
      .reduce((sum, r) => sum + num(r.quantity || 1), 0);
    out[id] = Math.max(0, limit - used);
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const tenantHint = searchParams.get('tenantId');
    if (!token || token.length > 120) {
      return NextResponse.json({ ok: false, error: 'Missing token.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ctx = await resolveToken(db, token, tenantHint);
    if (!ctx) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    const { tenantId, clientId, appointmentId } = ctx;

    const [invSnap, svcSnap, clientSnap, aptSnap, tenantSnap] = await Promise.all([
      db.collection(`tenants/${tenantId}/inventory`).get(),
      db.collection(`tenants/${tenantId}/services`).get(),
      clientId ? db.doc(`tenants/${tenantId}/clients/${clientId}`).get() : Promise.resolve(null),
      appointmentId ? db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get() : Promise.resolve(null),
      db.doc(`tenants/${tenantId}`).get(),
    ]);

    const client = clientSnap && clientSnap.exists ? (clientSnap.data() as any) : null;
    const apt = aptSnap && aptSnap.exists ? (aptSnap.data() as any) : null;
    const tenantDoc = tenantSnap.exists ? (tenantSnap.data() as any) : null;

    // Active membership — only if the client actually has a live subscription.
    let membership: any = null;
    const isMember = !!(client?.activeMembershipId && client?.subscription?.status === 'active');
    if (isMember) {
      const mSnap = await db.doc(`tenants/${tenantId}/memberships/${client.activeMembershipId}`).get();
      if (mSnap.exists) membership = { id: mSnap.id, ...(mSnap.data() as any) };
    }

    // This client's request history — needed both for the perk maths and so the
    // screen can show what is already on its way.
    let requests: any[] = [];
    if (clientId) {
      const rSnap = await db
        .collection(`tenants/${tenantId}/refreshmentRequests`)
        .where('clientId', '==', clientId)
        .get();
      requests = rSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    }

    const perks = perkAllowance(membership, client, requests);

    // Sanitized amenity projection. Deliberately NOT a spread of the inventory
    // document: cost, supplier, reorder points and every other internal field
    // stay on the server. `available` is a boolean, not a stock count — a guest
    // has no business knowing there are three cans left.
    const amenities = invSnap.docs
      .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((i: any) => i.type === 'refreshment')
      .filter((i: any) => i.showInConcierge !== false)
      .filter((i: any) => num(i.totalStock) > 0)
      .filter((i: any) => !i.isMembersOnly || isMember)
      .slice(0, MAX_AMENITIES)
      .map((i: any) => ({
        id: String(i.id),
        name: str(i.name, 80) || 'Amenity',
        description: str(i.description, 240),
        category: str(i.category, 60),
        price: num(i.price),
        imageUrl: str(i.imageUrl, 600),
        isMembersOnly: i.isMembersOnly === true,
        available: true,
        maxQty: Math.max(1, Math.min(MAX_QTY, Math.floor(num(i.totalStock)) || 1)),
      }));

    // Upsell list: what else this studio does. Public data (firestore.rules:47
    // already allows anyone to list services) — served here purely to save the
    // browser a second round trip. Today's service is filtered out; nobody
    // needs to be sold the thing they are currently sitting in.
    const todaysServiceIds = new Set(
      [apt?.serviceId, ...(Array.isArray(apt?.serviceIds) ? apt.serviceIds : [])].filter(Boolean).map(String),
    );
    const upsell = svcSnap.docs
      .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((s: any) => s.isActive !== false)
      .filter((s: any) => !todaysServiceIds.has(String(s.id)))
      .filter((s: any) => str(s.name, 80).trim().length > 0)
      .sort((a: any, b: any) => str(a.name).localeCompare(str(b.name)))
      .slice(0, MAX_UPSELL)
      .map((s: any) => ({
        id: String(s.id),
        name: str(s.name, 80),
        description: str(s.description, 240),
        category: str(s.category, 60),
        price: num(s.price),
        duration: Math.max(0, Math.floor(num(s.duration))),
      }));

    return NextResponse.json({
      ok: true,
      guest: {
        id: clientId || null,
        firstName: firstName(client?.name || ctx.checkIn?.clientName),
        isMember,
        membershipName: membership ? str(membership.name, 80) : null,
      },
      // Appointment context for the "while you wait" panel. Read from the real
      // appointment document rather than the check-in mirror so the times and
      // the technician are the ones the studio is actually working from.
      session: {
        serviceName: str(apt?.serviceName, 80) || null,
        staffName: str(apt?.staffName, 80) || null,
        startTime: str(apt?.startTime, 40) || null,
        endTime: str(apt?.endTime, 40) || null,
        status: str(apt?.status, 40) || null,
      },
      amenities,
      perks,
      upsell,
      limits: { perSession: Math.max(0, Math.floor(num(tenantDoc?.complimentaryAmenityLimit))) },
      requests: requests
        .filter(r => !appointmentId || r.appointmentId === appointmentId)
        .filter(r => r.status === 'pending')
        .map(r => ({
          id: String(r.id),
          itemId: str(r.itemId, 120),
          itemName: str(r.itemName, 80),
          quantity: num(r.quantity || 1),
          isRedemption: r.isRedemption === true,
          status: str(r.status, 30),
        })),
    });
  } catch (err) {
    console.error('[guest-lounge] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not load the lounge menu.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!token || token.length > 120) {
      return NextResponse.json({ ok: false, error: 'Missing token.' }, { status: 400 });
    }
    if (!['request', 'recall', 'interest'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ctx = await resolveToken(db, token, typeof body?.tenantId === 'string' ? body.tenantId : null);
    if (!ctx) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    const { tenantId, clientId, appointmentId } = ctx;

    if (!(await rateLimit(db, tenantId, 'loungeRate', 200))) {
      return NextResponse.json({ ok: false, error: 'Too many requests — give it a moment.' }, { status: 429 });
    }

    // ── Cancel one of this guest's own pending requests ───────────────────────
    // Guests cannot do this from the browser: refreshmentRequests `update` is
    // staff-only (firestore.rules:98), which is why the Recall button used to
    // fail silently. Ownership is re-checked here against the resolved token.
    if (action === 'recall') {
      const requestId = str(body?.requestId, 120);
      if (!requestId) return NextResponse.json({ ok: false, error: 'Missing request.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/refreshmentRequests/${requestId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const r = snap.data() as any;
      if (clientId && r.clientId !== clientId) {
        return NextResponse.json({ ok: false, error: 'Not yours to recall.' }, { status: 403 });
      }
      if (r.status !== 'pending') {
        // Already picked up by the back of house — recalling now would be a lie.
        return NextResponse.json({ ok: false, error: 'Already being prepared — please ask your technician.' }, { status: 409 });
      }
      await ref.set({ status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'guest' }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // ── Tell the floor the guest is interested in another service ─────────────
    // No booking is created and no money moves. This is a nudge to the people
    // in the room, delivered as notifications addressed to the assigned
    // technician plus every owner/admin, because the staff portal's bell reads
    // `where('userId','==',staffMember.id)` and would never show an unaddressed
    // notification.
    if (action === 'interest') {
      const serviceId = str(body?.serviceId, 120);
      if (!serviceId) return NextResponse.json({ ok: false, error: 'Missing service.' }, { status: 400 });

      const [svcSnap, clientSnap, aptSnap] = await Promise.all([
        db.doc(`tenants/${tenantId}/services/${serviceId}`).get(),
        clientId ? db.doc(`tenants/${tenantId}/clients/${clientId}`).get() : Promise.resolve(null),
        appointmentId ? db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get() : Promise.resolve(null),
      ]);
      if (!svcSnap.exists) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

      const svc = svcSnap.data() as any;
      const client = clientSnap && clientSnap.exists ? (clientSnap.data() as any) : null;
      const apt = aptSnap && aptSnap.exists ? (aptSnap.data() as any) : null;
      const who = str(client?.name, 80) || str(ctx.checkIn?.clientName, 80) || 'A guest';
      const price = num(svc.price);
      const message = `${who} is asking about ${str(svc.name, 80)}${price > 0 ? ` ($${price.toFixed(2)})` : ''} — tapped it from the lounge screen.`;

      const recipients = new Set<string>();
      if (apt?.staffId) recipients.add(String(apt.staffId));
      try {
        const mgrs = await db
          .collection(`tenants/${tenantId}/staff`)
          .where('role', 'in', ['owner', 'admin'])
          .get();
        mgrs.docs.forEach((d: any) => recipients.add(d.id));
      } catch {
        /* an empty manager list still leaves the assigned technician notified */
      }

      const now = new Date().toISOString();
      const batch = db.batch();
      recipients.forEach(uid => {
        const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
        batch.set(ref, {
          id: ref.id,
          userId: uid,
          type: 'service_interest',
          read: false,
          createdAt: now,
          link: '/planner',
          message,
        });
      });
      // Also stamp the appointment so the interest is still discoverable at
      // checkout even if every notification gets dismissed.
      if (appointmentId) {
        batch.set(
          db.doc(`tenants/${tenantId}/appointments/${appointmentId}`),
          {
            loungeInterest: {
              serviceId,
              serviceName: str(svc.name, 80),
              price,
              askedAt: now,
            },
          },
          { merge: true },
        );
      }
      await batch.commit();
      return NextResponse.json({ ok: true, notified: recipients.size });
    }

    // ── Place an amenity request ──────────────────────────────────────────────
    const itemId = str(body?.itemId, 120);
    const qty = Math.max(1, Math.min(MAX_QTY, Math.floor(num(body?.quantity)) || 1));
    if (!itemId) return NextResponse.json({ ok: false, error: 'Missing item.' }, { status: 400 });
    if (!appointmentId) return NextResponse.json({ ok: false, error: 'This visit is not checked in yet.' }, { status: 409 });

    const [itemSnap, clientSnap, aptSnap, tenantSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}/inventory/${itemId}`).get(),
      clientId ? db.doc(`tenants/${tenantId}/clients/${clientId}`).get() : Promise.resolve(null),
      db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get(),
      db.doc(`tenants/${tenantId}`).get(),
    ]);
    if (!itemSnap.exists) return NextResponse.json({ ok: false, error: 'That item is no longer on the menu.' }, { status: 404 });

    const item = itemSnap.data() as any;
    const client = clientSnap && clientSnap.exists ? (clientSnap.data() as any) : null;
    const apt = aptSnap.exists ? (aptSnap.data() as any) : null;
    const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : null;

    if (item.type !== 'refreshment' || item.showInConcierge === false) {
      return NextResponse.json({ ok: false, error: 'That item is not available to order.' }, { status: 403 });
    }
    if (num(item.totalStock) < qty) {
      return NextResponse.json({ ok: false, error: `Only ${Math.floor(num(item.totalStock))} left — sorry.` }, { status: 409 });
    }

    const isMember = !!(client?.activeMembershipId && client?.subscription?.status === 'active');
    if (item.isMembersOnly && !isMember) {
      return NextResponse.json({ ok: false, error: 'That one is reserved for members.' }, { status: 403 });
    }

    // Per-session complimentary cap, enforced server-side. The browser used to
    // be the only thing checking this, which meant it wasn't really enforced.
    const sessionSnap = await db
      .collection(`tenants/${tenantId}/refreshmentRequests`)
      .where('appointmentId', '==', appointmentId)
      .get();
    const sessionRequests: any[] = sessionSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const pending: any[] = sessionRequests.filter(r => r.status === 'pending');
    if (pending.some(r => r.itemId === itemId)) {
      return NextResponse.json({ ok: false, error: 'That is already on its way.' }, { status: 409 });
    }
    const limit = Math.max(0, Math.floor(num(tenant?.complimentaryAmenityLimit)));
    if (limit > 0) {
      const alreadyOut = pending.reduce((sum, r) => sum + num(r.quantity || 1), 0);
      if (alreadyOut + qty > limit) {
        return NextResponse.json(
          { ok: false, error: `Complimentary limit is ${limit} item${limit === 1 ? '' : 's'} at a time.` },
          { status: 409 },
        );
      }
    }

    // Perk redemption, recomputed here rather than trusted from the browser.
    let remainingPerk = 0;
    if (isMember && client?.activeMembershipId) {
      const mSnap = await db.doc(`tenants/${tenantId}/memberships/${client.activeMembershipId}`).get();
      if (mSnap.exists) {
        const allRequestsSnap = await db
          .collection(`tenants/${tenantId}/refreshmentRequests`)
          .where('clientId', '==', clientId)
          .get();
        const all = allRequestsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
        remainingPerk = perkAllowance({ id: mSnap.id, ...(mSnap.data() as any) }, client, all)[itemId] || 0;
      }
    }
    const isRedemption = remainingPerk >= qty;

    // Station name, so the runner knows where to walk.
    let stationName = 'Lounge Area';
    if (apt?.status === 'servicing') {
      stationName = 'Station';
      const resId = Array.isArray(apt?.requiredResourceIds) ? apt.requiredResourceIds[0] : null;
      if (resId) {
        const rSnap = await db.doc(`tenants/${tenantId}/resources/${String(resId)}`).get();
        if (rSnap.exists) stationName = str((rSnap.data() as any)?.name, 60) || 'Station';
      }
    }

    const ref = db.collection(`tenants/${tenantId}/refreshmentRequests`).doc();
    await ref.set({
      id: ref.id,
      tenantId,
      appointmentId,
      clientId: clientId || null,
      clientName: str(client?.name, 80) || str(ctx.checkIn?.clientName, 80) || 'Guest',
      itemId,
      itemName: str(item.name, 80) || 'Amenity',
      quantity: qty,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      stationName,
      staffName: str(apt?.staffName, 80) || 'Unassigned',
      priceAtRequest: isRedemption ? 0 : num(item.price),
      isRedemption,
      source: 'guest_lounge',
    });

    return NextResponse.json({
      ok: true,
      request: {
        id: ref.id,
        itemId,
        itemName: str(item.name, 80) || 'Amenity',
        quantity: qty,
        isRedemption,
        status: 'pending',
      },
    });
  } catch (err) {
    console.error('[guest-lounge] POST failed', err);
    return NextResponse.json({ ok: false, error: 'Could not send that through.' }, { status: 500 });
  }
}
