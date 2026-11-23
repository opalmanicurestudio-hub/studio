// src/app/api/curbside/route.ts — THE CURBSIDE SCREEN's café half (lib/curbside-server; the screen is
// components/orders/CurbsideScreen). Signed in: the app, or the team app with a PIN. The shop's curbside orders the
// screen reads and moves itself, through the shop's own steps (lib/orders-flow).
//   list    { tenantId }          → café orders placed ahead for curbside, not handed over yet (and, with a mobile pickup
//                                    sensor, cars parked whose guest hasn't said they're here)
//   out     { tenantId, orderId } → someone's taking it out (ready, and they're here): their page says so
//   handed  { tenantId, orderId, bagPin? } → handed over: done (each bag's label scanned first, or a manager's PIN)
//   bags    { tenantId, orderId, count?, here? } → its bag labels printed again, on this device or the bag-label printer
//   bagScan { tenantId, orderId, code } → one bag's label, or one item's sticker, scanned (lib/food-bags-server)
//   extra   { tenantId, orderId, k, on } → one of the extras that go in its bag ticked in (or out), lib/bag-extras
//   sticker { tenantId, orderId, k }     → one item's sticker printed again; the old one stops scanning
//                                          (lib/item-stickers-server)
// Renters, who run their own business here, don't see or move the business's orders.
import { hereOf, zonedHere } from '@/lib/here-server';
import { atHere } from '@/lib/business-locations';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { cafeCurbside, cafeHanded, cafeOut } from '@/lib/curbside-server';
import { labelPrinter, printLabels, scanBag, tickExtra } from '@/lib/food-bags-server';
import { printStickerAgain } from '@/lib/item-stickers-server';
import { isSkipReason, reasonWords, skipReasonOf } from '@/lib/food-bags';
import { managerFor } from '@/lib/manager-pin';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
  if (!ID.test(tenantId)) return fail('Which business?');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (auth.actor.isRenter) return fail('Renters don’t take the business’s orders out.', 403);
  const db = getAdminDb();
  // (With more than one location, the one picked in the app: its curbside orders only. lib/here-server)
  // (A location in another time zone: its own today. lib/here-server zonedHere)
  if (action === 'list') {
    const here = await hereOf(db, tenantId, b.locationId);
    // (With a mobile pickup sensor: cars parked whose guest hasn't said they're here. lib/lane-entry-server parkedNow)
    const { parkedNow } = await import('@/lib/lane-entry-server');
    const parked = await parkedNow(db, tenantId, auth.tenant, here).catch(() => null);
    return NextResponse.json({ ok: true, here, cafe: (await cafeCurbside(db, tenantId, await zonedHere(db, tenantId, auth.tenant, here))).filter((c: any) => atHere(c, here)), on: auth.tenant?.orderAhead?.curbside === true, parked,
      // The printer that prints bag labels, if one does (lib/food-bags-server).
      labelPrinter: (await labelPrinter(db, `tenants/${tenantId}`).catch(() => null))?.name || null });
  }
  const orderId = String(b.orderId || ''); if (!ID.test(orderId)) return fail('Which order?');
  // (Each for a curbside order of this business only: lib/curbside-server checks it's one, and the bag's signed code its
  // order.)
  const isCurb = async () => { const o: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data(); return !!o && o.channel === 'ahead' && o.ahead?.way === 'curbside'; };
  if (action === 'bags' || action === 'bagScan' || action === 'sticker' || action === 'extra') {
    if (!(await isCurb())) return fail('This curbside order isn’t here.', 404);
    if (action === 'extra') { const x = await tickExtra(db, tenantId, auth.tenant, [orderId], orderId, b.k, b.on !== false); return x.ok ? NextResponse.json(x) : fail(x.error, x.status); }
    if (action === 'sticker') { const s = await printStickerAgain(db, tenantId, orderId, String(b.k || ''), auth.actor.name); return s.ok ? NextResponse.json(s) : fail(s.error, s.status); }
    const r = action === 'bagScan' ? await scanBag(db, tenantId, auth.tenant, [orderId], b.code) : await printLabels(db, tenantId, orderId, { by: auth.actor.name, here: b.here === true, count: b.count });
    return r.ok ? NextResponse.json(r) : fail(r.error, r.status);
  }
  if (action === 'out' || action === 'handed') {
    // A bag that won't scan: a manager lets it go without (signed in as one, or their PIN), kept on the order.
    let skip: { id: string; name: string; reason: string } | null = null;
    if (action === 'handed' && b.bagOverride === true) {
      if (!isSkipReason(b.bagReason)) return fail('Say why it’s going without everything scanned.');
      // (Signed in as a manager or the owner: that's them. Otherwise their PIN, with the usual lockout.)
      const m = (auth.actor.isManager || auth.actor.isTenantOwner) && !(auth.actor as any).screen ? { approver: { id: String(auth.actor.uid || ''), name: auth.actor.name } } as Awaited<ReturnType<typeof managerFor>>
        : await managerFor(db, tenantId, auth.actor.uid ? { id: String(auth.actor.uid), name: auth.actor.name } : null, b.pin);
      if (m.error) return NextResponse.json({ ok: false, needsManager: !!m.notManager, error: m.error }, { status: m.notManager ? 403 : m.status || 400 });
      if (!m.approver) return NextResponse.json({ ok: false, needsManager: true, error: 'A manager lets it go without everything scanned. Their PIN, or ask one to.' }, { status: 403 });
      skip = { id: m.approver.id, name: m.approver.name, reason: skipReasonOf(b.bagReason) };
    }
    const r: any = action === 'out' ? await cafeOut(db, tenantId, orderId, auth.actor) : await cafeHanded(db, tenantId, orderId, auth.actor, { tenant: auth.tenant, skip });
    // A manager let it go without every bag scanned: on the record, as at the counter.
    if (r.ok && r.skippedBags && skip) await logAuditAdmin(db, tenantId, { action: 'curbside.bags_skipped', targetType: 'order', targetId: orderId, summary: `${skip.name} let a curbside order go without everything scanned${skip.name !== auth.actor.name ? ` (at ${auth.actor.name}’s screen)` : ''}: ${reasonWords(skip.reason)}.`, actor: { type: 'user', id: skip.id || 'curbside', name: skip.name } } as any).catch(() => {});
    return r.ok ? NextResponse.json({ ok: true, already: !!r.already }) : NextResponse.json({ ok: false, error: r.error, ...(r.code ? { code: r.code, bags: r.bags } : {}) }, { status: r.status });
  }
  return fail('Unknown action.');
}
