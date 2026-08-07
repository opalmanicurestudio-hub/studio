// ─── src/lib/fulfilment-state.ts ──────────────────────────────────────────────
// What did the customer ACTUALLY get?
//
// The stage machine answers "where is this order," not "how much of it was
// filled." isPickComplete() deliberately treats a shorted line as finished so
// the order can keep moving — which is right for the board and wrong for the
// customer, because it means an order where two of three lines were shorted
// reaches 'completed' looking exactly like a perfect one. Someone who received
// one item out of three has been shown the word "Completed."
//
// This module is the missing half. It is pure DERIVATION — no new field, no
// migration, nothing to keep in sync. Every number below is recomputed from
// the lines on every read, so it cannot drift and it works retroactively on
// every order already in the database.
//
// Structurally typed on purpose: it accepts the engine's OrderLine, the
// storefront's StatusLine, and the print routes' loosely-typed line objects
// without any of them importing each other.

export type FulfilmentState = 'full' | 'partial' | 'nothing';

/** The least a line must have for any of this to mean something. */
export interface FulfilmentLineLike {
  qtyOrdered?: number;
  qtyShorted?: number;
  status?: string;
  name?: string;
}

export interface FulfilmentSummary {
  state: FulfilmentState;
  unitsOrdered: number;
  unitsFulfilled: number;
  unitsShorted: number;
  unitsBackordered: number;   // coming later
  unitsRefunded: number;      // not coming — money returned
  linesAffected: number;
  shortNames: string[];
  /** "3 of 5 items" — empty when nothing was shorted. */
  countLabel: string;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
};

const BACKORDER_STATUSES = ['backordered'];

export function fulfilmentSummary(lines: FulfilmentLineLike[] | null | undefined): FulfilmentSummary {
  const rows = Array.isArray(lines) ? lines : [];

  let unitsOrdered = 0;
  let unitsShorted = 0;
  let unitsBackordered = 0;
  let linesAffected = 0;
  const shortNames: string[] = [];

  for (const l of rows) {
    const ordered = n(l?.qtyOrdered);
    // A short can never exceed what was ordered, however the data got there.
    const short = Math.min(n(l?.qtyShorted), ordered);
    unitsOrdered += ordered;
    unitsShorted += short;
    if (short > 0) {
      linesAffected += 1;
      if (BACKORDER_STATUSES.includes(String(l?.status || ''))) unitsBackordered += short;
      const nm = String(l?.name || '').trim();
      if (nm) shortNames.push(nm);
    }
  }

  const unitsFulfilled = Math.max(0, unitsOrdered - unitsShorted);
  const state: FulfilmentState =
    unitsShorted === 0 ? 'full'
      : unitsFulfilled === 0 ? 'nothing'
        : 'partial';

  return {
    state,
    unitsOrdered,
    unitsFulfilled,
    unitsShorted,
    unitsBackordered,
    unitsRefunded: unitsShorted - unitsBackordered,
    linesAffected,
    shortNames,
    countLabel: state === 'full' ? '' : `${unitsFulfilled} of ${unitsOrdered} items`,
  };
}

/**
 * The headline a CUSTOMER should see once the goods are out.
 *
 * Deliberately never says a bare "Delivered" or "Picked up" when something is
 * missing. The cheerful version of a partial order is the message that
 * generates the support email, because the customer is holding a box that
 * disagrees with their screen.
 */
export function customerOutcomeHeadline(
  summary: FulfilmentSummary,
  isShip: boolean
): { title: string; detail: string; tone: 'good' | 'mixed' } {
  const got = isShip ? 'Delivered' : 'Picked up';

  if (summary.state === 'full') {
    return { title: `${got} — enjoy!`, detail: '', tone: 'good' };
  }

  if (summary.state === 'nothing') {
    return {
      title: 'Nothing we could fill',
      detail: summary.unitsBackordered > 0
        ? 'Everything on this order is on backorder and ships as soon as it is back in stock.'
        : 'We could not fill any of this order and have refunded it in full.',
      tone: 'mixed',
    };
  }

  const bits: string[] = [];
  if (summary.unitsRefunded > 0) {
    bits.push(`${summary.unitsRefunded} we could not fill ${summary.unitsRefunded === 1 ? 'was' : 'were'} refunded`);
  }
  if (summary.unitsBackordered > 0) {
    bits.push(`${summary.unitsBackordered} ${summary.unitsBackordered === 1 ? 'is' : 'are'} on backorder and ship separately`);
  }

  return {
    title: `${got} — ${summary.countLabel}`,
    detail: bits.length ? `${bits.join(', and ')}.` : '',
    tone: 'mixed',
  };
}

/** Compact staff-side badge text: '' when nothing is wrong, else 'PARTIAL 3/5'. */
export function fulfilmentBadge(summary: FulfilmentSummary): string {
  if (summary.state === 'full') return '';
  if (summary.state === 'nothing') return 'UNFILLED';
  return `PARTIAL ${summary.unitsFulfilled}/${summary.unitsOrdered}`;
}
