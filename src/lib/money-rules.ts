// src/lib/money-rules.ts — WHO CAN DO WHAT (pure; design board "Who can do what"; lib/money-rules-server, api/counter,
// the Activity page's Rules). The owner's rules for the money moments at the counter and the window: for each, anyone
// signed in, a manager (their PIN, or signed in as one), or only the owner. Staff can also refund small amounts on their
// own, up to the owner's amount. Until the owner changes them, they're as the counter has always worked: a manager for
// all of them but the drawer opened with no sale (anyone, with why). The owner is never asked for a PIN.

export type Need = 'anyone' | 'manager' | 'owner';
export type RuleKey = 'refund' | 'void' | 'comp' | 'lowerPrice' | 'customDiscount' | 'noSale' | 'cashMove' | 'staffMeal';
export const NEEDS: { id: Need; label: string }[] = [{ id: 'anyone', label: 'Anyone' }, { id: 'manager', label: 'A manager' }, { id: 'owner', label: 'Only you' }];

export const RULES: { id: RuleKey; label: string; hint: string; today: Need; what: string }[] = [
  { id: 'refund', label: 'Refunds', hint: 'Except small ones, below', today: 'manager', what: 'A refund' },
  { id: 'void', label: 'Void an order', hint: 'Or take off something already made. One not sent yet, anyone can drop', today: 'manager', what: 'A void' },
  { id: 'comp', label: 'On the house', hint: 'With why', today: 'manager', what: 'On the house' },
  { id: 'lowerPrice', label: 'A lower price', hint: 'Higher never asks', today: 'manager', what: 'A lower price' },
  { id: 'customDiscount', label: 'Another discount amount', hint: 'Your set discounts never ask', today: 'manager', what: 'Another amount' },
  { id: 'noSale', label: 'Open the drawer, no sale', hint: 'Always with why', today: 'anyone', what: 'Opening the drawer with no sale' },
  { id: 'cashMove', label: 'Cash in or out of the drawer', hint: 'Change runs, paying a supplier', today: 'manager', what: 'Cash in or out' },
  { id: 'staffMeal', label: 'Staff meals', hint: 'Settled with no money', today: 'manager', what: 'A staff meal' },
];
const NEED_IDS = new Set<string>(NEEDS.map((n) => n.id));
/** The most staff can refund on their own (a refund over it takes the rule above). */
export const REFUND_SELF_MAX = 10000;

export type MoneyRules = Record<RuleKey, Need> & { refundSelfCents: number };

/** The business's rules, with today's way for anything not set. */
export function rulesOf(tenant: any): MoneyRules {
  const r = tenant?.moneyRules && typeof tenant.moneyRules === 'object' ? tenant.moneyRules : {};
  const out: any = {};
  for (const x of RULES) out[x.id] = NEED_IDS.has(String(r[x.id])) ? r[x.id] : x.today;
  const self = Math.round(Number(r.refundSelfCents));
  out.refundSelfCents = Number.isFinite(self) && self > 0 ? Math.min(REFUND_SELF_MAX, self) : 0;
  return out as MoneyRules;
}

/** Who it takes, now: a refund within what staff can do on their own takes nobody else. */
export function needFor(rules: MoneyRules, key: RuleKey, cents?: number | null): Need {
  const n = rules[key];
  if (key === 'refund' && n !== 'anyone' && Number.isFinite(Number(cents)) && Number(cents) > 0 && Number(cents) <= rules.refundSelfCents) return 'anyone';
  return n;
}

/** What the screen says when it takes someone else. */
export function needWords(key: RuleKey, need: Need): string {
  const what = RULES.find((r) => r.id === key)?.what || 'That';
  return need === 'owner' ? `${what} takes the owner here. Their PIN, or ask them to.` : `${what} takes a manager. Their PIN, or ask one to.`;
}

/** A change to the rules from the owner's screen, kept only where it's one of the choices. */
export function cleanRules(b: any, now: MoneyRules): MoneyRules | { error: string } {
  const next: any = { ...now };
  for (const x of RULES) if (b?.[x.id] !== undefined) {
    if (!NEED_IDS.has(String(b[x.id]))) return { error: 'Anyone, a manager or only you: pick one.' };
    next[x.id] = b[x.id];
  }
  if (b?.refundSelfCents !== undefined) {
    const n = Math.round(Number(b.refundSelfCents));
    if (!Number.isFinite(n) || n < 0 || n > REFUND_SELF_MAX) return { error: `Staff can refund on their own up to $${REFUND_SELF_MAX / 100} at most, or $0.` };
    next.refundSelfCents = n;
  }
  return next as MoneyRules;
}
