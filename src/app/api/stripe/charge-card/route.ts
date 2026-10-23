import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import Stripe from 'stripe';
import { markSalePaid, safeId, tellDeskReader, ticketBlocks } from '@/lib/reader-sale';
import { recordCardShare } from '@/lib/screen-pay';
import crypto from 'crypto';

// ── Stripe saying no vs no answer ─────────────────────────────────────────────
// A card error, a bad request, or a permission / sign-in problem means nothing moved. Anything else (no connection,
// Stripe's own error, the same charge still in progress under its key) may have gone through: it's never treated as a
// decline — no fee is put on their balance — and the caller is told to ask again, which finds the same charge.
const REFUSED = ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'];
function noAnswer(e: any): boolean {
  const code = String(e?.code || e?.raw?.code || '');
  if (code === 'idempotency_key_in_use' || String(e?.type || '') === 'StripeIdempotencyError') return true;
  return !REFUSED.includes(String(e?.type || ''));
}
const NO_ANSWER = 'Stripe didn’t answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.';
// How long one charge at the desk keeps the same charge from starting again (a double tap, a second device).
const ATTEMPT_MS = 2 * 60000;
// A charge that went through answers the same tap again for this long (its answer may have been lost on the way to
// the screen): the same payment, not a second one. After it, the same tap is a new charge (the same drink ordered again).
const DONE_REPLAY_MS = 30000;
const hash = (s: string, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);

// ─── Lazy inits ───────────────────────────────────────────────────────────────
function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO MODES controlled by the `mode` field in the request body:
//
//   mode: 'pos'      — Client IS present at checkout. Uses a PaymentIntent
//                      with a clientSecret returned to the frontend, which
//                      then confirms it using the saved payment method.
//                      This satisfies Stripe's on-session requirement and
//                      avoids authentication_required declines.
//
//   mode: 'auto'     — Client is NOT present (policy engine: no-show, late
//                      cancel; or a front-desk deposit charge with no client
//                      standing at the terminal). Uses off_session +
//                      confirm:true. On failure, the ARREARS_FEE kind parks
//                      the amount and raises a charge flag; the DEPOSIT kind
//                      does not (see `kind` below).
//
// If `mode` is omitted it defaults to 'pos' so existing POS callers work
// without any changes to CheckoutHub.
//
// ── FIX: `kind` discriminator for auto-mode failures ────────────────────────
// `mode: 'auto'` was originally written for ONE thing: charging a no-show /
// late-cancel fee for a service that already happened. On failure it calls
// flagAndPark(), which bumps the client's `outstandingBalance` and pushes a
// record into `unpaidFees` — both fields whose documented semantics (see the
// Client type) are specifically post-service arrears.
//
// QuickBookForm now also calls this route in `auto` mode to charge a
// DEPOSIT for a brand-new booking, before the appointment even exists. A
// declined deposit attempt is not arrears — nothing was owed yet, no
// service was rendered, there is no debt. Writing it into `unpaidFees`
// would silently mix "this client skipped out on a finished appointment"
// with "we tried to pre-charge a deposit and the card said no" under one
// field, with no way to tell them apart later (collections workflows,
// `autoChargeArrears`, `repeatNoShowThreshold` etc. all read this same
// field and have no business looking at failed deposit attempts).
//
// Fix: accept an optional `kind` ('deposit' | 'arrears_fee'), defaulting to
// 'arrears_fee' so every existing caller (no-show policy engine, etc.) is
// completely unaffected. Only 'arrears_fee' triggers flagAndPark on
// failure. Any other kind ('deposit', a purchase, a membership 'renewal')
// just returns { ok: false, reason, code } and lets the caller decide what
// to do (QuickBookForm falls back to a completion link; a renewal stays
// past due and is tried again the next day — never parked as a debt).
//
// ── Owed once ────────────────────────────────────────────────────────────────
// A fee that couldn't be charged goes on their balance under its own name: the
// `feeId` the caller gives, or one named after what it's for (the visit or the
// client, the amount and the category). It's parked in one step that checks
// it isn't there already, so a second declined try, a retry, or two calls at
// once add it once. A charge Stripe didn't answer is never parked (it may have
// gone through): the answer is a 502 with `unknown: true`, and asking again
// with the same key finds the same charge.
//
// ── Keys ─────────────────────────────────────────────────────────────────────
// Auto mode: the caller's `idempotencyKey` for this attempt, or one named after
// the visit (or client), the amount and the category. The key goes on the
// payment too (metadata.chargeKey), so `replay: true` — asked again long after
// an answer went missing, when Stripe may have forgotten the key — looks the
// payment up first and only charges when there is none.
// Desk mode ('pos'): one attempt at a time for the same payment (who, what for,
// how much, which card): a second tap meanwhile is told it's going through. An
// attempt Stripe didn't answer keeps its key, and the next try reuses it, so it
// is the same charge; a decline or a success ends the attempt. A screen that
// sends its own `idempotencyKey` (and keeps it across retries) gets that key.
//
// `taxBucket` ('revenue' | 'adjustment') says how the books group the line,
// for a caller whose category is an adjustment (a reschedule fee, a balance).
//
// ── Card processing fee passthrough ─────────────────────────────────────────
// `amountCents` is the FULL amount actually charged (already inclusive of any
// card-surcharge CheckoutHub calculated client-side). `surchargeAmountCents`
// is optional — when present, the ledger write is split into two separate
// transactions instead of one lump sum: the base amount under whatever
// `category` was passed (typically Service Revenue), and the surcharge
// portion under its own 'Card Processing Fee' income line. This keeps the
// fee passed to the client visible as its own number for tax reporting,
// distinct from the actual Stripe processing fee expense (which the
// connect-webhook's charge.succeeded handler records separately).
//
// ── FIX: ledger ↔ webhook linkage ────────────────────────────────────────────
// The connect-webhook's `charge.succeeded` handler attaches the Stripe
// processing fee onto the matching revenue transaction by looking it up two
// ways, in order:
//   1. transactions.checkoutSessionId === charge.metadata.checkoutSessionId
//   2. transactions.stripeChargeId    === charge.id
// This route previously satisfied NEITHER: the PaymentIntent metadata never
// carried `checkoutSessionId`, and writeLedger only stored
// `stripePaymentIntentId` (a `pi_...` id) — never `stripeChargeId` (the
// `ch_...` id the webhook event actually matches on). Every fee silently
// failed to attach. Fixed by (a) accepting an optional `checkoutSessionId`
// from the caller and forwarding it into the PaymentIntent metadata, and
// (b) resolving the actual charge id off `intent.latest_charge` and writing
// it as `stripeChargeId` on the ledger row, so the webhook's fallback match
// also works even when no checkoutSessionId is supplied.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let parsed: any = {};
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId,
    clientId,
    amountCents,
    surchargeAmountCents = 0,
    description  = 'Fee',
    category     = 'Service Revenue',
    appointmentId = null,
    reason       = 'Studio Services',
    mode         = 'pos',           // 'pos' | 'auto'
    // FIX: 'deposit' | 'arrears_fee'. Default preserves every existing
    // caller's behavior exactly (they're all arrears use cases today).
    kind         = 'arrears_fee',
    checkoutSessionId = null,       // FIX: optional, forwarded into Stripe metadata + ledger
    noLedger = false,               // a share of a split bill — the checkout records the sale itself (no lines here)
    idempotencyKey: askedKey = null, // the caller's own key for this attempt (e.g. one desk deposit charge)
    pendingId = null,               // a desk sale: its started ticket, named on the payment (lib/reader-sale)
    share = false,                  // …and this is one share of its split bill, not the whole sale
    shareLabel = null,              // the share's name ("Share 1 of 2", "Maya")
    feeId: askedFeeId = null,       // auto mode: the name a fee that can't be charged is owed under (see "Owed once")
    replay = false,                 // auto mode: an attempt asked again long after its answer went missing (see "Keys")
    taxBucket: askedBucket = null,  // 'revenue' (default) or 'adjustment'
  } = parsed;
  const forTicket = safeId(pendingId);
  // The caller's key when it gives one (letters, digits, - and _ only).
  const callerKey = typeof askedKey === 'string' ? askedKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200) : '';
  const bucket = askedBucket === 'adjustment' ? 'adjustment' : 'revenue';

  // ONLY staff of this business, or ClarityFlow's own server, may charge a
  // client's saved card. (This route used to take any caller's word for it.)
  {
    const secret = process.env.CRON_SECRET;
    const internal = !!secret && req.headers.get('x-cf-internal') === secret;
    const staff = !internal && (req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ')
      ? await verifyStaffActor(req, String(tenantId || '')).then((a: any) => !!a?.ok).catch(() => false) : false;
    if (!internal && !staff) return NextResponse.json({ ok: false, error: 'Sign in to take a card payment.', code: 'unauthorized' }, { status: 401 });
  }
  if (!tenantId || !clientId || !amountCents || amountCents <= 0) {
    return NextResponse.json(
      { error: 'Missing tenantId, clientId, or amountCents' },
      { status: 400 }
    );
  }

  const { db, FieldValue } = getAdmin();
  const amountDollars    = amountCents / 100;
  const surchargeDollars = Math.max(0, Number(surchargeAmountCents) || 0) / 100;
  const baseDollars      = Number((amountDollars - surchargeDollars).toFixed(2));
  const nowISO           = new Date().toISOString();
  // FIX: only post arrears bookkeeping (outstandingBalance / unpaidFees /
  // chargeFlags) for genuine arrears attempts. A declined deposit attempt
  // for a booking that hasn't happened yet has nothing to park.
  const isArrearsKind    = kind === 'arrears_fee';

  // ── Helper: write the ledger record(s) for a successful charge ────────────
  // Splits into a base line + a separate Card Processing Fee line when a
  // surcharge was included in the charge.
  // FIX: now takes stripeChargeId explicitly (the `ch_...` id, resolved from
  // intent.latest_charge by the caller) in addition to the PaymentIntent id,
  // and writes both onto the transaction. stripeChargeId is what the
  // connect-webhook's charge.succeeded handler matches on.
  const writeLedger = async (
    txnIdPrefix: string,
    paymentIntentId: string,
    stripeChargeId: string | null,
    clientData: any
  ) => {
    const batch = db.batch();
    const baseTxnRef = db.doc(`tenants/${tenantId}/transactions/${txnIdPrefix}`);
    batch.set(baseTxnRef, {
      id:                    txnIdPrefix,
      date:                  nowISO,
      description,
      clientOrVendor:        clientData?.name || 'Client',
      clientId,
      type:                  'income',
      context:               'Business',
      category,
      taxBucket:             bucket,
      amount:                baseDollars,
      paymentMethod:         'Card on file (Stripe)',
      appointmentId:         appointmentId || null,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId:        stripeChargeId,
      checkoutSessionId:     checkoutSessionId || null,
      hasReceipt:            true,
      tenantId,
    }, { merge: true });

    if (surchargeDollars > 0) {
      const surchargeTxnRef = db.doc(`tenants/${tenantId}/transactions/${txnIdPrefix}__surcharge`);
      batch.set(surchargeTxnRef, {
        id:                    `${txnIdPrefix}__surcharge`,
        date:                  nowISO,
        description:           'Card Processing Fee (passed to client)',
        clientOrVendor:        clientData?.name || 'Client',
        clientId,
        type:                  'income',
        context:               'Business',
        category:              'Card Processing Fee',
        taxBucket:              'revenue',
        amount:                surchargeDollars,
        paymentMethod:         'Card on file (Stripe)',
        appointmentId:         appointmentId || null,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId:        stripeChargeId,
        checkoutSessionId:     checkoutSessionId || null,
        hasReceipt:            false,
        tenantId,
      }, { merge: true });
    }

    await batch.commit();
  };

  // What the charge is for is part of the key: a deposit and a fee of the same amount for the same visit are two
  // charges, not one answered twice.
  const purpose = String(category || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

  // ── Helper: park as arrears + write flag record (auto-mode failure path) ──
  // FIX: only called for kind === 'arrears_fee' now (see call sites below).
  // Once (see "Owed once"): the fee and its flag are named after what the fee is for, and written in one step that
  // checks neither is there yet.
  const owedId = (typeof askedFeeId === 'string' ? askedFeeId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) : '')
    || `owed_${hash(`${appointmentId || clientId}|${amountCents}|${purpose}`)}`;
  // Says whether the fee is on their balance now (parked here, or by an earlier try).
  const flagAndPark = async (failReason: string, code?: string): Promise<boolean> => {
    const cRef = db.doc(`tenants/${tenantId}/clients/${clientId}`);
    const flagRef = db.doc(`tenants/${tenantId}/chargeFlags/${owedId}`);
    try {
      return await db.runTransaction(async (tx: any) => {
        const c = await tx.get(cRef); const flag = await tx.get(flagRef);
        const owed: any[] = Array.isArray(c.data()?.unpaidFees) ? c.data().unpaidFees : [];
        if (!c.exists) return false;
        if (flag.exists || owed.some((f: any) => f?.feeId === owedId)) return true;
        tx.update(cRef, {
          outstandingBalance: FieldValue.increment(amountDollars),
          unpaidFees: FieldValue.arrayUnion({
            feeId:           owedId,
            appointmentId,
            appointmentDate: nowISO,
            feeAmount:       amountDollars,
            reason:          `${reason} — auto-charge failed (${code || failReason})`,
          }),
        });
        tx.set(flagRef, {
          tenantId, clientId, appointmentId, amountDollars, feeId: owedId,
          description, category, reason, failReason, code: code || null,
          status: 'needs_attention', createdAt: nowISO,
        });
        return true;
      });
    } catch (e) {
      console.error('[charge-card] flagAndPark failed', e);
      return false;
    }
  };

  // FIX: resolve the actual charge id (`ch_...`) off a confirmed/succeeded
  // PaymentIntent. `latest_charge` is a string id unless expanded; this works
  // either way without needing to add `expand` to the create() calls below.
  const resolveChargeId = (intent: Stripe.PaymentIntent): string | null => {
    const lc: any = intent.latest_charge;
    if (!lc) return null;
    return typeof lc === 'string' ? lc : lc.id || null;
  };

  // Set the moment the card is about to be charged: anything that goes wrong after it may have charged it.
  let asked = false;
  try {
    // ── Load client ──────────────────────────────────────────────────────────
    const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
    if (!clientSnap.exists) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    const clientData = clientSnap.data();
    const card       = clientData?.cardOnFile;

    if (!card?.customerId || !card?.paymentMethodId) {
      const parked = mode === 'auto' && isArrearsKind ? await flagAndPark('no_card_on_file') : false;
      return NextResponse.json({
        ok: false,
        flagged:        mode === 'auto' && isArrearsKind,
        reason:         'No card on file',
        code:           'no_card_on_file',
        declineCode:    'no_card_on_file',
        parkedAsBalance: parked,
      });
    }

    // ── Load connected Stripe account ────────────────────────────────────────
    const tenantSnap      = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      const parked = mode === 'auto' && isArrearsKind ? await flagAndPark('no_connected_account') : false;
      return NextResponse.json({
        ok: false,
        flagged:         mode === 'auto' && isArrearsKind,
        reason:          'No connected payment account. Configure Stripe in Settings.',
        parkedAsBalance: parked,
      });
    }

    const stripe = getStripe();

    // ══════════════════════════════════════════════════════════════════════════
    // POS MODE — client is present, confirm on the frontend
    // Returns a clientSecret; CheckoutHub never reaches this path directly
    // (it uses /api/stripe/pos-payment-intent for new cards), but when
    // CheckoutHub calls THIS route for a card-on-file POS charge we create
    // an on-session intent and confirm server-side with the saved PM.
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === 'pos') {
      // A desk sale names its ticket: never charged when the sale is already paid, finished, discarded, part paid in a
      // split (unless this is a share), or has a card reader payment still going (lib/reader-sale).
      // A desk screen opened before sale payments named their ticket can't charge one (it would have no ticket to be
      // recorded on): it's reloaded first. Nothing is charged.
      if (!forTicket && noLedger === true && /^(Studio Services — POS Checkout|Share of a split bill)/.test(String(description || '')))
        return NextResponse.json({ ok: false, code: 'reload', reason: 'This screen needs reloading before it can take card payments. Reload the page; nothing was charged.', error: 'This screen needs reloading before it can take card payments. Reload the page; nothing was charged.' }, { status: 409 });
      if (forTicket) {
        const block = await ticketBlocks(db, String(tenantId), forTicket, { share: share === true, stripe, acct: stripeAccountId });
        if (block) return NextResponse.json({ ok: false, code: block.code, reason: block.error, error: block.error, ...(block.paidWith ? { paidWith: block.paidWith, paidPayload: block.paidPayload } : {}) }, { status: block.status });
      }
      // One attempt at a time for the same payment: who pays, what for, how much and on which card (two people paying
      // equal shares of one bill are two charges, not one asked twice). The attempt is claimed in one step: a second tap
      // or a second device meanwhile is told it's going through. An attempt Stripe didn't answer (or one cut off) keeps
      // its key, so the next try is the same charge. A decline ends it (a new tap really tries the card again); a charge
      // that went through answers the same tap with that payment for DONE_REPLAY_MS, then a new tap is a new charge.
      const what = hash(String(description || ''), 12);
      const attemptRef = db.doc(`tenants/${tenantId}/cardAttempts/${hash(callerKey ? `key|${callerKey}`
        : ['pos', forTicket || 'none', clientId, what, amountCents, Math.round(surchargeDollars * 100), category, appointmentId || '', checkoutSessionId || '', share === true ? `share|${shareLabel || ''}` : '', card.paymentMethodId].join('|'), 32)}`);
      const startedAt = Date.now();
      const attempt: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(attemptRef)).data() || null;
        const held = Date.parse(String(cur?.at || '')); const done = Date.parse(String(cur?.doneAt || ''));
        const replay = !!cur?.key && (cur.done ? Number.isFinite(done) && startedAt - done < DONE_REPLAY_MS : true);
        if (cur && !cur.done && !cur.unknown && Number.isFinite(held) && startedAt - held < ATTEMPT_MS) return { busy: true };
        const key = callerKey || (replay ? String(cur.key) : `pos_${forTicket || 'none'}_${clientId}_${what}_${amountCents}_${startedAt}`);
        tx.set(attemptRef, { key, at: new Date(startedAt).toISOString(), clientId, amountCents, ticket: forTicket || null, unknown: false, done: false, doneAt: null });
        return { key };
      });
      if (attempt.busy) return NextResponse.json({ ok: false, code: 'in_progress', reason: 'This card payment is going through already. Give it a moment, then check the sale.', error: 'This card payment is going through already. Give it a moment, then check the sale.' }, { status: 409 });
      const idempotencyKey: string = attempt.key;
      const ended = () => attemptRef.delete().catch(() => {});
      const charged = () => attemptRef.set({ done: true, doneAt: new Date().toISOString() }, { merge: true }).catch(() => {});
      const unanswered = async () => { await attemptRef.set({ unknown: true }, { merge: true }).catch(() => {}); return NextResponse.json({ ok: false, unknown: true, code: 'unconfirmed', reason: NO_ANSWER, error: NO_ANSWER }, { status: 502 }); };

      let intent: Stripe.PaymentIntent;
      asked = true;
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount:         amountCents,
            currency:       'usd',
            customer:       card.customerId,
            payment_method: card.paymentMethodId,
            // on_session = client is present; dramatically reduces declines
            off_session:    false,
            confirm:        true,
            // If authentication is needed this returns a requires_action status
            // with a next_action URL rather than throwing — frontend handles it.
            return_url:     `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com'}/pos`,
            description:    `${description} — ${reason}`,
            metadata: {
              tenantId,
              clientId,
              appointmentId: appointmentId || '',
              category,
              kind: 'pos_cof',
              surchargeCents: String(Math.round(surchargeDollars * 100)),
              // FIX: this is the field the connect-webhook's charge.succeeded
              // handler checks FIRST to find the matching revenue transaction.
              // Without it, the webhook fell through to a stripeChargeId
              // match that the ledger write below never satisfied either —
              // so the processing fee silently never attached.
              checkoutSessionId: checkoutSessionId || '',
              ...(forTicket ? { pendingId: forTicket, ...(share === true ? { split: '1', shareLabel: String(shareLabel || '').slice(0, 60) } : {}) } : {}),
            },
          },
          {
            stripeAccount:  stripeAccountId,
            idempotencyKey,
          }
        );
      } catch (stripeErr: any) {
        const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
        console.error('[charge-card] POS stripe error:', stripeErr?.message, code);
        if (noAnswer(stripeErr)) return unanswered();
        await ended();
        return NextResponse.json({
          ok:     false,
          reason: stripeErr?.message || 'Card charge failed',
          code,
        });
      }

      // Requires further authentication (3DS etc.) — unlikely for saved cards
      // but handle gracefully
      if (intent.status === 'requires_action') {
        await ended();
        return NextResponse.json({
          ok:              false,
          requiresAction:  true,
          clientSecret:    intent.client_secret,
          reason:          'Card requires additional authentication. Please ask the client to complete verification.',
        });
      }

      if (intent.status === 'processing') return unanswered();
      if (intent.status !== 'succeeded') {
        await ended();
        return NextResponse.json({
          ok:     false,
          reason: `Charge did not complete (status: ${intent.status})`,
          code:   intent.status,
        });
      }

      if (noLedger !== true) await writeLedger(`pos_cof__${intent.id}`, intent.id, resolveChargeId(intent), clientData);

      // The whole sale paid with the saved card: on its ticket at once, so it's never lost if the desk's save doesn't
      // happen (a manager records it from Needs attention), and never paid again. Paid another way meanwhile: this
      // payment is kept apart for a manager, and the desk is told not to save the sale with it.
      let sale: string | null = null;
      // One share of a split: on its split at once, so it's never lost if the desk's own record of it doesn't arrive
      // (and the desk's record of it changes nothing). A sale finished or paid in full meanwhile keeps it apart.
      if (forTicket && share === true) {
        try {
          sale = await recordCardShare(db, String(tenantId), forTicket, intent, { amount: amountCents / 100, tip: 0, label: shareLabel ? String(shareLabel).slice(0, 60) : null, via: 'saved_card', payerClientId: String(clientId), by: 'Saved card' }); }
        catch (e) { console.error('[charge-card] share not recorded on its ticket (the desk records it)', e); }
      }
      if (forTicket && share !== true) {
        try {
          const m = await markSalePaid(db, String(tenantId), forTicket, intent, 'card_on_file');
          sale = m.result;
          if (m.fresh && m.result === 'paid_twice') {
            const pc: any = ((await db.doc(`tenants/${tenantId}/pendingCheckouts/${forTicket}`).get()).data() as any) || {};
            await tellDeskReader(db, String(tenantId), 'paid_twice', pc, Math.round(Number((intent as any).amount_received || intent.amount) || 0), forTicket, 'card_on_file').catch(() => {});
          }
        } catch (e) { console.error('[charge-card] ticket not marked (the checkout marks it)', e); }
      }

      await charged();
      return NextResponse.json({ ok: true, paymentIntentId: intent.id, chargeId: resolveChargeId(intent), amount: amountDollars, ...(sale ? { sale } : {}) });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO MODE — client NOT present (policy engine: no-show, late-cancel;
    // OR a front-desk deposit charge per `kind: 'deposit'` — see header note)
    // ══════════════════════════════════════════════════════════════════════════
    const idempotencyKey = callerKey || `fee_${appointmentId || clientId}_${amountCents}_${purpose}`;
    const unanswered = () => NextResponse.json({ ok: false, unknown: true, flagged: false, parkedAsBalance: false, code: 'unconfirmed', reason: NO_ANSWER, error: NO_ANSWER }, { status: 502 });

    let intent: Stripe.PaymentIntent | null = null;
    // Asked again long after its answer went missing: Stripe may have forgotten the key by then, so the payment made
    // under it (it carries the key) is looked up first, and the card is only charged when there is none.
    if (replay === true && callerKey) {
      try {
        const l: any = await stripe.paymentIntents.list({ customer: card.customerId, created: { gte: Math.floor(Date.now() / 1000) - 3 * 86400 }, limit: 100 }, { stripeAccount: stripeAccountId });
        intent = (Array.isArray(l?.data) ? l.data : []).find((p: any) => String(p?.metadata?.chargeKey || '') === idempotencyKey) || null;
      } catch { return unanswered(); }
    }
    asked = true;
    if (!intent) try {
      intent = await stripe.paymentIntents.create(
        {
          amount:         amountCents,
          currency:       'usd',
          customer:       card.customerId,
          payment_method: card.paymentMethodId,
          off_session:    true,
          confirm:        true,
          description:    `${description} — ${reason}`,
          metadata: {
            tenantId,
            clientId,
            appointmentId: appointmentId || '',
            category,
            kind: 'auto_fee',
            surchargeCents: String(Math.round(surchargeDollars * 100)),
            checkoutSessionId: checkoutSessionId || '', // FIX: same linkage as pos mode
            chargeKey: idempotencyKey,                  // so a charge whose answer went missing can be found again
          },
        },
        { stripeAccount: stripeAccountId, idempotencyKey }
      );
    } catch (stripeErr: any) {
      if (noAnswer(stripeErr)) { console.error('[charge-card] no answer from Stripe', stripeErr?.type, stripeErr?.code); return unanswered(); }
      const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
      /* THE DECLINE CODE IS THE USEFUL HALF. `code` is almost always the
       * generic 'card_declined'; decline_code is what distinguishes an
       * expired card (never retry, replace it) from insufficient funds
       * (retrying later can genuinely work). Callers were only ever given
       * the generic one, so every failure looked identical to them. */
      const declineCode = stripeErr?.decline_code
        || stripeErr?.raw?.decline_code
        || stripeErr?.payment_intent?.last_payment_error?.decline_code
        || null;
      const parked = isArrearsKind ? await flagAndPark('stripe_error', declineCode || code) : false;
      return NextResponse.json({
        ok:              false,
        flagged:         isArrearsKind,
        reason:          stripeErr?.message || 'Charge failed',
        code,
        declineCode,
        parkedAsBalance: parked,
      });
    }
    if (!intent) return unanswered();

    // Still being processed: not a decline (it may yet go through), so nothing is put on their balance.
    if (intent.status === 'processing') return unanswered();
    if (intent.status !== 'succeeded') {
      const parked = isArrearsKind ? await flagAndPark('not_succeeded', intent.status) : false;
      return NextResponse.json({
        ok:              false,
        flagged:         isArrearsKind,
        reason:          `Charge ${intent.status}`,
        code:            intent.status,
        declineCode:     (intent as any)?.last_payment_error?.decline_code || null,
        parkedAsBalance: parked,
      });
    }

    // The one line in the books for this charge (named after the payment, so a retry finds it). Callers record their
    // own side of it (the membership, the package, the cancellation) — never a second income line for it.
    await writeLedger(`card_charge__${intent.id}`, intent.id, resolveChargeId(intent), clientData);

    return NextResponse.json({ ok: true, paymentIntentId: intent.id, chargeId: resolveChargeId(intent), amount: amountDollars });

  } catch (err: any) {
    console.error('[stripe/charge-card]', err);
    // Never put a fee on their balance from here: the card may have been charged before whatever went wrong.
    if (asked) return NextResponse.json({ ok: false, unknown: true, flagged: false, parkedAsBalance: false, code: 'unconfirmed', reason: NO_ANSWER, error: NO_ANSWER }, { status: 502 });
    return NextResponse.json({
      ok:              false,
      flagged:         false,
      reason:          'Something went wrong before the card was charged. Nothing was charged.',
      parkedAsBalance: false,
    }, { status: 500 });
  }
}
