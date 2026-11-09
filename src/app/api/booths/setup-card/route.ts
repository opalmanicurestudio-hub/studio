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
 *     (the business's name and the renter's first name, nothing else).
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
 * is told to ask the business for a new one.
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
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveIncidentalPolicy, validateIncidental } from '@/lib/incidentals';
import { incidentalOpened, recordRenterIncidental, releaseRenterIncidental } from '@/lib/renter-incidentals';
import { requireCan, requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { stripeRefused as saidNo } from '@/lib/stripe-said-no';
import { spacePayAccount, onAccount, renterCardAccount, renterBusinessCard, RENTER_CARD_AGAIN } from '@/lib/space-stripe';

// Ids named after what they record, so a second run of the same step finds it done.
const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const CLAIM_MS = 2 * 60000;
const freshClaim = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;
// Stripe said no (nothing moved) — as against no answer at all (it may have gone through).
const stripeRefused = (e: any) => saidNo(e);
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
  expired: 'This card link has expired. Please ask the business for a new one.',
  used: 'This card link has already been used or is out of date. Please ask the business for a new one.',
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
    if (!how) return NextResponse.json({ ok: false, error: 'Please sign in again, or ask the business for a card link.' }, { status: 401 });
    // The card is saved on the business's own account (lib/space-stripe), so its rent and charges are paid to it.
    const payAcct = spacePayAccount(tenant);
    if (!payAcct) return NextResponse.json({ ok: false, error: 'This business isn’t set up to take cards online yet, so a card can’t be saved here. Please let the business know.' }, { status: 409 });

    // The team sending a link to the renter: our own card page, signed for them. Nothing is set up at Stripe until the
    // renter opens it, and it works for 7 days rather than Stripe's one.
    if (how === 'staff' && isCardPage(base, String(tenantId))) {
      const link = makeCardLink(String(tenantId), String(renterId), lastSetup);
      if (!link.token) return NextResponse.json({ ok: false, error: 'Card links aren’t available yet. Please try again later.' }, { status: 500 });
      return NextResponse.json({ ok: true, url: `${base}?r=${encodeURIComponent(String(renterId))}&k=${encodeURIComponent(link.token)}`, link: true, expiresAt: link.expiresAt });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    // Their customer on the business's account: the one their card is already on there, else found by email there, else
    // made. (A customer on the platform's account, from before, isn't reused.)
    let customerId: string | null = renterCardAccount(renter) === payAcct ? (renter.stripeCustomerId || null) : null;
    if (!customerId && renter.email) {
      const existing = await stripe.customers.list({ email: renter.email, limit: 1 }, { stripeAccount: payAcct });
      customerId = existing.data[0]?.id || null;
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email: renter.email || undefined,
        phone: renter.phone || undefined,
        name: `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || undefined,
        metadata: { tenantId, renterId },
        // Two setups started at once (the team and the renter, or a double tap) get the same customer, so neither comes
        // back "out of date".
      }, { stripeAccount: payAcct, idempotencyKey: `renter-card-customer-${safeKey(tenantId)}-${safeKey(renterId)}-${createHash('sha256').update(`${renter.email || ''}|${renter.phone || ''}|${renter.firstName || ''} ${renter.lastName || ''}`).digest('hex').slice(0, 16)}` });
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
    }, { stripeAccount: payAcct });

    // Kept aside until the card is saved: the card on file (and its customer) stays as it is if they never finish.
    await db.doc(`tenants/${tenantId}/renters/${renterId}`).set(
      { cardSetupCustomerId: customerId, cardSetupAccount: payAcct }, { merge: true });

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
    let studioName = 'The business';
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
    // On the account the setup was opened on (a setup opened before that was recorded: the platform's).
    const setupAcct: string | null = typeof renter.cardSetupAccount === 'string' && renter.cardSetupAccount ? renter.cardSetupAccount : null;
    // Only a setup this route started with proof, for this business, this renter and their Stripe customer. One from a
    // link sent before the proof existed (or one Stripe doesn't know on this account) is told to ask for a new link.
    const outdated = () => NextResponse.json({ ok: false, linkExpired: true, error: `This card link is out of date. Please ask ${studioName} for a new one.`, studioName }, { status: 410 });
    let session: any;
    try { session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] }, onAccount({ stripeAccountId: setupAcct })); }
    catch (e: any) { if (String(e?.code || e?.raw?.code || '') === 'resource_missing') return outdated(); throw e; }
    const md: any = session?.metadata || {};
    if (String(md.tenantId || '') !== tenantId || String(md.renterId || '') !== renterId || (session?.mode && session.mode !== 'setup')) return outdated();
    if (!['staff', 'renter', 'link'].includes(String(md.cfAuth || ''))) return outdated();
    const customer = typeof session?.customer === 'string' ? session.customer : String(session?.customer?.id || '');
    const known = [setupAcct ? renter.cardSetupCustomerId : renter.stripeCustomerId].filter(Boolean).map(String);
    if (known.length && customer && !known.includes(customer)) return outdated();
    const si: any = session.setup_intent;
    if (!si || si.status !== 'succeeded' || !si.payment_method) {
      return NextResponse.json({ ok: false, error: 'Card setup not completed.' }, { status: 400 });
    }

    const pmId = String(typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id || '');
    let brand = 'card', last4 = '';
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId, {}, onAccount({ stripeAccountId: setupAcct }));
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
        stripePaymentMethodId: pmId, defaultPaymentMethodId: pmId,
        // The card and its customer go on file together, with the account they're on (lib/space-stripe).
        ...(setupAcct
          ? { stripeCustomerId: customer || cur.cardSetupCustomerId || null, stripeCustomerAccount: setupAcct }
          : (customer && !cur.stripeCustomerId ? { stripeCustomerId: customer } : {})),
        cardBrand: brand,
        cardLast4: last4,
        cardSetupSessionId: sessionId,
        cardSetupAt: at,
        cardSetupVia: String(md.cfAuth),
        // (cardSetupCustomerId / cardSetupAccount are left: another setup started meanwhile still comes back to them.)
      }, { merge: true });
      // Tell the owner — the renter usually completes this on their own phone.
      tx.set(noteRef, { id: noteRef.id, type: 'booth_reservation', read: false, createdAt: at, link: '/pos?tab=spaces',
        message: `${`${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'A renter'} saved a card (${brand} ending ${last4}). Rent can be taken from it automatically once autopay is on.` });
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
// from Stripe leaves it claimed: asking again in a couple of minutes sends the same charge, never a second. The renter's
// record says the attempt is open until it closes, so the five-minute check settles one nobody asks about again
// (lib/renter-incidentals).
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
      return NextResponse.json({ ok: false, error: 'No card on file. It’s saved when the renter first pays rent online, or they can save one in their portal’s Rent tab.' }, { status: 400 });
    }
    const tenantDoc: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    // Charged on the business's own account, to a card saved there (lib/space-stripe); one saved before the move is
    // saved again first.
    const card = renterBusinessCard(renter, spacePayAccount(tenantDoc));

    // ── Incidentals policy — no made-up charges. Only owner-defined charge
    // types are allowed, each capped. Enforced HERE via the shared module so it
    // stays in lockstep with the day/hourly path and the signed lease.
    const cats = resolveIncidentalPolicy(tenantDoc);
    const v = validateIncidental(cats, String(body.category || body.description || ''), amountCents, String(body.note || ''));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });

    // ── The attempt, claimed in one step ──
    const nowIso = new Date().toISOString();
    const attemptRef = db.doc(`tenants/${tenantId}/renters/${renterId}/charges/inc_${key}`);
    const claim: any = await db.runTransaction(async (tx: any) => {
      const a: any = (await tx.get(attemptRef)).data() || null;
      const rNow: any = (await tx.get(renterRef)).data() || {};
      if (a?.status === 'charged') return { already: true, cents: Number(a.amountCents) || 0 };
      if (a?.status === 'charging' && freshClaim(a.claimAt)) return { busy: true };
      // A new charge needs a card this business can charge (nothing is claimed or marked open without one).
      if (a?.status !== 'charging' && !card) return { noCard: true };
      // The renter's record lists the attempt as open (lib/renter-incidentals), in the same step that claims it.
      const opened = incidentalOpened(rNow, key, nowIso);
      if (opened) tx.set(renterRef, opened, { merge: true });
      if (a?.status === 'charging') {
        // Asked again after no answer: the same charge (its stored amount, card and wording), never a different one.
        tx.set(attemptRef, { claimAt: nowIso }, { merge: true });
        return { cents: Number(a.amountCents) || 0, pm: String(a.pm || ''), customer: String(a.customer || ''), account: a.account || null, description: String(a.description || v.description), label: String(a.category || v.category.label) };
      }
      tx.set(attemptRef, { id: attemptRef.id, status: 'charging', claimAt: nowIso, amountCents, description: v.description, category: v.category.label,
        pm: card!.pm, customer: card!.customer, account: card!.account, by: g.actor?.name || null }, { merge: true });
      return { cents: amountCents, pm: card!.pm, customer: card!.customer, account: card!.account, description: v.description, label: v.category.label };
    });
    if (claim.noCard) return NextResponse.json({ ok: false, error: RENTER_CARD_AGAIN }, { status: 409 });
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
      }, onAccount({ stripeAccountId: claim.account }, { idempotencyKey: `renter-incidental-${safeKey(renterId)}-${key}-${safeKey(claim.pm)}` }));
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Card charge failed.';
      if (stripeRefused(err)) {
        // Nothing moved: the attempt is closed and nothing is recorded.
        await releaseRenterIncidental(db, String(tenantId), String(renterId), key, String(msg));
        return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect another way; the renter is not affected.` }, { status: 402 });
      }
      return NextResponse.json({ ok: false, error: 'Stripe didn’t answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.' }, { status: 502 });
    }

    // ── Recorded once (lib/renter-incidentals): the income line, its Stripe fee, and the renter's incidentals log, with the attempt marked ──
    const wrote = await recordRenterIncidental(db, String(tenantId), String(renterId), key, intent, cents, description, renterName, { stripe, account: claim.account || null });
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
