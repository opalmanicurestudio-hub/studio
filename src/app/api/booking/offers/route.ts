// POST /api/booking/offers — MEMBERSHIPS AND PACKAGES ON THE BOOKING PAGE (lib/offer-sale).
//   { action: 'list', tenantId }                                → what's sold openly, and whether cards are taken online
//   { action: 'start', tenantId, kind, id, name, email, phone }  → a checkout on the business's own account ({ url })
//   { action: 'finish', tenantId, session }                      → the client is back from paying: give it (once)
// Memberships and packages aren't publicly readable, so the page asks here; only their public words come back.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic, bump } from '@/lib/rate-limit';
import { createHash } from 'crypto';
import { publicOffers, startOfferSale, finishOfferSale, takesCards } from '@/lib/offer-sale';
import { studioPage } from '@/lib/studio-page';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b?.tenantId || '').slice(0, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb();
  try {
    if (b.action === 'list') {
      const limited = await limitPublic(req, 'offers-list', tenantId, { perHour: 600, perDay: 6000 }); if (limited) return limited;
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data(); if (!t) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
      // Selling online is the owner's choice (Settings › Booking page): until it's on, there's nothing to list.
      if (!studioPage(t).on.offers) return NextResponse.json({ ok: true, online: false, memberships: [], packages: [] }, { headers: { 'Cache-Control': 'no-store' } });
      const [ms, ps, sv] = await Promise.all(['memberships', 'packages', 'services'].map((c) => db.collection(`tenants/${tenantId}/${c}`).get().catch(() => ({ docs: [] as any[] }))));
      const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      return NextResponse.json({ ok: true, online: takesCards(t) && !!process.env.STRIPE_SECRET_KEY, ...publicOffers(rows(ms), rows(ps), rows(sv)) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Online payments aren’t set up here yet.' }, { status: 503 });
    if (b.action === 'start') {
      // The cheap checks first, so a burst of junk can't use up the business's daily allowance.
      const email = String(b.email || '').trim().toLowerCase();
      if (!['membership', 'package'].includes(String(b.kind)) || !/^[A-Za-z0-9_-]{1,80}$/.test(String(b.id || '')) || !String(b.name || '').trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Add your name and email.' }, { status: 400 });
      const limited = await limitPublic(req, 'offers-start', tenantId, { perHour: 20, perDay: 500 }); if (limited) return limited;
      // And a few tries per email an hour (it answers whether someone is already a member, like the member check).
      const okEmail = await bump(`offers-start-email_${createHash('sha256').update(`${tenantId}|${email}`).digest('hex').slice(0, 32)}_${Math.floor(Date.now() / 3600000)}`, 6, 2 * 3600000).catch(() => true);
      if (!okEmail) return NextResponse.json({ ok: false, error: 'Too many tries for now. Please try again in an hour.' }, { status: 429 });
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data();
      if (!t || !studioPage(t).on.offers) return NextResponse.json({ ok: false, error: 'That isn’t available online.' }, { status: 404 });
      // Where the client comes back to: the business's own address (lib/app-origin), never one a request names.
      const r = await startOfferSale(db, stripe(), { tenantId, kind: b.kind, id: String(b.id || ''), name: b.name, email: b.email, phone: b.phone, origin: req.nextUrl.origin });
      return r.ok ? NextResponse.json({ ok: true, url: r.url }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    }
    if (b.action === 'finish') {
      const limited = await limitPublic(req, 'offers-finish', tenantId, { perHour: 60, perDay: 600 }); if (limited) return limited;
      const r = await finishOfferSale(db, stripe(), tenantId, String(b.session || ''));
      return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ ok: false, error: 'Unknown request.' }, { status: 400 });
  } catch (e: any) {
    console.error('[booking/offers]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Something went wrong. Try again in a moment.' }, { status: 500 });
  }
}
