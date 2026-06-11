// src/lib/ledger.ts
//
// Canonical ledger-posting module for ClarityFlow.
//
// PURPOSE
//   Every income or expense the studio earns or spends — POS sales, event
//   tickets, booth rent, appointment deposits, gift cards, manual entries —
//   must land in the general ledger (`tenants/{tenantId}/transactions`) so it
//   shows up in the Ledger page and the P&L. Historically each handler wrote
//   that transaction itself, with its own copy of the cents->dollars math and
//   idempotency logic. This module puts those rules in ONE place.
//
// HOW TO USE IT
//   Pure TypeScript. Imports nothing at runtime (the Transaction import is
//   type-only and erased at compile), so it is safe in BOTH client pages (Web
//   SDK) and server routes (Admin SDK) without dragging a wrong SDK into a
//   bundle. It does NOT write to Firestore — it builds the transaction object
//   and a deterministic doc ID. Each caller does its own `batch.set(...)`.
//
//   Client (Web SDK), inside a writeBatch:
//     import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';
//     const entry = buildLedgerEntry({ ...input });
//     const ref = doc(
//       collection(firestore, 'tenants', tenantId, 'transactions'),
//       ledgerEntryId(input.source, input.sourceId)
//     );
//     batch.set(ref, { ...entry, id: ref.id });
//
//   Server (Admin SDK), inside a batch:
//     const entry = buildLedgerEntry({ ...input });
//     const ref = db
//       .collection(`tenants/${tenantId}/transactions`)
//       .doc(ledgerEntryId(input.source, input.sourceId));
//     batch.set(ref, { ...entry, id: ref.id });
//
//   The doc ID is DETERMINISTIC (source + sourceId), so a webhook that fires
//   twice for the same payment overwrites the same doc instead of duplicating.
//   That is the idempotency guarantee against the SAME event firing twice. It
//   does NOT stop two DIFFERENT events double-counting the same money (a
//   deposit + its final checkout, a gift-card sale + its redemption) — that is
//   a netting decision each flow must make. See NOTES at the bottom.

import type { Transaction } from './financial-data';

// ─── Money invariant ──────────────────────────────────────────────────────────
// The booth-rental system and Stripe work in INTEGER CENTS. Transaction.amount
// is in DOLLARS. This module is the single place that crosses that boundary.

// ─── Sources of money ─────────────────────────────────────────────────────────
// Add a new source here when you add a new income/expense stream. The string
// becomes part of the deterministic doc ID, so keep these values stable.

export type LedgerSource =
  | 'booth_rent'          // a renter paying rent (manual or autopay)
  | 'booth_charge'        // a renter paying a one-off charge / late fee
  | 'event_ticket'        // a guest buying an event ticket via Stripe
  | 'appointment_deposit' // an online booking deposit
  | 'appointment_sale'    // a completed appointment checkout (service revenue)
  | 'gift_card'           // a gift card sale (see NOTES — recognize once)
  | 'pos_sale'            // a point-of-sale / retail checkout
  | 'manual'              // a hand-entered ledger transaction
  | 'expense';            // a studio expense (rental or otherwise)

// ─── Traceability fields layered on top of the canonical Transaction ──────────

export interface LedgerEntryMeta {
  source: LedgerSource;
  sourceId: string;
  stripePaymentIntentId?: string | null;
  createdAt: string;
}

/** What buildLedgerEntry returns: a real Transaction (minus id) + traceability. */
export type LedgerProjectedTransaction = Omit<Transaction, 'id'> & LedgerEntryMeta;

export type LedgerTransactionType = Transaction['type'];
export type LedgerContext = Transaction['context'];

// ─── Input ────────────────────────────────────────────────────────────────────
// Amount is ALWAYS in CENTS here; the builder converts. Optional linkage fields
// mirror the real Transaction so projections carry the same detail as your POS
// entries (appointment, client, event, tips, discounts).

export interface LedgerEntryInput {
  source: LedgerSource;
  sourceId: string;                 // stable id for the deterministic doc id
  amountCents: number;              // ALWAYS cents; sign is normalized below
  category: string;                 // e.g. 'Booth Rent', 'Event Tickets'
  description: string;

  type?: LedgerTransactionType;     // default: income for revenue sources, else expense
  context?: LedgerContext;          // default 'Business'
  clientOrVendor?: string;
  clientId?: string;
  date?: string;                    // ISO or 'yyyy-MM-dd'; default now
  paymentMethod?: string;           // e.g. 'Venmo', 'Card (Stripe)'; default 'Other'
  paymentMethodIdentifier?: string;
  hasReceipt?: boolean;
  receiptUrl?: string;
  staffId?: string;
  tipAmount?: number;               // dollars, matching Transaction.tipAmount
  appointmentId?: string;
  relatedEventId?: string;
  relatedOrderId?: string;
  relatedBillInstanceId?: string;
  appliedDiscountCode?: string;
  discountAmount?: number;          // dollars
  stripePaymentIntentId?: string | null;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_TYPE_BY_SOURCE: Record<LedgerSource, LedgerTransactionType> = {
  booth_rent:          'income',
  booth_charge:        'income',
  event_ticket:        'income',
  appointment_deposit: 'income',
  appointment_sale:    'income',
  gift_card:           'income',
  pos_sale:            'income',
  manual:              'expense',
  expense:             'expense',
};

// ─── ID helper ────────────────────────────────────────────────────────────────

/**
 * Deterministic transaction document ID.
 *
 * Keying the doc ID on (source, sourceId) means a retried webhook or a
 * double-clicked button writes the SAME document instead of a duplicate —
 * the same money event can never be counted twice. Firestore IDs cannot
 * contain '/', so the source id is sanitized.
 */
export function ledgerEntryId(source: LedgerSource, sourceId: string): string {
  const safe = String(sourceId).replace(/[^A-Za-z0-9_-]/g, '_');
  return `${source}__${safe}`;
}

// ─── Date helper ──────────────────────────────────────────────────────────────

function toIsoDateTime(date?: string): string {
  if (!date) return new Date().toISOString();
  // A date-only string ('yyyy-MM-dd') is anchored to local noon so it neither
  // shifts a day across time zones nor displays as midnight in the Ledger.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(`${date}T12:00:00`).toISOString();
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// ─── The builder ──────────────────────────────────────────────────────────────

/**
 * Build a Ledger transaction from a normalized input.
 *
 * This is the ONLY place cents become dollars. It returns a plain object with
 * no `id` (the caller assigns the deterministic id) and — importantly — with
 * no `undefined` values, because Firestore rejects writes containing
 * `undefined`. Optional fields are included only when provided, matching the
 * convention in AddTransactionDialog.
 */
export function buildLedgerEntry(input: LedgerEntryInput): LedgerProjectedTransaction {
  const type = input.type ?? DEFAULT_TYPE_BY_SOURCE[input.source];

  // Normalize sign: callers may pass negative cents (a rentLedger payment is
  // stored negative). The Ledger wants a positive magnitude; `type` carries the
  // income/expense direction.
  const amount = Number((Math.abs(input.amountCents) / 100).toFixed(2));

  const base: LedgerProjectedTransaction = {
    date: toIsoDateTime(input.date),
    description: input.description,
    clientOrVendor: input.clientOrVendor ?? '',
    type,
    context: input.context ?? 'Business',
    category: input.category,
    amount,
    paymentMethod: input.paymentMethod ?? 'Other',
    hasReceipt: input.hasReceipt ?? false,
    source: input.source,
    sourceId: input.sourceId,
    createdAt: new Date().toISOString(),
  };

  // Include optional fields ONLY when defined — never write undefined/null.
  const out: Record<string, unknown> = { ...base };
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null) out[key] = value;
  };

  put('clientId', input.clientId);
  put('paymentMethodIdentifier', input.paymentMethodIdentifier);
  put('receiptUrl', input.receiptUrl);
  put('staffId', input.staffId);
  put('tipAmount', input.tipAmount);
  put('appointmentId', input.appointmentId);
  put('relatedEventId', input.relatedEventId);
  put('relatedOrderId', input.relatedOrderId);
  put('relatedBillInstanceId', input.relatedBillInstanceId);
  put('appliedDiscountCode', input.appliedDiscountCode);
  put('discountAmount', input.discountAmount);
  put('stripePaymentIntentId', input.stripePaymentIntentId);

  return out as unknown as LedgerProjectedTransaction;
}

// ─── NOTES — semantics each source must decide deliberately ────────────────────
//
// The funnel guarantees a money event posts cleanly and once. It does NOT, by
// itself, get the ACCOUNTING right for flows that span two events:
//
//   • APPOINTMENT DEPOSITS. A deposit and the final checkout are two separate
//     events. If the deposit posts income AND the checkout posts the full
//     service amount, you double-count. The checkout must NET OUT the deposit
//     already recorded (post service total minus deposit), or the deposit must
//     be treated as a credit applied at checkout rather than its own income.
//
//   • GIFT CARDS. Recognize income ONCE — either at sale or at redemption,
//     never both. If the sale posts income, redemptions must NOT post income
//     again (the redemption is the customer spending money already counted).
//     Booking both doubles every gift card's revenue.
//
// These are per-flow decisions, made where the flow is wired — not here.