// src/app/api/renters/offers/route.ts — WHAT RENTERS GET, as the owner sets it (lib/renter-offers).
//   GET  ?tenantId                     → the setting, how many renters have each add-on, and whether add-ons can be charged
//   POST { tenantId, version, modes, prices, campaignPayer, monthlyTexts, perTextCents }
//        → saved, if nobody else saved it since `version`. Each tool's on/off is written where it's always been kept, so
//          every older check keeps working. A tool that stops being an add-on ends the add-ons renters had for it (no
//          longer charged). Every renter who books here is told what changed, in their portal and by email.
//          A renter whose signed lease says more keeps it (lib/renter-offers offersFor): until their lease's term ends,
//          or, for a lease with no end date, until the notice it gives runs out from today. They're named in `held`.
//   POST { tenantId, action: 'amend', renterIds } → each is sent an amendment to sign: from the day they sign, what
//          comes with their space is today's setting (lib/renter-offers signedOffersFrom, on signing in their portal).
// Owners and managers who can change settings.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { spacePayAccount } from '@/lib/space-stripe';
import { OFFER_KEYS, resolveOffers, readOffersInput, offersPatch, offerChanges, addOnsEnded, runningAddOn, offersFor, heldOffers, heldBetter, offersForLease, offersDiffer, type OfferKey } from '@/lib/renter-offers';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { sha256Hex } from '@/lib/sha256';
import { longDate } from '@/lib/lease-builder';

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

/** Renters whose signed lease keeps something better than these settings, until when, and whether an amendment is
 *  waiting for their signature. */
async function heldList(db: any, tenantId: string, offers: any, today: string) {
  const T = `tenants/${tenantId}`;
  const [rs, docs] = await Promise.all([db.collection(`${T}/renters`).get(), db.collection(`${T}/renterDocuments`).where('kind', '==', 'amendment').get()]);
  // Only one that still says what's offered now can be signed, so only that one counts as waiting (an out-of-date one can
  // be replaced by sending again).
  const waiting = new Set<string>(docs.docs.map((d: any) => d.data() || {}).filter((x: any) => x.status === 'sent' && x.meta?.amendOffers && !offersDiffer(x.meta.amendOffers, offers)).map((x: any) => String(x.renterId)));
  return rs.docs.filter((d: any) => heldBetter(offers, d.data() || {}, today).length).map((d: any) => {
    const r: any = d.data() || {};
    return { renterId: d.id, name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'A renter', until: heldOffers(r, today)?.until || null, amendmentWaiting: waiting.has(d.id) };
  });
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const db = getAdminDb();
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const rs = await bookingRenters(db, tenantId);
  const added = Object.fromEntries(OFFER_KEYS.map((k) => [k, rs.filter((r) => runningAddOn(r.data, k)).length])) as Record<OfferKey, number>;
  const offers = resolveOffers(t);
  return j({ ok: true, offers, added, renters: rs.length, paymentsReady: !!spacePayAccount(t), businessName: String(t.name || t.businessName || ''), held: await heldList(db, tenantId, offers, todayIn(tenantTimeZone(t))) });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => null);
  if (!b || typeof b !== 'object') return j({ ok: false, error: 'The request couldn’t be read.' }, 400);
  const tenantId = String(b.tenantId || '').slice(0, 80);
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tRef = db.doc(`tenants/${tenantId}`);
  const at = new Date().toISOString(); const by = String(g.actor?.name || 'The owner');
  if (b.action === 'amend') return amend(db, tenantId, b, by, g.actor?.uid || null);

  let result: { before: any; after: any; businessName: string; today: string } | null = null;
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
      return { before, after: read.after, businessName: String(t.name || t.businessName || ''), today: todayIn(tenantTimeZone(t)) };
    });
  } catch (e: any) {
    if (e?.code === 409) return j({ ok: false, error: 'Someone else saved these a moment ago. Here they are as they are now.', offers: resolveOffers(((await tRef.get()).data() as any) || {}) }, 409);
    if (e?.code === 400) return j({ ok: false, error: String(e.message) }, 400);
    console.error('[renter-offers] save failed');
    return j({ ok: false, error: 'That didn’t save. Try again.' }, 500);
  }
  const { before, after, businessName, today } = result!;
  const lines = offerChanges(before, after, businessName);

  // Signed leases keep what they say. One with no end date keeps it through the notice it gives, from today (once: a
  // later change doesn't push it out again). Each renter keeping something better than the new setting is named.
  const allR = (await db.collection(`tenants/${tenantId}/renters`).get()).docs;
  const leasesBy = new Map<string, any>();
  for (const d of (await db.collection(`tenants/${tenantId}/leases`).get()).docs) { const l: any = d.data() || {}; if (l.renterId && ['active', 'on_leave'].includes(String(l.status))) leasesBy.set(String(l.renterId), { id: d.id, ...l }); }
  const heldUntil = new Map<string, string | null>();
  const addDays = (iso: string, n: number) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  for (const d of allR) {
    let r: any = d.data() || {};
    if (!heldBetter(after, r, today).length) continue;   // this change takes nothing from what their lease keeps
    const h = heldOffers(r, today);
    if (h && !h.until) {
      const l = leasesBy.get(d.id); const until = addDays(today, Math.max(1, Number(l?.earlyTerminationNoticeDays) || 30));
      const ok = await d.ref.set({ signedOffers: { until } }, { merge: true }).then(() => true, () => false);
      if (ok) r = { ...r, signedOffers: { ...r.signedOffers, until } };
    }
    heldUntil.set(d.id, heldOffers(r, today)?.until || null);
  }
  // An amendment waiting to be signed was written for the settings before this change: it's taken back, so nobody signs
  // terms that are already out of date. The owner can send a new one.
  if (lines.length) for (const d of (await db.collection(`tenants/${tenantId}/renterDocuments`).where('kind', '==', 'amendment').get()).docs) {
    const x: any = d.data() || {};
    if (x.status !== 'sent' || !x.meta?.amendOffers || !offersDiffer(x.meta.amendOffers, after)) continue;
    const took = await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(d.ref)).data() as any) || {}; if (cur.status !== 'sent') return false; tx.set(d.ref, { status: 'withdrawn', withdrawnAt: at, withdrawnWhy: 'settings_changed' }, { merge: true }); return true; }).catch(() => false);
    if (took && x.renterId) { try { const { alertRenter } = await import('@/lib/renter-comms'); await alertRenter(db, tenantId, String(x.renterId), 'document', `${businessName || 'The business'} took back the amendment to your lease that was waiting for your signature: what comes with your space changed again. Your lease stays as you signed it.`, 'studio', 'slate'); } catch { /* the document shows as taken back either way */ } }
  }
  const held = [...heldUntil.entries()].map(([id, until]) => { const r: any = allR.find((x: any) => x.id === id)?.data() || {}; return { renterId: id, name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'A renter', until, amendmentWaiting: false }; });

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
      // Not one their signed lease keeps as an add-on.
      for (const e of ended) if (runningAddOn(r, e.key) && offersFor(after, r, today).modes[e.key] !== 'addon') patch[e.key] = { status: 'stopped', stoppedAt: at, stoppedWhy: e.why, nextBillOn: null };
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
      // Their signed lease keeps what it says until it can change: they're told until when.
      const keep = heldUntil.has(r.id) ? (heldUntil.get(r.id) ? `Your lease keeps what you signed for until ${longDate(heldUntil.get(r.id)!)}.` : 'Your lease keeps what you signed for.') : '';
      const mine = keep ? [...lines, keep] : lines;
      await alertRenter(db, tenantId, r.id, 'space_tools', `${biz} changed what comes with your space. ${mine.join(' ')}`, 'studio', 'slate');
      const email = String(r.data.email || '').trim();
      if (email.includes('@')) {
        await sendNotification(db, {
          tenantId, channel: 'email', to: email, kind: 'renter_offers_change', recipientType: 'renter', recipientId: r.id,
          subject: `${biz} changed what comes with your space`,
          html: brandedEmailHtml({ studioName: biz, title: 'What comes with your space has changed', bodyLines: [...mine, 'You can see the whole list in your portal, under Space.'], cta: link ? { label: 'Open my portal', url: link } : null }),
          text: `${biz} changed what comes with your space. ${mine.join(' ')}${link ? ` ${link}` : ''}`,
        } as any).catch(() => {});
      }
      told++;
    }
  }
  return j({ ok: true, offers: after, changed: lines, told, stopped, stopFailed, held, added: Object.fromEntries(OFFER_KEYS.map((k) => [k, ended.some((e) => e.key === k) ? 0 : rs.filter((r) => runningAddOn(r.data, k)).length])) });
}

/** An amendment to sign, for each renter named: from the day they sign it in their portal, what comes with their space
 *  is today's setting (their signed terms are replaced: lib/renter-offers signedOffersFrom, api/portal/renter). */
async function amend(db: any, tenantId: string, b: any, by: string, uid: string | null) {
  const T = `tenants/${tenantId}`;
  const ids: string[] = [...new Set<string>((Array.isArray(b.renterIds) ? b.renterIds : []).map((x: any) => String(x || '').slice(0, 80)).filter(Boolean))].slice(0, 200);
  if (!ids.length) return j({ ok: false, error: 'Choose who to send it to.' }, 400);
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const offers = resolveOffers(t); const biz = String(t.name || t.businessName || 'The business');
  const at = new Date().toISOString();
  const { alertRenter, renterPortalUrl } = await import('@/lib/renter-comms');
  const { sendNotification } = await import('@/lib/notify');
  const { brandedEmailHtml } = await import('@/lib/email-template');
  const portal = await renterPortalUrl(db, tenantId);
  let sent = 0; const skipped: string[] = [];
  for (const id of ids) {
    const r: any = ((await db.doc(`${T}/renters/${id}`).get()).data() as any) || null;
    const lease: any = (await db.collection(`${T}/leases`).where('renterId', '==', id).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).find((l: any) => ['active', 'on_leave'].includes(String(l.status))) || null;
    if (!r || !lease) { skipped.push(id); continue; }
    // One waiting at a time: an earlier amendment about these tools not yet signed is replaced by this one.
    const open = (await db.collection(`${T}/renterDocuments`).where('renterId', '==', id).get()).docs.filter((d: any) => { const x: any = d.data() || {}; return x.kind === 'amendment' && x.status === 'sent' && x.meta?.amendOffers; });
    for (const d of open) await db.runTransaction(async (tx: any) => { const cur: any = ((await tx.get(d.ref)).data() as any) || {}; if (cur.status === 'sent') tx.set(d.ref, { status: 'withdrawn', withdrawnAt: at, withdrawnWhy: 'replaced' }, { merge: true }); });
    const name = `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'the Renter';
    const body = [`An amendment to your lease`, `${biz} and ${name}${lease.boothName ? ` · ${lease.boothName}` : ''}`, '',
      `This amends the lease between ${biz} (the Business) and ${name} (the Renter). From the day the Renter signs it, what comes with the space is as follows.`, '',
      offersForLease(offers, biz), '',
      'Everything else in the lease stays the same.', '',
      'Signed by the Renter and for the Business, electronically, as recorded with this amendment.'].join('\n');
    const ref = db.collection(`${T}/renterDocuments`).doc();
    await ref.set({
      id: ref.id, renterId: id, renterName: name, leaseId: lease.id, kind: 'amendment', title: 'An amendment to your lease', body, action: 'sign', status: 'sent',
      sentAt: at, sentBy: biz,
      meta: { termsSha256: sha256Hex(body), amendOffers: { modes: offers.modes, prices: offers.prices, version: offers.version }, businessSignature: { name: by, at } },
      sentByUid: uid,
    });
    await alertRenter(db, tenantId, id, 'document', `${biz} sent an amendment to your lease to sign: what comes with your space.`, 'studio', 'amber');
    const email = String(r.email || '').trim();
    if (email.includes('@')) {
      await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'renter_document', recipientType: 'renter', recipientId: id,
        subject: `${biz} sent an amendment to your lease`,
        html: brandedEmailHtml({ studioName: biz, title: 'An amendment to sign', bodyLines: [`${biz} would like to change what comes with your space, from the day you sign. Your lease keeps what you signed for until then.`, 'You can read it, sign it or decline it in your portal, under Documents.'], cta: portal ? { label: 'Open my portal', url: portal } : null }),
        text: `${biz} sent an amendment to your lease to sign. ${portal || ''}` } as any).catch(() => {});
    }
    sent++;
  }
  await logAuditAdmin(db, tenantId, { action: 'renters.offers_amend', targetType: 'tenant', targetId: tenantId, summary: `${by} sent ${sent} renter${sent === 1 ? '' : 's'} an amendment to sign: what comes with their space`, actor: { type: 'user', id: uid || '', name: by } } as any).catch(() => {});
  return j({ ok: true, sent, skipped: skipped.length });
}
