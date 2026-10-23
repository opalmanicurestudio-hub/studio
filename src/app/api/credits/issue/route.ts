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
 *                goodwill, referral reward, manager-issued, a thank-you for
 *                waiting). A REAL expense — nothing was collected for it —
 *                logged under category 'Service Recovery', matching the
 *                category this app's POS checkout already uses for
 *                staff-issued recovery amounts.
 *
 * Who may issue it: the app's own server (the internal header), or the
 * business's team when signed in. A booth renter runs their own business
 * here, so the shop's credit isn't theirs to give. Earned credit moves money
 * the client already paid, so only the server or a manager adds it; anyone
 * else on the team gives courtesy credit, up to their limit (over it, a
 * manager approves with their PIN).
 *
 * Once, however often it's asked: the credit is named after what it's for —
 * the thank-you for waiting after its booking (once per booking), anything
 * else after the attempt key the screen keeps across retries — and the credit,
 * its expense line and its audit entry are written in one step that first
 * checks it isn't there yet. A second tap, or a retry after a lost answer,
 * gets the same credit back.
 *
 * Called by:
 *   - IssueRecoveryDialog (wallet mode) — always 'courtesy'
 *   - api/appt (the client chose to wait for a provider running late) —
 *     'courtesy', source 'provider_delay', once per booking
 *
 * POST body:
 *   {
 *     tenantId, clientId, amountCents, type: 'earned' | 'courtesy',
 *     source: 'cancellation_deposit_conversion' | 'cancellation_retain_partial'
 *           | 'service_recovery' | 'goodwill' | 'referral_reward'
 *           | 'membership_adjustment' | 'manual_credit' | 'provider_delay',
 *     reason, createdBy,
 *     attemptKey,            // required, except for 'provider_delay' (named after its booking)
 *     expiresAt?,            // ISO string, omit/null = never expires
 *     originalTransactionId?,// e.g. the depositCredits id this was converted from
 *     appointmentId?,        // required for 'provider_delay'
 *   }
 */

import { requireRole } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';

import { sendStoreCreditEmail } from '@/lib/retail-webhook';

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
  'provider_delay',
];
// Ids named after what they record.
const keyPart = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId, clientId, amountCents, type, source, reason, createdBy,
    expiresAt, originalTransactionId, appointmentId,
  } = body;
  // Our own server (the internal header), or someone signed in to this business.
  const fromSystem = !!process.env.CRON_SECRET && req.headers.get('x-cf-internal') === process.env.CRON_SECRET;
  let actor: any = null;
  if (!fromSystem) {
    const g = await requireRole(req, String(tenantId || ''), 'staff'); if (g.deny) return g.deny;
    actor = g.actor;
    if (actor?.isRenter) return NextResponse.json({ ok: false, error: 'Store credit is given by the business, so it can’t be added from a renter’s account.' }, { status: 403 });
  }

  if (!tenantId || !clientId || !amountCents || amountCents <= 0 || !type || !source || !reason) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json({ ok: false, error: `source must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
  }
  // Earned credit is money the client already paid, moved onto their account: the app does that itself, or a manager.
  if (type === 'earned' && !fromSystem && !actor?.isManager) {
    return NextResponse.json({ ok: false, error: 'Only a manager can add credit for money the client already paid.' }, { status: 403 });
  }
  // What it's named after: the thank-you for waiting after its booking; anything else after this attempt.
  const creditId = source === 'provider_delay'
    ? (keyPart(appointmentId) ? `provider_delay_${keyPart(appointmentId)}` : '')
    : (keyPart(body.attemptKey).length >= 8 ? `issued_${keyPart(body.attemptKey)}` : '');
  if (!creditId) return NextResponse.json({ ok: false, error: 'Please refresh the page and try again.' }, { status: 400 });

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();
  const cents = Math.round(amountCents);
  const dollars = cents / 100;
  const clientRef = db.doc(`tenants/${tenantId}/clients/${clientId}`);
  // The credit's record (its audit entry), named after it: there once it's been added.
  const markRef = db.doc(`tenants/${tenantId}/auditLog/credit_issued_${creditId}`);
  const lineRef = db.doc(`tenants/${tenantId}/transactions/credit_${creditId}`);

  const clientSnap = await clientRef.get();
  if (!clientSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }
  const client = clientSnap.data() || {};
  // Added already (a second tap, or asked again after the answer was lost): the same credit, nothing more.
  const already = async () => {
    const m = await markRef.get(); if (!m.exists) return null;
    const d: any = m.data() || {};
    if (d.detail?.clientId && d.detail.clientId !== clientId) return NextResponse.json({ ok: false, error: 'Please refresh the page and try again.' }, { status: 409 });
    const cur: any = (await clientRef.get()).data() || {};
    return NextResponse.json({ ok: true, already: true, creditId, amount: Number(d.detail?.amount ?? dollars), newTotalStoreCredit: Number(cur.totalStoreCredit) || 0 });
  };
  { const a = await already(); if (a) return a; }

  // Courtesy credit (money the business gives away) follows the same staff limit as discounts at checkout:
  // over it, a manager approves with their PIN. Earned credit (money the client already paid) and credit the
  // system issues itself (cancellations, deposits, a thank-you for waiting) are never held up.
  let approvedBy: string | null = null;
  if (type === 'courtesy' && !fromSystem) {
    const tenantDoc: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const { overStaffLimit, staffLimit } = await import('@/lib/staff-limit');
    if (!actor?.isManager && overStaffLimit(tenantDoc, dollars)) {
      const { consumeApproval } = await import('@/lib/approvals');
      const ok = await consumeApproval(db, tenantId, body.approvalToken, { kind: 'client_recovery', amount: dollars });
      if (!ok) { const a = await already(); if (a) return a;   // the other tap used the approval and added it
        return NextResponse.json({ ok: false, code: 'needs_approval', limit: staffLimit(tenantDoc).amount, error: `Credit over $${staffLimit(tenantDoc).amount} needs a manager’s PIN.` }, { status: 403 }); }
      approvedBy = ok.approverName;
    } else if (actor?.isManager) approvedBy = actor.name || null;
  }

  const creditEntry = {
    id: creditId,
    tenantId, clientId,
    appointmentId: appointmentId || null,
    amountCents: cents,
    amount: dollars,
    type,
    source,
    reason,
    createdBy: createdBy || 'system',
    ...(approvedBy ? { approvedBy } : {}),   // who signed off a credit over the staff limit
    expiresAt: expiresAt || null,
    createdAt: now,
    usedAt: null,
    usedOnAppointmentId: null,
    status: 'available' as const,
  };

  // One step: the credit on the client's account, its expense line (courtesy) and its record, only if it isn't there yet.
  const out: any = await db.runTransaction(async (tx: any) => {
    const cs = await tx.get(clientRef); const ms = await tx.get(markRef);
    if (!cs.exists) return { missing: true };
    if (ms.exists) return { already: true };
    const c: any = cs.data() || {};
    if ((Array.isArray(c.storeCredits) ? c.storeCredits : []).some((x: any) => x?.id === creditId)) return { already: true };
    tx.update(clientRef, {
      storeCredits: FieldValue.arrayUnion(creditEntry),
      totalStoreCredit: FieldValue.increment(dollars),
    });
    // Courtesy credit is a real, new expense — nothing was collected for it.
    // Earned credit is not — it's a relabeled liability, no new P&L line.
    if (type === 'courtesy') {
      tx.set(lineRef, {
        id: lineRef.id, tenantId, clientId,
        clientOrVendor: client.name || 'Client',
        appointmentId: appointmentId || null,
        date: now,
        type: 'expense', category: 'Service Recovery',
        amount: dollars, amountCents: cents,
        paymentMethod: 'Internal Protocol',
        staffId: createdBy || null,
        hasReceipt: false,
        description: `${source === 'service_recovery' ? 'Service Recovery' : source === 'goodwill' ? 'Goodwill' : source === 'referral_reward' ? 'Referral Reward' : 'Courtesy'} Credit Issued: ${reason}`,
        notes: `Courtesy credit — business-funded, not collected from client. Reason: ${reason}`,
        creditId,
      });
    }
    tx.set(markRef, {
      id: markRef.id, tenantId,
      entityType: 'credit_issued',
      entityId: creditId,
      actorId: createdBy || 'system',
      timestamp: now,
      summary: `${type === 'courtesy' ? 'Courtesy' : 'Earned'} credit of $${dollars.toFixed(2)} issued to ${c.name || client.name || 'client'} (${source})`,
      detail: { creditId, clientId, amount: dollars, type, source, reason, originalTransactionId: originalTransactionId || null },
    });
    return { ok: true, total: (Number(c.totalStoreCredit) || 0) + dollars, credits: Array.isArray(c.storeCredits) ? c.storeCredits : [] };
  });
  if (out.missing) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  if (out.already) { const a = await already(); if (a) return a; return NextResponse.json({ ok: true, already: true, creditId, amount: dollars }); }

  // The customer finds out. Balance and history come from the client's own
  // storeCredits array (this system's ledger); non-fatal — the credit exists
  // whether or not the email lands, and the response never carries balances
  // beyond what the caller (staff) already knows.
  const clientEmail = String(client.email || '').trim();
  if (clientEmail) {
    try {
      const entries = [...out.credits, creditEntry]
        .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const history = entries.slice(0, 10).map((c: any) => ({
        at: String(c.createdAt || ''),
        label: c.usedAt ? 'Store credit — used' : 'Store credit added',
        deltaCents: (c.usedAt ? -1 : 1) * Math.max(0, Number(c.amountCents) || 0),
      }));
      await sendStoreCreditEmail(db, tenantId, {
        toEmail: clientEmail,
        toName: String(client.name || ''),
        grantedCents: cents,
        reason,
        balanceCents: Math.round(out.total * 100),
        expiresAt: expiresAt || null,
        history,
      });
    } catch (e: any) {
      console.error('[credits/issue] grant email failed (credit is issued):', e?.message);
    }
  }

  return NextResponse.json({ ok: true, creditId, amount: dollars, newTotalStoreCredit: out.total });
}
