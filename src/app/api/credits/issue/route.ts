/**
 * api/credits/issue/route.ts
 *
 * Single entry point for issuing client credit. Implements the Earned vs
 * Courtesy distinction from the unified credit architecture:
 *
 *   'earned'   — money the client already paid (deposit conversion on
 *                cancellation, partial refund-to-credit). NOT a new expense
 *                — it's relabeling an existing liability from "deposit,
 *                applies to one future booking" (depositCredits) to "credit,
 *                applies to anything" (storeCredits). No ledger expense line
 *                is written for the issuance itself.
 *   'courtesy' — money the business is giving away (service recovery,
 *                goodwill, referral reward, manager-issued). A REAL expense
 *                — nothing was collected for it — logged under category
 *                'Service Recovery', matching the category this app's POS
 *                checkout already uses for staff-issued recovery amounts.
 *
 * Called by:
 *   - IssueRecoveryDialog (wallet mode) — always 'courtesy'
 *   - studio-cancel-refund — 'earned' for the deposit conversion itself,
 *     'courtesy' for any additional goodwill amount staff add on top
 *   - (future) self-cancel / useCancellationConfirm client-cancel paths,
 *     if/when those are migrated off depositCredits-only rollover and onto
 *     issuing visible storeCredits entries too
 *
 * POST body:
 *   {
 *     tenantId, clientId, amountCents, type: 'earned' | 'courtesy',
 *     source: 'cancellation_deposit_conversion' | 'cancellation_retain_partial'
 *           | 'service_recovery' | 'goodwill' | 'referral_reward'
 *           | 'membership_adjustment' | 'manual_credit',
 *     reason, createdBy,
 *     expiresAt?,            // ISO string, omit/null = never expires
 *     originalTransactionId?,// e.g. the depositCredits id this was converted from
 *     appointmentId?,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

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

const VALID_TYPES = ['earned', 'courtesy'];
const VALID_SOURCES = [
  'cancellation_deposit_conversion',
  'cancellation_retain_partial',
  'service_recovery',
  'goodwill',
  'referral_reward',
  'membership_adjustment',
  'manual_credit',
];

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId, clientId, amountCents, type, source, reason, createdBy,
    expiresAt, originalTransactionId, appointmentId,
  } = body;

  if (!tenantId || !clientId || !amountCents || amountCents <= 0 || !type || !source || !reason) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json({ ok: false, error: `source must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();
  const dollars = Math.round(amountCents) / 100;

  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  if (!clientSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }
  const client = clientSnap.data() || {};

  const creditEntry = {
    id: nanoid(),
    tenantId, clientId,
    appointmentId: appointmentId || undefined,
    amountCents: Math.round(amountCents),
    amount: dollars,
    type,
    source,
    reason,
    createdBy: createdBy || 'system',
    expiresAt: expiresAt || null,
    createdAt: now,
    usedAt: null,
    usedOnAppointmentId: null,
    status: 'available' as const,
  };

  const batch = db.batch();

  batch.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
    storeCredits: FieldValue.arrayUnion(creditEntry),
    totalStoreCredit: FieldValue.increment(dollars),
  });

  // Courtesy credit is a real, new expense — nothing was collected for it.
  // Earned credit is not — it's a relabeled liability, no new P&L line.
  if (type === 'courtesy') {
    const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    batch.set(txRef, {
      id: txRef.id, tenantId, clientId,
      clientOrVendor: client.name || 'Client',
      appointmentId: appointmentId || undefined,
      date: now,
      type: 'expense', category: 'Service Recovery',
      amount: dollars, amountCents: Math.round(amountCents),
      paymentMethod: 'Internal Protocol',
      staffId: createdBy || undefined,
      hasReceipt: false,
      description: `${source === 'service_recovery' ? 'Service Recovery' : source === 'goodwill' ? 'Goodwill' : source === 'referral_reward' ? 'Referral Reward' : 'Courtesy'} Credit Issued: ${reason}`,
      notes: `Courtesy credit — business-funded, not collected from client. Reason: ${reason}`,
    });
  }

  const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
  batch.set(auditRef, {
    id: auditRef.id, tenantId,
    entityType: 'credit_issued',
    entityId: creditEntry.id,
    actorId: createdBy || 'system',
    timestamp: now,
    summary: `${type === 'courtesy' ? 'Courtesy' : 'Earned'} credit of $${dollars.toFixed(2)} issued to ${client.name || 'client'} (${source})`,
    detail: { creditId: creditEntry.id, clientId, amount: dollars, type, source, reason, originalTransactionId: originalTransactionId || null },
  });

  await batch.commit();

  return NextResponse.json({ ok: true, creditId: creditEntry.id, amount: dollars, newTotalStoreCredit: (client.totalStoreCredit || 0) + dollars });
}