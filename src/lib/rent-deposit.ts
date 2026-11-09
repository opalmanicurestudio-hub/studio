// src/lib/rent-deposit.ts — A RENTER'S SECURITY DEPOSIT, RECORDED ON THE SERVER.
// Everything done to a deposit by hand goes through here, from the record-payment dialog on Spaces and the deposit card
// in a renter's profile alike, so each is written the same way, once, and the renter is always told in writing:
//   received  the deposit came in (cash, check, a transfer). Held for them: in the books as held money, not income.
//   deduct    part is kept, with a reason (and photos). In the books it moves from held to kept (income).
//   refund    what's left was returned by hand. In the books it leaves held money.
//   apply     what's left goes toward what they owe instead of back to them. It becomes a credit on their account that
//             comes off their open bills now (lib/rent-credits), and in the books it moves from held to rent paid.
// Each is checked against the deposit as it stands (lib/deposit-accounting) in the same step it's written, so nothing
// can take back more than is held, and is named after the screen's request, so pressing Save twice writes it once.
// The renter's notice (Messages: "Security deposit", which can't be switched off) says what happened, and a refund or
// an applied deposit lists every deduction with its reason, the written account many states ask for.
import { depositPosition } from '@/lib/deposit-accounting';
import { invoiceOwedCents, isOpenLedgerCharge } from '@/lib/booth-rental-types';
import { billTakesCredit, creditRemainingCents } from '@/lib/rent-payment-plan';

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usd = (c: number) => `$${(Math.max(0, Math.round(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (s: any) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
const clip = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export type DepositAction = 'received' | 'deduct' | 'refund' | 'apply';
export const DEPOSIT_ACTIONS: DepositAction[] = ['received', 'deduct', 'refund', 'apply'];

export type DepositResult =
  | { ok: true; already?: boolean; lineId: string; cents: number; returnableCents: number; appliedCents?: number; sentTo: string | null }
  | { ok: false; status: number; error: string; code?: string; retry?: boolean };

/** Paid by card from the portal (recordCardDeposit): where the money is, so a refund goes back to it. */
export interface DepositCard { pi: string; account: string | null; sessionId: string }

const portalLink = async (tenant: any, tenantId: string) => {
  const { linkOrigin } = await import('@/lib/app-origin');
  const base = linkOrigin(tenant);
  return base ? `${base}/rent/${encodeURIComponent(tenantId)}?tab=rent` : '';
};

/** The renter's written notice about their deposit (Messages: "Security deposit"), and the same in their portal. */
export async function sendDepositNotice(db: any, tenantId: string, tenant: any, o: { key: string; renterId: string; what: string; headline: string; details?: string; cents: number; tone?: string }): Promise<string | null> {
  const T = `tenants/${tenantId}`; const at = new Date().toISOString();
  try {
    const aRef = db.doc(`${T}/renterAlerts/${safe(o.key)}`);
    await aRef.set({ id: aRef.id, renterId: o.renterId, kind: 'deposit', tab: 'rent', tone: o.tone || 'green', at, text: `${o.headline}${o.details ? ` ${o.details}` : ''}` });
  } catch { /* the notice still goes */ }
  try {
    const { sendRenterMoneyNotice } = await import('@/lib/account-receipts');
    return (await sendRenterMoneyNotice(db, tenantId, tenant, { kind: 'deposit_notice', renterId: o.renterId, tokens: {
      what: o.what, headline: o.headline, details: o.details || '', amount: usd(o.cents), link: await portalLink(tenant, tenantId) } })).sentTo;
  } catch (e) { console.error('[rent-deposit] notice', tenantId, o.renterId, e); return null; }
}

/** Every deduction with its reason, as a return or an applied deposit is told. */
const itemize = (collectedCents: number, deductions: { reason: string; cents: number }[]) =>
  deductions.length ? `From your ${usd(collectedCents)} deposit: ${deductions.map((d) => `${d.reason} −${usd(d.cents)}`).join('; ')}.` : '';

export async function recordDepositAction(db: any, tenantId: string, tenant: any, o: {
  action: DepositAction; leaseId: string; cents?: number; methodLabel?: string; note?: string; reason?: string; evidenceUrls?: string[];
  requestId: string; by?: string | null; today: string; sendNotice?: boolean; card?: DepositCard | null;
}): Promise<DepositResult> {
  const T = `tenants/${tenantId}`; const at = new Date().toISOString();
  const req = safe(o.requestId); const leaseId = safe(o.leaseId);
  if (!DEPOSIT_ACTIONS.includes(o.action)) return { ok: false, status: 400, error: 'What should happen to the deposit?' };
  if (req.length < 8) return { ok: false, status: 400, error: 'Refresh the page and try again.' };
  if (!leaseId) return { ok: false, status: 400, error: 'Which lease?' };
  const methodGiven = clip(o.methodLabel, 60);
  const method = methodGiven || (o.action === 'apply' ? 'Applied to balance' : 'Recorded by hand');
  const how = methodGiven ? ` (${methodGiven})` : '';
  const reason = clip(o.reason, 160); const note = clip(o.note, 300);
  const evidence = (Array.isArray(o.evidenceUrls) ? o.evidenceUrls : []).map((u) => String(u || '')).filter((u) => /^https:\/\//.test(u)).slice(0, 12);
  if (o.action === 'deduct' && !reason) return { ok: false, status: 400, error: 'Say why it’s being kept: it goes on their statement.' };

  const lineRef = db.doc(`${T}/rentLedger/dep${o.action}_${req}`);
  // A deposit received is named by its line in the books too (the line on their account may be one already waiting).
  const receivedRef = db.doc(`${T}/transactions/deposit_${req}`);
  const res: any = await db.runTransaction(async (tx: any) => {
    const [already, booked, leaseSnap, ledSnap] = await Promise.all([
      tx.get(lineRef), tx.get(receivedRef), tx.get(db.doc(`${T}/leases/${leaseId}`)), tx.get(db.collection(`${T}/rentLedger`).where('leaseId', '==', leaseId)),
    ]);
    if (already.exists) return { already: true, cents: Math.abs(n((already.data() || {}).amountCents)) };
    if (o.action === 'received' && booked.exists) return { already: true, cents: Math.round(n((booked.data() || {}).amount) * 100) };
    if (!leaseSnap.exists) return { missing: true };
    const lease: any = { id: leaseSnap.id, ...(leaseSnap.data() || {}) };
    const renterId = String(lease.renterId || '');
    const renter: any = renterId ? ((await tx.get(db.doc(`${T}/renters/${renterId}`))).data() || {}) : {};
    const booth: any = lease.boothId ? ((await tx.get(db.doc(`${T}/booths/${safe(lease.boothId)}`))).data() || {}) : {};
    // Applying it to what they owe: only up to what's owed now (bills credit can go on, and whole charges), less credit
    // already waiting.
    let owedForCredit = 0;
    if (o.action === 'apply' && renterId) {
      const [invAll, ledAll] = await Promise.all([tx.get(db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId)), tx.get(db.collection(`${T}/rentLedger`).where('renterId', '==', renterId))]);
      const invs = invAll.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })); const leds = ledAll.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      const open = invs.filter(billTakesCredit).reduce((s: number, i: any) => s + invoiceOwedCents(i), 0)
        + leds.filter((e: any) => isOpenLedgerCharge(e) && !String(e.type || '').startsWith('deposit_')).reduce((s: number, e: any) => s + n(e.amountCents), 0);
      owedForCredit = Math.max(0, open - leds.reduce((s: number, e: any) => s + creditRemainingCents(e), 0));
    }
    const ledger = ledSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const pos = depositPosition(lease, ledger);
    const who = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || renter.name || 'Renter';
    const space = booth.name || 'space';
    let cents = Math.round(n(o.cents));
    const base = { leaseId, renterId: renterId || null, boothId: lease.boothId || null, status: 'paid', note, dueDate: null, paidAt: o.today,
      stripePaymentIntentId: null, appliesToEntryIds: [], createdBy: o.by || 'owner', createdAt: at, updatedAt: at, requestId: req };
    // Paid by card: the payment and the account it's on, on the deposit's line and in the books, so a refund finds it.
    const cardFields = o.card ? { stripePaymentIntentId: o.card.pi, stripeConnectedAccountId: o.card.account, checkoutSessionId: o.card.sessionId } : {};
    // Every action writes the lease, so two at once on the same deposit never both pass the check above.
    const touchLease = (extra: Record<string, any> = {}) => tx.set(db.doc(`${T}/leases/${leaseId}`), { deposit: { lastActionAt: at, lastAction: o.action, ...extra } }, { merge: true });
    const book = (id: string, x: Record<string, any>) => tx.set(db.doc(`${T}/transactions/${id}`), { id, context: 'Business', clientOrVendor: who, date: at, createdAt: at,
      hasReceipt: false, sourceId: leaseId, tenantId, renterId: renterId || null, leaseId, ...x });

    if (o.action === 'received') {
      if (pos.collectedCents > 0) return { refused: 'This lease’s deposit is already recorded as received.', code: 'collected' };
      if (!(cents > 0)) cents = pos.agreedCents;
      if (!(cents > 0)) return { refused: 'Enter the deposit amount.' };
      // A deposit invoiced and waiting is the line that's marked paid; otherwise this is its line.
      const pending: any = ledger.find((l: any) => l.type === 'deposit_charge' && l.status !== 'paid');
      const txnId = receivedRef.id;
      if (pending) {
        // Paid by card: the line is what was actually paid (a refund to the card can never ask for more). By hand: the
        // amount the line asked for.
        if (!o.card) cents = Math.abs(n(pending.amountCents)) || cents;
        tx.set(db.doc(`${T}/rentLedger/${pending.id}`), { status: 'paid', paidAt: o.today, method, transactionId: txnId, requestId: req, updatedAt: at, ...cardFields, ...(o.card ? { amountCents: cents } : {}) }, { merge: true });
      } else tx.set(lineRef, { id: lineRef.id, ...base, type: 'deposit_charge', amountCents: cents, description: 'Deposit collected', method, evidenceUrls: [], transactionId: txnId, ...cardFields });
      // Held for them, not earned: 'transfer' keeps it out of income while it's in the books.
      book(txnId, { type: 'income', taxBucket: 'transfer', source: 'booth_rent', category: 'Booth Deposit', amount: cents / 100, paymentMethod: method,
        description: `Security deposit — ${space} (${who})${note ? ` · ${note}` : ''}`, ...cardFields });
      touchLease({ collectedLedgerEntryId: txnId, collectedAt: at, collectedMethod: method, collectedCents: cents, ...(o.card ? { stripePaymentIntentId: o.card.pi, stripeAccount: o.card.account } : {}) });
      return { renterId, who, space, cents, lease, pos, returnable: cents, lineId: pending ? pending.id : lineRef.id };
    }

    if (!['held', 'partly_returned'].includes(pos.status)) return { refused: pos.status === 'not_collected' ? 'The deposit hasn’t been recorded as received yet.' : 'There’s no deposit held for this lease.' };
    const left = pos.returnableCents;
    if (!(cents > 0)) cents = o.action === 'deduct' ? 0 : left;
    if (!(cents > 0)) return { refused: 'Enter an amount.' };
    if (cents > left) return { refused: `Only ${usd(left)} of the deposit is left to ${o.action === 'deduct' ? 'keep' : o.action === 'refund' ? 'return' : 'apply'}.` };
    if (o.action === 'apply') {
      if (owedForCredit <= 0) return { refused: 'Nothing is owed right now, so there’s nothing to apply it to.' };
      cents = Math.min(cents, owedForCredit);   // the rest stays held
    }

    if (o.action === 'deduct') {
      tx.set(lineRef, { id: lineRef.id, ...base, type: 'deposit_deduction', amountCents: cents, description: reason, evidenceUrls: evidence, method: null });
      // Kept, so it's earned: out of held money, into income.
      book(`depheld_${req}`, { type: 'expense', taxBucket: 'transfer', category: 'Booth Deposit', amount: cents / 100, paymentMethod: 'Kept from deposit', description: `Security deposit kept — ${reason} (${who})` });
      book(`depkept_${req}`, { type: 'income', taxBucket: 'revenue', category: 'Deposit Kept', amount: cents / 100, paymentMethod: 'Kept from deposit', description: `Kept from security deposit — ${reason} (${who}, ${space})` });
    } else if (o.action === 'refund') {
      tx.set(lineRef, { id: lineRef.id, ...base, type: 'deposit_refund', amountCents: -cents, description: 'Deposit refunded', method, evidenceUrls: [] });
      book(`deprefund_${req}`, { type: 'expense', taxBucket: 'transfer', category: 'Booth Deposit', amount: cents / 100, paymentMethod: method, description: `Security deposit returned — ${space} (${who})` });
    } else {
      // Applied to what they owe: a credit that comes off their open bills (lib/rent-credits), and rent paid in the books.
      tx.set(lineRef, { id: lineRef.id, ...base, type: 'deposit_forfeit', amountCents: -cents, appliedCents: 0, description: 'Security deposit applied to balance', method: 'forfeit', evidenceUrls: [] });
      book(`depheld_${req}`, { type: 'expense', taxBucket: 'transfer', category: 'Booth Deposit', amount: cents / 100, paymentMethod: 'Applied to balance', description: `Security deposit applied to what's owed (${who})` });
      book(`depapplied_${req}`, { type: 'income', taxBucket: 'revenue', source: 'booth_rent', category: 'Booth Rent', amount: cents / 100, paymentMethod: 'Security deposit', description: `Rent — paid from security deposit (${who}, ${space})` });
    }
    touchLease();
    return { renterId, who, space, cents, lease, pos, returnable: left - cents, lineId: lineRef.id };
  });

  if (res.missing) return { ok: false, status: 404, error: 'That lease wasn’t found.' };
  if (res.refused) return { ok: false, status: 409, error: res.refused, ...(res.code ? { code: res.code } : {}) };
  if (res.already) return { ok: true, already: true, lineId: lineRef.id, cents: res.cents, returnableCents: 0, sentTo: null };

  const { renterId, who, space, cents, pos } = res;
  try {
    const { logAuditAdmin } = await import('@/lib/audit');
    const verb = o.action === 'received' ? `Recorded a ${usd(cents)} security deposit received (${method}) from` : o.action === 'deduct' ? `Kept ${usd(cents)} of the security deposit (${reason}) from`
      : o.action === 'refund' ? `Recorded ${usd(cents)} of the security deposit returned (${method}) to` : `Applied ${usd(cents)} of the security deposit to what’s owed by`;
    await logAuditAdmin(db, tenantId, { action: `booth.deposit_${o.action}`, targetType: 'lease', targetId: leaseId, summary: `${verb} ${who} (${space})`, amount: cents / 100, actor: { type: 'user', name: o.by || 'Staff' } } as any);
  } catch { /* recorded either way */ }

  // Applied to their balance: it comes off their open bills now, not at the next new bill.
  let appliedCents = 0;
  if (o.action === 'apply' && renterId) {
    try {
      const { applyCreditsToOpenBills } = await import('@/lib/rent-credits'); await applyCreditsToOpenBills(db, tenantId, renterId, at);
      // What of this deposit went on (other credit waiting may have gone on first).
      appliedCents = n(((await lineRef.get()).data() || {}).appliedCents);
    } catch (e) { console.error('[rent-deposit] apply credit', tenantId, renterId, e); }
  }

  // The renter's notice: what happened, and on a refund or an applied deposit, every deduction with its reason.
  let sentTo: string | null = null;
  if (renterId && o.sendNotice !== false) {
    const deductions = [...pos.deductions, ...(o.action === 'deduct' ? [{ reason, cents, at: o.today }] : [])];
    const collected = o.action === 'received' ? cents : pos.collectedCents;
    const headline = o.action === 'received' ? `We received your ${usd(cents)} security deposit${how}. It’s held for you, not spent, and is returned as your rental agreement sets out.`
      : o.action === 'deduct' ? `We kept ${usd(cents)} of your security deposit: ${reason}.${evidence.length ? ' Photos are on your account.' : ''}`
      : o.action === 'refund' ? `We returned ${usd(cents)} of your security deposit${how}.`
      : `We applied ${usd(cents)} of your security deposit to what you owe${appliedCents > 0 ? `; ${usd(appliedCents)} of it has paid ${appliedCents >= cents ? 'what was open' : 'part of what’s open'} already` : ''}.${res.returnable > 0 ? ` ${usd(res.returnable)} of your deposit is still held.` : ''}`;
    const details = [o.action === 'received' ? '' : itemize(collected, deductions), o.action === 'deduct' ? `${usd(res.returnable)} of your deposit is still held.` : ''].filter(Boolean).join(' ');
    const what = o.action === 'received' ? 'received' : o.action === 'deduct' ? 'part kept' : o.action === 'refund' ? 'returned' : 'applied to your balance';
    sentTo = await sendDepositNotice(db, tenantId, tenant, { key: `deposit_${o.action}_${req}`, renterId, what, headline, details, cents, tone: o.action === 'deduct' ? 'amber' : 'green' });
  }
  return { ok: true, lineId: res.lineId || lineRef.id, cents, returnableCents: res.returnable, appliedCents, sentTo };
}

// ── Paid by card ─────────────────────────────────────────────────────────────────────────────────────────────────
// A renter can pay their deposit from the portal (api/portal/renter, pay-deposit), on the business's own account. The
// payment page is recorded once, whichever comes first, their return to the portal or Stripe's notice
// (lib/connect-webhook); both name it after the page. A deposit recorded by hand in the meantime makes the card payment
// one too many: it goes straight back to the card, and the renter and the owners are told.
// A deposit paid by card is returned to the same card (refundDepositToCard): claimed on the deposit first (the line
// counts as returned while it's on its way, so nothing can be returned twice), sent under one key per request, and
// recorded once (finishDepositCardRefund), by the screen, Stripe's notice, or the five-minute check for one nobody
// finished (lib/money-sweep). One made in the Stripe Dashboard is recorded on the deposit too.

const sid = (s: any) => String(s || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 72);
const cardWords = (c: any) => (c?.last4 ? `${c.brand ? `${String(c.brand).charAt(0).toUpperCase()}${String(c.brand).slice(1)} ` : 'card '}ending ${c.last4}` : 'your card');

export type CardDepositResult = { ok: true; already?: boolean; cents: number; sentTo?: string | null } | { ok: false; extra?: boolean; refunded?: boolean; error: string };

/** A deposit payment page that was paid: recorded once, or, when the deposit was already recorded, sent back. */
export async function recordCardDeposit(db: any, stripe: any, tenantId: string, tenant: any, leaseId: string, cs: any, o: { account: string | null; today: string }): Promise<CardDepositResult> {
  const { onAccount } = await import('@/lib/space-stripe');
  const pi = typeof cs?.payment_intent === 'string' ? cs.payment_intent : cs?.payment_intent?.id || '';
  const cents = Math.round(n(cs?.amount_total));
  if (cs?.payment_status !== 'paid' || !pi || !(cents > 0)) return { ok: false, error: 'This payment hasn’t gone through.' };
  if (String(cs?.metadata?.leaseId || '') !== leaseId || String(cs?.metadata?.tenantId || '') !== tenantId) return { ok: false, error: 'That payment isn’t for this deposit.' };
  const req = `cs_${sid(cs.id)}`;
  const r = await recordDepositAction(db, tenantId, tenant, { action: 'received', leaseId, cents, methodLabel: 'Card, paid online', requestId: req, by: 'Renter (portal)', today: o.today,
    card: { pi, account: o.account, sessionId: String(cs.id) } });
  if (r.ok) return { ok: true, already: r.already, cents: r.cents, sentTo: r.sentTo };
  if (!('code' in r) || r.code !== 'collected') return { ok: false, error: r.error };
  // Already recorded (paid by hand while the page was open): this payment goes back, once. Claimed on the lease first,
  // so the portal and Stripe's notice arriving together send it back, and tell everyone, once.
  const T = `tenants/${tenantId}`; const leaseRef = db.doc(`${T}/leases/${safe(leaseId)}`);
  const claimAt = new Date().toISOString();
  const mine: any = await db.runTransaction(async (tx: any) => {
    const l: any = (await tx.get(leaseRef)).data() || {};
    const e: any = l.deposit?.extraPayments?.[req] || null;
    if (e?.refundedAt) return { done: true, lease: l };
    if (e?.claimAt && Date.now() - (Date.parse(String(e.claimAt)) || 0) < 10 * 60000) return { busy: true, lease: l };
    tx.set(leaseRef, { deposit: { extraPayments: { [req]: { cents, pi, claimAt } } } }, { merge: true });
    return { lease: l };
  });
  const lease: any = mine.lease || {};
  if (mine.done || mine.busy) return { ok: false, extra: true, refunded: !!mine.done, error: mine.done ? 'Your deposit was already paid, so this payment was refunded to your card.' : 'Your deposit was already paid, so this payment is being refunded to your card.' };
  let refunded = false;
  try {
    await stripe.refunds.create({ payment_intent: pi, metadata: { tenantId, leaseId, kind: 'deposit_extra', origin: 'app' } }, onAccount({ stripeAccountId: o.account }, { idempotencyKey: `deposit-extra-${sid(cs.id)}` }));
    refunded = true;
  } catch (e) { console.error('[rent-deposit] extra refund', tenantId, leaseId, e); }
  await leaseRef.set({ deposit: { extraPayments: { [req]: { cents, pi, at: new Date().toISOString(), ...(refunded ? { refundedAt: new Date().toISOString() } : { refundError: true }) } } } }, { merge: true });
  if (!refunded) {
    // Not sent back: the next ask tries again (the key keeps it to one refund); the owners are told now.
    await leaseRef.set({ deposit: { extraPayments: { [req]: { claimAt: null } } } }, { merge: true }).catch(() => {});
  }
  try {
    const nRef = db.doc(`${T}/notifications/depositextra_${req}`);
    await nRef.set({ id: nRef.id, userId: null, read: false, createdAt: new Date().toISOString(), type: 'booth_deposit', link: '/booths',
      message: refunded ? `A renter paid their ${usd(cents)} security deposit online after it was already recorded, so the online payment was refunded to their card.`
        : `A renter paid their ${usd(cents)} security deposit online after it was already recorded, and the refund didn’t go through. Refund it in your Stripe payments.` });
  } catch { /* told on the screen either way */ }
  if (refunded && lease.renterId) {
    await sendDepositNotice(db, tenantId, tenant, { key: `depositextra_${req}`, renterId: String(lease.renterId), what: 'payment refunded', cents,
      headline: `Your security deposit was already paid, so the ${usd(cents)} you just paid online was refunded to your card. It usually shows within 5 to 10 business days.` });
  }
  return { ok: false, extra: true, refunded, error: refunded ? 'Your deposit was already paid, so this payment was refunded to your card.' : 'Your deposit was already paid. The business has been told to refund this payment.' };
}

/** A deposit refund to the card that went through, recorded once: the line goes from on its way to returned, and it
 *  leaves held money in the books. Returns what the renter is told (null when it was recorded already). */
export async function finishDepositCardRefund(db: any, tenantId: string, x: { leaseId: string; requestId: string; refundId: string; card?: any }): Promise<{ renterId: string; cents: number; card: any; collected: number; deductions: any[]; returnable: number } | null> {
  const T = `tenants/${tenantId}`; const at = new Date().toISOString();
  const req = safe(x.requestId); const leaseId = safe(x.leaseId);
  const lineRef = db.doc(`${T}/rentLedger/deprefund_${req}`);
  return db.runTransaction(async (tx: any) => {
    const [ls, leaseSnap, ledSnap] = await Promise.all([tx.get(lineRef), tx.get(db.doc(`${T}/leases/${leaseId}`)), tx.get(db.collection(`${T}/rentLedger`).where('leaseId', '==', leaseId))]);
    const line: any = ls.data() || null;
    if (!line || line.status !== 'refunding') return null;
    const lease: any = { id: leaseId, ...(leaseSnap.data() || {}) };
    const renter: any = lease.renterId ? ((await tx.get(db.doc(`${T}/renters/${safe(lease.renterId)}`))).data() || {}) : {};
    const cents = Math.abs(n(line.amountCents));
    const card = x.card || line.card || null;
    tx.set(lineRef, { status: 'paid', paidAt: at.slice(0, 10), stripeRefundId: String(x.refundId), updatedAt: at, ...(card ? { card } : {}) }, { merge: true });
    const who = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter';
    tx.set(db.doc(`${T}/transactions/deprefund_${req}`), { id: `deprefund_${req}`, type: 'expense', taxBucket: 'transfer', category: 'Booth Deposit', context: 'Business', amount: cents / 100,
      paymentMethod: 'Card (Stripe refund)', description: `Security deposit returned to card — ${who}`, clientOrVendor: who, date: at, createdAt: at, hasReceipt: false,
      sourceId: leaseId, leaseId, renterId: lease.renterId || null, tenantId, stripeRefundId: String(x.refundId), stripePaymentIntentId: line.stripePaymentIntentId || null });
    tx.set(db.doc(`${T}/leases/${leaseId}`), { deposit: { lastActionAt: at, lastAction: 'refund' } }, { merge: true });
    const ledger = ledSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const pos = depositPosition(lease, ledger);
    return { renterId: String(lease.renterId || ''), cents, card, collected: pos.collectedCents, deductions: pos.deductions, returnable: pos.returnableCents };
  });
}

async function tellCardRefund(db: any, tenantId: string, tenant: any, req: string, f: { renterId: string; cents: number; card: any; collected: number; deductions: any[]; returnable: number }) {
  if (!f.renterId) return null;
  return sendDepositNotice(db, tenantId, tenant, { key: `deposit_cardrefund_${req}`, renterId: f.renterId, what: 'returned', cents: f.cents,
    headline: `We returned ${usd(f.cents)} of your security deposit to ${cardWords(f.card)}. It usually shows within 5 to 10 business days.`,
    details: [itemize(f.collected, f.deductions), f.returnable > 0 ? `${usd(f.returnable)} of your deposit is still held.` : ''].filter(Boolean).join(' ') });
}

/** Return part or all of a deposit paid by card to that card. */
export async function refundDepositToCard(db: any, stripe: any, tenantId: string, tenant: any, o: { leaseId: string; cents?: number; requestId: string; by?: string | null; today: string }): Promise<DepositResult> {
  const { onAccount } = await import('@/lib/space-stripe');
  const { stripeRefused } = await import('@/lib/stripe-said-no');
  const T = `tenants/${tenantId}`; const at = new Date().toISOString();
  const req = safe(o.requestId); const leaseId = safe(o.leaseId);
  if (req.length < 8) return { ok: false, status: 400, error: 'Refresh the page and try again.' };
  const lineRef = db.doc(`${T}/rentLedger/deprefund_${req}`);
  // Claimed on the deposit: the line counts as returned while it's on its way.
  const claim: any = await db.runTransaction(async (tx: any) => {
    const [ls, leaseSnap, ledSnap] = await Promise.all([tx.get(lineRef), tx.get(db.doc(`${T}/leases/${leaseId}`)), tx.get(db.collection(`${T}/rentLedger`).where('leaseId', '==', leaseId))]);
    if (!leaseSnap.exists) return { missing: true };
    const line: any = ls.data() || null;
    if (line && String(line.leaseId || '') !== leaseId) return { refused: 'Refresh the page and try again.' };
    if (line?.status === 'paid') return { already: true, cents: Math.abs(n(line.amountCents)) };
    if (line?.status === 'refunding') {
      if (o.cents && Math.round(n(o.cents)) !== Math.abs(n(line.amountCents))) return { refused: `This refund was already started for ${usd(Math.abs(n(line.amountCents)))}. Close it and start again to return a different amount.` };
      // Asked again: stamped, so the five-minute check never lets go of it while this ask is with Stripe.
      tx.set(lineRef, { retryAt: at }, { merge: true });
      return { again: true, line: { ...line, retryAt: at } };
    }
    const lease: any = { id: leaseId, ...(leaseSnap.data() || {}) };
    const ledger = ledSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const pos = depositPosition(lease, ledger);
    if (!['held', 'partly_returned'].includes(pos.status)) return { refused: 'There’s no deposit held for this lease.' };
    const paid: any = ledger.find((l: any) => l.type === 'deposit_charge' && l.status === 'paid' && l.stripePaymentIntentId);
    if (!paid) return { refused: 'This deposit wasn’t paid by card here, so it can’t go back to a card. Record how you returned it instead.' };
    const left = pos.returnableCents;
    let cents = Math.round(n(o.cents)); if (!(cents > 0)) cents = left;
    if (!(cents > 0)) return { refused: 'Nothing is left to return.' };
    if (cents > left) return { refused: `Only ${usd(left)} of the deposit is left to return.` };
    const l = { id: lineRef.id, leaseId, renterId: lease.renterId || null, boothId: lease.boothId || null, type: 'deposit_refund', status: 'refunding', amountCents: -cents,
      description: 'Deposit refunded to card', method: 'Card refund', note: '', dueDate: null, paidAt: null, evidenceUrls: [], appliesToEntryIds: [],
      stripePaymentIntentId: paid.stripePaymentIntentId, stripeConnectedAccountId: paid.stripeConnectedAccountId || null, requestId: req,
      createdBy: o.by || 'owner', createdAt: at, updatedAt: at };
    tx.set(lineRef, l);
    tx.set(db.doc(`${T}/leases/${leaseId}`), { deposit: { lastActionAt: at, lastAction: 'refund' } }, { merge: true });
    return { line: l };
  });
  if (claim.missing) return { ok: false, status: 404, error: 'That lease wasn’t found.' };
  if (claim.refused) return { ok: false, status: 409, error: claim.refused };
  if (claim.already) return { ok: true, already: true, lineId: lineRef.id, cents: claim.cents, returnableCents: 0, sentTo: null };
  const line = claim.line; const cents = Math.abs(n(line.amountCents));
  const release = () => db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(lineRef)).data() || null; if (cur?.status === 'refunding') tx.delete(lineRef); }).catch(() => {});
  let rf: any;
  try {
    rf = await stripe.refunds.create({ payment_intent: String(line.stripePaymentIntentId), amount: cents, reason: 'requested_by_customer',
      metadata: { tenantId, leaseId, kind: 'deposit_refund', origin: 'app', requestId: req } },
    onAccount({ stripeAccountId: line.stripeConnectedAccountId || null }, { idempotencyKey: `deposit-refund-${leaseId}-${req}` }));
  } catch (e: any) {
    if (stripeRefused(e)) { await release(); return { ok: false, status: 400, error: `Stripe didn’t refund it: ${String(e?.raw?.message || e?.message || 'the refund was refused').slice(0, 200)}` }; }
    return { ok: false, status: 502, retry: true, error: 'Stripe didn’t answer, so the refund may or may not have gone through. Press Refund again in a couple of minutes: it won’t refund twice.' };
  }
  if (['failed', 'canceled'].includes(String(rf?.status || ''))) { await release(); return { ok: false, status: 400, error: 'Stripe couldn’t send this refund to the card. Nothing was refunded.' }; }
  let card: any = null;
  try { const ch: any = (await stripe.paymentIntents.retrieve(String(line.stripePaymentIntentId), { expand: ['latest_charge'] }, onAccount({ stripeAccountId: line.stripeConnectedAccountId || null })))?.latest_charge; card = ch?.payment_method_details?.card ? { brand: ch.payment_method_details.card.brand || null, last4: ch.payment_method_details.card.last4 || null } : null; } catch { card = null; }
  let f: any = null;
  try { f = await finishDepositCardRefund(db, tenantId, { leaseId, requestId: req, refundId: String(rf.id), card }); }
  catch (e) { console.error('[rent-deposit] finish card refund', tenantId, leaseId, e); }
  let sentTo: string | null = null;
  if (f) {
    try { const { logAuditAdmin } = await import('@/lib/audit'); await logAuditAdmin(db, tenantId, { action: 'booth.deposit_refund', targetType: 'lease', targetId: leaseId, summary: `Returned ${usd(cents)} of the security deposit to ${cardWords(card)}`, amount: cents / 100, actor: { type: 'user', name: o.by || 'Staff' } } as any); } catch { /* recorded */ }
    sentTo = await tellCardRefund(db, tenantId, tenant, req, f);
  }
  return { ok: true, lineId: lineRef.id, cents, returnableCents: f?.returnable ?? 0, sentTo };
}

/** The five-minute check (lib/money-sweep): deposit refunds to a card nobody finished. Found at Stripe, recorded; not
 *  found, let go, so the deposit can be returned again. */
export async function settleStuckSecurityDepositRefunds(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const now = o.now ?? Date.now();
  const T = `tenants/${tenantId}`;
  const snap = await db.collection(`${T}/rentLedger`).where('status', '==', 'refunding').limit(50).get().catch(() => ({ docs: [] as any[] }));
  // Stale: nothing asked of it (created, or asked again) in the last quarter hour.
  const lastAsked = (l: any) => Math.max(Date.parse(String(l.createdAt || '')) || 0, Date.parse(String(l.retryAt || '')) || 0);
  const stale = snap.docs.filter((d: any) => { const l: any = d.data() || {}; return l.type === 'deposit_refund' && now - lastAsked(l) >= 15 * 60000; });
  if (!stale.length) return out;
  const { onAccount } = await import('@/lib/space-stripe');
  let stripe = o.stripe;
  if (!stripe) { const S = (await import('stripe')).default; stripe = new S(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }); }
  for (const d of stale) {
    out.checked++;
    const l: any = d.data() || {};
    try {
      const list: any = await stripe.refunds.list({ payment_intent: String(l.stripePaymentIntentId), limit: 100 }, onAccount({ stripeAccountId: l.stripeConnectedAccountId || null }));
      const rf = (list?.data || []).find((r: any) => String(r?.metadata?.requestId || '') === String(l.requestId) && !['failed', 'canceled'].includes(String(r?.status || '')));
      if (rf) {
        const f = await finishDepositCardRefund(db, tenantId, { leaseId: String(l.leaseId), requestId: String(l.requestId), refundId: String(rf.id) });
        if (f) await tellCardRefund(db, tenantId, tenant, String(l.requestId), f);
        out.recorded++;
      } else {
        // Let go only if nobody asked again since it was looked up.
        const gone = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(d.ref)).data() || null; if (cur?.status !== 'refunding' || String(cur.retryAt || '') !== String(l.retryAt || '')) return false; tx.delete(d.ref); return true; });
        if (gone) out.released++;
      }
    } catch (e: any) { out.waiting++; console.error('[rent-deposit] settle', tenantId, d.id, String(e?.message || e).slice(0, 160)); }
  }
  return out;
}

/** A refund to the card the app asked for whose claim is gone: written from Stripe's refund, once. */
async function recoverDepositRefund(db: any, tenantId: string, x: { leaseId: string; requestId: string; rf: any; card: any; pi: string | null }) {
  const T = `tenants/${tenantId}`; const at = new Date().toISOString();
  const cents = Math.round(n(x.rf?.amount)); if (!(cents > 0)) return null;
  const lineRef = db.doc(`${T}/rentLedger/deprefund_${x.requestId}`);
  return db.runTransaction(async (tx: any) => {
    const [ls, leaseSnap, ledSnap] = await Promise.all([tx.get(lineRef), tx.get(db.doc(`${T}/leases/${x.leaseId}`)), tx.get(db.collection(`${T}/rentLedger`).where('leaseId', '==', x.leaseId))]);
    if (ls.exists || !leaseSnap.exists) return null;
    const lease: any = { id: x.leaseId, ...(leaseSnap.data() || {}) };
    const renter: any = lease.renterId ? ((await tx.get(db.doc(`${T}/renters/${safe(lease.renterId)}`))).data() || {}) : {};
    const who = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter';
    const line = { id: lineRef.id, leaseId: x.leaseId, renterId: lease.renterId || null, boothId: lease.boothId || null, type: 'deposit_refund', status: 'paid', amountCents: -cents,
      description: 'Deposit refunded to card', method: 'Card refund', note: '', dueDate: null, paidAt: at.slice(0, 10), evidenceUrls: [], appliesToEntryIds: [],
      stripePaymentIntentId: x.pi, stripeRefundId: String(x.rf.id), requestId: x.requestId, ...(x.card ? { card: x.card } : {}), createdBy: 'owner', createdAt: at, updatedAt: at };
    tx.set(lineRef, line);
    tx.set(db.doc(`${T}/transactions/deprefund_${x.requestId}`), { id: `deprefund_${x.requestId}`, type: 'expense', taxBucket: 'transfer', category: 'Booth Deposit', context: 'Business', amount: cents / 100,
      paymentMethod: 'Card (Stripe refund)', description: `Security deposit returned to card — ${who}`, clientOrVendor: who, date: at, createdAt: at, hasReceipt: false,
      sourceId: x.leaseId, leaseId: x.leaseId, renterId: lease.renterId || null, tenantId, stripeRefundId: String(x.rf.id), stripePaymentIntentId: x.pi });
    tx.set(db.doc(`${T}/leases/${x.leaseId}`), { deposit: { lastActionAt: at, lastAction: 'refund' } }, { merge: true });
    const pos = depositPosition(lease, [...ledSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), line]);
    return { renterId: String(lease.renterId || ''), cents, card: x.card, collected: pos.collectedCents, deductions: pos.deductions, returnable: pos.returnableCents };
  });
}

/** Stripe's notice of a refund on a deposit paid by card (lib/connect-webhook). The app's own is recorded if the screen
 *  never heard back; one made in the Stripe Dashboard is recorded on the deposit as returned. The renter is told. Returns
 *  who it was for, for the owners' note and the books line. Throws when it can't be written, so Stripe asks again. */
export async function noticeDepositRefund(db: any, tenantId: string, tenant: any, charge: any, rf: any, meta: any, o: { outside: boolean }): Promise<{ renterId: string | null; name: string | null; leaseId: string; skipBooks?: boolean } | null> {
  const T = `tenants/${tenantId}`;
  if (!rf?.id || ['failed', 'canceled'].includes(String(rf.status || ''))) return null;
  const md = rf.metadata || {};
  const leaseId = safe(md.leaseId || meta?.leaseId || '');
  if (!leaseId) return null;
  const card = charge?.payment_method_details?.card ? { brand: charge.payment_method_details.card.brand || null, last4: charge.payment_method_details.card.last4 || null } : null;
  const chargePi = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id || null;
  if (md.kind === 'deposit_refund' && md.requestId) {
    const req = safe(md.requestId);
    let f = await finishDepositCardRefund(db, tenantId, { leaseId, requestId: req, refundId: String(rf.id), card });
    // The money went back but the claim was let go before it was recorded (it can't be, any more, but recorded anyway):
    // written now from Stripe's refund, once.
    if (!f) f = await recoverDepositRefund(db, tenantId, { leaseId, requestId: req, rf, card, pi: chargePi });
    if (f) await tellCardRefund(db, tenantId, tenant, req, f);
  } else if (o.outside) {
    const cents = Math.round(n(rf.amount)); if (!(cents > 0)) return null;
    // Only a refund of the deposit itself. A second payment made after the deposit was recorded (sent back, or to be
    // sent back) was never held or booked: it's marked settled, and nothing else is written.
    const leaseNow: any = (await db.doc(`${T}/leases/${leaseId}`).get()).data() || {};
    const depLines = (await db.collection(`${T}/rentLedger`).where('leaseId', '==', leaseId).get()).docs.map((d: any) => d.data() || {});
    const depositPi = depLines.find((l: any) => l.type === 'deposit_charge' && l.status === 'paid' && l.stripePaymentIntentId)?.stripePaymentIntentId || leaseNow.deposit?.stripePaymentIntentId || null;
    if (!chargePi || chargePi !== depositPi) {
      const extra = Object.entries(leaseNow.deposit?.extraPayments || {}).find(([, e]: any) => e?.pi === chargePi);
      if (extra) await db.doc(`${T}/leases/${leaseId}`).set({ deposit: { extraPayments: { [extra[0]]: { refundedAt: new Date().toISOString(), refundedOutside: true } } } }, { merge: true });
      return { renterId: leaseNow.renterId || null, name: null, leaseId, skipBooks: true };
    }
    const req = `out_${safe(rf.id)}`; const lineRef = db.doc(`${T}/rentLedger/deprefund_${req}`);
    const at = new Date().toISOString();
    const wrote = await db.runTransaction(async (tx: any) => {
      const [ls, leaseSnap] = await Promise.all([tx.get(lineRef), tx.get(db.doc(`${T}/leases/${leaseId}`))]);
      if (ls.exists || !leaseSnap.exists) return false;
      const lease: any = leaseSnap.data() || {};
      // Its line in the books is lib/outside-refund's (as held money going out); here it's marked returned.
      tx.set(lineRef, { id: lineRef.id, leaseId, renterId: lease.renterId || null, boothId: lease.boothId || null, type: 'deposit_refund', status: 'paid', amountCents: -cents,
        description: 'Deposit refunded to card (in Stripe)', method: 'Card refund', note: 'Refunded in the Stripe Dashboard', dueDate: null, paidAt: at.slice(0, 10), evidenceUrls: [], appliesToEntryIds: [],
        stripePaymentIntentId: typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id || null, stripeRefundId: String(rf.id), requestId: req, outsideApp: true,
        ...(card ? { card } : {}), createdBy: 'Stripe Dashboard', createdAt: at, updatedAt: at });
      tx.set(db.doc(`${T}/leases/${leaseId}`), { deposit: { lastActionAt: at, lastAction: 'refund' } }, { merge: true });
      return true;
    });
    if (wrote) {
      const lease: any = (await db.doc(`${T}/leases/${leaseId}`).get()).data() || {};
      const ledger = (await db.collection(`${T}/rentLedger`).where('leaseId', '==', leaseId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      const pos = depositPosition({ id: leaseId, ...lease }, ledger);
      await tellCardRefund(db, tenantId, tenant, req, { renterId: String(lease.renterId || ''), cents, card, collected: pos.collectedCents, deductions: pos.deductions, returnable: pos.returnableCents });
    }
  }
  const lease: any = (await db.doc(`${T}/leases/${leaseId}`).get()).data() || {};
  const r: any = lease.renterId ? ((await db.doc(`${T}/renters/${safe(lease.renterId)}`).get()).data() || {}) : {};
  return { renterId: lease.renterId || null, name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || null, leaseId };
}
