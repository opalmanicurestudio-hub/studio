// src/lib/bar-tab.ts — BAR TABS WITH A CARD HELD (design canvas "The bar and the pass"; lib/bar-tab-server, api/bar,
// the bar's tabs at /bar-tabs, and "Charge the held card" at the desk). A tab is a guest at the bar running drinks (and
// food) on one check, under a name ("Maria, red jacket"). It can hold a card: the guest taps it on the bar's reader once,
// and the business's hold amount is put on it, nothing charged. Closing the tab at the desk can then charge that card
// for the check (up to what's held), with no second tap; paying another way lets the held card go. Pure.

export const DEFAULT_HOLD = 50;
export const MIN_HOLD = 10, MAX_HOLD = 500;
export const NAME_MAX = 40;

/** Where a tab's held card is:
 *  starting  → being sent to the reader      on_reader → the reader is asking for the card
 *  held      → the card is held (nothing charged)
 *  declined  → the reader said no (its words are kept)
 *  charging  → the desk is charging it for the check      charged → it paid for the check
 *  stopped   → called off before it was held  released → let go (the tab was paid another way, or let go by hand) */
export type HoldState = 'starting' | 'on_reader' | 'held' | 'declined' | 'charging' | 'charged' | 'stopped' | 'released';
export type CardHold = { state: HoldState; id: string | null; cents: number; readerId: string | null; at: string; by: string | null; attempt: number;
  brand: string | null; last4: string | null; failed: string | null; pendingId?: string | null; chargedCents?: number | null };

/** The business's hold amount, in dollars (a manager sets it; $50 when not set). */
export function holdDollarsOf(tenant: any): number {
  const v = Math.round(Number(tenant?.barTabSettings?.holdDollars));
  return Number.isFinite(v) && v >= MIN_HOLD && v <= MAX_HOLD ? v : DEFAULT_HOLD;
}
export function cleanHoldDollars(raw: unknown): number | null {
  const v = Math.round(Number(raw));
  return Number.isFinite(v) && v >= MIN_HOLD && v <= MAX_HOLD ? v : null;
}

/** A tab's name as typed: a few words, never empty. */
export function cleanTabName(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return s || null;
}

/** A stored hold, read back safely (null when there isn't one). */
export function holdOf(raw: any): CardHold | null {
  if (!raw || typeof raw !== 'object') return null;
  const states: HoldState[] = ['starting', 'on_reader', 'held', 'declined', 'charging', 'charged', 'stopped', 'released'];
  const state = states.includes(raw.state) ? raw.state as HoldState : 'stopped';
  return { state, id: typeof raw.id === 'string' ? raw.id : null, cents: Math.max(0, Math.round(Number(raw.cents) || 0)), readerId: typeof raw.readerId === 'string' ? raw.readerId : null,
    at: String(raw.at || ''), by: raw.by ? String(raw.by).slice(0, 60) : null, attempt: Math.max(0, Math.floor(Number(raw.attempt) || 0)),
    brand: raw.brand ? String(raw.brand).slice(0, 20) : null, last4: /^\d{4}$/.test(String(raw.last4 || '')) ? String(raw.last4) : null, failed: raw.failed ? String(raw.failed).slice(0, 200) : null,
    pendingId: raw.pendingId ? String(raw.pendingId) : null, chargedCents: Number.isFinite(Number(raw.chargedCents)) ? Math.round(Number(raw.chargedCents)) : null };
}

const cap = (s: string | null) => (s ? s.replace(/^./, (c) => c.toUpperCase()) : 'Card');
/** The held card in a few words: "Visa 4242 held, up to $50". */
export function holdWords(h: CardHold | null): string {
  if (!h) return 'No card held';
  const card = `${cap(h.brand)}${h.last4 ? ` ${h.last4}` : ''}`;
  if (h.state === 'held') return `${card} held, up to $${(h.cents / 100).toFixed(0)}`;
  if (h.state === 'charging') return `${card}: being charged`;
  if (h.state === 'charged') return `Paid on ${card}`;
  if (h.state === 'starting' || h.state === 'on_reader') return 'Waiting for the card on the reader';
  if (h.state === 'declined') return h.failed || 'The card didn’t go through';
  return 'No card held';
}

/** Whether a tab's card is held now (the desk can charge it). */
export const isHeld = (h: CardHold | null) => !!h && h.state === 'held' && !!h.id;
