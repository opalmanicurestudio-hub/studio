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
  | { ok: false; status: number; error: string };

export async function recordDepositAction(db: any, tenantId: string, tenant: any, o: {
  action: DepositAction; leaseId: string; cents?: number; methodLabel?: string; note?: string; reason?: string; evidenceUrls?: string[];
  requestId: string; by?: string | null; today: string; sendNotice?: boolean;
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
    // Every action writes the lease, so two at once on the same deposit never both pass the check above.
    const touchLease = (extra: Record<string, any> = {}) => tx.set(db.doc(`${T}/leases/${leaseId}`), { deposit: { lastActionAt: at, lastAction: o.action, ...extra } }, { merge: true });
    const book = (id: string, x: Record<string, any>) => tx.set(db.doc(`${T}/transactions/${id}`), { id, context: 'Business', clientOrVendor: who, date: at, createdAt: at,
      hasReceipt: false, sourceId: leaseId, tenantId, renterId: renterId || null, leaseId, ...x });

    if (o.action === 'received') {
      if (pos.collectedCents > 0) return { refused: 'This lease’s deposit is already recorded as received.' };
      if (!(cents > 0)) cents = pos.agreedCents;
      if (!(cents > 0)) return { refused: 'Enter the deposit amount.' };
      // A deposit invoiced and waiting is the line that's marked paid; otherwise this is its line.
      const pending: any = ledger.find((l: any) => l.type === 'deposit_charge' && l.status !== 'paid');
      const txnId = receivedRef.id;
      if (pending) {
        cents = Math.abs(n(pending.amountCents)) || cents;
        tx.set(db.doc(`${T}/rentLedger/${pending.id}`), { status: 'paid', paidAt: o.today, method, transactionId: txnId, requestId: req, updatedAt: at }, { merge: true });
      } else tx.set(lineRef, { id: lineRef.id, ...base, type: 'deposit_charge', amountCents: cents, description: 'Deposit collected', method, evidenceUrls: [], transactionId: txnId });
      // Held for them, not earned: 'transfer' keeps it out of income while it's in the books.
      book(txnId, { type: 'income', taxBucket: 'transfer', source: 'booth_rent', category: 'Booth Deposit', amount: cents / 100, paymentMethod: method,
        description: `Security deposit — ${space} (${who})${note ? ` · ${note}` : ''}` });
      touchLease({ collectedLedgerEntryId: txnId, collectedAt: at, collectedMethod: method, collectedCents: cents });
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
  if (res.refused) return { ok: false, status: 409, error: res.refused };
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
    const itemized = deductions.length ? `From your ${usd(collected)} deposit: ${deductions.map((d: any) => `${d.reason} −${usd(d.cents)}`).join('; ')}.` : '';
    const headline = o.action === 'received' ? `We received your ${usd(cents)} security deposit${how}. It’s held for you, not spent, and is returned as your rental agreement sets out.`
      : o.action === 'deduct' ? `We kept ${usd(cents)} of your security deposit: ${reason}.${evidence.length ? ' Photos are on your account.' : ''}`
      : o.action === 'refund' ? `We returned ${usd(cents)} of your security deposit${how}.`
      : `We applied ${usd(cents)} of your security deposit to what you owe${appliedCents > 0 ? `; ${usd(appliedCents)} of it has paid ${appliedCents >= cents ? 'what was open' : 'part of what’s open'} already` : ''}.${res.returnable > 0 ? ` ${usd(res.returnable)} of your deposit is still held.` : ''}`;
    const details = [o.action === 'received' ? '' : itemized, o.action === 'deduct' ? `${usd(res.returnable)} of your deposit is still held.` : ''].filter(Boolean).join(' ');
    const what = o.action === 'received' ? 'received' : o.action === 'deduct' ? 'part kept' : o.action === 'refund' ? 'returned' : 'applied to your balance';
    try {
      const aRef = db.doc(`${T}/renterAlerts/deposit_${o.action}_${req}`);
      await aRef.set({ id: aRef.id, renterId, kind: 'deposit', tab: 'rent', tone: o.action === 'deduct' ? 'amber' : 'green', at, text: `${headline}${details ? ` ${details}` : ''}` });
    } catch { /* the notice still goes */ }
    try {
      const { sendRenterMoneyNotice } = await import('@/lib/account-receipts');
      const { linkOrigin } = await import('@/lib/app-origin');
      const base = linkOrigin(tenant);
      sentTo = (await sendRenterMoneyNotice(db, tenantId, tenant, { kind: 'deposit_notice', renterId, tokens: {
        what, headline, details, amount: usd(cents), link: base ? `${base}/rent/${encodeURIComponent(tenantId)}?tab=rent` : '' } })).sentTo;
    } catch (e) { console.error('[rent-deposit] notice', tenantId, renterId, e); }
  }
  return { ok: true, lineId: res.lineId || lineRef.id, cents, returnableCents: res.returnable, appliedCents, sentTo };
}
