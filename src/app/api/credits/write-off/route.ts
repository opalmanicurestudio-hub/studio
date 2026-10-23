/**
 * api/credits/write-off/route.ts
 *
 * Writes off an uncollectible client balance. Per the architecture spec:
 *   Bad Debt Expense +amount
 *   Accounts Receivable -amount (i.e. outstandingBalance cleared)
 *   Balance closed, no revenue distortion (the original revenue/fee stays
 *   recorded as-is — this only records the loss of NOT collecting it).
 *
 * POST body:
 *   { tenantId, clientId, amount, reason, staffId, attemptKey? }
 *
 * Does NOT attempt any charge — this is purely a bookkeeping action for
 * debt the business has already decided not to keep pursuing.
 *
 * Once, however often it's asked: the balance is read and brought down in one
 * step, together with the Bad Debt line, so it can never go below zero. The
 * line is named after this request — the screen's attempt key when it sends
 * one, otherwise the amount asked for and the balance it saw — so a double tap
 * (or a retry with the same key) writes it off once and gets the same answer.
 */

import { requireRole } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';

function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue }     = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}

const keyPart = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const { tenantId, clientId, amount, reason, staffId } = body;
  if (!tenantId || !clientId || !amount || amount <= 0 || !reason || !staffId) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }
  { const g = await requireRole(req, String(tenantId || ''), 'manager'); if (g.deny) return g.deny; }

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();

  const clientRef = db.doc(`tenants/${tenantId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();
  if (!clientSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }
  const seen: any = clientSnap.data() || {};
  // What this request is: its attempt key, or the amount asked for against the balance as it saw it.
  const key = keyPart(body.attemptKey) || `${Math.round(Number(amount) * 100)}_${Math.round((Number(seen.outstandingBalance) || 0) * 100)}_${keyPart(seen.balanceVersion).slice(0, 30) || 'v0'}`;
  const id = `baddebt_${keyPart(clientId)}_${key}`;
  const txRef = db.doc(`tenants/${tenantId}/transactions/${id}`);
  const auditRef = db.doc(`tenants/${tenantId}/auditLog/${id}`);

  const out: any = await db.runTransaction(async (tx: any) => {
    const cs = await tx.get(clientRef); const ls = await tx.get(txRef);
    // Written off already by this request (a second tap, or asked again after the answer was lost).
    if (ls.exists) { const l: any = ls.data() || {}; return { already: true, writtenOff: Number(l.amount) || 0, remaining: Math.max(0, Number((cs.data() || {}).outstandingBalance) || 0) }; }
    if (!cs.exists) return { missing: true };
    const client: any = cs.data() || {};
    const currentBalance = r2(Number(client.outstandingBalance || 0));
    const writeOffAmount = r2(Math.min(Number(amount), currentBalance));
    if (!(writeOffAmount > 0)) return { none: true };
    const left = r2(currentBalance - writeOffAmount);
    tx.set(clientRef, {
      outstandingBalance: left,
      // Only clear unpaidFees if writing off the full balance — a partial
      // write-off leaves the itemized fees in place so the remainder is still
      // traceable to what it was actually for.
      ...(writeOffAmount >= currentBalance ? { unpaidFees: [] } : {}),
      badDebtWrittenOff: FieldValue.increment(writeOffAmount),
      balanceVersion: now,
    }, { merge: true });
    tx.set(txRef, {
      id: txRef.id, tenantId, clientId,
      clientOrVendor: client.name || 'Client',
      date: now,
      type: 'expense', category: 'Bad Debt',
      amount: writeOffAmount, amountCents: Math.round(writeOffAmount * 100),
      paymentMethod: 'Internal Protocol',
      staffId, hasReceipt: false,
      description: `Bad Debt Write-Off: ${reason}`,
      notes: `Balance written off as uncollectible. Original balance: $${currentBalance.toFixed(2)}. Written off: $${writeOffAmount.toFixed(2)}.`,
    });
    tx.set(auditRef, {
      id: auditRef.id, tenantId,
      entityType: 'debt_write_off',
      entityId: clientId,
      actorId: staffId,
      timestamp: now,
      summary: `$${writeOffAmount.toFixed(2)} written off as bad debt for ${client.name || 'client'} — ${reason}`,
      detail: { clientId, amount: writeOffAmount, originalBalance: currentBalance, reason },
    });
    return { writtenOff: writeOffAmount, remaining: left };
  });
  if (out.missing) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  if (out.none) return NextResponse.json({ ok: false, error: 'No outstanding balance to write off' }, { status: 400 });

  return NextResponse.json({ ok: true, writtenOff: out.writtenOff, remainingBalance: out.remaining, ...(out.already ? { already: true } : {}) });
}
