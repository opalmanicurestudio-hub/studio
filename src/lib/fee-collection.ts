// ─── fee-collection.ts ────────────────────────────────────────────────────────
// SERVER ONLY. Split out of service-economics.ts deliberately: that file is
// imported by the settings screen to preview fees live in the browser, and
// anything reaching for firebase-admin from a client bundle fails the build.
// Pure maths stays there; anything that touches the database lives here.

import type { FeeEvent, Settlement } from './service-economics';

function fmt(c: number): string {
  return `$${((Number(c) || 0) / 100).toFixed(2)}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// COLLECTING WHAT IS OWED
//
// settleFee decides the number. This decides what happens to it, and it is
// deliberately ONE function shared by every path that can produce a fee —
// client cancellations, no-shows, reschedules, booth reservations — because
// the previous arrangement had each path inventing its own rules and two of
// them silently gave up on the money.
//
// The ladder, in order:
//
//   1. The forfeited deposit covers what it covers.
//   2. The shortfall is charged to the card on file.
//   3. If there is no card, or the card fails, the shortfall becomes a
//      RECORDED BALANCE against the client. Not a note in an event log — a
//      number the next booking screen and the next checkout can both see.
//
// Step 3 is the one that was missing everywhere. A fee that cannot be charged
// today is not a fee the business chose to waive; it is a debt, and treating
// it as vapour is how a shop discovers at year end that its cancellation
// policy never actually collected anything.

export interface CollectInput {
  db: any;
  tenantId: string;
  clientId: string | null;
  settlement: Settlement;
  event: FeeEvent;
  /** For the ledger line and the client-facing message. */
  description: string;
  appointmentId?: string | null;
  /** Resolved base URL for the internal charge call. */
  origin?: string;
  /** Pass false to record the debt without attempting a charge. */
  attemptCharge?: boolean;
}

export interface CollectResult {
  charged: boolean;
  chargedCents: number;
  /** Recorded as owing because it could not be collected. */
  arrearsCents: number;
  /** Deposit money to hand back when the fee was smaller than the deposit. */
  refundableCents: number;
  failureCode: string | null;
  failureGuidance: string | null;
  summary: string;
}

export async function collectSettlement(input: CollectInput): Promise<CollectResult> {
  const {
    db, tenantId, clientId, settlement, event, description,
    appointmentId = null, origin = '', attemptCharge = true,
  } = input;

  const base: CollectResult = {
    charged: false,
    chargedCents: 0,
    arrearsCents: 0,
    refundableCents: settlement.depositSurplusCents,
    failureCode: null,
    failureGuidance: null,
    summary: '',
  };

  if (settlement.waived || settlement.shortfallCents <= 0) {
    return { ...base, summary: settlement.waived ? settlement.reason : 'The deposit covered the fee in full.' };
  }

  const owed = settlement.shortfallCents;

  if (attemptCharge && clientId && origin) {
    try {
      const { internalPost } = await import('./message-policy');
      const res = await internalPost(origin, '/api/stripe/charge-card', {
        tenantId, clientId,
        amountCents: owed,
        description,
        category: 'Cancellation Fees',
        appointmentId,
        reason: description,
        // 'arrears_fee' is exactly right here, unlike a deposit: this IS money
        // the client owes, so a failure SHOULD park as a balance — which the
        // charge route already does for this kind.
        kind: 'arrears_fee',
        mode: 'auto',
      });
      const d = res.data || {};
      if (res.ok && d.ok === true) {
        return {
          ...base,
          charged: true,
          chargedCents: owed,
          summary: `${fmt(owed)} charged to the card on file.`,
        };
      }
      const { classifyCardFailure } = await import('./message-policy');
      const cf = classifyCardFailure(d.code, d.declineCode);
      // The charge route already parked this as a balance for arrears_fee.
      return {
        ...base,
        arrearsCents: owed,
        failureCode: cf.code,
        failureGuidance: cf.guidance,
        summary: `${fmt(owed)} could not be charged and has been recorded as owing.`,
      };
    } catch {
      // Fall through to recording it ourselves.
    }
  }

  // No card, no origin, or the call itself failed — record the debt directly
  // so it cannot evaporate.
  try {
    const { FieldValue } = require('firebase-admin/firestore');
    await db.doc(`tenants/${tenantId}/clients/${clientId}`).update({
      outstandingBalance: FieldValue.increment(owed / 100),
      unpaidFees: FieldValue.arrayUnion({
        feeId: `${event}-${appointmentId || Date.now()}`,
        appointmentId,
        appointmentDate: new Date().toISOString(),
        feeAmount: owed / 100,
        reason: description,
      }),
    });
  } catch { /* the settlement is still returned; the caller logs it */ }

  return {
    ...base,
    arrearsCents: owed,
    failureCode: 'no_card_on_file',
    failureGuidance: 'There is no card on file to charge.',
    summary: `${fmt(owed)} recorded as owing — no card on file.`,
  };
}
