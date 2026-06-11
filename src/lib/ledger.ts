// src/lib/ledger.ts
//
// Canonical ledger-posting module for ClarityFlow.
//
// PURPOSE
//   Every income or expense the studio earns or spends — POS sales, event
//   tickets, booth rent, manual entries — must land in the general ledger
//   (the `tenants/{tenantId}/transactions` collection) so it shows up in the
//   Ledger page and the P&L. Historically each handler wrote that transaction
//   itself, with its own copy of the cents->dollars math and idempotency
//   logic. This module makes those rules live in ONE place.
//
// HOW TO USE IT
//   This file is pure TypeScript. It imports nothing from Firebase, so it is
//   safe to import in BOTH client pages (Web SDK) and server routes (Admin
//   SDK) without dragging the wrong SDK into a bundle. It does NOT write to
//   Firestore — it builds the transaction object and a deterministic doc ID.
//   Each caller does its own `batch.set(...)` with whichever SDK is local.
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
//     import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';
//     const entry = buildLedgerEntry({ ...input });
//     const ref = db
//       .collection(`tenants/${tenantId}/transactions`)
//       .doc(ledgerEntryId(input.source, input.sourceId));
//     batch.set(ref, { ...entry, id: ref.id });
//
//   Because the doc ID is DETERMINISTIC (derived from source + sourceId), a
//   webhook that fires twice for the same payment overwrites the same doc
//   instead of creating a duplicate. That is the idempotency guarantee.

// ─── Money invariant ──────────────────────────────────────────────────────────
// The booth-rental system and Stripe both work in INTEGER CENTS.
// The Ledger's Transaction.amount is in DOLLARS (it is summed and shown with
// .toFixed(2)). This module is the single place that crosses that boundary.

// ─── Sources of money ─────────────────────────────────────────────────────────
// Add a new source here when you add a new income/expense stream. The string
// also becomes part of the deterministic doc ID, so keep these stable.

export type LedgerSource =
  | 'booth_rent'      // a renter paying rent (manual or autopay)
  | 'booth_charge'    // a renter paying a one-off charge / late fee
  | 'event_ticket'    // a guest buying an event ticket via Stripe
  | 'pos_sale'        // a point-of-sale checkout
  | 'manual'          // a hand-entered ledger transaction
  | 'expense';        // a studio expense (rental or otherwise)

// ─── Transaction shape ────────────────────────────────────────────────────────
// Mirrors the fields the Ledger page and AddTransactionDialog read/write. Only
// the fields the Ledger actually uses are required; optional fields stay
// optional so we never write `undefined` into Firestore by accident.

export type LedgerTransactionType = 'income' | 'expense' | 'payment' | 'reversal';
export type LedgerContext = 'Business' | 'Personal';

export interface LedgerTransaction {
  id: string;
  date: string;                 // ISO 8601 string
  description: string;
  clientOrVendor: string;
  type: LedgerTransactionType;
  context: LedgerContext;
  category: string;
  amount: number;               // DOLLARS (cents / 100)
  paymentMethod: string;
  hasReceipt: boolean;
  receiptUrl?: string | null;
  staffId?: string | null;
  // Traceability — which domain object produced this ledger line:
  source: LedgerSource;
  sourceId: string;             // the rentLedger payment id, Stripe session id, etc.
  stripePaymentIntentId?: string | null;
  createdAt: string;
}

// ─── Input ────────────────────────────────────────────────────────────────────
// What a caller provides. Amount is in CENTS here; the builder converts.

export interface LedgerEntryInput {
  source: LedgerSource;
  sourceId: string;             // stable id used for the deterministic doc id
  amountCents: number;          // ALWAYS cents; sign is normalized below
  type?: LedgerTransactionType; // defaults: income for revenue sources, expense otherwise
  context?: LedgerContext;      // defaults to 'Business'
  category: string;             // e.g. 'Booth Rent', 'Event Tickets'
  description: string;
  clientOrVendor?: string;
  date?: string;                // ISO or 'yyyy-MM-dd'; defaults to now
  paymentMethod?: string;       // e.g. 'Venmo', 'Card (Stripe)'; defaults to 'Other'
  hasReceipt?: boolean;
  receiptUrl?: string | null;
  staffId?: string | null;
  stripePaymentIntentId?: string | null;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_TYPE_BY_SOURCE: Record<LedgerSource, LedgerTransactionType> = {
  booth_rent:   'income',
  booth_charge: 'income',
  event_ticket: 'income',
  pos_sale:     'income',
  manual:       'expense',
  expense:      'expense',
};

// ─── ID helpers ───────────────────────────────────────────────────────────────

/**
 * Deterministic transaction document ID.
 *
 * Keying the doc ID on (source, sourceId) means a retried webhook or a
 * double-clicked button writes the SAME document instead of a duplicate —
 * income can never be double-counted. Firestore IDs cannot contain '/', so we
 * sanitize the source id.
 */
export function ledgerEntryId(source: LedgerSource, sourceId: string): string {
  const safe = String(sourceId).replace(/[^A-Za-z0-9_-]/g, '_');
  return `${source}__${safe}`;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toIsoDateTime(date?: string): string {
  if (!date) return new Date().toISOString();
  // A date-only string ('yyyy-MM-dd') is anchored to local noon so it neither
  // shifts a day across time zones nor displays as midnight in the Ledger.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(`${date}T12:00:00`).toISOString();
  }
  // Already a full ISO string (or close enough) — trust it.
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// ─── The builder ──────────────────────────────────────────────────────────────

/**
 * Build a Ledger transaction object from a normalized input.
 *
 * This is the ONLY place cents become dollars. It returns a plain object with
 * no `id` (the caller assigns the deterministic id via `ledgerEntryId`) and no
 * `undefined` values, so it is safe to hand straight to `batch.set`.
 */
export function buildLedgerEntry(input: LedgerEntryInput): Omit<LedgerTransaction, 'id'> {
  const type = input.type ?? DEFAULT_TYPE_BY_SOURCE[input.source];

  // Normalize sign: callers may pass negative cents (e.g. a rentLedger payment
  // is stored negative). The Ledger wants a positive magnitude; `type` carries
  // the income/expense direction.
  const amountDollars = Math.abs(input.amountCents) / 100;

  const nowIso = new Date().toISOString();

  return {
    date: toIsoDateTime(input.date),
    description: input.description,
    clientOrVendor: input.clientOrVendor ?? '',
    type,
    context: input.context ?? 'Business',
    category: input.category,
    amount: Number(amountDollars.toFixed(2)),
    paymentMethod: input.paymentMethod ?? 'Other',
    hasReceipt: input.hasReceipt ?? false,
    receiptUrl: input.receiptUrl ?? null,
    staffId: input.staffId ?? null,
    source: input.source,
    sourceId: input.sourceId,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    createdAt: nowIso,
  };
}