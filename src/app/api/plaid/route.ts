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
 *   resolve        → owner action from the review inbox: 'match' to what's
 *                    in the books already (lib/bank-match-server), 'create' a
 *                    new categorized ledger txn from the bank line, or
 *                    'ignore'. Each claims the line first: one already sorted
 *                    (on another device, by Book all, by the sync) or still
 *                    pending is left as it is.
 *   unmatch        → a match undone (lib/bank-match-server)
 *   recategorize   → a line booked from the bank put under another category
 *   status         → the connected accounts, and any asking to sign in again
 *   relinked       → an account signed in again (link-token with itemId opens
 *                    the bank's sign-in for it)
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

import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { bucketFor, findCategory } from '@/lib/categories';
import { matchBankLine, unmatchBankLine, PENDING } from '@/lib/bank-match-server';
import { dropBankTaxMark } from '@/lib/payroll-tax-marks';
import { coverWithPayday, paydayPlanFor } from '@/lib/payroll-bank';
// v62 — sync engine + helpers extracted to a shared lib so the nightly
// cron (/api/cron/nightly) runs the exact same logic as the Sync button.
import { plaid, vendorKey, syncTenantBankFeed } from '@/lib/plaid-sync';
import { logAuditAdmin } from '@/lib/audit';
import { closeOf, datedFor, inClosedMonth, monthName } from '@/lib/books-close';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    { const g = await requireRole(req, String(tenantId || ''), 'owner'); if (g.deny) return g.deny;
      // Bank feeds are part of Automated bookkeeping: off, no new bank is connected and nothing new is pulled in
      // (rules and what's already there stay as they are) (lib/tool-lock).
      if (['link-token', 'exchange', 'sync'].includes(String(action))) { const locked = toolLocked(g.tenant, ['money']); if (locked) return locked; } }
    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing tenantId.' }, { status: 400 });
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      console.error('[plaid] PLAID_CLIENT_ID / PLAID_SECRET are not set'); return NextResponse.json({ ok: false, error: 'Bank connections aren’t available yet.' }, { status: 500 });
    }
    const db = getAdminDb();
    // (A line booked for a month that's closed goes in today, saying the day it was for: lib/books-close.)
    const biz: any = ['resolve', 'accept-all', 'recategorize', 'rules-update', 'unmatch'].includes(String(action)) ? (await db.doc(`tenants/${tenantId}`).get()).data() || {} : {};

    // Acting team member, forwarded by the client for audit attribution.
    // TODO(hardening): verify a Firebase Auth ID token here instead of
    // trusting the client-sent identity — the shape is ready for it.
    const actor = (body?.actor && body.actor.type === 'user')
      ? { type: 'user' as const, id: body.actor.id || undefined, name: body.actor.name || undefined, role: body.actor.role || undefined }
      : { type: 'user' as const };

    // ── link-token ────────────────────────────────────────────────────
    if (action === 'link-token') {
      // (With itemId: the bank's sign-in again, for an account that asked for it. Its lines and rules stay as they are.)
      const item = body.itemId ? await itemOf(db, tenantId, String(body.itemId)) : null;
      if (body.itemId && !item) return NextResponse.json({ ok: false, error: 'That account isn’t connected any more.' }, { status: 404 });
      const data = await plaid('/link/token/create', {
        user: { client_user_id: tenantId },
        client_name: 'ClarityFlow',
        ...(item ? { access_token: item.accessToken } : { products: ['transactions'], transactions: { days_requested: 90 } }),   // cap history: first sync stays fast
        country_codes: ['US'],
        language: 'en',
      });
      return NextResponse.json({ ok: true, linkToken: data.link_token });
    }

    // ── status: the connected accounts (never their keys) ─────────────
    if (action === 'status') {
      const snap = await db.collection(`tenants/${tenantId}/plaidItems`).get();
      const legacy: any = (await db.doc(`tenants/${tenantId}/private/plaid`).get()).data();
      const items = snap.docs.map((d: any) => { const x: any = d.data() || {}; return { id: d.id, institution: x.institution || null, label: x.label || 'Business', needsLogin: !!x.needsLogin, lastSyncAt: x.lastSyncAt || null }; });
      if (legacy?.accessToken && !snap.docs.some((d: any) => (d.data() as any)?.accessToken === legacy.accessToken)) items.push({ id: 'legacy', institution: legacy.institution || null, label: 'Business', needsLogin: !!legacy.needsLogin, lastSyncAt: legacy.lastSyncAt || null });
      return NextResponse.json({ ok: true, items });
    }
    if (action === 'relinked') {
      const item = await itemOf(db, tenantId, String(body.itemId || ''));
      if (!item) return NextResponse.json({ ok: false, error: 'That account isn’t connected any more.' }, { status: 404 });
      await item.ref.set({ needsLogin: false, relinkedAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: true });
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
      const { mode, category, taxBucket } = body;
      const bankTxnId = String(body.bankTxnId || '');
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(bankTxnId)) return NextResponse.json({ ok: false, error: 'Which line?' }, { status: 400 });
      const btRef = db.doc(`tenants/${tenantId}/bankTransactions/${bankTxnId}`);
      const bt = (await btRef.get()).data() as any;
      if (!bt) return NextResponse.json({ ok: false, error: 'Bank transaction not found.' }, { status: 404 });
      const nowIso = new Date().toISOString();
      const sortedAlready = { ok: false, error: 'That bank line is sorted already.' };

      if (mode === 'ignore') {
        // (Claimed first: a line sorted meanwhile, on another device or by the sync, stays as it is.)
        const r = await db.runTransaction(async (tx: any) => {
          const b: any = (await tx.get(btRef)).data();
          if (!b || b.status !== 'unmatched') return false;
          tx.set(btRef, { status: 'ignored', resolvedAt: nowIso }, { merge: true }); return true;
        });
        if (!r) return NextResponse.json(sortedAlready, { status: 409 });
        // (A payroll tax payment, ignored: it no longer counts as paying it.)
        if (bt.taxPayKey) await dropBankTaxMark(db, tenantId, bankTxnId, bt.taxPayKey, actor);
        await logAuditAdmin(db, tenantId, {
          action: 'bank.ignore', targetType: 'bankTransaction', targetId: bankTxnId,
          summary: `Ignored bank line: ${bt.merchant || bt.name}`,
          amount: bt.amountCents / 100, actor,
        });
        return NextResponse.json({ ok: true });
      }
      // Match to what's in the books already ("Match to a sale"): one line, or several that add up to it (a check for
      // three visits; a visit's sale, tax and tip). lib/bank-match-server.
      const ids: string[] = [...new Set((Array.isArray(body.ledgerTxnIds) ? body.ledgerTxnIds : body.ledgerTxnId ? [body.ledgerTxnId] : []).map((x: any) => String(x || '')).filter((x: string) => /^[A-Za-z0-9_-]{1,160}$/.test(x)))].slice(0, 20) as string[];
      if (mode === 'match' && ids.length) {
        const r: any = await matchBankLine(db, tenantId, biz, bankTxnId, ids, body.extra, nowIso);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error, ...(r.ask ? { ask: r.ask, extraCents: r.extraCents, tipOk: !!r.tipOk } : {}) }, { status: r.status });
        // (A payroll tax payment matched to lines that aren't payday's payroll taxes: it isn't paying them.)
        if (bt.taxPayKey) {
          const cats = await Promise.all(ids.map((id) => db.doc(`tenants/${tenantId}/transactions/${id}`).get().then((x: any) => String(x.data()?.category || '')).catch(() => '')));
          if (!cats.every((c) => /^payroll tax(es| deposit)$/i.test(c))) await dropBankTaxMark(db, tenantId, bankTxnId, bt.taxPayKey, actor);
        }
        await logAuditAdmin(db, tenantId, {
          action: 'bank.match', targetType: 'bankTransaction', targetId: bankTxnId,
          summary: `Matched bank line ${bt.merchant || bt.name} to ${ids.length === 1 ? 'a line' : `${ids.length} lines`} already in the books${r.diffCents ? `, with the $${(Math.abs(r.diffCents) / 100).toFixed(2)} difference booked` : ''}`,
          amount: bt.amountCents / 100, actor,
        });
        return NextResponse.json({ ok: true, diffCents: r.diffCents });
      }
      if (mode === 'create') {
        // v61 — the review inbox can now (a) override the suggested category
        // with a pick from the shared library (categoryOverride) and
        // (b) attach a receipt image captured during reconciliation
        // (receiptUrl). The learned rule remembers the corrected category,
        // and an overridden category derives its report-color taxBucket
        // from the library so the print report stays accurate.
        // (The way the money went decides the side: money in under a cost's category is money back on that cost, never a
        // second cost. Money out is never a sale.)
        const finalType: 'income' | 'expense' = bt.direction === 'out' ? 'expense' : 'income';
        const finalCategory = String(body.categoryOverride || category || bt.suggestedCategory || 'Uncategorized').slice(0, 80);
        const def = findCategory(finalCategory);
        if (finalType === 'expense' && def?.type === 'income' && def.taxBucket !== 'transfer') return NextResponse.json({ ok: false, error: `Money out can’t be ${def.name}. If you gave money back, pick Refunds.` }, { status: 400 });
        const finalBucket = taxBucket || bucketOfBooked(finalCategory, finalType, body.categoryOverride ? null : bt.suggestedTaxBucket);
        const receiptUrl = typeof body.receiptUrl === 'string' && body.receiptUrl ? body.receiptUrl : null;
        // v69 — bank-line-as-bill-payment: when the inbox line was matched
        // to an unpaid bill and the owner kept the link, booking it ALSO
        // marks the bill instance paid — one tap, no drift.
        const billInstanceId = typeof body.billInstanceId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(body.billInstanceId) ? body.billInstanceId : null;
        const ctx = body.contextOverride === 'Business' ? 'Business' : (bt.context || 'Business');

        // (Payroll paid through a payroll company, after payday was recorded: matched to payday's pay, never booked twice;
        // only what's beyond it is booked, as payroll taxes. lib/payroll-bank.)
        if (finalType === 'expense' && ctx === 'Business' && /^payroll( taxes)?$/i.test(finalCategory) && !billInstanceId) {
          const pc = await coverWithPayday(db, tenantId, biz, { id: bankTxnId, amountCents: Number(bt.amountCents) || 0, date: String(bt.date), context: 'Business', name: bt.merchant || bt.name }, nowIso, { write: true });
          if (pc === 'sorted') return NextResponse.json(sortedAlready, { status: 409 });
          if (pc) {
            await logAuditAdmin(db, tenantId, { action: 'bank.match', targetType: 'bankTransaction', targetId: bankTxnId,
              summary: `Matched bank line ${bt.merchant || bt.name} to payday’s pay already in the books${pc.plan.extra > 0 ? `, with $${(pc.plan.extra / 100).toFixed(2)} beyond it booked as payroll taxes` : ''}`, amount: bt.amountCents / 100, actor });
            return NextResponse.json({ ok: true, payday: true, extraCents: pc.plan.extra });
          }
        }
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        const billRef = billInstanceId ? db.doc(`tenants/${tenantId}/billInstances/${billInstanceId}`) : null;
        // (Claimed first, in one step with the booking: a line matched or booked meanwhile is never booked twice.)
        const r: any = await db.runTransaction(async (tx: any) => {
          const b: any = (await tx.get(btRef)).data();
          if (!b || b.status !== 'unmatched') return sortedAlready;
          if (b.pending) return { ok: false, error: PENDING };
          const bill: any = billRef ? (await tx.get(billRef)).data() : null;
          tx.set(txnRef, {
            id: txnRef.id,
            type: finalType,
            context: ctx,
            taxBucket: finalBucket,
            amount: b.amountCents / 100,
            category: finalCategory,
            description: b.merchant || b.name,
            clientOrVendor: b.merchant || b.name,
            ...datedFor(biz, b.date + 'T12:00:00.000Z'),
            paymentMethod: 'Bank feed',
            hasReceipt: !!receiptUrl,
            ...(receiptUrl ? { receiptUrl } : {}),
            ...(billInstanceId ? { relatedBillInstanceId: billInstanceId } : {}),
            reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId,
            sortedBy: 'you', tenantId, createdAt: nowIso,
          });
          if (billRef && bill && bill.status !== 'paid') tx.set(billRef, {
            status: 'paid', paidDate: nowIso, paidAmount: b.amountCents / 100,
            paidVia: 'bank-feed', bankTransactionId: bankTxnId, transactionId: txnRef.id,
          }, { merge: true });
          tx.set(btRef, { status: 'created', matchedTxnId: txnRef.id, resolvedAt: nowIso, ...(receiptUrl ? { receiptUrl } : {}) }, { merge: true });
          return { ok: true };
        });
        if (!r.ok) return NextResponse.json(r, { status: 409 });
        if (bt.taxPayKey && !/^payroll tax(es| deposit)$/i.test(finalCategory)) await dropBankTaxMark(db, tenantId, bankTxnId, bt.taxPayKey, actor);
        // Learn: this merchant now books itself on every future sync —
        // under the category the owner actually chose, not just the guess.
        // (Never from a line moved to the other books: one shop run on a personal card doesn't make every later
        // purchase there the business's.)
        const vk = vendorKey(bt.merchant || bt.name);
        const moved = ctx !== (bt.context || 'Business');
        if (vk && !moved) {
          await db.doc(`tenants/${tenantId}/vendorRules/${String(bt.context || 'Business').toLowerCase()}:${vk}`).set({
            merchant: bt.merchant || bt.name,
            category: finalCategory,
            taxBucket: finalBucket,
            type: finalType,
            context: ctx, learnedAt: nowIso,
          }, { merge: true });
        }
        await logAuditAdmin(db, tenantId, {
          action: billInstanceId ? 'bill.pay' : 'bank.book',
          targetType: 'transaction', targetId: txnRef.id,
          summary: billInstanceId
            ? `Bill paid from bank feed: ${bt.suggestedBillName || 'bill'} (${bt.merchant || bt.name})${receiptUrl ? ' — receipt attached' : ''}`
            : `Booked bank line ${bt.merchant || bt.name} as ${finalCategory}${receiptUrl ? ' (receipt attached)' : ''} — rule learned`,
          amount: bt.amountCents / 100, actor,
        });
        return NextResponse.json({ ok: true, ruleLearned: !!vk && !moved });
      }
      return NextResponse.json({ ok: false, error: 'Unknown resolve mode.' }, { status: 400 });
    }

    // unmatch — a match undone (lib/bank-match-server): its lines as they were, the bank line back to sort.
    // (A payroll tax payment's mark stays: the line waits to be sorted again, and how it's sorted then decides.)
    if (action === 'unmatch') {
      const bankTxnId = String(body.bankTxnId || '');
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(bankTxnId)) return NextResponse.json({ ok: false, error: 'Which line?' }, { status: 400 });
      const r: any = await unmatchBankLine(db, tenantId, biz, bankTxnId);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
      await logAuditAdmin(db, tenantId, { action: 'bank.unmatch', targetType: 'bankTransaction', targetId: bankTxnId, summary: `A bank line’s match was undone: it waits to be sorted again`, actor });
      return NextResponse.json({ ok: true });
    }

    // accept-all — one tap books every review line with its suggestion
    // AND learns each merchant, so next month's inbox is near-empty.
    if (action === 'accept-all') {
      const snap = await db.collection(`tenants/${tenantId}/bankTransactions`).where('status', '==', 'unmatched').get();
      const nowIso = new Date().toISOString();
      let booked = 0;
      for (const d of snap.docs) {
        const w: any = d.data() || {};
        if (w.pending) continue;
        // (Payroll after payday was recorded: matched to payday's pay, as Book does.)
        if (w.direction === 'out' && (w.context || 'Business') === 'Business' && /^payroll( taxes)?$/i.test(String(w.suggestedCategory || '')) && !w.suggestedBillInstanceId) {
          const pc = await coverWithPayday(db, tenantId, biz, { id: d.id, amountCents: Number(w.amountCents) || 0, date: String(w.date), context: 'Business', name: w.merchant || w.name }, nowIso, { write: true });
          if (pc === 'sorted') continue;
          if (pc) { booked++; continue; }
        }
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        // (Each line claimed as it's booked: one matched, booked or skipped since the list was read is left as it is.)
        const bt: any = await db.runTransaction(async (tx: any) => {
          const b: any = (await tx.get(d.ref)).data();
          if (!b || b.status !== 'unmatched' || b.pending) return null;
          const type: 'income' | 'expense' = b.direction === 'out' ? 'expense' : 'income';
          const category = b.suggestedCategory || 'Uncategorized';
          // (Money out under a sale's category waits for her, as Book refuses it.)
          const def = findCategory(category); if (type === 'expense' && def?.type === 'income' && def.taxBucket !== 'transfer') return null;
          const bucket = bucketOfBooked(category, type, b.suggestedTaxBucket);
          const billRef = b.suggestedBillInstanceId ? db.doc(`tenants/${tenantId}/billInstances/${b.suggestedBillInstanceId}`) : null;
          const bill: any = billRef ? (await tx.get(billRef)).data() : null;
          tx.set(txnRef, {
            id: txnRef.id, type,
            context: b.context || 'Business', taxBucket: bucket,
            amount: b.amountCents / 100, category,
            description: b.merchant || b.name, clientOrVendor: b.merchant || b.name,
            ...datedFor(biz, b.date + 'T12:00:00.000Z'), paymentMethod: 'Bank feed', hasReceipt: false,
            ...(b.suggestedBillInstanceId ? { relatedBillInstanceId: b.suggestedBillInstanceId } : {}),
            reconciled: true, reconciledAt: nowIso, bankTransactionId: d.id, sortedBy: 'you', tenantId, createdAt: nowIso,
          });
          // v69 — accept-all honors bill matches too: accepting the
          // suggestion also marks the matched bill instance paid.
          if (billRef && bill && bill.status !== 'paid') tx.set(billRef, {
            status: 'paid', paidDate: nowIso, paidAmount: b.amountCents / 100,
            paidVia: 'bank-feed', bankTransactionId: d.id, transactionId: txnRef.id,
          }, { merge: true });
          tx.set(d.ref, { status: 'created', matchedTxnId: txnRef.id, resolvedAt: nowIso }, { merge: true });
          return { ...b, type, category, bucket };
        });
        if (!bt) continue;
        if (bt.taxPayKey && !/^payroll tax(es| deposit)$/i.test(String(bt.category))) await dropBankTaxMark(db, tenantId, d.id, bt.taxPayKey, actor);
        const vk = vendorKey(bt.merchant || bt.name);
        if (vk) await db.doc(`tenants/${tenantId}/vendorRules/${(bt.context || 'Business').toLowerCase()}:${vk}`).set({
          merchant: bt.merchant || bt.name, category: bt.category,
          taxBucket: bt.bucket, type: bt.type,
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

    // recategorize — a line the app sorted (or one you booked) put under another category: its books line changes (never
    // in a closed month), and lines from that payee follow from now on (its learned rule). It stays where it was on the
    // Bank screen, to change again.
    if (action === 'recategorize') {
      const bankTxnId = String(body.bankTxnId || ''); const category = String(body.category || '').trim().slice(0, 80);
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(bankTxnId) || !category) return NextResponse.json({ ok: false, error: 'Which line, and what is it?' }, { status: 400 });
      const btRef = db.doc(`tenants/${tenantId}/bankTransactions/${bankTxnId}`);
      const bt: any = (await btRef.get()).data();
      if (!bt || !['auto_categorized', 'created'].includes(String(bt.status)) || !bt.matchedTxnId) return NextResponse.json({ ok: false, error: 'Only a line booked from the bank can be changed here.' }, { status: 409 });
      const tRef = db.doc(`tenants/${tenantId}/transactions/${bt.matchedTxnId}`); const t: any = (await tRef.get()).data();
      if (!t) return NextResponse.json({ ok: false, error: 'Its line isn’t in your books any more.' }, { status: 404 });
      if (inClosedMonth(biz, t.date)) { const c = closeOf(biz); return NextResponse.json({ ok: false, error: `${c ? monthName(c.through, false) : 'Its month'} is closed, so it stays as it is. Add a correction dated today instead.` }, { status: 409 }); }
      const type: 'income' | 'expense' = bt.direction === 'out' ? 'expense' : 'income';
      const def = findCategory(category);
      if (type === 'expense' && def?.type === 'income' && def.taxBucket !== 'transfer') return NextResponse.json({ ok: false, error: `Money out can’t be ${def.name}. If you gave money back, pick Refunds.` }, { status: 400 });
      const bucket = bucketOfBooked(category, type);
      const nowIso = new Date().toISOString();
      // (A payroll tax payment changed to something else: it no longer counts as paying it.)
      if (bt.taxPayKey && !/^payroll tax(es| deposit)$/i.test(category)) await dropBankTaxMark(db, tenantId, bankTxnId, bt.taxPayKey, actor);
      // (Into payroll, after payday was recorded: the line is handed back and matched to payday's pay instead, so it isn't
      // counted twice; only what's beyond it is booked, as payroll taxes. lib/payroll-bank.)
      const bAt = { id: bankTxnId, amountCents: Number(bt.amountCents) || 0, date: String(bt.date), context: 'Business', name: bt.merchant || bt.name };
      if (type === 'expense' && String(t.context || 'Business') === 'Business' && /^payroll( taxes)?$/i.test(category) && !t.paydayPeriod && !t.bankCover && await paydayPlanFor(db, tenantId, biz, bAt)) {
        const back = await db.runTransaction(async (tx: any) => {
          const b: any = (await tx.get(btRef)).data(); const l: any = (await tx.get(tRef)).data();
          if (!b || !l || String(b.matchedTxnId) !== String(bt.matchedTxnId) || !['auto_categorized', 'created'].includes(String(b.status))) return false;
          tx.delete(tRef);
          tx.set(btRef, { status: 'unmatched', matchedTxnId: null, appliedRule: null, changedAt: nowIso, changedBy: 'you' }, { merge: true });
          return true;
        });
        if (!back) return NextResponse.json({ ok: false, error: 'That bank line changed meanwhile. Look at it again.' }, { status: 409 });
        const pc = await coverWithPayday(db, tenantId, biz, bAt, nowIso, { write: true });
        if (pc && pc !== 'sorted') {
          await logAuditAdmin(db, tenantId, { action: 'bank.match', targetType: 'bankTransaction', targetId: bankTxnId,
            summary: `${bt.merchant || bt.name} changed to ${category}, and matched to payday’s pay already in the books${pc.plan.extra > 0 ? `, with $${(pc.plan.extra / 100).toFixed(2)} beyond it booked as payroll taxes` : ''}`, amount: bt.amountCents / 100, actor });
          return NextResponse.json({ ok: true, payday: true, extraCents: pc.plan.extra });
        }
        // (Payday's pay was matched meanwhile: booked as asked, as it was.)
        const nRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await db.runTransaction(async (tx: any) => {
          const b: any = (await tx.get(btRef)).data(); if (!b || b.status !== 'unmatched') return;
          const { id: _old, ...rest } = t;
          tx.set(nRef, { ...rest, id: nRef.id, category, taxBucket: bucket, type, sortedBy: 'you', autoCategorized: false, updatedAt: nowIso });
          tx.set(btRef, { status: String(bt.status), matchedTxnId: nRef.id, appliedRule: category }, { merge: true });
        });
        return NextResponse.json({ ok: true });
      }
      await tRef.set({ category, taxBucket: bucket, type, sortedBy: 'you', autoCategorized: false, updatedAt: nowIso }, { merge: true });
      await btRef.set({ appliedRule: category, changedAt: nowIso, changedBy: 'you' }, { merge: true });
      const vk = vendorKey(bt.merchant || bt.name);
      // (Not from a line booked into the other books: lines from that payee keep to their own account's books.)
      const ctx = String(t.context || bt.context || 'Business');
      if (vk && ctx === String(bt.context || 'Business')) {
        await db.doc(`tenants/${tenantId}/vendorRules/${ctx.toLowerCase()}:${vk}`).set({ merchant: bt.merchant || bt.name, category, taxBucket: bucket, type, context: ctx, learnedAt: nowIso }, { merge: true });
      }
      await logAuditAdmin(db, tenantId, { action: 'bank.recategorize', targetType: 'transaction', targetId: String(bt.matchedTxnId),
        summary: `${bt.merchant || bt.name} changed from ${t.category || 'no category'} to ${category}; lines from that payee follow`, amount: bt.amountCents / 100, actor });
      return NextResponse.json({ ok: true });
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
        // (Only lines booked from the bank, never one logged by hand and then matched, and never a line in a closed month:
        // lib/books-close. Written a few hundred at a time.)
        const fix = snap.docs.filter((d: any) => { const t = d.data() as any;
          return t.bankTransactionId && t.paymentMethod === 'Bank feed' && (t.context || 'Business') === (rule.context || 'Business') && !inClosedMonth(biz, t.date); });
        for (let i = 0; i < fix.length; i += 400) {
          const batch = db.batch();
          for (const d of fix.slice(i, i + 400)) batch.set(d.ref, { category, taxBucket: newBucket }, { merge: true });
          await batch.commit();
        }
        fixed = fix.length;
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

/** Where a line booked from the bank goes: the bank feed's guess when it made one, else its category's own place. Money
 *  in with no category of its own (Uncategorized, Other) is money in, never money back on a cost. */
function bucketOfBooked(category: string, type: 'income' | 'expense', guess?: string | null): string {
  if (type === 'income' && /^(uncategorized|other)$/i.test(category.trim())) return 'revenue';
  return guess || bucketFor(category, type);
}

/** A connected account by id ('legacy': the first one, kept before accounts had their own docs). */
async function itemOf(db: any, tenantId: string, itemId: string): Promise<{ ref: any; accessToken: string } | null> {
  if (itemId === 'legacy') { const ref = db.doc(`tenants/${tenantId}/private/plaid`); const x: any = (await ref.get()).data(); return x?.accessToken ? { ref, accessToken: x.accessToken } : null; }
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(itemId)) return null;
  const ref = db.doc(`tenants/${tenantId}/plaidItems/${itemId}`); const x: any = (await ref.get()).data();
  return x?.accessToken ? { ref, accessToken: x.accessToken } : null;
}
