// src/app/api/renters/offers/route.ts — WHAT RENTERS GET, as the owner sets it (lib/renter-offers).
//   GET  ?tenantId                     → the setting, how many renters have each add-on, and whether add-ons can be charged
//   POST { tenantId, version, modes, prices, campaignPayer, monthlyTexts, perTextCents }
//        → saved, if nobody else saved it since `version`. Each tool's on/off is written where it's always been kept, so
//          every older check keeps working. A tool that stops being an add-on ends the add-ons renters had for it (no
//          longer charged). Every renter who books here is told what changed, in their portal and by email.
// Owners and managers who can change settings.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { spacePayAccount } from '@/lib/space-stripe';
import { OFFER_KEYS, resolveOffers, readOffersInput, offersPatch, offerChanges, addOnsEnded, runningAddOn, type OfferKey } from '@/lib/renter-offers';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const LIVE_LEASE = ['active', 'on_leave', 'pending_signature'];

/** Renters who book here and have a lease now: who sees these tools, and who's told when they change. */
async function bookingRenters(db: any, tenantId: string): Promise<{ id: string; data: any }[]> {
  const T = `tenants/${tenantId}`;
  const [staff, leases, renters] = await Promise.all([
    db.collection(`${T}/staff`).where('isRenter', '==', true).get(),
    db.collection(`${T}/leases`).get(),
    db.collection(`${T}/renters`).get(),
  ]);
  const books = new Set<string>(staff.docs.map((d: any) => d.data() as any).filter((m: any) => m.renterId && m.isActive !== false).map((m: any) => String(m.renterId)));
  const leased = new Set<string>(leases.docs.map((d: any) => d.data() as any).filter((l: any) => l.renterId && LIVE_LEASE.includes(String(l.status))).map((l: any) => String(l.renterId)));
  return renters.docs.filter((d: any) => books.has(d.id) && leased.has(d.id)).map((d: any) => ({ id: d.id, data: d.data() || {} }));
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const db = getAdminDb();
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const rs = await bookingRenters(db, tenantId);
  const added = Object.fromEntries(OFFER_KEYS.map((k) => [k, rs.filter((r) => runningAddOn(r.data, k)).length])) as Record<OfferKey, number>;
  return j({ ok: true, offers: resolveOffers(t), added, renters: rs.length, paymentsReady: !!spacePayAccount(t), businessName: String(t.name || t.businessName || '') });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => null);
  if (!b || typeof b !== 'object') return j({ ok: false, error: 'The request couldn’t be read.' }, 400);
  const tenantId = String(b.tenantId || '').slice(0, 80);
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tRef = db.doc(`tenants/${tenantId}`);
  const at = new Date().toISOString(); const by = String(g.actor?.name || 'The owner');

  let result: { before: any; after: any; businessName: string } | null = null;
  try {
    result = await db.runTransaction(async (tx: any) => {
      const t = ((await tx.get(tRef)).data() as any) || {};
      const before = resolveOffers(t);
      if (Number(b.version) !== before.version) throw Object.assign(new Error('stale'), { code: 409 });
      const read = readOffersInput(b, before);
      if (!read.ok) throw Object.assign(new Error(read.error), { code: 400 });
      if (OFFER_KEYS.some((k) => read.after.modes[k] === 'addon' && before.modes[k] !== 'addon') && !spacePayAccount(t))
        throw Object.assign(new Error('Add-ons are charged to renters’ saved cards, so card payments need to be set up first.'), { code: 400 });
      tx.set(tRef, offersPatch(read.after, { at, by: g.actor?.uid || null }), { merge: true });
      return { before, after: read.after, businessName: String(t.name || t.businessName || '') };
    });
  } catch (e: any) {
    if (e?.code === 409) return j({ ok: false, error: 'Someone else saved these a moment ago. Here they are as they are now.', offers: resolveOffers(((await tRef.get()).data() as any) || {}) }, 409);
    if (e?.code === 400) return j({ ok: false, error: String(e.message) }, 400);
    console.error('[renter-offers] save failed');
    return j({ ok: false, error: 'That didn’t save. Try again.' }, 500);
  }
  const { before, after, businessName } = result!;
  const lines = offerChanges(before, after, businessName);

  // Add-ons that a tool no longer being an add-on ends: no longer charged from today.
  const ended = addOnsEnded(before, after);
  const rs = await bookingRenters(db, tenantId);
  // Billing also skips any add-on whose tool isn't an add-on any more (lib/renter-addon-billing), so one missed here is
  // never charged; the owner is told if any were.
  let stopped = 0, stopFailed = 0; const stoppedIds: string[] = [];
  if (ended.length) {
    const all = (await db.collection(`tenants/${tenantId}/renters`).get()).docs;
    for (const d of all) {
      const r: any = d.data() || {};
      const patch: Record<string, any> = {};
      for (const e of ended) if (runningAddOn(r, e.key)) patch[e.key] = { status: 'stopped', stoppedAt: at, stoppedWhy: e.why, nextBillOn: null };
      if (!Object.keys(patch).length) continue;
      try { await d.ref.set({ addOns: patch }, { merge: true }); stopped++; stoppedIds.push(d.id); } catch { stopFailed++; }
    }
  }

  await logAuditAdmin(db, tenantId, {
    action: 'renters.offers_update', targetType: 'tenant', targetId: tenantId,
    summary: lines.length ? `${by} changed what renters get: ${lines.join(' ')}` : `${by} saved what renters get (nothing changed)`,
    before: { modes: before.modes, prices: before.prices }, after: { modes: after.modes, prices: after.prices },
    actor: { type: 'user', id: g.actor?.uid || '', name: by, role: g.actor?.role || '' },
  } as any).catch(() => {});

  // Tell every renter who books here what changed (and anyone else whose add-on it just ended): in their portal, and by email.
  let told = 0;
  const extra = stoppedIds.filter((id) => !rs.some((r) => r.id === id));
  if (extra.length) for (const id of extra) { const d = await db.doc(`tenants/${tenantId}/renters/${id}`).get(); rs.push({ id, data: d.data() || {} }); }
  if (lines.length && rs.length) {
    const { alertRenter, renterPortalUrl } = await import('@/lib/renter-comms');
    const { sendNotification } = await import('@/lib/notify');
    const { brandedEmailHtml } = await import('@/lib/email-template');
    const portal = await renterPortalUrl(db, tenantId);
    const biz = businessName || 'The business';
    const link = portal ? `${portal}?view=tools` : null;
    for (const r of rs) {
      await alertRenter(db, tenantId, r.id, 'space_tools', `${biz} changed what comes with your space. ${lines.join(' ')}`, 'studio', 'slate');
      const email = String(r.data.email || '').trim();
      if (email.includes('@')) {
        await sendNotification(db, {
          tenantId, channel: 'email', to: email, kind: 'renter_offers_change', recipientType: 'renter', recipientId: r.id,
          subject: `${biz} changed what comes with your space`,
          html: brandedEmailHtml({ studioName: biz, title: 'What comes with your space has changed', bodyLines: [...lines, 'You can see the whole list in your portal, under Space.'], cta: link ? { label: 'Open my portal', url: link } : null }),
          text: `${biz} changed what comes with your space. ${lines.join(' ')}${link ? ` ${link}` : ''}`,
        } as any).catch(() => {});
      }
      told++;
    }
  }
  return j({ ok: true, offers: after, changed: lines, told, stopped, stopFailed, added: Object.fromEntries(OFFER_KEYS.map((k) => [k, ended.some((e) => e.key === k) ? 0 : rs.filter((r) => runningAddOn(r.data, k)).length])) });
}
