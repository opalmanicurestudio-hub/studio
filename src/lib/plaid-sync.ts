// src/lib/plaid-sync.ts
//
// Shared Plaid sync engine — server-only (uses firebase-admin's db).
//
// Extracted from /api/plaid so the SAME sync + auto-match + vendor-rule
// logic can run two ways:
//   • on demand   → POST /api/plaid { action: 'sync' }  (the Sync button)
//   • every night → GET  /api/cron/nightly              (Vercel cron)
//
// Nothing here is importable from client components — keep it out of
// 'use client' files.

import { logAuditAdmin } from './audit';
import { automationOn } from './automation-switches';
import { appOrdersOf } from './app-orders';

const PLAID_BASE: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

function plaidUrl(path: string) {
  const env = process.env.PLAID_ENV || 'sandbox';
  return `${PLAID_BASE[env] || PLAID_BASE.sandbox}${path}`;
}

export async function plaid(path: string, body: any) {
  const res = await fetch(plaidUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_message || `Plaid ${path} failed`);
  return data;
}

// Merchant → stable rule key ("SALLY BEAUTY #1042" → "sally beauty")
export function vendorKey(name: string): string {
  return (name || '').toLowerCase().replace(/[#*\d]+/g, ' ').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// What a bank line is, from the bank's own reading of it (Plaid's category: its broad kind, the detailed one, and how
// sure it is) and the name on it, in the app's own categories (lib/categories), so a line booked from the feed lands
// in the right part of the books and on the right tax line. `sure` says it can be booked without asking: the bank is
// sure and it's a business cost by its nature (bank fees, payroll, software, interest the bank paid). Everything else
// waits for the owner with its category suggested, since it can be personal even on a business account (shopping,
// travel, gas, phone, insurance, meals), needs a choice (a loan payment's interest is an expense, its principal isn't),
// or may be income or a cost in disguise (a "transfer" can be a client's Zelle payment). A transfer that pairs with the
// other side on another of her connected accounts is matched on its own (syncTenantBankFeed).
export type BankGuess = { category: string; taxBucket: string; type: 'income' | 'expense'; sure: boolean };
const NAME_RULES: [RegExp, string, string, 'income' | 'expense' | null][] = [
  [/\b(GUSTO|ADP|PAYCHEX|PAYLOCITY|RIPPLING|ONPAY|PATRIOT PAYROLL)\b|\bPAYROLL\b/, 'Payroll', 'payroll', 'expense'],
  [/\bCLARITYFLOW\b/, 'Software & Subscriptions', 'operating_cost', 'expense'],
  [/SALES (AND USE )?TAX|COMPTROLLER|DEPT? OF REVENUE|DEPARTMENT OF REVENUE|TAXATION AND FINANCE|BOARD OF EQUALIZATION|CDTFA/, 'Sales Tax Paid', 'tax_remitted', 'expense'],
];
const SURE_OK = new Set(['Bank Fees', 'Software & Subscriptions', 'Payroll', 'Interest Income']);
export function mapCategory(pfc: string | undefined, name: string, detailed?: string, confidence?: string): BankGuess {
  const n = (name || '').toUpperCase();
  const p = (pfc || '').toUpperCase(); const d = (detailed || '').toUpperCase();
  const bankSure = /^(VERY_HIGH|HIGH)$/.test(String(confidence || '').toUpperCase());
  const out = (category: string, taxBucket: string, type: 'income' | 'expense', sure = bankSure): BankGuess => ({ category, taxBucket, type, sure: sure && SURE_OK.has(category) });
  if (n.includes('STRIPE')) return { category: 'Stripe Payout', taxBucket: 'transfer', type: 'income', sure: false };
  for (const [re, cat, bucket, type] of NAME_RULES) {
    // (Sales tax paid always waits: it can be a different tax with the same name on it.)
    if (re.test(n)) return { category: cat, taxBucket: bucket, type: type || 'expense', sure: cat !== 'Sales Tax Paid' };
  }
  if (d.startsWith('RENT_AND_UTILITIES_RENT')) return out('Rent & Lease', 'operating_cost', 'expense');
  if (d.startsWith('RENT_AND_UTILITIES_TELEPHONE') || d.startsWith('RENT_AND_UTILITIES_INTERNET')) return out('Phone & Internet', 'operating_cost', 'expense');
  if (p === 'RENT_AND_UTILITIES') return out('Utilities', 'operating_cost', 'expense');
  if (/^GENERAL_SERVICES_(ACCOUNTING|CONSULTING)/.test(d)) return out('Professional Services', 'operating_cost', 'expense');
  if (d.startsWith('GENERAL_SERVICES_INSURANCE')) return out('Insurance', 'operating_cost', 'expense');
  if (d.startsWith('GENERAL_SERVICES_POSTAGE')) return out('Shipping', 'operating_cost', 'expense');
  if (d.startsWith('GENERAL_SERVICES_EDUCATION')) return out('Education & Training', 'operating_cost', 'expense');
  if (d.startsWith('GENERAL_SERVICES_AUTOMOTIVE')) return out('Vehicle', 'operating_cost', 'expense');
  if (p === 'GENERAL_SERVICES') return out('Other', 'operating_cost', 'expense', false);
  if (d.startsWith('GENERAL_MERCHANDISE_OFFICE')) return out('Office Expense', 'operating_cost', 'expense');
  if (d.startsWith('GENERAL_MERCHANDISE_ELECTRONICS')) return out('Equipment', 'operating_cost', 'expense');
  if (p === 'GENERAL_MERCHANDISE') return out('Supplies', 'operating_cost', 'expense');
  if (d.startsWith('HOME_IMPROVEMENT_FURNITURE')) return out('Equipment', 'operating_cost', 'expense');
  if (p === 'HOME_IMPROVEMENT') return out('Repairs & Maintenance', 'operating_cost', 'expense');
  if (p === 'BANK_FEES') return out('Bank Fees', 'operating_cost', 'expense');
  if (p === 'LOAN_PAYMENTS') return out('Loan Payment', 'transfer', 'expense');
  if (/^INCOME_(INTEREST|DIVIDENDS)/.test(d)) return out('Interest Income', 'income', 'income');
  if (p === 'INCOME') return out('Other Income', 'revenue', 'income', false);
  if (p === 'TRANSFER_IN' || p === 'TRANSFER_OUT') return out('Transfer', 'transfer', p === 'TRANSFER_IN' ? 'income' : 'expense');
  if (d === 'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES') return out('Licenses & Permits', 'operating_cost', 'expense');
  if (/^TRANSPORTATION_(GAS|PARKING|TOLLS)/.test(d)) return out('Vehicle', 'operating_cost', 'expense');
  if (p === 'TRANSPORTATION' || p === 'TRAVEL') return out('Travel', 'operating_cost', 'expense');
  if (d === 'FOOD_AND_DRINK_GROCERIES') return out('Supplies', 'operating_cost', 'expense', false);
  if (p === 'FOOD_AND_DRINK') return out('Meals & Entertainment', 'operating_cost', 'expense', false);
  if (p === 'ENTERTAINMENT') return out('Other', 'operating_cost', 'expense', false);   // (entertainment isn't a business cost)
  if (p === 'PERSONAL_CARE') return out('Supplies', 'operating_cost', 'expense', false);
  return { category: 'Uncategorized', taxBucket: 'operating_cost', type: 'expense', sure: false };
}

export type SyncResult = { pulled: number; matched: number; autoBooked: number; needsReview: number };

/** The same supplier on two lines (a bank line's name, and an order booked to the supplier): their first word, or one
 *  name inside the other. */
export function sameVendor(a: string, b: string): boolean {
  const ka = vendorKey(a), kb = vendorKey(b);
  if (!ka || !kb) return false;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  const fa = ka.split(' ')[0], fb = kb.split(' ')[0];
  return fa.length >= 3 && fa === fb;
}
const DAY = 86400000;
const weekName = (d: string) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/** Pull new bank transactions for one tenant, auto-match against the
 *  ledger, auto-book vendor-rule hits, and stage the rest for review.
 *  Identical behavior to the original /api/plaid sync action. */
export async function syncTenantBankFeed(db: any, tenantId: string): Promise<SyncResult> {
  // One check at a time per business (the nightly run and the Sync button can meet): two at once would both match the
  // same new lines, so a payout or a deposit could be counted twice. A lock left by a check that died lapses in 5 minutes.
  const lockRef = db.doc(`tenants/${tenantId}/private/bankSyncLock`);
  const got = await db.runTransaction(async (tx: any) => {
    const l: any = (await tx.get(lockRef)).data() || {};
    if (l.at && Date.now() - Date.parse(String(l.at)) < 5 * 60000) return false;
    tx.set(lockRef, { at: new Date().toISOString() }); return true;
  });
  if (!got) throw new Error('Your bank is being checked already. Try again in a minute.');
  try { return await syncBody(db, tenantId); }
  finally { await lockRef.set({ at: null }, { merge: true }).catch(() => {}); }
}

async function syncBody(db: any, tenantId: string): Promise<SyncResult> {
  const privRef = db.doc(`tenants/${tenantId}/private/plaid`);

  // All connected accounts: per-item docs + the legacy single doc
  const itemsSnap = await db.collection(`tenants/${tenantId}/plaidItems`).get();
  const items: { ref: any; accessToken: string; cursor: any; label: string }[] =
    itemsSnap.docs.map((d: any) => ({ ref: d.ref, accessToken: (d.data() as any).accessToken, cursor: (d.data() as any).cursor, label: (d.data() as any).label || 'Business' }));
  const legacy = (await privRef.get()).data() as any;
  if (legacy?.accessToken && !items.some(i => i.accessToken === legacy.accessToken)) {
    items.push({ ref: privRef, accessToken: legacy.accessToken, cursor: legacy.cursor, label: 'Business' });
  }
  if (items.length === 0) throw new Error('No bank connected yet.');
  // Sorting lines on its own is the owner's one switch (Automations): off, every line waits for them, except an exact
  // match to something already in the books or a card payout, which are matches, not choices.
  const tenantDoc: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const autoSort = automationOn(tenantDoc, 'bank-sort');

  const added: any[] = [];
  for (const item of items) {
    let cursor = item.cursor || undefined;
    let hasMore = true, guard = 0;
    while (hasMore && guard < 10) {
      const data = await plaid('/transactions/sync', { access_token: item.accessToken, cursor, count: 100 });
      for (const t of (data.added || [])) added.push({ ...t, __context: item.label });
      cursor = data.next_cursor;
      hasMore = data.has_more;
      guard++;
    }
    await item.ref.set({ cursor, lastSyncAt: new Date().toISOString() }, { merge: true });
  }

  // Vendor rules — the system's memory
  const rulesSnap = await db.collection(`tenants/${tenantId}/vendorRules`).get();
  const vendorRules = new Map(rulesSnap.docs.map((d: any) => [d.id, d.data() as any]));

  // v69 — bill-aware matching: load unpaid bill instances once so outgoing
  // bank lines can be recognized as bill payments. A match makes the inbox
  // suggest "this is your Rent bill" — booking it then marks the bill paid
  // in the same action, killing the "paid at the bank but still due in the
  // app" drift. Matching is amount-exact AND due-date within ±15 days;
  // each bill can only match one bank line per sync.
  const billDefs = new Map(
    (await db.collection(`tenants/${tenantId}/billDefinitions`).get()).docs
      .map((d: any) => [d.id, d.data() as any]),
  );
  const openBills: any[] = (await db.collection(`tenants/${tenantId}/billInstances`).get()).docs
    .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((i: any) => i.status !== 'paid');

  const findBillMatch = (amountCents: number, dateStr: string) => {
    const btTime = new Date(dateStr + 'T00:00:00Z').getTime();
    let best: any = null, bestGap = Infinity;
    for (const inst of openBills) {
      if (inst.__claimed) continue;
      const def = billDefs.get(inst.billDefinitionId);
      if (!def || Math.round((def.amount || 0) * 100) !== amountCents) continue;
      const gap = Math.abs(new Date(inst.dueDate).getTime() - btTime);
      if (gap <= 15 * 86400000 && gap < bestGap) { best = { inst, def }; bestGap = gap; }
    }
    if (best) best.inst.__claimed = true;
    return best;
  };

  // Unreconciled ledger txns for matching
  const windowStart = new Date(Date.now() - 120 * 86400000).toISOString();
  // Card payouts landing in the bank (connect-webhook keeps each one): matched to their deposit by amount and the day
  // they arrive, so they never wait in the inbox. A payout moves money; it's never income.
  const payouts: any[] = (await db.collection(`tenants/${tenantId}/stripePayouts`).where('arrivalDate', '>=', windowStart).get().catch(() => ({ docs: [] as any[] }))).docs
    .map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() as any) })).filter((x: any) => !x.bankTransactionId);

  // Delivery app payouts (lib/app-payouts-server bankPayout): the orders are in the books already, so a payout landing in
  // the bank goes to its week (paid a week at once, a day at a time or early), never booked again.
  const AP: any = tenantDoc?.appOrders ? await import('./app-payouts-server').catch(() => null) : null;
  const appRe: Record<string, RegExp> = { doordash: /DOOR ?DASH/, ubereats: /UBER ?\*? ?EATS|UBEREATS/, grubhub: /GRUBHUB|SEAMLESS/ };
  const otherApp = String(tenantDoc?.appOrders?.otherName || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  // Only the apps it takes orders from here (Menu, Delivery apps): another app's money isn't in the books yet, so it's
  // sorted like any other line.
  const ordersOf = appOrdersOf(tenantDoc); const appsOn = ordersOf.on;
  const listedApps = new Set(ordersOf.apps.map((a) => String(a.code)));
  const appOfLine = (name: string): string | null => {
    if (!AP) return null;
    const n = String(name || '').toUpperCase();
    for (const [code, re] of Object.entries(appRe)) if (re.test(n)) return listedApps.has(code) ? code : null;
    return otherApp.length >= 3 && n.includes(otherApp) && listedApps.has('other') ? 'other' : null;
  };

  const ledgerSnap = await db.collection(`tenants/${tenantId}/transactions`)
    .where('date', '>=', windowStart).get();
  const ledger = ledgerSnap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((t: any) => !t.reconciled);

  // Cash (and checks) taken at the business and then deposited: the sales are in the books already, so a deposit is
  // matched against what was taken in the ten days before it and not deposited yet: each closed drawer's counted cash,
  // less its opening float and any cash put in (change from the bank, her own money: not sales), plus cash taken to
  // the safe, and checks taken. Cash not deposited within ten days stops counting (most likely spent), so it can't
  // hide a deposit of something else later. A deposit bigger than what's left waits for the owner.
  const since45 = new Date(Date.now() - 45 * DAY).toISOString();
  const nz = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const taken: { day: string; cents: number }[] = (await db.collection(`tenants/${tenantId}/tillSessions`).where('openedAt', '>=', since45).limit(500).get().catch(() => ({ docs: [] as any[] }))).docs
    .map((d: any) => d.data() || {}).filter((t: any) => t.status === 'closed' && (t.context || 'Business') === 'Business')
    .map((t: any) => {
      const counted = t.actualCash !== undefined && t.actualCash !== null ? nz(t.actualCash) : nz(t.expectedCash);
      return { day: String(t.closedAt || t.openedAt || '').slice(0, 10), cents: Math.max(0, Math.round((counted - nz(t.openingFloat) - nz(t.totalPaidIn) + nz(t.totalDrops)) * 100)) };
    });
  for (const t of ledger) if (t.type === 'income' && /\bche(ck|que)/i.test(String(t.paymentMethod || '')) && String(t.date) >= since45) taken.push({ day: String(t.date).slice(0, 10), cents: Math.round(nz(t.amount) * 100) });
  const depositsMatched: { date: string; cents: number }[] = (await db.collection(`tenants/${tenantId}/bankTransactions`).where('date', '>=', since45.slice(0, 10)).limit(3000).get().catch(() => ({ docs: [] as any[] }))).docs
    .map((d: any) => d.data() || {}).filter((x: any) => x.status === 'cash_deposit').map((x: any) => ({ date: String(x.date || ''), cents: Math.round(nz(x.amountCents)) }));
  const cashLeftFor = (day: string) => {
    const end = dayOf(day), from = end - 10 * DAY;
    const inWindow = (d: string) => { const t = dayOf(d); return t >= from && t <= end + DAY; };
    return Math.max(0, taken.filter((x) => inWindow(x.day)).reduce((n, x) => n + x.cents, 0) - depositsMatched.filter((x) => inWindow(x.date)).reduce((n, x) => n + x.cents, 0));
  };
  // (A deposit as the bank calls one, or one made at a branch or an ATM by its name: never another company's payout.)
  const isDeposit = (b: any) => String(b?.personal_finance_category?.detailed || '').toUpperCase() === 'TRANSFER_IN_DEPOSIT'
    || /\b(BRANCH|ATM|TELLER|COUNTER|CASH|CHECK|CHEQUE) DEPOSIT\b|\bDEPOSIT (CASH|CHECK|AT BRANCH)\b/.test(String(b?.name || '').toUpperCase());

  let matched = 0, staged = 0, autoBooked = 0;
  const pendingWrites: { ref: any; data: any }[] = [];
  const nowIso = new Date().toISOString();

  // Money moved between two of her own connected accounts: the line out of one and the line into the other, the same
  // amount within two days, both called a transfer by the bank. Matched to each other on their own, with nothing in the
  // books when both accounts are the business's; between a business and a personal account it's an owner draw or an
  // owner contribution, booked on the business's side (never income or an expense). A transfer with no other side
  // waits for the owner: it may be a client's Zelle payment or someone she paid.
  // (Paying off a card from checking is called a loan payment on the checking side: it pairs with the card's line in.)
  const CARD_PAYOFF = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
  const xfer = (b: any) => /^TRANSFER_(IN|OUT)/.test(String(b?.personal_finance_category?.primary || '').toUpperCase())
    || String(b?.personal_finance_category?.detailed || '').toUpperCase() === CARD_PAYOFF;
  const dayOf = (d: string) => new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime();
  const pairs = new Map<string, { otherId: string; otherContext: string }>();
  const pool = added.filter((b) => !b.pending && xfer(b));
  const waitingXfers: any[] = (await db.collection(`tenants/${tenantId}/bankTransactions`).where('status', '==', 'unmatched').limit(500).get().catch(() => ({ docs: [] as any[] }))).docs
    .map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() as any) })).filter((x: any) => x.accountId && !x.pending && (/^TRANSFER_(IN|OUT)/.test(String(x.plaidCategory || '')) || String(x.plaidDetailed || '') === CARD_PAYOFF));
  // A draw or contribution she already booked herself (a Profit First move on the Money page): matched, never booked again.
  const ownerLineFor = (out: boolean, amountCents: number, date: string) => ledger.find((t: any) => !t.reconciled && (t.context || 'Business') === 'Business'
    && String(t.category || '').toLowerCase() === (out ? 'distribution' : 'owner contribution') && Math.round((t.amount || 0) * 100) === amountCents
    && Math.abs(dayOf(t.date) - dayOf(date)) <= 4 * DAY);
  for (const a of pool) {
    if (pairs.has(a.transaction_id)) continue;
    const aOut = a.amount > 0; const ac = Math.round(Math.abs(a.amount) * 100); const ad = dayOf(a.date);
    const b = pool.find((x) => x !== a && !pairs.has(x.transaction_id) && (x.amount > 0) !== aOut && Math.round(Math.abs(x.amount) * 100) === ac
      && x.account_id && a.account_id && x.account_id !== a.account_id && Math.abs(dayOf(x.date) - ad) <= 2 * DAY);
    if (b) { pairs.set(a.transaction_id, { otherId: b.transaction_id, otherContext: b.__context || 'Business' }); pairs.set(b.transaction_id, { otherId: a.transaction_id, otherContext: a.__context || 'Business' }); continue; }
    const w = waitingXfers.find((x: any) => !x.__claimed && (x.direction === 'out') !== aOut && x.amountCents === ac && a.account_id && x.accountId !== a.account_id && Math.abs(dayOf(x.date) - ad) <= 2 * DAY);
    if (w) {
      w.__claimed = true; pairs.set(a.transaction_id, { otherId: w.id, otherContext: w.context || 'Business' });
      // (The other side came in on an earlier sync and is waiting in the inbox: it's matched now too, and when it's the
      // business's side of a move to or from a personal account, the owner draw or contribution is booked on it.)
      let ownerLine: string | null = null;
      if ((w.context || 'Business') === 'Business' && (a.__context || 'Business') !== 'Business') {
        const wOut = w.direction === 'out'; const mine = ownerLineFor(wOut, ac, w.date);
        if (mine) { mine.reconciled = true; ownerLine = mine.id; await db.doc(`tenants/${tenantId}/transactions/${mine.id}`).set({ reconciled: true, reconciledAt: nowIso, bankTransactionId: w.id }, { merge: true }); }
        else {
        const ref = db.doc(`tenants/${tenantId}/transactions/owner_${String(w.id).replace(/[^A-Za-z0-9_]/g, '')}`);
        await ref.set({ id: ref.id, type: wOut ? 'expense' : 'income', context: 'Business', taxBucket: 'transfer', category: wOut ? 'Distribution' : 'Owner Contribution', amount: ac / 100,
          description: wOut ? 'Owner draw (to your personal account)' : 'Owner contribution (from your personal account)', clientOrVendor: 'You',
          date: String(w.date).slice(0, 10) + 'T12:00:00.000Z', paymentMethod: 'Bank feed', hasReceipt: false, reconciled: true, reconciledAt: nowIso,
          bankTransactionId: w.id, autoCategorized: true, sortedBy: 'bank', tenantId, createdAt: nowIso });
        ownerLine = ref.id;
        }
      }
      await w.ref.set({ status: 'own_transfer', pairedWith: a.transaction_id, resolvedAt: nowIso, ...(ownerLine ? { matchedTxnId: ownerLine } : {}) }, { merge: true });
    }
  }

  for (const bt of added) {
    const btId = bt.transaction_id;
    const btRef = db.doc(`tenants/${tenantId}/bankTransactions/${btId}`);
    if ((await btRef.get()).exists) continue;   // idempotent

    // Plaid: positive amount = money OUT; ledger: expense = out
    const outflow = bt.amount > 0;
    const cents = Math.round(Math.abs(bt.amount) * 100);
    const pfc = bt.personal_finance_category || {};
    const sugg = mapCategory(pfc.primary, bt.merchant_name || bt.name, pfc.detailed, pfc.confidence_level);
    const vendorName = bt.merchant_name || bt.name;

    // A card payout arriving: matched to the payout, never booked again.
    const btDate = new Date(bt.date + 'T00:00:00Z').getTime();
    const payout = !outflow && !bt.pending && !pairs.has(btId) ? payouts.find((x: any) => !x.__claimed && Math.round(Number(x.amount || 0) * 100) === cents
      && Math.abs(new Date(String(x.arrivalDate).slice(0, 10) + 'T00:00:00Z').getTime() - btDate) <= 3 * DAY) : null;

    // A delivery app's payout: the week it pays off, else the week it's part of (lib/app-payouts-server bankPayout).
    // (With app orders turned off, only while a week of its orders is still being paid.)
    const appGuess = !outflow && !bt.pending && !payout && !pairs.has(btId) ? appOfLine(`${bt.merchant_name || ''} ${bt.name || ''}`) : null;
    const appWeek = appGuess && AP ? await AP.bankPayout(db, tenantId, tenantDoc, appGuess, cents, btId, bt.date, Date.now(), new Set(pendingWrites.map((p) => String(p.data?.id || '')))).catch(() => null) : null;
    const appCode = appGuess && (appsOn || appWeek) ? appGuess : null;
    // (A whole payout took back its week: what was on it goes back to her.)
    if (appWeek?.bumped?.length) for (const id of appWeek.bumped) {
      const w = pendingWrites.find((p) => p.data?.id === id);
      if (w && w.data.status === 'app_payout') { Object.assign(w.data, AP.bumpedLine()); matched--; staged++; }
    }
    // Cash or checks taken here, deposited: within what's been taken and not deposited yet (a little over, for coins
    // and rounding).
    const cashDeposit = !outflow && !bt.pending && !payout && !appCode && !pairs.has(btId) && isDeposit(bt) && (bt.__context || 'Business') === 'Business'
      && cents <= cashLeftFor(bt.date) + Math.max(500, Math.round(cents * 0.02));

    // Auto-match: same amount, right direction, within ±4 days
    const exact = payout || appCode || cashDeposit ? null : ledger.find((t: any) => {
      if ((t.context || 'Business') !== (bt.__context || 'Business')) return false;
      const tCents = Math.round((t.amount || 0) * 100);
      if (tCents !== cents) return false;
      const dirOk = outflow ? t.type === 'expense' : t.type === 'income';
      if (!dirOk) return false;
      const tDate = new Date(String(t.date).slice(0, 10) + 'T00:00:00Z').getTime();
      return Math.abs(tDate - btDate) <= 4 * 86400000;
    });
    // …or a supplier order booked when it was placed ("on account") and paid later: the same supplier and amount, paid
    // up to 60 days after. Without this, the payment was booked a second time (a learned rule for the supplier booked
    // it on its own).
    const onAccount = (t: any) => outflow && t.type === 'expense' && /on account/i.test(String(t.paymentMethod || ''))
      && (t.context || 'Business') === (bt.__context || 'Business') && sameVendor(String(t.clientOrVendor || t.description || ''), vendorName)
      && (() => { const tDate = new Date(String(t.date).slice(0, 10) + 'T00:00:00Z').getTime(); return btDate >= tDate - 2 * DAY && btDate <= tDate + 60 * DAY; })();
    // (Sales tax recorded as paid on the Settings page, then paid to the state: up to 30 days apart, either way.)
    const hit = exact || (payout || appCode || cashDeposit ? null : ledger.find((t: any) => (onAccount(t) || (outflow && t.source === 'platform_invoice' && t.type === 'expense'
      && Math.abs(new Date(String(t.date).slice(0, 10) + 'T00:00:00Z').getTime() - btDate) <= 10 * DAY)
      || (outflow && t.type === 'expense' && t.category === 'Sales Tax Paid' && !t.reconciled && Math.abs(new Date(String(t.date).slice(0, 10) + 'T00:00:00Z').getTime() - btDate) <= 30 * DAY))
      && Math.round((t.amount || 0) * 100) === cents));

    const record: any = {
      id: btId, tenantId,
      context: bt.__context || 'Business',
      name: bt.name, merchant: bt.merchant_name || null,
      amountCents: cents, direction: outflow ? 'out' : 'in',
      date: bt.date, pending: !!bt.pending,
      plaidCategory: bt.personal_finance_category?.primary || null,
      suggestedCategory: sugg.category, suggestedTaxBucket: sugg.taxBucket, suggestedType: sugg.type,
      plaidDetailed: pfc.detailed || null, plaidConfidence: pfc.confidence_level || null, accountId: bt.account_id || null,
      // (A deposit bigger than the cash and checks taken lately: it may be a sale nobody rang up, or her own money.)
      ...(!outflow && isDeposit(bt) && !cashDeposit && !payout && !appCode ? { hint: 'More than the cash and checks taken lately. A client’s check nobody rang up, or money you put in?' } : {}),
      // (An app's payout that fits none of its weeks: its orders are in the books already, so it's never income.)
      // (Money for a week whose difference she booked already: it makes up that difference.)
      ...(appWeek?.late ? { hint: `Money from the app for the week of ${weekName(appWeek.week)}, whose difference you booked already. It makes up that difference.`, suggestedCategory: 'Delivery App Adjustments', suggestedTaxBucket: 'adjustment', suggestedType: 'income' } : {}),
      ...(appCode && !appWeek ? { hint: 'A delivery app payout that doesn’t fit a week’s orders. Its orders are in your books already. If the app paid more than they came to, type what came in for that week on the Money page.', suggestedCategory: 'Transfer', suggestedTaxBucket: 'transfer', suggestedType: 'income' } : {}),
      createdAt: nowIso,
    };

    const pair = pairs.get(btId);
    if (pair) {
      record.status = 'own_transfer';
      record.pairedWith = pair.otherId;
      const here = bt.__context || 'Business';
      // Between the business and a personal account: an owner draw (out of the business) or contribution (into it),
      // on the business's side, so its money adds up. Between two of the same kind: nothing to book.
      const mine = here === 'Business' && pair.otherContext !== 'Business' ? ownerLineFor(outflow, cents, bt.date) : null;
      if (mine) {
        mine.reconciled = true; record.matchedTxnId = mine.id;
        await db.doc(`tenants/${tenantId}/transactions/${mine.id}`).set({ reconciled: true, reconciledAt: nowIso, bankTransactionId: btId }, { merge: true });
      } else if (here === 'Business' && pair.otherContext !== 'Business') {
        const txnRef = db.doc(`tenants/${tenantId}/transactions/owner_${String(btId).replace(/[^A-Za-z0-9_]/g, '')}`);
        await txnRef.set({
          id: txnRef.id, type: outflow ? 'expense' : 'income', context: 'Business', taxBucket: 'transfer',
          category: outflow ? 'Distribution' : 'Owner Contribution', amount: cents / 100,
          description: outflow ? 'Owner draw (to your personal account)' : 'Owner contribution (from your personal account)', clientOrVendor: 'You',
          date: bt.date + 'T12:00:00.000Z', paymentMethod: 'Bank feed', hasReceipt: false, reconciled: true, reconciledAt: nowIso,
          bankTransactionId: btId, autoCategorized: true, sortedBy: 'bank', tenantId, createdAt: nowIso,
        });
        record.matchedTxnId = txnRef.id;
      }
      matched++;
    } else if (payout) {
      payout.__claimed = true;
      record.status = 'payout';
      record.matchedPayoutId = payout.id;
      await payout.ref.set({ bankTransactionId: btId, reconciledAt: nowIso }, { merge: true });
      matched++;
    } else if (appWeek && !appWeek.late) {
      record.status = 'app_payout';
      record.matchedAppWeek = `${appCode}_${appWeek.week}`;
      matched++;
    } else if (cashDeposit) {
      depositsMatched.push({ date: String(bt.date), cents });
      record.status = 'cash_deposit';
      matched++;
    } else if (hit) {
      record.status = 'matched';
      record.matchedTxnId = hit.id;
      await db.doc(`tenants/${tenantId}/transactions/${hit.id}`).set(
        { reconciled: true, reconciledAt: nowIso, bankTransactionId: btId }, { merge: true });
      (hit as any).reconciled = true;   // don't double-match
      matched++;
    } else {
      // NEAR-MATCH suggestion — the double-count killer for card
      // purchases logged by hand before the statement amount was known
      // ("logged $38, card charged $38.42 with tax"). Same direction,
      // within ±5% (min $3), within ±5 days → suggest "same as", never
      // auto-book. The reviewer taps Match and the ledger keeps ONE entry.
      const near = appCode ? null : ledger.find((t: any) => {
        if ((t.context || 'Business') !== (bt.__context || 'Business')) return false;
        const dirOk = outflow ? t.type === 'expense' : t.type === 'income';
        if (!dirOk) return false;
        const tCents = Math.round((t.amount || 0) * 100);
        const tol = Math.max(300, Math.round(cents * 0.05));
        if (Math.abs(tCents - cents) > tol || tCents === cents) return false;
        const tDate = new Date(String(t.date).slice(0, 10) + 'T00:00:00Z').getTime();
        return Math.abs(tDate - btDate) <= 5 * 86400000;
      }) || ledger.find((t: any) => {
        // (A supplier order on account paid a little differently, with shipping or tax added: suggested, never booked.)
        if (!onAccount(t)) return false;
        const tCents = Math.round((t.amount || 0) * 100);
        return tCents !== cents && Math.abs(tCents - cents) <= Math.max(500, Math.round(cents * 0.1));
      });
      if (near) {
        record.suggestedMatchTxnId = near.id;
        record.suggestedMatchLabel = `${(near.description || near.category || 'Ledger entry').slice(0, 60)} · $${(near.amount || 0).toFixed(2)} · ${String(near.date).slice(0, 10)}`;
      }
      // v69 — bill match takes priority over rule auto-booking: paying a
      // bill deserves the human tap (it also marks the bill paid), so a
      // matched line always goes to review with the bill suggestion
      // attached instead of silently auto-booking.
      const billMatch = outflow ? findBillMatch(cents, bt.date) : null;
      if (billMatch) {
        record.status = 'unmatched';
        record.suggestedBillInstanceId = billMatch.inst.id;
        record.suggestedBillName = billMatch.def.name || 'Bill';
        record.suggestedCategory = billMatch.def.category || 'Bills';
        record.suggestedTaxBucket = 'operating_cost';
        record.suggestedType = 'expense';
        staged++;
        pendingWrites.push({ ref: btRef, data: record });
        if (pendingWrites.length >= 400) {
          const batch = db.batch();
          for (const w of pendingWrites) batch.set(w.ref, w.data);
          await batch.commit();
          pendingWrites.length = 0;
        }
        continue;
      }
      // Vendor-rule hit → book it automatically — UNLESS a near-match to
      // an existing ledger entry was found: auto-booking then would be
      // the exact double-count we're guarding against, so the line goes
      // to review with the "same as" suggestion instead.
      // (Never a delivery app's money, either way: its orders are in the books already.)
      const rule = vendorRules.get(`${(bt.__context || 'Business').toLowerCase()}:${vendorKey(bt.merchant_name || bt.name)}`);
      // The bank is sure, and the category means the same for everyone: booked as it says, marked as sorted by the app
      // (changing it in the books or the inbox teaches a rule for that vendor). The way the money went decides the
      // side: money back on a cost brings that cost down.
      const sureFits = sugg.sure && (sugg.taxBucket === 'transfer' || sugg.type === (outflow ? 'expense' : 'income') || (!outflow && sugg.type === 'expense'));
      if (autoSort && !rule && sureFits && !bt.pending && !near && !appCode) {
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txnRef.set({
          id: txnRef.id, type: outflow ? 'expense' : 'income',
          context: bt.__context || 'Business', taxBucket: sugg.taxBucket,
          amount: cents / 100, category: sugg.category,
          description: vendorName, clientOrVendor: vendorName,
          date: bt.date + 'T12:00:00.000Z', paymentMethod: 'Bank feed',
          hasReceipt: false, reconciled: true, reconciledAt: nowIso,
          bankTransactionId: btId, autoCategorized: true, sortedBy: 'bank', tenantId, createdAt: nowIso,
        });
        record.status = 'auto_categorized';
        record.matchedTxnId = txnRef.id;
        record.appliedRule = sugg.category;
        autoBooked++;
        await logAuditAdmin(db, tenantId, {
          action: 'transaction.auto_book', targetType: 'transaction', targetId: txnRef.id,
          summary: `Sorted ${vendorName} as ${sugg.category} (the bank’s own category)`,
          amount: cents / 100, actor: { type: 'system', name: 'bank-sync' },
        });
      } else if (autoSort && rule && !bt.pending && !near && !appCode) {
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txnRef.set({
          id: txnRef.id, type: rule.type || (outflow ? 'expense' : 'income'),
          context: rule.context || bt.__context || 'Business', taxBucket: rule.taxBucket || 'operating_cost',
          amount: cents / 100, category: rule.category,
          description: bt.merchant_name || bt.name,
          clientOrVendor: bt.merchant_name || bt.name,
          date: bt.date + 'T12:00:00.000Z', paymentMethod: 'Bank feed',
          hasReceipt: false, reconciled: true, reconciledAt: nowIso,
          bankTransactionId: btId, autoCategorized: true, tenantId, createdAt: nowIso,
        });
        record.status = 'auto_categorized';
        record.matchedTxnId = txnRef.id;
        record.appliedRule = rule.category;
        autoBooked++;
        await logAuditAdmin(db, tenantId, {
          action: 'transaction.auto_book', targetType: 'transaction', targetId: txnRef.id,
          summary: `Auto-booked ${bt.merchant_name || bt.name} as ${rule.category} (learned rule)`,
          amount: cents / 100, actor: { type: 'system', name: 'bank-sync' },
        });
      } else {
        record.status = 'unmatched';
        staged++;
      }
    }
    pendingWrites.push({ ref: btRef, data: record });
    if (pendingWrites.length >= 400) {
      const batch = db.batch();
      for (const w of pendingWrites) batch.set(w.ref, w.data);
      await batch.commit();
      pendingWrites.length = 0;
    }
  }
  if (pendingWrites.length > 0) {
    const batch = db.batch();
    for (const w of pendingWrites) batch.set(w.ref, w.data);
    await batch.commit();
  }
  // (App weeks the bank paid only part of, ten days on: filled in, so the Money page shows them short.)
  if (AP) await AP.settleBankWeeks(db, tenantId, tenantDoc).catch(() => 0);
  return { pulled: added.length, matched, autoBooked, needsReview: staged };
}

/** Every tenant with at least one connected bank (per-item docs or the
 *  legacy private/plaid doc). Used by the nightly cron. */
export async function listBankFeedTenants(db: any): Promise<string[]> {
  const ids = new Set<string>();
  const itemsSnap = await db.collectionGroup('plaidItems').get();
  for (const d of itemsSnap.docs) {
    const tid = d.ref.parent.parent?.id;
    if (tid) ids.add(tid);
  }
  const privSnap = await db.collectionGroup('private').get();
  for (const d of privSnap.docs) {
    if (d.id === 'plaid' && (d.data() as any)?.accessToken) {
      const tid = d.ref.parent.parent?.id;
      if (tid) ids.add(tid);
    }
  }
  return [...ids];
}
