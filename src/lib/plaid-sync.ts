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

// Plaid personal_finance_category → ledger category + taxBucket
export function mapCategory(pfc: string | undefined, name: string): { category: string; taxBucket: string; type: 'income' | 'expense' } {
  const n = (name || '').toUpperCase();
  if (n.includes('STRIPE')) return { category: 'Stripe Payout', taxBucket: 'transfer', type: 'income' };
  const p = (pfc || '').toUpperCase();
  const M: [string, string, string][] = [
    ['RENT_AND_UTILITIES', 'Rent & Utilities', 'operating_cost'],
    ['GENERAL_MERCHANDISE', 'Supplies', 'operating_cost'],
    ['GENERAL_SERVICES', 'Professional Services', 'operating_cost'],
    ['FOOD_AND_DRINK', 'Meals', 'operating_cost'],
    ['TRANSPORTATION', 'Travel & Transport', 'operating_cost'],
    ['TRAVEL', 'Travel & Transport', 'operating_cost'],
    ['PERSONAL_CARE', 'Supplies', 'operating_cost'],
    ['BANK_FEES', 'Bank Fees', 'operating_cost'],
    ['ENTERTAINMENT', 'Marketing & Entertainment', 'operating_cost'],
    ['MEDICAL', 'Health', 'operating_cost'],
    ['LOAN_PAYMENTS', 'Loan Payments', 'operating_cost'],
    ['INCOME', 'Other Income', 'revenue'],
    ['TRANSFER_IN', 'Transfer In', 'transfer'],
    ['TRANSFER_OUT', 'Transfer Out', 'transfer'],
  ];
  for (const [key, cat, bucket] of M) {
    if (p.startsWith(key)) return { category: cat, taxBucket: bucket, type: bucket === 'revenue' ? 'income' : 'expense' };
  }
  return { category: 'Uncategorized', taxBucket: 'operating_cost', type: 'expense' };
}

export type SyncResult = { pulled: number; matched: number; autoBooked: number; needsReview: number };

/** Pull new bank transactions for one tenant, auto-match against the
 *  ledger, auto-book vendor-rule hits, and stage the rest for review.
 *  Identical behavior to the original /api/plaid sync action. */
export async function syncTenantBankFeed(db: any, tenantId: string): Promise<SyncResult> {
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

  // Unreconciled ledger txns for matching
  const windowStart = new Date(Date.now() - 120 * 86400000).toISOString();
  const ledgerSnap = await db.collection(`tenants/${tenantId}/transactions`)
    .where('date', '>=', windowStart).get();
  const ledger = ledgerSnap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((t: any) => !t.reconciled);

  let matched = 0, staged = 0, autoBooked = 0;
  const pendingWrites: { ref: any; data: any }[] = [];
  const nowIso = new Date().toISOString();
  for (const bt of added) {
    const btId = bt.transaction_id;
    const btRef = db.doc(`tenants/${tenantId}/bankTransactions/${btId}`);
    if ((await btRef.get()).exists) continue;   // idempotent

    // Plaid: positive amount = money OUT; ledger: expense = out
    const outflow = bt.amount > 0;
    const cents = Math.round(Math.abs(bt.amount) * 100);
    const sugg = mapCategory(bt.personal_finance_category?.primary, bt.name);

    // Auto-match: same amount, right direction, within ±4 days
    const btDate = new Date(bt.date + 'T00:00:00Z').getTime();
    const hit = ledger.find((t: any) => {
      if ((t.context || 'Business') !== (bt.__context || 'Business')) return false;
      const tCents = Math.round((t.amount || 0) * 100);
      if (tCents !== cents) return false;
      const dirOk = outflow ? t.type === 'expense' : t.type === 'income';
      if (!dirOk) return false;
      const tDate = new Date(String(t.date).slice(0, 10) + 'T00:00:00Z').getTime();
      return Math.abs(tDate - btDate) <= 4 * 86400000;
    });

    const record: any = {
      id: btId, tenantId,
      context: bt.__context || 'Business',
      name: bt.name, merchant: bt.merchant_name || null,
      amountCents: cents, direction: outflow ? 'out' : 'in',
      date: bt.date, pending: !!bt.pending,
      plaidCategory: bt.personal_finance_category?.primary || null,
      suggestedCategory: sugg.category, suggestedTaxBucket: sugg.taxBucket, suggestedType: sugg.type,
      createdAt: nowIso,
    };

    if (hit) {
      record.status = 'matched';
      record.matchedTxnId = hit.id;
      await db.doc(`tenants/${tenantId}/transactions/${hit.id}`).set(
        { reconciled: true, reconciledAt: nowIso, bankTransactionId: btId }, { merge: true });
      (hit as any).reconciled = true;   // don't double-match
      matched++;
    } else {
      // Vendor-rule hit → book it automatically
      const rule = vendorRules.get(`${(bt.__context || 'Business').toLowerCase()}:${vendorKey(bt.merchant_name || bt.name)}`);
      if (rule && !bt.pending) {
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
