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
 *   { tenantId, clientId, amount, reason, staffId }
 *
 * Does NOT attempt any charge — this is purely a bookkeeping action for
 * debt the business has already decided not to keep pursuing.
 */

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

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const { tenantId, clientId, amount, reason, staffId } = body;
  if (!tenantId || !clientId || !amount || amount <= 0 || !reason || !staffId) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();

  const clientRef = db.doc(`tenants/${tenantId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();
  if (!clientSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }
  const client = clientSnap.data() || {};
  const currentBalance = Number(client.outstandingBalance || 0);
  const writeOffAmount = Math.min(amount, currentBalance);

  if (writeOffAmount <= 0) {
    return NextResponse.json({ ok: false, error: 'No outstanding balance to write off' }, { status: 400 });
  }

  const batch = db.batch();

  batch.update(clientRef, {
    outstandingBalance: FieldValue.increment(-writeOffAmount),
    // Only clear unpaidFees if writing off the full balance — a partial
    // write-off leaves the itemized fees in place so the remainder is still
    // traceable to what it was actually for.
    ...(writeOffAmount >= currentBalance ? { unpaidFees: [] } : {}),
    badDebtWrittenOff: FieldValue.increment(writeOffAmount),
  });

  const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  batch.set(txRef, {
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

  const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
  batch.set(auditRef, {
    id: auditRef.id, tenantId,
    entityType: 'debt_write_off',
    entityId: clientId,
    actorId: staffId,
    timestamp: now,
    summary: `$${writeOffAmount.toFixed(2)} written off as bad debt for ${client.name || 'client'} — ${reason}`,
    detail: { clientId, amount: writeOffAmount, originalBalance: currentBalance, reason },
  });

  await batch.commit();

  return NextResponse.json({ ok: true, writtenOff: writeOffAmount, remainingBalance: Math.max(0, currentBalance - writeOffAmount) });
}