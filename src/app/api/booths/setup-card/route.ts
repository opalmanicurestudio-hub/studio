/**
 * /api/booths/setup-card — v2
 *
 * Card on file for LEASE RENTERS (the hotel model, monthly edition).
 * Day/hourly guests already save a card at checkout; lease renters never
 * pass through checkout, so this route runs Stripe Checkout in SETUP
 * mode — a hosted card-collection page, zero client-side Stripe.js.
 *
 * POST { tenantId, renterId, returnUrl, linkToken?, portalToken? }
 *   → creates/reuses a Stripe Customer for the renter, opens a setup
 *     session, returns { url } to redirect to. From the team (the owner's
 *     Booths screen) it returns instead the link to send the renter: our own
 *     card page, signed for them, good for 7 days.
 *
 * GET ?tenantId=&renterId=&session=
 *   → called on return from Stripe: retrieves the SetupIntent, stores
 *     the payment method + card summary (brand/last4) on the renter doc.
 *     Idempotent.
 * GET ?tenantId=&renterId=&link=
 *   → the card page opened from the owner's link: is the link still good?
 *     (the studio's name and the renter's first name, nothing else).
 *
 * WHO MAY SAVE A CARD. Saving a card replaces the renter's card on file — the
 * card their rent and agreed charges go on — so it takes proof, one of:
 *   • the business's team, signed in and allowed to take payments;
 *   • the owner's signed link, opened by the renter (it stops working after 7
 *     days, and once a card has been saved with it);
 *   • the renter, signed in to their own portal (the staff portal's sign-in,
 *     or the guest portal's session, as /api/portal/renter keeps it).
 * Stripe's page sends the renter back with its setup's id; the card is stored
 * only when that setup was started here with one of those, for this business,
 * this renter and their Stripe customer. A link sent before this check existed
 * is told to ask the studio for a new one.
 *
 * PUT { tenantId, renterId, category, note?, amountCents }
 *   → one-tap incidental charge against the renter's card on file, GOVERNED
 *     BY THE STUDIO'S CAPPED POLICY (src/lib/incidentals.ts). The category
 *     must be an allowed charge type and the amount must sit under its cap —
 *     enforced HERE (server) so no made-up charges, even if the UI is bypassed.
 *     This is the SAME policy the day/hourly path and the signed lease use.
 *
 * The renter doc is the single card-on-file store. It gets populated two ways:
 * this setup flow (portal), or automatically the first time a renter pays rent
 * online (see /api/portal/renter confirm-invoice).
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveIncidentalPolicy, validateIncidental } from '@/lib/incidentals';
import { requireCan, requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';

// Ids named after what they record, so a second run of the same step finds it done.
const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const CLAIM_MS = 2 * 60000;
const freshClaim = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;
// Stripe said no (nothing moved) — as against no answer at all (it may have gone through).
const stripeRefused = (e: any) => ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));
const bearer = (req: NextRequest) => /^bearer\s+\S/i.test(req.headers.get('authorization') || '');

// ── The owner's card link ────────────────────────────────────────────────────
// Our own card page (/card-setup/{business}?r={renter}&k={signature}). The signature names the business, the renter,
// the card setup they last finished and when the link stops working (7 days), signed with the server secret the order
// pages use. Once a card is saved with it, the renter's last setup changes, so the same link no longer works.
const LINK_DAYS = 7;
const DAY = 864e5;
const linkSecret = () => String(process.env.ORDER_PASS_SECRET || process.env.CRON_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || '');
const linkSign = (text: string) => { const s = linkSecret(); return s ? createHmac('sha256', s).update(text).digest('base64url').slice(0, 32) : ''; };
function makeCardLink(tenantId: string, renterId: string, lastSetup: string, now = Date.now()): { token: string; expiresAt: string } {
  const exp = now + LINK_DAYS * DAY; const sig = linkSign(`cardlink:${tenantId}:${renterId}:${lastSetup}:${exp}`);
  return { token: sig ? `${exp}.${sig}` : '', expiresAt: new Date(exp).toISOString() };
}
function checkCardLink(tenantId: string, renterId: string, lastSetup: string, token: unknown, now = Date.now()): 'ok' | 'expired' | 'used' {
  const [x, sig] = String(token || '').split('.'); const exp = Number(x);
  const want = Number.isFinite(exp) && sig ? linkSign(`cardlink:${tenantId}:${renterId}:${lastSetup}:${exp}`) : '';
  const a = Buffer.from(want), b = Buffer.from(String(sig || ''));
  if (!want || a.length !== b.length || !timingSafeEqual(a, b)) return 'used';
  return exp < now || exp > now + LINK_DAYS * DAY + 60000 ? 'expired' : 'ok';
}
const LINK_MESSAGE = {
  expired: 'This card link has expired. Please ask the studio for a new one.',
  used: 'This card link has already been used or is out of date. Please ask the studio for a new one.',
};

// ── The other proofs ─────────────────────────────────────────────────────────
// The business's team, signed in and allowed to take payments (a renter signed in to the staff side is not the team).
async function teamMayTakePayments(req: NextRequest, tenantId: string): Promise<boolean> {
  if (!bearer(req)) return false;
  const g: any = await requireCan(req, tenantId, 'checkout.take').catch(() => ({ deny: true }));
  return !g?.deny && !!g?.actor && g.actor.isRenter !== true;
}
// The renter, signed in to their own portal: the staff portal's sign-in for a renter with a team record (their record
// is this renter's: the same id, or linked either way), or the guest portal's session (kept hashed in
// tenants/{t}/private/renterSessions by /api/portal/renter).
async function renterSignedIn(req: NextRequest, db: any, tenantId: string, renterId: string, renter: any, portalToken: unknown): Promise<boolean> {
  if (typeof portalToken === 'string' && portalToken) {
    const sessions: any = (await db.doc(`tenants/${tenantId}/private/renterSessions`).get()).data() || {};
    const entry: any = sessions[createHash('sha256').update(portalToken).digest('hex')];
    if (entry && Number(entry.expiresAt) > Date.now() && String(entry.renterId || '') === renterId) return true;
  }
  if (!bearer(req)) return false;
  const g: any = await requireRole(req, tenantId, 'staff').catch(() => ({ deny: true }));
  const me = String(g?.actor?.uid || '');
  if (g?.deny || !me) return false;
  if (me === renterId || String(renter?.linkedStaffId || '') === me) return true;
  const st: any = (await db.doc(`tenants/${tenantId}/staff/${me}`).get()).data() || {};
  return String(st.renterId || '') === renterId;
}

// Where Stripe sends them back: our own address (this one, the business's own domain, or the app's), never another
// site. Anything else falls back to the card page here.
function ownBase(req: NextRequest, tenant: any, returnUrl: unknown, tenantId: string): string {
  const here = String(req.nextUrl?.origin || '').replace(/\/+$/, '');
  const fallback = `${here}/card-setup/${tenantId}`;
  const hostOf = (v: any) => { try { return new URL(String(v || '')).host.toLowerCase(); } catch { return ''; } };
  const bare = (v: any) => String(v || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  try {
    const u = new URL(String(returnUrl || ''));
    const host = u.host.toLowerCase();
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const ours = [hostOf(here), hostOf(tenant?.publicOrigin), hostOf(process.env.NEXT_PUBLIC_APP_URL), bare(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      bare(process.env.VERCEL_URL), bare(process.env.VERCEL_BRANCH_URL), 'app.clarityflow.com'].filter(Boolean);
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || !(ours.includes(host) || local)) return fallback;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch { return fallback; }
}
const isCardPage = (base: string, tenantId: string) => { try { return new URL(base).pathname.replace(/\/+$/, '') === `/card-setup/${tenantId}`; } catch { return false; } };


// Exact Stripe fee via the charge's balance transaction. Fail-open.
async function stripeFeeFor(paymentIntentId: string | null): Promise<{ feeCents: number; chargeId: string | null }> {
  try {
    if (!paymentIntentId || !process.env.STRIPE_SECRET_KEY) return { feeCents: 0, chargeId: null };
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const pi: any = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge: any = pi?.latest_charge;
    const bt: any = charge?.balance_transaction;
    return { feeCents: Number(bt?.fee) || 0, chargeId: charge?.id || null };
  } catch { return { feeCents: 0, chargeId: null }; }
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const { tenantId, renterId, returnUrl } = body || {};
    if (!tenantId || !renterId || !ID_RE.test(String(tenantId)) || !ID_RE.test(String(renterId))) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }

    const db = getAdminDb();
    const renterSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!renterSnap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const renter = renterSnap.data() as any;
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const lastSetup = String(renter.cardSetupSessionId || '');
    const base = ownBase(req, tenant, returnUrl, String(tenantId));

    // ── The proof (see the top of this file) ──
    let how: 'staff' | 'renter' | 'link' | '' = '';
    if (body.linkToken) {
      const c = checkCardLink(String(tenantId), String(renterId), lastSetup, body.linkToken);
      if (c !== 'ok') return NextResponse.json({ ok: false, linkExpired: true, error: LINK_MESSAGE[c] }, { status: 403 });
      how = 'link';
    } else if (await teamMayTakePayments(req, String(tenantId))) how = 'staff';
    else if (await renterSignedIn(req, db, String(tenantId), String(renterId), renter, body.portalToken)) how = 'renter';
    if (!how) return NextResponse.json({ ok: false, error: 'Please sign in again, or ask the studio for a card link.' }, { status: 401 });

    // The team sending a link to the renter: our own card page, signed for them. Nothing is set up at Stripe until the
    // renter opens it, and it works for 7 days rather than Stripe's one.
    if (how === 'staff' && isCardPage(base, String(tenantId))) {
      const link = makeCardLink(String(tenantId), String(renterId), lastSetup);
      if (!link.token) return NextResponse.json({ ok: false, error: 'Card links aren’t available yet. Please try again later.' }, { status: 500 });
      return NextResponse.json({ ok: true, url: `${base}?r=${encodeURIComponent(String(renterId))}&k=${encodeURIComponent(link.token)}`, link: true, expiresAt: link.expiresAt });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    // Reuse the customer if this renter already has one (from prior day
    // bookings by email, or a prior setup).
    let customerId: string | null = renter.stripeCustomerId || null;
    if (!customerId && renter.email) {
      const existing = await stripe.customers.list({ email: renter.email, limit: 1 });
      customerId = existing.data[0]?.id || null;
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email: renter.email || undefined,
        phone: renter.phone || undefined,
        name: `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || undefined,
        metadata: { tenantId, renterId },
      });
      customerId = created.id;
    }

    // The setup's record at Stripe says how it was started (cfAuth): the return page stores a card only for one of these.
    // Closing Stripe's page from the owner's link goes back to the same link, to try again.
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      success_url: `${base}?cfCardSetup=1&cfSetupSession={CHECKOUT_SESSION_ID}&cfRenterId=${encodeURIComponent(String(renterId))}`,
      cancel_url: how === 'link' ? `${base}?r=${encodeURIComponent(String(renterId))}&k=${encodeURIComponent(String(body.linkToken))}` : base,
      metadata: { tenantId: String(tenantId), renterId: String(renterId), cfAuth: how },
    });

    await db.doc(`tenants/${tenantId}/renters/${renterId}`).set(
      { stripeCustomerId: customerId }, { merge: true });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[setup-card] POST failed', err);
    return NextResponse.json({ ok: false, error: 'Could not start card setup.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId  = searchParams.get('tenantId');
    const renterId  = searchParams.get('renterId');
    const sessionId = searchParams.get('session');
    const linkToken = searchParams.get('link');
    if (!tenantId || !renterId || (!sessionId && !linkToken) || !ID_RE.test(tenantId) || !ID_RE.test(renterId)) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }

    const db = getAdminDb();
    const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
    const snap = await renterRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const renter = snap.data() as any;

    // Studio name for the public confirmation screen (cosmetic, fail-open).
    let studioName = 'The studio';
    try {
      const t = await db.doc(`tenants/${tenantId}`).get();
      studioName = (t.data() as any)?.name || (t.data() as any)?.businessName || studioName;
    } catch { /* cosmetic */ }

    // The card page opened from the owner's link, before Stripe: is the link still good? Names only.
    if (!sessionId) {
      const c = checkCardLink(tenantId, renterId, String(renter.cardSetupSessionId || ''), linkToken);
      if (c !== 'ok') return NextResponse.json({ ok: false, linkExpired: true, error: LINK_MESSAGE[c], studioName }, { status: 403 });
      return NextResponse.json({ ok: true, studioName, renterFirstName: renter.firstName || '' });
    }

    // Idempotent: already stored for this session
    if (renter.cardSetupSessionId === sessionId && renter.cardOnFile) {
      return NextResponse.json({ ok: true, cardBrand: renter.cardBrand, cardLast4: renter.cardLast4, studioName, renterFirstName: renter.firstName || '' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const session: any = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
    // Only a setup this route started with proof, for this business, this renter and their Stripe customer. One from a
    // link sent before the proof existed is told to ask for a new link.
    const md: any = session?.metadata || {};
    const outdated = () => NextResponse.json({ ok: false, linkExpired: true, error: `This card link is out of date. Please ask ${studioName} for a new one.`, studioName }, { status: 410 });
    if (String(md.tenantId || '') !== tenantId || String(md.renterId || '') !== renterId || (session?.mode && session.mode !== 'setup')) return outdated();
    if (!['staff', 'renter', 'link'].includes(String(md.cfAuth || ''))) return outdated();
    const customer = typeof session?.customer === 'string' ? session.customer : String(session?.customer?.id || '');
    if (renter.stripeCustomerId && customer && customer !== String(renter.stripeCustomerId)) return outdated();
    const si: any = session.setup_intent;
    if (!si || si.status !== 'succeeded' || !si.payment_method) {
      return NextResponse.json({ ok: false, error: 'Card setup not completed.' }, { status: 400 });
    }

    const pmId = String(typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id || '');
    let brand = 'card', last4 = '';
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      brand = pm.card?.brand || 'card';
      last4 = pm.card?.last4 || '';
    } catch { /* summary is cosmetic */ }

    // Stored once, with the owner told once (two confirmations at once, a refresh, the renter's portal and this page).
    const at = new Date().toISOString();
    const noteRef = db.doc(`tenants/${tenantId}/notifications/cardsetup_${safeKey(sessionId)}`);
    await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(renterRef)).data() || {};
      if (cur.cardSetupSessionId === sessionId && cur.cardOnFile) return;
      tx.set(renterRef, {
        cardOnFile: true,
        stripePaymentMethodId: pmId,
        ...(customer && !cur.stripeCustomerId ? { stripeCustomerId: customer } : {}),
        cardBrand: brand,
        cardLast4: last4,
        cardSetupSessionId: sessionId,
        cardSetupAt: at,
        cardSetupVia: String(md.cfAuth),
      }, { merge: true });
      // Tell the owner — the renter usually completes this on their own phone.
      tx.set(noteRef, { id: noteRef.id, type: 'booth_reservation', read: false, createdAt: at, link: '/pos?tab=spaces',
        message: `Card on file added: ${renter.firstName || ''} ${renter.lastName || ''} (${brand} ····${last4}). Automatic rent collection is now ready.` });
    });

    return NextResponse.json({ ok: true, cardBrand: brand, cardLast4: last4, studioName, renterFirstName: renter.firstName || '' });
  } catch (err) {
    console.error('[setup-card] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not confirm card setup.' }, { status: 500 });
  }
}


// ── PUT: charge an incidental to a lease renter's card on file ───────────────
// Body: { tenantId, renterId, category, note?, amountCents, key }  (legacy: description)
// Policy-enforced (allowed type + hard cap) → off-session charge → ledger entry
// ('Renter Incidental') + paired Stripe fee. Declines return the Stripe reason
// so the owner can collect another way — the renter is never suspended.
// The business's own team only (signed in, allowed to take payments). Once per attempt: the screen names each attempt
// (key; the same charge asked again keeps it). Two taps, or a retry after a lost answer, charge once and record once:
// the attempt is claimed in one step, charged under one key, and its lines in the books are named after it. No answer
// from Stripe leaves it claimed: asking again in a couple of minutes sends the same charge, never a second.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, renterId } = body || {};
    const amountCents = Math.round(Number(body.amountCents) || 0);
    if (!tenantId || !renterId || !/^[A-Za-z0-9_-]{1,120}$/.test(String(renterId))) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid parameters.' }, { status: 400 });
    }
    const g = await requireCan(req, String(tenantId), 'checkout.take'); if (g.deny) return g.deny;
    const key = safeKey(body.key).slice(0, 100);
    if (!key) return NextResponse.json({ ok: false, error: 'Please reload the page and try the charge again.' }, { status: 400 });
    // Backstop above any per-type cap — genuinely large charges are run manually.
    if (amountCents > 100000) {
      return NextResponse.json({ ok: false, error: 'Charges over $1,000 need to be run manually.' }, { status: 400 });
    }

    const db = getAdminDb();
    const renterRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
    const snap = await renterRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });
    const renter = snap.data() as any;

    if (!renter.cardOnFile || !renter.stripeCustomerId || !renter.stripePaymentMethodId) {
      return NextResponse.json({ ok: false, error: 'No card on file — it’s saved when the renter first pays rent online, or they can add one in their portal Documents tab.' }, { status: 400 });
    }

    // ── Incidentals policy — no made-up charges. Only owner-defined charge
    // types are allowed, each capped. Enforced HERE via the shared module so it
    // stays in lockstep with the day/hourly path and the signed lease.
    const cats = resolveIncidentalPolicy((await db.doc(`tenants/${tenantId}`).get()).data());
    const v = validateIncidental(cats, String(body.category || body.description || ''), amountCents, String(body.note || ''));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });

    // ── The attempt, claimed in one step ──
    const nowIso = new Date().toISOString();
    const attemptRef = db.doc(`tenants/${tenantId}/renters/${renterId}/charges/inc_${key}`);
    const claim: any = await db.runTransaction(async (tx: any) => {
      const a: any = (await tx.get(attemptRef)).data() || null;
      if (a?.status === 'charged') return { already: true, cents: Number(a.amountCents) || 0 };
      if (a?.status === 'charging' && freshClaim(a.claimAt)) return { busy: true };
      if (a?.status === 'charging') {
        // Asked again after no answer: the same charge (its stored amount, card and wording), never a different one.
        tx.set(attemptRef, { claimAt: nowIso }, { merge: true });
        return { cents: Number(a.amountCents) || 0, pm: String(a.pm || ''), customer: String(a.customer || ''), description: String(a.description || v.description), label: String(a.category || v.category.label) };
      }
      tx.set(attemptRef, { id: attemptRef.id, status: 'charging', claimAt: nowIso, amountCents, description: v.description, category: v.category.label,
        pm: String(renter.stripePaymentMethodId), customer: String(renter.stripeCustomerId), by: g.actor?.name || null }, { merge: true });
      return { cents: amountCents, pm: String(renter.stripePaymentMethodId), customer: String(renter.stripeCustomerId), description: v.description, label: v.category.label };
    });
    if (claim.already) return NextResponse.json({ ok: true, chargedCents: claim.cents, already: true });
    if (claim.busy) return NextResponse.json({ ok: false, error: 'This charge is going through already. Give it a moment.' }, { status: 409 });
    const cents = Number(claim.cents) || 0;
    const description = String(claim.description);

    const renterName = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter';
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    let intent: any;
    try {
      intent = await stripe.paymentIntents.create({
        amount: cents,
        currency: 'usd',
        customer: claim.customer,
        payment_method: claim.pm,
        off_session: true,
        confirm: true,
        expand: ['latest_charge.balance_transaction'],
        description: `${description} — ${renterName}`,
        metadata: { tenantId, renterId, kind: 'renter_incidental', category: claim.label, attempt: key },
      }, { idempotencyKey: `renter-incidental-${safeKey(renterId)}-${key}-${safeKey(claim.pm)}` });
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Card charge failed.';
      if (stripeRefused(err)) {
        // Nothing moved: the attempt is closed and nothing is recorded.
        await attemptRef.set({ status: 'failed', claimAt: null, failedAt: new Date().toISOString(), error: String(msg).slice(0, 200) }, { merge: true });
        return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect another way; the renter is not affected.` }, { status: 402 });
      }
      return NextResponse.json({ ok: false, error: 'Stripe didn’t answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.' }, { status: 502 });
    }

    // ── Recorded once: the income line, its Stripe fee, and the renter's incidentals log, with the attempt marked ──
    const charge: any = intent?.latest_charge;
    let feeCents = Number(charge?.balance_transaction?.fee) || 0;
    let chargeId: string | null = typeof charge === 'string' ? charge : (charge?.id || null);
    if (!feeCents) { const f = await stripeFeeFor(intent.id); feeCents = f.feeCents; chargeId = chargeId || f.chargeId; }
    const txnRef = db.doc(`tenants/${tenantId}/transactions/renterinc_${safeKey(renterId)}_${key}`);
    const feeRef = db.doc(`tenants/${tenantId}/transactions/renterincfee_${safeKey(renterId)}_${key}`);
    const at = new Date().toISOString();
    const wrote = await db.runTransaction(async (tx: any) => {
      const a: any = (await tx.get(attemptRef)).data() || {};
      await tx.get(renterRef);
      if (a.status === 'charged') return false;
      tx.set(txnRef, {
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
        amount: cents / 100, category: 'Renter Incidental',
        description: `${description} — ${renterName} (card on file)`,
        clientOrVendor: renterName, date: at, paymentMethod: 'Card on file (Stripe)',
        hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId, renterId, sourceId: renterId, tenantId, createdAt: at,
      });
      // Paired Processing Fees expense for the incidental charge.
      if (feeCents > 0) tx.set(feeRef, {
        id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
        amount: feeCents / 100, category: 'Processing Fees',
        description: `Stripe fee — incidental charge (${renterName})`,
        clientOrVendor: 'Stripe', date: at, paymentMethod: 'Deducted from payout',
        hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
        renterId, relatedTxnId: txnRef.id, tenantId, createdAt: at,
      });
      // The renter's incidentals log, for their history.
      tx.set(renterRef, { incidentals: FieldValue.arrayUnion({ amountCents: cents, description, at, paymentIntentId: intent.id }), incidentalsTotalCents: FieldValue.increment(cents) }, { merge: true });
      tx.set(attemptRef, { status: 'charged', chargedAt: at, paymentIntentId: intent.id, claimAt: null }, { merge: true });
      return true;
    });
    if (!wrote) return NextResponse.json({ ok: true, chargedCents: cents, already: true });
    await logAuditAdmin(db, String(tenantId), {
      action: 'booth.renter_charged', targetType: 'renter', targetId: String(renterId),
      summary: `Incidental charged to card on file: ${renterName} — ${description} ($${(cents / 100).toFixed(2)})`,
      amount: cents / 100, actor: { type: 'user', id: g.actor?.uid || undefined, name: g.actor?.name || undefined, role: g.actor?.role || undefined },
    } as any).catch(() => {});

    return NextResponse.json({ ok: true, chargedCents: cents });
  } catch (err) {
    console.error('[setup-card] PUT failed', err);
    return NextResponse.json({ ok: false, error: 'Could not charge card.' }, { status: 500 });
  }
}
