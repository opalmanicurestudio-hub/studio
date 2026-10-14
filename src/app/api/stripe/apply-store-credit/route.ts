/**
 * app/api/stripe/apply-store-credit/route.ts
 *
 * Applies store credit at checkout. Supports partial application
 * (e.g. client has $30 credit but owes $50 — apply $30, charge $20).
 *
 * POST body:
 *   { tenantId, clientId, appointmentId, amountToApply, staffId }
 *
 * Returns:
 *   { ok, appliedAmount, remainingBalance, creditIdsUsed }
 *
 * Logic:
 *   1. Load client's available credits (oldest first — FIFO)
 *   2. Consume credits up to amountToApply
 *   3. Mark consumed credits as used in Firestore
 *   4. Write a transaction record
 *   5. Return how much was applied and what's left to charge
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

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { tenantId, clientId, appointmentId, amountToApply, staffId } = body;
  { const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny; }

  if (!tenantId || !clientId || !appointmentId || !amountToApply || amountToApply <= 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();

  // ── Load client ───────────────────────────────────────────────────────────
  const clientRef  = db.doc(`tenants/${tenantId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();
  if (!clientSnap.exists) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const clientData   = clientSnap.data();
  const allCredits   = (clientData.storeCredits || []) as any[];
  const nowDate      = new Date();

  // ── Filter to available, sort oldest first (FIFO) ────────────────────────
  const available = allCredits
    .filter((c: any) => {
      if (c.status === 'used' || c.usedAt) return false;
      if (c.expiresAt && new Date(c.expiresAt) < nowDate) return false;
      return true;
    })
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const totalAvailable = available.reduce((sum: number, c: any) => sum + c.amount, 0);

  if (totalAvailable === 0) {
    return NextResponse.json({ ok: false, error: 'No available credits', appliedAmount: 0, remainingBalance: amountToApply, creditIdsUsed: [] });
  }

  // ── Consume credits FIFO up to amountToApply ─────────────────────────────
  const toApply    = Math.min(amountToApply, totalAvailable);
  let   remaining  = toApply;
  const usedIds: string[] = [];
  const leftovers: any[] = [];
  // Oldest first, matching the list above. A credit bigger than what's left is used for that much, and the rest stays
  // available as its own credit with the same end date (before, the remainder was lost).
  const order = new Map(available.map((c: any, i: number) => [c.id, i]));
  const updatedCredits    = [...allCredits].sort((a: any, b: any) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)).map((c: any) => {
    if (remaining <= 0.0001) return c;
    if (c.status === 'used' || c.usedAt || (c.status && c.status !== 'available')) return c;
    if (c.expiresAt && new Date(c.expiresAt) < nowDate) return c;
    if (!usedIds.includes(c.id)) {
      const amt = Number(c.amount) || 0; const take = Math.min(amt, remaining);
      remaining = parseFloat((remaining - take).toFixed(2));
      usedIds.push(c.id);
      const rest = parseFloat((amt - take).toFixed(2));
      if (rest > 0) leftovers.push({ ...c, id: `${c.id}_r${Date.now().toString(36)}`, amount: rest, amountCents: Math.round(rest * 100), status: 'available', usedAt: null, usedOnAppointmentId: null, splitFrom: c.id, createdAt: c.createdAt });
      return { ...c, status: 'used', usedAt: now, usedOnAppointmentId: appointmentId, ...(rest > 0 ? { amount: take, amountCents: Math.round(take * 100), originalAmount: amt } : {}) };
    }
    return c;
  }).concat(leftovers);

  const appliedAmount    = parseFloat(toApply.toFixed(2));
  const remainingBalance = parseFloat(Math.max(0, amountToApply - appliedAmount).toFixed(2));

  // ── Write to Firestore ────────────────────────────────────────────────────
  const batch = db.batch();

  // Update client's credit array
  batch.update(clientRef, {
    storeCredits:     updatedCredits,
    totalStoreCredit: FieldValue.increment(-appliedAmount),
  });

  // Update appointment to record credit was applied
  batch.update(db.doc(`tenants/${tenantId}/appointments/${appointmentId}`), {
    storeCreditApplied:       true,
    storeCreditAppliedAmount: appliedAmount,
    storeCreditAppliedAt:     now,
    storeCreditIdsUsed:       usedIds,
  });

  // Transaction record
  const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  batch.set(txRef, {
    id:            txRef.id,
    tenantId,
    appointmentId,
    clientId,
    clientName:    clientData.name || 'Client',
    type:          'store_credit_redemption',
    category:      'Store Credit Applied',
    amount:        -appliedAmount,          // negative = reducing what client owes
    amountCents:   -Math.round(appliedAmount * 100),
    status:        'applied',
    creditIdsUsed: usedIds,
    appliedBy:     staffId || 'system',
    createdAt:     now,
  });

  // Audit log
  const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
  batch.set(auditRef, {
    id:         auditRef.id,
    tenantId,
    entityType: 'store_credit_applied',
    entityId:   appointmentId,
    actorId:    staffId || 'system',
    timestamp:  now,
    summary:    `$${appliedAmount.toFixed(2)} store credit applied for ${clientData.name || 'client'}`,
    detail:     { appliedAmount, remainingBalance, creditIdsUsed: usedIds },
  });

  await batch.commit();

  return NextResponse.json({
    ok:               true,
    appliedAmount,
    remainingBalance,
    creditIdsUsed:    usedIds,
  });
}
