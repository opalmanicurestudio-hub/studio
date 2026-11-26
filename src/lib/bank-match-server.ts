// src/lib/bank-match-server.ts — MATCH A BANK LINE TO WHAT'S IN THE BOOKS, AND UNDO IT (server; api/plaid, the Bank
// screen's Match to a sale; which lines can be is lib/bank-match).
//   Match   one line, or several that add up to it exactly (a check for three visits; a visit's sale, tax and tip). Nothing
//           new is booked: the bank line is the money for them. The one line the bank feed said was the same, a little
//           different: a cost logged by hand takes the bank's amount (in an open month); anything else keeps its amount
//           and the difference is booked as its own line (the rest of a cost, or money back on it). For a sale, the
//           whole payment is what's compared (the sale with its tax and tip), and what's left is asked: less came in (a
//           fee taken, or they paid less) or more (a tip for whoever did the visit, or other money).
//   Unmatch a match undone: its lines go back as they were (their amounts too), the difference line goes, and the bank
//           line waits to be sorted again. Never in a closed month.
//   tenants/{t}/bankTransactions/{id}.status 'matched', matchedTxnId, matchedTxnIds, matchedBy, diffTxnId
//   tenants/{t}/transactions/bankdiff_{id}  — the difference
import { FieldValue } from 'firebase-admin/firestore';
import { closeOf, datedFor, inClosedMonth, monthName } from './books-close';
import { bucketOf, lineCents, nearOk, notBankMoney, plainCost, saleKeyOf, saleOf } from './bank-match';

type Fail = { ok: false; error: string; status: number; ask?: 'extra' | 'short'; extraCents?: number; tipOk?: boolean };
const fail = (error: string, status = 409, more: Partial<Fail> = {}): Fail => ({ ok: false, error, status, ...more });
const usd = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
const what = (t: any) => String(t?.description || t?.clientOrVendor || t?.category || 'the line').slice(0, 60);
const closedName = (biz: any) => { const c = closeOf(biz); return c ? monthName(c.through, false) : 'Its month'; };
export const PENDING = 'It’s still pending at your bank. It can be sorted once it clears.';

/** Match bank line `bankTxnId` to books lines `ids`. `extra`: once asked, what the difference from a sale was: more
 *  ('tip' or 'other') or less ('fee' or 'less'). */
export async function matchBankLine(db: any, tenantId: string, biz: any, bankTxnId: string, picked: string[], extra?: unknown, nowIso = new Date().toISOString()): Promise<{ ok: true; diffCents: number } | Fail> {
  if (!picked.length) return fail('Pick what it’s for.', 400);
  const T = `tenants/${tenantId}`;
  const btRef = db.doc(`${T}/bankTransactions/${bankTxnId}`);
  const diffRef = db.doc(`${T}/transactions/bankdiff_${String(bankTxnId).replace(/[^A-Za-z0-9_-]/g, '')}`);
  return db.runTransaction(async (tx: any) => {
    let ids = [...picked];
    const b: any = (await tx.get(btRef)).data();
    if (!b || b.status !== 'unmatched') return fail('That bank line is sorted already.');
    if (b.pending) return fail(PENDING);
    const dir: 'in' | 'out' = b.direction === 'out' ? 'out' : 'in';
    // ("It's the same" on a sale: the whole payment it was part of, its tax and tip with it.)
    if (dir === 'in' && ids.length === 1 && ids[0] === b.suggestedMatchTxnId) {
      const first: any = (await tx.get(db.doc(`${T}/transactions/${ids[0]}`))).data(); const k = first ? saleKeyOf(first) : null;
      if (k) {
        const q: any = await tx.get(db.collection(`${T}/transactions`).where(k.field, '==', k.value));
        const key = saleOf(first);
        for (const d of q.docs) { const t: any = d.data(); if (d.id !== ids[0] && saleOf(t) === key && !notBankMoney(t, dir, b.context || 'Business') && ids.length < 20) ids = [...ids, d.id]; }
      }
    }
    const refs = ids.map((id) => db.doc(`${T}/transactions/${id}`));
    const docs = await Promise.all(refs.map((ref: any) => tx.get(ref)));
    let cents = 0;
    for (const d of docs) {
      const t: any = d.data();
      if (!t) return fail('One of those lines isn’t in your books any more.', 404);
      const why = notBankMoney(t, dir, b.context || 'Business'); if (why) return fail(why);
      cents += lineCents(t);
    }
    const bankC = Math.round(Number(b.amountCents) || 0); const diff = bankC - cents;
    const t0: any = docs[0].data();
    const near = ids[0] === b.suggestedMatchTxnId && (ids.length === 1 || dir === 'in') && diff !== 0 && Math.abs(diff) <= Math.max(500, Math.round(bankC * 0.1)) && nearOk(t0);
    if (diff !== 0 && !near) return fail(`Those come to ${usd(cents)}, and the bank line is ${usd(bankC)}. Pick lines that add up to it exactly.`);
    // (The difference: a cost logged by hand takes the bank's amount; anything else keeps its own, and the rest is booked.)
    let rewrite = false; let diffLine: any = null;
    const staff = String(docs.map((x: any) => x.data()?.staffId).find(Boolean) || '');
    if (near) {
      const d = what(t0);
      if (dir === 'out' && plainCost(t0) && !inClosedMonth(biz, t0.date)) rewrite = true;
      else if (dir === 'out') diffLine = diff > 0
        ? { type: 'expense', category: t0.category || 'Other', taxBucket: bucketOf(t0), description: `${d}: the rest the bank paid (shipping, tax or the like)` }
        : { type: 'income', category: t0.category || 'Other', taxBucket: bucketOf(t0), description: `${d}: money back on it` };
      else if (diff < 0 && extra === 'fee') diffLine = { type: 'expense', category: 'Processing Fee', taxBucket: 'processing_fee', description: `Fee taken from ${d}` };
      // (They paid less than the sale: what wasn't paid comes off the sale, as a discount.)
      else if (diff < 0 && extra === 'less') diffLine = { type: 'expense', category: 'Discounts', taxBucket: 'adjustment', description: `Less paid than ${d} came to` };
      else if (diff < 0) return fail(`${usd(diff)} less than the sale came in. Was it a fee taken, or did they pay less?`, 409, { ask: 'short', extraCents: diff });
      // (A tip is for whoever did the visit: with nobody on the sale, it can only be other money in.)
      else if (extra === 'tip' && staff) diffLine = { type: 'income', category: 'Tips', taxBucket: 'gratuity', description: `Tip with ${d}`, staffId: staff, ...(t0.appointmentId ? { appointmentId: t0.appointmentId } : {}) };
      else if (extra === 'other') diffLine = { type: 'income', category: 'Other Income', taxBucket: 'revenue', description: `More than ${d} came to` };
      else return fail(`${usd(diff)} more than the sale came in. ${staff ? 'Was the extra a tip?' : 'What was the extra?'}`, 409, { ask: 'extra', extraCents: diff, tipOk: !!staff });
    }
    tx.set(btRef, { status: 'matched', matchedTxnId: ids[0], ...(ids.length > 1 ? { matchedTxnIds: ids } : {}), resolvedAt: nowIso, matchedBy: 'you', ...(diffLine ? { diffTxnId: diffRef.id } : {}) }, { merge: true });
    for (const ref of refs) tx.set(ref, { reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId, ...(rewrite ? { amount: bankC / 100, amountWas: cents / 100, amountFromBank: true } : {}) }, { merge: true });
    if (diffLine) tx.set(diffRef, { id: diffRef.id, tenantId, context: t0.context || b.context || 'Business', amount: Math.abs(diff) / 100, ...diffLine,
      clientOrVendor: t0.clientOrVendor || b.merchant || b.name || '', ...datedFor(biz, `${String(b.date).slice(0, 10)}T12:00:00.000Z`), paymentMethod: 'Bank feed', hasReceipt: false,
      reconciled: true, reconciledAt: nowIso, bankTransactionId: bankTxnId, differenceFor: ids[0], sortedBy: 'you', createdAt: nowIso });
    return { ok: true as const, diffCents: rewrite || !near ? 0 : diff };
  });
}

/** Undo a match: its lines as they were, its difference line gone, the bank line back to sort. */
export async function unmatchBankLine(db: any, tenantId: string, biz: any, bankTxnId: string, nowIso = new Date().toISOString()): Promise<{ ok: true; lines: number } | Fail> {
  const T = `tenants/${tenantId}`; const btRef = db.doc(`${T}/bankTransactions/${bankTxnId}`);
  return db.runTransaction(async (tx: any) => {
    const b: any = (await tx.get(btRef)).data();
    if (!b || b.status !== 'matched') return fail('Only a line matched to your books can be undone here.');
    const ids: string[] = (Array.isArray(b.matchedTxnIds) && b.matchedTxnIds.length ? b.matchedTxnIds : [b.matchedTxnId]).filter(Boolean).map(String);
    const refs = ids.map((id) => db.doc(`${T}/transactions/${id}`)); const docs = await Promise.all(refs.map((r: any) => tx.get(r)));
    const diffRef = b.diffTxnId ? db.doc(`${T}/transactions/${b.diffTxnId}`) : null; const dl: any = diffRef ? (await tx.get(diffRef)).data() : null;
    for (const d of docs) { const t: any = d.data(); if (t?.amountFromBank && t.bankTransactionId === bankTxnId && inClosedMonth(biz, t.date)) return fail(`${closedName(biz)} is closed, and matching changed ${what(t)}’s amount. Add a correction dated today instead.`); }
    if (dl && inClosedMonth(biz, dl.date)) return fail(`The difference booked with it is in ${closedName(biz)}, which is closed. Add a correction dated today instead.`);
    let lines = 0;
    docs.forEach((d: any, i: number) => {
      const t: any = d.data(); if (!t || t.bankTransactionId !== bankTxnId) return;
      lines++;
      tx.set(refs[i], { reconciled: FieldValue.delete(), reconciledAt: FieldValue.delete(), bankTransactionId: FieldValue.delete(),
        ...(t.amountFromBank ? { amount: Number(t.amountWas) || 0, amountWas: FieldValue.delete(), amountFromBank: FieldValue.delete() } : {}), updatedAt: nowIso }, { merge: true });
    });
    if (dl && diffRef) tx.delete(diffRef);
    tx.set(btRef, { status: 'unmatched', matchedTxnId: FieldValue.delete(), matchedTxnIds: FieldValue.delete(), matchedBy: FieldValue.delete(), resolvedAt: FieldValue.delete(), diffTxnId: FieldValue.delete(), unmatchedAt: nowIso }, { merge: true });
    return { ok: true as const, lines };
  });
}
