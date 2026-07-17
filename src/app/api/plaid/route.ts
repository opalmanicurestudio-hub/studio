/**
 * Plaid bank feed — /api/plaid  (src/app/api/plaid/route.ts)
 *
 * Actions (POST { action, tenantId, ... }):
 *   link-token     → create a Plaid Link token to open the connect popup
 *   exchange       → swap the public_token for an access token (stored
 *                    server-side at tenants/{id}/private/plaid — never
 *                    readable by clients)
 *   sync           → pull new bank transactions (cursor-based), stage them
 *                    in tenants/{id}/bankTransactions, and auto-match
 *                    against the ledger
 *   resolve        → owner action from the review inbox: 'match' to an
 *                    existing ledger txn, 'create' a new categorized ledger
 *                    txn from the bank line, or 'ignore'
 *
 * ENV (Vercel → Settings → Environment Variables):
 *   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV ('sandbox' | 'production')
 *
 * Matching engine (v1, deliberately explainable):
 *   1. Stripe payouts (name contains STRIPE) → auto-categorized as
 *      'Stripe Payout', matched when a same-amount net exists.
 *   2. Exact amount + direction match against unreconciled ledger txns
 *      within ±4 days → auto-matched, both sides flagged reconciled.
 *   3. Everything else → review inbox with a suggested category from
 *      Plaid's own categorization, mapped to ledger vocabulary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const PLAID_BASE: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

function plaidUrl(path: string) {
  const env = process.env.PLAID_ENV || 'sandbox';
  return `${PLAID_BASE[env] || PLAID_BASE.sandbox}${path}`;
}

async function plaid(path: string, body: any) {
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
function vendorKey(name: string): string {
  return (name || '').toLowerCase().replace(/[#*\d]+/g, ' ').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Plaid personal_finance_category → ledger category + taxBucket
function mapCategory(pfc: string | undefined, name: string): { category: string; taxBucket: string; type: 'income' | 'expense' } {
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing tenantId.' }, { status: 400 });
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return NextResponse.json({ ok: false, error: 'Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 500 });
    }
    const db = getAdminDb();
    const privRef = db.doc(`tenants/${tenantId}/private/plaid`);

    // ── link-token ────────────────────────────────────────────────────
    if (action === 'link-token') {
      const data = await plaid('/link/token/create', {
        user: { client_user_id: tenantId },
        client_name: 'ClarityFlow',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
      });
      return NextResponse.json({ ok: true, linkToken: data.link_token });
    }

    // ── exchange ──────────────────────────────────────────────────────
    if (action === 'exchange') {
      const { publicToken, institution, label } = body;
      if (!publicToken) return NextResponse.json({ ok: false, error: 'Missing public token.' }, { status: 400 });
      const data = await plaid('/item/public_token/exchange', { public_token: publicToken });
      // Per-item storage: one doc per connected account, labeled Business
      // or Personal — the label decides the context of every transaction
      // that flows from it.
      await db.doc(`tenants/${tenantId}/plaidItems/${data.item_id}`).set({
        accessToken: data.access_token,
        itemId: data.item_id,
        institution: institution || null,
        label: label === 'Personal' ? 'Personal' : 'Business',
        cursor: null,
        connectedAt: new Date().toISOString(),
      }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // ── sync + auto-match ─────────────────────────────────────────────
    if (action === 'sync') {
      // All connected accounts: per-item docs + the legacy single doc
      const itemsSnap = await db.collection(`tenants/${tenantId}/plaidItems`).get();
      const items: { ref: any; accessToken: string; cursor: any; label: string }[] =
        itemsSnap.docs.map(d => ({ ref: d.ref, accessToken: (d.data() as any).accessToken, cursor: (d.data() as any).cursor, label: (d.data() as any).label || 'Business' }));
      const legacy = (await privRef.get()).data() as any;
      if (legacy?.accessToken && !items.some(i => i.accessToken === legacy.accessToken)) {
        items.push({ ref: privRef, accessToken: legacy.accessToken, cursor: legacy.cursor, label: 'Business' });
      }
      if (items.length === 0) return NextResponse.json({ ok: false, error: 'No bank connected yet.' }, { status: 400 });

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

      // Vendor rules — the system's memory: categorize a merchant once,
      // every future transaction from them books itself.
      const rulesSnap = await db.collection(`tenants/${tenantId}/vendorRules`).get();
      const vendorRules = new Map(rulesSnap.docs.map(d => [d.id, d.data() as any]));

      // Unreconciled ledger txns for matching
      const ledgerSnap = await db.collection(`tenants/${tenantId}/transactions`).get();
      const ledger = ledgerSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(t => !t.reconciled);

      let matched = 0, staged = 0, autoBooked = 0;
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
        const hit = ledger.find(t => {
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
          // Vendor-rule hit → book it automatically, exactly as the owner
          // categorized this merchant before. Zero-effort bookkeeping.
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
        await btRef.set(record);
      }
      return NextResponse.json({ ok: true, pulled: added.length, matched, autoBooked, needsReview: staged });
    }

    // ── resolve (review inbox actions) ────────────────────────────────
    if (action === 'resolve') {
      const { bankTxnId, mode, category, taxBucket, txnType, ledgerTxnId } = body;
      const btRef = db.doc(`tenants/${tenantId}/bankTransactions/${bankTxnId}`);
      const bt = (await btRef.get()).data() as any;
      if (!bt) return NextResponse.json({ ok: false, error: 'Bank transaction not found.' }, { status: 404 });
      const nowIso = new Date().toISOString();

      if (mode === 'ignore') {
        await btRef.set({ status: 'ignored', resolvedAt: nowIso }, { merge: true });
        return NextResponse.json({ ok: true });
      }
      if (mode === 'match' && ledgerTxnId) {
        await btRef.set({ status: 'matched', matchedTxnId: ledgerTxnId, resolvedAt: nowIso }, { merge: true });
        await db.doc(`tenants/${tenantId}/transactions/${ledgerTxnId}`).set(
          { reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId }, { merge: true });
        return NextResponse.json({ ok: true });
      }
      if (mode === 'create') {
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txnRef.set({
          id: txnRef.id,
          type: txnType || bt.suggestedType || (bt.direction === 'out' ? 'expense' : 'income'),
          context: body.contextOverride || bt.context || 'Business',
          taxBucket: taxBucket || bt.suggestedTaxBucket || 'operating_cost',
          amount: bt.amountCents / 100,
          category: category || bt.suggestedCategory || 'Uncategorized',
          description: bt.merchant || bt.name,
          clientOrVendor: bt.merchant || bt.name,
          date: bt.date + 'T12:00:00.000Z',
          paymentMethod: 'Bank feed',
          hasReceipt: false,
          reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId,
          tenantId, createdAt: nowIso,
        });
        await btRef.set({ status: 'created', matchedTxnId: txnRef.id, resolvedAt: nowIso }, { merge: true });
        // Learn: this merchant now books itself on every future sync.
        const vk = vendorKey(bt.merchant || bt.name);
        if (vk) {
          const ctx = body.contextOverride || bt.context || 'Business';
          await db.doc(`tenants/${tenantId}/vendorRules/${ctx.toLowerCase()}:${vk}`).set({
            merchant: bt.merchant || bt.name,
            category: category || bt.suggestedCategory || 'Uncategorized',
            taxBucket: taxBucket || bt.suggestedTaxBucket || 'operating_cost',
            type: txnType || bt.suggestedType || (bt.direction === 'out' ? 'expense' : 'income'),
            context: ctx, learnedAt: nowIso,
          }, { merge: true });
        }
        return NextResponse.json({ ok: true, ruleLearned: true });
      }
      return NextResponse.json({ ok: false, error: 'Unknown resolve mode.' }, { status: 400 });
    }

    // accept-all — one tap books every review line with its suggestion
    // AND learns each merchant, so next month's inbox is near-empty.
    if (action === 'accept-all') {
      const snap = await db.collection(`tenants/${tenantId}/bankTransactions`).where('status', '==', 'unmatched').get();
      const nowIso = new Date().toISOString();
      let booked = 0;
      for (const d of snap.docs) {
        const bt = d.data() as any;
        if (bt.pending) continue;
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txnRef.set({
          id: txnRef.id, type: bt.suggestedType || (bt.direction === 'out' ? 'expense' : 'income'),
          context: bt.context || 'Business', taxBucket: bt.suggestedTaxBucket || 'operating_cost',
          amount: bt.amountCents / 100, category: bt.suggestedCategory || 'Uncategorized',
          description: bt.merchant || bt.name, clientOrVendor: bt.merchant || bt.name,
          date: bt.date + 'T12:00:00.000Z', paymentMethod: 'Bank feed', hasReceipt: false,
          reconciled: true, reconciledAt: nowIso, bankTransactionId: d.id, tenantId, createdAt: nowIso,
        });
        await d.ref.set({ status: 'created', matchedTxnId: txnRef.id, resolvedAt: nowIso }, { merge: true });
        const vk = vendorKey(bt.merchant || bt.name);
        if (vk) await db.doc(`tenants/${tenantId}/vendorRules/${(bt.context || 'Business').toLowerCase()}:${vk}`).set({
          merchant: bt.merchant || bt.name, category: bt.suggestedCategory || 'Uncategorized',
          taxBucket: bt.suggestedTaxBucket || 'operating_cost', type: bt.suggestedType || 'expense',
          context: bt.context || 'Business', learnedAt: nowIso,
        }, { merge: true });
        booked++;
      }
      return NextResponse.json({ ok: true, booked });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err: any) {
    console.error('[plaid] failed', err);
    return NextResponse.json({ ok: false, error: String(err?.message || 'Bank feed error').slice(0, 200) }, { status: 500 });
  }
}
