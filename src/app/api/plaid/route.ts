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
import { bucketFor } from '@/lib/categories';
// v62 — sync engine + helpers extracted to a shared lib so the nightly
// cron (/api/cron/nightly) runs the exact same logic as the Sync button.
import { plaid, vendorKey, syncTenantBankFeed } from '@/lib/plaid-sync';
import { logAuditAdmin } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing tenantId.' }, { status: 400 });
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return NextResponse.json({ ok: false, error: 'Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 500 });
    }
    const db = getAdminDb();

    // Acting team member, forwarded by the client for audit attribution.
    // TODO(hardening): verify a Firebase Auth ID token here instead of
    // trusting the client-sent identity — the shape is ready for it.
    const actor = (body?.actor && body.actor.type === 'user')
      ? { type: 'user' as const, id: body.actor.id || undefined, name: body.actor.name || undefined, role: body.actor.role || undefined }
      : { type: 'user' as const };

    // ── link-token ────────────────────────────────────────────────────
    if (action === 'link-token') {
      const data = await plaid('/link/token/create', {
        user: { client_user_id: tenantId },
        client_name: 'ClarityFlow',
        products: ['transactions'],
        transactions: { days_requested: 90 },   // cap history: first sync stays fast
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

    // ── sync + auto-match — now delegates to the shared engine ────────
    if (action === 'sync') {
      try {
        const r = await syncTenantBankFeed(db, tenantId);
        return NextResponse.json({ ok: true, ...r });
      } catch (e: any) {
        if (String(e?.message).includes('No bank connected')) {
          return NextResponse.json({ ok: false, error: 'No bank connected yet.' }, { status: 400 });
        }
        throw e;
      }
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
        await logAuditAdmin(db, tenantId, {
          action: 'bank.ignore', targetType: 'bankTransaction', targetId: bankTxnId,
          summary: `Ignored bank line: ${bt.merchant || bt.name}`,
          amount: bt.amountCents / 100, actor,
        });
        return NextResponse.json({ ok: true });
      }
      if (mode === 'match' && ledgerTxnId) {
        await btRef.set({ status: 'matched', matchedTxnId: ledgerTxnId, resolvedAt: nowIso }, { merge: true });
        await db.doc(`tenants/${tenantId}/transactions/${ledgerTxnId}`).set(
          { reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId }, { merge: true });
        await logAuditAdmin(db, tenantId, {
          action: 'bank.match', targetType: 'bankTransaction', targetId: bankTxnId,
          summary: `Matched bank line ${bt.merchant || bt.name} to ledger entry ${ledgerTxnId}`,
          amount: bt.amountCents / 100, actor,
        });
        return NextResponse.json({ ok: true });
      }
      if (mode === 'create') {
        // v61 — the review inbox can now (a) override the suggested category
        // with a pick from the shared library (categoryOverride) and
        // (b) attach a receipt image captured during reconciliation
        // (receiptUrl). The learned rule remembers the corrected category,
        // and an overridden category derives its report-color taxBucket
        // from the library so the print report stays accurate.
        const finalType = txnType || bt.suggestedType || (bt.direction === 'out' ? 'expense' : 'income');
        const finalCategory = body.categoryOverride || category || bt.suggestedCategory || 'Uncategorized';
        const finalBucket = taxBucket
          || (body.categoryOverride ? bucketFor(finalCategory, finalType) : (bt.suggestedTaxBucket || 'operating_cost'));
        const receiptUrl = typeof body.receiptUrl === 'string' && body.receiptUrl ? body.receiptUrl : null;

        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txnRef.set({
          id: txnRef.id,
          type: finalType,
          context: body.contextOverride || bt.context || 'Business',
          taxBucket: finalBucket,
          amount: bt.amountCents / 100,
          category: finalCategory,
          description: bt.merchant || bt.name,
          clientOrVendor: bt.merchant || bt.name,
          date: bt.date + 'T12:00:00.000Z',
          paymentMethod: 'Bank feed',
          hasReceipt: !!receiptUrl,
          ...(receiptUrl ? { receiptUrl } : {}),
          reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId,
          tenantId, createdAt: nowIso,
        });
        await btRef.set({
          status: 'created', matchedTxnId: txnRef.id, resolvedAt: nowIso,
          ...(receiptUrl ? { receiptUrl } : {}),
        }, { merge: true });
        // Learn: this merchant now books itself on every future sync —
        // under the category the owner actually chose, not just the guess.
        const vk = vendorKey(bt.merchant || bt.name);
        if (vk) {
          const ctx = body.contextOverride || bt.context || 'Business';
          await db.doc(`tenants/${tenantId}/vendorRules/${ctx.toLowerCase()}:${vk}`).set({
            merchant: bt.merchant || bt.name,
            category: finalCategory,
            taxBucket: finalBucket,
            type: finalType,
            context: ctx, learnedAt: nowIso,
          }, { merge: true });
        }
        await logAuditAdmin(db, tenantId, {
          action: 'bank.book', targetType: 'transaction', targetId: txnRef.id,
          summary: `Booked bank line ${bt.merchant || bt.name} as ${finalCategory}${receiptUrl ? ' (receipt attached)' : ''} — rule learned`,
          amount: bt.amountCents / 100, actor,
        });
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
      if (booked > 0) {
        await logAuditAdmin(db, tenantId, {
          action: 'bank.accept_all', targetType: 'bankTransaction',
          summary: `Accept-all: booked ${booked} bank lines with their suggested categories (rules learned)`,
          actor,
        });
      }
      return NextResponse.json({ ok: true, booked });
    }

    // Rules manager
    if (action === 'rules-list') {
      const snap = await db.collection(`tenants/${tenantId}/vendorRules`).get();
      return NextResponse.json({ ok: true, rules: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) });
    }
    // rules-update — fix a rule's category in place; optionally repair
    // every past auto-booked entry from that merchant in one pass.
    if (action === 'rules-update') {
      const { ruleId, category, taxBucket, fixPast } = body;
      if (!ruleId || !category) return NextResponse.json({ ok: false, error: 'Missing ruleId or category.' }, { status: 400 });
      const ruleRef = db.doc(`tenants/${tenantId}/vendorRules/${ruleId}`);
      const rule = (await ruleRef.get()).data() as any;
      if (!rule) return NextResponse.json({ ok: false, error: 'Rule not found.' }, { status: 404 });
      // v61 — recompute the report-color bucket from the category library on
      // edit, so a rule corrected from e.g. Supplies → Payroll recolors too.
      const newBucket = taxBucket || bucketFor(category, rule.type || 'expense');
      await ruleRef.set({ category, taxBucket: newBucket }, { merge: true });
      let fixed = 0;
      if (fixPast && rule.merchant) {
        const snap = await db.collection(`tenants/${tenantId}/transactions`)
          .where('clientOrVendor', '==', rule.merchant).get();
        const batch = db.batch();
        for (const d of snap.docs) {
          const t = d.data() as any;
          if (t.bankTransactionId && (t.context || 'Business') === (rule.context || 'Business')) {
            batch.set(d.ref, { category, taxBucket: newBucket }, { merge: true });
            fixed++;
          }
        }
        if (fixed > 0) await batch.commit();
      }
      await logAuditAdmin(db, tenantId, {
        action: 'rule.update', targetType: 'rule', targetId: ruleId,
        summary: `Rule updated: ${rule.merchant} → ${category}${fixed > 0 ? ` (repaired ${fixed} past entries)` : ''}`,
        before: { category: rule.category }, after: { category },
        actor,
      });
      return NextResponse.json({ ok: true, fixed });
    }
    if (action === 'rules-delete') {
      if (!body.ruleId) return NextResponse.json({ ok: false, error: 'Missing ruleId.' }, { status: 400 });
      const delRule = (await db.doc(`tenants/${tenantId}/vendorRules/${body.ruleId}`).get()).data() as any;
      await db.doc(`tenants/${tenantId}/vendorRules/${body.ruleId}`).delete();
      await logAuditAdmin(db, tenantId, {
        action: 'rule.delete', targetType: 'rule', targetId: body.ruleId,
        summary: `Rule forgotten: ${delRule?.merchant || body.ruleId} (was → ${delRule?.category || '?'})`,
        before: delRule || null, actor,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err: any) {
    console.error('[plaid] failed', err);
    return NextResponse.json({ ok: false, error: String(err?.message || 'Bank feed error').slice(0, 200) }, { status: 500 });
  }
}
